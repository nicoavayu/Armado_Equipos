// COMPETITION-V1 REMOTE — G1 (read-only), W1 (DB), W2 (gateway) and both rollbacks, with every dependency injected
// (psql, Keychain, Deno transport, gateway transport, clock, operator line reader) so that the offline tests and the
// offline rehearsal drive exactly this code. Fail closed: every write re-observes the state it was planned on, needs
// the exact phrase of its plan id, is sent once (no retry), and is followed by a read-only postcheck; evidence files
// are secret-scanned against every value the process holds.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as C from './competition-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as P from '../torneos-payments-test/payments-test-contract.mjs';
import { foundationDiff } from '../torneos-gateway-auth/gateway-auth.mjs';
import * as R from '../torneos-gateway-remote/remote-contract.mjs';
import { probeGateway } from '../torneos-gateway-remote/gateway-probe.mjs';
import { mintBridgeToken } from '../torneos-gateway-auth/bridge-probe.mjs';
import { POOLER_HOST_PATTERN, CA_CERT } from '../torneos-gateway-auth/psql-gateway-auth.mjs';

export class Stop extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }
const stop = (code, detail) => { throw new Stop(code, detail); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** Minimal child environment for psql as the installer over the Session Pooler (never the operator's PG* variables). */
export function installerEnv({ password, app }) {
  if (!POOLER_HOST_PATTERN.test(C.POOLER_HOST)) throw new Error('pooler_host_not_sa_east_1');
  return { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C', PGHOST: C.POOLER_HOST, PGPORT: String(C.POOLER_PORT), PGUSER: `${C.INSTALLER}.${C.TORNEOS_REF}`,
    PGDATABASE: 'postgres', PGSSLMODE: 'verify-full', PGSSLROOTCERT: CA_CERT, PGCONNECT_TIMEOUT: '20', PGAPPNAME: app, PGPASSWORD: password };
}
/** Read-only runs additionally carry default_transaction_read_only=on (the server refuses any write). */
export const readOnlyEnv = ({ password }) => ({ ...installerEnv({ password, app: 'arma2-torneos-competition-v1-readonly' }), PGOPTIONS: '-c default_transaction_read_only=on' });

/** Last JSON line of a psql -At run. */
function lastJson(stdout) {
  const line = String(stdout ?? '').trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch { return null; }
}

export function makeRemote(deps) {
  const known = [];
  const remember = (v) => { if (typeof v === 'string' && v.length >= 8 && !known.includes(v)) known.push(v); return v; };
  const redact = (t) => { let s = String(t); for (const k of known) if (k && k.length >= 8) s = s.split(k).join('«REDACTED»'); return s; };
  const say = (s) => deps.say(redact(s));
  const stamp = () => stampOf(deps.now());
  const denoToken = deps.denoToken ? remember(deps.denoToken) : null;
  if (denoToken !== null && !R.DENO_TOKEN_PATTERN.test(denoToken)) stop('DENO_TOKEN_MALFORMED');
  let armed = null;
  const denoLog = [];
  const deployPin = () => deps.deployPin ?? C.readCurrentDeployPin();

  // ── evidence ──
  let seq = 0;
  function writeEvidence(base, body) {
    const name = base.replace(/^cv1-/, `cv1-${String(++seq).padStart(2, '0')}-`);
    const text = `${JSON.stringify({ tool: 'backend/torneos/infra/torneos-competition-v1', target: C.TORNEOS_REF, ...body }, null, 1)}\n`;
    const leaks = G.secretFindings(text, known);
    if (leaks.length) stop('EVIDENCE_REJECTED_SECRET_LEAK', { name, findings: leaks });
    fs.mkdirSync(deps.evidenceDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(deps.evidenceDir, name), text, { mode: 0o600, flag: 'wx' });
    const digest = C.sha256(text);
    say(`EVIDENCE ${name} ${digest}`);
    return digest;
  }
  const requirePhrase = (expected) => {
    say(`\nTo proceed the operator must send exactly:\n  ${expected}`);
    const got = deps.readLine();
    if (got !== expected) stop('NOT_AUTHORIZED', { expected_phrase: expected });
    say('phrase accepted');
    return { phrase: expected, channel: deps.phraseChannel ?? 'session FIFO (operator)' };
  };

  // ── database (read-only) ──
  let password = null;
  const installerPassword = () => password ?? (password = remember(deps.keychain.installerPassword()));
  async function query(select) {
    const r = await deps.psql({ script: C.readOnlyScript(select), env: readOnlyEnv({ password: installerPassword() }), redact });
    if (r.code !== 0) stop('DB_READ_FAILED', { code: r.code, stderr: r.stderr_tail });
    const j = lastJson(r.stdout);
    if (!j) stop('DB_READ_UNPARSABLE');
    return j;
  }
  async function dbObserve() {
    const state = await query(C.STATE_SQL);
    const cls = C.classifyState(state);
    const catalog = await query(G.CATALOG_SQL);
    const gatewayRoles = await query(G.GATEWAY_ROLES_SQL);
    const paymentRoles = await query(P.PAYMENT_ROLES_SQL);
    const pins = { foundation: JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8')), payments: P.readDeltaPin(deps.paymentsDeltaPinFile ?? P.DELTA_PIN_FILE), cv1: C.readJson(deps.deltaPinFile ?? C.DELTA_PIN_FILE) };
    const failures = [...cls.failures];
    if (!pins.payments) failures.push('PAYMENTS_DELTA_PIN_MISSING');
    if (!pins.cv1) failures.push('CV1_DELTA_PIN_MISSING');
    // (a) every strict path of the certified foundation pin except the three W1 moves.
    const moved = new Set(C.CV1_CATALOG_PATHS);
    const fd = foundationDiff(catalog, pins.foundation).map((d) => d.path).filter((p) => !moved.has(p));
    if (fd.length) failures.push(`FOUNDATION_DRIFT ${fd.join(',')}`);
    // (b) gateway-auth + payments-test deltas exactly as certified (logins, memberships, pre-request).
    if (pins.payments) {
      if (canon(G.DELTA_PATHS.map((k) => G.getPath(catalog, k))) !== canon(G.DELTA_PATHS.map((k) => G.getPath(pins.payments.catalog, k)))) failures.push('DELTA_PATHS_DRIFT');
      if (canon({ logins: gatewayRoles.logins, memberships: gatewayRoles.memberships, payment_logins: gatewayRoles.payment_logins }) !== canon(pins.payments.gateway_roles)) failures.push('GATEWAY_ROLES_DRIFT');
      if (canon(paymentRoles) !== canon(pins.payments.payment_roles)) failures.push('PAYMENT_ROLES_DRIFT');
    }
    // (c) the three moved paths equal the pin of the classified state.
    const stateKey = { PRE_0004: 'pre', POST_0004: 'post', ROLLED_BACK: 'rolled_back' }[cls.state];
    if (pins.cv1 && stateKey) {
      for (const p of C.CV1_CATALOG_PATHS) if (canon(G.getPath(catalog, p)) !== canon(pins.cv1.states[stateKey][p])) failures.push(`CV1_PATH_DRIFT ${p}`);
    }
    if (state.ledger !== false) failures.push('MIGRATIONS_LEDGER_PRESENT');
    if (!/^17\./.test(String(state.server_version))) failures.push('SERVER_VERSION_NOT_17');
    // Informational for the public route: the anon statement timeout bounds one anonymous call on the database.
    const anonTimeout = (state.role_settings?.anon ?? []).find((c) => c.startsWith('statement_timeout=')) ?? null;
    return { state: cls.state, failures, anon_statement_timeout: anonTimeout, contract_state: state, catalog_summary: { execute: catalog.execute, functions: catalog.functions, acl_md5: catalog.acl_md5, tables: catalog.tables, policies: catalog.policies },
      gateway_roles: gatewayRoles, payment_roles: paymentRoles, pins: { foundation_sha256: C.sha256(canon(pins.foundation)), payments_sha256: pins.payments ? C.sha256(canon(pins.payments)) : null, cv1_sha256: pins.cv1 ? C.sha256(canon(pins.cv1)) : null } };
  }

  // ── Deno Deploy (reads + armed deploys; allowlist of gateway-remote) ──
  async function deno(method, p, body) {
    if (!denoToken) stop('DENO_TOKEN_REQUIRED');
    const cls = R.classifyDenoRequest({ method, path: p, body }, { armedFor: armed });
    let res;
    try { res = await deps.denoTransport({ token: denoToken, method, path: p, body }); } catch (e) { stop('DENO_TRANSPORT_FAILED', { id: cls.id, error: String(e.message).slice(0, 120) }); }
    denoLog.push({ id: cls.id, kind: cls.kind, method, status: res.status });
    if (res.status === 401) stop('DENO_TOKEN_REJECTED', { id: cls.id });
    if (res.status === 403) stop('DENO_TOKEN_PERMISSION_DENIED', { id: cls.id });
    if (![200, 201, 202].includes(res.status)) stop('DENO_API_STATUS_UNEXPECTED', { id: cls.id, status: res.status });
    return res.body;
  }
  const list = (b) => (Array.isArray(b) ? b : Array.isArray(b?.items) ? b.items : Array.isArray(b?.data) ? b.data : []);
  const revisionView = (r) => ({ id: r?.id ?? null, status: r?.status ?? null, labels: r?.labels ?? null, created_at: r?.created_at ?? null,
    env: Array.isArray(r?.env_vars) ? r.env_vars.map((e) => ({ key: e.key, secret: e.secret })) : null, failure: r?.failure_detail ? { stage: r.failure_detail.stage ?? null, code: r.failure_detail.code ?? null } : null });
  /** Non-secret values are compared by digest with the deploy pin; secret values are never returned nor read. */
  function envView(envVars) {
    const pin = deployPin().env;
    return (envVars ?? []).map((e) => {
      const p = pin.find((x) => x.key === e.key);
      const v = { key: e.key, secret: e.secret ?? null, contexts: e.contexts ?? null };
      if (!e.secret && typeof e.value === 'string') { v.sha256_16 = C.sha256(e.value).slice(0, 16); v.matches_pin = !!p && p.sha256_16 === v.sha256_16; }
      if (e.secret) v.value_returned = typeof e.value === 'string' && e.value.length > 0 && !/^\*+$/.test(e.value);
      return v;
    }).sort((a, b) => a.key.localeCompare(b.key));
  }
  async function denoObserve() {
    const app = await deno('GET', `/v2/apps/${C.APP_SLUG}`);
    const revs = list(await deno('GET', `/v2/apps/${C.APP_SLUG}/revisions?limit=20`)).map(revisionView);
    const env = envView(app?.env_vars);
    const failures = [];
    const pin = deployPin();
    if (app?.id !== pin.app_id || app?.slug !== C.APP_SLUG) failures.push('APP_IDENTITY');
    if (Array.isArray(app?.layers) && app.layers.length) failures.push('APP_LAYERS_PRESENT');
    if (canon(env.map((e) => ({ key: e.key, secret: e.secret }))) !== canon(pin.env.map((e) => ({ key: e.key, secret: e.secret })))) failures.push('ENV_SHAPE_DRIFT');
    if (env.some((e) => e.matches_pin === false)) failures.push('ENV_NON_SECRET_VALUE_DRIFT');
    if (env.some((e) => e.value_returned === true)) failures.push('ENV_SECRET_VALUE_RETURNED');
    const bad = R.forbiddenEnvNames(env.map((e) => e.key));
    if (bad.length) failures.push(`ENV_FORBIDDEN ${bad.join(',')}`);
    if (env.some((e) => e.contexts !== null && e.contexts !== 'all')) failures.push('ENV_CONTEXTS');
    const current = revs[0] ?? null;
    if (!current || current.status !== 'succeeded') failures.push('CURRENT_REVISION_NOT_SUCCEEDED');
    return { app: { id: app?.id ?? null, slug: app?.slug ?? null, layers: app?.layers ?? null, config: app?.config ?? null }, env, current, revisions: revs.slice(0, 5), failures };
  }
  /**
   * G1 only (read-only): the organization and the app against the last certification (C.DENO_CERTIFIED). Organization =
   * the token sees exactly the pinned apps and no shared layer, and the live revision is served on the pinned
   * production domain. Configuration = config, labels, created/updated timestamps and the revision set are unchanged.
   * Runtime: Deno Deploy exposes no Deno version per revision; the field names are recorded so its absence is evidence.
   */
  async function denoAudit(observed) {
    const cert = deps.denoCertified ?? C.DENO_CERTIFIED;
    const apps = list(await deno('GET', '/v2/apps?limit=100')).map((a) => a?.slug ?? null).sort();
    const layers = list(await deno('GET', '/v2/layers')).length;
    const app = await deno('GET', `/v2/apps/${C.APP_SLUG}`);
    const revs = list(await deno('GET', `/v2/apps/${C.APP_SLUG}/revisions?limit=20`));
    const curId = observed.current?.id ?? null;
    const cur = curId ? await deno('GET', `/v2/revisions/${curId}`) : null;
    const timelines = curId ? list(await deno('GET', `/v2/revisions/${curId}/timelines`)).map((t) => ({ slug: t?.slug ?? null, domains: Array.isArray(t?.domains) ? t.domains.map((d) => d?.domain ?? null) : [] })) : [];
    const production = timelines.find((t) => t.slug === 'production') ?? null;
    const runtimeFields = Object.fromEntries(Object.entries({ ...(cur ?? {}) }).filter(([k, v]) => /runtime|version|deno/i.test(k) && (v === null || typeof v !== 'object')));
    const checks = [
      ['organization: apps visible to the token = pin', canon(apps) === canon([...cert.org_apps].sort()), apps],
      ['organization: no shared layers', layers === cert.org_layers, layers],
      ['organization: live revision served on the pinned production domain', !!production && production.domains.includes(cert.production_domain), production],
      ['app id = pin', app?.id === cert.app.id, app?.id ?? null],
      ['app config = certified (dynamic, entrypoint, no crons, no build/install/predeploy)', canon(app?.config ?? null) === canon(cert.app.config), app?.config ?? null],
      ['app labels = certified', canon(app?.labels ?? null) === canon(cert.app.labels), app?.labels ?? null],
      ['app created_at = certified', app?.created_at === cert.app.created_at, app?.created_at ?? null],
      ['app updated_at = certified (no config/env change since)', app?.updated_at === cert.app.updated_at, app?.updated_at ?? null],
      ['revision set = certified (no new revision)', canon(revs.map((r) => r?.id).sort()) === canon([...cert.revisions].sort()), revs.map((r) => r?.id)],
      ['current revision = certified, same build timestamps', cur?.id === cert.current.id && cur?.created_at === cert.current.created_at && cur?.build_finished_at === cert.current.build_finished_at,
        cur ? { id: cur.id, created_at: cur.created_at ?? null, build_finished_at: cur.build_finished_at ?? null } : null],
      ['current revision succeeded, source label = deploy pin head', cur?.status === 'succeeded' && cur?.labels?.['custom.git_head'] === C.CURRENT.head, cur ? { status: cur.status, labels: cur.labels ?? null } : null],
    ].map(([name, pass, observedValue]) => ({ name, pass: !!pass, observed: observedValue }));
    return { checks, failures: checks.filter((c) => !c.pass).map((c) => c.name), timelines,
      runtime: { revision_fields: cur ? Object.keys(cur).sort() : [], runtime_fields: runtimeFields, config_runtime: app?.config?.runtime ?? null } };
  }
  async function waitRevision(id) {
    const started = deps.now();
    let r = null;
    while (deps.now() - started < (deps.revisionTimeoutMs ?? 6 * 60000)) {
      r = revisionView(await deno('GET', `/v2/revisions/${id}`));
      if (['succeeded', 'failed', 'skipped'].includes(r.status)) break;
      await deps.sleep(deps.pollMs ?? 5000);
    }
    return r;
  }
  /** Which pinned source a revision carries (by its label; the label is written by this tooling and gateway-remote). */
  const revisionSource = (rev, candidate) => {
    const head = rev?.labels?.['custom.git_head'] ?? null;
    if (head === C.CURRENT.head) return 'previous';
    if (candidate && rev?.labels?.['custom.bundle_digest'] === candidate.digest) return 'candidate';
    return 'unknown';
  };

  // ── probes ──
  function readRing() {
    const pin = JSON.parse(fs.readFileSync(deps.jwksPinFile ?? G.JWKS_PIN_FILE, 'utf8'));
    const k1 = { pkcs8: remember(deps.keychain.ring('k1', pin.active)), kid: pin.active };
    return { pin, k1 };
  }
  /**
   * phase 'previous' = the deployed bea307a3 source; 'candidate' = the COMPETITION-V1 source. No user, no Core session:
   * bridge tokens are minted for RANDOM identities, so the best a call can reach is the allowlist (403) or the live
   * Core authority (401). Nothing is written anywhere.
   */
  async function probes(phase, { withRing = true } = {}) {
    const base = deps.gatewayBase ?? C.GATEWAY_BASE;
    const t = deps.gatewayTransport;
    const checks = [];
    const add = (name, pass, r, extra = {}) => { checks.push({ name, pass: !!pass, status: r?.status ?? null, error: r?.json?.error ?? null, cache: r?.headers?.['cache-control'] ?? null, ...extra }); return r; };
    const o = { origin: G.WEB_ORIGIN };
    const json = { ...o, 'content-type': 'application/json' };
    const at = (p) => `${base}${p}`;
    const post = (p, body, headers = json) => t({ url: at(p), method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

    const cfg = await t({ url: at('/config'), headers: o });
    const pinEnv = deployPin().env.find((e) => e.key === 'TORNEOS_ANON_KEY');
    const anonOk = typeof cfg.json?.anonKey === 'string' && C.sha256(cfg.json.anonKey).slice(0, 16) === pinEnv.sha256_16;
    add('GET /config → the Torneos publishable key is the pinned one (digest)', cfg.status === 200 && anonOk, cfg);
    if (withRing) {
      const ring = readRing();
      const b7 = await probeGateway({ base, jwksPin: ring.pin, ring: { k1: ring.k1 }, known, torneosAnonKey: anonOk ? cfg.json.anonKey : null, transport: t });
      for (const c of b7.checks) checks.push({ ...c, name: `B7 ${c.name}` });
      const now = Math.floor(Date.now() / 1000);
      const tok = mintBridgeToken({ ...ring.k1, now, overrides: { sub: crypto.randomUUID(), core_user_id: crypto.randomUUID() } });
      const auth = { ...json, authorization: `Bearer ${tok}` };
      const body = { p_organization_id: crypto.randomUUID(), p_fixture_version_id: crypto.randomUUID() };
      for (const [rpc, label] of [[C.PROBE.competitionRead, 'competition read'], [C.PROBE.competitionGranted, 'granted by 0004']]) {
        const r = await post(`/torneos/rest/v1/rpc/${rpc}`, body, auth);
        if (phase === 'previous') add(`${label} RPC ${rpc}, valid k1 token → 403 rpc not enabled (not in the deployed allowlist)`, r.status === 403 && r.json?.error === 'rpc not enabled', r);
        else add(`${label} RPC ${rpc}, valid k1 token for a Core user that does not exist → 401 (allowlisted; live Core authority)`, r.status === 401 && r.json?.error === 'access denied', r);
      }
      for (const rpc of [C.PROBE.serviceOnly, C.PROBE.kept, C.PROBE.commerce, C.PROBE.publicRpc]) {
        const r = await post(`/torneos/rest/v1/rpc/${rpc}`, {}, auth);
        add(`${rpc} on the authenticated route, valid k1 token → 403 rpc not enabled (both sources)`, r.status === 403 && r.json?.error === 'rpc not enabled', r);
      }
    }
    for (const rpc of [C.PROBE.competitionRead, C.PROBE.competitionGranted]) {
      const r = await post(`/torneos/rest/v1/rpc/${rpc}`, {});
      add(`${rpc} without bearer → 401`, r.status === 401, r);
    }
    const pub = (name, body, headers = json, method = 'POST') => t({ url: at(`/torneos/public/v1/rpc/${name}`), method, headers, body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const slug = `probe-${crypto.randomUUID().slice(0, 8)}`;
    if (phase === 'previous') {
      const r = await pub(C.PROBE.publicRpc, { p_public_slug: slug });
      add('public route absent in the deployed source → 404', r.status === 404, r);
    } else {
      const okr = await pub(C.PROBE.publicRpc, { p_public_slug: slug, p_category_slug: null });
      add('public route: unknown (well-formed) slug → 200 null, no-store', okr.status === 200 && okr.raw === 'null' && okr.headers?.['cache-control'] === 'no-store', okr);
      const cred = await pub(C.PROBE.publicRpc, { p_public_slug: slug }, { ...json, authorization: 'Bearer x' });
      add('public route with Authorization → 400 (credentials refused)', cred.status === 400 && cred.json?.error === 'public route accepts no credentials', cred);
      const key = await pub(C.PROBE.publicRpc, { p_public_slug: slug }, { ...json, apikey: 'x' });
      add('public route with apikey → 400', key.status === 400, key);
      const other = await pub(C.PROBE.competitionRead, {});
      add('public route, a non-public RPC → 403 rpc not enabled', other.status === 403 && other.json?.error === 'rpc not enabled', other);
      const shape = await pub(C.PROBE.publicRpc, { p_public_slug: 'Bad_Slug' });
      add('public route, shape-invalid slug → 400 (refused before Torneos REST)', shape.status === 400 && shape.json?.error === 'invalid arguments', shape);
      const extra = await pub(C.PROBE.publicRpc, { p_public_slug: slug, p_extra: 1 });
      add('public route, extra argument → 400', extra.status === 400, extra);
      const big = await pub(C.PROBE.publicRpc, `{"p_public_slug":"${'a'.repeat(3000)}"}`);
      add('public route, body > 2 KiB → 413', big.status === 413, big);
      const get = await pub(C.PROBE.publicRpc, undefined, o, 'GET');
      add('public route, GET → 405', get.status === 405, get);
      const text = await pub(C.PROBE.publicRpc, 'p_public_slug=x', { ...o, 'content-type': 'text/plain' });
      add('public route, text/plain → 415', text.status === 415, text);
    }
    const leaks = G.secretFindings(checks.map((c) => JSON.stringify(c)).join('\n'), known);
    checks.push({ name: 'no probe result carries a secret this process holds', pass: leaks.length === 0 });
    return { phase, checks, passed: checks.filter((c) => c.pass).length, total: checks.length, pass: checks.every((c) => c.pass) };
  }

  // ── G1 ──
  async function g1({ withDeno = !!denoToken, withRing = true } = {}) {
    const db = await dbObserve();
    const candidate = deps.buildCandidate();
    const candidatePin = C.readJson(deps.candidatePinFile ?? C.CANDIDATE_PIN_FILE);
    const previous = deps.buildPrevious();
    const bundle = { candidate: { head: candidate.head, digest: candidate.digest, files: candidate.manifest.length }, previous: { head: previous.head, digest: previous.digest, files: previous.manifest.length },
      candidate_pin: candidatePin ? { head: candidatePin.head, digest: candidatePin.digest } : null };
    const failures = [...db.failures];
    if (db.state !== 'PRE_0004') failures.push(`DB_STATE_${db.state}`);
    if (previous.digest !== C.CURRENT.digest || previous.manifest.length !== C.CURRENT.files) failures.push('PREVIOUS_SOURCE_NOT_THE_DEPLOY_PIN');
    if (!candidatePin || candidatePin.digest !== candidate.digest || candidatePin.files !== candidate.manifest.length) failures.push('CANDIDATE_NOT_THE_PIN');
    let dn = null;
    if (withDeno) {
      dn = await denoObserve();
      failures.push(...dn.failures.map((x) => `DENO_${x}`));
      if (dn.current?.id !== C.CURRENT.revision) failures.push('DENO_CURRENT_REVISION_NOT_THE_PIN');
      if (revisionSource(dn.current, null) !== 'previous') failures.push('DENO_CURRENT_SOURCE_LABEL_NOT_THE_PIN');
      dn.audit = await denoAudit(dn);
      failures.push(...dn.audit.failures.map((x) => `DENO_AUDIT ${x}`));
    }
    const pr = await probes('previous', { withRing });
    if (!pr.pass) failures.push(`PROBES_FAILED ${pr.checks.filter((c) => !c.pass).map((c) => c.name).join(' | ').slice(0, 600)}`);
    const verdict = failures.length ? 'G1_FAILED' : (withDeno ? 'G1_PASS' : 'G1_PASS_WITHOUT_DENO_OBSERVATION');
    writeEvidence(`cv1-g1-${stamp()}.json`, { verdict, read_only: true, writes: 0, db, bundle, deno: dn, probes: pr, deno_requests: denoLog, failures });
    return { verdict, state: db.state, failures };
  }

  // ── W1 ──
  async function w1() {
    const before = await dbObserve();
    if (!['PRE_0004', 'ROLLED_BACK'].includes(before.state) || before.failures.length) stop('W1_PRECONDITION', { state: before.state, failures: before.failures });
    const bytes = C.assertFileHash(C.MIGRATION.file, C.MIGRATION.sha256);
    const plan = { step: 'W1', target: C.TORNEOS_REF, file: C.MIGRATION.file, sha256: C.MIGRATION.sha256, transport: `psql ${C.POOLER_HOST}:${C.POOLER_PORT} ${C.INSTALLER}.${C.TORNEOS_REF} verify-full`,
      state_before: before.state, counts_before: before.contract_state.counts, effect: '2 CREATE OR REPLACE FUNCTION (pinned bodies) + 15 GRANT EXECUTE … TO authenticated, one transaction' };
    const id = C.planIdOf(plan);
    say(`\nPLAN ${id}: apply ${C.MIGRATION.file} (sha256 ${C.MIGRATION.sha256.slice(0, 16)}…) to Arma2 Torneos ${C.TORNEOS_REF}\n  ${plan.transport} · password from Keychain · ONE transaction (the file's BEGIN…COMMIT, ON_ERROR_STOP)\n  effect: ${plan.effect}\n  state now: ${before.state}, authenticated ${before.contract_state.counts.authenticated_public} / anon ${before.contract_state.counts.anon_public}`);
    const authorization = requirePhrase(C.PHRASES.w1(id));
    const again = await dbObserve();
    if (again.state !== before.state || again.failures.length) stop('W1_STATE_CHANGED_SINCE_PLAN', { state: again.state });
    const fresh = C.assertFileHash(C.MIGRATION.file, C.MIGRATION.sha256);
    if (!fresh.equals(bytes)) stop('W1_FILE_CHANGED_SINCE_PLAN');
    const run = await deps.applySql({ sql: fresh.toString('utf8'), env: installerEnv({ password: installerPassword(), app: 'arma2-torneos-competition-v1-w1' }), redact });
    const after = await dbObserve();
    const verdict = run.code === 0 && after.state === 'POST_0004' && !after.failures.length ? 'W1_APPLIED'
      : (run.code !== 0 && after.state === before.state ? 'W1_FAILED_NO_CHANGE' : 'W1_POSTCHECK_FAILED');
    writeEvidence(`cv1-w1-${stamp()}.json`, { verdict, plan, plan_id: id, authorization, psql: { code: run.code, elapsed_ms: run.elapsed_ms, stderr_tail: run.stderr_tail }, before, after });
    if (verdict !== 'W1_APPLIED') stop(verdict, { code: run.code, state: after.state, failures: after.failures });
    return { verdict };
  }

  // ── W1 rollback (after the gateway is back on the previous source) ──
  async function w1Rollback() {
    const before = await dbObserve();
    if (before.state !== 'POST_0004' || before.failures.length) stop('W1_ROLLBACK_PRECONDITION', { state: before.state, failures: before.failures });
    const dn = await denoObserve();
    if (dn.failures.length || revisionSource(dn.current, null) !== 'previous') stop('W1_ROLLBACK_GATEWAY_NOT_ON_PREVIOUS_SOURCE', { current: dn.current?.id, failures: dn.failures });
    const bytes = C.assertFileHash(C.ROLLBACK.file, C.ROLLBACK.sha256);
    const plan = { step: 'W1-rollback', target: C.TORNEOS_REF, file: C.ROLLBACK.file, sha256: C.ROLLBACK.sha256, state_before: before.state, gateway_revision: dn.current.id, effect: '15 REVOKE EXECUTE … FROM authenticated; the two function fixes stay; no data change' };
    const id = C.planIdOf(plan);
    say(`\nPLAN ${id}: apply the COMPETITION-V1 rollback (${C.ROLLBACK.sha256.slice(0, 16)}…): ${plan.effect}\n  gateway already on the previous source (revision ${dn.current.id})`);
    const authorization = requirePhrase(C.PHRASES.w1Rollback(id));
    const again = await dbObserve();
    if (again.state !== 'POST_0004') stop('W1_ROLLBACK_STATE_CHANGED_SINCE_PLAN', { state: again.state });
    const run = await deps.applySql({ sql: C.assertFileHash(C.ROLLBACK.file, C.ROLLBACK.sha256).toString('utf8'), env: installerEnv({ password: installerPassword(), app: 'arma2-torneos-competition-v1-w1-rollback' }), redact });
    if (!bytes.length) stop('W1_ROLLBACK_EMPTY');
    const after = await dbObserve();
    const verdict = run.code === 0 && after.state === 'ROLLED_BACK' && !after.failures.length ? 'W1_ROLLED_BACK' : 'W1_ROLLBACK_POSTCHECK_FAILED';
    writeEvidence(`cv1-w1-rollback-${stamp()}.json`, { verdict, plan, plan_id: id, authorization, psql: { code: run.code, stderr_tail: run.stderr_tail }, before, after });
    if (verdict !== 'W1_ROLLED_BACK') stop(verdict, { state: after.state, failures: after.failures });
    return { verdict };
  }

  // ── W2 / W2 rollback: one production revision, assets only ──
  async function deploySource({ which }) {
    const db = await dbObserve();
    const candidate = deps.buildCandidate();
    const candidatePin = C.readJson(deps.candidatePinFile ?? C.CANDIDATE_PIN_FILE);
    const source = which === 'candidate' ? candidate : deps.buildPrevious();
    if (which === 'candidate') {
      if (db.state !== 'POST_0004' || db.failures.length) stop('W2_DB_NOT_POST_0004', { state: db.state, failures: db.failures });
      if (!candidatePin || candidatePin.digest !== candidate.digest || candidatePin.files !== candidate.manifest.length) stop('W2_CANDIDATE_NOT_THE_PIN', { digest: candidate.digest, pin: candidatePin?.digest ?? null });
    } else if (source.digest !== C.CURRENT.digest || source.head !== C.CURRENT.head) stop('W2_ROLLBACK_SOURCE_NOT_THE_DEPLOY_PIN', { digest: source.digest });
    const dn = await denoObserve();
    if (dn.failures.length) stop('W2_DENO_OBSERVE_FAILED', { failures: dn.failures });
    const on = revisionSource(dn.current, candidate);
    if (which === 'candidate' && (on !== 'previous' || dn.current.id !== C.CURRENT.revision)) stop('W2_CURRENT_REVISION_NOT_THE_PIN', { current: dn.current?.id, source: on });
    if (which === 'previous' && on !== 'candidate') stop('W2_ROLLBACK_CURRENT_NOT_THE_CANDIDATE', { current: dn.current?.id, source: on });
    const body = { assets: source.assets, labels: { 'custom.git_head': source.head, 'custom.bundle_digest': source.digest }, production: true, preview: false };
    R.assertDenoWriteBody('deploy', body);
    if ('env_vars' in body) stop('W2_BODY_CARRIES_ENV');
    const plan = { step: which === 'candidate' ? 'W2' : 'W2-rollback', app: C.APP_SLUG, previous_revision: dn.current.id, source: { head: source.head, digest: source.digest, files: source.manifest.map((m) => m.path) },
      env: 'unchanged (not in the request)', env_now: dn.env.map((e) => `${e.key}${e.secret ? '(secret)' : ''}`), timelines: { production: true, preview: false } };
    const id = C.planIdOf(plan);
    say(`\nPLAN ${id}: deploy ONE production revision of ${C.APP_SLUG}: ${source.manifest.length} files, HEAD ${source.head.slice(0, 12)}, digest ${source.digest.slice(0, 16)}…\n  request = assets + labels only (no env, no config, no layers); current revision ${dn.current.id}`);
    const authorization = requirePhrase((which === 'candidate' ? C.PHRASES.w2 : C.PHRASES.w2Rollback)(id));
    const again = await denoObserve();
    if (again.failures.length || again.current?.id !== dn.current.id) stop('W2_STATE_CHANGED_SINCE_PLAN');
    armed = 'deploy';
    let rev;
    try { rev = revisionView(await deno('POST', `/v2/apps/${C.APP_SLUG}/deploy`, body)); } finally { armed = null; }
    const done = await waitRevision(rev.id);
    const after = await denoObserve();
    const envSame = canon(after.env) === canon(dn.env);
    const live = after.current?.id === rev.id && revisionSource(after.current, candidate) === (which === 'candidate' ? 'candidate' : 'previous');
    const pr = done?.status === 'succeeded' ? await probes(which === 'candidate' ? 'candidate' : 'previous') : null;
    const ok = done?.status === 'succeeded' && live && envSame && !after.failures.length && pr?.pass;
    const verdict = ok ? (which === 'candidate' ? 'W2_DEPLOYED' : 'W2_ROLLED_BACK') : (which === 'candidate' ? 'W2_POSTCHECK_FAILED' : 'W2_ROLLBACK_POSTCHECK_FAILED');
    if (ok && which === 'candidate' && deps.deployedPinFile) {
      fs.writeFileSync(deps.deployedPinFile, `${JSON.stringify({ purpose: 'COMPETITION-V1 gateway revision on Deno Deploy — public facts only', app: C.APP_SLUG, revision: rev.id, previous_revision: dn.current.id,
        source: { head: source.head, digest: source.digest, files: source.manifest }, env: after.env, deployed_at: new Date(deps.now()).toISOString() }, null, 1)}\n`);
    }
    writeEvidence(`cv1-${which === 'candidate' ? 'w2' : 'w2-rollback'}-${stamp()}.json`, { verdict, plan, plan_id: id, authorization, revision: done, before: dn, after, env_unchanged: envSame, live, probes: pr, deno_requests: denoLog });
    if (!ok) stop(verdict, { status: done?.status, live, env_unchanged: envSame, failures: after.failures, probes_failed: pr?.checks.filter((c) => !c.pass).map((c) => c.name) });
    return { verdict, revision: rev.id };
  }

  return {
    known, dbObserve, denoObserve, denoAudit: async () => denoAudit(await denoObserve()), probes, g1, w1, w1Rollback,
    w2: () => deploySource({ which: 'candidate' }),
    w2Rollback: () => deploySource({ which: 'previous' }),
    get denoRequests() { return denoLog.slice(); },
    wipe() { known.splice(0); password = null; },
  };
}
