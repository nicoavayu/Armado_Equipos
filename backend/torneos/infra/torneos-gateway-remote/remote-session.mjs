#!/usr/bin/env node
// GATEWAY REMOTE — one operator session for Phase A (KR + B03) and Phase B/C (Deno Deploy gateway + remote probes).
//
// Custody: the Supabase PAT and the Deno Deploy token are typed by the human on the tty (run-remote-session.sh), piped
// here on stdin, and live only in this process's memory. Keychain values (bridge ring, contract secret, gateway DB
// logins) are read into memory when a step needs them. Nothing secret reaches argv, env, a file, the transcript or
// evidence (every evidence text is scanned against every value the session holds).
//
// Control: commands and plan phrases arrive one line at a time on a FIFO in the session directory (ARMA2_SESSION_DIR,
// owned by this user, mode 0700). Every write still prints its PLAN id and requires the exact phrase for that id; the
// certified gateway-auth modes run unmodified (their tty is this FIFO).
//
//   ga --preflight | --keyring-generate | --b03 | --deploy-preflight | --certify     certified gateway-auth modes
//   deno-observe                        read-only: apps, layers, the gateway app, its revisions
//   create                              PLAN + phrase → POST /v2/apps (app-level env without the public URL) → deploy r1
//   publish-url                         PLAN + phrase → PATCH TORNEOS_GATEWAY_PUBLIC_URL (default alias) → deploy r2 → probe
//   probe                               B7 basic certification of the deployed gateway (read-only, no identity created)
//   db-identities                       read-only: torneos_identity row count (E2E bookkeeping)
//   quit
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { runGatewayAuth, validateGatewayEnvWithRealConfig, EVIDENCE_DIR as GA_EVIDENCE_DIR } from '../torneos-gateway-auth/gateway-auth.mjs';
import { makeClient, httpsTransport } from '../torneos-gateway-auth/mgmt-gateway-auth.mjs';
import { systemKeychain } from '../torneos-gateway-auth/keychain-gateway-auth.mjs';
import { systemKeychain as contractKeychain } from '../core-prod-contract/keychain-prod.mjs';
import { applySql, assertPsqlPrerequisites, POOLER_HOST_PATTERN } from '../torneos-gateway-auth/psql-gateway-auth.mjs';
import { httpsProbeTransport } from '../torneos-foundation/postgrest-probe.mjs';
import { httpsAuthProbeTransport } from '../torneos-gateway-auth/auth-probe.mjs';
import { probeTls } from '../torneos-gateway-auth/tls-probe.mjs';
import { jwksHttpsTransport } from '../torneos-gateway-auth/jwks-url-probe.mjs';
import { probeEdgeLogins } from '../torneos-gateway-auth/login-probe.mjs';
import { assertJwksPin } from '../torneos-gateway-auth/keyring.mjs';
import * as R from './remote-contract.mjs';
import { makeDenoClient, denoHttpsTransport } from './deno-client.mjs';
import { buildAssets } from './gateway-bundle.mjs';
import { buildGatewayEnv, denoEnvVars, describeEnv, readCaPem, fetchCoreAnonKey, publicUrlForHost, PENDING_PUBLIC_URL } from './gateway-env.mjs';
import { probeGateway } from './gateway-probe.mjs';

const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const planIdOf = (plan) => G.sha256(JSON.stringify(plan)).slice(0, 12);
export class SessionStop extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }
const stop = (code, detail) => { throw new SessionStop(code, detail); };

// ─────────────────────────── control channel ───────────────────────────
export function assertSessionDir(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('ARMA2_SESSION_DIR must be an absolute directory');
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) throw new Error('ARMA2_SESSION_DIR must be a real directory owned by you with mode 0700');
  return dir;
}
/** Blocking one-line read from the FIFO (open blocks until a writer connects; the writer's close is the EOF). */
export function fifoLineReader(fifo) {
  const pending = [];
  return () => {
    while (!pending.length) {
      const fd = fs.openSync(fifo, 'r');
      let data = '';
      try { const buf = Buffer.alloc(4096); for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (n === 0) break; data += buf.toString('utf8', 0, n); if (data.length > 8192) break; } } finally { fs.closeSync(fd); }
      pending.push(...data.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length));
    }
    return pending.shift();
  };
}

// ─────────────────────────── session ───────────────────────────
export function makeSession({ pat, deno, deps }) {
  if (!G.PAT_PATTERN.test(pat ?? '')) stop('PAT_MALFORMED');
  if (!R.DENO_TOKEN_PATTERN.test(deno ?? '')) stop('DENO_TOKEN_MALFORMED');
  const known = [pat, deno];
  const remember = (v) => { if (typeof v === 'string' && v.length >= 8 && !known.includes(v)) known.push(v); return v; };
  const redact = (t) => { let s = String(t); for (const k of known) if (k && k.length >= 8) s = s.split(k).join('«REDACTED»'); return s; };
  const say = (s) => deps.say(redact(s));
  let armed = null;
  const denoClient = makeDenoClient({ transport: deps.denoTransport, token: deno, armedFor: () => armed, known });
  const mgmt = () => makeClient({ transport: deps.transport, pat, mode: '--deploy-preflight', known });
  const stamp = () => stampOf(new Date(deps.now()));
  const state = { lastRevision: null, publicUrl: null, host: null, org: null };

  function writeEvidence(name, body) {
    const text = `${JSON.stringify({ tool: 'backend/torneos/infra/torneos-gateway-remote', ...body }, null, 1)}\n`;
    const leaks = G.secretFindings(text, known);
    if (leaks.length) stop('EVIDENCE_REJECTED_SECRET_LEAK', { name, findings: leaks });
    fs.mkdirSync(deps.evidenceDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(deps.evidenceDir, name), text, { mode: 0o600, flag: 'wx' });
    const digest = G.sha256(text);
    say(`EVIDENCE ${name} ${digest}`);
    return digest;
  }
  const requirePhrase = (expected) => {
    say(`\nTo proceed the operator must send exactly:\n  ${expected}`);
    const got = deps.readLine();
    if (got !== expected) stop('NOT_AUTHORIZED', { expected_phrase: expected });
    say('phrase accepted');
    return { phrase: expected, channel: 'session FIFO (operator)' };
  };
  const loadPin = () => { const p = JSON.parse(fs.readFileSync(deps.jwksPinFile ?? G.JWKS_PIN_FILE, 'utf8')); assertJwksPin(p); return p; };
  const readRing = (pin) => {
    const kc = deps.keychain();
    const out = {};
    for (const [i, slot] of G.RING_SLOTS.entries()) { const kid = pin.keys[i].kid; out[slot] = { pkcs8: remember(kc.ring.read(slot, kid)), kid }; }
    return out;
  };

  async function denoObserve() {
    const apps = await denoClient.apps();
    const layers = await denoClient.layers();
    const app = await denoClient.app();
    const revisions = app ? await denoClient.revisions() : [];
    const failures = [];
    if (layers.length) failures.push('DENO_ORG_LAYERS_PRESENT');
    if (app) {
      const names = (app.env_vars ?? []).map((e) => e.key);
      const bad = R.forbiddenEnvNames(names);
      if (bad.length) failures.push(`DENO_APP_FORBIDDEN_ENV:${bad.join(',')}`);
      if (names.some((n) => !R.ENV_NAMES.includes(n))) failures.push('DENO_APP_ENV_NOT_PINNED');
      if ((app.env_vars ?? []).some((e) => e.secret !== R.SECRET_NAMES.includes(e.key))) failures.push('DENO_APP_SECRET_FLAGS');
      if ((app.env_vars ?? []).some((e) => e.secret && e.value_returned)) failures.push('DENO_APP_SECRET_VALUE_RETURNED');
      if ((app.layers ?? []).length) failures.push('DENO_APP_LAYERS_PRESENT');
    }
    return { apps, layers, app, revisions: revisions.slice(0, 5), failures };
  }

  async function supabaseInputs() {
    const client = mgmt();
    const pooler = await client.pooler();
    const poolerHost = pooler.hosts.find((h) => POOLER_HOST_PATTERN.test(h)) ?? stop('POOLER_HOST_NOT_SA_EAST_1');
    const keys = await client.apiKeys();
    if (!keys.probeKey) stop('TORNEOS_PUBLISHABLE_KEY_UNAVAILABLE');
    remember(keys.probeKey);
    const fns = await client.functions();
    if (fns.length) stop('EDGE_FUNCTIONS_NOT_ZERO');
    return { poolerHost, torneosAnonKey: keys.probeKey, requests: client.requests };
  }

  async function gatewayEnv(publicUrl) {
    const pin = loadPin();
    const ring = readRing(pin);
    const kc = deps.keychain();
    const passwords = Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, remember(kc.dbLogin(l.login).read())]));
    const contractSecret = remember(deps.contractKeychain().read());
    const core = await deps.fetchCoreAnonKey();
    const sb = await supabaseInputs();
    const env = buildGatewayEnv({ publicUrl, poolerHost: sb.poolerHost, jwksPin: pin, k1Pkcs8: ring.k1.pkcs8, torneosAnonKey: sb.torneosAnonKey, coreAnonKey: core.key, caPem: deps.readCaPem(), contractSecret, passwords });
    for (const k of R.SECRET_NAMES) remember(env[k]);
    const validation = await deps.validateGatewayEnv(env);
    if (validation.topology?.kind !== 'production') stop('GATEWAY_TOPOLOGY_NOT_PRODUCTION');
    if (validation.commerce !== 'off') stop('GATEWAY_COMMERCE_NOT_OFF');
    if (JSON.stringify(validation.trustedKids) !== JSON.stringify(pin.keys.map((k) => k.kid)) || validation.activeKid !== pin.active) stop('GATEWAY_RING_NOT_THE_PIN');
    return { env, pin, ring, core: core.source, torneosAnonKey: sb.torneosAnonKey, validation, supabase_requests: sb.requests };
  }

  async function waitRevision(id) {
    const started = deps.now();
    let r = null;
    while (deps.now() - started < (deps.revisionTimeoutMs ?? 6 * 60000)) {
      r = await denoClient.revision(id);
      if (['succeeded', 'failed', 'skipped'].includes(r.status)) break;
      await deps.sleep(deps.pollMs ?? 5000);
    }
    return r;
  }

  function bundle() {
    const b = deps.buildAssets();
    return { assets: b.assets, summary: { head: b.head, digest: b.digest, files: b.manifest, bare: b.bare } };
  }

  async function create() {
    const obs = await denoObserve();
    if (obs.failures.length) stop('DENO_OBSERVE_FAILED', { failures: obs.failures });
    if (obs.app) stop('DENO_APP_ALREADY_EXISTS', { app: obs.app.slug });
    if (obs.apps.some((a) => a.slug === R.APP_SLUG)) stop('DENO_APP_LISTED_BUT_UNREADABLE');
    const ge = await gatewayEnv(PENDING_PUBLIC_URL);
    const b = bundle();
    const env = denoEnvVars(ge.env, { omit: ['TORNEOS_GATEWAY_PUBLIC_URL'] });
    const createBody = { slug: R.APP_SLUG, labels: { 'custom.component': 'arma2-torneos-gateway' }, layers: [], env_vars: env, config: R.APP_CONFIG };
    const deployBody = { assets: b.assets, labels: { 'custom.git_head': b.summary.head }, production: true, preview: false };
    R.assertDenoWriteBody('app-create', createBody); R.assertDenoWriteBody('deploy', deployBody);
    const plan = { step: 'create', app: R.APP_SLUG, config: R.APP_CONFIG, env: describeEnv(ge.env).filter((e) => e.key !== 'TORNEOS_GATEWAY_PUBLIC_URL'), core_anon_key: ge.core,
      layers: [], org_apps_before: obs.apps.map((a) => a.slug), bundle: { head: b.summary.head, digest: b.summary.digest, files: b.summary.files.length }, timelines: { production: true, preview: false } };
    const planId = planIdOf(plan);
    say(`\nPLAN ${planId}: create Deno Deploy app ${R.APP_SLUG} (app-level variables only, 0 layers, no build step) and deploy revision 1\n  env (${plan.env.length}): ${plan.env.map((e) => `${e.key}${e.secret ? '(secret)' : ''}`).join(' ')}\n  TORNEOS_GATEWAY_PUBLIC_URL: not set yet (the gateway stays disabled, fail closed) — set by publish-url from the observed default alias\n  source: ${b.summary.files.length} files of the gateway graph, HEAD ${b.summary.head}, digest ${b.summary.digest.slice(0, 16)}…\n  topology validated by the real config.ts: ${ge.validation.topology.kind}, commerce ${ge.validation.commerce}, active ${ge.validation.activeKid}\n  apps in the Deno org now: [${plan.org_apps_before.join(', ')}]`);
    const authorization = requirePhrase(R.PHRASES.create(planId));
    const again = await denoObserve();
    if (again.app || again.failures.length || JSON.stringify(again.apps.map((a) => a.slug)) !== JSON.stringify(plan.org_apps_before)) stop('DENO_STATE_CHANGED_SINCE_PLAN');
    armed = 'app-create'; const app = await denoClient.createApp(createBody); armed = null;
    armed = 'deploy'; const rev = await denoClient.deploy(deployBody); armed = null;
    const done = await waitRevision(rev.id);
    const tl = done?.status === 'succeeded' ? await denoClient.timelines(rev.id) : [];
    state.lastRevision = rev.id;
    const hosts = [...new Set([...(done?.timelines ?? []).flatMap((t) => t.hostnames), ...tl.flatMap((t) => t.domains)])];
    const defaultHost = hosts.find((h) => R.DEFAULT_HOST_RE.test(h)) ?? null;
    state.host = defaultHost; state.org = defaultHost ? R.DEFAULT_HOST_RE.exec(defaultHost)[1] : null;
    const after = await denoObserve();
    const verdict = done?.status === 'succeeded' && defaultHost && !after.failures.length ? 'DENO_APP_CREATED_R1_LIVE' : 'DENO_APP_CREATE_POSTCHECK_FAILED';
    writeEvidence(`gr-02-create-${stamp()}.json`, { verdict, plan, plan_id: planId, authorization, app, revision: done, timelines: tl, hosts, default_host: defaultHost, after, deno_requests: denoClient.requests, deno_writes: denoClient.writes });
    if (verdict !== 'DENO_APP_CREATED_R1_LIVE') stop(verdict, { status: done?.status, failure: done?.failure_detail, hosts, failures: after.failures });
    return { verdict, host: defaultHost };
  }

  async function publishUrl() {
    const obs = await denoObserve();
    if (obs.failures.length || !obs.app) stop('DENO_OBSERVE_FAILED', { failures: obs.failures, app: !!obs.app });
    const latest = obs.revisions[0];
    const tl = latest ? await denoClient.timelines(latest.id) : [];
    const hosts = [...new Set([...(latest?.timelines ?? []).flatMap((t) => t.hostnames), ...tl.flatMap((t) => t.domains)])];
    const host = hosts.find((h) => R.DEFAULT_HOST_RE.test(h)) ?? stop('DENO_DEFAULT_ALIAS_NOT_FOUND', { hosts });
    const publicUrl = publicUrlForHost(host);
    const ge = await gatewayEnv(publicUrl);
    const b = bundle();
    const envBody = { env_vars: denoEnvVars({ TORNEOS_GATEWAY_PUBLIC_URL: publicUrl }) };
    const deployBody = { assets: b.assets, labels: { 'custom.git_head': b.summary.head }, production: true, preview: false };
    R.assertDenoWriteBody('app-env', envBody); R.assertDenoWriteBody('deploy', deployBody);
    const plan = { step: 'publish-url', app: R.APP_SLUG, public_url: publicUrl, env_names_now: (obs.app.env_vars ?? []).map((e) => e.key).sort(), bundle: { head: b.summary.head, digest: b.summary.digest }, previous_revision: latest?.id ?? null };
    const planId = planIdOf(plan);
    say(`\nPLAN ${planId}: TORNEOS_GATEWAY_PUBLIC_URL = ${publicUrl} (the Deno default alias; no custom domain)\n  then deploy revision 2 of the same source (HEAD ${b.summary.head}, digest ${b.summary.digest.slice(0, 16)}…) and run the B7 probes\n  app env now: ${plan.env_names_now.join(' ')}`);
    const authorization = requirePhrase(R.PHRASES.deploy(planId));
    const again = await denoObserve();
    if (again.failures.length || again.revisions[0]?.id !== plan.previous_revision) stop('DENO_STATE_CHANGED_SINCE_PLAN');
    armed = 'app-env'; const app = await denoClient.setPublicUrl(envBody); armed = null;
    armed = 'deploy'; const rev = await denoClient.deploy(deployBody); armed = null;
    const done = await waitRevision(rev.id);
    state.lastRevision = rev.id; state.publicUrl = publicUrl; state.host = host; state.org = R.DEFAULT_HOST_RE.exec(host)[1];
    const tl2 = done?.status === 'succeeded' ? await denoClient.timelines(rev.id) : [];
    const after = await denoObserve();
    const pinDoc = { purpose: 'Arma2 Torneos gateway on Deno Deploy — public facts only', app: R.APP_SLUG, app_id: after.app?.id ?? null, deno_org: state.org, host, public_url: publicUrl,
      revision: rev.id, source: { head: b.summary.head, digest: b.summary.digest, files: b.summary.files }, env: describeEnv(ge.env), core_anon_key: ge.core, deployed_at: new Date(deps.now()).toISOString() };
    const ok = done?.status === 'succeeded' && !after.failures.length;
    if (ok) { fs.mkdirSync(path.dirname(deps.deployPinFile), { recursive: true }); fs.writeFileSync(deps.deployPinFile, `${JSON.stringify(pinDoc, null, 1)}\n`); }
    const verdict = ok ? 'GATEWAY_DEPLOYED_R2' : 'GATEWAY_DEPLOY_POSTCHECK_FAILED';
    writeEvidence(`gr-03-deploy-${stamp()}.json`, { verdict, plan, plan_id: planId, authorization, app, revision: done, timelines: tl2, after, deploy_pin: ok ? pinDoc : null, deno_requests: denoClient.requests, deno_writes: denoClient.writes });
    if (!ok) stop(verdict, { status: done?.status, failure: done?.failure_detail, failures: after.failures });
    return { verdict, publicUrl };
  }

  async function probe() {
    const pinDeploy = JSON.parse(fs.readFileSync(deps.deployPinFile, 'utf8'));
    const pin = loadPin();
    const ring = readRing(pin);
    const kc = deps.keychain();
    for (const l of G.EDGE_LOGINS) remember(kc.dbLogin(l.login).read());
    remember(deps.contractKeychain().read());
    const sb = await supabaseInputs();
    const obs = await denoObserve();
    const latest = obs.revisions[0];
    const tl = latest ? await denoClient.timelines(latest.id) : [];
    const alternateHosts = [...new Set([...(latest?.timelines ?? []).flatMap((t) => t.hostnames), ...tl.flatMap((t) => t.domains)])].filter((h) => h !== pinDeploy.host);
    const result = await deps.probeGateway({ base: pinDeploy.public_url, jwksPin: pin, ring: { k1: ring.k1 }, known, torneosAnonKey: sb.torneosAnonKey, alternateHosts });
    const verdict = result.pass && !obs.failures.length ? 'GATEWAY_REMOTE_DEPLOY_PASS' : 'GATEWAY_REMOTE_PROBE_FAILED';
    writeEvidence(`gr-04-basic-cert-${stamp()}.json`, { verdict, public_url: pinDeploy.public_url, revision: latest, deno: { app: obs.app, layers: obs.layers, apps: obs.apps, failures: obs.failures }, probe: result,
      supabase_edge_functions: 0, deno_requests: denoClient.requests, deno_writes: denoClient.writes });
    say(`probe: ${result.passed}/${result.total}${result.checks.filter((c) => !c.pass).map((c) => `\n  FAIL ${c.name} → ${c.status} ${c.error ?? ''}`).join('')}`);
    return { verdict };
  }

  async function dbIdentities() {
    const client = mgmt();
    const rows = await client.sql('select count(*)::int as n, count(distinct core_user_id)::int as users from public.torneos_identity');
    say(`torneos_identity: ${JSON.stringify(rows[0] ?? null)}`);
    return { verdict: 'DB_READ', rows };
  }

  async function ga(mode) {
    if (!R.SESSION_GA_MODES.includes(mode)) stop('GA_MODE_NOT_IN_SESSION', { mode });
    let decisions = null;
    try { const p = JSON.parse(fs.readFileSync(deps.deployPinFile, 'utf8')); decisions = { publicUrl: p.public_url, denoDeployOrg: p.deno_org }; } catch { decisions = null; }
    const r = await runGatewayAuth({ mode, request: { pat }, deps: { ...deps.gaDeps, tty: { readLine: () => deps.readLine() }, say, ...(decisions ? { deployDecisions: decisions } : {}) } });
    say(`RESULT ${r.verdict}${r.next ? ` next=${r.next}` : ''}`);
    return r;
  }

  return {
    known,
    async run(line) {
      const [cmd, arg, ...rest] = line.trim().split(/\s+/);
      if (rest.length) stop('COMMAND_REFUSED');
      if (cmd === 'ga') return ga(arg);
      if (arg !== undefined) stop('COMMAND_REFUSED');
      if (cmd === 'deno-observe') { const o = await denoObserve(); say(JSON.stringify({ apps: o.apps.map((a) => a.slug), layers: o.layers.length, app: o.app ? { slug: o.app.slug, env: o.app.env_vars?.map((e) => e.key), layers: o.app.layers } : null, revisions: o.revisions.map((r) => ({ id: r.id, status: r.status })), failures: o.failures })); writeEvidence(`gr-01-deno-observe-${stamp()}.json`, { read_only: true, ...o, deno_requests: denoClient.requests }); return { verdict: o.failures.length ? 'DENO_OBSERVE_FAILED' : 'DENO_OBSERVE_OK' }; }
      if (cmd === 'create') return create();
      if (cmd === 'publish-url') return publishUrl();
      if (cmd === 'probe') return probe();
      if (cmd === 'db-identities') return dbIdentities();
      stop('COMMAND_UNKNOWN', { cmd });
    },
    wipe() { known.splice(0); },
  };
}

async function main() {
  const dir = assertSessionDir(process.env.ARMA2_SESSION_DIR);
  const fifo = path.join(dir, 'ctl');
  if (!fs.existsSync(fifo)) { const r = spawnSync('/usr/bin/mkfifo', ['-m', '600', fifo]); if (r.status !== 0) throw new Error('mkfifo failed'); }
  if (!fs.lstatSync(fifo).isFIFO()) throw new Error('ctl is not a FIFO');
  const transcript = path.join(dir, 'transcript.log');
  const stdin = await new Promise((resolve) => { const c = []; process.stdin.on('data', (x) => c.push(x)); process.stdin.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
  let request; try { request = JSON.parse(stdin); } catch { process.stderr.write('SESSION_STDIN_NOT_JSON\n'); process.exit(2); }
  if (Object.keys(request).sort().join(',') !== 'deno,pat') { process.stderr.write('SESSION_STDIN_SHAPE\n'); process.exit(2); }
  const readLine = fifoLineReader(fifo);
  const say = (s) => { process.stdout.write(`${s}\n`); fs.appendFileSync(transcript, `${s}\n`, { mode: 0o600 }); };
  const gaDeps = {
    transport: httpsTransport, probeTransport: httpsProbeTransport, authProbeTransport: httpsAuthProbeTransport, keychain: systemKeychain(), applySql, psqlPrerequisites: () => assertPsqlPrerequisites(),
    tlsProbe: probeTls, loginProbe: probeEdgeLogins, jwksTransport: jwksHttpsTransport, validateGatewayEnv: validateGatewayEnvWithRealConfig, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), evidenceDir: GA_EVIDENCE_DIR,
  };
  const session = makeSession({ pat: request.pat, deno: request.deno, deps: {
    say, readLine, transport: httpsTransport, denoTransport: denoHttpsTransport, keychain: systemKeychain, contractKeychain, fetchCoreAnonKey, readCaPem, validateGatewayEnv: validateGatewayEnvWithRealConfig,
    buildAssets: () => buildAssets(), probeGateway, now: () => Date.now(), sleep: gaDeps.sleep, evidenceDir: R.EVIDENCE_DIR, deployPinFile: R.DEPLOY_PIN_FILE, gaDeps,
  } });
  request.pat = ''; request.deno = '';
  say(`SESSION READY ${new Date().toISOString()} — commands on ${fifo}`);
  for (;;) {
    const line = readLine();
    if (line === 'quit') break;
    say(`\n> ${line}`);
    try { const r = await session.run(line); say(`OK ${r?.verdict ?? ''}`); } catch (e) {
      const detail = e?.detail ? JSON.stringify(e.detail).slice(0, 1500) : String(e?.message ?? e).slice(0, 300);
      say(`STOP ${e?.code ?? 'ERROR'} ${G.secretFindings(detail, session.known).length ? '(detail withheld: secret-shaped)' : detail}`);
    }
  }
  session.wipe();
  say('SESSION CLOSED');
  process.exit(0);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
