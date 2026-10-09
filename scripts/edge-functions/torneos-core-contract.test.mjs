// Unit harness for supabase/functions/torneos-core-contract (Phase 3A).
// Transpiles the real TypeScript with the same approach as the signer tests and
// exercises the pure contract module directly plus the Deno wiring with stubs.
// The SQL side is exercised for real by integration/torneos-core-contracts.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let loadCounter = 0;

const sharedPath = path.join(process.cwd(), 'supabase', 'functions', '_shared', 'torneosCoreContract.ts');
const indexPath = path.join(process.cwd(), 'supabase', 'functions', 'torneos-core-contract', 'index.ts');

function transpile(source, fileName) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
    fileName,
  }).outputText;
}

async function loadModules(environment = {}) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-core-contract-'));
  const shared = transpile(await fs.readFile(sharedPath, 'utf8'), 'torneosCoreContract.ts');
  await fs.writeFile(path.join(outDir, 'contract.mjs'), shared);
  let index = await fs.readFile(indexPath, 'utf8');
  for (const [original, replacement] of [
    ['https://deno.land/std@0.224.0/http/server.ts', './server.mjs'],
    ['https://esm.sh/@supabase/supabase-js@2.49.1', './supabase.mjs'],
    ['../_shared/supabaseApiKeys.ts', './supabase-api-keys.mjs'],
    ['../_shared/torneosCoreContract.ts', './contract.mjs'],
  ]) index = index.replace(`"${original}"`, `"${replacement}"`);
  await fs.writeFile(path.join(outDir, 'index.mjs'), transpile(index, 'index.ts'));
  await fs.writeFile(path.join(outDir, 'server.mjs'), 'export function serve(handler) { globalThis.__contractHandler = handler; }');
  await fs.writeFile(path.join(outDir, 'supabase.mjs'), 'export function createClient() { return globalThis.__contractService; }');
  await fs.writeFile(path.join(outDir, 'supabase-api-keys.mjs'), `
    export function createSupabaseCredentialFetch() { return fetch; }
    export function getSupabaseSecretCredential() { return { key: 'sb_secret_test', kind: 'secret', source: 'named' }; }
  `);
  globalThis.Deno = { env: { get: (name) => environment[name] } };
  const contract = await import(pathToFileURL(path.join(outDir, 'contract.mjs')).href);
  return {
    contract,
    outDir,
    async loadIndex(service) {
      globalThis.__contractService = service;
      globalThis.__contractHandler = undefined;
      // Monotonic cache-buster: two loadIndex calls in the same millisecond would otherwise
      // reuse the cached module (a faster runtime exposes this) and skip its handler side effect.
      await import(pathToFileURL(path.join(outDir, 'index.mjs')).href + `?t=${Date.now()}-${loadCounter++}`);
      return globalThis.__contractHandler;
    },
    async cleanup() {
      delete globalThis.Deno; delete globalThis.__contractHandler; delete globalThis.__contractService;
      await fs.rm(outDir, { recursive: true, force: true });
    },
  };
}

const SECRET_HEX = randomBytes(32).toString('hex');
const SECRET = Buffer.from(SECRET_HEX, 'hex');
const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM = '33333333-3333-4333-8333-333333333333';
const NOW = 1_800_000_000;

function sign(routePath, body, { time = String(NOW), nonce = randomBytes(16).toString('hex'), secret = SECRET } = {}) {
  const signature = createHmac('sha256', secret).update(`${routePath}\n${time}\n${nonce}\n`).update(body).digest('hex');
  return { 'x-time': time, 'x-nonce': nonce, 'x-signature': signature };
}

function request(routePath, payload, { mount = '/torneos-core-contract', method = 'POST', headers, rawBody } = {}) {
  const body = rawBody ?? JSON.stringify(payload);
  return new Request(`http://internal-host${mount}${routePath}`, {
    method,
    headers: { 'content-type': 'application/json', ...(headers ?? sign(routePath, body)) },
    body: method === 'POST' ? body : undefined,
  });
}

async function readJson(response) {
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test('pure contract module', async (t) => {
  const { contract, cleanup } = await loadModules();
  const { contractPath, parseServiceSecret, verifyServiceAuth, validateRequest, deriveCursorKey, encodeCursor, decodeCursor, ContractError } = contract;
  try {
    await t.test('route resolution tolerates the gateway prefix and rejects unknown paths', () => {
      assert.equal(contractPath('/torneos-core-contract/v1/verified-email', 'torneos-core-contract'), '/v1/verified-email');
      assert.equal(contractPath('/functions/v1/torneos-core-contract/v1/directory', 'torneos-core-contract'), '/v1/directory');
      assert.equal(contractPath('/v1/team-snapshot', 'torneos-core-contract'), '/v1/team-snapshot');
      assert.equal(contractPath('/torneos-core-contract', 'torneos-core-contract'), null);
      assert.equal(contractPath('/torneos-core-contract/v1/session', 'torneos-core-contract'), '/v1/session');
      assert.equal(contractPath('/torneos-core-contract/v1/my-teams', 'torneos-core-contract'), '/v1/my-teams');
      assert.equal(contractPath('/torneos-core-contract/v1/other', 'torneos-core-contract'), null);
      assert.equal(contractPath('/other-function/v1/directory', 'torneos-core-contract'), null);
    });
    await t.test('service secret must be at least 32 hex bytes', () => {
      assert.equal(parseServiceSecret(undefined), null);
      assert.equal(parseServiceSecret('abc'), null);
      assert.equal(parseServiceSecret('zz'.repeat(32)), null);
      assert.equal(parseServiceSecret(SECRET_HEX).length, 32);
      assert.equal(parseServiceSecret(` ${SECRET_HEX} `).length, 32);
    });
    await t.test('service authentication: window, format and signature', async () => {
      const body = new TextEncoder().encode('{"a":1}');
      const ok = sign('/v1/directory', body);
      const headers = (h) => ({ time: h['x-time'], nonce: h['x-nonce'], signature: h['x-signature'] });
      assert.deepEqual(await verifyServiceAuth(SECRET, '/v1/directory', headers(ok), body, NOW), { nonce: ok['x-nonce'] });
      await assert.rejects(verifyServiceAuth(SECRET, '/v1/directory', headers(ok), body, NOW + 31), { code: 'SERVICE_AUTH_REQUIRED' });
      await assert.rejects(verifyServiceAuth(SECRET, '/v1/verified-email', headers(ok), body, NOW), { code: 'SERVICE_AUTH_REQUIRED' });
      await assert.rejects(verifyServiceAuth(SECRET, '/v1/directory', headers(ok), new TextEncoder().encode('{"a":2}'), NOW), { code: 'SERVICE_AUTH_REQUIRED' });
      await assert.rejects(verifyServiceAuth(SECRET, '/v1/directory', headers(sign('/v1/directory', body, { secret: randomBytes(32) })), body, NOW), { code: 'SERVICE_AUTH_REQUIRED' });
      await assert.rejects(verifyServiceAuth(SECRET, '/v1/directory', { ...headers(ok), nonce: 'short' }, body, NOW), { code: 'SERVICE_AUTH_REQUIRED' });
      await assert.rejects(verifyServiceAuth(SECRET, '/v1/directory', { ...headers(ok), signature: null }, body, NOW), { code: 'SERVICE_AUTH_REQUIRED' });
      // Flip the last hex digit to a guaranteed-different one (a fixed '0' left the signature intact 1/16 of the runs).
      const flipped = ok['x-signature'].slice(0, 63) + ((parseInt(ok['x-signature'].slice(63), 16) + 1) % 16).toString(16);
      await assert.rejects(verifyServiceAuth(SECRET, '/v1/directory', { ...headers(ok), signature: flipped }, body, NOW), { code: 'SERVICE_AUTH_REQUIRED' });
    });
    await t.test('closed request schemas', () => {
      const ve = validateRequest('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' });
      assert.deepEqual(ve.sqlRequest, { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' });
      for (const bad of [
        { core_user_id: USER, session_id: SESSION },
        { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c', extra: 1 },
        { core_user_id: USER, session_id: SESSION.toUpperCase(), expected_email: 'a@b.c' },
        { core_user_id: USER, session_id: SESSION, expected_email: 'a b@c' },
        { core_user_id: USER, session_id: SESSION, expected_email: 'ab' },
        { core_user_id: USER, session_id: SESSION, expected_email: `${'a'.repeat(251)}@b.c` },
        [], null, 'x',
      ]) assert.throws(() => validateRequest('/v1/verified-email', bad), { code: 'INVALID_REQUEST' });
      const dir = validateRequest('/v1/directory', { core_user_id: USER, session_id: SESSION, kind: 'players', query: 'an', limit: 8, cursor: null });
      assert.deepEqual(dir.sqlRequest, { core_user_id: USER, session_id: SESSION, kind: 'players', query: 'an', limit: 8, after: null });
      for (const bad of [
        { kind: 'users', query: 'an', limit: 8, cursor: null },
        { kind: 'players', query: 'a', limit: 8, cursor: null },
        { kind: 'players', query: 'a'.repeat(101), limit: 8, cursor: null },
        { kind: 'players', query: 'an', limit: 0, cursor: null },
        { kind: 'players', query: 'an', limit: 13, cursor: null },
        { kind: 'players', query: 'an', limit: 8.5, cursor: null },
        { kind: 'players', query: 'an', limit: '8', cursor: null },
        { kind: 'players', query: 'an', limit: 8, cursor: '' },
        { kind: 'players', query: 'an', limit: 8, cursor: 'x'.repeat(2049) },
        { kind: 'players', query: 'an', limit: 8, cursor: null, after: 'x' },
        { kind: 'players', query: 'an', limit: 8 },
      ]) assert.throws(() => validateRequest('/v1/directory', { core_user_id: USER, session_id: SESSION, ...bad }), { code: 'INVALID_REQUEST' });
      assert.deepEqual(validateRequest('/v1/team-snapshot', { core_user_id: USER, session_id: SESSION, core_team_id: TEAM }).sqlRequest,
        { core_user_id: USER, session_id: SESSION, core_team_id: TEAM });
      assert.throws(() => validateRequest('/v1/team-snapshot', { core_user_id: USER, session_id: SESSION, core_team_id: 'nope' }), { code: 'INVALID_REQUEST' });
      // Phase 3B v1.1: session validation carries only the two binding ids, nothing else.
      const session = validateRequest('/v1/session', { core_user_id: USER, session_id: SESSION });
      assert.equal(session.operation, 'session');
      assert.deepEqual(session.sqlRequest, { core_user_id: USER, session_id: SESSION });
      assert.equal(session.directory, undefined);
      for (const bad of [
        { core_user_id: USER },
        { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' },
        { core_user_id: USER, session_id: SESSION.toUpperCase() },
        { core_user_id: USER, session_id: 'nope' },
        {}, [], null,
      ]) assert.throws(() => validateRequest('/v1/session', bad), { code: 'INVALID_REQUEST' });
      // v1.2 (CONNECTED-V1): my-teams carries the two binding ids and a bounded limit, nothing else.
      const myTeams = validateRequest('/v1/my-teams', { core_user_id: USER, session_id: SESSION, limit: 30 });
      assert.equal(myTeams.operation, 'my_teams');
      assert.deepEqual(myTeams.sqlRequest, { core_user_id: USER, session_id: SESSION, limit: 30 });
      assert.equal(myTeams.directory, undefined);
      for (const bad of [
        { core_user_id: USER, session_id: SESSION },
        { core_user_id: USER, session_id: SESSION, limit: 0 },
        { core_user_id: USER, session_id: SESSION, limit: 31 },
        { core_user_id: USER, session_id: SESSION, limit: 2.5 },
        { core_user_id: USER, session_id: SESSION, limit: '30' },
        { core_user_id: USER, session_id: SESSION, limit: 30, query: 'x' },
        { core_user_id: USER, session_id: 'nope', limit: 30 },
      ]) assert.throws(() => validateRequest('/v1/my-teams', bad), { code: 'INVALID_REQUEST' });
      assert.throws(() => validateRequest('/v1/nope', {}), { code: 'NOT_FOUND' });
      assert.ok(new ContractError(400, 'X') instanceof Error);
    });
    await t.test('cursors are bound, signed and short-lived', async () => {
      const key = await deriveCursorKey(SECRET);
      const req = validateRequest('/v1/directory', { core_user_id: USER, session_id: SESSION, kind: 'players', query: 'Ána', limit: 8, cursor: null });
      const cursor = await encodeCursor(key, req, TEAM, NOW);
      assert.ok(cursor.length < 2048);
      assert.equal(await decodeCursor(key, req, cursor, NOW + 59), TEAM);
      const same = validateRequest('/v1/directory', { core_user_id: USER, session_id: SESSION, kind: 'players', query: 'ana', limit: 8, cursor: null });
      assert.equal(await decodeCursor(key, same, cursor, NOW), TEAM, 'folded query binds accent/case-insensitively');
      await assert.rejects(decodeCursor(key, req, cursor, NOW + 60), { code: 'INVALID_CURSOR' });
      for (const change of [{ core_user_id: TEAM }, { session_id: TEAM }, { kind: 'teams' }, { query: 'anb' }, { limit: 7 }]) {
        const other = validateRequest('/v1/directory', { core_user_id: USER, session_id: SESSION, kind: 'players', query: 'ana', limit: 8, cursor: null, ...change });
        await assert.rejects(decodeCursor(key, other, cursor, NOW), { code: 'INVALID_CURSOR' });
      }
      const [payload, sig] = cursor.split('.');
      await assert.rejects(decodeCursor(key, req, `${payload}.${sig.slice(0, 63)}0`, NOW), { code: 'INVALID_CURSOR' });
      await assert.rejects(decodeCursor(key, req, `${payload}x.${sig}`, NOW), { code: 'INVALID_CURSOR' });
      await assert.rejects(decodeCursor(await deriveCursorKey(randomBytes(32)), req, cursor, NOW), { code: 'INVALID_CURSOR' });
      await assert.rejects(decodeCursor(key, req, 'garbage', NOW), { code: 'INVALID_CURSOR' });
      assert.notDeepEqual(Buffer.from(key), SECRET, 'cursor key is derived, never the service secret');
    });
  } finally {
    await cleanup();
  }
});

test('request pipeline with a fake SQL executor', async (t) => {
  const { contract, cleanup } = await loadModules();
  const { handleContractRequest } = contract;
  const calls = [];
  const verdicts = [];
  const execute = async (operation, nonce, sqlRequest) => {
    calls.push({ operation, nonce, sqlRequest });
    const next = verdicts.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const handle = (req, overrides = {}) => handleContractRequest(req, { functionName: 'torneos-core-contract', secret: SECRET, execute, now: () => NOW, ...overrides });
  try {
    await t.test('verified email passes through the SQL verdict and binds the nonce', async () => {
      verdicts.push({ status: 200, body: { verified: true, matches: true, checked_at: NOW } });
      const req = request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' });
      const nonce = req.headers.get('x-nonce');
      const r = await readJson(await handle(req));
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { verified: true, matches: true, checked_at: NOW });
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(calls.at(-1).operation, 'verified_email');
      assert.equal(calls.at(-1).nonce, nonce);
    });
    await t.test('session: verdict passes through, nonce bound, no cursor machinery', async () => {
      verdicts.push({ status: 200, body: { active: true, checked_at: NOW } });
      const req = request('/v1/session', { core_user_id: USER, session_id: SESSION });
      const nonce = req.headers.get('x-nonce');
      const r = await readJson(await handle(req));
      assert.deepEqual([r.status, r.body], [200, { active: true, checked_at: NOW }]);
      assert.deepEqual(calls.at(-1), { operation: 'session', nonce, sqlRequest: { core_user_id: USER, session_id: SESSION } });
      verdicts.push({ status: 403, body: { error: 'FORBIDDEN' } });
      const denied = await readJson(await handle(request('/v1/session', { core_user_id: USER, session_id: SESSION })));
      assert.deepEqual([denied.status, denied.body], [403, { error: 'FORBIDDEN' }]);
    });
    await t.test('denials from SQL keep their status and body', async () => {
      for (const [status, error] of [[403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [429, 'RATE_LIMITED'], [401, 'REPLAY'], [409, 'INVALID_REQUEST']]) {
        verdicts.push({ status, body: { error } });
        const r = await readJson(await handle(request('/v1/team-snapshot', { core_user_id: USER, session_id: SESSION, core_team_id: TEAM })));
        assert.deepEqual([r.status, r.body], [status, { error }]);
      }
    });
    await t.test('directory: has_more becomes a signed cursor and the next page carries `after`', async () => {
      const items = [{ core_user_id: USER, display_name: 'Ana', avatar_url: null, positions: [] }];
      verdicts.push({ status: 200, body: { items, has_more: true } });
      const first = await readJson(await handle(request('/v1/directory', { core_user_id: USER, session_id: SESSION, kind: 'players', query: 'an', limit: 1, cursor: null })));
      assert.equal(first.status, 200);
      assert.deepEqual(first.body.items, items);
      assert.equal(typeof first.body.next_cursor, 'string');
      assert.equal(calls.at(-1).sqlRequest.after, null);
      assert.ok(!('cursor' in calls.at(-1).sqlRequest));
      verdicts.push({ status: 200, body: { items: [], has_more: false } });
      const second = await readJson(await handle(request('/v1/directory', { core_user_id: USER, session_id: SESSION, kind: 'players', query: 'an', limit: 1, cursor: first.body.next_cursor })));
      assert.deepEqual(second.body, { items: [], next_cursor: null });
      assert.equal(calls.at(-1).sqlRequest.after, USER);
      const foreign = await readJson(await handle(request('/v1/directory', { core_user_id: USER, session_id: SESSION, kind: 'teams', query: 'an', limit: 1, cursor: first.body.next_cursor })));
      assert.deepEqual([foreign.status, foreign.body], [400, { error: 'INVALID_CURSOR' }]);
      const expired = await readJson(await handle(request('/v1/directory', { core_user_id: USER, session_id: SESSION, kind: 'players', query: 'an', limit: 1, cursor: first.body.next_cursor }), { now: () => NOW + 61 }));
      assert.equal(expired.status, 401, 'time window is checked before the cursor');
    });
    await t.test('transport and schema rejections never reach SQL', async () => {
      const before = calls.length;
      const cases = [
        [request('/v1/verified-email', {}, { method: 'GET' }), 404, 'NOT_FOUND'],
        [request('/v1/other', { core_user_id: USER }), 404, 'NOT_FOUND'],
        [request('/v1/verified-email', null, { rawBody: '{"core_user_id":"' + USER + '"' }), 400, 'INVALID_REQUEST'],
        [request('/v1/verified-email', null, { rawBody: JSON.stringify({ core_user_id: USER, session_id: SESSION }) }), 400, 'INVALID_REQUEST'],
        [request('/v1/verified-email', null, { rawBody: 'x'.repeat(16385) }), 413, 'INVALID_REQUEST'],
        [request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' }, { headers: { 'x-time': String(NOW - 31), 'x-nonce': 'a'.repeat(32), 'x-signature': 'b'.repeat(64) } }), 401, 'SERVICE_AUTH_REQUIRED'],
        [request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' }, { headers: {} }), 401, 'SERVICE_AUTH_REQUIRED'],
      ];
      for (const [req, status, error] of cases) {
        const r = await readJson(await handle(req));
        assert.deepEqual([r.status, r.body], [status, { error }]);
      }
      const r = await readJson(await handle(request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' }), { secret: null }));
      assert.deepEqual([r.status, r.body], [503, { error: 'CORE_UNAVAILABLE' }]);
      assert.equal(calls.length, before);
    });
    await t.test('SQL failure is a sanitized 503 and logs nothing about the request', async () => {
      const logged = [];
      const original = console.error;
      console.error = (...args) => logged.push(args.join(' '));
      try {
        verdicts.push(new Error('connection refused: body was {"expected_email":"secret@x"}'));
        const r = await readJson(await handle(request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' })));
        assert.deepEqual([r.status, r.body], [503, { error: 'CORE_UNAVAILABLE' }]);
        verdicts.push({ nonsense: true });
        const r2 = await readJson(await handle(request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' })));
        assert.deepEqual([r2.status, r2.body], [503, { error: 'CORE_UNAVAILABLE' }]);
      } finally {
        console.error = original;
      }
      assert.ok(logged.every((line) => !line.includes('secret@x') && !line.includes(USER) && !line.includes('a@b.c')));
    });
  } finally {
    await cleanup();
  }
});

test('Deno wiring: env secret gates the handler and the service RPC is called exactly as the SQL expects', async (t) => {
  await t.test('configured secret', async () => {
    const mod = await loadModules({ SUPABASE_URL: 'http://core-api:8000', TORNEOS_CONTRACT_SERVICE_SECRET: SECRET_HEX, SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test"}' });
    try {
      const rpcCalls = [];
      const handler = await mod.loadIndex({ rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: { status: 200, body: { verified: false, matches: false, checked_at: NOW } }, error: null }; } });
      assert.equal(typeof handler, 'function');
      const r = await readJson(await handler(request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' }, { headers: sign('/v1/verified-email', JSON.stringify({ core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' }), { time: String(Math.floor(Date.now() / 1000)) }) })));
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { verified: false, matches: false, checked_at: NOW });
      assert.equal(rpcCalls.length, 1);
      assert.equal(rpcCalls[0].name, 'torneos_contract_execute');
      assert.deepEqual(Object.keys(rpcCalls[0].args).sort(), ['p_nonce', 'p_operation', 'p_request']);
      assert.equal(rpcCalls[0].args.p_operation, 'verified_email');
      assert.deepEqual(rpcCalls[0].args.p_request, { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' });
      const rpcError = await mod.loadIndex({ rpc: async () => ({ data: null, error: { message: 'boom' } }) });
      const failed = await readJson(await rpcError(request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' }, { headers: sign('/v1/verified-email', JSON.stringify({ core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' }), { time: String(Math.floor(Date.now() / 1000)) }) })));
      assert.deepEqual([failed.status, failed.body], [503, { error: 'CORE_UNAVAILABLE' }]);
    } finally {
      await mod.cleanup();
    }
  });
  await t.test('missing secret fails closed without touching the database', async () => {
    const mod = await loadModules({ SUPABASE_URL: 'http://core-api:8000', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test"}' });
    try {
      let rpcCalls = 0;
      const handler = await mod.loadIndex({ rpc: async () => { rpcCalls += 1; return { data: null, error: null }; } });
      const r = await readJson(await handler(request('/v1/verified-email', { core_user_id: USER, session_id: SESSION, expected_email: 'a@b.c' })));
      assert.deepEqual([r.status, r.body], [503, { error: 'CORE_UNAVAILABLE' }]);
      assert.equal(rpcCalls, 0);
    } finally {
      await mod.cleanup();
    }
  });
});
