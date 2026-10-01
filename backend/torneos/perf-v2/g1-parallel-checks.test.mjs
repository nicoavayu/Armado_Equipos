// PERF-V2 G1 — the gateway's Core/identity checks run concurrently; every verdict must stay the one the serial code gave.
//
// BEFORE is the pinned current main gateway source (46479c64), extracted
// from git; AFTER is the working tree. Both REAL handle()s run in-process with the Production topology env (throwaway
// material), Core Production emulated by a fetch fake and the identity database by a postgres stub, each with switchable
// faults and an artificial latency. For every combination of faults both gateways must answer the same status and body,
// ask the Core authority once per request, and reach PostgREST only when every check passed.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { mintBridgeToken } from '../infra/torneos-gateway-auth/bridge-probe.mjs';
import { extractTree } from '../infra/torneos-competition-v1/competition-bundle.mjs';
import { fixtureEnv, BASE } from '../infra/torneos-competition-v1/test-support.mjs';

const BEFORE_HEAD = '46479c6470a47a43dd702f3ccf098fb8ee73b314'; // current main serial baseline
const WEB_ORIGIN = G.WEB_ORIGIN;
const D = 60; // artificial latency of every dependency round trip (ms)

// ── the emulated world, shared by both trees ──
const world = { health: 'ok', contract: 'active', identity: 'exists', delay: D, log: [], t0: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (name, phase) => world.log.push({ name, phase, t: performance.now() - world.t0 });
const hang = (signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))));

globalThis.__g1World = world;
const POSTGRES_STUB = `const w = () => globalThis.__g1World;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (name, phase) => w().log.push({ name, phase, t: performance.now() - w().t0 });
export default function postgres() {
  return { end: async () => {}, begin: async (fn) => {
    mark('identity', 'start');
    try {
      await sleep(w().delay);
      if (w().identity === 'unavailable') throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      if (w().identity === 'error') throw new Error('permission denied');
      return await fn({ unsafe: async (q, params) => {
        if (/^INSERT INTO public\\.torneos_identity/.test(q)) return [{ id: '3f1d3a4e-8f7b-4c5a-9e2d-1b6c7d8e9f00', core_user_id: params[0] }];
        if (/^SELECT id FROM public\\.torneos_identity/.test(q)) return w().identity === 'missing' ? [] : [{ id: params[0] }];
        return [];
      } });
    } finally { mark('identity', 'end'); }
  } };
}`;

async function fakeFetch(url, init = {}) {
  const u = String(url);
  if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/health`) {
    mark('health', 'start');
    try {
      if (world.health === 'hang') return await hang(init.signal);
      await sleep(world.delay);
      if (world.health === 'throw') throw new TypeError('fetch failed');
      return new Response('{}', { status: world.health === 'down' ? 503 : 200 });
    } finally { mark('health', 'end'); }
  }
  if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/user`) {
    mark('user', 'start');
    await sleep(world.delay);
    mark('user', 'end');
    const p = JSON.parse(Buffer.from(String(init.headers.authorization).slice(7).split('.')[1], 'base64url').toString('utf8'));
    return new Response(JSON.stringify({ id: p.sub, is_anonymous: false }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u === `${G.GATEWAY_TOPOLOGY.coreContractUrl}/v1/session`) {
    mark('contract', 'start');
    try {
      if (world.contract === 'hang') return await hang(init.signal);
      await sleep(world.delay);
      if (world.contract === 'throw') throw new TypeError('fetch failed');
      if (world.contract === 'deny') return new Response('{"error":"FORBIDDEN"}', { status: 403 });
      if (world.contract === '5xx') return new Response('{"error":"x"}', { status: 503 });
      if (world.contract === 'garbage') return new Response('{"active":"yes"}', { status: 200 });
      const active = world.contract === 'active';
      return new Response(JSON.stringify({ active, checked_at: Math.floor(Date.now() / 1000) }), { status: 200, headers: { 'content-type': 'application/json' } });
    } finally { mark('contract', 'end'); }
  }
  if (u.startsWith(`${G.GATEWAY_TOPOLOGY.torneosRestUrl}/`)) {
    mark('rest', 'start');
    await sleep(world.delay);
    mark('rest', 'end');
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 599 });
}

let fx; let gw; let tmp; let realFetch;
test.before(async () => {
  fx = fixtureEnv();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-g1-before-'));
  const trees = { before: await loadGatewayTree({ functionsDir: extractTree(BEFORE_HEAD, tmp), postgresModule: POSTGRES_STUB }),
    after: await loadGatewayTree({ postgresModule: POSTGRES_STUB }) };
  realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  globalThis.Deno = { env: { toObject: () => ({ ...fx.env }) } };
  gw = { trees, before: await trees.before.import('torneos-gateway/index.ts'), after: await trees.after.import('torneos-gateway/index.ts') };
});
test.after(async () => {
  globalThis.fetch = realFetch; delete globalThis.Deno; delete globalThis.__g1World;
  await gw.trees.before.cleanup(); await gw.trees.after.cleanup(); fs.rmSync(tmp, { recursive: true, force: true });
});

const bridge = (overrides = {}) => mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid, overrides });
function coreBearer() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: crypto.randomUUID(), aud: 'authenticated', role: 'authenticated', iss: G.GATEWAY_TOPOLOGY.coreJwtIssuer, session_id: crypto.randomUUID(), iat: now, exp: now + 3600 })}.sig`;
}

async function call(which, { path: p = '/torneos/rest/v1/rpc/get_my_tournament_memberships', method = 'POST', token, body = '{}' } = {}) {
  world.log = []; world.t0 = performance.now();
  const url = `${BASE}${p}`;
  const u = new URL(url);
  const headers = { origin: WEB_ORIGIN, host: u.host, 'x-forwarded-host': u.host, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await gw[which].handle(new Request(url, { method, headers, body }));
  const ms = performance.now() - world.t0;
  const raw = await res.text();
  let json = null; try { json = JSON.parse(raw); } catch { json = raw; }
  const count = (n) => world.log.filter((e) => e.name === n && e.phase === 'start').length;
  return { status: res.status, json, ms, log: world.log.slice(), calls: { health: count('health'), contract: count('contract'), identity: count('identity'), rest: count('rest') },
    cache: res.headers.get('cache-control'), acao: res.headers.get('access-control-allow-origin') };
}

const HEALTH = ['ok', 'down', 'throw'];
// deny = Core's 403 for a revoked/ended session; inactive = a 200 {active:false} (schema violation).
const CONTRACT = ['active', 'inactive', 'deny', '5xx', 'throw', 'garbage'];
const IDENTITY = ['exists', 'missing', 'unavailable', 'error'];

test('G1 matrix: every health × Core-session × identity outcome answers exactly as the serial Production gateway (72 cases)', async () => {
  world.delay = 5;
  const seen = new Map();
  for (const health of HEALTH) for (const contract of CONTRACT) for (const identity of IDENTITY) {
    Object.assign(world, { health, contract, identity });
    const token = bridge();
    const b = await call('before', { token }); const a = await call('after', { token });
    const label = `${health}/${contract}/${identity}`;
    assert.equal(a.status, b.status, label); assert.deepEqual(a.json, b.json, label);
    assert.equal(a.cache, 'no-store', label); assert.equal(a.acao, WEB_ORIGIN, label);
    // Core authority asked on every request; the AFTER gateway asks each authority exactly once.
    assert.equal(a.calls.health, 1, label); assert.equal(a.calls.contract, 1, label); assert.equal(a.calls.identity, 1, label);
    // PostgREST is reached only when every check passed, in both.
    const pass = health === 'ok' && contract === 'active' && identity === 'exists';
    assert.equal(b.calls.rest, pass ? 1 : 0, label); assert.equal(a.calls.rest, b.calls.rest, label);
    seen.set(`${b.status} ${JSON.stringify(b.json)}`, (seen.get(`${b.status} ${JSON.stringify(b.json)}`) ?? 0) + 1);
  }
  // The matrix covers every verdict class the gateway has: pass, 401, 503 and 503 CORE_UNAVAILABLE.
  assert.deepEqual([...seen.keys()].sort(), ['200 {"ok":true}', '401 {"error":"access denied"}', '503 {"error":"CORE_UNAVAILABLE"}', '503 {"error":"access denied"}']);
});

test('G1 precedence: an outage outranks a denial, a denial outranks a missing identity — same order as before', async () => {
  world.delay = 5;
  const cases = [
    [{ health: 'down', contract: 'deny', identity: 'missing' }, 503, 'access denied'],
    [{ health: 'throw', contract: '5xx', identity: 'unavailable' }, 503, 'access denied'],
    [{ health: 'ok', contract: '5xx', identity: 'missing' }, 503, 'CORE_UNAVAILABLE'],
    // Core denies an ended session with 403; a 200 that is not {active:true} breaks the contract schema → CORE_UNAVAILABLE.
    [{ health: 'ok', contract: 'deny', identity: 'unavailable' }, 401, 'access denied'],
    [{ health: 'ok', contract: 'inactive', identity: 'exists' }, 503, 'CORE_UNAVAILABLE'],
    [{ health: 'ok', contract: 'active', identity: 'unavailable' }, 503, 'access denied'],
    [{ health: 'ok', contract: 'active', identity: 'missing' }, 401, 'access denied'],
  ];
  for (const [w, status, error] of cases) {
    Object.assign(world, w);
    for (const which of ['before', 'after']) {
      const r = await call(which, { token: bridge() });
      assert.equal(r.status, status, `${which} ${JSON.stringify(w)}`); assert.equal(r.json.error, error, `${which} ${JSON.stringify(w)}`);
    }
  }
});

test('G1 bearer: an invalid, foreign, expired or missing bridge bearer is refused before ANY dependency, as before', async () => {
  Object.assign(world, { health: 'ok', contract: 'active', identity: 'exists', delay: 5 });
  const good = bridge();
  const [h, p, s] = good.split('.');
  const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: crypto.randomUUID() })).toString('base64url')}.${s}`;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const foreign = mintBridgeToken({ pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'), kid: fx.k1.kid });
  const expired = bridge({ iat: 1000, nbf: 1000, exp: 1120 });
  for (const token of [tampered, foreign, expired, 'not-a-jwt', undefined]) {
    const b = await call('before', { token }); const a = await call('after', { token });
    assert.equal(a.status, 401); assert.deepEqual(a.json, b.json);
    assert.deepEqual(a.calls, { health: 0, contract: 0, identity: 0, rest: 0 }); assert.deepEqual(b.calls, a.calls);
  }
  // An RPC outside the allowlist: 403 after the bearer, before any dependency, in both.
  for (const which of ['before', 'after']) {
    const r = await call(which, { token: good, path: '/torneos/rest/v1/rpc/not_an_allowed_rpc' });
    assert.equal(r.status, 403); assert.deepEqual(r.calls, { health: 0, contract: 0, identity: 0, rest: 0 });
  }
});

test('G1 identity: a bearer whose sub is not the identity bound to its core_user_id is refused (401), never proxied', async () => {
  Object.assign(world, { health: 'ok', contract: 'active', identity: 'missing', delay: 5 });
  for (const which of ['before', 'after']) {
    const r = await call(which, { token: bridge() });
    assert.equal(r.status, 401); assert.equal(r.calls.rest, 0);
  }
});

test('G1 timeouts: a hung GoTrue health or Core contract still ends at the SAME 2 s timeout with the same answer', async () => {
  world.delay = 5; world.identity = 'exists';
  for (const [w, status, error] of [[{ health: 'hang', contract: 'active' }, 503, 'access denied'], [{ health: 'ok', contract: 'hang' }, 503, 'CORE_UNAVAILABLE']]) {
    Object.assign(world, w);
    const [b, a] = await Promise.all([call('before', { token: bridge() }), call('after', { token: bridge() })]);
    for (const [which, r] of [['before', b], ['after', a]]) {
      assert.equal(r.status, status, `${which} ${JSON.stringify(w)}`); assert.equal(r.json.error, error, `${which} ${JSON.stringify(w)}`);
      assert.ok(r.ms >= 1990 && r.ms < 2600, `${which} ${JSON.stringify(w)} ended at ${Math.round(r.ms)} ms`);
      assert.equal(r.calls.rest, 0);
    }
  }
});

test('G1 latency: the three checks overlap (all started before the first ends); a valid RPC costs ~2 hops instead of ~4', async () => {
  Object.assign(world, { health: 'ok', contract: 'active', identity: 'exists', delay: D });
  const runs = { before: [], after: [] };
  let overlap;
  for (let i = 0; i < 5; i += 1) {
    for (const which of ['before', 'after']) {
      const r = await call(which, { token: bridge() });
      assert.equal(r.status, 200); runs[which].push(r.ms);
      if (which === 'after') overlap = r.log;
    }
  }
  const med = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const firstEnd = Math.min(...overlap.filter((e) => e.phase === 'end' && ['health', 'contract', 'identity'].includes(e.name)).map((e) => e.t));
  for (const n of ['health', 'contract', 'identity']) assert.ok(overlap.find((e) => e.name === n && e.phase === 'start').t < firstEnd, `${n} started before the first check ended`);
  // PostgREST starts only after every check ended.
  const lastCheckEnd = Math.max(...overlap.filter((e) => e.phase === 'end' && e.name !== 'rest').map((e) => e.t));
  assert.ok(overlap.find((e) => e.name === 'rest' && e.phase === 'start').t >= lastCheckEnd);
  assert.ok(med(runs.before) >= 4 * D * 0.95, `before ${med(runs.before)}`);
  assert.ok(med(runs.after) < 2.6 * D, `after ${med(runs.after)}`);
});

test('G1 exchange: /exchange keeps /user → (health ∥ session) → identity upsert, same verdicts; the upsert never runs on a failed check', async () => {
  world.delay = 5; world.identity = 'exists';
  for (const [health, contract] of [['ok', 'active'], ['down', 'active'], ['ok', 'inactive'], ['ok', '5xx'], ['throw', 'deny']]) {
    Object.assign(world, { health, contract });
    const token = coreBearer();
    const b = await call('before', { path: '/exchange', token }); const a = await call('after', { path: '/exchange', token });
    const shape = (r) => (r.status === 200 ? { status: 200, keys: Object.keys(r.json).sort(), type: r.json.token_type, ttl: r.json.expires_in } : { status: r.status, json: r.json });
    assert.deepEqual(shape(a), shape(b), `${health}/${contract}`);
    assert.equal(a.calls.identity, health === 'ok' && contract === 'active' ? 1 : 0, `${health}/${contract}`);
    // /user comes first, alone: nothing else starts before GoTrue verified the bearer.
    const userEnd = a.log.find((e) => e.name === 'user' && e.phase === 'end').t;
    assert.ok(a.log.filter((e) => e.phase === 'start' && e.name !== 'user').every((e) => e.t >= userEnd));
  }
});
