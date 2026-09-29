// ANDROID ORIGIN REMOTE — offline tests of the deploy / rollback tooling. No network: Deno Deploy is a fake at the state the OEC
// W3 left Production in, Core is emulated, and the gateway is the REAL handle() of both sources extracted from git
// (live 0f049ef5, candidate f7efe18f).
//   node --test backend/torneos/infra/torneos-android-origin/android-origin-remote.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './android-origin-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as R from '../torneos-gateway-remote/remote-contract.mjs';
import { makeRemote } from './android-origin-remote.mjs';
import { runCommand, envCarriesToken } from './android-origin-session.mjs';
import { buildCandidate, buildLive } from './android-origin-bundle.mjs';
import { buildFromCommit } from '../torneos-competition-v1/competition-bundle.mjs';
import { fixtureEnv, gatewayPair, fakeDeno } from './test-support.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DENO_TOKEN = `ddo_${crypto.randomBytes(24).toString('base64url')}`;
const CAND = buildCandidate();
const LIVE = buildLive();
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

test('pins: live = OEC W3 deploy pin (t5vxxvzp1t9f, 0f049ef5, 6c252863…, 17); candidate = f7efe18f / 59573b50…, delta = 3 files; 13 env; phrases; rollback → 6c252863…', () => {
  assert.deepEqual([C.LIVE.revision, C.LIVE.head, C.LIVE.digest, C.LIVE.files], ['t5vxxvzp1t9f', '0f049ef5657a3b3046276ff00f44464aba998c08', '6c252863fd94bcad0f785af9bb3636d09b2bc2265baafb0af2a771efdb6143a4', 17]);
  assert.deepEqual([C.CANDIDATE.head, C.CANDIDATE.digest, C.CANDIDATE.files], ['f7efe18f954f55237d90855dee300793cbc2d275', '59573b5087226d55e3c47e0f7300abd94185111d00276dbebd9b59e470c6f832', 17]);
  const livePin = C.readLiveDeployPin();
  assert.equal(livePin.revision, 't5vxxvzp1t9f'); assert.equal(livePin.source.digest, C.LIVE.digest);
  // Both sources from git, deterministic, equal to the pins.
  assert.equal(LIVE.digest, C.LIVE.digest); assert.equal(LIVE.manifest.length, 17); assert.deepEqual(LIVE.manifest, livePin.source.files);
  assert.equal(CAND.digest, C.CANDIDATE.digest); assert.equal(buildCandidate().digest, CAND.digest); assert.equal(CAND.manifest.length, 17);
  const pin = JSON.parse(fs.readFileSync(C.CANDIDATE_PIN_FILE, 'utf8'));
  assert.deepEqual([pin.source_commit, pin.digest, pin.files], [C.CANDIDATE.head, C.CANDIDATE.digest, 17]);
  assert.deepEqual(pin.manifest, CAND.manifest);
  const changed = CAND.manifest.filter((m) => LIVE.manifest.some((l) => l.path === m.path && l.sha256 !== m.sha256)).map((m) => m.path).sort();
  assert.deepEqual(changed, ['torneos-gateway/config.ts', 'torneos-gateway/index.ts', 'torneos-gateway/topology.ts']);
  assert.deepEqual(CAND.manifest.map((m) => m.path), LIVE.manifest.map((m) => m.path), 'no file added or removed');
  // Env: 13, names = the gateway-remote pin, secret flags, non-secret digests from the OEC W3 observation.
  assert.equal(C.ENV_PIN.length, 13);
  assert.deepEqual(C.ENV_PIN.map((e) => e.key), [...R.ENV_NAMES]);
  assert.deepEqual(C.ENV_PIN.filter((e) => e.secret).map((e) => e.key).sort(), [...R.SECRET_NAMES].sort());
  for (const e of C.ENV_PIN) if (!e.secret) assert.equal(e.sha256_16, livePin.env.find((x) => x.key === e.key).sha256_16);
  // Phrases and plans.
  assert.equal(C.PHRASES.w1('abc123abc123'), 'DEPLOY TORNEOS GATEWAY ANDROID-ORIGIN torneos-gateway abc123abc123');
  assert.equal(C.PHRASES.rollback('abc123abc123'), 'ROLLBACK TORNEOS GATEWAY torneos-gateway TO 0f049ef5 abc123abc123');
  const plan = C.PLANS.deploy({ which: 'candidate', previousRevision: C.LIVE.revision, source: CAND, env: C.envNamesOf(C.ENV_PIN) });
  assert.deepEqual(plan.rollback_to, { head: C.LIVE.head, digest: '6c252863fd94bcad0f785af9bb3636d09b2bc2265baafb0af2a771efdb6143a4', files: 17 });
  assert.equal(plan.env, 'unchanged (not in the request)'); assert.equal(plan.db, 'not touched');
  assert.equal(C.planIdOf(plan), C.expectedW1PlanId(CAND), 'pure');
  assert.notEqual(C.planIdOf(plan), C.planIdOf({ ...plan, previous_revision: 'other000000' }));
  const rb = C.PLANS.deploy({ which: 'live', previousRevision: 'revX', source: LIVE, env: [] });
  assert.equal(rb.step, 'W1-rollback'); assert.equal(rb.source.digest, C.LIVE.digest); assert.equal(rb.source.head, C.LIVE.head); assert.equal(rb.source.files.length, 17);
  // Origins.
  assert.equal(C.ANDROID_ORIGIN, 'https://localhost');
  assert.deepEqual([...C.DENY_ORIGINS], ['http://localhost', 'capacitor://localhost', 'https://localhost:8443', 'https://evil.example']);
});

async function harness({ mutate = () => {} } = {}) {
  const fx = fixtureEnv();
  const gw = await gatewayPair(fx.env);
  const deno = fakeDeno({ env: fx.env, gateway: gw });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-ao-test-'));
  const files = { jwks: path.join(tmp, 'jwks.json'), deployed: path.join(tmp, 'deployed.json'), ev: path.join(tmp, 'ev') };
  fs.writeFileSync(files.jwks, JSON.stringify(fx.jwksPin));
  const lines = []; const said = [];
  const builds = { candidate: 0, live: 0 };
  const deps = {
    say: (s) => said.push(s), readLine: () => { const l = lines.shift(); if (l === 'PLAN') { const m = /To proceed the operator must send exactly:\n {2}(.+)$/.exec(said.at(-1) ?? ''); return m ? m[1] : ''; } return l ?? ''; },
    denoToken: DENO_TOKEN, now: () => Date.now(), sleep: async () => {}, pollMs: 1,
    keychain: { ring: (slot, kid) => { assert.equal(slot, 'k1'); assert.equal(kid, fx.jwksPin.active); return fx.k1.pkcs8; }, installerPassword: () => { throw new Error('no DB leg'); } },
    denoTransport: deno.transport, gatewayTransport: gw.transport, gatewayBase: C.GATEWAY_BASE,
    buildCandidate: () => { builds.candidate += 1; return CAND; }, buildLive: () => { builds.live += 1; return LIVE; },
    evidenceDir: files.ev, jwksPinFile: files.jwks, deployedPinFile: files.deployed, probeLivePin: fx.livePin, envPin: fx.envPin,
  };
  mutate(deps);
  const remote = makeRemote(deps);
  const secrets = [...fx.secrets, DENO_TOKEN];
  const evidence = () => (fs.existsSync(files.ev) ? fs.readdirSync(files.ev).map((f) => ({ name: f, json: JSON.parse(fs.readFileSync(path.join(files.ev, f), 'utf8')), text: fs.readFileSync(path.join(files.ev, f), 'utf8') })) : []);
  return { fx, gw, deno, remote, lines, said, files, secrets, evidence, builds,
    cleanup: async () => { await gw.cleanup(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
const stopCode = async (p) => { try { await p; return 'NO_STOP'; } catch (e) { return e.code ?? String(e.message); } };
const failedNames = (pr) => [...pr.base.checks, ...pr.origin.checks].filter((c) => !c.pass).map((c) => c.name);

test('probes (REAL handle() of both sources): 66/66 base on both; Android 403 on live, admitted with its exact CORS grant on the candidate; deny list 403 on both', async () => {
  const h = await harness();
  try {
    const live = await h.remote.probes('live');
    assert.deepEqual(failedNames(live), []);
    assert.equal(live.base.total, 66); assert.equal(live.base.passed, 66);
    const android = live.origin.checks.filter((c) => c.name.startsWith('https://localhost '));
    assert.ok(android.length >= 4 && android.every((c) => c.status === 403 && c.acao === null), 'Android 403 before the deploy');
    assert.ok(!(await h.remote.probes('candidate')).pass, 'candidate expectations fail on the live source');
    h.gw.state.live = 'candidate';
    const cand = await h.remote.probes('candidate');
    assert.deepEqual(failedNames(cand), []);
    assert.equal(cand.base.total, 66); assert.equal(cand.base.passed, 66);
    const pre = cand.origin.checks.find((c) => c.name.startsWith('https://localhost preflight'));
    assert.deepEqual([pre.status, pre.acao], [204, 'https://localhost']);
    for (const o of C.DENY_ORIGINS) for (const c of cand.origin.checks.filter((x) => x.name.startsWith(`${o} `))) assert.deepEqual([c.status, c.acao], [403, null], c.name);
    assert.ok(!(await h.remote.probes('live')).pass, 'live expectations fail on the candidate');
    assert.deepEqual(G.secretFindings(JSON.stringify([live, cand]), h.secrets), []);
  } finally { await h.cleanup(); }
});

test('plan / dry-run: the offline plan makes no network call; G1 and w1-plan write nothing and agree on the W1 plan id', async () => {
  const h = await harness();
  try {
    const calls = { deno: h.deno.state.requests.length, gw: h.gw.state.calls };
    const off = h.remote.planOffline();
    assert.equal(off.verdict, 'PLAN_OFFLINE_OK', JSON.stringify(off.failures));
    assert.equal(off.w1_plan_id, C.expectedW1PlanId(CAND));
    assert.equal(off.rollback.to.digest, C.LIVE.digest);
    assert.deepEqual([h.deno.state.requests.length, h.gw.state.calls], [calls.deno, calls.gw], 'offline plan: no network');
    const g1 = await h.remote.g1();
    assert.equal(g1.verdict, 'G1_PASS', JSON.stringify(g1.failures));
    assert.deepEqual([g1.current, g1.env_count, g1.probes.base], ['t5vxxvzp1t9f', 13, '66/66']);
    assert.equal(g1.expected_w1_plan_id, off.w1_plan_id);
    const plan = await h.remote.w1Plan();
    assert.equal(plan.verdict, 'W1_PLAN_ONLY'); assert.equal(plan.writes, 0);
    assert.equal(plan.plan_id, off.w1_plan_id, 'the dry-run plan id = the one G1 predicts');
    assert.equal(plan.phrase, C.PHRASES.w1(off.w1_plan_id));
    assert.equal(await stopCode(h.remote.rollbackPlan()), 'ROLLBACK_CURRENT_NOT_THE_CANDIDATE', 'nothing to roll back while live serves');
    assert.deepEqual(h.deno.state.writes, []); assert.equal(h.gw.state.live, 'live');
    assert.ok(h.remote.denoRequests.every((r) => r.kind === 'read'));
    const ev = h.evidence();
    assert.ok(ev.some((e) => e.json.verdict === 'G1_PASS' && e.json.writes === 0 && e.json.db === 'not connected'));
    for (const e of ev) { assert.deepEqual(G.secretFindings(e.text, h.secrets), []); assert.ok(!e.text.includes(DENO_TOKEN)); }
  } finally { await h.cleanup(); }
});

test('full W1 → rollback with fakes: one write each, assets + labels only, env never sent, postchecks, rollback = exactly 0f049ef5 / 6c252863…', async () => {
  const h = await harness();
  try {
    h.lines.push('PLAN');
    const w1 = await h.remote.w1();
    assert.equal(w1.verdict, 'W1_DONE'); assert.equal(w1.plan_id, C.expectedW1PlanId(CAND));
    assert.equal(h.deno.state.writes.length, 1);
    const body = h.deno.state.deployBodies[0];
    assert.deepEqual(Object.keys(body).sort(), ['assets', 'labels', 'preview', 'production']);
    assert.deepEqual(body.labels, { 'custom.git_head': C.CANDIDATE.head, 'custom.bundle_digest': C.CANDIDATE.digest });
    assert.deepEqual(Object.keys(body.assets).sort(), CAND.manifest.map((m) => m.path).sort());
    assert.equal(h.gw.state.live, 'candidate');
    const deployed = JSON.parse(fs.readFileSync(h.files.deployed, 'utf8'));
    assert.deepEqual([deployed.previous_revision, deployed.source.digest, deployed.env.length], ['t5vxxvzp1t9f', C.CANDIDATE.digest, 13]);
    assert.equal(await stopCode(h.remote.w1()), 'W1_LIVE_REVISION_UNEXPECTED', 'no second W1');
    // Same session as W1: the rollback dry-run counts only its own requests, not W1's POST.
    const rbPlan = await h.remote.rollbackPlan();
    assert.equal(rbPlan.verdict, 'ROLLBACK_PLAN_ONLY'); assert.equal(rbPlan.writes, 0);
    assert.equal(h.deno.state.writes.length, 1, 'the rollback dry-run wrote nothing');
    const rbPlanEv = h.evidence().find((e) => e.json.verdict === 'ROLLBACK_PLAN_ONLY');
    assert.ok(rbPlanEv.json.deno_requests.length > 0 && rbPlanEv.json.deno_requests.every((r) => r.kind === 'read'));
    assert.equal(rbPlanEv.json.session_writes_before, 1);
    h.lines.push('PLAN');
    const rb = await h.remote.rollback();
    assert.equal(rb.verdict, 'ROLLBACK_DONE');
    assert.equal(rb.plan_id, rbPlan.plan_id, 'the dry-run plan id = the one the rollback asks for');
    assert.equal(h.deno.state.writes.length, 2);
    const back = h.deno.state.deployBodies[1];
    assert.deepEqual(back.labels, { 'custom.git_head': '0f049ef5657a3b3046276ff00f44464aba998c08', 'custom.bundle_digest': '6c252863fd94bcad0f785af9bb3636d09b2bc2265baafb0af2a771efdb6143a4' });
    assert.deepEqual(Object.fromEntries(Object.entries(back.assets).map(([k, v]) => [k, C.sha256(v.content)])), Object.fromEntries(C.readLiveDeployPin().source.files.map((f) => [f.path, f.sha256])), 'byte-identical live source');
    assert.equal(h.gw.state.live, 'live');
    const android = await h.gw.transport({ url: `${C.GATEWAY_BASE}/health`, headers: { origin: 'https://localhost' } });
    assert.equal(android.status, 403, 'after rollback Android is refused again');
    for (const b of h.deno.state.deployBodies) assert.ok(!('env_vars' in b) && !('config' in b) && !('layers' in b));
    assert.ok(h.remote.denoRequests.every((r) => r.kind === 'read' || r.kind === 'write:deploy'));
    for (const e of h.evidence()) assert.deepEqual(G.secretFindings(e.text, h.secrets), [], e.name);
    assert.ok(!h.said.join('\n').includes(DENO_TOKEN));
  } finally { await h.cleanup(); }
});

test('fail closed: wrong digest, unexpected live revision, env count, modified variable, missing token, wrong phrase, read-only session, 5xx, failed revision, secret leak — no write', async () => {
  { // Candidate digest ≠ pin (a build of another commit) → G1 fails, W1 and its plan refused before any Deno call.
    const h = await harness({ mutate: (d) => { d.buildCandidate = () => LIVE; } });
    try {
      assert.equal((await h.remote.g1()).verdict, 'G1_FAILED');
      assert.equal(await stopCode(h.remote.w1Plan()), 'W1_SOURCE_DIGEST_REFUSED');
      h.lines.push('PLAN'); assert.equal(await stopCode(h.remote.w1()), 'W1_SOURCE_DIGEST_REFUSED');
      assert.deepEqual(h.deno.state.writes, []);
    } finally { await h.cleanup(); }
  }
  { // Live source ≠ 6c252863… (another real commit) → refused: the rollback target is never anything but the pin.
    const h = await harness({ mutate: (d) => { d.buildLive = () => buildFromCommit('ee34b2a79008692178b6dbb42530aca5947d7027'); } });
    try {
      assert.equal((await h.remote.g1()).verdict, 'G1_FAILED');
      assert.equal(await stopCode(h.remote.w1Plan()), 'W1_SOURCE_DIGEST_REFUSED');
      assert.deepEqual(h.deno.state.writes, []);
    } finally { await h.cleanup(); }
  }
  { // Source changed between the plan and the write (rebuilt right before the deploy) → STOP, no write.
    let n = 0;
    const h = await harness({ mutate: (d) => { d.buildCandidate = () => (++n <= 2 ? CAND : { ...CAND, digest: '0'.repeat(64) }); } });
    try {
      h.lines.push('PLAN'); assert.equal(await stopCode(h.remote.w1()), 'W1_SOURCE_CHANGED_SINCE_PLAN');
      assert.deepEqual(h.deno.state.writes, []);
    } finally { await h.cleanup(); }
  }
  { // Unexpected live revision (a foreign newer revision / wrong labels on t5vxxvzp1t9f) → STOP.
    const h = await harness();
    try {
      h.deno.revs.unshift({ id: 'foreign01xyz', status: 'succeeded', labels: { 'custom.git_head': 'f'.repeat(40) }, created_at: '2026-09-29T00:00:00.000Z' });
      assert.equal((await h.remote.g1()).verdict, 'G1_FAILED');
      h.lines.push('PLAN'); assert.equal(await stopCode(h.remote.w1()), 'W1_LIVE_REVISION_UNEXPECTED');
      h.deno.revs.shift(); h.deno.revs[0].labels = { 'custom.git_head': C.LIVE.head, 'custom.bundle_digest': '0'.repeat(64) };
      assert.equal(await stopCode(h.remote.w1Plan()), 'W1_LIVE_REVISION_UNEXPECTED');
      assert.deepEqual(h.deno.state.writes, []);
    } finally { await h.cleanup(); }
  }
  { // Revision set grew (a preview / older revision appeared) → audit fails → STOP.
    const h = await harness();
    try {
      h.deno.revs.push({ id: 'late0001abcd', status: 'succeeded', labels: {}, created_at: '2026-09-20T00:00:00.000Z' });
      assert.equal(await stopCode(h.remote.w1Plan()), 'W1_DENO_AUDIT_FAILED');
    } finally { await h.cleanup(); }
  }
  { // Env count unexpected (14 / 12) → STOP.
    const h = await harness();
    try {
      h.deno.app.env_vars.push({ key: 'TORNEOS_EXTRA', value: 'x', secret: false, contexts: 'all' });
      const g = await h.remote.g1();
      assert.equal(g.verdict, 'G1_FAILED'); assert.ok(g.failures.includes('DENO_ENV_COUNT_14'));
      assert.equal(await stopCode(h.remote.w1Plan()), 'W1_DENO_OBSERVE_FAILED');
      h.deno.app.env_vars.splice(-1); h.deno.app.env_vars.splice(0, 1);
      assert.equal(await stopCode(h.remote.w1Plan()), 'W1_DENO_OBSERVE_FAILED');
      assert.deepEqual(h.deno.state.writes, []);
    } finally { await h.cleanup(); }
  }
  { // A variable modified: non-secret value, secret flag, contexts, app updated_at → STOP each time.
    for (const mut of [
      (d) => { d.app.env_vars.find((e) => e.key === 'TORNEOS_ALLOWED_ORIGIN').value = 'https://localhost'; },
      (d) => { const e = d.app.env_vars.find((x) => x.key === 'TORNEOS_BRIDGE_KEYS'); e.secret = false; e.value = 'x'; },
      (d) => { d.app.env_vars.find((e) => e.key === 'CORE_AUTH_URL').contexts = 'production'; },
      (d) => { d.app.updated_at = '2026-09-29T10:00:00.000Z'; },
    ]) {
      const h = await harness();
      try {
        mut(h.deno);
        assert.equal((await h.remote.g1()).verdict, 'G1_FAILED');
        h.lines.push('PLAN'); assert.equal(await stopCode(h.remote.w1()), 'W1_DENO_OBSERVE_FAILED');
        assert.deepEqual(h.deno.state.writes, []);
      } finally { await h.cleanup(); }
    }
  }
  { // No token → G1 without the Deno leg only; every write and plan stops.
    const h = await harness({ mutate: (d) => { d.denoToken = null; } });
    try {
      assert.equal((await h.remote.g1()).verdict, 'G1_PASS_WITHOUT_DENO_OBSERVATION');
      assert.equal(await stopCode(h.remote.w1()), 'DENO_TOKEN_REQUIRED');
      assert.equal(await stopCode(h.remote.rollback()), 'DENO_TOKEN_REQUIRED');
      assert.equal(await stopCode(h.remote.w1Plan()), 'DENO_TOKEN_REQUIRED');
      assert.equal(h.deno.state.requests.length, 0);
    } finally { await h.cleanup(); }
  }
  { // Wrong / missing phrase → NOT_AUTHORIZED, no write.
    const h = await harness();
    try {
      h.lines.push('DEPLOY TORNEOS GATEWAY ANDROID-ORIGIN torneos-gateway 000000000000');
      assert.equal(await stopCode(h.remote.w1()), 'NOT_AUTHORIZED');
      assert.equal(await stopCode(h.remote.w1()), 'NOT_AUTHORIZED', 'empty line');
      assert.deepEqual(h.deno.state.writes, []);
    } finally { await h.cleanup(); }
  }
  { // Read-only session: w1 / rollback refused at the command AND in the remote AND at the transport guard.
    const h = await harness({ mutate: (d) => { d.readOnly = true; } });
    try {
      await assert.rejects(runCommand(h.remote, 'w1'), /COMMAND_REFUSED_READ_ONLY_SESSION/);
      await assert.rejects(runCommand(h.remote, 'rollback'), /COMMAND_REFUSED_READ_ONLY_SESSION/);
      h.lines.push('PLAN'); assert.equal(await stopCode(h.remote.w1()), 'READ_ONLY_SESSION_REFUSES_WRITE');
      assert.equal(h.deno.state.requests.length, 0, 'refused before any Deno call');
      assert.ok(!h.said.some((s) => s.includes('To proceed')), 'refused before any phrase is requested');
      assert.equal((await runCommand(h.remote, 'w1-plan')).verdict, 'W1_PLAN_ONLY');
      assert.equal((await runCommand(h.remote, 'g1')).verdict, 'G1_PASS');
      assert.equal((await runCommand(h.remote, 'logs')).available, true, 'logs is a read-only command in any session');
      assert.deepEqual(h.deno.state.writes, []);
    } finally { await h.cleanup(); }
  }
  { // A 5xx from the gateway → probes fail → G1 fails, W1 refused.
    const h = await harness();
    try {
      h.gw.state.force5xx = true;
      const g = await h.remote.g1();
      assert.equal(g.verdict, 'G1_FAILED');
      assert.equal(await stopCode(h.remote.w1Plan()), 'W1_LIVE_PROBES_FAILED');
    } finally { await h.cleanup(); }
  }
  { // The revision fails to build → W1_POSTCHECK_FAILED, no deployed pin, live keeps serving.
    const h = await harness();
    try {
      h.deno.state.failDeploy = true; h.lines.push('PLAN');
      assert.equal(await stopCode(h.remote.w1()), 'W1_POSTCHECK_FAILED');
      assert.ok(!fs.existsSync(h.files.deployed)); assert.equal(h.gw.state.live, 'live');
      assert.equal(h.deno.state.writes.length, 1, 'sent once, never retried');
    } finally { await h.cleanup(); }
  }
  { // Deno logs unavailable is a warning, not a failure (read-only, informational).
    const h = await harness();
    try {
      h.deno.state.logsStatus = 500;
      const g = await h.remote.g1();
      assert.equal(g.verdict, 'G1_PASS'); assert.deepEqual(g.warnings, ['DENO_LOGS_UNAVAILABLE DENO_API_STATUS_UNEXPECTED']);
    } finally { await h.cleanup(); }
  }
  { // A secret reaching the evidence is refused (the file is never written).
    const h = await harness();
    try {
      h.deno.revs[1].labels = { 'custom.leak': DENO_TOKEN };
      assert.equal(await stopCode(h.remote.g1()), 'EVIDENCE_REJECTED_SECRET_LEAK');
      assert.ok(!fs.existsSync(h.files.ev) || fs.readdirSync(h.files.ev).length === 0);
    } finally { await h.cleanup(); }
  }
  // Malformed token refused; Deno writes other than an armed deploy never pass the allowlist.
  assert.throws(() => makeRemote({ denoToken: 'not-a-token', say: () => {} }), /DENO_TOKEN_MALFORMED/);
  assert.throws(() => R.classifyDenoRequest({ method: 'POST', path: '/v2/apps/torneos-gateway/deploy', body: {} }), /not_armed/);
  assert.throws(() => R.classifyDenoRequest({ method: 'PATCH', path: '/v2/apps/torneos-gateway', body: { env_vars: [] } }, { armedFor: 'deploy' }), /not_armed/);
});

test('session + sources: known commands only; token only from the tty (never argv / env / repo); no DB leg; no token literal in the tooling', async () => {
  const fake = new Proxy({ readOnly: false }, { get: (t, k) => (k === 'readOnly' ? t.readOnly : async () => ({ verdict: 'X' })) });
  await assert.rejects(runCommand(fake, 'w1 --force'), /COMMAND_REFUSED/);
  await assert.rejects(runCommand(fake, 'deploy'), /COMMAND_UNKNOWN/);
  await assert.rejects(runCommand(fake, 'env-set'), /COMMAND_UNKNOWN/);
  assert.deepEqual(envCarriesToken({ DENO_DEPLOY_TOKEN: 'x', PATH: '/bin', DENO_DIR: '/tmp', SUPABASE_ACCESS_TOKEN: 'y' }), ['DENO_DEPLOY_TOKEN', 'SUPABASE_ACCESS_TOKEN']);
  const sh = fs.readFileSync(path.join(HERE, 'run-android-origin-session.sh'), 'utf8');
  assert.match(sh, /IFS= read -rs DENO < \/dev\/tty/);
  assert.match(sh, /\[\[ "\$MODE" == "read-only" \|\| "\$MODE" == "deploy" \]\]/);
  assert.ok(!/SUPABASE_ACCESS_TOKEN|--linked|supabase |psql|PGPASSWORD/.test(sh));
  for (const f of fs.readdirSync(HERE).filter((x) => /\.(mjs|sh|json)$/.test(x) && !x.endsWith('.test.mjs'))) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    assert.ok(!/dd[op]_[A-Za-z0-9_-]{20,}/.test(src), `${f}: no token literal`);
    assert.deepEqual(G.secretFindings(src), [], `${f}: nothing secret-shaped`);
    assert.ok(!/process\.env\.[A-Z_]*(TOKEN|DENO)/.test(src), `${f}: no token from the environment`);
    assert.ok(!/psql|applySql|installerEnv|runPsqlProbe/.test(src) || f === 'README.md', `${f}: no database leg`);
  }
  for (const f of fs.readdirSync(path.join(HERE, 'pins'))) assert.deepEqual(G.secretFindings(fs.readFileSync(path.join(HERE, 'pins', f), 'utf8')), [], f);
});
