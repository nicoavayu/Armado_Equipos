// ACCOUNT ERASURE (0021) — the gateway routes POST /core/v1/account-erasure and /core/v1/account-erasure/confirm against the
// REAL gateway source (torneos-gateway/index.ts, loaded like the other gateway suites) with a Production-shaped env built
// from throwaway material, including the dedicated erasure login (TORNEOS_DB_ERASURE_WRITER_URL).
//   A. offline: a recording database stub that also records WHICH login runs each statement — signature (per path),
//      window, origin, body schema, method, outcomes, failures, the exact SQL (torneos_erasure_writer, 15 s statement /
//      5 s lock timeouts, the core id only from the signed body), never the core adapter's login; fail closed (503 after
//      authentication, no SQL) without the erasure login.
//   B. end to end on the lab (fictional data): Core's real shared module (supabase/functions/_shared/torneosAccountErasure.ts,
//      transpiled) signs → the real gateway verifies → the real 0021 functions on the hosted-like database, through the
//      erasure login provisioned with the operator's SQL (NOINHERIT member of torneos_erasure_writer). Skipped with
//      ACCOUNT_DELETION_SKIP_LAB=1.
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
const CONFIRM = '/core/v1/account-erasure/confirm';
const HOST = new URL(BASE).host;
const REF = 'onzpwnqxnvlgsevivngf';

function sign(secretHex, { time = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString('hex'), body, raw = false, route = ROUTE }) {
  const key = raw ? Buffer.from(secretHex, 'hex') : createHmac('sha256', Buffer.from(secretHex, 'hex')).update('torneos-core-contract:account-erasure:v1').digest();
  const signature = createHmac('sha256', key).update(`${route}\n${time}\n${nonce}\n`).update(body).digest('hex');
  return { 'x-time': String(time), 'x-nonce': nonce, 'x-signature': signature };
}
function request(secretHex, payload, { headers = {}, method = 'POST', signOpts = {}, route = ROUTE } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request(`${BASE}${route}`, { method, body: method === 'GET' ? undefined : body,
    headers: { host: HOST, 'content-type': 'application/json', ...sign(secretHex, { body: Buffer.from(body), route, ...signOpts }), ...headers } });
}
/** The fixture env + the erasure login on the same pooler host as the other two, with its own password. */
function withErasureLogin(env) {
  const adapter = new URL(env.TORNEOS_DB_CORE_ADAPTER_URL);
  return { ...env, TORNEOS_DB_ERASURE_WRITER_URL: `postgres://torneos_edge_erasure_writer.${REF}:${randomBytes(30).toString('base64url')}@${adapter.host}/postgres` };
}

// ------------------------------------------------------------------------------------------------ A. offline
const world = { sql: [], answer: null };
globalThis.__erasureWorld = world;
const stub = `export default function postgres(url) {
  const login = decodeURIComponent(new URL(url).username).split('.')[0];
  return { begin: async (fn) => fn({ unsafe: async (q, params) => {
    const w = globalThis.__erasureWorld; w.sql.push({ login, q, params });
    if (q.startsWith('SET LOCAL ')) return [];
    if (q.startsWith('INSERT INTO public.torneos_identity')) { if (w.identityError) throw w.identityError; return [{ id: params[0], core_user_id: params[0] }]; }
    if (q.startsWith('SELECT private.erase_tournament_account') || q.startsWith('SELECT private.confirm_tournament_account_erasure')) {
      const a = typeof w.answer === 'function' ? w.answer(q) : w.answer;
      if (a instanceof Error) throw a; return [{ result: a }];
    }
    throw new Error('Unexpected SQL');
  } }), end: async () => {} }; }`;
let fx; let env; let tree; let gateway;
test.before(async () => {
  fx = fixtureEnv({ caPem: TEST_CA });
  env = withErasureLogin(fx.env);
  globalThis.Deno = { env: { toObject: () => ({ ...env }) } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
});
test.after(async () => { delete globalThis.Deno; await tree?.cleanup(); });
test.beforeEach(() => { world.sql = []; world.answer = (q) => (q.includes('confirm') ? { outcome: 'core_confirmed', confirmedNow: 1 } : { outcome: 'erased', counts: { profilesDeleted: 1 }, organizationsTransferred: ['x'] }); });
const secret = () => fx.env.TORNEOS_CONTRACT_SERVICE_SECRET;
const read = async (r) => [r.status, await r.json()];
const body = () => ({ core_user_id: randomUUID(), request_id: randomUUID() });

test('A1 a signed erase: 200 {ok, outcome} only (no ids, no counts), through the ERASURE login as torneos_erasure_writer with the erasure timeouts', async () => {
  const b = body();
  const r = await gateway.handle(request(secret(), b));
  assert.deepEqual(await read(r), [200, { ok: true, outcome: 'erased' }]);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'no CORS on this route');
  assert.deepEqual(world.sql.map((s) => s.q), ['SET LOCAL ROLE torneos_erasure_writer', 'SET LOCAL statement_timeout = 15000', 'SET LOCAL lock_timeout = 5000',
    'SELECT private.erase_tournament_account($1::uuid, $2::uuid) AS result']);
  assert.deepEqual(world.sql[3].params, [b.core_user_id, b.request_id]);
  assert.deepEqual([...new Set(world.sql.map((s) => s.login))], ['torneos_edge_erasure_writer'], 'never the core adapter\'s or the identity writer\'s login');
});

test('A2 the confirmation route: its own signature, confirm_tournament_account_erasure, outcomes core_confirmed / no_ledger; an erase signature never passes as a confirmation', async () => {
  for (const outcome of ['core_confirmed', 'no_ledger']) {
    world.sql = []; world.answer = { outcome };
    const b = body();
    assert.deepEqual(await read(await gateway.handle(request(secret(), b, { route: CONFIRM }))), [200, { ok: true, outcome }]);
    assert.deepEqual(world.sql.map((s) => s.q).at(-1), 'SELECT private.confirm_tournament_account_erasure($1::uuid, $2::uuid) AS result');
    assert.deepEqual(world.sql.at(-1).params, [b.core_user_id, b.request_id]);
    assert.ok(world.sql.every((s) => s.login === 'torneos_edge_erasure_writer'));
  }
  world.sql = [];
  // Signed for the erase path, sent to the confirm path (and the opposite): 401, no SQL.
  const b = JSON.stringify(body());
  const crossed = new Request(`${BASE}${CONFIRM}`, { method: 'POST', body: b, headers: { host: HOST, 'content-type': 'application/json', ...sign(secret(), { body: Buffer.from(b) }) } });
  assert.deepEqual(await read(await gateway.handle(crossed)), [401, { error: 'SERVICE_AUTH_REQUIRED' }]);
  const crossed2 = new Request(`${BASE}${ROUTE}`, { method: 'POST', body: b, headers: { host: HOST, 'content-type': 'application/json', ...sign(secret(), { body: Buffer.from(b), route: CONFIRM }) } });
  assert.deepEqual(await read(await gateway.handle(crossed2)), [401, { error: 'SERVICE_AUTH_REQUIRED' }]);
  // An erase outcome on the confirmation route (or the opposite) is not trusted.
  world.answer = { outcome: 'erased' };
  assert.deepEqual(await read(await gateway.handle(request(secret(), body(), { route: CONFIRM }))), [503, { error: 'TORNEOS_UNAVAILABLE' }]);
  world.answer = { outcome: 'core_confirmed' };
  assert.deepEqual(await read(await gateway.handle(request(secret(), body()))), [503, { error: 'TORNEOS_UNAVAILABLE' }]);
});

test('A3 every erase outcome the function can give passes through; an unknown one is a 503', async () => {
  for (const outcome of ['erased', 'already_erased', 'no_identity']) {
    world.answer = { outcome };
    assert.deepEqual(await read(await gateway.handle(request(secret(), body()))), [200, { ok: true, outcome }]);
  }
  world.answer = { outcome: 'partial' };
  assert.deepEqual(await read(await gateway.handle(request(secret(), body()))), [503, { error: 'TORNEOS_UNAVAILABLE' }]);
});

test('A4 authentication: bad signature, the RAW contract secret (Torneos → Core key), a stale or future time, malformed headers → 401 and no SQL', async () => {
  const b = body();
  const cases = {
    wrongSecret: request(randomBytes(32).toString('hex'), b),
    rawSecret: request(secret(), b, { signOpts: { raw: true } }),
    stale: request(secret(), b, { signOpts: { time: Math.floor(Date.now() / 1000) - 31 } }),
    future: request(secret(), b, { signOpts: { time: Math.floor(Date.now() / 1000) + 31 } }),
    badNonce: request(secret(), b, { headers: { 'x-nonce': 'zz' } }),
    noSignature: request(secret(), b, { headers: { 'x-signature': '' } }),
    confirmWrongSecret: request(randomBytes(32).toString('hex'), b, { route: CONFIRM }),
  };
  for (const [name, req] of Object.entries(cases)) {
    assert.deepEqual(await read(await gateway.handle(req)), [401, { error: 'SERVICE_AUTH_REQUIRED' }], name);
  }
  // A body changed after signing.
  const signed = sign(secret(), { body: Buffer.from(JSON.stringify(b)) });
  const tampered = new Request(`${BASE}${ROUTE}`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json', ...signed },
    body: JSON.stringify({ ...b, core_user_id: randomUUID() }) });
  assert.equal((await gateway.handle(tampered)).status, 401, 'tampered body');
  assert.equal(world.sql.length, 0);
});

test('A5 a browser can never call it: any Origin (even the allowed web origin) → 403; foreign host → 403; GET → 405 (both routes)', async () => {
  for (const route of [ROUTE, CONFIRM]) {
    const b = body();
    assert.equal((await gateway.handle(request(secret(), b, { route, headers: { origin: 'https://app.arma2.com.ar' } }))).status, 403);
    assert.equal((await gateway.handle(request(secret(), b, { route, headers: { origin: 'https://evil.example' } }))).status, 403);
    assert.equal((await gateway.handle(request(secret(), b, { route, headers: { host: 'evil.example' } }))).status, 403);
    assert.equal((await gateway.handle(request(secret(), b, { route, method: 'GET' }))).status, 405);
  }
  assert.equal(world.sql.length, 0);
});

test('A6 the body is closed: exactly core_user_id + request_id, canonical lowercase UUIDs, JSON content type, ≤ 512 bytes', async () => {
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

test('A7 a database failure (unavailable, lock timeout, refused postcondition) is a retryable 503 that reveals nothing', async () => {
  for (const error of [Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }), Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
    Object.assign(new Error('TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED'), { code: '55000' })]) {
    world.answer = error;
    assert.deepEqual(await read(await gateway.handle(request(secret(), body()))), [503, { error: 'TORNEOS_UNAVAILABLE' }]);
    assert.deepEqual(await read(await gateway.handle(request(secret(), body(), { route: CONFIRM }))), [503, { error: 'TORNEOS_UNAVAILABLE' }]);
  }
});

test('A8 the other routes are unchanged: a Core-signed erasure request is not a bearer, and /exchange still refuses it', async () => {
  const req = new Request(`${BASE}/exchange`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await gateway.handle(req)).status, 401);
});

test('A9 fail closed WITHOUT the erasure login: the gateway boots, an unsigned call is 401, a signed one is 503 — and no SQL runs on any login', async () => {
  const offEnv = { ...fx.env };
  delete offEnv.TORNEOS_DB_ERASURE_WRITER_URL;
  globalThis.Deno = { env: { toObject: () => ({ ...offEnv }) } };
  const offTree = await loadGatewayTree({ postgresModule: stub });
  try {
    const off = await offTree.import('torneos-gateway/index.ts');
    world.sql = [];
    for (const route of [ROUTE, CONFIRM]) {
      assert.deepEqual(await read(await off.handle(request(randomBytes(32).toString('hex'), body(), { route }))), [401, { error: 'SERVICE_AUTH_REQUIRED' }]);
      assert.deepEqual(await read(await off.handle(request(secret(), body(), { route }))), [503, { error: 'TORNEOS_UNAVAILABLE' }]);
    }
    assert.equal(world.sql.length, 0, 'never a fallback to the core adapter\'s login');
    // The rest of the gateway still works: the JWKS answers.
    assert.equal((await off.handle(new Request(`${BASE}/.well-known/jwks.json`, { headers: { host: HOST } }))).status, 200);
  } finally {
    globalThis.Deno = { env: { toObject: () => ({ ...env }) } };
    await offTree.cleanup();
  }
});

test('A10 the erasure login must be its own: the core adapter\'s login or password, or the Core contract secret as its password, disable the gateway', async () => {
  const C = await tree.import('torneos-gateway/config.ts');
  const adapter = new URL(fx.env.TORNEOS_DB_CORE_ADAPTER_URL);
  const url = (login, password) => `postgres://${login}.${REF}:${password}@${adapter.host}/postgres`;
  for (const [name, value] of Object.entries({
    adapterLogin: url('torneos_edge_core_adapter', 'own-password-0123456789'),
    adapterPassword: url('torneos_edge_erasure_writer', decodeURIComponent(adapter.password)),
    contractSecret: url('torneos_edge_erasure_writer', secret()),
    baseRole: url('torneos_erasure_writer', 'own-password-0123456789'),
  })) {
    assert.throws(() => C.loadConfig({ ...fx.env, TORNEOS_DB_ERASURE_WRITER_URL: value }), C.ConfigError, name);
  }
});

test('A11 the tombstone on /exchange: the database refusal TORNEOS_ACCOUNT_ERASED becomes a typed AccountErased (403 TORNEOS_ACCOUNT_ERASED), never a new identity', async () => {
  const db = await tree.import('torneos-gateway/db.ts');
  const postgres = (await import(pathToFileURL(path.join(tree.dir, 'postgres-driver.mjs')).href)).default;
  const sql = postgres(fx.env.TORNEOS_DB_IDENTITY_WRITER_URL);
  world.identityError = Object.assign(new Error('TORNEOS_ACCOUNT_ERASED'), { code: '42501' });
  try {
    await assert.rejects(db.allocateIdentity(sql, randomUUID()), (e) => e instanceof db.AccountErased);
    world.identityError = Object.assign(new Error('permission denied'), { code: '42501' });
    await assert.rejects(db.allocateIdentity(sql, randomUUID()), (e) => !(e instanceof db.AccountErased), 'only the tombstone message is typed');
  } finally { world.identityError = null; }
  const id = randomUUID();
  assert.deepEqual(await db.allocateIdentity(sql, id), { id, core_user_id: id });
  const index = await fs.readFile(path.join(tree.dir, 'torneos-gateway', 'index.ts'), 'utf8').catch(async () => fs.readFile('backend/torneos/supabase/functions/torneos-gateway/index.ts', 'utf8'));
  assert.match(index, /if \(error instanceof AccountErased\) return json\(403, \{ error: ACCOUNT_ERASED \}, cors\)/);
  assert.equal(db.ACCOUNT_ERASED, 'TORNEOS_ACCOUNT_ERASED');
});

test('A12 timeouts nest: the database lock bound (5 s) < the erasure statement bound (15 s) < Core\'s request timeout (20 s), so a busy lock is a retryable 503, never a hung request', async () => {
  const db = await tree.import('torneos-gateway/db.ts');
  const core = await fs.readFile('supabase/functions/_shared/torneosAccountErasure.ts', 'utf8');
  const coreTimeout = Number(/export const ERASURE_TIMEOUT_MS = (\d+)/.exec(core)[1]);
  const migration = await fs.readFile('backend/torneos/supabase/migrations/00000000000021_account_erasure.sql', 'utf8');
  const dbLock = Number(/set_config\('lock_timeout', '(\d+)', true\)/.exec(migration)[1]);
  assert.equal(dbLock, db.ERASURE_LOCK_TIMEOUT_MS);
  assert.ok(db.ERASURE_LOCK_TIMEOUT_MS < db.ERASURE_STATEMENT_TIMEOUT_MS && db.ERASURE_STATEMENT_TIMEOUT_MS < coreTimeout, `${dbLock} < ${db.ERASURE_STATEMENT_TIMEOUT_MS} < ${coreTimeout}`);
  world.answer = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
  assert.deepEqual(await read(await gateway.handle(request(secret(), body()))), [503, { error: 'TORNEOS_UNAVAILABLE' }], 'the lock bound → retryable 503 (Core: torneos_erasure_failed, account kept)');
});

// ------------------------------------------------------------------------------------------------ B. end to end on the lab
if (process.env.ACCOUNT_DELETION_SKIP_LAB !== '1') {
  test('B Core shared module → real gateway → real 0021 on the lab, through the erasure login: erased → already_erased → confirmed; never-used → no_identity / no_ledger; wrong secret refused', async () => {
    const L = await import('./test/lab.mjs');
    const S = await import('./test/support.mjs');
    const record = S.evidence('gateway-e2e-lab');
    await L.prepare();
    await L.toPost();
    globalThis.__erasureLabUrls = { coreAdapter: L.gatewayLoginUrl('coreAdapter'), identityWriter: L.gatewayLoginUrl('identityWriter'),
      erasureWriter: L.gatewayLoginUrl('erasureWriter') };
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
      const ledgerAfterErase = (await pool.query('select state, request_id from private.tournament_account_erasures where identity_id = $1', [id])).rows;
      // The gateway's real /exchange upsert (db.ts allocateIdentity, identity-writer login) for the erased Core user — what a
      // still-valid Core JWT would reach: the tombstone refuses it, no identity row appears.
      const rdb = await realTree.import('torneos-gateway/db.ts');
      const rpg = (await import(pathToFileURL(path.join(realTree.dir, 'postgres-driver.mjs')).href)).default;
      const identitySql = rpg(env.TORNEOS_DB_IDENTITY_WRITER_URL);
      await assert.rejects(rdb.allocateIdentity(identitySql, coreId), (e) => e instanceof rdb.AccountErased);
      const fresh = await rdb.allocateIdentity(identitySql, randomUUID());
      assert.ok(fresh.id, 'a new Core account still gets its identity');
      await identitySql.end();
      const second = await core.requestTorneosAccountErasure({ env: coreEnv(), coreUserId: coreId, fetchImpl: viaGateway });
      const confirmed = await core.confirmTorneosAccountErasure({ env: coreEnv(), coreUserId: coreId, fetchImpl: viaGateway });
      const ledgerAfterConfirm = (await pool.query('select state, core_confirm_request_id from private.tournament_account_erasures where identity_id = $1', [id])).rows;
      const neverId = randomUUID();
      const never = await core.requestTorneosAccountErasure({ env: coreEnv(), coreUserId: neverId, fetchImpl: viaGateway });
      const neverConfirm = await core.confirmTorneosAccountErasure({ env: coreEnv(), coreUserId: neverId, fetchImpl: viaGateway });
      const refused = await core.requestTorneosAccountErasure({ env: coreEnv({ TORNEOS_CONTRACT_SERVICE_SECRET: randomBytes(32).toString('hex') }), coreUserId: randomUUID(), fetchImpl: viaGateway });
      assert.deepEqual(first, { ok: true, outcome: 'erased' });
      const requestId = await core.deriveRequestId(await core.deriveErasureKey(core.parseSecret(secret())), coreId);
      assert.deepEqual(ledgerAfterErase, [{ state: 'torneos_erased', request_id: requestId }], 'the ledger holds Core\'s idempotency key');
      assert.deepEqual(second, { ok: true, outcome: 'already_erased' });
      assert.deepEqual(confirmed, { ok: true, outcome: 'core_confirmed' });
      assert.deepEqual(ledgerAfterConfirm, [{ state: 'core_confirmed', core_confirm_request_id: requestId }]);
      assert.deepEqual([never, neverConfirm], [{ ok: true, outcome: 'no_identity' }, { ok: true, outcome: 'no_ledger' }]);
      assert.deepEqual(refused, { ok: false, code: 'torneos_erasure_refused', retryable: false });
      const left = (await pool.query('select (select count(*)::int from public.tournament_user_profiles where user_id = $1) profiles, (select count(*)::int from public.torneos_identity where core_user_id = $2) mapped', [id, coreId])).rows[0];
      assert.deepEqual(left, { profiles: 0, mapped: 0 });
      record({ check: 'core → gateway (erasure login) → 0021', ok: true, details: { first: first.outcome, ledger: ledgerAfterErase[0].state, second: second.outcome,
        confirm: confirmed.outcome, ledgerAfterConfirm: ledgerAfterConfirm[0].state, never: never.outcome, neverConfirm: neverConfirm.outcome, wrongSecret: refused.code, left } });
    } finally {
      await pool.end();
      await realTree.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
