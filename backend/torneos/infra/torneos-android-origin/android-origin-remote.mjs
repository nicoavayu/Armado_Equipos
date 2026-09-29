// ANDROID ORIGIN REMOTE — G1 (read-only), W1 (one gateway revision) and its rollback, with every dependency injected (Deno
// transport, gateway transport, Keychain ring, bundles, clock, operator line reader) so that the offline tests drive exactly
// this code. Fail closed: the source digests are rebuilt from git and checked before any write and again right before it;
// W1 needs the live revision t5vxxvzp1t9f with the live labels, the certified app/env/revision set and the live probes; every
// write needs the exact phrase of its plan id, is sent once (no retry), and is followed by a read-only postcheck. There is no
// database leg: this tooling holds no DB credential and opens no DB connection. Evidence is secret-scanned before it is written.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as C from './android-origin-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as R from '../torneos-gateway-remote/remote-contract.mjs';
import { mintBridgeToken } from '../torneos-gateway-auth/bridge-probe.mjs';
import { makeRemote as makeOecRemote } from '../torneos-officialization-error-v1/oec-remote.mjs';

export class Stop extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }
const stop = (code, detail) => { throw new Stop(code, detail); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function makeRemote(deps) {
  const known = [];
  const remember = (v) => { if (typeof v === 'string' && v.length >= 8 && !known.includes(v)) known.push(v); return v; };
  const redact = (t) => { let s = String(t); for (const k of known) if (k && k.length >= 8) s = s.split(k).join('«REDACTED»'); return s; };
  const say = (s) => deps.say(redact(s));
  const stamp = () => stampOf(deps.now());
  const readOnly = deps.readOnly === true;
  const denoToken = deps.denoToken ? remember(deps.denoToken) : null;
  if (denoToken !== null && !R.DENO_TOKEN_PATTERN.test(denoToken)) stop('DENO_TOKEN_MALFORMED');
  let armed = null;
  const denoLog = [];

  // ── evidence ──
  let seq = 0;
  function writeEvidence(base, body) {
    const name = base.replace(/^ao-/, `ao-${String(++seq).padStart(2, '0')}-`);
    const text = `${JSON.stringify({ tool: 'backend/torneos/infra/torneos-android-origin', app: C.APP_SLUG, ...body }, null, 1)}\n`;
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

  // ── Deno Deploy (gateway-remote allowlist; writes only while armed, never in a read-only session) ──
  async function deno(method, p, body) {
    if (!denoToken) stop('DENO_TOKEN_REQUIRED');
    if (readOnly && method !== 'GET') stop('READ_ONLY_SESSION_REFUSES_WRITE');
    const cls = R.classifyDenoRequest({ method, path: p, body }, { armedFor: armed });
    if (cls.kind !== 'read' && cls.kind !== 'write:deploy') stop('DENO_WRITE_NOT_IN_SCOPE', { id: cls.id });
    let res;
    try { res = await deps.denoTransport({ token: denoToken, method, path: p, body }); } catch (e) { stop('DENO_TRANSPORT_FAILED', { id: cls.id, error: String(e.message).slice(0, 120) }); }
    denoLog.push({ id: cls.id, kind: cls.kind, method, status: res.status });
    if (res.status === 401) stop('DENO_TOKEN_REJECTED', { id: cls.id });
    if (res.status === 403) stop('DENO_TOKEN_PERMISSION_DENIED', { id: cls.id });
    if (![200, 201, 202].includes(res.status)) stop('DENO_API_STATUS_UNEXPECTED', { id: cls.id, status: res.status });
    return res.body;
  }
  const writes = () => denoLog.filter((r) => r.kind !== 'read').length;
  const envPin = () => deps.envPin ?? C.ENV_PIN;
  const list = (b) => (Array.isArray(b) ? b : Array.isArray(b?.items) ? b.items : Array.isArray(b?.data) ? b.data : []);
  const revisionView = (r) => ({ id: r?.id ?? null, status: r?.status ?? null, labels: r?.labels ?? null, created_at: r?.created_at ?? null,
    failure: r?.failure_detail ? { stage: r.failure_detail.stage ?? null, code: r.failure_detail.code ?? null } : null });
  /** Names, flags, contexts and non-secret value digests only; a secret value is never kept (only whether one came back). */
  function envView(envVars) {
    return (envVars ?? []).map((e) => {
      const p = envPin().find((x) => x.key === e.key);
      const v = { key: e.key, secret: e.secret ?? null, contexts: e.contexts ?? null };
      if (!e.secret && typeof e.value === 'string') { v.sha256_16 = C.sha256(e.value).slice(0, 16); v.matches_pin = !!p && !p.secret && p.sha256_16 === v.sha256_16; }
      if (e.secret) v.value_returned = typeof e.value === 'string' && e.value.length > 0 && !/^\*+$/.test(e.value);
      return v;
    }).sort((a, b) => a.key.localeCompare(b.key));
  }
  async function denoObserve() {
    const app = await deno('GET', `/v2/apps/${C.APP_SLUG}`);
    const revs = list(await deno('GET', `/v2/apps/${C.APP_SLUG}/revisions?limit=20`)).map(revisionView);
    const env = envView(app?.env_vars);
    const failures = [];
    if (app?.id !== C.DENO_CERTIFIED.app.id) failures.push('APP_IDENTITY');
    if (app?.slug !== C.APP_SLUG) failures.push('APP_SLUG');
    if (Array.isArray(app?.layers) && app.layers.length) failures.push('APP_LAYERS_PRESENT');
    if (canon(app?.config ?? null) !== canon(C.DENO_CERTIFIED.app.config)) failures.push('APP_CONFIG_DRIFT');
    if (app?.updated_at !== C.DENO_CERTIFIED.app.updated_at) failures.push('APP_UPDATED_AT_MOVED (config/env changed)');
    if (env.length !== C.ENV_COUNT) failures.push(`ENV_COUNT_${env.length}`);
    if (canon(env.map((e) => ({ key: e.key, secret: e.secret, contexts: e.contexts }))) !== canon(envPin().map((e) => ({ key: e.key, secret: e.secret, contexts: e.contexts })))) failures.push('ENV_SHAPE_DRIFT');
    if (env.some((e) => !e.secret && e.matches_pin !== true)) failures.push(`ENV_NON_SECRET_VALUE_DRIFT ${env.filter((e) => !e.secret && e.matches_pin !== true).map((e) => e.key).join(',')}`);
    if (env.some((e) => e.value_returned === true)) failures.push('ENV_SECRET_VALUE_RETURNED');
    const bad = R.forbiddenEnvNames(env.map((e) => e.key));
    if (bad.length) failures.push(`ENV_FORBIDDEN ${bad.join(',')}`);
    const current = revs[0] ?? null;
    if (!current || current.status !== 'succeeded') failures.push('CURRENT_REVISION_NOT_SUCCEEDED');
    return { app: { id: app?.id ?? null, slug: app?.slug ?? null, layers: app?.layers ?? null, config: app?.config ?? null, updated_at: app?.updated_at ?? null },
      env, env_count: env.length, current, revisions: revs.slice(0, 6), failures };
  }
  /** Which pinned source a revision carries (labels written by OEC W3 and by this tooling). */
  const revisionSource = (rev) => {
    const l = rev?.labels ?? {};
    if (l['custom.git_head'] === C.LIVE.head && l['custom.bundle_digest'] === C.LIVE.digest) return 'live';
    if (l['custom.git_head'] === C.CANDIDATE.head && l['custom.bundle_digest'] === C.CANDIDATE.digest) return 'candidate';
    return 'unknown';
  };
  /** Organization + app exactly as the OEC W3 left them (reads only). Required by G1 and by W1. */
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
      ['current revision served on the pinned production domain', !!production && production.domains.includes(cert.production_domain), production],
      ['app id = pin', app?.id === cert.app.id, app?.id ?? null],
      ['app config = certified (dynamic, entrypoint, no crons)', canon(app?.config ?? null) === canon(cert.app.config), app?.config ?? null],
      ['app labels = certified', canon(app?.labels ?? null) === canon(cert.app.labels), app?.labels ?? null],
      ['app created_at = certified', app?.created_at === cert.app.created_at, app?.created_at ?? null],
      ['app updated_at = certified (no config/env change since the variables were set)', app?.updated_at === cert.app.updated_at, app?.updated_at ?? null],
      ['revision set = certified (no revision since OEC W3)', canon(revs.map((r) => r?.id).sort()) === canon([...cert.revisions].sort()), revs.map((r) => r?.id)],
      ['current revision = t5vxxvzp1t9f (same created_at)', cur?.id === C.LIVE.revision && cur?.created_at === C.LIVE.created_at, cur ? { id: cur.id, created_at: cur.created_at ?? null } : null],
      ['current revision succeeded, labels = live source (0f049ef5 + 6c252863…)', cur?.status === 'succeeded' && revisionSource(cur) === 'live', cur ? { status: cur.status, labels: cur.labels ?? null } : null],
    ].map(([name, pass, observedValue]) => ({ name, pass: !!pass, observed: observedValue }));
    return { checks, failures: checks.filter((c) => !c.pass).map((c) => c.name), timelines };
  }
  /** Gateway console volume of the last hour by level (read-only, informational: never a secret, never a message body). */
  async function logsObserve() {
    const end = new Date(deps.now()); const start = new Date(deps.now() - 60 * 60000);
    try {
      const b = await deno('GET', `/v2/apps/${C.APP_SLUG}/logs?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&limit=1000`);
      const lines = list(b);
      const byLevel = {};
      for (const l of lines) byLevel[String(l?.level ?? 'unknown')] = (byLevel[String(l?.level ?? 'unknown')] ?? 0) + 1;
      return { available: true, window_minutes: 60, lines: lines.length, by_level: byLevel, truncated: lines.length >= 1000 };
    } catch (e) { if (e instanceof Stop && ['DENO_API_STATUS_UNEXPECTED', 'DENO_TRANSPORT_FAILED', 'DENO_TOKEN_PERMISSION_DENIED'].includes(e.code)) return { available: false, code: e.code }; throw e; }
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

  // ── probes ──
  // The 66 checks of the live OEC source (OEC tooling, phase 'candidate' = t5vxxvzp1t9f's behavior), reused unchanged: the
  // web origin, B7, Core authority on each request, the allowlists, commerce OFF. Both sources must pass all of them.
  let oec = null;
  const oecProbes = () => (oec ??= makeOecRemote({ say: () => {}, now: deps.now, keychain: deps.keychain, gatewayTransport: deps.gatewayTransport, gatewayBase: deps.gatewayBase,
    jwksPinFile: deps.jwksPinFile, livePin: deps.probeLivePin, evidenceDir: deps.evidenceDir }));
  /**
   * Origin probes. phase 'live' = Android refused (403, no CORS grant); 'candidate' = Android admitted with its own exact CORS
   * grant. Web admitted and the deny list refused on both. No credential except a k1 bridge token minted for a RANDOM identity
   * (the best it reaches is the live Core authority → 401). Nothing is written anywhere.
   */
  async function originProbes(phase, { withRing = true, ring = null } = {}) {
    const base = deps.gatewayBase ?? C.GATEWAY_BASE;
    const t = deps.gatewayTransport;
    const checks = [];
    const hdr = (r, k) => { const v = r?.headers?.[k]; return Array.isArray(v) ? v.join(', ') : (v ?? null); };
    const add = (name, pass, r) => { checks.push({ name, pass: !!pass, status: r?.status ?? null, error: r?.json?.error ?? r?.error ?? null, acao: hdr(r, 'access-control-allow-origin'), cache: hdr(r, 'cache-control') }); return r; };
    for (const origin of [C.WEB_ORIGIN, C.ANDROID_ORIGIN, ...C.DENY_ORIGINS]) {
      const allowed = origin === C.WEB_ORIGIN || (origin === C.ANDROID_ORIGIN && phase === 'candidate');
      const h = await t({ url: `${base}/health`, headers: { origin } });
      const pre = await t({ url: `${base}/exchange`, method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
      const ex = await t({ url: `${base}/exchange`, method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
      const vary = String(hdr(h, 'vary') ?? '').toLowerCase().split(/\s*,\s*/).includes('origin');
      if (allowed) {
        add(`${origin} GET /health → 200 ready, CORS grant = exactly ${origin}, Vary: Origin, no-store`, h.status === 200 && h.json?.ready === true && hdr(h, 'access-control-allow-origin') === origin && vary && hdr(h, 'cache-control') === 'no-store', h);
        add(`${origin} preflight OPTIONS /exchange → 204, CORS grant = exactly ${origin}, authorization allowed`, pre.status === 204 && hdr(pre, 'access-control-allow-origin') === origin && /(^|,\s*)authorization(\s*,|$)/.test(String(hdr(pre, 'access-control-allow-headers') ?? '')), pre);
        add(`${origin} POST /exchange without bearer → 401 (the origin is not a credential), CORS grant = ${origin}`, ex.status === 401 && hdr(ex, 'access-control-allow-origin') === origin, ex);
      } else {
        add(`${origin} GET /health → 403 origin rejected, no CORS grant`, h.status === 403 && h.json?.error === 'origin rejected' && !hdr(h, 'access-control-allow-origin'), h);
        add(`${origin} preflight OPTIONS /exchange → 403, no CORS grant`, pre.status === 403 && !hdr(pre, 'access-control-allow-origin'), pre);
        add(`${origin} POST /exchange → 403 origin rejected (before any auth), no CORS grant`, ex.status === 403 && ex.json?.error === 'origin rejected' && !hdr(ex, 'access-control-allow-origin'), ex);
      }
    }
    if (withRing && ring) {
      const now = Math.floor(Date.now() / 1000);
      const tok = mintBridgeToken({ ...ring.k1, now, overrides: { sub: crypto.randomUUID(), core_user_id: crypto.randomUUID() } });
      const r = await t({ url: `${base}/torneos/rest/v1/rpc/get_my_tournament_memberships`, method: 'POST', headers: { origin: C.ANDROID_ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: '{}' });
      if (phase === 'candidate') add('https://localhost allowlisted RPC, valid k1 token, Core user that does not exist → 401 access denied (Core authority reached from Android), no-store', r.status === 401 && r.json?.error === 'access denied' && hdr(r, 'cache-control') === 'no-store' && hdr(r, 'access-control-allow-origin') === C.ANDROID_ORIGIN, r);
      else add('https://localhost allowlisted RPC, valid k1 token → 403 origin rejected (before auth)', r.status === 403 && r.json?.error === 'origin rejected' && !hdr(r, 'access-control-allow-origin'), r);
    }
    return checks;
  }
  function readRing() {
    const pin = JSON.parse(fs.readFileSync(deps.jwksPinFile ?? G.JWKS_PIN_FILE, 'utf8'));
    return { k1: { pkcs8: remember(deps.keychain.ring('k1', pin.active)), kid: pin.active } };
  }
  async function probes(phase, { withRing = true } = {}) {
    if (!['live', 'candidate'].includes(phase)) stop('PROBE_PHASE_UNKNOWN');
    const base = await oecProbes().probes('candidate', { withRing });
    for (const k of oecProbes().known) remember(k);
    const origin = await originProbes(phase, { withRing, ring: withRing ? readRing() : null });
    const statuses = [...base.checks, ...origin].map((c) => c.status).filter((s) => s !== null && s !== undefined);
    const no5xx = { name: 'no probe answer is 5xx or a transport failure', pass: statuses.every((s) => s > 0 && s < 500), status: null, statuses_5xx: statuses.filter((s) => s === 0 || s >= 500).length };
    const leaks = G.secretFindings(JSON.stringify(origin), known);
    const clean = { name: 'no origin-probe result carries a secret this process holds', pass: leaks.length === 0 };
    const originChecks = [...origin, no5xx, clean];
    const pass = base.pass && originChecks.every((c) => c.pass);
    return { phase, base: { passed: base.passed, total: base.total, pass: base.pass, checks: base.checks }, origin: { passed: originChecks.filter((c) => c.pass).length, total: originChecks.length, checks: originChecks }, pass };
  }
  const probeFailures = (pr) => [...pr.base.checks, ...pr.origin.checks].filter((c) => !c.pass).map((c) => c.name);

  // ── bundles (both from git, built twice, equal to the pins) ──
  function bundles() {
    const candidate = deps.buildCandidate(); const candidateAgain = deps.buildCandidate();
    const live = deps.buildLive(); const liveAgain = deps.buildLive();
    const pin = C.readJson(deps.candidatePinFile ?? C.CANDIDATE_PIN_FILE);
    const livePin = C.readLiveDeployPin();
    const failures = [];
    if (candidateAgain.digest !== candidate.digest || liveAgain.digest !== live.digest) failures.push('SOURCE_NOT_DETERMINISTIC');
    if (candidate.digest !== C.CANDIDATE.digest || candidate.head !== C.CANDIDATE.head || candidate.manifest.length !== C.CANDIDATE.files) failures.push('CANDIDATE_DIGEST_NOT_THE_PIN');
    if (!pin || pin.digest !== C.CANDIDATE.digest || pin.source_commit !== C.CANDIDATE.head || pin.files !== C.CANDIDATE.files || canon(pin.manifest) !== canon(candidate.manifest)) failures.push('CANDIDATE_NOT_THE_PIN_FILE');
    if (live.digest !== C.LIVE.digest || live.head !== C.LIVE.head || live.manifest.length !== C.LIVE.files) failures.push('LIVE_DIGEST_NOT_THE_PIN');
    if (canon(live.manifest) !== canon(livePin.source.files)) failures.push('LIVE_MANIFEST_NOT_THE_DEPLOY_PIN');
    const delta = {
      added: candidate.manifest.filter((m) => !live.manifest.some((l) => l.path === m.path)).map((m) => m.path),
      changed: candidate.manifest.filter((m) => live.manifest.some((l) => l.path === m.path && l.sha256 !== m.sha256)).map((m) => m.path).sort(),
      removed: live.manifest.filter((l) => !candidate.manifest.some((m) => m.path === l.path)).map((l) => l.path),
    };
    if (canon(delta) !== canon(C.CANDIDATE.delta)) failures.push('CANDIDATE_DELTA_NOT_THE_PIN');
    const view = { candidate: { head: candidate.head, digest: candidate.digest, files: candidate.manifest.length }, live: { head: live.head, digest: live.digest, files: live.manifest.length }, delta };
    return { candidate, live, failures, view };
  }

  // ── offline plan (no network, no credential) ──
  function planOffline() {
    const b = bundles();
    const w1 = C.PLANS.deploy({ which: 'candidate', previousRevision: C.LIVE.revision, source: b.candidate, env: C.envNamesOf(C.ENV_PIN) });
    return { verdict: b.failures.length ? 'PLAN_OFFLINE_FAILED' : 'PLAN_OFFLINE_OK', failures: b.failures, bundle: b.view, w1_plan: w1, w1_plan_id: C.planIdOf(w1), w1_phrase: C.PHRASES.w1(C.planIdOf(w1)),
      rollback: { to: { head: C.LIVE.head, digest: C.LIVE.digest, files: C.LIVE.files }, phrase_format: C.PHRASES.rollback('<plan id printed by the session>'), note: 'the rollback plan id binds the W1 revision id, so it is known only after W1' } };
  }

  // ── G1 ──
  async function g1({ withDeno = !!denoToken, withRing = true } = {}) {
    const b = bundles();
    const failures = [...b.failures];
    const warnings = [];
    let dn = null; let logs = null;
    if (withDeno) {
      dn = await denoObserve();
      failures.push(...dn.failures.map((x) => `DENO_${x}`));
      if (dn.current?.id !== C.LIVE.revision) failures.push('DENO_CURRENT_REVISION_NOT_t5vxxvzp1t9f');
      if (revisionSource(dn.current) !== 'live') failures.push('DENO_CURRENT_SOURCE_LABEL_NOT_THE_LIVE_DIGEST');
      dn.audit = await denoAudit(dn);
      failures.push(...dn.audit.failures.map((x) => `DENO_AUDIT ${x}`));
      logs = await logsObserve();
      if (!logs.available) warnings.push(`DENO_LOGS_UNAVAILABLE ${logs.code}`);
      else if (logs.by_level.error) warnings.push(`DENO_LOGS_ERROR_LINES_LAST_HOUR ${logs.by_level.error}`);
    }
    const pr = await probes('live', { withRing });
    if (!pr.pass) failures.push(`PROBES_FAILED ${probeFailures(pr).join(' | ').slice(0, 600)}`);
    if (writes()) failures.push('G1_ISSUED_A_WRITE');
    const verdict = failures.length ? 'G1_FAILED' : (withDeno ? 'G1_PASS' : 'G1_PASS_WITHOUT_DENO_OBSERVATION');
    const expected = C.PLANS.deploy({ which: 'candidate', previousRevision: C.LIVE.revision, source: b.candidate, env: dn ? C.envNamesOf(dn.env) : C.envNamesOf(C.ENV_PIN) });
    writeEvidence(`ao-g1-${stamp()}.json`, { verdict, read_only: true, writes: writes(), db: 'not connected', bundle: b.view, deno: dn, logs, probes: pr, deno_requests: denoLog, failures, warnings,
      expected_w1_plan_id: C.planIdOf(expected) });
    return { verdict, failures, warnings, probes: { base: `${pr.base.passed}/${pr.base.total}`, origin: `${pr.origin.passed}/${pr.origin.total}` }, current: dn?.current?.id ?? null, env_count: dn?.env_count ?? null, expected_w1_plan_id: C.planIdOf(expected) };
  }

  // ── W1 / rollback: one production revision, assets + labels only ──
  async function deploySource({ which, dryRun = false }) {
    const step = which === 'candidate' ? 'W1' : 'ROLLBACK';
    if (readOnly && !dryRun) stop('READ_ONLY_SESSION_REFUSES_WRITE', { step });
    if (!denoToken) stop('DENO_TOKEN_REQUIRED');
    const b = bundles();
    if (b.failures.length) stop(`${step}_SOURCE_DIGEST_REFUSED`, { failures: b.failures });
    const source = which === 'candidate' ? b.candidate : b.live;
    const pinned = which === 'candidate' ? C.CANDIDATE : C.LIVE;
    if (source.digest !== pinned.digest || source.head !== pinned.head || source.manifest.length !== pinned.files) stop(`${step}_SOURCE_DIGEST_REFUSED`, { digest: source.digest });
    const dn = await denoObserve();
    if (dn.failures.length) stop(`${step}_DENO_OBSERVE_FAILED`, { failures: dn.failures });
    const on = revisionSource(dn.current);
    let before = null;
    if (which === 'candidate') {
      if (dn.current?.id !== C.LIVE.revision || on !== 'live') stop('W1_LIVE_REVISION_UNEXPECTED', { current: dn.current?.id ?? null, source: on });
      const audit = await denoAudit(dn);
      if (audit.failures.length) stop('W1_DENO_AUDIT_FAILED', { failures: audit.failures });
      before = await probes('live');
      if (!before.pass) stop('W1_LIVE_PROBES_FAILED', { failed: probeFailures(before) });
    } else if (on !== 'candidate') stop('ROLLBACK_CURRENT_NOT_THE_CANDIDATE', { current: dn.current?.id ?? null, source: on });
    const body = { assets: source.assets, labels: { 'custom.git_head': source.head, 'custom.bundle_digest': source.digest }, production: true, preview: false };
    R.assertDenoWriteBody('deploy', body);
    if ('env_vars' in body || 'config' in body || 'layers' in body) stop(`${step}_BODY_OUT_OF_SCOPE`);
    const plan = C.PLANS.deploy({ which, previousRevision: dn.current.id, source, env: C.envNamesOf(dn.env) });
    const id = C.planIdOf(plan);
    say(`\nPLAN ${id}: ${plan.step} — ONE production revision of ${C.APP_SLUG}: ${source.manifest.length} files, digest ${source.digest.slice(0, 16)}… (label HEAD ${source.head.slice(0, 12)})\n  request = assets + labels only (no env, no config, no layers); env ${dn.env_count}/${C.ENV_COUNT} unchanged; no DB, no Core, no Vercel\n  current revision ${dn.current.id} (${on})${before ? `; probes ${before.base.passed}/${before.base.total} + origin ${before.origin.passed}/${before.origin.total}` : ''}`);
    if (dryRun) {
      if (writes()) stop('DRY_RUN_ISSUED_A_WRITE');
      writeEvidence(`ao-${step.toLowerCase()}-plan-${stamp()}.json`, { verdict: `${step}_PLAN_ONLY`, writes: 0, plan, plan_id: id, phrase: (which === 'candidate' ? C.PHRASES.w1 : C.PHRASES.rollback)(id), before: dn, probes_before: before, deno_requests: denoLog });
      return { verdict: `${step}_PLAN_ONLY`, plan_id: id, phrase: (which === 'candidate' ? C.PHRASES.w1 : C.PHRASES.rollback)(id), writes: 0 };
    }
    const authorization = requirePhrase((which === 'candidate' ? C.PHRASES.w1 : C.PHRASES.rollback)(id));
    // Immediate pre-write recheck: same revision, no drift, the source rebuilt from git still has the pinned digest.
    const again = await denoObserve();
    if (again.failures.length || again.current?.id !== dn.current.id || canon(again.env) !== canon(dn.env)) stop(`${step}_STATE_CHANGED_SINCE_PLAN`);
    const fresh = which === 'candidate' ? deps.buildCandidate() : deps.buildLive();
    if (fresh.digest !== source.digest || fresh.digest !== pinned.digest) stop(`${step}_SOURCE_CHANGED_SINCE_PLAN`);
    const writesBefore = writes();
    armed = 'deploy';
    let rev;
    try { rev = revisionView(await deno('POST', `/v2/apps/${C.APP_SLUG}/deploy`, body)); } finally { armed = null; }
    const done = await waitRevision(rev.id);
    const after = await denoObserve();
    const envSame = canon(after.env) === canon(dn.env) && after.env_count === C.ENV_COUNT;
    const live = after.current?.id === rev.id && revisionSource(after.current) === (which === 'candidate' ? 'candidate' : 'live');
    const pr = done?.status === 'succeeded' ? await probes(which === 'candidate' ? 'candidate' : 'live') : null;
    const ok = done?.status === 'succeeded' && live && envSame && !after.failures.length && pr?.pass && writes() - writesBefore === 1;
    const verdict = ok ? `${step}_DONE` : `${step}_POSTCHECK_FAILED`;
    if (ok && which === 'candidate' && deps.deployedPinFile) {
      fs.writeFileSync(deps.deployedPinFile, `${JSON.stringify({ purpose: 'ANDROID-ORIGIN gateway revision on Deno Deploy — public facts only', app: C.APP_SLUG, revision: rev.id, previous_revision: dn.current.id,
        source: { head: source.head, digest: source.digest, files: source.manifest }, env: after.env, deployed_at: new Date(deps.now()).toISOString() }, null, 1)}\n`, { flag: 'wx' });
    }
    writeEvidence(`ao-${step.toLowerCase()}-${stamp()}.json`, { verdict, plan, plan_id: id, authorization, revision: done, before: dn, after, env_unchanged: envSame, live, probes_before: before, probes_after: pr, deno_requests: denoLog });
    if (!ok) stop(verdict, { status: done?.status, live, env_unchanged: envSame, failures: after.failures, probes_failed: pr ? probeFailures(pr) : null });
    return { verdict, plan_id: id, revision: rev.id, probes: { base: `${pr.base.passed}/${pr.base.total}`, origin: `${pr.origin.passed}/${pr.origin.total}` } };
  }

  return {
    known, readOnly, bundles, planOffline, denoObserve, denoAudit: async () => denoAudit(await denoObserve()), logsObserve, probes, g1,
    w1Plan: () => deploySource({ which: 'candidate', dryRun: true }),
    rollbackPlan: () => deploySource({ which: 'live', dryRun: true }),
    w1: () => deploySource({ which: 'candidate' }),
    rollback: () => deploySource({ which: 'live' }),
    get denoRequests() { return denoLog.slice(); },
    wipe() { known.splice(0); oec?.wipe(); },
  };
}
