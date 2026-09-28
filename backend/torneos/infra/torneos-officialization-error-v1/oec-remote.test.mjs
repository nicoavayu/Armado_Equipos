// OFFICIALIZATION + ERROR-CONTRACT REMOTE — offline tests of the tooling. No network: the database, the Deno Deploy API and
// Core are fakes/emulations; the gateway is the REAL handle() of both sources (live ee34b2a7 from git, candidate tree).
//   node --test backend/torneos/infra/torneos-officialization-error-v1/oec-remote.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from './oec-remote-contract.mjs';
import * as CV1 from '../torneos-competition-v1/competition-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as R from '../torneos-gateway-remote/remote-contract.mjs';
import { mintBridgeToken } from '../torneos-gateway-auth/bridge-probe.mjs';
import { makeRemote, readOnlyEnv, installerEnv, REFUSALS } from './oec-remote.mjs';
import { runCommand } from './oec-session.mjs';
import { buildCandidate, buildLive } from './oec-bundle.mjs';
import { fixtureEnv, gatewayPair, fakeDeno, fakeDb, fakeDeltaPin, contractState } from './test-support.mjs';

const DENO_TOKEN = `ddo_${crypto.randomBytes(24).toString('base64url')}`;
const INSTALLER_PW = crypto.randomBytes(30).toString('base64url');
const REAL_PIN = JSON.parse(fs.readFileSync(C.DELTA_PIN_FILE, 'utf8'));
const CAND_PIN = JSON.parse(fs.readFileSync(C.CANDIDATE_PIN_FILE, 'utf8'));
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

test('pins: migration + rollback bytes, 0000–0005 byte-identical, function sets, counts, phrases, read-only SQL, delta pin consistent', () => {
  assert.deepEqual(C.migrationDrift(), []);
  for (const m of [...C.APPLIED, C.M0005, C.M0006, C.R0005, C.R0006]) C.assertFileHash(m.file, m.sha256);
  assert.equal(C.M0005.sha256, '51fe200f2124e786345a85e5dbadfc844765db550a7f8cc837adefbddf0aeb78');
  assert.equal(C.M0006.sha256, '767d57e8fb96ca69cd9d3b9379c0c3135652c8cb7bc07d83d81d1d815e0f3cc3');
  assert.throws(() => C.assertFileHash(C.M0005.file, C.M0006.sha256), /file_hash_mismatch/);
  assert.deepEqual([C.GRANTED_0004.length, C.CLOSED.length, C.NEW_0005.length, C.REPLACED_0005.length, C.EC_PINS.length, C.ALL_SIGS.length], [15, 23, 9, 3, 18, 60]);
  assert.deepEqual([C.COUNTS.post0004, C.COUNTS.post0005, C.COUNTS.anon], [162, 171, 12]);
  assert.deepEqual(C.REPLACED_0005.map((r) => r.before.slice(0, 8)), ['4f43a729', '2f43290e', '488ca6bb']);
  // 0006 depends on 0005: it replaces a function 0005 creates; the 0005 file refuses anything but POST_0004 / its own post-state.
  assert.ok(C.EC_PINS.some((p) => p.fn === C.DUAL_CONTROL_FN) && C.NEW_0005.includes(C.DUAL_CONTROL_FN));
  const m5 = fs.readFileSync(path.join(C.REPO_ROOT, C.M0005.file), 'utf8');
  assert.match(m5, /re-apply is a no-op/);
  assert.ok(!/;/.test(C.STATE_SQL));
  assert.match(C.readOnlyScript(C.STATE_SQL), /^BEGIN TRANSACTION READ ONLY;\n[\s\S]+;\nROLLBACK;\n$/);
  assert.equal(C.PHRASES.w1('abc123abc123'), 'APPLY TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 onzpwnqxnvlgsevivngf abc123abc123');
  assert.equal(C.PHRASES.w2('abc123abc123'), 'APPLY TORNEOS MIGRATION 0006 ERROR-CONTRACT-V1 onzpwnqxnvlgsevivngf abc123abc123');
  assert.equal(C.PHRASES.w3('abc123abc123'), 'DEPLOY TORNEOS GATEWAY OFFICIALIZATION-ERROR-CONTRACT torneos-gateway abc123abc123');
  assert.equal(C.PHRASES.w3Rollback('abc123abc123'), 'ROLLBACK TORNEOS GATEWAY torneos-gateway TO ee34b2a7 abc123abc123');
  assert.equal(new Set(Object.values(C.PHRASES).map((f) => f('x').split(' ').slice(0, 5).join(' '))).size, 6, 'one phrase per write boundary');
  assert.deepEqual(C.ENV_SHAPE.map((e) => e.key), [...R.ENV_NAMES]);
  // psql env: pinned pooler, verify-full, installer.<ref>; reads carry the server-side read-only default, writes do not.
  const ro = readOnlyEnv({ password: INSTALLER_PW });
  assert.deepEqual([ro.PGHOST, ro.PGPORT, ro.PGUSER, ro.PGSSLMODE, ro.PGOPTIONS], [C.POOLER_HOST, '5432', `postgres.${C.TORNEOS_REF}`, 'verify-full', '-c default_transaction_read_only=on']);
  assert.ok(!('PGOPTIONS' in installerEnv({ password: INSTALLER_PW, app: 'x' })));
  // Delta pin: derived from the certified files on the same image; consistent with both contracts and COMPETITION-V1.
  assert.deepEqual(REAL_PIN.files, { m0005: C.M0005.sha256, m0006: C.M0006.sha256, r0005: C.R0005.sha256, r0006: C.R0006.sha256 });
  assert.equal(REAL_PIN.state_sql_sha256, C.sha256(C.STATE_SQL));
  assert.equal(REAL_PIN.catalog_sql_sha256, C.sha256(G.CATALOG_SQL));
  assert.deepEqual(Object.keys(REAL_PIN.states).sort(), Object.values(C.STATE_KEYS).sort());
  const cv1 = JSON.parse(fs.readFileSync(path.join(C.REPO_ROOT, 'backend/torneos/infra/torneos-competition-v1/pins/competition-v1-db-delta.json'), 'utf8'));
  for (const p of CV1.CV1_CATALOG_PATHS) assert.equal(canon(REAL_PIN.states.post_0004[p]), canon(cv1.states.post[p]), `POST_0004 ${p} = the COMPETITION-V1 post pin Production matched`);
  assert.equal(canon(REAL_PIN.states.post_0006.execute), canon(REAL_PIN.states.post_0005.execute), '0006 changes no grant');
  assert.equal(canon(REAL_PIN.states.post_0006.acl_md5), canon(REAL_PIN.states.post_0005.acl_md5));
  assert.equal(canon(REAL_PIN.states.rolled_back_0005.execute), canon(REAL_PIN.states.post_0004.execute), 'the 0005 rollback restores the POST_0004 grants');
  assert.equal(REAL_PIN.states.post_0005.execute.authenticated.count - REAL_PIN.states.post_0004.execute.authenticated.count, 9);
  assert.equal(REAL_PIN.states.post_0005.execute.anon.count, REAL_PIN.states.post_0004.execute.anon.count);
  // Plans are pure: same inputs → same id; any input change → another id.
  const counts = { authenticated_public: 162, anon_public: 12 };
  assert.equal(C.planIdOf(C.PLANS.w1({ counts })), C.planIdOf(C.PLANS.w1({ counts })));
  assert.notEqual(C.planIdOf(C.PLANS.w1({ counts })), C.planIdOf(C.PLANS.w1({ counts: { ...counts, anon_public: 13 } })));
});

test('state machine: POST_0004 / POST_0005 / POST_0006 / ROLLED_BACK_0005 exactly; every partial or unexpected state is DRIFT', () => {
  for (const s of ['POST_0004', 'POST_0005', 'POST_0006', 'ROLLED_BACK_0005']) assert.equal(C.classifyState(contractState(s, REAL_PIN), REAL_PIN).state, s, s);
  assert.equal(C.classifyState(contractState('RAW_0005_ON_POST_0006', REAL_PIN), REAL_PIN).state, 'DRIFT', 'a raw 0005 on POST_0006 (partial 0006) is DRIFT');
  const fnOf = (s, sig) => s.functions.find((x) => x.sig === sig);
  const drift = (base, mut) => { const s = contractState(base, REAL_PIN); mut(s); return C.classifyState(s, REAL_PIN); };
  const cases = [
    ['POST_0004', 'partial 0005: column only', (s) => { s.column = { exists: true, data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }; }],
    ['POST_0004', 'partial 0005: capability row only', (s) => { s.capability = ['owner']; }],
    ['POST_0004', 'partial 0005: one new RPC', (s) => { Object.assign(fnOf(s, C.NEW_0005[0]), { exists: true, ...REAL_PIN.function_attrs[C.NEW_0005[0]], authenticated: true, service_role: true, body_md5: REAL_PIN.new_function_bodies[C.NEW_0005[0]] }); s.counts.authenticated_public = 163; }],
    ['POST_0004', 'partial 0005: one replaced body', (s) => { fnOf(s, C.REPLACED_0005[0].fn).body_md5 = C.REPLACED_0005[0].after; }],
    ['POST_0005', 'partial 0005: a new RPC missing', (s) => { Object.assign(fnOf(s, C.NEW_0005[3]), { exists: false }); s.counts.authenticated_public = 170; }],
    ['POST_0005', 'partial 0006: one of 18 bodies', (s) => { fnOf(s, C.EC_PINS[4].fn).body_md5 = C.EC_PINS[4].after; }],
    ['POST_0006', 'partial 0006: one body back', (s) => { fnOf(s, C.EC_PINS[0].fn).body_md5 = C.EC_PINS[0].before; }],
    ['POST_0006', 'a function still raises 40001', (s) => { s.error_sweep.raises_40001 = 1; }],
    ['POST_0005', 'unexpected body hash (third state)', (s) => { fnOf(s, C.EC_PINS[2].fn).body_md5 = '0'.repeat(32); }],
    ['POST_0005', 'unexpected new-RPC body', (s) => { fnOf(s, C.NEW_0005[1]).body_md5 = 'f'.repeat(32); }],
    ['POST_0004', 'COMPETITION-V1 fix body changed', (s) => { fnOf(s, Object.keys(C.FIX_AFTER)[0]).body_md5 = '1'.repeat(32); }],
    ['POST_0004', 'wrong owner', (s) => { fnOf(s, C.GRANTED_0004[2]).owner = 'supabase_admin'; }],
    ['POST_0006', 'wrong owner on a new RPC', (s) => { fnOf(s, C.NEW_0005[0]).owner = 'supabase_admin'; }],
    ['POST_0004', 'unexpected grant: a closed function opened', (s) => { Object.assign(fnOf(s, C.CLOSED[0]), { authenticated: true, grantees: ['authenticated', 'postgres', 'service_role'] }); }],
    ['POST_0005', 'unexpected grantee on a new RPC', (s) => { fnOf(s, C.NEW_0005[2]).grantees = ['authenticated', 'postgres', 'service_role', 'torneos_identity_writer']; }],
    ['POST_0005', 'anon executes a new RPC', (s) => { fnOf(s, C.NEW_0005[0]).anon = true; }],
    ['POST_0004', 'anon count drift', (s) => { s.counts.anon_public = 13; }],
    ['POST_0005', 'authenticated count drift', (s) => { s.counts.authenticated_public = 172; }],
    ['POST_0004', 'PUBLIC executes', (s) => { fnOf(s, C.GRANTED_0004[1]).public = true; }],
    ['POST_0004', 'server role executes an RPC', (s) => { fnOf(s, C.GRANTED_0004[3]).server_roles = ['torneos_payment_service']; }],
    ['POST_0005', 'authorizer executable by authenticated', (s) => { s.authorize_core_contract.authenticated = true; }],
    ['POST_0005', 'invitations table readable by authenticated', (s) => { s.invitations.client_privileges = ['authenticated:SELECT']; }],
    ['POST_0005', 'invitations table without RLS', (s) => { s.invitations.rls = false; }],
    ['POST_0005', 'capability granted to admin too', (s) => { s.capability = ['admin', 'owner']; }],
    ['POST_0005', 'column nullable', (s) => { s.column.is_nullable = 'YES'; }],
    ['POST_0004', 'definer dropped', (s) => { fnOf(s, C.GRANTED_0004[4]).definer = false; }],
    ['POST_0004', 'session not read-only', (s) => { s.read_only = 'off'; }],
    ['POST_0004', 'a function missing from the report', (s) => { s.functions.pop(); }],
  ];
  for (const [base, name, mut] of cases) assert.equal(drift(base, mut).state, 'DRIFT', name);
  assert.equal(C.classifyState(null, REAL_PIN).state, 'DRIFT');
  assert.equal(C.classifyState(contractState('POST_0004', REAL_PIN), { ...REAL_PIN, new_function_bodies: {} }).state, 'DRIFT', 'missing pins never certify');
  assert.equal(C.classifyState(contractState('POST_0004', REAL_PIN), { ...REAL_PIN, new_function_bodies: { ...REAL_PIN.new_function_bodies, [C.DUAL_CONTROL_FN]: '0'.repeat(32) } }).state, 'DRIFT');
});

test('bundles: live rebuilt from git = the deploy pin (16 files, 75e3535a…); candidate deterministic = the pin (17 files); delta = allowlist + 3 files; commerce allowlist untouched', () => {
  const live = buildLive();
  assert.equal(live.digest, C.LIVE.digest); assert.equal(live.manifest.length, 16); assert.equal(live.head, C.LIVE.head);
  assert.deepEqual(live.manifest, C.readLiveDeployPin().source.files);
  const a = buildCandidate({ requireClean: false }); const b = buildCandidate({ requireClean: false });
  assert.equal(a.digest, b.digest, 'deterministic');
  assert.equal(a.digest, CAND_PIN.digest); assert.equal(a.manifest.length, CAND_PIN.files); assert.deepEqual(a.manifest, CAND_PIN.manifest);
  assert.equal(CAND_PIN.digest, '6c252863fd94bcad0f785af9bb3636d09b2bc2265baafb0af2a771efdb6143a4');
  const changed = a.manifest.filter((m) => live.manifest.some((l) => l.path === m.path && l.sha256 !== m.sha256)).map((m) => m.path).sort();
  const added = a.manifest.filter((m) => !live.manifest.some((l) => l.path === m.path)).map((m) => m.path);
  assert.deepEqual(added, ['torneos-gateway/officialization-v1-rpc-allowlist.json']);
  assert.deepEqual(changed, ['torneos-gateway/adapter.ts', 'torneos-gateway/competition.ts', 'torneos-gateway/index.ts']);
  for (const f of ['commerce.ts', 'commerce-test-rpc-allowlist.json', 'competition-v1-rpc-allowlist.json', 'staging-v1-rpc-allowlist.json', 'token.ts', 'config.ts', 'db.ts', 'core-client.ts']) {
    assert.equal(a.manifest.find((m) => m.path === `torneos-gateway/${f}`)?.sha256, live.manifest.find((m) => m.path === `torneos-gateway/${f}`)?.sha256, `${f} unchanged`);
  }
  const index = a.assets['torneos-gateway/index.ts'].content;
  assert.match(index, /signal: AbortSignal\.timeout\(5000\) \}\)\n {2}const out: Record<string, string> = \{ "content-type": [^\n]+\.\.\.NO_STORE, \.\.\.cors \}/, '5 s timeout + no-store on the proxy');
  assert.match(index, /status: domainErrorStatus\(r\.status, payload\)/);
  for (const s of [live, a]) assert.ok(R.assertDenoWriteBody('deploy', { assets: s.assets, labels: { 'custom.git_head': s.head, 'custom.bundle_digest': s.digest }, production: true, preview: false }));
  assert.throws(() => R.assertDenoWriteBody('deploy', { assets: a.assets, labels: {}, production: true, preview: false, env_vars: [] }), /deploy_shape/);
});

async function harness({ mutate = () => {}, deltaPin = fakeDeltaPin(REAL_PIN) } = {}) {
  const fx = fixtureEnv();
  const gw = await gatewayPair(fx.env);
  const cand = buildCandidate({ requireClean: false });
  const deno = fakeDeno({ env: fx.env, livePin: fx.livePin, gateway: gw, candidateDigest: cand.digest });
  const db = fakeDb({ deltaPin });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-oec-test-'));
  const files = { delta: path.join(tmp, 'delta.json'), cand: path.join(tmp, 'cand.json'), jwks: path.join(tmp, 'jwks.json'), deployed: path.join(tmp, 'deployed.json'), ev: path.join(tmp, 'ev') };
  fs.writeFileSync(files.delta, JSON.stringify(deltaPin)); fs.writeFileSync(files.cand, JSON.stringify({ digest: cand.digest, files: cand.manifest.length })); fs.writeFileSync(files.jwks, JSON.stringify(fx.jwksPin));
  const lines = []; const said = [];
  const deps = {
    say: (s) => said.push(s), readLine: () => { const l = lines.shift(); if (l === 'PLAN') { const m = /To proceed the operator must send exactly:\n {2}(.+)$/.exec(said.at(-1) ?? ''); return m ? m[1] : ''; } return l ?? ''; },
    denoToken: DENO_TOKEN, now: () => Date.now(), sleep: async () => {}, pollMs: 1,
    psql: db.psql, applySql: db.applySql, keychain: { installerPassword: () => INSTALLER_PW, ring: (slot, kid) => { assert.equal(slot, 'k1'); assert.equal(kid, fx.jwksPin.active); return fx.k1.pkcs8; } },
    denoTransport: deno.transport, gatewayTransport: gw.transport, gatewayBase: C.GATEWAY_BASE,
    buildCandidate: () => cand, buildLive: () => buildLive(),
    evidenceDir: files.ev, deltaPinFile: files.delta, candidatePinFile: files.cand, jwksPinFile: files.jwks, deployedPinFile: files.deployed, livePin: fx.livePin,
  };
  mutate(deps);
  const remote = makeRemote(deps);
  const secrets = [...fx.secrets, DENO_TOKEN, INSTALLER_PW];
  const evidenceText = () => (fs.existsSync(files.ev) ? fs.readdirSync(files.ev).map((f) => fs.readFileSync(path.join(files.ev, f), 'utf8')).join('\n') : '');
  return { fx, gw, deno, db, remote, lines, said, files, secrets, evidenceText, cand,
    cleanup: async () => { await gw.cleanup(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
const stopCode = async (p) => { try { await p; return 'NO_STOP'; } catch (e) { return e.code ?? String(e.message); } };

test('gateway (REAL handle() of both sources): probes discriminate; officialization RPCs authenticated-only; Core authority per request; error defense; genuine 500 / timeout 503 preserved', async () => {
  const h = await harness();
  try {
    const cur = await h.remote.probes('current');
    assert.deepEqual(cur.checks.filter((c) => !c.pass).map((c) => c.name), []);
    assert.ok(!(await h.remote.probes('candidate')).pass, 'candidate expectations fail on the live source');
    h.gw.state.live = 'candidate';
    const cand = await h.remote.probes('candidate');
    assert.deepEqual(cand.checks.filter((c) => !c.pass).map((c) => c.name), []);
    assert.ok(!(await h.remote.probes('current')).pass, 'live expectations fail on the candidate');
    assert.ok(cand.total >= 60, `candidate probes ${cand.total}`);
    assert.deepEqual(G.secretFindings(JSON.stringify([cur, cand]), h.secrets), []);

    // A signed-in user (live Core session) reaching PostgREST through the generic route.
    const now = Math.floor(Date.now() / 1000);
    const tok = mintBridgeToken({ ...h.fx.k1, now, overrides: { sub: crypto.randomUUID(), core_user_id: crypto.randomUUID() } });
    const call = (rpc) => h.gw.transport({ url: `${C.GATEWAY_BASE}/torneos/rest/v1/rpc/${rpc}`, method: 'POST', headers: { origin: G.WEB_ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: '{}' });
    h.gw.upstream.coreSession = 'active';
    const answers = [
      ['legacy 55000 contract message → 409 (candidate) / 500 (live)', { status: 500, body: '{"code":"55000","details":null,"hint":null,"message":"TORNEOS_QUALIFICATION_INCOMPLETE"}' }, 409, 500],
      ['legacy 54000 rate limit → 429 / 500', { status: 500, body: '{"code":"54000","details":null,"hint":null,"message":"TORNEOS_PUBLISH_RATE_LIMITED"}' }, 429, 500],
      ['legacy 54000 limit → 422 / 500', { status: 500, body: '{"code":"54000","details":null,"hint":null,"message":"TORNEOS_DRAFT_LIMIT_REACHED"}' }, 422, 500],
      ['genuine 500: 55000 with a non-contract message stays 500', { status: 500, body: '{"code":"55000","message":"TORNEOS_MEDIA_PIPELINE_NOT_READY"}' }, 500, 500],
      ['genuine 500: another SQLSTATE with a contract message stays 500', { status: 500, body: '{"code":"XX000","message":"TORNEOS_QUALIFICATION_INCOMPLETE"}' }, 500, 500],
      ['genuine 500: non-JSON body stays 500', { status: 500, body: 'internal error' }, 500, 500],
      ['0006 PT409 → 409 through BOTH sources (POST_0006 is safe before W3)', { status: 409, body: '{"code":"PT409","details":null,"hint":null,"message":"TORNEOS_STALE_FIXTURE_VERSION"}' }, 409, 409],
      ['0006 PT429 → 429 through both', { status: 429, body: '{"code":"PT429","details":null,"hint":null,"message":"TORNEOS_PUBLISH_RATE_LIMITED"}' }, 429, 429],
    ];
    for (const [name, answer, candStatus, liveStatus] of answers) {
      h.gw.upstream.restAnswer = answer;
      for (const [which, want] of [['candidate', candStatus], ['current', liveStatus]]) {
        h.gw.state.live = which;
        const sessions = h.gw.upstream.core.filter((x) => x === 'session').length;
        const r = await call('resolve_tournament_qualification');
        assert.equal(r.status, want, `${name} (${which})`);
        assert.equal(r.raw, answer.body, `${name}: body forwarded byte for byte (${which})`);
        assert.equal(r.headers['cache-control'], 'no-store');
        assert.equal(h.gw.upstream.core.filter((x) => x === 'session').length, sessions + 1, 'Core authority checked on this request');
      }
    }
    h.gw.upstream.restAnswer = null;
    for (const rpc of C.OFFICIALIZATION_RPCS.filter((n) => n !== 'accept_tournament_organization_invitation')) {
      h.gw.state.live = 'candidate'; const r = await call(rpc);
      assert.equal(r.status, 200, `${rpc} proxied on the candidate`);
      h.gw.state.live = 'current'; const l = await call(rpc);
      assert.equal(l.status, 403, `${rpc} refused by the live allowlist`);
    }
    // Commerce OFF on both: checkout route absent, commerce RPC not enabled.
    for (const which of ['candidate', 'current']) {
      h.gw.state.live = which;
      assert.equal((await call(C.PROBE.commerce)).status, 403);
      const co = await h.gw.transport({ url: `${C.GATEWAY_BASE}/commerce/v1/season-checkout`, method: 'POST', headers: { origin: G.WEB_ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: '{}' });
      assert.equal(co.status, 404, `commerce checkout absent (${which})`);
    }
    // Genuine timeout: the upstream never answers → the gateway's own 5 s timeout → 503 (both sources).
    h.gw.upstream.restMode = 'hang';
    for (const which of ['candidate', 'current']) {
      h.gw.state.live = which;
      const t0 = Date.now(); const r = await call('resolve_tournament_qualification');
      assert.equal(r.status, 503, `timeout → 503 (${which})`);
      assert.ok(Date.now() - t0 >= 4900 && Date.now() - t0 < 9000, `5 s timeout (${which}) ${Date.now() - t0} ms`);
    }
    h.gw.upstream.restMode = 'ok';
    // Module level: the defense table = the contract, and the live source has none.
    const ds = h.gw.competition.candidate;
    assert.deepEqual({ ...ds.DOMAIN_ERROR_STATUS }, { ...C.EC_HTTP });
    assert.deepEqual([...ds.LEGACY_DOMAIN_SQLSTATES].sort(), ['54000', '55000']);
    assert.equal(h.gw.competition.current.domainErrorStatus, undefined);
  } finally { await h.cleanup(); }
});

test('full sequence with fakes: G1 → W1 → W2 → W3 → W3 rollback → W2 rollback → W1 rollback; 0005 never re-sent after 0006; env never sent; plan ids = the pure plans; evidence clean', async () => {
  const h = await harness();
  try {
    const g1 = await h.remote.g1();
    assert.equal(g1.verdict, 'G1_PASS', JSON.stringify(g1.failures));
    assert.equal(h.db.state.applied.length, 0); assert.equal(h.deno.state.writes.length, 0);
    h.lines.push(`APPLY TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 ${C.TORNEOS_REF} 000000000000`);
    assert.equal(await stopCode(h.remote.w1()), 'NOT_AUTHORIZED');
    assert.equal(await stopCode(h.remote.w2()), REFUSALS.w2.POST_0004);
    assert.equal(await stopCode(h.remote.w3()), 'W3_DB_NOT_POST_0006');
    assert.equal(await stopCode(h.remote.w1Rollback()), REFUSALS.w1Rollback.POST_0004);
    assert.equal(h.db.state.applied.length, 0);
    const ids = {};
    h.lines.push('PLAN'); const w1 = await h.remote.w1(); assert.equal(w1.verdict, 'W1_DONE'); ids.w1 = w1.plan_id;
    assert.equal(h.db.state.state, 'POST_0005');
    assert.equal(await stopCode(h.remote.w1()), REFUSALS.w1.POST_0005);
    h.lines.push('PLAN'); const w2 = await h.remote.w2(); assert.equal(w2.verdict, 'W2_DONE'); ids.w2 = w2.plan_id;
    // The critical refusal: 0005 after 0006.
    assert.equal(await stopCode(h.remote.w1()), REFUSALS.w1.POST_0006);
    assert.equal(await stopCode(h.remote.w1Rollback()), REFUSALS.w1Rollback.POST_0006);
    assert.deepEqual(h.db.state.applied, [C.M0005.sha256, C.M0006.sha256]);
    h.lines.push('PLAN'); const w3 = await h.remote.w3(); assert.equal(w3.verdict, 'W3_DONE'); ids.w3 = w3.plan_id;
    assert.equal(h.deno.state.writes.length, 1);
    const body = h.deno.state.deployBodies[0];
    assert.deepEqual(Object.keys(body).sort(), ['assets', 'labels', 'preview', 'production']);
    assert.equal(body.labels['custom.bundle_digest'], h.cand.digest);
    assert.equal(h.gw.state.live, 'candidate');
    const deployed = JSON.parse(fs.readFileSync(h.files.deployed, 'utf8'));
    assert.equal(deployed.previous_revision, C.LIVE.revision); assert.equal(deployed.source.digest, h.cand.digest);
    assert.equal(await stopCode(h.remote.w2Rollback()), 'W2_ROLLBACK_GATEWAY_NOT_ON_THE_LIVE_SOURCE', 'DB rollback while the candidate serves is refused');
    h.lines.push('PLAN'); assert.equal((await h.remote.w3Rollback()).verdict, 'W3_ROLLBACK_DONE');
    assert.equal(h.gw.state.live, 'current'); assert.equal(h.deno.state.deployBodies[1].labels['custom.bundle_digest'], C.LIVE.digest);
    h.lines.push('PLAN'); assert.equal((await h.remote.w2Rollback()).verdict, 'W2_ROLLBACK_DONE');
    assert.equal(h.db.state.state, 'POST_0005');
    h.lines.push('PLAN'); assert.equal((await h.remote.w1Rollback()).verdict, 'W1_ROLLBACK_DONE');
    assert.equal(h.db.state.state, 'ROLLED_BACK_0005');
    assert.equal(await stopCode(h.remote.w1()), REFUSALS.w1.ROLLED_BACK_0005);
    assert.deepEqual(h.db.state.applied, [C.M0005.sha256, C.M0006.sha256, C.R0006.sha256, C.R0005.sha256]);
    assert.ok(h.remote.denoRequests.every((r) => r.kind === 'read' || r.kind === 'write:deploy'));
    // Plan ids of W1 / W2 / W3 equal the ids G1 predicted from the pure plans.
    const g1ev = JSON.parse(fs.readFileSync(path.join(h.files.ev, fs.readdirSync(h.files.ev).find((f) => /-g1-/.test(f))), 'utf8'));
    assert.deepEqual({ w1: ids.w1, w2: ids.w2, w3: ids.w3 }, { w1: g1ev.expected_plan_ids.w1, w2: g1ev.expected_plan_ids.w2_after_w1, w3: g1ev.expected_plan_ids.w3_after_w2 });
    const ev = h.evidenceText();
    assert.deepEqual(G.secretFindings(ev, h.secrets), []);
    for (const s of h.secrets) assert.ok(!ev.includes(s));
    assert.ok(!h.said.join('\n').includes(INSTALLER_PW) && !h.said.join('\n').includes(DENO_TOKEN));
  } finally { await h.cleanup(); }
});

test('fail closed: drift, migration drift, failed apply, gateway not on the live source, wrong digests, failed revision, env drift, Deno audit drift, no Deno token, secret leak', async () => {
  { // DB drift → G1 fails, W1 refused before any phrase.
    const h = await harness();
    try {
      h.db.state.drift = (s) => { s.functions.find((x) => x.sig === C.CLOSED[0]).authenticated = true; };
      assert.equal((await h.remote.g1()).verdict, 'G1_FAILED');
      assert.equal(await stopCode(h.remote.w1()), REFUSALS.w1.DRIFT);
      assert.equal(h.db.state.applied.length, 0);
    } finally { await h.cleanup(); }
  }
  { // Migration file drift → G1 fails and every DB write refuses.
    const h = await harness({ mutate: (d) => { d.migrationDrift = () => ['file_hash_mismatch backend/torneos/supabase/migrations/00000000000006_domain_error_contract.sql 000000000000']; } });
    try {
      assert.equal((await h.remote.g1()).verdict, 'G1_FAILED');
      assert.equal(await stopCode(h.remote.w1()), 'MIGRATION_DRIFT');
      assert.equal(h.db.state.applied.length, 0);
    } finally { await h.cleanup(); }
  }
  { // The migration transaction fails → W1_FAILED_NO_CHANGE; W2 then refused.
    const h = await harness();
    try {
      h.db.state.failNextApply = true; h.lines.push('PLAN');
      assert.equal(await stopCode(h.remote.w1()), 'W1_FAILED_NO_CHANGE');
      assert.equal(h.db.state.state, 'POST_0004');
      assert.equal(await stopCode(h.remote.w2()), REFUSALS.w2.POST_0004);
    } finally { await h.cleanup(); }
  }
  { // Gateway not on the live source (wrong live digest label / a foreign revision) → every DB write refused; W3 refused.
    const h = await harness();
    try {
      h.deno.revs[0].labels = { 'custom.git_head': C.LIVE.head, 'custom.bundle_digest': '0'.repeat(64) };
      assert.equal(await stopCode(h.remote.w1()), 'W1_GATEWAY_NOT_ON_THE_LIVE_SOURCE');
      h.deno.revs[0].labels = { 'custom.git_head': C.LIVE.head, 'custom.bundle_digest': C.LIVE.digest };
      h.lines.push('PLAN'); await h.remote.w1(); h.lines.push('PLAN'); await h.remote.w2();
      h.deno.revs.unshift({ id: 'foreign01', status: 'succeeded', labels: { 'custom.git_head': 'f'.repeat(40) }, env_vars: [] });
      assert.equal(await stopCode(h.remote.w3()), 'W3_GATEWAY_NOT_ON_THE_LIVE_SOURCE');
      assert.equal(await stopCode(h.remote.w2Rollback()), 'W2_ROLLBACK_GATEWAY_NOT_ON_THE_LIVE_SOURCE');
      assert.equal(h.deno.state.writes.length, 0);
    } finally { await h.cleanup(); }
  }
  { // Candidate digest ≠ pin → W3 refused; a revision that fails to build → W3_POSTCHECK_FAILED, no deployed pin.
    const h = await harness();
    try {
      h.lines.push('PLAN'); await h.remote.w1(); h.lines.push('PLAN'); await h.remote.w2();
      fs.writeFileSync(h.files.cand, JSON.stringify({ digest: '0'.repeat(64), files: 17 }));
      assert.equal(await stopCode(h.remote.w3()), 'W3_BUNDLES');
      assert.equal(h.deno.state.writes.length, 0);
      fs.writeFileSync(h.files.cand, JSON.stringify({ digest: h.cand.digest, files: 17 }));
      h.deno.state.failDeploy = true; h.lines.push('PLAN');
      assert.equal(await stopCode(h.remote.w3()), 'W3_POSTCHECK_FAILED');
      assert.ok(!fs.existsSync(h.files.deployed)); assert.equal(h.gw.state.live, 'current');
    } finally { await h.cleanup(); }
  }
  { // A non-secret env value changed on the app → observation fails, no write at all.
    const h = await harness();
    try {
      h.deno.app.env_vars.find((e) => e.key === 'TORNEOS_REST_URL').value = 'https://example.invalid/rest/v1';
      assert.equal(await stopCode(h.remote.w1()), 'W1_GATEWAY_NOT_ON_THE_LIVE_SOURCE');
      assert.equal(h.db.state.applied.length, 0);
    } finally { await h.cleanup(); }
  }
  { // G1 Deno audit: any change since the COMPETITION-V1 W2 certification fails G1; reads only.
    const h = await harness();
    try {
      assert.deepEqual((await h.remote.denoAudit()).failures, []);
      h.deno.app.updated_at = '2026-09-28T00:00:00.000Z';
      h.deno.revs.push({ id: 'late0001', status: 'succeeded', labels: {}, env_vars: [] });
      const g = await h.remote.g1();
      assert.equal(g.verdict, 'G1_FAILED');
      assert.deepEqual(g.failures.filter((f) => f.startsWith('DENO_AUDIT')).sort(), ['DENO_AUDIT app updated_at not after the live revision (no config/env change since COMPETITION-V1 W2)', 'DENO_AUDIT revision set = certified (no new revision since COMPETITION-V1 W2)']);
      assert.ok(h.remote.denoRequests.every((r) => r.kind === 'read'));
    } finally { await h.cleanup(); }
  }
  { // No Deno token: G1 without the Deno leg; every write stops (they all need the gateway observation).
    const h = await harness({ mutate: (d) => { d.denoToken = null; } });
    try {
      assert.equal((await h.remote.g1()).verdict, 'G1_PASS_WITHOUT_DENO_OBSERVATION');
      assert.equal(await stopCode(h.remote.w1()), 'DENO_TOKEN_REQUIRED');
      assert.equal(h.db.state.applied.length, 0);
    } finally { await h.cleanup(); }
  }
  { // A secret reaching the evidence is refused (the file is never written).
    const h = await harness();
    try {
      h.db.state.drift = (s) => { s.current_user = INSTALLER_PW; };
      assert.equal(await stopCode(h.remote.g1()), 'EVIDENCE_REJECTED_SECRET_LEAK');
      assert.ok(!fs.existsSync(h.files.ev) || fs.readdirSync(h.files.ev).length === 0);
    } finally { await h.cleanup(); }
  }
  // Deno writes exist only armed, and only the deploy body shape.
  assert.throws(() => R.classifyDenoRequest({ method: 'POST', path: '/v2/apps/torneos-gateway/deploy', body: {} }), /not_armed/);
  assert.throws(() => R.classifyDenoRequest({ method: 'PATCH', path: '/v2/apps/torneos-gateway', body: { env_vars: [] } }, { armedFor: 'deploy' }), /not_armed/);
});

test('session commands: only the known ones, no arguments', async () => {
  const fake = new Proxy({}, { get: () => async () => ({ verdict: 'X' }) });
  await assert.rejects(runCommand(fake, 'w1 --force'), /COMMAND_REFUSED/);
  await assert.rejects(runCommand(fake, 'apply-0005'), /COMMAND_UNKNOWN/);
  await assert.rejects(runCommand(fake, 'w0'), /COMMAND_UNKNOWN/);
  const src = fs.readFileSync(new URL('./oec-session.mjs', import.meta.url), 'utf8');
  assert.ok(!/case 'w1-reapply'|case 'force'/.test(src));
  const sh = fs.readFileSync(new URL('./run-oec-session.sh', import.meta.url), 'utf8');
  assert.match(sh, /IFS= read -rs DENO < \/dev\/tty/);
  assert.ok(!/SUPABASE_ACCESS_TOKEN|--linked|supabase /.test(sh));
});
