// ANDROID ORIGIN — the gateway accepts exactly two browser origins on Production: the web app
// (https://app.arma2.com.ar, TORNEOS_ALLOWED_ORIGIN) and the Android app's WebView (https://localhost, pinned in
// topology.ts, measured on the wire 2026-09-29: Capacitor 7.4.5, Android 16, WebView 134). Offline, on the REAL
// handle() of two sources: `live` = the function tree at the deployed commit (digest 6c252863…, revision t5vxxvzp1t9f)
// extracted from git, `candidate` = the working tree. Nothing else may change: same env names, same 401/403/503, same
// no-store, the Origin check still runs before auth, and an Origin is still never a credential.
// Run: node --test backend/torneos/infra/torneos-android-origin/android-origin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { loadGatewayTree, FUNCTIONS_DIR } from '../torneos-gateway-auth/gateway-loader.mjs';
import { extractTree } from '../torneos-competition-v1/competition-bundle.mjs';
import { buildFromCommit } from '../torneos-competition-v1/competition-bundle.mjs';
import { fixtureEnv } from '../torneos-competition-v1/test-support.mjs';
import { GATEWAY_BASE as BASE } from '../torneos-competition-v1/competition-remote-contract.mjs';

// The source serving Production (OEC W3, revision t5vxxvzp1t9f) — equal to main 9558fe4a's function tree.
const LIVE_COMMIT = '0f049ef5657a3b3046276ff00f44464aba998c08';
const LIVE_DIGEST = '6c252863fd94bcad0f785af9bb3636d09b2bc2265baafb0af2a771efdb6143a4';
const WEB = 'https://app.arma2.com.ar';
const ANDROID = 'https://localhost';

const DENY = [
  'https://evil.example',
  'http://evil.localhost',
  'https://evil.localhost',
  'https://localhost.evil.example',
  'http://localhost',              // same host, other scheme
  'capacitor://localhost',         // the iOS Capacitor default: not demonstrated as needed, not enabled
  'ionic://localhost',
  'https://localhost:8443',        // same scheme+host, other port
  'https://localhost:443',         // not the serialized form a browser sends
  'http://localhost:3000',
  'https://localhost/',
  'https://LOCALHOST',
  'https://127.0.0.1',
  'https://[::1]',
  'http://app.arma2.com.ar',
  'https://app.arma2.com.ar.evil.example',
  'https://localhost, https://app.arma2.com.ar',
  'null',
  '*',
  'file://',
];

const { env } = fixtureEnv();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-android-origin-live-'));
const trees = { live: await loadGatewayTree({ functionsDir: extractTree(LIVE_COMMIT, tmp) }), candidate: await loadGatewayTree() };
const realFetch = globalThis.fetch;
const upstream = [];
globalThis.Deno = { env: { toObject: () => ({ ...env }) } };
globalThis.fetch = async (url) => {
  const u = String(url);
  upstream.push(u);
  if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/health`) return new Response('{}', { status: 200 });
  if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/user`) return new Response('{"msg":"bad jwt"}', { status: 401 });
  return new Response('{}', { status: 599 });
};
const idx = { live: await trees.live.import('torneos-gateway/index.ts'), candidate: await trees.candidate.import('torneos-gateway/index.ts') };
const config = await trees.candidate.import('torneos-gateway/config.ts');
test.after(async () => {
  globalThis.fetch = realFetch; delete globalThis.Deno;
  await trees.live.cleanup(); await trees.candidate.cleanup(); fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(which, p, { method = 'GET', origin, headers = {}, body } = {}) {
  const u = new URL(`${BASE}${p}`);
  const req = new Request(u, { method, body, headers: { ...headers, ...(origin === undefined ? {} : { origin }), host: u.host, 'x-forwarded-host': u.host } });
  const res = await idx[which].handle(req);
  const raw = await res.text();
  let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  const h = Object.fromEntries(res.headers);
  return { status: res.status, json, acao: h['access-control-allow-origin'] ?? null, vary: h.vary ?? null, cache: h['cache-control'] ?? null, allowHeaders: h['access-control-allow-headers'] ?? null };
}
const preflight = (which, origin) => call(which, '/exchange', { method: 'OPTIONS', origin, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });

test('the live tree extracted from git is the deployed source (digest 6c252863…, 17 files)', () => {
  const live = buildFromCommit(LIVE_COMMIT);
  assert.equal(live.digest, LIVE_DIGEST);
  assert.equal(live.manifest.length, 17);
});

test('config: Production allows exactly [web, Android]; TORNEOS_ALLOWED_ORIGIN is still pinned to the web origin', () => {
  const cfg = config.loadConfig(env);
  assert.equal(cfg.topology.kind, 'production');
  assert.equal(cfg.allowedOrigin, WEB);
  assert.deepEqual([...cfg.allowedOrigins], [WEB, ANDROID]);
  assert.ok(Object.isFrozen(cfg.allowedOrigins));
  // The Android origin is not an env value: pointing the env at it (or any other origin) still disables the gateway.
  for (const origin of [ANDROID, 'capacitor://localhost', 'https://arma2.com.ar']) {
    assert.throws(() => config.loadConfig({ ...env, TORNEOS_ALLOWED_ORIGIN: origin }), config.ConfigError, origin);
  }
});

test('config: non-production topologies keep their single env origin (no Android origin outside Production)', () => {
  const lab = { ...env, TORNEOS_GATEWAY_PUBLIC_URL: 'http://127.0.0.1:54321/functions/v1/torneos-gateway', TORNEOS_ALLOWED_ORIGIN: 'http://localhost:3000',
    CORE_AUTH_URL: 'http://core-auth:9999', CORE_JWT_ISSUER: 'http://core-auth:9999', CORE_CONTRACT_URL: 'http://core-api:8000/functions/v1/torneos-core-contract',
    CORE_ANON_KEY: '', TORNEOS_REST_URL: 'http://torneos-rest:3000', TORNEOS_DB_SSL_CA: '',
    TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://lab_identity_writer:pw-fixture@torneos-db:5432/postgres',
    TORNEOS_DB_CORE_ADAPTER_URL: 'postgres://lab_core_adapter:pw-fixture@torneos-db:5432/postgres' };
  const cfg = config.loadConfig(lab);
  assert.equal(cfg.topology.kind, 'nonproduction');
  assert.deepEqual([...cfg.allowedOrigins], ['http://localhost:3000']);
});

test('ALLOW: web and Android origins → 200 /health, 204 preflight, 200 /config, each with its own exact CORS grant', async () => {
  for (const origin of [WEB, ANDROID]) {
    const h = await call('candidate', '/health', { origin });
    assert.deepEqual([h.status, h.json?.ready, h.acao, h.vary, h.cache], [200, true, origin, 'origin', 'no-store'], `${origin} /health`);
    const pre = await preflight('candidate', origin);
    assert.deepEqual([pre.status, pre.acao, pre.vary, pre.cache], [204, origin, 'origin', 'no-store'], `${origin} preflight`);
    assert.match(pre.allowHeaders, /(^|, )authorization(,|$)/);
    const c = await call('candidate', '/config', { origin });
    assert.deepEqual([c.status, c.acao], [200, origin], `${origin} /config`);
  }
});

test('DENY: every other origin → 403 origin rejected, no CORS grant, before any auth or upstream call', async () => {
  for (const origin of DENY) {
    upstream.length = 0;
    const h = await call('candidate', '/health', { origin });
    assert.deepEqual([h.status, h.json?.error, h.acao, h.cache], [403, 'origin rejected', null, 'no-store'], `${origin} /health`);
    const pre = await preflight('candidate', origin);
    assert.deepEqual([pre.status, pre.acao], [403, null], `${origin} preflight`);
    const ex = await call('candidate', '/exchange', { method: 'POST', origin, headers: { authorization: 'Bearer eyJx.eyJ4.x', 'content-type': 'application/json' }, body: '{}' });
    assert.deepEqual([ex.status, ex.json?.error, ex.acao], [403, 'origin rejected', null], `${origin} /exchange`);
    assert.deepEqual(upstream, [], `${origin}: nothing reached Core or Torneos`);
  }
});

test('absent Origin (non-browser client): unchanged — served without any CORS grant, auth still required', async () => {
  for (const which of ['live', 'candidate']) {
    const h = await call(which, '/health');
    assert.deepEqual([h.status, h.acao], [200, null], which);
    const ex = await call(which, '/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.deepEqual([ex.status, ex.acao], [401, null], which);
  }
});

test('an allowed Origin is never a credential: Android gets exactly the web answers on authenticated routes (401)', async () => {
  const cases = [
    ['/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
    ['/exchange', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer eyJx.eyJ4.x' }, body: '{}' }],
    ['/torneos/rest/v1/rpc/get_my_tournament_memberships', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
    ['/torneos/rest/v1/rpc/get_my_tournament_memberships', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-bridge-token' }, body: '{}' }],
    ['/torneos/rest/v1/torneos_identity?select=id', {}],
  ];
  for (const [p, opts] of cases) {
    const web = await call('candidate', p, { ...opts, origin: WEB });
    const android = await call('candidate', p, { ...opts, origin: ANDROID });
    assert.equal(web.status, 401, `${p} web`);
    assert.deepEqual([android.status, android.json], [web.status, web.json], `${p}: Android ≡ web`);
    assert.deepEqual([web.acao, android.acao], [WEB, ANDROID]);
  }
});

test('differential vs the live source: only https://localhost changes (403 → 200); every other answer is identical', async () => {
  for (const origin of [WEB, ANDROID, undefined, ...DENY]) {
    for (const [name, run] of [['health', (w) => call(w, '/health', { origin })], ['preflight', (w) => preflight(w, origin)],
      ['exchange', (w) => call(w, '/exchange', { method: 'POST', origin, headers: { 'content-type': 'application/json' }, body: '{}' })]]) {
      const live = await run('live'); const cand = await run('candidate');
      if (origin === ANDROID) {
        assert.equal(live.status, 403, `live rejects Android (${name})`);
        assert.equal(live.acao, null);
        assert.notEqual(cand.status, 403, `candidate admits Android (${name})`);
        assert.equal(cand.acao, ANDROID);
      } else {
        assert.deepEqual(cand, live, `${String(origin)} ${name}: unchanged`);
      }
    }
  }
});

test('source guard: exact membership only, the Android origin pinned once in topology.ts, no wildcard, no new env', () => {
  const read = (rel) => fs.readFileSync(path.join(FUNCTIONS_DIR, 'torneos-gateway', rel), 'utf8');
  const index = read('index.ts'); const cfg = read('config.ts'); const topo = read('topology.ts');
  assert.match(index, /"access-control-allow-origin": origin,/);
  assert.match(index, /if \(!cfg \|\| !origin \|\| !cfg\.allowedOrigins\.includes\(origin\)\) return \{\}/);
  assert.match(index, /if \(!hostOk \|\| \(origin && !rt\.cfg\.allowedOrigins\.includes\(origin\)\)\) return json\(403, \{ error: "origin rejected" \}\)/);
  assert.doesNotMatch(index, /access-control-allow-origin": "\*"|allow-credentials/i);
  assert.doesNotMatch(index + cfg + topo, /localhost\S*\/[gimsuy]*\.test\(|new RegExp\([^)]*origin/i, 'no pattern matching on origins');
  const tree = fs.readdirSync(path.join(FUNCTIONS_DIR, 'torneos-gateway')).filter((f) => f.endsWith('.ts')).map((f) => read(f)).join('\n');
  assert.equal(tree.split('"https://localhost"').length - 1, 1, 'the Android origin literal appears exactly once');
  assert.match(topo, /nativeAppOrigin: "https:\/\/localhost",/);
  // config.ts reads the same env names as the live source: the Android origin is not configurable.
  const envNames = (src) => [...new Set([...src.matchAll(/(?:required|optional)\(env, "([A-Z_]+)"\)|env\.([A-Z_]+)/g)].map((m) => m[1] ?? m[2]))].sort();
  const liveCfg = fs.readFileSync(path.join(tmp, 'backend/torneos/supabase/functions/torneos-gateway/config.ts'), 'utf8');
  assert.deepEqual(envNames(cfg), envNames(liveCfg));
});
