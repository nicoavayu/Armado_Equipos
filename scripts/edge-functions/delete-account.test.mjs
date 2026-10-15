// Unit harness for supabase/functions/delete-account + _shared/torneosAccountErasure.ts (Torneos 0021).
// Transpiles the real TypeScript (same approach as torneos-core-contract.test.mjs) and drives the real handler with a
// fake Supabase (user + admin clients) and a fake Torneos gateway that verifies the signature exactly as the gateway does.
// Pins the designed behaviour: Torneos FIRST and FAIL-CLOSED (nothing deleted in Core unless Torneos confirms), the Core
// user id only from the verified session, a retry after any failure completes, and a post-deletion sweep.
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const sharedPath = path.join(process.cwd(), 'supabase', 'functions', '_shared', 'torneosAccountErasure.ts');
const indexPath = path.join(process.cwd(), 'supabase', 'functions', 'delete-account', 'index.ts');
const transpile = (source, fileName) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true }, fileName }).outputText;

const SECRET = randomBytes(32).toString('hex');
const GATEWAY = 'https://torneos-gateway.example.invalid/torneos-gateway';
const USER = randomUUID();
let outDir; let erasure;
const world = { calls: [], gateway: [], env: {} };

/** The gateway's verification, re-implemented independently in Node crypto (not the module under test). */
function gatewayVerifies(headers, body) {
  const key = createHmac('sha256', Buffer.from(SECRET, 'hex')).update('torneos-core-contract:account-erasure:v1').digest();
  const expected = createHmac('sha256', key).update(`/core/v1/account-erasure\n${headers['x-time']}\n${headers['x-nonce']}\n`).update(body).digest('hex');
  return expected === headers['x-signature'] && Math.abs(Date.now() / 1000 - Number(headers['x-time'])) <= 30 && /^[0-9a-f]{32}$/.test(headers['x-nonce']);
}

function fakeQuery(table) {
  const chain = { op: null, table };
  const done = () => { world.calls.push(`${chain.op}:${table}`); return Promise.resolve(world.failOn?.(table, chain.op) ?? { error: null }); };
  return {
    update() { chain.op = 'update'; return { eq: done }; },
    delete() { chain.op = 'delete'; return { eq: done }; },
  };
}
const adminClient = {
  from: (table) => fakeQuery(table),
  auth: { admin: { deleteUser: async (id) => { world.calls.push(`deleteUser:${id}`); return { error: null }; } } },
};
const userClient = { auth: { getUser: async () => ({ data: { user: world.user === null ? null : { id: world.user ?? USER } }, error: null }) } };

test.before(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-delete-account-'));
  await fs.writeFile(path.join(outDir, 'erasure.mjs'), transpile(await fs.readFile(sharedPath, 'utf8'), 'torneosAccountErasure.ts'));
  let index = await fs.readFile(indexPath, 'utf8');
  for (const [original, replacement] of [
    ['https://deno.land/std@0.224.0/http/server.ts', './server.mjs'],
    ['https://esm.sh/@supabase/supabase-js@2.49.1', './supabase.mjs'],
    ['../_shared/supabaseApiKeys.ts', './supabase-api-keys.mjs'],
    ['../_shared/torneosAccountErasure.ts', './erasure.mjs'],
  ]) index = index.replace(`"${original}"`, `"${replacement}"`);
  await fs.writeFile(path.join(outDir, 'index.mjs'), transpile(index, 'index.ts'));
  await fs.writeFile(path.join(outDir, 'server.mjs'), 'export function serve(handler) { globalThis.__deleteAccountHandler = handler; }');
  await fs.writeFile(path.join(outDir, 'supabase.mjs'), `export function createClient(url, key) {
    return key === 'sb_secret_test' ? globalThis.__deleteAccountAdmin : globalThis.__deleteAccountUser; }`);
  await fs.writeFile(path.join(outDir, 'supabase-api-keys.mjs'), `
    export function createSupabaseCredentialFetch() { return fetch; }
    export function getSupabasePublishableCredential() { return { key: 'sb_publishable_test', kind: 'publishable', source: 'named' }; }
    export function getSupabaseSecretCredential() { return { key: 'sb_secret_test', kind: 'secret', source: 'named' }; }`);
  globalThis.Deno = { env: { get: (name) => world.env[name] } };
  globalThis.__deleteAccountAdmin = adminClient;
  globalThis.__deleteAccountUser = userClient;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u !== `${GATEWAY}/core/v1/account-erasure`) throw new Error(`unexpected destination ${u}`);
    const body = Buffer.from(init.body);
    const entry = { headers: init.headers, body: JSON.parse(body.toString('utf8')), verified: gatewayVerifies(init.headers, body), at: world.calls.length };
    world.gateway.push(entry);
    world.calls.push('torneos');
    const answer = world.answers.length ? world.answers.shift() : { status: 200, body: { ok: true, outcome: 'erased' } };
    if (answer === 'network') throw new TypeError('fetch failed');
    if (!entry.verified) return new Response('{"error":"SERVICE_AUTH_REQUIRED"}', { status: 401 });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  erasure = await import(pathToFileURL(path.join(outDir, 'erasure.mjs')).href);
  await import(pathToFileURL(path.join(outDir, 'index.mjs')).href);
});
test.after(async () => { delete globalThis.Deno; await fs.rm(outDir, { recursive: true, force: true }); });
test.beforeEach(() => {
  Object.assign(world, { calls: [], gateway: [], answers: [], failOn: null, user: undefined,
    env: { SUPABASE_URL: 'https://core.example.invalid', TORNEOS_GATEWAY_URL: GATEWAY, TORNEOS_CONTRACT_SERVICE_SECRET: SECRET } });
});

const call = (body = { confirm: true, core_user_id: randomUUID() }) => globalThis.__deleteAccountHandler(new Request('https://core.example.invalid/functions/v1/delete-account', {
  method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json', origin: 'https://app.arma2.com.ar' }, body: JSON.stringify(body) }));
const coreWrites = () => world.calls.filter((c) => c !== 'torneos');

test('success: Torneos is erased FIRST (signed, the session user id), then Core cleans up, deletes usuarios and the auth user, then sweeps Torneos once more', async () => {
  const r = await call();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, message: 'account_deleted', torneos: 'erased' });
  assert.equal(world.calls[0], 'torneos', 'nothing in Core before Torneos confirms');
  assert.equal(world.gateway.length, 2, 'erasure + post-deletion sweep');
  assert.ok(world.gateway.every((g) => g.verified), 'both requests carry a valid signature');
  assert.equal(world.gateway[0].body.core_user_id, USER, 'the id of the verified session, not the client body');
  assert.match(world.gateway[0].body.request_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(world.gateway[0].body).sort(), ['core_user_id', 'request_id']);
  const order = world.calls;
  assert.ok(order.indexOf('delete:usuarios') > 0 && order.indexOf(`deleteUser:${USER}`) > order.indexOf('delete:usuarios'));
  assert.equal(order.at(-1), 'torneos', 'the sweep runs after the auth user is gone');
});

for (const [name, answers, code] of [
  ['Torneos answers 503 twice', [{ status: 503, body: { error: 'TORNEOS_UNAVAILABLE' } }, { status: 503, body: { error: 'TORNEOS_UNAVAILABLE' } }], 'torneos_erasure_unavailable'],
  ['Torneos is unreachable twice', ['network', 'network'], 'torneos_erasure_unavailable'],
  ['Torneos refuses the signature (401)', [{ status: 401, body: { error: 'SERVICE_AUTH_REQUIRED' } }], 'torneos_erasure_refused'],
  ['Torneos answers 200 with an unknown outcome', [{ status: 200, body: { ok: true, outcome: 'maybe' } }], 'torneos_erasure_unexpected'],
]) {
  test(`fail-closed: ${name} → 503 torneos_erasure_failed, NOTHING deleted in Core`, async () => {
    world.answers = [...answers];
    const r = await call();
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { ok: false, message: 'torneos_erasure_failed', code, retryable: true });
    assert.deepEqual(coreWrites(), []);
  });
}

test('fail-closed: Torneos not configured in Core (no gateway URL or no secret) → 503, nothing deleted, no request leaves', async () => {
  for (const missing of ['TORNEOS_GATEWAY_URL', 'TORNEOS_CONTRACT_SERVICE_SECRET']) {
    world.calls = []; world.gateway = [];
    delete world.env[missing];
    const r = await call();
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, 'torneos_erasure_unconfigured');
    assert.deepEqual([world.calls, world.gateway.length], [[], 0]);
    world.env[missing] = missing === 'TORNEOS_GATEWAY_URL' ? GATEWAY : SECRET;
  }
  world.env.TORNEOS_GATEWAY_URL = 'http://torneos-gateway.example.invalid/torneos-gateway';
  assert.equal((await (await call()).json()).code, 'torneos_erasure_unconfigured', 'plain http is refused outside a loopback lab');
});

test('one transient 503 is retried with a fresh nonce, then succeeds', async () => {
  world.answers = [{ status: 503, body: { error: 'TORNEOS_UNAVAILABLE' } }];
  const r = await call();
  assert.equal(r.status, 200);
  assert.notEqual(world.gateway[0].headers['x-nonce'], world.gateway[1].headers['x-nonce']);
  assert.equal(world.gateway[0].body.request_id, world.gateway[1].body.request_id, 'same request, new signature');
});

test('retry after a failure completes: first call fails closed, the second (Torneos already_erased) deletes the Core account', async () => {
  world.answers = [{ status: 503, body: {} }, { status: 503, body: {} }];
  assert.equal((await call()).status, 503);
  assert.deepEqual(coreWrites(), []);
  world.calls = []; world.gateway = [];
  world.answers = [{ status: 200, body: { ok: true, outcome: 'already_erased' } }];
  const r = await call();
  assert.deepEqual([r.status, (await r.json()).torneos], [200, 'already_erased']);
  assert.ok(world.calls.includes(`deleteUser:${USER}`));
});

test('a Core failure after Torneos confirmed is retryable: profile_delete_failed now, the retry finds Torneos already_erased and finishes', async () => {
  world.failOn = (table, op) => (table === 'usuarios' && op === 'delete' ? { error: { message: 'boom', code: 'XX000' } } : null);
  const first = await call();
  assert.equal(first.status, 500);
  assert.equal((await first.json()).message, 'profile_delete_failed');
  assert.ok(!world.calls.some((c) => c.startsWith('deleteUser')));
  world.failOn = null; world.calls = []; world.gateway = [];
  world.answers = [{ status: 200, body: { ok: true, outcome: 'already_erased' } }];
  const second = await call();
  assert.equal(second.status, 200);
  assert.ok(world.calls.includes(`deleteUser:${USER}`));
});

test('a failed post-deletion sweep never turns a completed deletion into an error', async () => {
  world.answers = [{ status: 200, body: { ok: true, outcome: 'erased' } }, 'network', 'network'];
  const r = await call();
  assert.equal(r.status, 200);
  assert.equal((await r.json()).message, 'account_deleted');
});

test('no session → 401 and Torneos is never called; no confirmation → 400 and Torneos is never called', async () => {
  world.user = null;
  assert.equal((await call()).status, 401);
  world.user = undefined;
  assert.equal((await call({})).status, 400);
  assert.equal(world.gateway.length, 0);
});

test('the shared module: URL and secret parsing fail closed; the signature matches an independent implementation', async () => {
  assert.equal(erasure.parseGatewayUrl('https://x.example/torneos-gateway/'), 'https://x.example/torneos-gateway');
  for (const bad of ['', 'ftp://x', 'https://u:p@x.example', 'https://x.example/?a=1', 'http://x.example']) assert.equal(erasure.parseGatewayUrl(bad), null, bad);
  assert.equal(erasure.parseGatewayUrl('http://127.0.0.1:58421/torneos-gateway'), 'http://127.0.0.1:58421/torneos-gateway');
  assert.equal(erasure.parseSecret('abc'), null);
  assert.equal(erasure.parseSecret(SECRET).length, 32);
  const key = await erasure.deriveErasureKey(erasure.parseSecret(SECRET));
  const body = Buffer.from('{"core_user_id":"x","request_id":"y"}');
  const sig = await erasure.signErasure(key, '1700000000', 'a'.repeat(32), body);
  const expectedKey = createHmac('sha256', Buffer.from(SECRET, 'hex')).update('torneos-core-contract:account-erasure:v1').digest();
  assert.equal(sig, createHmac('sha256', expectedKey).update(`/core/v1/account-erasure\n1700000000\n${'a'.repeat(32)}\n`).update(body).digest('hex'));
  assert.notEqual(Buffer.from(key).toString('hex'), SECRET, 'the raw contract secret never signs this direction');
  const invalid = await erasure.requestTorneosAccountErasure({ env: { get: (n) => world.env[n] }, coreUserId: 'not-a-uuid' });
  assert.deepEqual(invalid, { ok: false, code: 'torneos_erasure_invalid_user', retryable: false });
});
