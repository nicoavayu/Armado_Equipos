// MEDIA-STORE-V1 deploy tool, offline: the closed Management API surface, the pinned artifact, and the deploy / redeploy /
// remove decisions with fake transports (no network, no gcloud, no secret leaves the process).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACT_SHA256, GCP, PATHS, REF, SECRET_NAME, artifact, assertRequest, redact, run } from './remote/deploy-media-store.mjs';

test('the artifact is exactly the reviewed tree: the function and the three gateway modules it imports', () => {
  const { manifest, digest } = artifact();
  assert.deepEqual(manifest.map((f) => f.path), ['functions/torneos-gateway/media-contract.ts', 'functions/torneos-gateway/media-image.ts',
    'functions/torneos-gateway/media-store-protocol.ts', 'functions/torneos-media-store/index.ts', 'functions/torneos-media-store/store.ts']);
  assert.equal(digest, ARTIFACT_SHA256, 'pin ARTIFACT_SHA256 to `deploy-media-store.mjs plan` after any change of these files');
});

test('the request surface is closed: five reads, one secret, one deploy, one delete; writes only when armed', () => {
  for (const p of [PATHS.project, PATHS.functions, PATHS.fn, PATHS.secrets, PATHS.apiKeys]) assert.equal(assertRequest({ method: 'GET', path: p }), 'read');
  for (const [method, p, body] of [['GET', `/v1/projects/${REF}/api-keys?reveal=true`], ['GET', '/v1/projects/rcyuuoaqfwcembdajcss/secrets'],
    ['GET', `/v1/projects/${REF}/database/query`], ['POST', `/v1/projects/${REF}/database/query`, { query: 'select 1', read_only: true }],
    ['PATCH', PATHS.project, {}], ['GET', PATHS.secrets, {}]]) {
    assert.throws(() => assertRequest({ method, path: p, body, armed: true }), /REQUEST_NOT_ALLOWED|WRITE_NOT_ARMED/, `${method} ${p}`);
  }
  const secret = [{ name: SECRET_NAME, value: 'a'.repeat(64) }];
  assert.throws(() => assertRequest({ method: 'POST', path: PATHS.secrets, body: secret }), /WRITE_NOT_ARMED/);
  assert.equal(assertRequest({ method: 'POST', path: PATHS.secrets, body: secret, armed: true }), 'write-secret');
  for (const body of [[{ name: 'SUPABASE_SERVICE_ROLE_KEY', value: 'a'.repeat(64) }], [{ name: SECRET_NAME, value: 'short' }],
    [...secret, ...secret], [{ name: SECRET_NAME, value: 'a'.repeat(64), extra: 1 }]]) {
    assert.throws(() => assertRequest({ method: 'POST', path: PATHS.secrets, body, armed: true }), /SECRET_BODY_NOT_ALLOWED/);
  }
  assert.equal(assertRequest({ method: 'POST', path: PATHS.deploy, body: Buffer.from('x'), armed: true }), 'write-deploy');
  assert.throws(() => assertRequest({ method: 'POST', path: PATHS.deploy.replace('torneos-media-store', 'torneos-gateway'), body: Buffer.from('x'), armed: true }), /REQUEST_NOT_ALLOWED/);
  assert.equal(assertRequest({ method: 'DELETE', path: PATHS.fn, armed: true }), 'write-delete');
  assert.throws(() => assertRequest({ method: 'DELETE', path: `/v1/projects/${REF}/functions/torneos-gateway`, armed: true }), /REQUEST_NOT_ALLOWED/);
});

function world({ secretNames = ['SUPABASE_URL'], gcpSecret = 'absent', fn = 404, probe = [401] } = {}) {
  const w = { requests: [], stdin: [], probes: 0 };
  w.api = async (req) => {
    assertRequest(req);
    w.requests.push(`${req.method} ${req.path}`);
    if (req.method === 'GET' && req.path === PATHS.project) return { status: 200, body: { ref: REF, status: 'ACTIVE_HEALTHY', region: 'sa-east-1' } };
    if (req.method === 'GET' && req.path === PATHS.functions) return { status: 200, body: [{ slug: 'torneos-gateway', status: 'ACTIVE', verify_jwt: false }] };
    if (req.method === 'GET' && req.path === PATHS.secrets) return { status: 200, body: secretNames.map((name) => ({ name, value: 'never-projected' })) };
    if (req.method === 'GET' && req.path === PATHS.apiKeys) return { status: 200, body: [{ name: 'default', type: 'secret', api_key: 'sb_secret_x' }] };
    if (req.method === 'GET' && req.path === PATHS.fn) return fn === 200 || w.deployed ? { status: 200, body: { slug: 'torneos-media-store', status: 'ACTIVE', verify_jwt: false, version: 1 } } : { status: 404, body: null };
    if (req.method === 'POST' && req.path === PATHS.secrets) { w.secretSet = req.body[0].value; return { status: 201, body: null }; }
    if (req.method === 'POST' && req.path === PATHS.deploy) { w.deployed = true; w.deployBody = req.body; return { status: 201, body: {} }; }
    if (req.method === 'DELETE') return { status: 200, body: null };
    throw new Error('unexpected');
  };
  w.gcloud = (args, input) => {
    w.calls = [...(w.calls ?? []), args.slice(0, 2).join(' ')];
    if (input !== undefined) w.stdin.push(input);
    if (args[1] === 'describe') return gcpSecret === 'present' ? { code: 0, out: 'name' } : { code: 1, out: 'NOT_FOUND: Secret not found' };
    return { code: 0, out: '' };
  };
  w.probe = async () => { const status = probe[Math.min(w.probes, probe.length - 1)]; w.probes += 1; return { status }; };
  w.confirm = async (expected) => { w.phrase = expected; return expected; };
  return w;
}

test('deploy (first time): one secret, generated once, to GCP on stdin and to Supabase; then the function; probe 401', async () => {
  const w = world();
  const out = await run('deploy', { ...w, generateSecret: () => 'c'.repeat(64) });
  assert.equal(w.phrase, `DEPLOY TORNEOS MEDIA STORE ${REF} ${ARTIFACT_SHA256.slice(0, 12)}`);
  assert.deepEqual(w.calls, ['secrets describe', 'secrets create', 'secrets add-iam-policy-binding']);
  assert.deepEqual(w.stdin, ['c'.repeat(64)], 'the value travels to gcloud on stdin only');
  assert.equal(w.secretSet, 'c'.repeat(64), 'the same value to the function');
  assert.ok(w.deployBody.includes(Buffer.from('"verify_jwt":false')));
  assert.equal(out.probe.status, 401);
  assert.equal(out.deployed.status, 'ACTIVE');
  assert.equal(redact(JSON.stringify(out)).includes('c'.repeat(64)), false, 'the secret never reaches the output');
  assert.equal(JSON.stringify(out).includes('never-projected') || JSON.stringify(out).includes('sb_secret_x'), false, 'no secret value or key is projected');
  assert.ok(!w.requests.some((r) => r.startsWith('DELETE')));
});

test('deploy refuses anything but a first deployment; redeploy needs both secrets and generates nothing; a 503 probe stops', async () => {
  for (const state of [{ secretNames: [SECRET_NAME] }, { gcpSecret: 'present' }, { fn: 200 }]) {
    await assert.rejects(run('deploy', world(state)), /NOT_A_FIRST_DEPLOYMENT/, JSON.stringify(state));
  }
  await assert.rejects(run('redeploy', world()), /SECRETS_MISSING_USE_DEPLOY/);
  const w = world({ secretNames: [SECRET_NAME], gcpSecret: 'present', fn: 200 });
  const out = await run('redeploy', { ...w, generateSecret: () => { throw new Error('must not generate'); } });
  assert.equal(out.probe.status, 401);
  assert.deepEqual(w.calls, ['secrets describe'], 'no GCP write');
  assert.equal(w.secretSet, undefined, 'no Supabase secret write');
  const disabled = world({ secretNames: [SECRET_NAME], gcpSecret: 'present', fn: 200, probe: [503] });
  // A function whose configuration did not load answers 503 to everyone: STOP (the gateway is not switched).
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
  try { await assert.rejects(run('redeploy', disabled), /PROBE_FAILED/); } finally { globalThis.setTimeout = realTimeout; }
});

test('a wrong phrase stops before any write; remove deletes only this function', async () => {
  const w = world();
  w.confirm = async () => 'DEPLOY TORNEOS MEDIA STORE';
  await assert.rejects(run('deploy', w), /PHRASE_MISMATCH/);
  assert.deepEqual(w.calls, ['secrets describe']);
  assert.ok(!w.requests.some((r) => !r.startsWith('GET')));
  const r = world({ fn: 200 });
  const out = await run('remove', r);
  assert.equal(out.removed, true);
  assert.deepEqual(r.requests.filter((x) => !x.startsWith('GET')), [`DELETE ${PATHS.fn}`]);
  assert.equal(GCP.secret, 'torneos-gw-media-store-secret');
});
