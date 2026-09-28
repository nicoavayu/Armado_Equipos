// COMPETITION-V1 REMOTE — offline tests of the Phase G tooling. No network: the database, the Deno Deploy API and Core
// are fakes/emulations; the gateway is the REAL handle() of both sources (deployed bea307a3 from git, candidate tree).
//   node --test backend/torneos/infra/torneos-competition-v1/competition-remote.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from './competition-remote-contract.mjs';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as R from '../torneos-gateway-remote/remote-contract.mjs';
import { makeRemote, readOnlyEnv, installerEnv } from './competition-remote.mjs';
import { buildCandidate, buildPrevious } from './competition-bundle.mjs';
import { fixtureEnv, gatewayPair, fakeDeno, fakeDb, fakeDeltaPin, contractState } from './test-support.mjs';

const DENO_TOKEN = `ddo_${crypto.randomBytes(24).toString('base64url')}`;
const INSTALLER_PW = crypto.randomBytes(30).toString('base64url');

test('pins: migration and rollback bytes, function sets, counts, phrases, read-only SQL', () => {
  C.assertFileHash(C.MIGRATION.file, C.MIGRATION.sha256);
  C.assertFileHash(C.ROLLBACK.file, C.ROLLBACK.sha256);
  assert.throws(() => C.assertFileHash(C.MIGRATION.file, C.ROLLBACK.sha256), /file_hash_mismatch/);
  assert.deepEqual([C.GRANTED.length, C.KEPT_REVOKED.length, C.SERVICE_ONLY.length, C.FIXES.length, C.FIXED_ONLY.length], [15, 17, 6, 2, 1]);
  assert.deepEqual([C.COUNTS.authenticatedBefore, C.COUNTS.authenticatedAfter, C.COUNTS.anon], [147, 162, 12]);
  assert.equal(new Set([...C.GRANTED, ...C.KEPT_REVOKED, ...C.SERVICE_ONLY]).size, 38);
  // Every one of the 15 is GRANTed by the migration and REVOKEd by the rollback, exactly once; nothing else is.
  const mig = fs.readFileSync(path.join(C.REPO_ROOT, C.MIGRATION.file), 'utf8');
  const rb = fs.readFileSync(path.join(C.REPO_ROOT, C.ROLLBACK.file), 'utf8');
  assert.equal((mig.match(/^GRANT /gm) ?? []).length, 15); assert.equal((mig.match(/^REVOKE /gm) ?? []).length, 0);
  assert.equal((rb.match(/^REVOKE EXECUTE .* FROM authenticated;$/gm) ?? []).length, 15); assert.equal((rb.match(/^GRANT /gm) ?? []).length, 0);
  assert.equal((mig.match(/^CREATE OR REPLACE FUNCTION /gm) ?? []).length, 2); assert.equal((rb.match(/CREATE OR REPLACE/g) ?? []).length, 0);
  for (const s of C.GRANTED) assert.ok(mig.includes(`public.${s}'`), s);
  assert.ok(!/;/.test(C.STATE_SQL));
  assert.match(C.readOnlyScript(C.STATE_SQL), /^BEGIN TRANSACTION READ ONLY;\n[\s\S]+;\nROLLBACK;\n$/);
  assert.throws(() => C.readOnlyScript('update x set y = 1'), /write_verb|not_a_select/);
  assert.equal(C.PHRASES.w1('abc123'), 'APPLY TORNEOS MIGRATION 0004 COMPETITION-V1 onzpwnqxnvlgsevivngf abc123');
  assert.equal(C.PHRASES.w2Rollback('abc123'), 'ROLLBACK TORNEOS GATEWAY torneos-gateway TO bea307a3 abc123');
  assert.deepEqual(C.ENV_SHAPE.map((e) => e.key), [...R.ENV_NAMES]);
  // psql env: pinned pooler, verify-full, installer.<ref>; reads carry the server-side read-only default.
  const ro = readOnlyEnv({ password: INSTALLER_PW });
  assert.deepEqual([ro.PGHOST, ro.PGPORT, ro.PGUSER, ro.PGSSLMODE, ro.PGOPTIONS], [C.POOLER_HOST, '5432', `postgres.${C.TORNEOS_REF}`, 'verify-full', '-c default_transaction_read_only=on']);
  assert.ok(!('PGOPTIONS' in installerEnv({ password: INSTALLER_PW, app: 'x' })));
  assert.ok(!Object.keys(ro).some((k) => /^PG/.test(k) && !['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGCONNECT_TIMEOUT', 'PGAPPNAME', 'PGPASSWORD', 'PGOPTIONS'].includes(k)));
});

test('state classifier: PRE / POST / ROLLED_BACK exactly; every deviation is DRIFT', () => {
  assert.equal(C.classifyState(contractState('PRE_0004')).state, 'PRE_0004');
  assert.equal(C.classifyState(contractState('POST_0004')).state, 'POST_0004');
  assert.equal(C.classifyState(contractState('ROLLED_BACK')).state, 'ROLLED_BACK');
  const drift = (mut) => { const s = contractState('PRE_0004'); mut(s); return C.classifyState(s); };
  const cases = [
    (s) => { s.functions[0].anon = true; },
    (s) => { s.functions.find((x) => x.kind === 'kept').authenticated = true; },
    (s) => { s.functions.find((x) => x.kind === 'service_only').authenticated = true; },
    (s) => { s.functions.slice(0, 7).forEach((x) => { x.authenticated = true; }); },
    (s) => { s.functions[3].owner = 'supabase_admin'; },
    (s) => { s.functions[2].public = true; },
    (s) => { s.functions[5].server_roles = ['torneos_payment_service']; },
    (s) => { s.functions[1].exists = false; },
    (s) => { s.functions.find((x) => x.sig === C.FIXES[0].fn).body_md5 = '0'.repeat(32); },
    (s) => { s.counts.anon_public = 13; },
    (s) => { s.counts.authenticated_public = 148; },
    (s) => { s.read_only = 'off'; },
    (s) => { s.functions.pop(); },
    (s) => { s.functions.find((x) => x.kind === 'granted').search_path_pinned = false; },
  ];
  for (const [i, mut] of cases.entries()) assert.equal(drift(mut).state, 'DRIFT', `case ${i}`);
  assert.equal(C.classifyState(null).state, 'DRIFT');
});

test('bundles: previous rebuilt from git = the deploy pin (14 files, 723c5d39…); candidate = the working-tree graph with the competition (+2) and OFFICIALIZATION-V1 (+1) files', () => {
  const prev = buildPrevious();
  assert.equal(prev.digest, C.CURRENT.digest); assert.equal(prev.manifest.length, 14); assert.equal(prev.head, C.CURRENT.head);
  assert.deepEqual(prev.manifest, C.readCurrentDeployPin().source.files);
  const cand = buildCandidate({ requireClean: false });
  assert.equal(cand.manifest.length, 17);
  assert.ok(['torneos-gateway/competition.ts', 'torneos-gateway/competition-v1-rpc-allowlist.json', 'torneos-gateway/officialization-v1-rpc-allowlist.json'].every((f) => cand.manifest.some((m) => m.path === f)));
  assert.notEqual(cand.digest, prev.digest);
  // W2 sends assets + labels only: the allowlisted deploy body shape accepts both sources and nothing else.
  for (const b of [prev, cand]) assert.ok(R.assertDenoWriteBody('deploy', { assets: b.assets, labels: { 'custom.git_head': b.head, 'custom.bundle_digest': b.digest }, production: true, preview: false }));
  assert.throws(() => R.assertDenoWriteBody('deploy', { assets: cand.assets, labels: {}, production: true, preview: false, env_vars: [] }), /deploy_shape/);
});

async function harness({ mutate = () => {} } = {}) {
  const fx = fixtureEnv();
  const gw = await gatewayPair(fx.env);
  const cand = buildCandidate({ requireClean: false });
  const deno = fakeDeno({ env: fx.env, deployPin: fx.deployPin, gateway: gw, candidateHead: cand.head });
  const deltaPin = fakeDeltaPin();
  const db = fakeDb({ deltaPin });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-cv1-test-'));
  const files = { delta: path.join(tmp, 'delta.json'), cand: path.join(tmp, 'cand.json'), jwks: path.join(tmp, 'jwks.json'), deployed: path.join(tmp, 'deployed.json'), ev: path.join(tmp, 'ev') };
  fs.writeFileSync(files.delta, JSON.stringify(deltaPin)); fs.writeFileSync(files.cand, JSON.stringify({ head: cand.head, digest: cand.digest, files: cand.manifest.length })); fs.writeFileSync(files.jwks, JSON.stringify(fx.jwksPin));
  const lines = []; const said = [];
  const deps = {
    say: (s) => said.push(s), readLine: () => { const l = lines.shift(); if (l === 'PLAN') { const m = /To proceed the operator must send exactly:\n {2}(.+)$/.exec(said.at(-1) ?? ''); return m ? m[1] : ''; } return l ?? ''; },
    denoToken: DENO_TOKEN, now: () => Date.now(), sleep: async () => {}, pollMs: 1,
    psql: db.psql, applySql: db.applySql, keychain: { installerPassword: () => INSTALLER_PW, ring: (slot, kid) => { assert.equal(slot, 'k1'); assert.equal(kid, fx.jwksPin.active); return fx.k1.pkcs8; } },
    denoTransport: deno.transport, gatewayTransport: gw.transport, gatewayBase: C.GATEWAY_BASE,
    buildCandidate: () => cand, buildPrevious: () => buildPrevious(),
    evidenceDir: files.ev, deltaPinFile: files.delta, candidatePinFile: files.cand, jwksPinFile: files.jwks, deployedPinFile: files.deployed, deployPin: fx.deployPin,
  };
  mutate(deps);
  const remote = makeRemote(deps);
  const secrets = [...fx.secrets, DENO_TOKEN, INSTALLER_PW];
  const evidenceText = () => (fs.existsSync(files.ev) ? fs.readdirSync(files.ev).map((f) => fs.readFileSync(path.join(files.ev, f), 'utf8')).join('\n') : '');
  return { fx, gw, deno, db, remote, lines, said, files, secrets, evidenceText, cand,
    cleanup: async () => { await gw.cleanup(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
const stopCode = async (p) => { try { await p; return 'NO_STOP'; } catch (e) { return e.code ?? String(e.message); } };

test('probes discriminate the two sources on the REAL gateway handle(): previous passes "previous", candidate passes "candidate", never crosswise', async () => {
  const h = await harness();
  try {
    const prev = await h.remote.probes('previous');
    assert.deepEqual(prev.checks.filter((c) => !c.pass).map((c) => c.name), []);
    assert.ok(prev.total >= 30, `previous probes ${prev.total}`);
    const crossPrev = await h.remote.probes('candidate');
    assert.ok(!crossPrev.pass, 'candidate expectations fail on the deployed source');
    h.gw.state.live = 'candidate';
    h.gw.upstream.rest.length = 0;
    const cand = await h.remote.probes('candidate');
    assert.deepEqual(cand.checks.filter((c) => !c.pass).map((c) => c.name), []);
    const crossCand = await h.remote.probes('previous');
    assert.ok(!crossCand.pass, 'previous expectations fail on the candidate');
    // Public route upstream: only well-formed slugs reached Torneos REST, as anon (apikey, never Authorization).
    const pub = h.gw.upstream.rest.filter((r) => r.path === '/rpc/get_public_tournament_page');
    assert.ok(pub.length >= 1);
    assert.ok(pub.every((r) => r.apikey && !r.authorization && /^\{"p_public_slug":"probe-[0-9a-f]{8}","p_category_slug":null\}$/.test(r.body)), JSON.stringify(pub));
    assert.deepEqual(G.secretFindings(JSON.stringify([prev, cand]), h.secrets), []);
  } finally { await h.cleanup(); }
});

test('full sequence with fakes: G1 → W1 → W2 → W2 rollback → W1 rollback → W1 re-apply; one request per write; env never sent; evidence clean', async () => {
  const h = await harness();
  try {
    const g1 = await h.remote.g1();
    assert.equal(g1.verdict, 'G1_PASS', JSON.stringify(g1.failures));
    assert.equal(h.db.state.applied.length, 0); assert.equal(h.deno.state.writes.length, 0);
    // A wrong phrase writes nothing.
    h.lines.push('APPLY TORNEOS MIGRATION 0004 COMPETITION-V1 onzpwnqxnvlgsevivngf 000000000000');
    assert.equal(await stopCode(h.remote.w1()), 'NOT_AUTHORIZED');
    assert.equal(h.db.state.applied.length, 0);
    // W2 before W1 is refused (the DB is not POST_0004).
    assert.equal(await stopCode(h.remote.w2()), 'W2_DB_NOT_POST_0004');
    h.lines.push('PLAN'); assert.equal((await h.remote.w1()).verdict, 'W1_APPLIED');
    assert.deepEqual(h.db.state.applied, [C.MIGRATION.sha256]);
    assert.equal(await stopCode(h.remote.w1()), 'W1_PRECONDITION', 'a second W1 is refused (state POST_0004)');
    h.lines.push('PLAN'); const w2 = await h.remote.w2();
    assert.equal(w2.verdict, 'W2_DEPLOYED');
    assert.equal(h.deno.state.writes.length, 1);
    const body = h.deno.state.deployBodies[0];
    assert.deepEqual(Object.keys(body).sort(), ['assets', 'labels', 'preview', 'production']);
    assert.equal(body.labels['custom.bundle_digest'], h.cand.digest);
    assert.equal(h.gw.state.live, 'candidate');
    const deployed = JSON.parse(fs.readFileSync(h.files.deployed, 'utf8'));
    assert.equal(deployed.previous_revision, C.CURRENT.revision); assert.equal(deployed.source.digest, h.cand.digest);
    // DB rollback first is refused: the gateway still serves the candidate.
    assert.equal(await stopCode(h.remote.w1Rollback()), 'W1_ROLLBACK_GATEWAY_NOT_ON_PREVIOUS_SOURCE');
    h.lines.push('PLAN'); assert.equal((await h.remote.w2Rollback()).verdict, 'W2_ROLLED_BACK');
    assert.equal(h.gw.state.live, 'previous');
    assert.equal(h.deno.state.deployBodies[1].labels['custom.bundle_digest'], C.CURRENT.digest);
    h.lines.push('PLAN'); assert.equal((await h.remote.w1Rollback()).verdict, 'W1_ROLLED_BACK');
    assert.equal(h.db.state.state, 'ROLLED_BACK');
    h.lines.push('PLAN'); assert.equal((await h.remote.w1()).verdict, 'W1_APPLIED', 're-apply after rollback');
    assert.deepEqual(h.db.state.applied, [C.MIGRATION.sha256, C.ROLLBACK.sha256, C.MIGRATION.sha256]);
    assert.equal(h.deno.state.writes.length, 2);
    assert.ok(h.remote.denoRequests.every((r) => r.kind === 'read' || r.kind === 'write:deploy'));
    const ev = h.evidenceText();
    assert.deepEqual(G.secretFindings(ev, h.secrets), []);
    for (const s of h.secrets) assert.ok(!ev.includes(s));
    assert.ok(!h.said.join('\n').includes(INSTALLER_PW) && !h.said.join('\n').includes(DENO_TOKEN));
  } finally { await h.cleanup(); }
});

test('fail closed: drift, failed apply, failed revision, foreign revision, candidate ≠ pin, env drift, no Deno token', async () => {
  { // DB drift → G1 fails, W1 refused before any phrase, nothing applied.
    const h = await harness();
    try {
      h.db.state.drift = (s) => { s.functions[0].anon = true; };
      assert.equal((await h.remote.g1()).verdict, 'G1_FAILED');
      assert.equal(await stopCode(h.remote.w1()), 'W1_PRECONDITION');
      assert.equal(h.db.state.applied.length, 0);
    } finally { await h.cleanup(); }
  }
  { // The migration transaction fails → W1_FAILED_NO_CHANGE; W2 then refused.
    const h = await harness();
    try {
      h.db.state.failNextApply = true; h.lines.push('PLAN');
      assert.equal(await stopCode(h.remote.w1()), 'W1_FAILED_NO_CHANGE');
      assert.equal(h.db.state.state, 'PRE_0004');
      assert.equal(await stopCode(h.remote.w2()), 'W2_DB_NOT_POST_0004');
    } finally { await h.cleanup(); }
  }
  { // Revision fails to build → W2_POSTCHECK_FAILED, no deployed pin; the old source keeps serving.
    const h = await harness();
    try {
      h.lines.push('PLAN'); await h.remote.w1();
      h.deno.state.failDeploy = true; h.lines.push('PLAN');
      assert.equal(await stopCode(h.remote.w2()), 'W2_POSTCHECK_FAILED');
      assert.ok(!fs.existsSync(h.files.deployed)); assert.equal(h.gw.state.live, 'previous');
    } finally { await h.cleanup(); }
  }
  { // Someone deployed another revision → W2 refused; candidate digest ≠ pin → refused.
    const h = await harness();
    try {
      h.lines.push('PLAN'); await h.remote.w1();
      h.deno.revs.unshift({ id: 'foreign01', status: 'succeeded', labels: { 'custom.git_head': 'f'.repeat(40) }, env_vars: [] });
      assert.equal(await stopCode(h.remote.w2()), 'W2_CURRENT_REVISION_NOT_THE_PIN');
      h.deno.revs.shift();
      fs.writeFileSync(h.files.cand, JSON.stringify({ head: h.cand.head, digest: '0'.repeat(64), files: 16 }));
      assert.equal(await stopCode(h.remote.w2()), 'W2_CANDIDATE_NOT_THE_PIN');
      assert.equal(h.deno.state.writes.length, 0);
    } finally { await h.cleanup(); }
  }
  { // A non-secret env value changed on the app → observation fails, no deploy.
    const h = await harness();
    try {
      h.lines.push('PLAN'); await h.remote.w1();
      h.deno.app.env_vars.find((e) => e.key === 'TORNEOS_REST_URL').value = 'https://example.invalid/rest/v1';
      assert.equal(await stopCode(h.remote.w2()), 'W2_DENO_OBSERVE_FAILED');
      assert.equal(h.deno.state.writes.length, 0);
    } finally { await h.cleanup(); }
  }
  { // G1 Deno audit: organization + configuration against the certification; any drift fails G1, reads only.
    const h = await harness();
    try {
      const a = await h.remote.denoAudit();
      assert.deepEqual(a.failures, []);
      assert.deepEqual(a.runtime.runtime_fields, {});
      h.deno.app.updated_at = '2026-09-27T00:00:00.000Z';
      h.deno.app.labels.extra = 'x';
      h.deno.revs.push({ id: 'late0001', status: 'succeeded', labels: {}, env_vars: [] });
      const g = await h.remote.g1();
      assert.equal(g.verdict, 'G1_FAILED');
      assert.deepEqual(g.failures.filter((f) => f.startsWith('DENO_AUDIT')).sort(), ['DENO_AUDIT app labels = certified', 'DENO_AUDIT app updated_at = certified (no config/env change since)', 'DENO_AUDIT revision set = certified (no new revision)']);
      assert.equal(h.deno.state.writes.length, 0);
      assert.ok(h.remote.denoRequests.every((r) => r.kind === 'read'));
    } finally { await h.cleanup(); }
  }
  { // No Deno token: G1 runs without the Deno leg; any Deno step stops.
    const h = await harness({ mutate: (d) => { d.denoToken = null; } });
    try {
      const g = await h.remote.g1();
      assert.equal(g.verdict, 'G1_PASS_WITHOUT_DENO_OBSERVATION', JSON.stringify(g.failures));
      assert.equal(await stopCode(h.remote.denoObserve()), 'DENO_TOKEN_REQUIRED');
    } finally { await h.cleanup(); }
  }
  // Deno writes exist only armed, and only the deploy body shape.
  assert.throws(() => R.classifyDenoRequest({ method: 'POST', path: '/v2/apps/torneos-gateway/deploy', body: {} }), /not_armed/);
  assert.throws(() => R.classifyDenoRequest({ method: 'PATCH', path: '/v2/apps/torneos-gateway', body: { env_vars: [] } }, { armedFor: 'deploy' }), /not_armed/);
});

test('browser probe parses and targets only the gateway (no Torneos REST host, no other origin)', async () => {
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('./browser-competition-probe.js', import.meta.url), 'utf8');
  new vm.Script(src);
  const hosts = [...new Set([...src.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(hosts, ['app.arma2.com.ar', 'torneos-gateway.nicoavayu.deno.net']);
  assert.ok(src.includes(`const GW = '${C.GATEWAY_BASE}';`));
  assert.ok(!/localStorage\.setItem|method: 'DELETE'|method: 'PATCH'/.test(src));
});
