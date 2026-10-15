// ACCOUNT ERASURE (0021) — the gateway route POST /core/v1/account-erasure against the REAL gateway source
// (torneos-gateway/index.ts, loaded like the other gateway suites) with a Production-shaped env built from throwaway
// material.
//   A. offline: a recording database stub — signature, window, origin, body schema, method, outcomes, failures, and the
//      exact SQL (torneos_core_adapter, 15 s statement / 5 s lock timeouts, the core id only from the signed body).
//   B. end to end on the lab (fictional data): Core's real shared module (supabase/functions/_shared/torneosAccountErasure.ts,
//      transpiled) signs → the real gateway verifies → the real 0021 function on the hosted-like database, through a lab
//      login that is a NOINHERIT member of torneos_core_adapter. Skipped with ACCOUNT_DELETION_SKIP_LAB=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv, BASE } from '../infra/torneos-competition-v1/test-support.mjs';

const TEST_CA = '-----BEGIN CERTIFICATE-----\nQUNDT1VOVC1FUkFTVVJFLXRlc3QtY2E=\n-----END CERTIFICATE-----\n';
const ROUTE = '/core/v1/account-erasure';
const URL_ = `${BASE}${ROUTE}`;
const HOST = new URL(BASE).host;

function sign(secretHex, { time = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString('hex'), body, raw = false }) {
  const key = raw ? Buffer.from(secretHex, 'hex') : createHmac('sha256', Buffer.from(secretHex, 'hex')).update('torneos-core-contract:account-erasure:v1').digest();
  const signature = createHmac('sha256', key).update(`${ROUTE}\n${time}\n${nonce}\n`).update(body).digest('hex');
  return { 'x-time': String(time), 'x-nonce': nonce, 'x-signature': signature };
}
function request(secretHex, payload, { headers = {}, method = 'POST', signOpts = {} } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request(URL_, { method, body: method === 'GET' ? undefined : body,
    headers: { host: HOST, 'content-type': 'application/json', ...sign(secretHex, { body: Buffer.from(body), ...signOpts }), ...headers } });
}

// ------------------------------------------------------------------------------------------------ A. offline
const world = { sql: [], answer: null };
globalThis.__erasureWorld = world;
const stub = `export default function postgres() { return { begin: async (fn) => fn({ unsafe: async (q, params) => {
  const w = globalThis.__erasureWorld; w.sql.push({ q, params });
  if (q.startsWith('SET LOCAL ')) return [];
  if (q.startsWith('SELECT private.erase_tournament_account')) { if (w.answer instanceof Error) throw w.answer; return [{ result: w.answer }]; }
  throw new Error('Unexpected SQL');
} }), end: async () => {} }; }`;
let fx; let tree; let gateway;
test.before(async () => {
  fx = fixtureEnv({ caPem: TEST_CA });
  globalThis.Deno = { env: { toObject: () => ({ ...fx.env }) } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
});
test.after(async () => { delete globalThis.Deno; await tree?.cleanup(); });
test.beforeEach(() => { world.sql = []; world.answer = { outcome: 'erased', counts: { profilesDeleted: 1 }, organizationsTransferred: ['x'] }; });
const secret = () => fx.env.TORNEOS_CONTRACT_SERVICE_SECRET;
const read = async (r) => [r.status, await r.json()];

test('A1 a signed request erases: 200 {ok, outcome} only (no ids, no counts), as torneos_core_adapter with the erasure timeouts', async () => {
  const core = randomUUID(); const requestId = randomUUID();
  const r = await gateway.handle(request(secret(), { core_user_id: core, request_id: requestId }));
  assert.deepEqual(await read(r), [200, { ok: true, outcome: 'erased' }]);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'no CORS on this route');
  assert.deepEqual(world.sql.map((s) => s.q), ['SET LOCAL ROLE torneos_core_adapter', 'SET LOCAL statement_timeout = 15000', 'SET LOCAL lock_timeout = 5000',
    'SELECT private.erase_tournament_account($1::uuid, $2::uuid) AS result']);
  assert.deepEqual(world.sql[3].params, [core, requestId]);
});

test('A2 every outcome the function can give passes through; an unknown one is a 503', async () => {
  for (const outcome of ['erased', 'already_erased', 'no_identity']) {
    world.answer = { outcome };
    assert.deepEqual(await read(await gateway.handle(request(secret(), { core_user_id: randomUUID(), request_id: randomUUID() }))), [200, { ok: true, outcome }]);
  }
  world.answer = { outcome: 'partial' };
  assert.deepEqual(await read(await gateway.handle(request(secret(), { core_user_id: randomUUID(), request_id: randomUUID() }))), [503, { error: 'TORNEOS_UNAVAILABLE' }]);
});

test('A3 authentication: bad signature, the RAW contract secret (Torneos → Core key), a stale or future time, malformed headers → 401 and no SQL', async () => {
  const body = { core_user_id: randomUUID(), request_id: randomUUID() };
  const cases = {
    wrongSecret: request(randomBytes(32).toString('hex'), body),
    rawSecret: request(secret(), body, { signOpts: { raw: true } }),
    stale: request(secret(), body, { signOpts: { time: Math.floor(Date.now() / 1000) - 31 } }),
    future: request(secret(), body, { signOpts: { time: Math.floor(Date.now() / 1000) + 31 } }),
    badNonce: request(secret(), body, { headers: { 'x-nonce': 'zz' } }),
    noSignature: request(secret(), body, { headers: { 'x-signature': '' } }),
  };
  for (const [name, req] of Object.entries(cases)) {
    assert.deepEqual(await read(await gateway.handle(req)), [401, { error: 'SERVICE_AUTH_REQUIRED' }], name);
  }
  // A body changed after signing.
  const signed = sign(secret(), { body: Buffer.from(JSON.stringify(body)) });
  const tampered = new Request(URL_, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json', ...signed },
    body: JSON.stringify({ ...body, core_user_id: randomUUID() }) });
  assert.equal((await gateway.handle(tampered)).status, 401, 'tampered body');
  assert.equal(world.sql.length, 0);
});

test('A4 a browser can never call it: any Origin (even the allowed web origin) → 403; foreign host → 403; GET → 405', async () => {
  const body = { core_user_id: randomUUID(), request_id: randomUUID() };
  assert.equal((await gateway.handle(request(secret(), body, { headers: { origin: 'https://app.arma2.com.ar' } }))).status, 403);
  assert.equal((await gateway.handle(request(secret(), body, { headers: { origin: 'https://evil.example' } }))).status, 403);
  assert.equal((await gateway.handle(request(secret(), body, { headers: { host: 'evil.example' } }))).status, 403);
  assert.equal((await gateway.handle(request(secret(), body, { method: 'GET' }))).status, 405);
  assert.equal(world.sql.length, 0);
});

test('A5 the body is closed: exactly core_user_id + request_id, canonical lowercase UUIDs, JSON content type, ≤ 512 bytes', async () => {
  const id = randomUUID();
  for (const [name, payload] of Object.entries({
    extraKey: { core_user_id: id, request_id: id, identity_id: id }, missing: { core_user_id: id }, upper: { core_user_id: id.toUpperCase(), request_id: id },
    notUuid: { core_user_id: 'me', request_id: id }, array: [id], notJson: 'core_user_id=me', big: { core_user_id: id, request_id: id, pad: 'x'.repeat(600) },
  })) {
    assert.deepEqual(await read(await gateway.handle(request(secret(), payload))), [400, { error: 'INVALID_REQUEST' }], name);
  }
  assert.equal((await gateway.handle(request(secret(), { core_user_id: id, request_id: id }, { headers: { 'content-type': 'text/plain' } }))).status, 400);
  assert.equal(world.sql.filter((s) => s.q.startsWith('SELECT')).length, 0);
});

test('A6 a database failure (unavailable, lock timeout, refused postcondition) is a retryable 503 that reveals nothing', async () => {
  for (const error of [Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }), Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
    Object.assign(new Error('TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED'), { code: '55000' })]) {
    world.answer = error;
    assert.deepEqual(await read(await gateway.handle(request(secret(), { core_user_id: randomUUID(), request_id: randomUUID() }))), [503, { error: 'TORNEOS_UNAVAILABLE' }]);
  }
});

test('A7 the other routes are unchanged: a Core-signed erasure request is not a bearer, and /exchange still refuses it', async () => {
  const req = new Request(`${BASE}/exchange`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await gateway.handle(req)).status, 401);
});

// ------------------------------------------------------------------------------------------------ B. end to end on the lab
if (process.env.ACCOUNT_DELETION_SKIP_LAB !== '1') {
  test('B Core shared module → real gateway → real 0021 on the lab: erased → already_erased; never-used → no_identity; wrong secret refused', async () => {
    const L = await import('./test/lab.mjs');
    const S = await import('./test/support.mjs');
    const record = S.evidence('gateway-e2e-lab');
    await L.prepare();
    await L.toPost();
    globalThis.__erasureLabUrls = { coreAdapter: L.gatewayLoginUrl('coreAdapter'), identityWriter: L.gatewayLoginUrl('identityWriter') };
    const realTree = await loadGatewayTree({ postgresModule: L.postgresStandIn() });
    const realGateway = await realTree.import('torneos-gateway/index.ts');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-core-erasure-'));
    const source = await fs.readFile('supabase/functions/_shared/torneosAccountErasure.ts', 'utf8');
    await fs.writeFile(path.join(dir, 'erasure.mjs'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
    const core = await import(pathToFileURL(path.join(dir, 'erasure.mjs')).href);
    const pool = L.installerPool();
    // What Core's function sees: its own env (the same contract secret the gateway holds) and the gateway's public URL.
    const coreEnv = (overrides = {}) => ({ get: (n) => ({ TORNEOS_GATEWAY_URL: BASE, TORNEOS_CONTRACT_SERVICE_SECRET: secret(), ...overrides })[n] });
    const viaGateway = (url, init) => realGateway.handle(new Request(url, { ...init, headers: { ...init.headers, host: HOST } }));
    try {
      const id = randomUUID(); const coreId = randomUUID();
      await pool.query('insert into public.torneos_identity(id, core_user_id) values ($1, $2)', [id, coreId]);
      await pool.query("insert into public.tournament_user_profiles(user_id, display_name) values ($1, 'Gateway Ficticio')", [id]);
      const first = await core.requestTorneosAccountErasure({ env: coreEnv(), coreUserId: coreId, fetchImpl: viaGateway });
      const second = await core.requestTorneosAccountErasure({ env: coreEnv(), coreUserId: coreId, fetchImpl: viaGateway });
      const never = await core.requestTorneosAccountErasure({ env: coreEnv(), coreUserId: randomUUID(), fetchImpl: viaGateway });
      const refused = await core.requestTorneosAccountErasure({ env: coreEnv({ TORNEOS_CONTRACT_SERVICE_SECRET: randomBytes(32).toString('hex') }), coreUserId: randomUUID(), fetchImpl: viaGateway });
      assert.deepEqual(first, { ok: true, outcome: 'erased' });
      assert.deepEqual(second, { ok: true, outcome: 'already_erased' });
      assert.deepEqual(never, { ok: true, outcome: 'no_identity' });
      assert.deepEqual(refused, { ok: false, code: 'torneos_erasure_refused', retryable: false });
      const left = (await pool.query('select (select count(*)::int from public.tournament_user_profiles where user_id = $1) profiles, (select count(*)::int from public.torneos_identity where core_user_id = $2) mapped', [id, coreId])).rows[0];
      assert.deepEqual(left, { profiles: 0, mapped: 0 });
      record({ check: 'core → gateway → 0021', ok: true, details: { first: first.outcome, second: second.outcome, never: never.outcome, wrongSecret: refused.code, left } });
    } finally {
      await pool.end();
      await realTree.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
