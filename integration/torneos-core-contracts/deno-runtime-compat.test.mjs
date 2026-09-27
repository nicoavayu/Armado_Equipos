// MP-B1.1 R3 — the two UNMODIFIED entrypoints on standard Deno 2.x (the runtime family Deno Deploy runs), offline.
//
// Nothing is deployed and nothing leaves the machine:
//   • DENO_BIN must name a local Deno 2.x binary whose cache already holds npm:jose@6.2.12 and npm:postgres@3.4.7;
//     every Deno process runs with --cached-only, --no-lock, --no-prompt, HTTP(S)_PROXY pointed at a closed loopback
//     port, and --allow-net limited to one 127.0.0.1 port: no registry, provider, Core, Supabase or database traffic.
//   • The app root is a temporary copy of backend/torneos/supabase/functions (no package.json above it) — the same tree
//     a Deno Deploy app rooted there sees. The repo-root package.json case is proven separately: it breaks npm: resolution.
//   • A loopback shim replaces only the listen address of Deno.serve (Deno Deploy binds for the app) and then imports the
//     real index.ts, which calls Deno.serve(handler) exactly as it will on the platform.
// Results: backend/torneos/mp-b/evidence/mp-b1.1-r3/deno-runtime[-tag].json. Fixture values only (RSA key generated in memory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { UNIT_ENV } from './payments-unit-env.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const FN_DIR = `${repo}backend/torneos/supabase/functions`;
const EVIDENCE = `${repo}backend/torneos/mp-b/evidence/mp-b1.1-r3/`;
const TAG = process.env.MP_B11R3_EVIDENCE_TAG ? `-${process.env.MP_B11R3_EVIDENCE_TAG}` : '';
const DENO = process.env.DENO_BIN ?? '';
const PORT = { payments: 58497, gateway: 58498 };
const results = [];
const evidence = { deno: null, appRoot: 'temporary copy of backend/torneos/supabase/functions', check: {}, payments: [], gateway: [], repoRootPackageJson: null };
const OFFLINE = { NO_COLOR: '1', DENO_NO_UPDATE_CHECK: '1', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9' };
const base = () => ({ PATH: process.env.PATH, HOME: process.env.HOME, ...(process.env.DENO_DIR ? { DENO_DIR: process.env.DENO_DIR } : {}), ...OFFLINE });
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ fixtures
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const BRIDGE = JSON.stringify({ activeKid: 'r3-fixture', trustedKids: ['r3-fixture'], keys: [{ kid: 'r3-fixture',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: publicKey.export({ format: 'jwk' }) }] });
const GW_HOST = 'gw.torneos-test.example.com';
const PAY_HOST = 'pay.torneos-test.example.com';
const GATEWAY_ENV = {
  TORNEOS_GATEWAY_PUBLIC_URL: `https://${GW_HOST}/functions/v1/torneos-gateway`, TORNEOS_ALLOWED_ORIGIN: 'https://web.torneos-test.example.com',
  CORE_AUTH_URL: 'https://core.torneos-test.example.com/auth/v1', CORE_JWT_ISSUER: 'https://core.torneos-test.example.com/auth/v1',
  CORE_CONTRACT_URL: 'https://core.torneos-test.example.com/functions/v1/torneos-core-contract', CORE_ANON_KEY: 'core-anon-public-fixture',
  TORNEOS_CONTRACT_SERVICE_SECRET: sha('r3-contract-fixture'), TORNEOS_REST_URL: 'https://data.torneos-test.example.com/rest/v1', TORNEOS_ANON_KEY: 'torneos-anon-public-fixture',
  TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://torneos_edge_identity_writer:pw-fixture@db.fixture.invalid:5432/postgres',
  TORNEOS_DB_CORE_ADAPTER_URL: 'postgres://torneos_edge_core_adapter:pw-fixture@db.fixture.invalid:5432/postgres', TORNEOS_BRIDGE_KEYS: BRIDGE,
  TORNEOS_COMMERCE_MODE: 'test', TORNEOS_COMMERCE_DEPLOYMENT: 'remote-test', TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST: GW_HOST, TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: PAY_HOST,
  TORNEOS_PAYMENTS_INTERNAL_URL: `https://${PAY_HOST}/functions/v1/torneos-payments`, TORNEOS_PAYMENTS_INTERNAL_SECRET: sha('r3-gateway-internal-hmac-fixture'),
};
const SECRET_VALUES = [UNIT_ENV.MERCADO_PAGO_TEST_ACCESS_TOKEN, UNIT_ENV.MERCADO_PAGO_TEST_WEBHOOK_SECRET, UNIT_ENV.TORNEOS_PAYMENTS_INTERNAL_SECRET, 'pw-fixture',
  GATEWAY_ENV.TORNEOS_CONTRACT_SERVICE_SECRET, GATEWAY_ENV.TORNEOS_PAYMENTS_INTERNAL_SECRET, 'BEGIN PRIVATE KEY'];

// ------------------------------------------------------------------ process helpers
async function appRoot() {
  const root = await mkdtemp(join(tmpdir(), 'mpb11r3-deno-app-'));
  await cp(FN_DIR, join(root, 'functions'), { recursive: true });
  for (const app of ['torneos-payments', 'torneos-gateway']) {
    await writeFile(join(root, 'functions', `__r3_loopback_${app}.ts`), [
      '// MP-B1.1 R3 harness only: pin the listen address to loopback (Deno Deploy binds for the app), then run the real entrypoint.',
      'const serve = Deno.serve',
      `;(Deno as unknown as { serve: unknown }).serve = (handler: Deno.ServeHandler) => serve({ hostname: "127.0.0.1", port: ${PORT[app.slice(8)]}, onListen: () => console.log("R3_LISTENING") }, handler)`,
      `await import("./${app}/index.ts")`, ''].join('\n'));
  }
  let p = root;
  while (p !== dirname(p)) { for (const f of ['package.json', 'deno.json', 'deno.jsonc']) assert.ok(!existsSync(join(p, f)), `${join(p, f)} would change resolution`); p = dirname(p); }
  return root;
}
function start(root, app, env) {
  const child = spawn(DENO, ['run', '--cached-only', '--no-lock', '--no-prompt', '--allow-env', `--allow-net=127.0.0.1:${PORT[app]}`, `functions/__r3_loopback_torneos-${app}.ts`],
    { cwd: root, env: { ...base(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`deno ${app} did not listen: ${out.slice(0, 600)}`)), 60_000);
    child.stdout.on('data', () => { if (out.includes('R3_LISTENING')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`deno ${app} exited ${code}: ${out.slice(0, 600)}`)); });
  });
  return { child, ready, output: () => out, stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }) };
}
function request(app, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT[app], method, path, headers: { ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, body: json, text }); });
    });
    req.on('error', reject); req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}
const noLeak = (text, label) => { for (const s of SECRET_VALUES) assert.ok(!text.includes(s), `${label}: output carries a secret fixture`); };

// payments request builders
const WEBHOOK = '/functions/v1/torneos-payments/webhooks/mercadopago/v1';
const INTERNAL = '/functions/v1/torneos-payments/internal/v1/season-checkout-preference';
function webhook(ts, { sign = ts, dataId = '1790000000123', requestId = 'r3-deno' } = {}) {
  const v1 = createHmac('sha256', UNIT_ENV.MERCADO_PAGO_TEST_WEBHOOK_SECRET).update(`id:${dataId};request-id:${requestId};ts:${sign};`).digest('hex');
  const body = JSON.stringify({ type: 'payment', data: { id: dataId }, live_mode: false, user_id: UNIT_ENV.MERCADO_PAGO_TEST_SELLER_ID });
  return request('payments', { method: 'POST', path: `${WEBHOOK}?data.id=${dataId}&type=payment`, headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` }, body });
}
function internal({ good = true } = {}) {
  const body = JSON.stringify({ purchase_id: '5f0e0000-0000-4000-8000-00000000d300' });
  const time = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(8).toString('hex');
  const key = Buffer.from(UNIT_ENV.TORNEOS_PAYMENTS_INTERNAL_SECRET, 'hex');
  const sig = good ? createHmac('sha256', key).update(`/internal/v1/season-checkout-preference\n${time}\n${nonce}\n${body}`).digest('hex') : '0'.repeat(64);
  return request('payments', { method: 'POST', path: INTERNAL, headers: { 'x-time': time, 'x-nonce': nonce, 'x-signature': sig }, body });
}
const gw = (path, opts = {}) => request('gateway', { ...opts, path: `/functions/v1/torneos-gateway${path}`, headers: { host: GW_HOST, ...(opts.headers ?? {}) } });

test('MP-B1.1 R3 — unmodified entrypoints on standard Deno 2.x (offline)', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 500) }); throw error; }
    });
  }
  let root = null;
  try {
    await check('runtime: DENO_BIN is a standard Deno 2.x binary', async () => {
      assert.ok(DENO && existsSync(DENO), 'DENO_BIN must point to a local Deno 2.x binary');
      const v = spawnSync(DENO, ['--version'], { encoding: 'utf8', env: base() });
      evidence.deno = v.stdout.trim().split('\n');
      assert.match(evidence.deno[0], /^deno 2\.\d+\.\d+ \(stable/);
      root = await appRoot();
    });
    await check('resolution: inside the repo the root package.json switches Deno 2 to node_modules resolution → npm: imports fail closed; rooted at the functions tree they resolve', async () => {
      const inRepo = spawnSync(DENO, ['check', '--no-lock', `${FN_DIR}/torneos-payments/index.ts`], { cwd: repo, encoding: 'utf8', env: base(), timeout: 120_000 });
      evidence.repoRootPackageJson = { exit: inRepo.status, error: (inRepo.stderr.match(/error: [^\n]*/) ?? [''])[0].slice(0, 200) };
      assert.notEqual(inRepo.status, 0);
      assert.match(inRepo.stderr, /Could not find a matching package for 'npm:postgres@3\.4\.7' in the node_modules directory/);
    });
    await check('type check: payments entrypoint graph type-checks clean on Deno 2.x; gateway type-check reports only the 3 known pre-existing strict-type diagnostics (runtime is unaffected: Deno does not type-check at run time)', async () => {
      const pay = spawnSync(DENO, ['check', '--no-lock', 'functions/torneos-payments/index.ts'], { cwd: root, encoding: 'utf8', env: base(), timeout: 180_000 });
      const gwc = spawnSync(DENO, ['check', '--no-lock', 'functions/torneos-gateway/index.ts'], { cwd: root, encoding: 'utf8', env: base(), timeout: 180_000 });
      const diags = [...gwc.stderr.matchAll(/(TS\d+) \[ERROR\][\s\S]*?at file:\/\/\/[^\n]*\/functions\/([^\n]+)/g)].map(m => `${m[1]} ${m[2]}`);
      evidence.check = { payments: { exit: pay.status }, gateway: { exit: gwc.status, diagnostics: diags } };
      assert.equal(pay.status, 0, pay.stderr.slice(0, 800));
      // COMPETITION-V1 added 8 lines above the pre-existing index.ts diagnostic (66:78 → 74:78) and its public-route
      // bound 1 more (the Runtime.publicGate field: 74:78 → 75:78); competition.ts adds none.
      // OFFICIALIZATION-V1 added 6 lines above it in index.ts (75:78 → 81:78) and 5 above the adapter.ts one (82:14 → 87:14).
      assert.deepEqual(diags, ['TS18046 torneos-gateway/adapter.ts:87:14', 'TS2322 torneos-gateway/db.ts:42:5', 'TS2322 torneos-gateway/index.ts:81:78'], gwc.stderr.slice(0, 1500));
    });

    // ================================================================ torneos-payments
    const P = evidence.payments;
    const note = (label, r, extra = {}) => { P.push({ case: label, http: r.status, code: r.body?.error ?? r.body?.outcome ?? null, ...extra }); return r; };
    await check('payments boots on Deno 2.x with the TEST fixture (Deno.serve + Deno.env.toObject + npm:postgres loaded) and serves only its two routes under /functions/v1/torneos-payments', async () => {
      const p = start(root, 'payments', { ...UNIT_ENV });
      try {
        await p.ready;
        assert.equal(note('GET webhook path', await request('payments', { path: WEBHOOK })).status, 404);
        assert.equal(note('gateway path on payments', await request('payments', { method: 'POST', path: '/functions/v1/torneos-gateway/exchange', body: '{}' })).status, 404);
        assert.equal(note('root', await request('payments', { path: '/' })).status, 404);
        // Webhook: valid signatures pass authentication; the provider re-fetch is then refused by the sandbox (no network) → 503, never 2xx.
        const nowS = Math.floor(Date.now() / 1000), nowMs = Date.now();
        for (const [label, ts] of [['signed 10-digit seconds', String(nowS)], ['signed 13-digit milliseconds', String(nowMs)], ['signed old seconds (−30 d)', String(nowS - 86400 * 30)], ['signed old milliseconds (−30 d)', String(nowMs - 86400 * 30 * 1000)]]) {
          const r = note(label, await webhook(ts));
          assert.deepEqual([r.status, r.body?.error], [503, 'provider_unavailable'], `${label}: authenticated, provider unreachable offline`);
        }
        for (const [label, ts, sign] of [['signed future +1 d seconds', String(nowS + 86400)], ['signed future +1 d milliseconds', String(nowMs + 86_400_000)], ['signed leading zero', `0${String(nowS).slice(1)}`],
          ['signed 12 digits', `${nowS}00`], ['13-digit header signed as seconds', String(nowMs), String(Math.floor(nowMs / 1000))], ['bad signature', String(nowS), 'x']]) {
          const r = note(label, await webhook(ts, sign ? { sign } : {}));
          assert.deepEqual([r.status, r.body?.error], [401, 'invalid_signature'], label);
        }
        // Internal route: HMAC checked on Deno; a valid call reaches postgres.js, whose connection is refused by the sandbox → 503.
        assert.deepEqual([note('internal bad HMAC', await internal({ good: false })).status], [401]);
        const r = note('internal valid HMAC (DB unreachable offline)', await internal());
        assert.deepEqual([r.status, r.body?.error], [503, 'service_unavailable']);
      } finally { await p.stop(); noLeak(p.output(), 'payments'); P.push({ log: p.output().split('\n').filter(Boolean).slice(0, 40) }); }
    });
    await check('payments on Deno 2.x refuses to boot (503 on both routes, "config_rejected") with bridge keys, a Core/Supabase admin secret, a PG* variable or a gateway DB login', async () => {
      for (const [label, over] of [['TORNEOS_BRIDGE_KEYS', { TORNEOS_BRIDGE_KEYS: BRIDGE }], ['TORNEOS_CONTRACT_SERVICE_SECRET', { TORNEOS_CONTRACT_SERVICE_SECRET: GATEWAY_ENV.TORNEOS_CONTRACT_SERVICE_SECRET }],
        ['SUPABASE_SERVICE_ROLE_KEY', { SUPABASE_SERVICE_ROLE_KEY: 'service-role-fixture' }], ['DATABASE_URL', { DATABASE_URL: 'postgres://x:pw-fixture@db.fixture.invalid/postgres' }],
        ['PGPASSWORD', { PGPASSWORD: 'pw-fixture' }], ['gateway DB login', { TORNEOS_PAYMENTS_DB_URL: GATEWAY_ENV.TORNEOS_DB_CORE_ADAPTER_URL }]]) {
        const p = start(root, 'payments', { ...UNIT_ENV, ...over });
        try {
          await p.ready;
          const a = await webhook(String(Math.floor(Date.now() / 1000)));
          const b = await internal();
          note(`refused boot: ${label}`, a, { internal: b.status });
          assert.deepEqual([a.status, b.status], [503, 503], label);
          assert.match(p.output(), /"event":"config_rejected"/);
        } finally { await p.stop(); noLeak(p.output(), `payments ${label}`); }
      }
    });

    // ================================================================ torneos-gateway
    const G = evidence.gateway;
    const gnote = (label, r) => { G.push({ case: label, http: r.status, error: r.body?.error ?? null }); return r; };
    await check('gateway boots on Deno 2.x in remote-test commerce (https + declared hosts): JWKS, /config, /exchange and the commerce route answer under /functions/v1/torneos-gateway; wrong Host → 403; Core unreachable → 503', async () => {
      const g = start(root, 'gateway', GATEWAY_ENV);
      try {
        await g.ready;
        const jwks = gnote('GET /.well-known/jwks.json', await gw('/.well-known/jwks.json'));
        assert.equal(jwks.status, 200); assert.deepEqual(jwks.body.keys.map(k => [k.kid, k.alg, k.kty, 'd' in k]), [['r3-fixture', 'RS256', 'RSA', false]]);
        const config = gnote('GET /config', await gw('/config'));
        assert.deepEqual([config.status, config.body.coreUrl, config.body.torneosUrl], [200, 'https://core.torneos-test.example.com', `https://${GW_HOST}/functions/v1/torneos-gateway/torneos`]);
        assert.equal(gnote('wrong Host', await request('gateway', { path: '/functions/v1/torneos-gateway/config', headers: { host: 'evil.example.com' } })).status, 403);
        assert.equal(gnote('POST /exchange without bearer', await gw('/exchange', { method: 'POST', body: '{}' })).status, 401);
        assert.equal(gnote('POST /commerce/v1/season-checkout without bearer', await gw('/commerce/v1/season-checkout', { method: 'POST', body: '{}' })).status, 401);
        assert.equal(gnote('GET /health (Core unreachable offline)', await gw('/health')).status, 503);
        assert.equal(gnote('payments path on gateway', await request('gateway', { method: 'POST', path: WEBHOOK, headers: { host: GW_HOST }, body: '{}' })).status, 404);
      } finally { await g.stop(); noLeak(g.output(), 'gateway'); G.push({ log: g.output().split('\n').filter(Boolean).slice(0, 40) }); }
    });
    await check('gateway on Deno 2.x refuses to boot (503 everywhere, value-free reason) with a Mercado Pago secret or the payments DB login in its environment', async () => {
      for (const [name, value] of [['MERCADO_PAGO_TEST_ACCESS_TOKEN', UNIT_ENV.MERCADO_PAGO_TEST_ACCESS_TOKEN], ['TORNEOS_PAYMENTS_DB_URL', UNIT_ENV.TORNEOS_PAYMENTS_DB_URL]]) {
        const g = start(root, 'gateway', { ...GATEWAY_ENV, [name]: value });
        try {
          await g.ready;
          assert.equal(gnote(`refused boot: ${name}`, await gw('/config')).status, 503);
          assert.match(g.output(), new RegExp(`\\[torneos-gateway\\] disabled: refusing ${name} in the gateway`));
        } finally { await g.stop(); noLeak(g.output(), `gateway ${name}`); }
      }
    });
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
    await mkdir(EVIDENCE, { recursive: true });
    const doc = { suite: 'MP-B1.1 R3 Deno 2.x runtime (offline)', results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, ...evidence };
    await writeFile(`${EVIDENCE}deno-runtime${TAG}.json`, JSON.stringify(doc, null, 2) + '\n');
  }
});
