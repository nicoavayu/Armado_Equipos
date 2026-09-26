#!/usr/bin/env node
// PAYMENTS TEST — the operator session of the hosted Mercado Pago Checkout Pro TEST certification.
//
// Custody: four values are typed by the human on the tty (run-payments-session.sh), piped here on stdin and live only
// in this process's memory: the READ-ONLY Supabase scoped PAT, the Deno Deploy organization token, the Mercado Pago TEST
// seller access token and the Mercado Pago TEST webhook secret. Keychain values (the installer `postgres`, the payments
// login password, the internal HMAC key) are read into memory when a step needs them. Nothing secret reaches argv, env
// (except PGPASSWORD of the psql child), a file, the transcript or the evidence: every evidence text is scanned against
// every value the session holds and against the secret shapes of the contract.
//
// Control: commands and plan phrases arrive one line at a time on the FIFO $ARMA2_SESSION_DIR/ctl. Every write prints
// `PLAN <id>` and requires the exact phrase for that id; the state it was planned on is re-read right before the write.
// No step retries a write.
//
//   preflight        read   Supabase (--db-certify reads), Deno (apps, gateway app env names), gateway live, MP attestation, Keychain
//   pb               write  PLAN → phrase → Keychain password → SCRAM verifier → the ONE psql transaction as postgres → delta + login probe
//   create           write  PLAN → phrase → Keychain HMAC key → POST /v2/apps torneos-payments-test (app-level env) → deploy r1
//   redeploy         write  PLAN → phrase → (PATCH the QA organization pin, once) → deploy the current source (sandbox policy)
//   app-probe        read   the live TEST app: routing, Host, HMAC, signature and binding negatives (nothing is written)
//   fixtures         read   the QA org / S1 / S2 / purchases created in the browser (qa-fixtures.js), census + isolation
//   ordering         read*  the MP-B1.2 permutations on the hosted functions as the payments login, every transaction ROLLBACK
//   preference       write  PLAN → phrase → internal HMAC call for P1 → Mercado Pago Preference (TEST, ARS 39.900) → reuse
//   observe          read   Mercado Pago payments of P1 + the QA trail + the app's logs (after the sandbox checkout)
//   replays          read*  signed duplicates / replays / seller & topic negatives with the REAL approved payment id
//   refund           write  PLAN → phrase → full refund of the approved TEST payment → waits for the webhook → revoked grant
//   certify          read   PAYMENTS_REMOTE_TEST_CERTIFIED: everything above re-read and bound together
//   status | quit
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { foundationDiff, coreFailures } from '../torneos-gateway-auth/gateway-auth.mjs';
import { makeClient, httpsTransport } from '../torneos-gateway-auth/mgmt-gateway-auth.mjs';
import { probeTls } from '../torneos-gateway-auth/tls-probe.mjs';
import { gatewayHttps } from '../torneos-gateway-remote/gateway-probe.mjs';
import { readCaPem } from '../torneos-gateway-remote/gateway-env.mjs';
import * as C from './payments-test-contract.mjs';
import * as D from './payments-db.mjs';
import { makeDenoClient, makeMercadoPagoClient, makeAppClient, denoHttpsTransport, mpHttpsTransport, appHttpsTransport } from './payments-clients.mjs';
import { systemKeychain } from './keychain-payments-test.mjs';
import { buildPaymentsAssets } from './payments-bundle.mjs';

const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const planIdOf = (plan) => C.sha256(JSON.stringify(plan)).slice(0, 12);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
export const DEPLOY_PIN_FILE = path.join(path.dirname(C.DELTA_PIN_FILE), 'payments-test-deploy.json');
export class SessionStop extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }
const stop = (code, detail) => { throw new SessionStop(code, detail); };
/** The seller id is the last segment of a Mercado Pago access token; the attestation confirms it with the provider. */
export const sellerOfToken = (token) => /-(\d{6,20})$/.exec(token ?? '')?.[1] ?? null;
const one = (rows) => rows?.[0]?.json_build_object ?? rows?.[0]?.trail ?? null;

// ─────────────────────────── control channel ───────────────────────────
export function assertSessionDir(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('ARMA2_SESSION_DIR must be an absolute directory');
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) throw new Error('ARMA2_SESSION_DIR must be a real directory owned by you with mode 0700');
  return dir;
}
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

/** The real torneos-payments config.ts judges the env document (nothing connects, nothing is fetched). */
export async function validatePaymentsEnvWithRealConfig(env) {
  const { loadGatewayTree } = await import('../torneos-gateway-auth/gateway-loader.mjs');
  const tree = await loadGatewayTree();
  try {
    const { loadPaymentsConfig } = await tree.import('torneos-payments/config.ts');
    const cfg = loadPaymentsConfig(env);
    return { deployment: cfg.deployment, remoteHost: cfg.remoteHost, sellerId: cfg.mp.sellerId, notificationUrl: cfg.notificationUrl, appBaseUrl: cfg.appBaseUrl, ca: !!cfg.dbSslCa, qaOrganizationId: cfg.qaOrganizationId };
  } finally { await tree.cleanup(); }
}

// ─────────────────────────── session ───────────────────────────
export function makeSession({ pat, deno, mpToken, mpSecret, deps }) {
  if (!C.PAT_PATTERN.test(pat ?? '')) stop('PAT_MALFORMED');
  if (!C.DENO_TOKEN_PATTERN.test(deno ?? '')) stop('DENO_TOKEN_MALFORMED');
  if (!C.MP_TOKEN_PATTERN.test(mpToken ?? '')) stop('MP_TOKEN_MALFORMED');
  if (!C.MP_SECRET_PATTERN.test(mpSecret ?? '')) stop('MP_WEBHOOK_SECRET_MALFORMED');
  const sellerId = sellerOfToken(mpToken);
  if (!C.MP_SELLER_PATTERN.test(sellerId ?? '')) stop('MP_SELLER_UNDERIVABLE');
  const known = [pat, deno, mpToken, mpSecret];
  const remember = (v) => { if (typeof v === 'string' && v.length >= 8 && !known.includes(v)) known.push(v); return v; };
  const redact = (t) => { let s = String(t); for (const k of known) if (k && k.length >= 8) s = s.split(k).join('«REDACTED»'); return s.replace(/SCRAM-SHA-256\$[^'\s"]+/g, '«SCRAM»'); };
  const say = (s) => deps.say(redact(s));
  let denoArmed = null; let mpArmed = null;
  const denoClient = makeDenoClient({ transport: deps.denoTransport, token: deno, armedFor: () => denoArmed, known });
  const mp = makeMercadoPagoClient({ transport: deps.mpTransport, token: mpToken, sellerId, armedFor: () => mpArmed, known });
  const mgmt = () => makeClient({ transport: deps.transport, pat, mode: C.SUPABASE_MODE, known });
  const stamp = () => stampOf(new Date(deps.now()));
  const state = { evidence: [], poolerHost: null, fixtures: null, preference: null, approved: null, refunded: null, results: {} };
  let internalHex = null;
  const appClient = () => makeAppClient({ transport: deps.appTransport, internalSecretHex: internalHex, webhookSecret: mpSecret, sellerId, now: deps.now });

  function writeEvidence(name, body) {
    const text = `${JSON.stringify({ tool: 'backend/torneos/infra/torneos-payments-test/payments-session.mjs', generated_at: new Date(deps.now()).toISOString(), ...body }, null, 1)}\n`;
    const leaks = C.secretFindings(text, known);
    if (leaks.length) stop('EVIDENCE_REJECTED_SECRET_LEAK', { name, findings: leaks });
    fs.mkdirSync(deps.evidenceDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(deps.evidenceDir, name), text, { mode: 0o600, flag: 'wx' });
    const digest = C.sha256(text);
    state.evidence.push({ name, sha256: digest, verdict: body.verdict ?? null });
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
  const pins = () => ({ foundation: JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8')), jwks: JSON.parse(fs.readFileSync(G.JWKS_PIN_FILE, 'utf8')), delta: C.readDeltaPin(deps.deltaPinFile) });

  // ── observation (read-only) ──
  async function supabase({ deep = false } = {}) {
    const client = mgmt();
    const core = { prod: await client.prodProject(), prodFn: await client.prodContractFn(), staging: await client.project(G.STAGING_REF), old: await client.project(G.OLD_REF),
      torneos: await client.project(G.TORNEOS_REF), org: await client.org(), projects: await client.projects() };
    const functions = await client.functions();
    const tpa = await client.thirdPartyAuth();
    const catalog = one(await client.sql(G.CATALOG_SQL));
    const gatewayRoles = one(await client.sql(G.GATEWAY_ROLES_SQL));
    const paymentRoles = one(await client.sql(C.PAYMENT_ROLES_SQL));
    const census = one(await client.sql(C.CENSUS_SQL));
    const trail = (await client.sql(C.QA_TRAIL_SQL))[0]?.trail ?? [];
    const pooler = await client.pooler();
    const out = { core, functions: functions.map((f) => f.slug), tpa, catalog, gatewayRoles, paymentRoles, census, trail, pooler };
    if (deep) {
      out.installer = one(await client.sql(C.INSTALLER_SQL));
      out.health = await client.health();
      out.secrets = await client.secretNames();
      const { config } = await client.authConfig();
      out.auth = G.authState(config);
    }
    out.requests = client.requests; out.writes = client.writes;
    return out;
  }
  function supabaseFailures(o, { expectLogin }) {
    const p = pins();
    const f = coreFailures(o.core);
    if (o.functions.length !== 0) f.push('EDGE_FUNCTIONS_NOT_ZERO');
    if (!o.catalog || !o.gatewayRoles || !o.paymentRoles) f.push('CATALOG_UNREADABLE');
    else {
      if (foundationDiff(o.catalog, p.foundation).length) f.push('FOUNDATION_CATALOG_DRIFT');
      f.push(...C.paymentsDeltaFailures(o.catalog, o.gatewayRoles, o.paymentRoles, { expectLogin }).map((x) => `DELTA_${x}`));
      if (expectLogin) {
        if (!p.delta) f.push('PAYMENTS_DELTA_PIN_MISSING');
        else if (canon({ c: G.DELTA_PATHS.map((k) => G.getPath(o.catalog, k)), g: { logins: o.gatewayRoles.logins, memberships: o.gatewayRoles.memberships, payment_logins: o.gatewayRoles.payment_logins }, p: o.paymentRoles })
          !== canon({ c: G.DELTA_PATHS.map((k) => G.getPath(p.delta.catalog, k)), g: p.delta.gateway_roles, p: p.delta.payment_roles })) f.push('PAYMENTS_DELTA_PIN_MISMATCH');
      }
    }
    if (G.b03State(o.tpa, p.jwks).state !== 'applied') f.push('B03_NOT_APPLIED');
    if (!o.pooler.hosts.some((h) => D.POOLER_HOST_PATTERN.test(h))) f.push('POOLER_HOST_NOT_SA_EAST_1');
    f.push(...C.censusFailures(o.census).map((x) => x.toUpperCase()));
    if (o.health && !o.health.every((s) => s.status === 'ACTIVE_HEALTHY')) f.push('TORNEOS_SERVICES_NOT_HEALTHY');
    if (o.secrets && o.secrets.some((n) => !/^SUPABASE_/.test(n))) f.push('NON_PLATFORM_SECRETS_PRESENT');
    if (o.auth?.problems?.length) f.push(...o.auth.problems);
    return f;
  }
  async function denoObserve() {
    const apps = await denoClient.apps();
    const layers = await denoClient.layers();
    const gateway = await denoClient.gatewayApp();
    const app = await denoClient.app();
    const revisions = app ? await denoClient.revisions() : [];
    const failures = [];
    if (layers.length) failures.push('DENO_ORG_LAYERS_PRESENT');
    if (!gateway) failures.push('GATEWAY_APP_UNREADABLE');
    const gwNames = (gateway?.env_vars ?? []).map((e) => e.key);
    const gwBad = gwNames.filter((n) => C.GATEWAY_MUST_NOT_HOLD.some((re) => re.test(n)));
    if (gwBad.length) failures.push(`GATEWAY_HOLDS_COMMERCE_OR_PAYMENTS_ENV:${gwBad.join(',')}`);
    if (app) {
      const names = (app.env_vars ?? []).map((e) => e.key);
      const bad = C.forbiddenEnvNames(names);
      if (bad.length) failures.push(`PAYMENTS_APP_FORBIDDEN_ENV:${bad.join(',')}`);
      if (C.envShapeOf(names) === 'other') failures.push('PAYMENTS_APP_ENV_NOT_EXACT');
      const pin = (app.env_vars ?? []).find((e) => e.key === C.QA_ORG_ENV);
      if (pin && pin.secret !== false) failures.push('PAYMENTS_APP_QA_PIN_NOT_PUBLIC');
      if ((app.env_vars ?? []).some((e) => e.secret !== C.SECRET_NAMES.includes(e.key))) failures.push('PAYMENTS_APP_SECRET_FLAGS');
      if ((app.env_vars ?? []).some((e) => e.secret && e.value_returned)) failures.push('PAYMENTS_APP_SECRET_VALUE_RETURNED');
      if ((app.layers ?? []).length) failures.push('PAYMENTS_APP_LAYERS_PRESENT');
    }
    return { apps, layers, gateway: gateway ? { slug: gateway.slug, env_names: gwNames.sort(), layers: gateway.layers } : null, app, revisions: revisions.slice(0, 5), failures,
      env_shape: app ? C.envShapeOf((app.env_vars ?? []).map((e) => e.key)) : null };
  }
  /** The Production gateway, live: healthy, commerce route absent, commerce RPC refused before any Core call. */
  async function gatewayLive() {
    const base = `https://${G.GATEWAY_HOST}/functions/v1/torneos-gateway`;
    const h = await deps.https({ url: `${base}/health`, headers: { origin: G.WEB_ORIGIN } });
    const commerce = await deps.https({ url: `${base}/commerce/v1/season-checkout`, method: 'POST', headers: { origin: G.WEB_ORIGIN, 'content-type': 'application/json' }, body: '{}' });
    const cfg = await deps.https({ url: `${base}/config`, headers: { origin: G.WEB_ORIGIN } });
    const checks = [
      { name: 'gateway /health 200 ready', pass: h.status === 200 && h.json?.ready === true, status: h.status },
      { name: 'gateway commerce route absent (commerce OFF) → 404', pass: commerce.status === 404, status: commerce.status },
      { name: 'gateway /config exposes no payments/commerce key', pass: cfg.status === 200 && canon(Object.keys(cfg.json ?? {}).sort()) === canon(['anonKey', 'coreUrl', 'torneosUrl']), status: cfg.status },
    ];
    return { checks, pass: checks.every((c) => c.pass) };
  }
  function custody() {
    const kc = deps.keychain();
    return { installer: kc.installer.check(), payments_login_password: kc.dbPassword.check(), internal_hmac_key: kc.internalSecret.check() };
  }

  // ── commands ──
  async function preflight() {
    const sb = await supabase({ deep: true });
    const loginState = C.paymentLoginState(sb.paymentRoles);
    const f = supabaseFailures(sb, { expectLogin: loginState === 'present' });
    if (!['absent', 'present'].includes(loginState)) f.push(`PAYMENT_LOGIN_${loginState.toUpperCase()}`);
    if (!C.installerCan(sb.installer)) f.push('INSTALLER_CANNOT_CREATE_THE_LOGIN');
    const host = sb.pooler.hosts.find((h) => D.POOLER_HOST_PATTERN.test(h)) ?? null;
    state.poolerHost = host;
    f.push(...deps.psqlPrerequisites());
    const tls = host ? D.PORTS.map((port) => deps.tlsProbe({ host, port })) : [];
    if (tls.some((t) => !t.pass)) f.push('POOLER_TLS_NOT_VERIFIED');
    const dn = await denoObserve();
    f.push(...dn.failures);
    const gw = await gatewayLive();
    if (!gw.pass) f.push('GATEWAY_LIVE_CHECK_FAILED');
    const attestation = await mp.attest();
    if (!attestation.pass) f.push('MP_TEST_SELLER_ATTESTATION_FAILED');
    const kc = custody();
    if (kc.installer !== 'PRESENT') f.push('INSTALLER_CUSTODY_ABSENT');
    const bundle = deps.buildAssets();
    const verdict = f.length ? 'PAYMENTS_PREFLIGHT_BLOCKED' : 'PAYMENTS_PREFLIGHT_PASS';
    state.results.preflight = { verdict, login: loginState, app: dn.app ? 'present' : 'absent' };
    writeEvidence(`pt-01-preflight-${stamp()}.json`, { verdict, read_only: true, failures: f, core: sb.core, torneos: { functions: sb.functions, health: sb.health, secret_names: sb.secrets, auth: sb.auth, b03: G.b03State(sb.tpa, pins().jwks),
      pooler: { hosts: sb.pooler.hosts, modes: sb.pooler.pool_modes, tls }, installer: sb.installer, payment_login: loginState, payment_roles: sb.paymentRoles, gateway_roles: sb.gatewayRoles, census: sb.census, qa_trail: sb.trail },
    deno: { apps: dn.apps, layers: dn.layers.length, gateway_app: dn.gateway, payments_app: dn.app, revisions: dn.revisions }, gateway_live: gw, mercado_pago: { seller_id: sellerId, attestation, requests: mp.requests },
    custody: kc, bundle: { head: bundle.head, digest: bundle.digest, files: bundle.manifest.length }, supabase_requests: sb.requests, management_api_writes: sb.writes, deno_writes: denoClient.writes, mp_writes: mp.writes });
    say(`preflight: login=${loginState} app=${dn.app ? 'present' : 'absent'} attestation=${attestation.pass} census=${JSON.stringify(sb.census)}${f.length ? `\n  FAIL ${f.join(' ')}` : ''}`);
    if (f.length) stop(verdict, { failures: f });
    return { verdict };
  }

  async function pb() {
    const sb = await supabase();
    if (C.paymentLoginState(sb.paymentRoles) !== 'absent') stop('PAYMENT_LOGIN_NOT_ABSENT', { state: C.paymentLoginState(sb.paymentRoles) });
    const pre = supabaseFailures(sb, { expectLogin: false });
    if (pre.length) stop('PB_PRECONDITIONS_FAILED', { failures: pre });
    const installer = one(await mgmt().sql(C.INSTALLER_SQL));
    if (!C.installerCan(installer)) stop('INSTALLER_CANNOT_CREATE_THE_LOGIN', { installer });
    const host = sb.pooler.hosts.find((h) => D.POOLER_HOST_PATTERN.test(h)) ?? stop('POOLER_HOST_NOT_SA_EAST_1');
    const kc = deps.keychain();
    const custodyBefore = kc.dbPassword.check();
    const plan = { step: 'pb', login: C.PAYMENT_LOGIN, attributes: 'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', membership: `${C.PAYMENT_ROLE} (INHERIT FALSE, SET TRUE)`,
      installer: 'postgres', host, port: 5432, sql_template_sha256: C.sha256(C.BOOTSTRAP_SQL_TEMPLATE), custody: { service: C.KEYCHAIN_SERVICE, account: C.KEYCHAIN_ACCOUNTS.dbPassword, before: custodyBefore },
      catalog_login_roles_torneos: sb.catalog.login_roles_torneos, census: sb.census };
    const planId = planIdOf(plan);
    say(`\nPLAN ${planId}: create the payments TEST login ${C.PAYMENT_LOGIN} on Arma2 Torneos (${G.TORNEOS_REF})\n  ${plan.attributes}\n  GRANT ${plan.membership} — nothing else; the server receives a SCRAM-SHA-256 verifier only\n  one psql transaction as postgres@${host}:5432 (verify-full), guards first; password: Keychain ${C.KEYCHAIN_SERVICE}/${C.KEYCHAIN_ACCOUNTS.dbPassword} (${custodyBefore === 'ABSENT' ? 'generated now' : 'existing entry'})`);
    const authorization = requirePhrase(C.PHRASES.bootstrap(planId));
    const again = await supabase();
    if (C.paymentLoginState(again.paymentRoles) !== 'absent' || canon(again.catalog) !== canon(sb.catalog) || canon(again.gatewayRoles) !== canon(sb.gatewayRoles)) stop('DB_STATE_CHANGED_SINCE_PLAN');
    if (kc.dbPassword.check() !== custodyBefore) stop('CUSTODY_CHANGED_SINCE_PLAN');
    if (custodyBefore === 'ABSENT') kc.dbPassword.generate();
    const password = remember(kc.dbPassword.read());
    const installerPw = remember(kc.installer.read());
    const verifier = remember(G.scramVerifier(password));
    const r = await deps.applySql({ sql: C.renderPaymentBootstrapSql(verifier), env: D.installerEnv({ host, password: installerPw }), redact });
    const after = await supabase();
    const post = supabaseFailures(after, { expectLogin: true });
    if (r.code !== 0) post.push('PB_TRANSACTION_FAILED');
    let probe = null;
    if (r.code === 0) {
      probe = await loginProbe(host, password);
      if (!probe.every((p) => p.pass)) post.push('PAYMENT_LOGIN_PROBE_FAILED');
    }
    const verdict = post.length ? (r.code !== 0 && C.paymentLoginState(after.paymentRoles) === 'absent' ? 'PB_ROLLED_BACK' : 'PB_POSTCHECK_FAILED') : 'PAYMENTS_LOGIN_CREATED';
    writeEvidence(`pt-02-payments-login-${stamp()}.json`, { verdict, plan, plan_id: planId, authorization, psql: { exit_code: r.code, signal: r.signal ?? null, elapsed_ms: r.elapsed_ms, stderr_tail: r.code === 0 ? null : r.stderr_tail },
      payment_roles_after: after.paymentRoles, gateway_roles_after: after.gatewayRoles, census_after: after.census, login_probe: probe, failures: post,
      custody: { service: C.KEYCHAIN_SERVICE, account: C.KEYCHAIN_ACCOUNTS.dbPassword, state: kc.dbPassword.check(), values_printed: false }, management_api_writes: after.writes, psql_writes: 1 });
    if (post.length) stop(verdict, { failures: post });
    return { verdict };
  }
  async function loginProbe(host, password) {
    const out = [];
    for (const port of D.PORTS) {
      const checks = D.loginChecks();
      const res = await deps.runPsql({ script: D.loginProbeScript(checks), env: D.paymentLoginEnv({ host, port, password }), redact });
      const ev = D.evaluateLoginProbe(checks, res.stdout);
      out.push({ port, pass: ev.pass && res.code === 0, exit_code: res.code, whoami: ev.whoami, checks: ev.results.length, failures: ev.failures, stderr_tail: res.stderr_tail || null, results: ev.results });
    }
    return out;
  }
  const dbPassword = () => remember(deps.keychain().dbPassword.read());

  function paymentsEnv({ host, password, internal, qaOrg = null }) {
    const env = {
      TORNEOS_PAYMENT_PROVIDER: 'MERCADO_PAGO', MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_TEST_ACCESS_TOKEN: mpToken, MERCADO_PAGO_TEST_WEBHOOK_SECRET: mpSecret, MERCADO_PAGO_TEST_SELLER_ID: sellerId,
      APP_PUBLIC_URL: C.APP_PUBLIC_URL, TORNEOS_PAYMENTS_NOTIFICATION_URL: C.WEBHOOK_URL, TORNEOS_PAYMENTS_INTERNAL_SECRET: internal,
      TORNEOS_PAYMENTS_DB_URL: `postgres://${C.PAYMENT_LOGIN}.${C.TORNEOS_REF}:${password}@${host}:6543/postgres`, TORNEOS_PAYMENTS_DB_SSL_CA: Buffer.from(deps.readCaPem()).toString('base64'),
      TORNEOS_PAYMENTS_DEPLOYMENT: 'remote-test',
      ...(qaOrg ? { [C.QA_ORG_ENV]: qaOrg } : {}),
    };
    remember(env.TORNEOS_PAYMENTS_DB_URL);
    return env;
  }
  const denoEnv = (env) => Object.keys(env).sort().map((key) => ({ key, value: env[key], secret: C.SECRET_NAMES.includes(key), contexts: 'all' }));
  const describe = (env) => Object.keys(env).sort().map((k) => (C.SECRET_NAMES.includes(k) ? { key: k, secret: true } : { key: k, secret: false, value: k === 'TORNEOS_PAYMENTS_DB_SSL_CA' ? `sha256:${C.sha256(env[k]).slice(0, 16)}` : env[k] }));
  function bundle() { const b = deps.buildAssets(); return { assets: b.assets, summary: { head: b.head, digest: b.digest, files: b.manifest } }; }
  async function waitRevision(id) {
    const started = deps.now(); let r = null;
    while (deps.now() - started < (deps.revisionTimeoutMs ?? 6 * 60000)) { r = await denoClient.revision(id); if (['succeeded', 'failed', 'skipped'].includes(r.status)) break; await deps.sleep(deps.pollMs ?? 5000); }
    return r;
  }
  async function hostsOf(revisionId, revision) {
    const tl = await denoClient.timelines(revisionId);
    return [...new Set([...(revision?.timelines ?? []).flatMap((t) => t.hostnames), ...tl.flatMap((t) => t.domains)].filter(Boolean))];
  }

  async function create() {
    const sb = await supabase();
    if (C.paymentLoginState(sb.paymentRoles) !== 'present') stop('PAYMENT_LOGIN_NOT_PRESENT');
    const sf = supabaseFailures(sb, { expectLogin: true });
    if (sf.length) stop('CREATE_PRECONDITIONS_FAILED', { failures: sf });
    const obs = await denoObserve();
    if (obs.failures.length) stop('DENO_OBSERVE_FAILED', { failures: obs.failures });
    if (obs.app || obs.apps.some((a) => a.slug === C.APP_SLUG)) stop('PAYMENTS_APP_ALREADY_EXISTS');
    const attestation = await mp.attest();
    if (!attestation.pass) stop('MP_TEST_SELLER_ATTESTATION_FAILED', { attestation });
    const host = sb.pooler.hosts.find((h) => D.POOLER_HOST_PATTERN.test(h)) ?? stop('POOLER_HOST_NOT_SA_EAST_1');
    const kc = deps.keychain();
    const hmacBefore = kc.internalSecret.check();
    const b = bundle();
    const plan = { step: 'create', app: C.APP_SLUG, config: C.APP_CONFIG, labels: C.APP_LABELS, env_names: C.ENV_NAMES, secret_names: C.SECRET_NAMES, public_url: C.PAYMENTS_BASE, webhook_url: C.WEBHOOK_URL,
      seller_id: sellerId, db: { login: `${C.PAYMENT_LOGIN}.${C.TORNEOS_REF}`, host, port: 6543 }, internal_hmac_custody: { service: C.KEYCHAIN_SERVICE, account: C.KEYCHAIN_ACCOUNTS.internalSecret, before: hmacBefore },
      org_apps_before: obs.apps.map((a) => a.slug), bundle: { head: b.summary.head, digest: b.summary.digest, files: b.summary.files.length }, timelines: { production: true, preview: false } };
    const planId = planIdOf(plan);
    say(`\nPLAN ${planId}: create Deno Deploy app ${C.APP_SLUG} (Free, default alias, no custom domain, 0 layers, no build) and deploy revision 1\n  env (${C.ENV_NAMES.length}, app-level only): ${C.ENV_NAMES.map((k) => `${k}${C.SECRET_NAMES.includes(k) ? '(secret)' : ''}`).join(' ')}\n  TORNEOS_PAYMENTS_DEPLOYMENT=remote-test, MERCADO_PAGO_ENVIRONMENT=test, seller ${sellerId} (attested test_user MLA)\n  DB ${plan.db.login}@${host}:6543 verify-full; internal HMAC key: Keychain (${hmacBefore === 'ABSENT' ? 'generated now' : 'existing entry'})\n  source: ${plan.bundle.files} files of the torneos-payments graph, HEAD ${b.summary.head}, digest ${b.summary.digest.slice(0, 16)}…\n  apps in the Deno org now: [${plan.org_apps_before.join(', ')}]; torneos-gateway untouched`);
    const authorization = requirePhrase(C.PHRASES.create(planId));
    const again = await denoObserve();
    if (again.app || again.failures.length || canon(again.apps.map((a) => a.slug)) !== canon(plan.org_apps_before)) stop('DENO_STATE_CHANGED_SINCE_PLAN');
    if (kc.internalSecret.check() !== hmacBefore) stop('CUSTODY_CHANGED_SINCE_PLAN');
    if (hmacBefore === 'ABSENT') kc.internalSecret.generate();
    internalHex = remember(kc.internalSecret.read());
    const env = paymentsEnv({ host, password: dbPassword(), internal: internalHex });
    const validation = await deps.validatePaymentsEnv(env);
    if (validation.deployment !== 'remote-test' || validation.remoteHost !== C.PAYMENTS_HOST || validation.sellerId !== sellerId || !validation.ca) stop('PAYMENTS_ENV_REJECTED_BY_REAL_CONFIG', { validation });
    const createBody = { slug: C.APP_SLUG, labels: C.APP_LABELS, layers: [], env_vars: denoEnv(env), config: C.APP_CONFIG };
    const deployBody = { assets: b.assets, labels: { 'custom.git_head': b.summary.head }, production: true, preview: false };
    C.assertDenoWriteBody('app-create', createBody); C.assertDenoWriteBody('deploy', deployBody);
    denoArmed = 'app-create'; let app; try { app = await denoClient.createApp(createBody); } finally { denoArmed = null; }
    denoArmed = 'deploy'; let rev; try { rev = await denoClient.deploy(deployBody); } finally { denoArmed = null; }
    const done = await waitRevision(rev.id);
    const hosts = done?.status === 'succeeded' ? await hostsOf(rev.id, done) : [];
    const after = await denoObserve();
    const ok = done?.status === 'succeeded' && hosts.includes(C.PAYMENTS_HOST) && !after.failures.length;
    const pinDoc = { purpose: 'Arma2 Torneos payments TEST app on Deno Deploy — public facts only', app: C.APP_SLUG, app_id: after.app?.id ?? null, host: C.PAYMENTS_HOST, public_url: C.PAYMENTS_BASE, webhook_url: C.WEBHOOK_URL,
      revision: rev.id, hosts, seller_id: sellerId, source: { head: b.summary.head, digest: b.summary.digest, files: b.summary.files }, env: describe(env), deployed_at: new Date(deps.now()).toISOString() };
    if (ok) fs.writeFileSync(deps.deployPinFile, `${JSON.stringify(pinDoc, null, 1)}\n`);
    const verdict = ok ? 'PAYMENTS_TEST_APP_DEPLOYED' : 'PAYMENTS_TEST_APP_POSTCHECK_FAILED';
    writeEvidence(`pt-03-deno-app-${stamp()}.json`, { verdict, plan, plan_id: planId, authorization, env_validated_by_real_config: validation, app, revision: done, hosts, after: { app: after.app, apps: after.apps, gateway: after.gateway, failures: after.failures },
      deploy_pin: ok ? pinDoc : null, deno_requests: denoClient.requests, deno_writes: denoClient.writes });
    if (!ok) stop(verdict, { status: done?.status, failure: done?.failure_detail, hosts, failures: after.failures });
    return { verdict };
  }

  /** SANDBOX decision: the current source (remote-test sandbox policy) + the QA organization pin, on the existing TEST app. */
  async function redeploy() {
    const fx = needFixtures();
    const sb = await supabase();
    if (C.paymentLoginState(sb.paymentRoles) !== 'present') stop('PAYMENT_LOGIN_NOT_PRESENT');
    const sf = supabaseFailures(sb, { expectLogin: true });
    if (sf.length) stop('REDEPLOY_PRECONDITIONS_FAILED', { failures: sf });
    const obs = await denoObserve();
    if (obs.failures.length || !obs.app) stop('DENO_OBSERVE_FAILED', { failures: obs.failures, app: !!obs.app });
    if (obs.gateway?.env_names?.some((n) => C.GATEWAY_MUST_NOT_HOLD.some((re) => re.test(n)))) stop('GATEWAY_HOLDS_PAYMENTS_ENV');
    const attestation = await mp.attest();
    if (!attestation.pass) stop('MP_TEST_SELLER_ATTESTATION_FAILED', { attestation });
    const host = sb.pooler.hosts.find((h) => D.POOLER_HOST_PATTERN.test(h)) ?? stop('POOLER_HOST_NOT_SA_EAST_1');
    const pinNeeded = obs.env_shape === 'created';
    const b = bundle();
    const envBody = { env_vars: [{ key: C.QA_ORG_ENV, value: fx.org, secret: false, contexts: 'all' }] };
    const deployBody = { assets: b.assets, labels: { 'custom.git_head': b.summary.head }, production: true, preview: false };
    if (pinNeeded) C.assertDenoWriteBody('app-env', envBody);
    C.assertDenoWriteBody('deploy', deployBody);
    const plan = { step: 'redeploy', app: C.APP_SLUG, app_id: obs.app.id, env_shape_before: obs.env_shape, qa_pin: { name: C.QA_ORG_ENV, organization: fx.org, slug: fx.slug, patch: pinNeeded },
      previous_revision: obs.revisions[0]?.id ?? null, bundle: { head: b.summary.head, digest: b.summary.digest, files: b.summary.files.length }, seller_id: sellerId, gateway_app: 'untouched',
      policy: 'remote-test sandbox: live_mode is reported, not trusted; attested seller + exact provider resources + QA pin + ARS 39.900' };
    const planId = planIdOf(plan);
    say(`\nPLAN ${planId}: redeploy the Deno Deploy app ${C.APP_SLUG} (TEST only; torneos-gateway untouched)\n  ${pinNeeded ? `PATCH app env: + ${C.QA_ORG_ENV}=${fx.org} (public, the QA org ${fx.slug}); nothing else changes` : `QA pin already present (${fx.org}); no env change`}\n  then deploy the current source: ${plan.bundle.files} files, HEAD ${b.summary.head}, digest ${b.summary.digest.slice(0, 16)}… (previous revision ${plan.previous_revision})\n  seller ${sellerId} attested test_user MLA`);
    const authorization = requirePhrase(C.PHRASES.redeploy(planId));
    const again = await denoObserve();
    if (again.failures.length || again.env_shape !== obs.env_shape || (again.revisions[0]?.id ?? null) !== plan.previous_revision) stop('DENO_STATE_CHANGED_SINCE_PLAN');
    // the real config.ts judges the exact env the new revision will run with (values from custody, nothing sent)
    const validation = await deps.validatePaymentsEnv(paymentsEnv({ host, password: dbPassword(), internal: loadInternal(), qaOrg: fx.org }));
    if (validation.deployment !== 'remote-test' || validation.remoteHost !== C.PAYMENTS_HOST || validation.sellerId !== sellerId || !validation.ca || validation.qaOrganizationId !== fx.org) stop('PAYMENTS_ENV_REJECTED_BY_REAL_CONFIG', { validation });
    let patched = null;
    if (pinNeeded) { denoArmed = 'app-env'; try { patched = await denoClient.setQaPin(envBody); } finally { denoArmed = null; } }
    denoArmed = 'deploy'; let rev; try { rev = await denoClient.deploy(deployBody); } finally { denoArmed = null; }
    const done = await waitRevision(rev.id);
    const hosts = done?.status === 'succeeded' ? await hostsOf(rev.id, done) : [];
    const after = await denoObserve();
    const gwAfter = await gatewayLive();
    const ok = done?.status === 'succeeded' && hosts.includes(C.PAYMENTS_HOST) && !after.failures.length && after.env_shape === 'scoped' && gwAfter.pass;
    const previousPin = (() => { try { return JSON.parse(fs.readFileSync(deps.deployPinFile, 'utf8')); } catch { return null; } })();
    const pinDoc = { purpose: 'Arma2 Torneos payments TEST app on Deno Deploy — public facts only', app: C.APP_SLUG, app_id: after.app?.id ?? null, host: C.PAYMENTS_HOST, public_url: C.PAYMENTS_BASE, webhook_url: C.WEBHOOK_URL,
      revision: rev.id, previous_revision: plan.previous_revision, first_revision: previousPin?.first_revision ?? previousPin?.revision ?? null, hosts, seller_id: sellerId, qa_organization: fx.org,
      source: { head: b.summary.head, digest: b.summary.digest, files: b.summary.files }, env: describe(paymentsEnv({ host, password: dbPassword(), internal: loadInternal(), qaOrg: fx.org })), deployed_at: new Date(deps.now()).toISOString() };
    if (ok) fs.writeFileSync(deps.deployPinFile, `${JSON.stringify(pinDoc, null, 1)}\n`);
    const verdict = ok ? 'PAYMENTS_TEST_APP_REDEPLOYED' : 'PAYMENTS_TEST_APP_REDEPLOY_POSTCHECK_FAILED';
    writeEvidence(`pt-03b-redeploy-${stamp()}.json`, { verdict, plan, plan_id: planId, authorization, env_validated_by_real_config: validation, env_patch: pinNeeded ? { names: [C.QA_ORG_ENV], app_after_patch: patched } : null,
      revision: done, hosts, after: { app: after.app, env_shape: after.env_shape, apps: after.apps, gateway: after.gateway, failures: after.failures }, gateway_live: gwAfter, deploy_pin: ok ? pinDoc : null,
      deno_requests: denoClient.requests, deno_writes: denoClient.writes });
    say(`redeploy: ${verdict} revision=${rev.id} env=${after.env_shape}`);
    if (!ok) stop(verdict, { status: done?.status, failure: done?.failure_detail, hosts, env_shape: after.env_shape, failures: after.failures });
    return { verdict };
  }

  const loadInternal = () => { if (!internalHex) internalHex = remember(deps.keychain().internalSecret.read()); return internalHex; };
  async function trailNow() { const o = await supabase(); return { census: o.census, trail: o.trail }; }

  async function appProbe() {
    loadInternal();
    const pin = JSON.parse(fs.readFileSync(deps.deployPinFile, 'utf8'));
    const before = await trailNow();
    const app = appClient();
    const base = new URL(C.PAYMENTS_BASE).pathname;
    const checks = [];
    const add = (name, r, status, error) => { const pass = r.status === status && (error === undefined || r.error === error); checks.push({ name, pass, status: r.status, error: r.error ?? null }); return r; };
    const unknown = crypto.randomUUID();
    add('internal HMAC call for an unknown purchase → 404 purchase_not_found (attestation ok, DB login ok, nothing written)', await app.preference(unknown), 404, 'purchase_not_found');
    const body = JSON.stringify({ purchase_id: unknown });
    const replay = app.internalHeaders(body);
    add('internal, fresh signed request → 404 (reaches the DB)', await app.raw('internal', 'POST', `${base}${C.INTERNAL_PATH}`, { body, headers: replay }), 404, 'purchase_not_found');
    add('internal, the same nonce replayed → 401', await app.raw('internal', 'POST', `${base}${C.INTERNAL_PATH}`, { body, headers: replay }), 401, 'unauthorized');
    add('internal without HMAC headers → 401', await app.raw('internal', 'POST', `${base}${C.INTERNAL_PATH}`, { body }), 401, 'unauthorized');
    add('internal signed with another key → 401', await app.preference(unknown, { secretHex: crypto.randomBytes(32).toString('hex') }), 401, 'unauthorized');
    add('internal with a stale time (−120 s) → 401', await app.preference(unknown, { time: String(Math.floor(deps.now() / 1000) - 120) }), 401, 'unauthorized');
    add('internal with a browser Origin → 403', await app.preference(unknown, { headers: { origin: G.WEB_ORIGIN } }), 403, 'forbidden');
    add('internal with a query → 400', await app.raw('internal', 'POST', `${base}${C.INTERNAL_PATH}?x=1`, { body, headers: app.internalHeaders(body) }), 400, 'invalid_request');
    add('GET / → 404', await app.raw('root', 'GET', '/'), 404, 'not_found');
    add('GET the webhook route → 404', await app.raw('webhook-get', 'GET', `${base}${C.WEBHOOK_PATH}`), 404, 'not_found');
    add('POST unknown path → 404', await app.raw('unknown', 'POST', `${base}/internal/v1/other`, { body: '{}' }), 404, 'not_found');
    const hook = (dataId, type = 'payment') => `${base}${C.WEBHOOK_PATH}?data.id=${dataId}&type=${type}`;
    add('webhook without x-signature → 401', await app.notify('1', { omitSignature: true }), 401, 'invalid_signature');
    add('webhook signed with a wrong secret → 401', await app.notify('1', { secret: crypto.randomBytes(32).toString('hex') }), 401, 'invalid_signature');
    add('webhook with a future ts (+10 min) → 401', await app.notify('1', { ts: String(deps.now() + 600000) }), 401, 'invalid_signature');
    add('webhook with a malformed ts → 401', await app.notify('1', { ts: '17900000.5' }), 401, 'invalid_signature');
    add('webhook with a malformed JSON body → 400', await app.raw('webhook', 'POST', hook('1'), { body: '{nope', headers: { 'content-type': 'application/json' } }), 400, 'invalid_request');
    add('webhook oversized body → 413', await app.raw('webhook', 'POST', hook('1'), { body: 'x'.repeat(40 * 1024), headers: { 'content-type': 'application/json' } }), 413, 'payload_too_large');
    add('webhook live_mode not a boolean ("true") → 400', await app.notify('1', { body: app.notification('1', 'payment', { live_mode: 'true' }) }), 400, 'invalid_notification');
    add('webhook live_mode true, unknown payment → 422 (the body is not authority; the provider lookup decides)', await app.notify('1', { body: app.notification('1', 'payment', { live_mode: true }) }), 422, 'payment_verification_failed');
    add('webhook of another seller → 400', await app.notify('1', { body: app.notification('1', 'payment', { user_id: 1234567 }) }), 400, 'invalid_notification');
    add('webhook unknown topic (merchant_order) → 400', await app.notify('1', { type: 'merchant_order' }), 400, 'invalid_notification');
    add('webhook body data.id ≠ signed data.id → 400', await app.notify('1', { body: app.notification('2') }), 400, 'invalid_notification');
    add('webhook chargeback not of Checkout Pro → 400', await app.notify('1', { type: 'topic_chargebacks_wh', body: { ...app.notification('1', 'topic_chargebacks_wh'), data: { id: '1', checkout: 'API' } } }), 400, 'invalid_notification');
    add('webhook, valid signature, unknown payment (provider 404) → 422', await app.notify('1'), 422, 'payment_verification_failed');
    // Host check: every other hostname the app answers on (revision aliases) is refused by the service itself.
    const alt = (pin.hosts ?? []).filter((h) => h !== C.PAYMENTS_HOST);
    for (const h of alt.slice(0, 3)) {
      const r = await deps.https({ url: `https://${h}${base}${C.INTERNAL_PATH}`, method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      checks.push({ name: `another hostname of the app (${h}) → 403 forbidden`, pass: r.status === 403 && r.json?.error === 'forbidden', status: r.status, error: r.json?.error ?? r.error ?? null });
    }
    const after = await trailNow();
    const unchanged = canon(before) === canon(after);
    checks.push({ name: 'no probe changed the QA trail or the census', pass: unchanged });
    const scan = C.secretFindings(JSON.stringify(app.requests), known);
    checks.push({ name: 'no response or request log carries a secret', pass: scan.length === 0 });
    const pass = checks.every((c) => c.pass);
    state.results.appProbe = { pass, total: checks.length, alternate_hosts: alt.length };
    writeEvidence(`pt-04-app-probe-${stamp()}.json`, { verdict: pass ? 'PAYMENTS_APP_PROBE_PASS' : 'PAYMENTS_APP_PROBE_FAILED', read_only: true, public_url: C.PAYMENTS_BASE, checks, requests: app.requests, census: after.census });
    say(`app-probe: ${checks.filter((c) => c.pass).length}/${checks.length}${checks.filter((c) => !c.pass).map((c) => `\n  FAIL ${c.name} → ${c.status} ${c.error ?? ''}`).join('')}`);
    if (!pass) stop('PAYMENTS_APP_PROBE_FAILED');
    return { verdict: 'PAYMENTS_APP_PROBE_PASS' };
  }

  async function fixtures() {
    const client = mgmt();
    const orgs = (await client.sql(`select coalesce(json_agg(json_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'members', (select count(*) from public.tournament_organization_members m where m.organization_id = o.id),
      'seasons', (select coalesce(json_agg(json_build_object('id', s.id, 'slug', s.slug, 'name', s.name) order by s.slug), '[]'::json) from public.tournament_seasons s where s.organization_id = o.id),
      'tournaments', (select count(*) from public.tournaments t where t.organization_id = o.id)) order by o.created_at), '[]'::json) as trail from public.tournament_organizations o where o.slug like '${C.QA.orgSlugPrefix}%'`))[0]?.trail ?? [];
    const o = await supabase();
    const f = [];
    if (orgs.length !== 1) f.push(`QA_ORGS_${orgs.length}`);
    const org = orgs[0];
    if (org && (!C.QA_SLUG_RE.test(org.slug) || org.name !== C.QA.orgName || Number(org.members) !== 1 || Number(org.tournaments) !== 0)) f.push('QA_ORG_SHAPE');
    const seasonOf = (key) => org?.seasons?.find((s) => s.slug.startsWith(C.QA.seasons.find((x) => x.key === key).slugPrefix)) ?? null;
    const S1 = seasonOf('S1'); const S2 = seasonOf('S2');
    if (!S1 || !S2 || org.seasons.length !== 2) f.push('QA_SEASONS_NOT_S1_S2');
    const purchaseOf = (s) => o.trail.filter((p) => p.season === s?.id);
    const p1 = purchaseOf(S1); const p2 = purchaseOf(S2);
    if (p1.length !== 1 || p2.length !== 1) f.push('QA_PURCHASES_NOT_ONE_PER_SEASON');
    for (const p of [...p1, ...p2]) {
      if (p.provider !== 'MERCADO_PAGO' || p.environment !== 'test' || p.amount !== C.PRODUCT.amount || p.list_amount !== C.PRODUCT.listAmount || p.currency !== 'ARS' || p.product !== C.PRODUCT.code
        || p.external_reference !== `arma2:season:purchase:${p.purchase}`) f.push(`QA_PURCHASE_SHAPE_${p.purchase.slice(0, 8)}`);
    }
    f.push(...C.censusFailures(o.census).map((x) => x.toUpperCase()));
    if (Number(o.census.organizations_qa) !== 1) f.push('CENSUS_QA_ORGS_NOT_1');
    state.fixtures = f.length ? null : { org: org.id, slug: org.slug, S1: S1.id, S2: S2.id, P1: p1[0].purchase, P2: p2[0].purchase };
    const verdict = f.length ? 'QA_FIXTURES_INVALID' : 'QA_FIXTURES_ISOLATED';
    writeEvidence(`pt-05-qa-fixtures-${stamp()}.json`, { verdict, read_only: true, qa: orgs, purchases: o.trail, census: o.census, fixtures: state.fixtures, failures: f,
      isolation: { census_failures: C.censusFailures(o.census), organizations_total: o.census.organizations, organizations_qa: o.census.organizations_qa, seasons_outside_qa: o.census.seasons_outside_qa, tournaments_in_qa: org?.tournaments ?? null } });
    say(`fixtures: ${verdict} ${JSON.stringify(state.fixtures)}${f.length ? `\n  FAIL ${f.join(' ')}` : ''}`);
    if (f.length) stop(verdict, { failures: f });
    return { verdict };
  }
  const needFixtures = () => state.fixtures ?? stop('RUN_FIXTURES_FIRST');

  async function ordering() {
    const fx = needFixtures();
    const before = await trailNow();
    const p2 = before.trail.find((p) => p.purchase === fx.P2);
    if (!p2 || p2.status !== 'created' || p2.preference_id !== null) stop('P2_NOT_CREATED', { status: p2?.status });
    const host = state.poolerHost ?? (await mgmt().pooler()).hosts.find((h) => D.POOLER_HOST_PATTERN.test(h));
    const res = await deps.runPsql({ script: D.orderingScript({ purchaseId: fx.P2 }), env: D.paymentLoginEnv({ host, port: 6543, password: dbPassword() }), redact });
    const ev = D.evaluateOrdering(res.stdout);
    const after = await trailNow();
    const traceless = canon(before) === canon(after);
    const pass = ev.pass && res.code === 0 && traceless;
    state.results.ordering = { pass, cases: ev.cases.length, historical: ev.cases.find((c) => c.label === 'restored-then-old-dispute') };
    writeEvidence(`pt-06-ordering-rollback-${stamp()}.json`, { verdict: pass ? 'REMOTE_ORDERING_PASS' : 'REMOTE_ORDERING_FAILED', purchase: fx.P2, season: fx.S2, port: 6543, psql_exit: res.code, stderr_tail: res.stderr_tail || null,
      whoami: ev.whoami, initial: ev.initial, after_identical_to_initial: ev.after_identical_to_initial, trail_and_census_unchanged: traceless, cases: ev.cases, failures: ev.failures,
      note: 'every permutation ran in its own transaction ending in ROLLBACK; synthetic provider payment ids are 99-prefixed 20-digit values that never reached Mercado Pago' });
    say(`ordering: ${ev.cases.filter((c) => c.pass).length}/${ev.cases.length} traceless=${traceless}${ev.failures.length ? `\n  FAIL ${ev.failures.join(' ')}` : ''}`);
    if (!pass) stop('REMOTE_ORDERING_FAILED');
    return { verdict: 'REMOTE_ORDERING_PASS' };
  }

  async function preference() {
    const fx = needFixtures();
    loadInternal();
    const before = await trailNow();
    const p1 = before.trail.find((p) => p.purchase === fx.P1);
    if (!p1 || p1.status !== 'created') stop('P1_NOT_CREATED', { status: p1?.status });
    const attestation = await mp.attest();
    if (!attestation.pass) stop('MP_TEST_SELLER_ATTESTATION_FAILED');
    const plan = { step: 'preference', purchase: fx.P1, season: fx.S1, org: fx.org, product: C.PRODUCT, provider: 'MERCADO_PAGO', environment: 'test', seller: sellerId, notification_url: C.WEBHOOK_URL, via: C.INTERNAL_URL };
    const planId = planIdOf(plan);
    say(`\nPLAN ${planId}: Mercado Pago TEST Preference for the QA purchase ${fx.P1} (season S1 ${fx.S1})\n  ${C.PRODUCT.title}: 1 × ARS ${C.PRODUCT.amount} (list ${C.PRODUCT.listAmount}), one-time, seller ${sellerId} (test_user), expires in 30 min\n  through the TEST app's internal HMAC route; no payer data, no frontend, no public checkout`);
    const authorization = requirePhrase(C.PHRASES.preference(planId));
    const again = await trailNow();
    if (canon(again) !== canon(before)) stop('DB_STATE_CHANGED_SINCE_PLAN');
    const app = appClient();
    const first = await app.preference(fx.P1);
    if (first.status !== 200 || typeof first.body?.preferenceId !== 'string') stop('PREFERENCE_NOT_CREATED', { status: first.status, error: first.error });
    const pref = await mp.preference(first.body.preferenceId);
    const second = await app.preference(fx.P1);
    const t = (await trailNow()).trail.find((p) => p.purchase === fx.P1);
    const checkout = (() => { try { return new URL(first.body.checkoutUrl); } catch { return null; } })();
    const checks = [
      ['app → 200 preference_created, checkout on a mercadopago.com.ar host', first.status === 200 && !!checkout && /(^|\.)mercadopago\.com\.ar$/.test(checkout.hostname)],
      ['provider: collector = the attested TEST seller', pref?.collector_matches === true],
      ['provider: one item torneos_premium "Arma2 Torneos Premium" × 1, ARS, unit_price 39900', canon(pref?.items) === canon([{ id: C.PRODUCT.code, title: C.PRODUCT.title, quantity: 1, currency_id: 'ARS', unit_price: C.PRODUCT.amount }])],
      ['provider: external_reference = arma2:season:purchase:<P1>', pref?.external_reference === `arma2:season:purchase:${fx.P1}`],
      ['provider: metadata = {purchase_id: P1} only', canon(pref?.metadata_keys) === canon(['purchase_id']) && pref?.metadata_purchase_id === fx.P1],
      ['provider: notification_url = the TEST webhook', pref?.notification_url === C.WEBHOOK_URL],
      ['provider: back_urls on the TEST host, QA org/season/purchase path, auto_return approved', !!pref?.back_urls && Object.values(pref.back_urls).every((u) => String(u).startsWith(`${C.APP_PUBLIC_URL}/torneos/organizacion/${fx.org}/temporada/${fx.S1}/plan/compra/${fx.P1}/`)) && pref.auto_return === 'approved'],
      ['provider: expires (30 min window), one-time (no subscription / no preapproval)', pref?.expires === true && !!pref.expiration_date_to && pref.operation_type !== 'recurring_payment' && pref.purpose !== 'wallet_purchase'],
      ['provider: no payer / PII set', canon(pref?.payer_fields_set ?? ['?']) === '[]'],
      ['reuse → 200 preference_reused, same preference id', second.status === 200 && second.body?.preferenceId === first.body.preferenceId],
      ['DB: preference_created with that id, still unpaid', t?.status === 'preference_created' && t?.preference_id === first.body.preferenceId && t?.grants?.length === 0],
    ].map(([name, pass]) => ({ name, pass: !!pass }));
    const pass = checks.every((c) => c.pass);
    state.preference = { id: first.body.preferenceId, checkoutUrl: first.body.checkoutUrl, expiresAt: first.body.expiresAt };
    writeEvidence(`pt-07-preference-${stamp()}.json`, { verdict: pass ? 'MP_TEST_PREFERENCE_PASS' : 'MP_TEST_PREFERENCE_FAILED', plan, plan_id: planId, authorization, app_first: { status: first.status, outcome: 'preference_created', preferenceId: first.body.preferenceId, expiresAt: first.body.expiresAt, checkout_host: checkout?.hostname ?? null },
      app_reuse: { status: second.status, preferenceId: second.body?.preferenceId ?? null }, provider_preference: pref, db: t, checks, mp_requests: mp.requests, mp_writes: mp.writes });
    say(`preference: ${checks.filter((c) => c.pass).length}/${checks.length}\n  CHECKOUT_URL ${first.body.checkoutUrl}\n  expires ${first.body.expiresAt}${checks.filter((c) => !c.pass).map((c) => `\n  FAIL ${c.name}`).join('')}`);
    if (!pass) stop('MP_TEST_PREFERENCE_FAILED');
    return { verdict: 'MP_TEST_PREFERENCE_PASS' };
  }

  async function observe() {
    const fx = needFixtures();
    const payments = await mp.paymentsFor(fx.P1);
    const t = (await trailNow()).trail.find((p) => p.purchase === fx.P1);
    let logs = null;
    try { logs = await denoClient.logs(new Date(deps.now() - 6 * 3600000).toISOString(), new Date(deps.now()).toISOString()); } catch (e) { logs = { unavailable: e.code ?? String(e.message).slice(0, 80) }; }
    const approved = payments.find((p) => p.status === 'approved' || p.status === 'refunded') ?? null;
    const rejected = payments.filter((p) => p.status === 'rejected');
    const checks = [
      ['Mercado Pago TEST: ≥ 1 rejected attempt on the preference', rejected.length >= 1],
      ['Mercado Pago TEST: one approved payment, ARS 39900, our attested TEST seller, external_reference = P1 (live_mode reported, not trusted)', !!approved && approved.transaction_amount === C.PRODUCT.amount && approved.currency_id === 'ARS' && typeof approved.live_mode === 'boolean' && approved.collector_matches && approved.external_reference === `arma2:season:purchase:${fx.P1}` && approved.metadata_purchase_id === fx.P1],
      ['DB: purchase approved with that payment id', t?.status === 'approved' && t?.approved_payment === approved?.id],
      ['DB: a payment.attempt_rejected event (purchase stayed payable)', !!t?.events?.some((e) => e.type === 'payment.attempt_rejected')],
      ['DB: exactly one Premium season grant from P1, effective, events [granted]', t?.grants?.length === 1 && t.grants[0].effective === true && canon(t.grants[0].events.map((e) => e.type)) === canon(['granted'])],
      ['DB: one watermark per provider payment (rejected + approved), no manual flags', (t?.watermarks?.length ?? 0) === payments.length && t.watermarks.every((w) => !w.manual_refund && !w.manual_review)],
      ['the signed Mercado Pago webhook reached the TEST app: provider-actor payment.approved event', (t?.events ?? []).filter((e) => e.actor === 'provider').map((e) => e.type).includes('payment.approved')],
    ].map(([name, pass]) => ({ name, pass: !!pass }));
    const pass = checks.every((c) => c.pass);
    state.approved = approved ? { id: approved.id, date_last_updated: approved.date_last_updated } : null;
    // the relations the sandbox policy binds (booleans only), for every provider payment of P1
    const prefId = state.preference?.id ?? t?.preference_id ?? null;
    const relations = [];
    for (const p of prefId ? payments : []) { try { relations.push(await mp.sandboxRelation(p.id, prefId)); } catch (e) { relations.push({ payment: p.id, error: e.code ?? 'READ_FAILED' }); } }
    const webhookLog = Array.isArray(logs) ? logs.filter((l) => /torneos-payments/.test(l.message) && /"route":"webhook"/.test(l.message)).map((l) => {
      let j = null; try { j = JSON.parse(l.message); } catch { j = null; } return { at: l.timestamp, revision: l.revision_id, status: j?.status ?? null, code: j?.code ?? null }; }) : null;
    writeEvidence(`pt-08-sandbox-checkout-${stamp()}.json`, { verdict: pass ? 'SANDBOX_CHECKOUT_APPLIED' : 'SANDBOX_CHECKOUT_INCOMPLETE', read_only: true, purchase: fx.P1, preference: state.preference?.id ?? t?.preference_id ?? null,
      provider_payments: payments, sandbox_relations: relations, db: t, webhook_deliveries: webhookLog, logs_api: Array.isArray(logs) ? logs.shape ?? null : logs, app_logs: Array.isArray(logs) ? logs.filter((l) => /torneos-payments/.test(l.message)).slice(-60) : logs, checks, mp_requests: mp.requests });
    say(`observe: ${checks.filter((c) => c.pass).length}/${checks.length} payments=${JSON.stringify(payments.map((p) => [p.id, p.status, p.status_detail]))} db=${t?.status}${checks.filter((c) => !c.pass).map((c) => `\n  FAIL ${c.name}`).join('')}`);
    return { verdict: pass ? 'SANDBOX_CHECKOUT_APPLIED' : 'SANDBOX_CHECKOUT_INCOMPLETE' };
  }

  async function replays() {
    const fx = needFixtures();
    const pay = state.approved?.id ?? stop('RUN_OBSERVE_FIRST');
    loadInternal();
    const before = await trailNow();
    const app = appClient();
    const checks = [];
    const add = (name, r, status, outcome, error) => { checks.push({ name, pass: r.status === status && (outcome === undefined || r.body?.outcome === outcome) && (error === undefined || r.error === error), status: r.status, outcome: r.body?.outcome ?? null, error: r.error ?? null }); };
    add('duplicate of the real approved payment (13-digit ts) → 200 provider_snapshot_duplicate', await app.notify(pay), 200, 'provider_snapshot_duplicate');
    add('replay with a 10-digit ts → 200 provider_snapshot_duplicate', await app.notify(pay, { ts: String(Math.floor(deps.now() / 1000)) }), 200, 'provider_snapshot_duplicate');
    add('old authentic notification (ts −3 days) → re-fetched, duplicate (ts never orders)', await app.notify(pay, { ts: String(deps.now() - 3 * 86400000) }), 200, 'provider_snapshot_duplicate');
    add('same request id + signature replayed → still a duplicate, nothing new', await (async () => { const rid = crypto.randomUUID(); const ts = String(deps.now()); await app.notify(pay, { ts, requestId: rid }); return app.notify(pay, { ts, requestId: rid }); })(), 200, 'provider_snapshot_duplicate');
    add('real payment id, wrong secret → 401', await app.notify(pay, { secret: crypto.randomBytes(32).toString('hex') }), 401, undefined, 'invalid_signature');
    add('real payment id, notification of another seller → 400', await app.notify(pay, { body: app.notification(pay, 'payment', { user_id: 1234567 }) }), 400, undefined, 'invalid_notification');
    add('real payment id, live_mode not a boolean ("true") → 400', await app.notify(pay, { body: app.notification(pay, 'payment', { live_mode: 'true' }) }), 400, undefined, 'invalid_notification');
    add('real payment id, body live_mode true (as sandbox sends) → re-fetched, duplicate', await app.notify(pay, { body: app.notification(pay, 'payment', { live_mode: true }) }), 200, 'provider_snapshot_duplicate');
    add('real payment id, body live_mode false (a lie) → re-fetched, duplicate: the body is never authority', await app.notify(pay, { body: app.notification(pay, 'payment', { live_mode: false }) }), 200, 'provider_snapshot_duplicate');
    const after = await trailNow();
    const t0 = before.trail.find((p) => p.purchase === fx.P1); const t1 = after.trail.find((p) => p.purchase === fx.P1);
    checks.push({ name: 'no replay changed the purchase, its events, grants or watermarks', pass: canon(t0) === canon(t1) });
    const pass = checks.every((c) => c.pass);
    state.results.replays = { pass, total: checks.length };
    writeEvidence(`pt-09-replays-${stamp()}.json`, { verdict: pass ? 'REAL_PAYMENT_REPLAYS_PASS' : 'REAL_PAYMENT_REPLAYS_FAILED', payment: pay, purchase: fx.P1, checks, requests: app.requests });
    say(`replays: ${checks.filter((c) => c.pass).length}/${checks.length}${checks.filter((c) => !c.pass).map((c) => `\n  FAIL ${c.name} → ${c.status} ${c.outcome ?? ''} ${c.error ?? ''}`).join('')}`);
    if (!pass) stop('REAL_PAYMENT_REPLAYS_FAILED');
    return { verdict: 'REAL_PAYMENT_REPLAYS_PASS' };
  }

  async function refund() {
    const fx = needFixtures();
    const pay = state.approved?.id ?? stop('RUN_OBSERVE_FIRST');
    const p = await mp.payment(pay);
    if (!p || p.status !== 'approved' || typeof p.live_mode !== 'boolean' || !p.collector_matches || p.transaction_amount !== C.PRODUCT.amount || p.external_reference !== `arma2:season:purchase:${fx.P1}`) stop('PAYMENT_NOT_REFUNDABLE_TEST', { payment: p });
    const t0 = (await trailNow()).trail.find((x) => x.purchase === fx.P1);
    if (t0?.status !== 'approved') stop('PURCHASE_NOT_APPROVED');
    const plan = { step: 'refund', payment: pay, amount: p.transaction_amount, currency: p.currency_id, live_mode: p.live_mode, seller: sellerId, purchase: fx.P1, kind: 'full refund, Mercado Pago TEST sandbox' };
    const planId = planIdOf(plan);
    say(`\nPLAN ${planId}: full refund of the Mercado Pago TEST payment ${pay} (ARS ${p.transaction_amount}, sandbox live_mode=${p.live_mode}, seller ${sellerId} attested test_user)\n  then wait for the signed webhook: purchase → refunded, Premium grant → revoked`);
    const authorization = requirePhrase(C.PHRASES.refund(planId));
    const again = await mp.payment(pay);
    if (again?.status !== 'approved') stop('PAYMENT_CHANGED_SINCE_PLAN');
    mpArmed = `refund:${pay}`; let rf; try { rf = await mp.refund(pay, crypto.randomUUID()); } finally { mpArmed = null; }
    let t = null; const started = deps.now();
    while (deps.now() - started < (deps.webhookWaitMs ?? 8 * 60000)) {
      t = (await trailNow()).trail.find((x) => x.purchase === fx.P1);
      if (t?.status === 'refunded') break;
      await deps.sleep(deps.pollMs ?? 10000);
    }
    const after = await mp.payment(pay);
    const checks = [
      ['Mercado Pago TEST refund created (full amount)', !!rf?.refund_id && Number(rf.amount) === C.PRODUCT.amount],
      ['provider payment now refunded', after?.status === 'refunded'],
      ['signed webhook applied: purchase refunded', t?.status === 'refunded' && !!t.refunded_at],
      ['Premium grant revoked, not effective', t?.grants?.length === 1 && t.grants[0].effective === false && t.grants[0].events.at(-1)?.type === 'revoked'],
      ['watermark advanced (refunded snapshot), no manual refund flag', !!t?.watermarks?.some((w) => w.payment === pay && canon(w.state) === canon(['reversal', 'refund']) && !w.manual_refund)],
    ].map(([name, pass]) => ({ name, pass: !!pass }));
    // stale approved after refund, through the real app: the provider serves the current (refunded) snapshot → duplicate.
    loadInternal();
    const app = appClient();
    const late = await app.notify(pay, { ts: String(deps.now() - 86400000) });
    checks.push({ name: 'late old notification after the refund → duplicate of the refunded snapshot; revoked never revives', pass: late.status === 200 && ['provider_snapshot_duplicate', 'stale_ignored'].includes(late.body?.outcome) });
    const t2 = (await trailNow()).trail.find((x) => x.purchase === fx.P1);
    checks.push({ name: 'purchase still refunded, grant still revoked', pass: t2?.status === 'refunded' && t2.grants[0]?.effective === false });
    const pass = checks.every((c) => c.pass);
    state.refunded = pass ? { refund_id: rf?.refund_id ?? null } : null;
    writeEvidence(`pt-10-refund-${stamp()}.json`, { verdict: pass ? 'REFUND_LIFECYCLE_PASS' : 'REFUND_LIFECYCLE_FAILED', plan, plan_id: planId, authorization, refund: rf, provider_after: after, db: t2, late_notification: { status: late.status, outcome: late.body?.outcome ?? null }, checks, mp_requests: mp.requests, mp_writes: mp.writes });
    say(`refund: ${checks.filter((c) => c.pass).length}/${checks.length}${checks.filter((c) => !c.pass).map((c) => `\n  FAIL ${c.name}`).join('')}`);
    if (!pass) stop('REFUND_LIFECYCLE_FAILED');
    return { verdict: 'REFUND_LIFECYCLE_PASS' };
  }

  async function certify() {
    const fx = needFixtures();
    const sb = await supabase({ deep: true });
    const f = supabaseFailures(sb, { expectLogin: true });
    const host = sb.pooler.hosts.find((h) => D.POOLER_HOST_PATTERN.test(h));
    const probe = await loginProbe(host, dbPassword());
    if (!probe.every((p) => p.pass)) f.push('PAYMENT_LOGIN_PROBE_FAILED');
    const dn = await denoObserve();
    f.push(...dn.failures);
    if (!dn.app) f.push('PAYMENTS_APP_ABSENT');
    if (dn.env_shape !== 'scoped') f.push('PAYMENTS_APP_QA_PIN_ABSENT');
    const gw = await gatewayLive();
    if (!gw.pass) f.push('GATEWAY_LIVE_CHECK_FAILED');
    const attestation = await mp.attest();
    if (!attestation.pass) f.push('MP_TEST_SELLER_ATTESTATION_FAILED');
    const t = sb.trail.find((p) => p.purchase === fx.P1); const t2 = sb.trail.find((p) => p.purchase === fx.P2);
    if (t?.status !== 'refunded' || t.grants?.length !== 1 || t.grants[0].effective !== false) f.push('P1_LIFECYCLE_NOT_COMPLETE');
    if (t2?.status !== 'created' || t2.events.length !== 1 || t2.grants.length || t2.watermarks.length) f.push('P2_NOT_TRACELESS');
    if (Number(sb.census.organizations_qa) !== 1 || Number(sb.census.season_grants) !== 1 || Number(sb.census.purchases) !== 2) f.push('CENSUS_NOT_EXACTLY_THE_QA_SET');
    const required = ['pt-01-preflight', 'pt-02-payments-login', 'pt-03-deno-app', 'pt-03b-redeploy', 'pt-04-app-probe', 'pt-05-qa-fixtures', 'pt-06-ordering-rollback', 'pt-07-preference', 'pt-08-sandbox-checkout', 'pt-09-replays', 'pt-10-refund'];
    const files = fs.readdirSync(deps.evidenceDir).filter((n) => n.startsWith('pt-') && n.endsWith('.json')).sort();
    const bound = required.map((prefix) => {
      const name = files.filter((n) => n.startsWith(`${prefix}-`)).at(-1) ?? null;
      if (!name) return { step: prefix, file: null, verdict: null };
      const text = fs.readFileSync(path.join(deps.evidenceDir, name), 'utf8');
      return { step: prefix, file: name, sha256: C.sha256(text), verdict: JSON.parse(text).verdict ?? null, secret_findings: C.secretFindings(text, known).length };
    });
    const passVerdicts = { 'pt-01-preflight': 'PAYMENTS_PREFLIGHT_PASS', 'pt-02-payments-login': 'PAYMENTS_LOGIN_CREATED', 'pt-03-deno-app': 'PAYMENTS_TEST_APP_DEPLOYED', 'pt-03b-redeploy': 'PAYMENTS_TEST_APP_REDEPLOYED', 'pt-04-app-probe': 'PAYMENTS_APP_PROBE_PASS',
      'pt-05-qa-fixtures': 'QA_FIXTURES_ISOLATED', 'pt-06-ordering-rollback': 'REMOTE_ORDERING_PASS', 'pt-07-preference': 'MP_TEST_PREFERENCE_PASS', 'pt-08-sandbox-checkout': 'SANDBOX_CHECKOUT_APPLIED',
      'pt-09-replays': 'REAL_PAYMENT_REPLAYS_PASS', 'pt-10-refund': 'REFUND_LIFECYCLE_PASS' };
    for (const b of bound) if (b.verdict !== passVerdicts[b.step] || b.secret_findings) f.push(`EVIDENCE_${b.step}_${b.verdict ?? 'MISSING'}`);
    const scan = deps.secretScan ? deps.secretScan(known) : { findings: 0 };
    if (scan.findings) f.push('REPO_SECRET_SCAN_FINDINGS');
    const verdict = f.length ? 'PAYMENTS_REMOTE_TEST_NOT_CERTIFIED' : 'PAYMENTS_REMOTE_TEST_CERTIFIED';
    writeEvidence(`pt-11-certify-${stamp()}.json`, { verdict, read_only: true, failures: f, core: sb.core, torneos: { functions: sb.functions, health: sb.health, secret_names: sb.secrets, auth: sb.auth, b03: G.b03State(sb.tpa, pins().jwks),
      foundation_diff: foundationDiff(sb.catalog, pins().foundation), payments_delta_pin_sha256: C.sha256(fs.readFileSync(deps.deltaPinFile ?? C.DELTA_PIN_FILE)), payment_roles: sb.paymentRoles, gateway_roles: sb.gatewayRoles, census: sb.census },
    payments_login_probe: probe, deno: { apps: dn.apps, gateway_app: dn.gateway, payments_app: dn.app, revisions: dn.revisions }, gateway_live: gw, mercado_pago: { seller_id: sellerId, attestation },
    qa: { fixtures: fx, P1: t, P2: t2 }, evidence: bound, repo_secret_scan: scan, management_api_writes: sb.writes });
    say(`certify: ${verdict}${f.length ? `\n  FAIL ${f.join(' ')}` : ''}`);
    if (f.length) stop(verdict, { failures: f });
    return { verdict };
  }

  return {
    known, state, sellerId,
    async run(line) {
      const [cmd, ...rest] = line.trim().split(/\s+/);
      if (rest.length) stop('COMMAND_REFUSED');
      const table = { preflight, pb, create, redeploy, 'app-probe': appProbe, fixtures, ordering, preference, observe, replays, refund, certify,
        status: async () => { say(JSON.stringify({ fixtures: state.fixtures, preference: state.preference, approved: state.approved, refunded: state.refunded, evidence: state.evidence })); return { verdict: 'STATUS' }; } };
      if (!table[cmd]) stop('COMMAND_UNKNOWN', { cmd });
      return table[cmd]();
    },
    wipe() { known.splice(0); internalHex = null; },
  };
}

/** git grep of the tracked tree + the evidence dir for every value the session holds (exact) and the secret shapes. */
export function repoSecretScan(known, { repoRoot = C.REPO_ROOT } = {}) {
  const files = spawnSync('git', ['-C', repoRoot, 'ls-files', '-co', '--exclude-standard', 'backend/torneos', 'integration/torneos-core-contracts'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\n').filter(Boolean);
  let findings = 0; const where = [];
  for (const rel of files) {
    let text; try { const st = fs.statSync(path.join(repoRoot, rel)); if (!st.isFile() || st.size > 8 * 1024 * 1024) continue; text = fs.readFileSync(path.join(repoRoot, rel), 'utf8'); } catch { continue; }
    if (known.some((k) => k && k.length >= 8 && text.includes(k))) { findings += 1; where.push(rel); }
  }
  return { files_scanned: files.length, findings, where };
}

async function main() {
  const dir = assertSessionDir(process.env.ARMA2_SESSION_DIR);
  const fifo = path.join(dir, 'ctl');
  if (!fs.existsSync(fifo)) { const r = spawnSync('/usr/bin/mkfifo', ['-m', '600', fifo]); if (r.status !== 0) throw new Error('mkfifo failed'); }
  if (!fs.lstatSync(fifo).isFIFO()) throw new Error('ctl is not a FIFO');
  const transcript = path.join(dir, 'transcript.log');
  const stdin = await new Promise((resolve) => { const c = []; process.stdin.on('data', (x) => c.push(x)); process.stdin.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
  let request; try { request = JSON.parse(stdin); } catch { process.stderr.write('SESSION_STDIN_NOT_JSON\n'); process.exit(2); }
  if (Object.keys(request).sort().join(',') !== 'deno,mpSecret,mpToken,pat') { process.stderr.write('SESSION_STDIN_SHAPE\n'); process.exit(2); }
  const readLine = fifoLineReader(fifo);
  const say = (s) => { process.stdout.write(`${s}\n`); fs.appendFileSync(transcript, `${s}\n`, { mode: 0o600 }); };
  const { applySql } = await import('../torneos-gateway-auth/psql-gateway-auth.mjs');
  const { assertPsqlPrerequisites } = await import('../torneos-gateway-auth/psql-gateway-auth.mjs');
  let session;
  try {
    session = makeSession({ pat: request.pat, deno: request.deno, mpToken: request.mpToken, mpSecret: request.mpSecret, deps: {
      say, readLine, transport: httpsTransport, denoTransport: denoHttpsTransport, mpTransport: mpHttpsTransport, appTransport: appHttpsTransport, https: gatewayHttps,
      keychain: () => systemKeychain(), applySql, runPsql: D.runPsqlProbe, psqlPrerequisites: () => assertPsqlPrerequisites(), tlsProbe: probeTls, readCaPem: () => readCaPem(),
      validatePaymentsEnv: validatePaymentsEnvWithRealConfig, buildAssets: () => buildPaymentsAssets(), secretScan: (k) => repoSecretScan(k),
      now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), evidenceDir: path.join(C.EVIDENCE_DIR, 'remote'), deployPinFile: DEPLOY_PIN_FILE, deltaPinFile: C.DELTA_PIN_FILE,
    } });
  } catch (e) { request = null; say(`STOP ${e?.code ?? 'ERROR'}`); process.exit(1); }
  request.pat = ''; request.deno = ''; request.mpToken = ''; request.mpSecret = ''; request = null;
  say(`SESSION READY ${new Date().toISOString()} seller=${session.sellerId} — commands on ${fifo}`);
  for (;;) {
    const line = readLine();
    if (line === 'quit') break;
    say(`\n> ${line}`);
    try { const r = await session.run(line); say(`OK ${r?.verdict ?? ''}`); } catch (e) {
      const detail = e?.detail ? JSON.stringify(e.detail).slice(0, 2000) : String(e?.message ?? e).slice(0, 400);
      say(`STOP ${e?.code ?? 'ERROR'} ${C.secretFindings(detail, session.known).length ? '(detail withheld: secret-shaped)' : detail}`);
    }
  }
  session.wipe();
  say('SESSION CLOSED — in-memory secrets wiped');
  process.exit(0);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
