// OFFICIALIZATION + ERROR-CONTRACT REMOTE — G1 (read-only), W1 (0005), W2 (0006), W3 (gateway) and the three rollbacks,
// with every dependency injected (psql, Keychain, Deno transport, gateway transport, clock, operator line reader) so that
// the offline tests and the offline rehearsal drive exactly this code. Fail closed: every write re-observes the state it
// was planned on, needs the exact phrase of its plan id, is sent once (no retry), and is followed by a read-only
// postcheck; evidence files are secret-scanned against every value the process holds.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as C from './oec-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as P from '../torneos-payments-test/payments-test-contract.mjs';
import * as R from '../torneos-gateway-remote/remote-contract.mjs';
import { foundationDiff } from '../torneos-gateway-auth/gateway-auth.mjs';
import { probeGateway } from '../torneos-gateway-remote/gateway-probe.mjs';
import { mintBridgeToken } from '../torneos-gateway-auth/bridge-probe.mjs';
import { installerEnv as cv1InstallerEnv } from '../torneos-competition-v1/competition-remote.mjs';

export class Stop extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }
const stop = (code, detail) => { throw new Stop(code, detail); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** Installer over the Session Pooler (verify-full, pinned host, installer.<ref>); writes carry no PGOPTIONS. */
export const installerEnv = ({ password, app }) => cv1InstallerEnv({ password, app });
/** Reads additionally carry default_transaction_read_only=on (the server refuses any write). */
export const readOnlyEnv = ({ password }) => ({ ...installerEnv({ password, app: 'arma2-torneos-oec-readonly' }), PGOPTIONS: '-c default_transaction_read_only=on' });

function lastJson(stdout) {
  const line = String(stdout ?? '').trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch { return null; }
}

/** W1 / W2 refusal codes per observed state (anything but the one valid pre-state is refused before any phrase). */
export const REFUSALS = Object.freeze({
  w1: { POST_0005: 'W1_REFUSED_ALREADY_POST_0005', POST_0006: 'W1_REFUSED_POST_0006_0005_WOULD_REVERT_0006', ROLLED_BACK_0005: 'W1_REFUSED_ROLLED_BACK_0005_NEEDS_A_NEW_CERTIFIED_PHASE', DRIFT: 'W1_PRECONDITION_DRIFT' },
  w2: { POST_0004: 'W2_REFUSED_0005_NOT_APPLIED', POST_0006: 'W2_REFUSED_ALREADY_POST_0006', ROLLED_BACK_0005: 'W2_REFUSED_ROLLED_BACK_0005', DRIFT: 'W2_PRECONDITION_DRIFT' },
  w2Rollback: { POST_0004: 'W2_ROLLBACK_REFUSED_NOTHING_TO_ROLL_BACK', POST_0005: 'W2_ROLLBACK_REFUSED_ALREADY_POST_0005', ROLLED_BACK_0005: 'W2_ROLLBACK_REFUSED_ROLLED_BACK_0005', DRIFT: 'W2_ROLLBACK_PRECONDITION_DRIFT' },
  w1Rollback: { POST_0004: 'W1_ROLLBACK_REFUSED_NOTHING_TO_ROLL_BACK', POST_0006: 'W1_ROLLBACK_REFUSED_POST_0006_ROLL_BACK_0006_FIRST', ROLLED_BACK_0005: 'W1_ROLLBACK_REFUSED_ALREADY_ROLLED_BACK', DRIFT: 'W1_ROLLBACK_PRECONDITION_DRIFT' },
});

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
  const livePin = () => deps.livePin ?? C.readLiveDeployPin();
  const deltaPin = () => C.readJson(deps.deltaPinFile ?? C.DELTA_PIN_FILE);
  const drift = () => (deps.migrationDrift ?? C.migrationDrift)();

  // ── evidence ──
  let seq = 0;
  function writeEvidence(base, body) {
    const name = base.replace(/^oec-/, `oec-${String(++seq).padStart(2, '0')}-`);
    const text = `${JSON.stringify({ tool: 'backend/torneos/infra/torneos-officialization-error-v1', target: C.TORNEOS_REF, ...body }, null, 1)}\n`;
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
    const pin = deltaPin();
    const state = await query(C.STATE_SQL);
    const cls = C.classifyState(state, pin);
    const catalog = await query(G.CATALOG_SQL);
    const gatewayRoles = await query(G.GATEWAY_ROLES_SQL);
    const paymentRoles = await query(P.PAYMENT_ROLES_SQL);
    const pins = { foundation: JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8')), payments: P.readDeltaPin(deps.paymentsDeltaPinFile ?? P.DELTA_PIN_FILE) };
    const failures = [...cls.failures];
    if (!pins.payments) failures.push('PAYMENTS_DELTA_PIN_MISSING');
    if (!pin) failures.push('OEC_DELTA_PIN_MISSING');
    // (a) every strict path of the certified foundation pin except the ones 0004 / 0005 / 0006 move.
    const moved = new Set(C.OEC_CATALOG_PATHS);
    const fd = foundationDiff(catalog, pins.foundation).map((d) => d.path).filter((p) => !moved.has(p));
    if (fd.length) failures.push(`FOUNDATION_DRIFT ${fd.join(',')}`);
    // (b) gateway-auth + payments-test deltas exactly as certified.
    if (pins.payments) {
      if (canon(G.DELTA_PATHS.map((k) => G.getPath(catalog, k))) !== canon(G.DELTA_PATHS.map((k) => G.getPath(pins.payments.catalog, k)))) failures.push('DELTA_PATHS_DRIFT');
      if (canon({ logins: gatewayRoles.logins, memberships: gatewayRoles.memberships, payment_logins: gatewayRoles.payment_logins }) !== canon(pins.payments.gateway_roles)) failures.push('GATEWAY_ROLES_DRIFT');
      if (canon(paymentRoles) !== canon(pins.payments.payment_roles)) failures.push('PAYMENT_ROLES_DRIFT');
    }
    // (c) the moved paths equal the pin of the classified state.
    const key = C.STATE_KEYS[cls.state];
    if (pin && key) for (const p of C.OEC_CATALOG_PATHS) if (canon(G.getPath(catalog, p)) !== canon(pin.states[key][p])) failures.push(`OEC_PATH_DRIFT ${p}`);
    if (state.ledger !== false) failures.push('MIGRATIONS_LEDGER_PRESENT');
    if (!/^17\./.test(String(state.server_version))) failures.push('SERVER_VERSION_NOT_17');
    if (state.current_user !== C.INSTALLER) failures.push('NOT_THE_INSTALLER');
    const anonTimeout = (state.role_settings?.anon ?? []).find((c) => c.startsWith('statement_timeout=')) ?? null;
    return { state: cls.state, failures, summary: cls.summary ?? null, anon_statement_timeout: anonTimeout, contract_state: state,
      catalog_summary: { execute: catalog.execute, functions: catalog.functions, acl_md5: catalog.acl_md5, tables: catalog.tables, policies: catalog.policies },
      gateway_roles: gatewayRoles, payment_roles: paymentRoles,
      pins: { foundation_sha256: C.sha256(canon(pins.foundation)), payments_sha256: pins.payments ? C.sha256(canon(pins.payments)) : null, oec_sha256: pin ? C.sha256(canon(pin)) : null } };
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
  function envView(envVars) {
    const pin = livePin().env;
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
    const pin = livePin();
    if (app?.id !== pin.app_id && app?.id !== C.DENO_CERTIFIED.app.id) failures.push('APP_IDENTITY');
    if (app?.slug !== C.APP_SLUG) failures.push('APP_SLUG');
    if (Array.isArray(app?.layers) && app.layers.length) failures.push('APP_LAYERS_PRESENT');
    if (canon(env.map((e) => ({ key: e.key, secret: e.secret }))) !== canon(C.ENV_SHAPE.map((e) => ({ key: e.key, secret: e.secret })))) failures.push('ENV_SHAPE_DRIFT');
    if (env.some((e) => e.matches_pin === false)) failures.push('ENV_NON_SECRET_VALUE_DRIFT');
    if (env.some((e) => e.value_returned === true)) failures.push('ENV_SECRET_VALUE_RETURNED');
    const bad = R.forbiddenEnvNames(env.map((e) => e.key));
    if (bad.length) failures.push(`ENV_FORBIDDEN ${bad.join(',')}`);
    if (env.some((e) => e.contexts !== null && e.contexts !== 'all')) failures.push('ENV_CONTEXTS');
    if (env.some((e) => /COMMERCE|MERCADOPAGO|MP_/i.test(e.key))) failures.push('ENV_COMMERCE_PRESENT');
    const current = revs[0] ?? null;
    if (!current || current.status !== 'succeeded') failures.push('CURRENT_REVISION_NOT_SUCCEEDED');
    return { app: { id: app?.id ?? null, slug: app?.slug ?? null, layers: app?.layers ?? null, config: app?.config ?? null, updated_at: app?.updated_at ?? null }, env, current, revisions: revs.slice(0, 5), failures };
  }
  /** G1 only: the organization and the app against the COMPETITION-V1 W2 certification (reads only). */
  async function denoAudit(observed) {
    const cert = deps.denoCertified ?? C.DENO_CERTIFIED;
    const apps = list(await deno('GET', '/v2/apps?limit=100')).map((a) => ({ slug: a?.slug ?? null, id: a?.id ?? null })).sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
    const layers = list(await deno('GET', '/v2/layers')).length;
    const app = await deno('GET', `/v2/apps/${C.APP_SLUG}`);
    const revs = list(await deno('GET', `/v2/apps/${C.APP_SLUG}/revisions?limit=20`));
    const curId = observed.current?.id ?? null;
    const cur = curId ? await deno('GET', `/v2/revisions/${curId}`) : null;
    const timelines = curId ? list(await deno('GET', `/v2/revisions/${curId}/timelines`)).map((t) => ({ slug: t?.slug ?? null, domains: Array.isArray(t?.domains) ? t.domains.map((d) => d?.domain ?? null) : [] })) : [];
    const production = timelines.find((t) => t.slug === 'production') ?? null;
    const checks = [
      ['organization: apps visible to the token = pin (slug + id)', canon(apps) === canon([...cert.org_apps].sort((a, b) => a.slug.localeCompare(b.slug))), apps],
      ['organization: no shared layers', layers === cert.org_layers, layers],
      ['organization: live revision served on the pinned production domain', !!production && production.domains.includes(cert.production_domain), production],
      ['app id = pin', app?.id === cert.app.id, app?.id ?? null],
      ['app config = certified (dynamic, entrypoint, no crons)', canon(app?.config ?? null) === canon(cert.app.config), app?.config ?? null],
      ['app labels = certified', canon(app?.labels ?? null) === canon(cert.app.labels), app?.labels ?? null],
      ['app created_at = certified', app?.created_at === cert.app.created_at, app?.created_at ?? null],
      ['app updated_at not after the live revision (no config/env change since COMPETITION-V1 W2)', typeof app?.updated_at === 'string' && Date.parse(app.updated_at) <= Date.parse(cert.app.updated_at_not_after), app?.updated_at ?? null],
      ['revision set = certified (no new revision since COMPETITION-V1 W2)', canon(revs.map((r) => r?.id).sort()) === canon([...cert.revisions].sort()), revs.map((r) => r?.id)],
      ['current revision = certified (66we8r12079d, same created_at)', cur?.id === cert.current.id && cur?.created_at === cert.current.created_at, cur ? { id: cur.id, created_at: cur.created_at ?? null } : null],
      ['current revision succeeded, labels = live source (ee34b2a7 + 75e3535a…)', cur?.status === 'succeeded' && cur?.labels?.['custom.git_head'] === C.LIVE.head && cur?.labels?.['custom.bundle_digest'] === C.LIVE.digest, cur ? { status: cur.status, labels: cur.labels ?? null } : null],
    ].map(([name, pass, observedValue]) => ({ name, pass: !!pass, observed: observedValue }));
    return { checks, failures: checks.filter((c) => !c.pass).map((c) => c.name), timelines };
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
  /** Which pinned source a revision carries: labels written by the COMPETITION-V1 W2 and by this tooling. */
  const revisionSource = (rev, candidate) => {
    const l = rev?.labels ?? {};
    if (l['custom.git_head'] === C.LIVE.head && l['custom.bundle_digest'] === C.LIVE.digest) return 'current';
    if (candidate && l['custom.bundle_digest'] === candidate.digest) return 'candidate';
    return 'unknown';
  };

  // ── probes ──
  function readRing() {
    const pin = JSON.parse(fs.readFileSync(deps.jwksPinFile ?? G.JWKS_PIN_FILE, 'utf8'));
    return { pin, k1: { pkcs8: remember(deps.keychain.ring('k1', pin.active)), kid: pin.active } };
  }
  /**
   * phase 'current' = the live COMPETITION-V1 source; 'candidate' = + OFFICIALIZATION-V1 allowlist + error defense.
   * No user, no Core session: bridge tokens are minted for RANDOM identities, so the best a call can reach is the
   * allowlist (403) or the live Core authority (401). Nothing is written anywhere.
   */
  async function probes(phase, { withRing = true } = {}) {
    if (!['current', 'candidate'].includes(phase)) stop('PROBE_PHASE_UNKNOWN');
    const base = deps.gatewayBase ?? C.GATEWAY_BASE;
    const t = deps.gatewayTransport;
    const checks = [];
    const add = (name, pass, r, extra = {}) => { checks.push({ name, pass: !!pass, status: r?.status ?? null, error: r?.json?.error ?? null, cache: r?.headers?.['cache-control'] ?? null, ...extra }); return r; };
    const o = { origin: G.WEB_ORIGIN };
    const json = { ...o, 'content-type': 'application/json' };
    const at = (p) => `${base}${p}`;
    const post = (p, body, headers = json) => t({ url: at(p), method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const noStore = (r) => r?.headers?.['cache-control'] === 'no-store';

    const cfg = await t({ url: at('/config'), headers: o });
    const pinEnv = livePin().env.find((e) => e.key === 'TORNEOS_ANON_KEY');
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
      for (const rpc of [C.PROBE.competitionRead, C.PROBE.competitionGranted]) {
        const r = await post(`/torneos/rest/v1/rpc/${rpc}`, body, auth);
        add(`COMPETITION-V1 ${rpc}, valid k1 token, Core user that does not exist → 401 (allowlisted; Core authority checked on this request), no-store`, r.status === 401 && r.json?.error === 'access denied' && noStore(r), r);
      }
      for (const rpc of C.OFFICIALIZATION_RPCS) {
        const r = await post(`/torneos/rest/v1/rpc/${rpc}`, { p_organization_id: crypto.randomUUID() }, auth);
        if (phase === 'current') add(`OFFICIALIZATION-V1 ${rpc}, valid k1 token → 403 rpc not enabled (not in the live allowlist)`, r.status === 403 && r.json?.error === 'rpc not enabled', r);
        else add(`OFFICIALIZATION-V1 ${rpc}, valid k1 token, Core user that does not exist → 401 (allowlisted; Core authority checked on this request)`, r.status === 401 && r.json?.error === 'access denied' && noStore(r), r);
      }
      for (const rpc of [C.PROBE.serviceOnly, C.PROBE.kept, C.PROBE.commerce, C.PROBE.publicRpc]) {
        const r = await post(`/torneos/rest/v1/rpc/${rpc}`, {}, auth);
        add(`${rpc} on the authenticated route, valid k1 token → 403 rpc not enabled (both sources; commerce OFF)`, r.status === 403 && r.json?.error === 'rpc not enabled', r);
      }
    }
    for (const rpc of [C.PROBE.competitionRead, C.PROBE.competitionGranted, ...C.OFFICIALIZATION_RPCS]) {
      const r = await post(`/torneos/rest/v1/rpc/${rpc}`, {});
      add(`${rpc} without bearer → 401`, r.status === 401, r);
    }
    const pub = (name, bodyValue, headers = json, method = 'POST') => t({ url: at(`/torneos/public/v1/rpc/${name}`), method, headers, body: method === 'GET' ? undefined : (typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue)) });
    const slug = `probe-${crypto.randomUUID().slice(0, 8)}`;
    const okr = await pub(C.PROBE.publicRpc, { p_public_slug: slug, p_category_slug: null });
    add('public route: unknown (well-formed) slug → 200 null, no-store', okr.status === 200 && okr.raw === 'null' && noStore(okr), okr);
    for (const rpc of C.OFFICIALIZATION_RPCS) {
      const r = await pub(rpc, {});
      add(`public route does not expose OFFICIALIZATION-V1 ${rpc} → 403 rpc not enabled`, r.status === 403 && r.json?.error === 'rpc not enabled', r);
    }
    const cred = await pub(C.PROBE.publicRpc, { p_public_slug: slug }, { ...json, authorization: 'Bearer x' });
    add('public route with Authorization → 400 (credentials refused)', cred.status === 400 && cred.json?.error === 'public route accepts no credentials', cred);
    const other = await pub(C.PROBE.competitionRead, {});
    add('public route, a non-public RPC → 403 rpc not enabled', other.status === 403 && other.json?.error === 'rpc not enabled', other);
    const shape = await pub(C.PROBE.publicRpc, { p_public_slug: 'Bad_Slug' });
    add('public route, shape-invalid slug → 400 (refused before Torneos REST)', shape.status === 400 && shape.json?.error === 'invalid arguments', shape);
    const get = await pub(C.PROBE.publicRpc, undefined, o, 'GET');
    add('public route, GET → 405', get.status === 405, get);
    const leaks = G.secretFindings(checks.map((c) => JSON.stringify(c)).join('\n'), known);
    checks.push({ name: 'no probe result carries a secret this process holds', pass: leaks.length === 0 });
    return { phase, checks, passed: checks.filter((c) => c.pass).length, total: checks.length, pass: checks.every((c) => c.pass) };
  }

  // ── bundles ──
  function bundles() {
    const candidate = deps.buildCandidate();
    const again = deps.buildCandidate();
    const live = deps.buildLive();
    const candidatePin = C.readJson(deps.candidatePinFile ?? C.CANDIDATE_PIN_FILE);
    const failures = [];
    if (again.digest !== candidate.digest) failures.push('CANDIDATE_NOT_DETERMINISTIC');
    if (live.digest !== C.LIVE.digest || live.manifest.length !== C.LIVE.files || live.head !== C.LIVE.head) failures.push('LIVE_SOURCE_NOT_THE_DEPLOY_PIN');
    if (canon(live.manifest) !== canon(livePin().source.files)) failures.push('LIVE_MANIFEST_NOT_THE_DEPLOY_PIN');
    if (!candidatePin || candidatePin.digest !== candidate.digest || candidatePin.files !== candidate.manifest.length) failures.push('CANDIDATE_NOT_THE_PIN');
    const added = candidate.manifest.filter((m) => !live.manifest.some((l) => l.path === m.path)).map((m) => m.path);
    const changed = candidate.manifest.filter((m) => live.manifest.some((l) => l.path === m.path && l.sha256 !== m.sha256)).map((m) => m.path);
    const removed = live.manifest.filter((l) => !candidate.manifest.some((m) => m.path === l.path)).map((l) => l.path);
    const view = { candidate: { head: candidate.head, digest: candidate.digest, files: candidate.manifest.length }, live: { head: live.head, digest: live.digest, files: live.manifest.length },
      candidate_pin: candidatePin ? { digest: candidatePin.digest, files: candidatePin.files } : null, delta: { added, changed, removed } };
    return { candidate, live, candidatePin, failures, view };
  }

  /** The gateway serves the live COMPETITION-V1 source: Deno labels + behavior (probes) — required by every DB step. */
  async function gatewayOnCurrent() {
    const dn = await denoObserve();
    const on = revisionSource(dn.current, null);
    const pr = await probes('current');
    return { dn, on, probes: pr, ok: !dn.failures.length && on === 'current' && pr.pass };
  }

  // ── G1 ──
  async function g1({ withDeno = !!denoToken, withRing = true } = {}) {
    const db = await dbObserve();
    const b = bundles();
    const failures = [...db.failures, ...b.failures, ...drift().map((d) => `MIGRATION_DRIFT ${d}`)];
    if (db.state !== 'POST_0004') failures.push(`DB_STATE_${db.state}`);
    let dn = null;
    if (withDeno) {
      dn = await denoObserve();
      failures.push(...dn.failures.map((x) => `DENO_${x}`));
      if (dn.current?.id !== C.LIVE.revision) failures.push('DENO_CURRENT_REVISION_NOT_THE_PIN');
      if (revisionSource(dn.current, null) !== 'current') failures.push('DENO_CURRENT_SOURCE_LABEL_NOT_THE_PIN');
      dn.audit = await denoAudit(dn);
      failures.push(...dn.audit.failures.map((x) => `DENO_AUDIT ${x}`));
    }
    const pr = await probes('current', { withRing });
    if (!pr.pass) failures.push(`PROBES_FAILED ${pr.checks.filter((c) => !c.pass).map((c) => c.name).join(' | ').slice(0, 600)}`);
    const verdict = failures.length ? 'G1_FAILED' : (withDeno ? 'G1_PASS' : 'G1_PASS_WITHOUT_DENO_OBSERVATION');
    writeEvidence(`oec-g1-${stamp()}.json`, { verdict, read_only: true, writes: 0, db, bundle: b.view, deno: dn, probes: pr, deno_requests: denoLog, failures,
      expected_plan_ids: db.state === 'POST_0004' ? expectedPlanIds(db.contract_state.counts, b) : null });
    return { verdict, state: db.state, failures };
  }
  /** Plan ids are pure functions of the pinned inputs + the observed state (see C.PLANS). */
  function expectedPlanIds(counts, b) {
    const post5 = { authenticated_public: C.COUNTS.post0005, anon_public: C.COUNTS.anon };
    return {
      w1: C.planIdOf(C.PLANS.w1({ counts })),
      w2_after_w1: C.planIdOf(C.PLANS.w2({ counts: post5 })),
      w3_after_w2: C.planIdOf(C.PLANS.deploy({ which: 'candidate', previousRevision: C.LIVE.revision, source: b.candidate, env: C.ENV_SHAPE.map((e) => `${e.key}${e.secret ? '(secret)' : ''}`) })),
    };
  }

  // ── DB writes (W1, W2 and their rollbacks) ──
  async function dbWrite({ step, from, to, refusals, file, planOf, phrase, requireGateway = true }) {
    const before = await dbObserve();
    if (before.state !== from || before.failures.length) stop(before.failures.length && before.state === from ? `${step}_PRECONDITION_DRIFT` : (refusals[before.state] ?? `${step}_PRECONDITION`), { state: before.state, failures: before.failures });
    const d = drift();
    if (d.length) stop('MIGRATION_DRIFT', { drift: d });
    const gw = requireGateway ? await gatewayOnCurrent() : null;
    if (gw && !gw.ok) stop(`${step}_GATEWAY_NOT_ON_THE_LIVE_SOURCE`, { current: gw.dn.current?.id ?? null, source: gw.on, failures: gw.dn.failures, probes_failed: gw.probes.checks.filter((c) => !c.pass).map((c) => c.name) });
    const bytes = C.assertFileHash(file.file, file.sha256);
    const plan = planOf({ counts: before.contract_state.counts, gateway: gw ? { revision: gw.dn.current.id, source: gw.on } : null });
    const id = C.planIdOf(plan);
    say(`\nPLAN ${id}: ${step} — apply ${file.file} (sha256 ${file.sha256.slice(0, 16)}…) to Arma2 Torneos ${C.TORNEOS_REF}\n  ${plan.transport} · password from Keychain · ONE transaction (the file's BEGIN…COMMIT, ON_ERROR_STOP)\n  effect: ${plan.effect}\n  state now: ${before.state} (${before.contract_state.counts.authenticated_public} / ${before.contract_state.counts.anon_public}) → expected ${to}${gw ? `\n  gateway: ${gw.dn.current.id} (${gw.on}), probes ${gw.probes.passed}/${gw.probes.total}` : ''}`);
    const authorization = requirePhrase(phrase(id));
    // Immediate pre-write recheck: same state, no drift, same file bytes, same gateway revision.
    const again = await dbObserve();
    if (again.state !== before.state || again.failures.length) stop(`${step}_STATE_CHANGED_SINCE_PLAN`, { state: again.state, failures: again.failures });
    if (drift().length) stop('MIGRATION_DRIFT_SINCE_PLAN');
    const fresh = C.assertFileHash(file.file, file.sha256);
    if (!fresh.equals(bytes)) stop(`${step}_FILE_CHANGED_SINCE_PLAN`);
    if (gw) { const now = await denoObserve(); if (now.failures.length || now.current?.id !== gw.dn.current.id) stop(`${step}_GATEWAY_CHANGED_SINCE_PLAN`); }
    const run = await deps.applySql({ sql: fresh.toString('utf8'), env: installerEnv({ password: installerPassword(), app: `arma2-torneos-oec-${step.toLowerCase()}` }), redact });
    const after = await dbObserve();
    const membersKept = Number(after.contract_state.data?.organization_members) >= Number(before.contract_state.data?.organization_members);
    const postProbes = gw ? await probes('current') : null;
    const ok = run.code === 0 && after.state === to && !after.failures.length && membersKept && (!postProbes || postProbes.pass);
    const verdict = ok ? `${step}_DONE` : (run.code !== 0 && after.state === before.state && !after.failures.length ? `${step}_FAILED_NO_CHANGE` : `${step}_POSTCHECK_FAILED`);
    writeEvidence(`oec-${step.toLowerCase()}-${stamp()}.json`, { verdict, plan, plan_id: id, authorization, psql: { code: run.code, elapsed_ms: run.elapsed_ms ?? null, stderr_tail: run.stderr_tail }, before, after,
      organization_members_kept: membersKept, gateway_before: gw ? { current: gw.dn.current, source: gw.on, probes: gw.probes } : null, probes_after: postProbes, deno_requests: denoLog });
    if (!ok) stop(verdict, { code: run.code, state: after.state, failures: after.failures, probes_failed: postProbes?.checks.filter((c) => !c.pass).map((c) => c.name) ?? [] });
    return { verdict, plan_id: id, state: after.state };
  }
  const w1 = () => dbWrite({ step: 'W1', from: 'POST_0004', to: 'POST_0005', refusals: REFUSALS.w1, file: C.M0005, planOf: C.PLANS.w1, phrase: C.PHRASES.w1 });
  const w2 = () => dbWrite({ step: 'W2', from: 'POST_0005', to: 'POST_0006', refusals: REFUSALS.w2, file: C.M0006, planOf: C.PLANS.w2, phrase: C.PHRASES.w2 });
  const w2Rollback = () => dbWrite({ step: 'W2_ROLLBACK', from: 'POST_0006', to: 'POST_0005', refusals: REFUSALS.w2Rollback, file: C.R0006, planOf: C.PLANS.w2Rollback, phrase: C.PHRASES.w2Rollback });
  const w1Rollback = () => dbWrite({ step: 'W1_ROLLBACK', from: 'POST_0005', to: 'ROLLED_BACK_0005', refusals: REFUSALS.w1Rollback, file: C.R0005, planOf: C.PLANS.w1Rollback, phrase: C.PHRASES.w1Rollback });

  // ── W3 / W3 rollback: one production revision, assets + labels only ──
  async function deploySource({ which }) {
    const db = await dbObserve();
    const b = bundles();
    const source = which === 'candidate' ? b.candidate : b.live;
    if (which === 'candidate') {
      if (db.state !== 'POST_0006' || db.failures.length) stop('W3_DB_NOT_POST_0006', { state: db.state, failures: db.failures });
      if (b.failures.length) stop('W3_BUNDLES', { failures: b.failures });
    } else if (source.digest !== C.LIVE.digest || source.head !== C.LIVE.head || b.failures.includes('LIVE_SOURCE_NOT_THE_DEPLOY_PIN')) stop('W3_ROLLBACK_SOURCE_NOT_THE_DEPLOY_PIN', { digest: source.digest });
    const dn = await denoObserve();
    if (dn.failures.length) stop('W3_DENO_OBSERVE_FAILED', { failures: dn.failures });
    const on = revisionSource(dn.current, b.candidate);
    if (which === 'candidate' && on !== 'current') stop('W3_GATEWAY_NOT_ON_THE_LIVE_SOURCE', { current: dn.current?.id, source: on });
    if (which === 'live' && on !== 'candidate') stop('W3_ROLLBACK_CURRENT_NOT_THE_CANDIDATE', { current: dn.current?.id, source: on });
    const body = { assets: source.assets, labels: { 'custom.git_head': source.head, 'custom.bundle_digest': source.digest }, production: true, preview: false };
    R.assertDenoWriteBody('deploy', body);
    if ('env_vars' in body) stop('W3_BODY_CARRIES_ENV');
    const plan = C.PLANS.deploy({ which, previousRevision: dn.current.id, source, env: dn.env.map((e) => `${e.key}${e.secret ? '(secret)' : ''}`) });
    const id = C.planIdOf(plan);
    say(`\nPLAN ${id}: ${plan.step} — ONE production revision of ${C.APP_SLUG}: ${source.manifest.length} files, digest ${source.digest.slice(0, 16)}… (label HEAD ${source.head.slice(0, 12)})\n  request = assets + labels only (no env, no config, no layers); current revision ${dn.current.id} (${on}); DB ${db.state}`);
    const authorization = requirePhrase((which === 'candidate' ? C.PHRASES.w3 : C.PHRASES.w3Rollback)(id));
    const again = await denoObserve();
    if (again.failures.length || again.current?.id !== dn.current.id) stop('W3_STATE_CHANGED_SINCE_PLAN');
    if (which === 'candidate') { const dbAgain = await dbObserve(); if (dbAgain.state !== 'POST_0006' || dbAgain.failures.length) stop('W3_DB_CHANGED_SINCE_PLAN', { state: dbAgain.state }); }
    armed = 'deploy';
    let rev;
    try { rev = revisionView(await deno('POST', `/v2/apps/${C.APP_SLUG}/deploy`, body)); } finally { armed = null; }
    const done = await waitRevision(rev.id);
    const after = await denoObserve();
    const envSame = canon(after.env) === canon(dn.env);
    const live = after.current?.id === rev.id && revisionSource(after.current, b.candidate) === (which === 'candidate' ? 'candidate' : 'current');
    const pr = done?.status === 'succeeded' ? await probes(which === 'candidate' ? 'candidate' : 'current') : null;
    const ok = done?.status === 'succeeded' && live && envSame && !after.failures.length && pr?.pass;
    const step = which === 'candidate' ? 'W3' : 'W3_ROLLBACK';
    const verdict = ok ? `${step}_DONE` : `${step}_POSTCHECK_FAILED`;
    if (ok && which === 'candidate' && deps.deployedPinFile) {
      fs.writeFileSync(deps.deployedPinFile, `${JSON.stringify({ purpose: 'OFFICIALIZATION-V1 + ERROR-CONTRACT-V1 gateway revision on Deno Deploy — public facts only', app: C.APP_SLUG, revision: rev.id, previous_revision: dn.current.id,
        source: { head: source.head, digest: source.digest, files: source.manifest }, env: after.env, deployed_at: new Date(deps.now()).toISOString() }, null, 1)}\n`, { flag: 'wx' });
    }
    writeEvidence(`oec-${step.toLowerCase()}-${stamp()}.json`, { verdict, plan, plan_id: id, authorization, revision: done, before: dn, after, env_unchanged: envSame, live, probes: pr, deno_requests: denoLog });
    if (!ok) stop(verdict, { status: done?.status, live, env_unchanged: envSame, failures: after.failures, probes_failed: pr?.checks.filter((c) => !c.pass).map((c) => c.name) });
    return { verdict, plan_id: id, revision: rev.id };
  }

  return {
    known, dbObserve, denoObserve, denoAudit: async () => denoAudit(await denoObserve()), probes, bundles, g1, w1, w2, w2Rollback, w1Rollback,
    w3: () => deploySource({ which: 'candidate' }),
    w3Rollback: () => deploySource({ which: 'live' }),
    get denoRequests() { return denoLog.slice(); },
    wipe() { known.splice(0); password = null; },
  };
}
