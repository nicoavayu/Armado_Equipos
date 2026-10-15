// IOS ORIGIN — the gateway admits the iOS app's WKWebView origin `capacitor://localhost` on Production, pinned in
// topology.ts (PRODUCTION.nativeIosOrigin), exactly like the Android origin `https://localhost`: never from env, only in
// addition to the web origin, compared as an EXACT string with the request's Origin header (never through
// `new URL(x).origin`, which is "null" for a non-special scheme). See torneos-gateway/NATIVE-ORIGINS.md.
//
// Offline, on the REAL handle() of two sources: `base` = the function tree at the branch point of this change (origin/main
// b4fb150a, extracted from git), `candidate` = the working tree; three gateway environments (every product mode off; the
// product modes the web runs — CONNECTED + BRANDING + MEDIA; and the same plus COMMERCE-PRODUCTION). Core, Torneos REST,
// Storage and payments are recording stubs; nothing leaves the process.
//
// What must hold:
//   • capacitor://localhost is the ONLY answer that changes (base 403 → candidate = the web answer + its own exact grant);
//   • every near miss (trailing slash, case, other host/port/scheme, "null", "*", lists) stays 403, before any upstream;
//   • on every route — CORS preflight, /config, /exchange, authenticated RPC, the public route, branding objects, media,
//     commerce — iOS gets exactly the web's status, body and upstream calls; the grant echoes the matched origin with
//     `vary: origin` and never `allow-credentials`;
//   • commerce / payments: nothing new for native origins (same answers as the web; the payments functions still refuse
//     any request that carries an Origin);
//   • Referer is never read; the Origin header is read once, in index.ts; no env name is added; no file is added.
// Run: node --test backend/torneos/infra/torneos-ios-origin/ios-origin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { loadGatewayTree, FUNCTIONS_DIR, REPO_ROOT } from '../torneos-gateway-auth/gateway-loader.mjs';
import { mintBridgeToken } from '../torneos-gateway-auth/bridge-probe.mjs';
import { extractTree } from '../torneos-competition-v1/competition-bundle.mjs';
import { fixtureEnv } from '../torneos-competition-v1/test-support.mjs';
import { GATEWAY_BASE as BASE } from '../torneos-competition-v1/competition-remote-contract.mjs';
import { STORE_SECRET } from '../../media-store-v1/test/support.mjs';

// origin/main when this change branched (PR #211 merged). Its gateway tree is the source of every image built since #210.
const BASE_COMMIT = 'b4fb150a12fcc521f227e935f23dab5cbcee6c22';
const WEB = 'https://app.arma2.com.ar';
const ANDROID = 'https://localhost';
const IOS = 'capacitor://localhost';
const ALLOWED = [WEB, ANDROID, IOS];

// Everything that is not byte-for-byte one of the three allowed origins.
const DENY = [
  'capacitor://localhost/',             // trailing slash
  'capacitor://localhost//',
  'capacitor://localhost/index.html',   // a URL, not an origin
  'CAPACITOR://localhost',              // case variants
  'Capacitor://localhost',
  'capacitor://LOCALHOST',
  'capacitor://Localhost',
  'capacitor://evil',                   // other hosts
  'capacitor://evil.example',
  'capacitor://localhost.evil.example',
  'capacitor://evil.localhost',
  'capacitor://127.0.0.1',
  'capacitor://localhost:8080',         // other ports
  'capacitor://localhost:0',
  'capacitor://user@localhost',
  'capacitor:localhost',
  'capacitor://',
  'capacitor:',
  'capacitor://localhost, https://app.arma2.com.ar',
  'https://app.arma2.com.ar capacitor://localhost',
  'null',                               // what new URL('capacitor://localhost').origin yields; also sandboxed iframes, file:
  'NULL',
  '*',
  'http://localhost',
  'http://localhost:3000',
  'https://localhost/',
  'https://localhost:8443',
  'ionic://localhost',                  // Ionic's iOS scheme
  'arma2://localhost',                  // a custom iosScheme
  'com.teambalancer.app://localhost',   // the app's auth-callback scheme
  'file://',
  'https://evil.example',
  'http://app.arma2.com.ar',
  'https://app.arma2.com.ar.evil.example',
];

// ───────────────────────── environments ─────────────────────────
const fx = fixtureEnv();
const PAYMENTS_HOST = 'torneos-payments.example-org.deno.net';
const PAYMENTS_URL = `https://${PAYMENTS_HOST}/functions/v1/torneos-payments-production`;
const PRODUCT = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_BRANDING_MODE: 'on', TORNEOS_MEDIA_MODE: 'on', TORNEOS_MEDIA_STORE_SECRET: STORE_SECRET };
const PROFILES = {
  off: fx.env,
  product: PRODUCT,
  commerce: { ...PRODUCT, TORNEOS_COMMERCE_MODE: 'production', TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST: PAYMENTS_HOST,
    TORNEOS_PAYMENTS_INTERNAL_URL: PAYMENTS_URL, TORNEOS_PAYMENTS_INTERNAL_SECRET: crypto.randomBytes(32).toString('hex') },
};

// ───────────────────────── upstream stubs (record everything) ─────────────────────────
const upstream = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  upstream.push(`${init.method ?? 'GET'} ${u.split('?')[0]}`);
  if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/health`) return new Response('{}', { status: 200 });
  if (u === `${G.GATEWAY_TOPOLOGY.coreAuthUrl}/user`) return new Response('{"msg":"bad jwt"}', { status: 401 });
  if (u === `${G.GATEWAY_TOPOLOGY.coreContractUrl}/v1/session`) {
    return new Response(JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }), { status: 200 });
  }
  if (u.startsWith(`${G.GATEWAY_TOPOLOGY.torneosRestUrl}/rpc/`)) return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.startsWith(`${G.GATEWAY_TOPOLOGY.torneosRestUrl}/`)) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 599 });
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-ios-origin-base-'));
const BASE_DIR = extractTree(BASE_COMMIT, tmp);
const trees = [];
const gateways = {};
/** One fresh module graph per (source, profile): the runtime is a module singleton booted from Deno.env on first use. */
async function gateway(which, profile) {
  const key = `${which}/${profile}`;
  if (gateways[key]) return gateways[key];
  const tree = await loadGatewayTree(which === 'base' ? { functionsDir: BASE_DIR } : {});
  trees.push(tree);
  const idx = await tree.import('torneos-gateway/index.ts');
  globalThis.Deno = { env: { toObject: () => ({ ...PROFILES[profile] }) } };
  const boot = await idx.handle(new Request(`${BASE}/health`, { headers: { host: new URL(BASE).host } }));
  assert.equal(boot.status, 200, `${key} boots`);
  gateways[key] = idx;
  return idx;
}
const config = await (async () => { const tree = await loadGatewayTree(); trees.push(tree); return tree.import('torneos-gateway/config.ts'); })();
test.after(async () => {
  globalThis.fetch = realFetch; delete globalThis.Deno;
  for (const tree of trees) await tree.cleanup();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ───────────────────────── routes ─────────────────────────
const UUID = () => crypto.randomUUID();
const OWNER = `${UUID()}/tournaments/${UUID()}`;
const bridge = () => `Bearer ${mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid })}`;
const JSON_CT = { 'content-type': 'application/json' };
const checkoutBody = () => JSON.stringify({ idempotencyKey: UUID(), organizationId: UUID(), seasonId: UUID() });
/** [label, method, path, headers(), body()] — headers/body are thunks so every call gets fresh tokens. */
const ROUTES = [
  ['health', 'GET', '/health'],
  ['config', 'GET', '/config'],
  ['jwks', 'GET', '/.well-known/jwks.json'],
  ['exchange (no bearer)', 'POST', '/exchange', () => JSON_CT, () => '{}'],
  ['exchange (bad Core bearer)', 'POST', '/exchange', () => ({ ...JSON_CT, authorization: 'Bearer eyJx.eyJ4.x' }), () => '{}'],
  ['rpc (no bearer)', 'POST', '/torneos/rest/v1/rpc/get_my_tournament_memberships', () => JSON_CT, () => '{}'],
  ['rpc (valid bridge)', 'POST', '/torneos/rest/v1/rpc/get_my_tournament_memberships', () => ({ ...JSON_CT, authorization: bridge() }), () => '{}'],
  ['rpc outside the allowlist (commerce write)', 'POST', '/torneos/rest/v1/rpc/create_tournament_season_checkout_purchase', () => ({ ...JSON_CT, authorization: bridge() }), () => '{}'],
  ['commerce read rpc (valid bridge)', 'POST', '/torneos/rest/v1/rpc/get_effective_tournament_season_entitlements', () => ({ ...JSON_CT, authorization: bridge() }), () => '{}'],
  ['table route (valid bridge)', 'GET', '/torneos/rest/v1/tournament_venues?select=id', () => ({ authorization: bridge() })],
  ['public rpc', 'POST', '/torneos/public/v1/rpc/get_public_tournament_page', () => JSON_CT, () => JSON.stringify({ p_public_slug: 'liga-demo' })],
  ['public rpc with a credential', 'POST', '/torneos/public/v1/rpc/get_public_tournament_page', () => ({ ...JSON_CT, authorization: bridge() }), () => JSON.stringify({ p_public_slug: 'liga-demo' })],
  ['public catalog rpc', 'POST', '/torneos/public/v1/rpc/search_tournament_catalog', () => JSON_CT, () => '{}'],
  ['branding upload (no bearer)', 'POST', `/torneos/branding/v1/object/${OWNER}`, () => ({ 'content-type': 'image/png' }), () => 'x'],
  ['branding remove (no bearer)', 'DELETE', `/torneos/branding/v1/object/${OWNER}/${UUID()}.png`],
  ['media urls (no bearer)', 'POST', '/torneos/media/v1/urls', () => JSON_CT, () => '{}'],
  ['media upload (no bearer)', 'POST', `/torneos/media/v1/upload?gallery=${UUID()}&key=${UUID()}`, () => ({ 'content-type': 'image/jpeg' }), () => 'x'],
  ['season checkout (no bearer)', 'POST', '/commerce/v1/season-checkout', () => JSON_CT, checkoutBody],
  ['season checkout (valid bridge)', 'POST', '/commerce/v1/season-checkout', () => ({ ...JSON_CT, authorization: bridge() }), checkoutBody],
  ['purchase refresh (no bearer)', 'POST', '/commerce/v1/purchase-refresh', () => JSON_CT, () => JSON.stringify({ purchaseId: UUID() })],
  ['unknown route', 'GET', '/nothing-here'],
];
const PREFLIGHTS = [...new Set(ROUTES.map((r) => r[2].split('?')[0]))];

async function call(which, profile, method, p, { origin, headers = {}, body, referer } = {}) {
  const idx = await gateway(which, profile);
  const u = new URL(`${BASE}${p}`);
  const h = { ...headers, host: u.host, 'x-forwarded-host': u.host, ...(origin === undefined ? {} : { origin }), ...(referer ? { referer } : {}) };
  upstream.length = 0;
  const res = await idx.handle(new Request(u, { method, headers: h, body: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : body }));
  const raw = await res.text();
  const hdr = Object.fromEntries(res.headers);
  return { status: res.status, body: raw, acao: hdr['access-control-allow-origin'] ?? null, vary: hdr.vary ?? null,
    credentials: hdr['access-control-allow-credentials'] ?? null, methods: hdr['access-control-allow-methods'] ?? null,
    upstream: [...upstream] };
}
const route = (which, profile, [, method, p, headers, body], origin, extra = {}) =>
  call(which, profile, method, p, { origin, headers: headers?.() ?? {}, body: body?.(), ...extra });
const preflight = (which, profile, p, origin) => call(which, profile, 'OPTIONS', p, { origin,
  headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
/** The parts of an answer that must not depend on which allowed origin asked (bodies of JWKS/config are deterministic). */
const shape = (r) => ({ status: r.status, body: r.body, upstream: r.upstream });

// ───────────────────────── configuration ─────────────────────────
test('config: Production allows exactly [web, Android, iOS], frozen; the iOS origin is not an env value', () => {
  const cfg = config.loadConfig(fx.env);
  assert.equal(cfg.topology.kind, 'production');
  assert.deepEqual([...cfg.allowedOrigins], ALLOWED);
  assert.ok(Object.isFrozen(cfg.allowedOrigins));
  assert.ok(!cfg.allowedOrigins.includes('null') && !cfg.allowedOrigins.includes('*'));
  // Pointing TORNEOS_ALLOWED_ORIGIN at a native origin (or any near miss) still disables the gateway.
  for (const origin of [IOS, 'capacitor://localhost/', 'CAPACITOR://localhost', 'null', '*']) {
    assert.throws(() => config.loadConfig({ ...fx.env, TORNEOS_ALLOWED_ORIGIN: origin }), config.ConfigError, origin);
  }
});

test('config: outside Production the single env origin stays alone (no native origin), and it can never be capacitor://', () => {
  const lab = { ...fx.env, TORNEOS_GATEWAY_PUBLIC_URL: 'http://127.0.0.1:54321/functions/v1/torneos-gateway', TORNEOS_ALLOWED_ORIGIN: 'http://localhost:3000',
    CORE_AUTH_URL: 'http://core-auth:9999', CORE_JWT_ISSUER: 'http://core-auth:9999', CORE_CONTRACT_URL: 'http://core-api:8000/functions/v1/torneos-core-contract',
    CORE_ANON_KEY: '', TORNEOS_REST_URL: 'http://torneos-rest:3000', TORNEOS_DB_SSL_CA: '',
    TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://lab_identity_writer:pw-fixture@torneos-db:5432/postgres',
    TORNEOS_DB_CORE_ADAPTER_URL: 'postgres://lab_core_adapter:pw-fixture@torneos-db:5432/postgres' };
  const cfg = config.loadConfig(lab);
  assert.equal(cfg.topology.kind, 'nonproduction');
  assert.deepEqual([...cfg.allowedOrigins], ['http://localhost:3000']);
  assert.throws(() => config.loadConfig({ ...lab, TORNEOS_ALLOWED_ORIGIN: IOS }), config.ConfigError);
});

// ───────────────────────── allow ─────────────────────────
test('ALLOW: on every route and profile, iOS gets exactly the web answer (status, body, upstream calls) with its own exact grant', async () => {
  let compared = 0;
  for (const profile of Object.keys(PROFILES)) {
    for (const r of ROUTES) {
      const answers = {};
      for (const origin of ALLOWED) answers[origin] = await route('candidate', profile, r, origin);
      for (const origin of ALLOWED) {
        const a = answers[origin];
        assert.ok(!a.body.includes('origin rejected'), `${profile} ${r[0]} ${origin}: not origin-rejected`);
        assert.deepEqual([a.acao, a.vary, a.credentials], [origin, 'origin', null], `${profile} ${r[0]} ${origin}: exact grant, vary, no credentials`);
      }
      // JWKS / config are deterministic; checkout bodies carry fresh ids, so compare everything but the request-specific part.
      assert.deepEqual(shape(answers[IOS]), shape(answers[WEB]), `${profile} ${r[0]}: iOS ≡ web`);
      assert.deepEqual(shape(answers[ANDROID]), shape(answers[WEB]), `${profile} ${r[0]}: Android ≡ web`);
      compared += 1;
    }
  }
  assert.equal(compared, Object.keys(PROFILES).length * ROUTES.length);
});

test('ALLOW: the authenticated happy path works for iOS (200 through to Torneos REST), exactly like the web', async () => {
  const r = ROUTES.find((x) => x[0] === 'rpc (valid bridge)');
  for (const origin of ALLOWED) {
    const a = await route('candidate', 'product', r, origin);
    assert.deepEqual([a.status, a.body, a.acao], [200, 'null', origin], origin);
    assert.ok(a.upstream.includes(`POST ${G.GATEWAY_TOPOLOGY.torneosRestUrl}/rpc/get_my_tournament_memberships`), `${origin} reached Torneos REST`);
  }
});

test('ALLOW: CORS preflight on every route path → 204 with the exact origin, vary: origin, no credentials, same methods as the web', async () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const p of PREFLIGHTS) {
      const web = await preflight('candidate', profile, p, WEB);
      assert.match(web.methods, /^GET, HEAD, POST, PATCH, DELETE, OPTIONS$/);
      for (const origin of ALLOWED) {
        const pre = await preflight('candidate', profile, p, origin);
        assert.deepEqual([pre.status, pre.acao, pre.vary, pre.credentials, pre.methods, pre.upstream], [204, origin, 'origin', null, web.methods, []], `${profile} ${p} ${origin}`);
      }
    }
  }
});

// ───────────────────────── deny ─────────────────────────
test('DENY: every near miss → 403 origin rejected, no CORS grant, no upstream call — on every route, preflight included', async () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const origin of DENY) {
      for (const r of ROUTES) {
        const a = await route('candidate', profile, r, origin);
        assert.deepEqual([a.status, JSON.parse(a.body).error, a.acao, a.vary, a.upstream], [403, 'origin rejected', null, null, []], `${profile} ${r[0]} ${JSON.stringify(origin)}`);
      }
      for (const p of PREFLIGHTS) {
        const pre = await preflight('candidate', profile, p, origin);
        assert.deepEqual([pre.status, pre.acao, pre.upstream], [403, null, []], `${profile} preflight ${p} ${JSON.stringify(origin)}`);
      }
    }
  }
});

test('Referer is never read: a capacitor:// Referer grants nothing without Origin, and does not rescue a refused Origin', async () => {
  for (const r of ROUTES) {
    const bare = await route('candidate', 'product', r, undefined);
    const withReferer = await route('candidate', 'product', r, undefined, { referer: 'capacitor://localhost/' });
    assert.deepEqual(shape(withReferer), shape(bare), `${r[0]}: Referer alone ≡ no header`);
    assert.equal(withReferer.acao, null);
    const refused = await route('candidate', 'product', r, 'capacitor://evil', { referer: 'capacitor://localhost/' });
    assert.deepEqual([refused.status, refused.acao, refused.upstream], [403, null, []], `${r[0]}: Referer does not rescue`);
  }
});

// ───────────────────────── differential vs the branch point ─────────────────────────
test('differential vs origin/main b4fb150a: only capacitor://localhost changes (403 → the web answer); everything else is identical', async () => {
  for (const profile of Object.keys(PROFILES)) {
    for (const origin of [WEB, ANDROID, IOS, undefined, ...DENY]) {
      for (const r of ROUTES) {
        const before = await route('base', profile, r, origin);
        const after = await route('candidate', profile, r, origin);
        if (origin === IOS) {
          assert.deepEqual([before.status, before.acao, before.upstream], [403, null, []], `${profile} ${r[0]}: base rejects iOS`);
          assert.equal(after.acao, IOS, `${profile} ${r[0]}: candidate grants iOS`);
        } else {
          assert.deepEqual({ ...shape(after), acao: after.acao, vary: after.vary }, { ...shape(before), acao: before.acao, vary: before.vary }, `${profile} ${r[0]} ${String(origin)}: unchanged`);
        }
      }
      for (const p of PREFLIGHTS) {
        const before = await preflight('base', profile, p, origin);
        const after = await preflight('candidate', profile, p, origin);
        if (origin === IOS) assert.deepEqual([before.status, before.acao, after.status, after.acao], [403, null, 204, IOS], `${profile} preflight ${p}`);
        else assert.deepEqual(after, before, `${profile} preflight ${p} ${String(origin)}: unchanged`);
      }
    }
  }
});

// ───────────────────────── commerce / payments ─────────────────────────
test('commerce: native origins get nothing new — off → 404 for all; production → the web answer, never a checkout without a verified identity', async () => {
  const commerceRoutes = ROUTES.filter((r) => r[2].startsWith('/commerce/'));
  for (const r of commerceRoutes) {
    for (const profile of ['off', 'product']) {
      for (const origin of ALLOWED) {
        const a = await route('candidate', profile, r, origin);
        assert.deepEqual([a.status, a.upstream.filter((u) => u.includes(PAYMENTS_HOST))], [404, []], `${profile} ${r[0]} ${origin}: commerce off`);
      }
    }
    const web = await route('candidate', 'commerce', r, WEB);
    for (const origin of [ANDROID, IOS]) {
      const a = await route('candidate', 'commerce', r, origin);
      assert.deepEqual(shape(a), shape(web), `${r[0]} ${origin} ≡ web`);
    }
    if (!r[0].includes('valid bridge')) {
      assert.equal(web.status, 401, `${r[0]}: unauthenticated`);
      assert.deepEqual(web.upstream.filter((u) => u.includes(PAYMENTS_HOST)), [], `${r[0]}: payments never reached without identity`);
    }
  }
});

test('payments functions: unchanged, and still refuse any request that carries an Origin (no browser, native or web, ever reaches them)', () => {
  for (const fn of ['torneos-payments-production/handler.ts', 'torneos-payments/handler.ts']) {
    const now = fs.readFileSync(path.join(FUNCTIONS_DIR, fn), 'utf8');
    const before = fs.readFileSync(path.join(BASE_DIR, fn), 'utf8');
    assert.equal(now, before, `${fn} untouched`);
    assert.match(now, /if \(req\.headers\.has\("origin"\) \|\| req\.headers\.has\("authorization"\)\) return fail\(403, "forbidden"\)/, `${fn}: internal route`);
    assert.match(now, /if \(req\.headers\.has\("origin"\)\) return fail\(400, "invalid_request"\)/, `${fn}: webhook`);
  }
});

// ───────────────────────── source guards ─────────────────────────
test('source guard: one exact-membership gate, the iOS literal pinned once in topology.ts, no URL parsing of Origin, no Referer, no new env, no new file', () => {
  const dir = path.join(FUNCTIONS_DIR, 'torneos-gateway');
  const read = (rel, root = FUNCTIONS_DIR) => fs.readFileSync(path.join(root, 'torneos-gateway', rel), 'utf8');
  const tsFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const tree = tsFiles.map((f) => read(f)).join('\n');
  const index = read('index.ts'); const cfg = read('config.ts'); const topo = read('topology.ts');
  // The literal: once, in topology.ts, as PRODUCTION.nativeIosOrigin; used once, in config.ts, Production only.
  assert.equal(tree.split('"capacitor://localhost"').length - 1, 1);
  assert.match(topo, /^ {2}nativeIosOrigin: "capacitor:\/\/localhost",$/m);
  assert.match(cfg, /allowedOrigins: Object\.freeze\(topology\.kind === "production" \? \[allowed\.origin, PRODUCTION\.nativeAppOrigin, PRODUCTION\.nativeIosOrigin\] : \[allowed\.origin\]\),/);
  assert.equal(tree.split('nativeIosOrigin').length - 1, 2, 'declared once, used once');
  // Origin is read once (index.ts) and only ever compared by Array.includes against the frozen list; the grant echoes it.
  assert.equal(tree.split('headers.get("origin")').length - 1, 1);
  assert.match(index, /if \(!cfg \|\| !origin \|\| !cfg\.allowedOrigins\.includes\(origin\)\) return \{\}/);
  assert.match(index, /if \(!hostOk \|\| \(origin && !rt\.cfg\.allowedOrigins\.includes\(origin\)\)\) return json\(403, \{ error: "origin rejected" \}\)/);
  assert.match(index, /"access-control-allow-origin": origin,/);
  assert.match(index, /"vary": "origin",/);
  assert.doesNotMatch(tree, /access-control-allow-origin": "\*"|allow-credentials/i);
  assert.doesNotMatch(tree, /new URL\(\s*origin|URL\.parse\(\s*origin|origin\s*\)\.origin|toLowerCase\(\)[^\n]*origin|origin[^\n]*toLowerCase\(\)/i, 'Origin is never parsed or normalized');
  assert.doesNotMatch(tree, /headers\.get\("referer"\)|headers\.get\("referrer"\)|\.referer\b/i, 'Referer is never read');
  assert.doesNotMatch(tree, /localhost\S*\/[gimsuy]*\.test\(|new RegExp\([^)]*origin/i, 'no pattern matching on origins');
  // No configurable origin: config.ts reads exactly the env names it read at the branch point.
  const envNames = (src) => [...new Set([...src.matchAll(/(?:required|optional)\(env, "([A-Z_]+)"\)|env\.([A-Z_]+)/g)].map((m) => m[1] ?? m[2]))].sort();
  assert.deepEqual(envNames(cfg), envNames(read('config.ts', BASE_DIR)));
  // Same files as the branch point (the image's file list does not change); only topology.ts and config.ts differ.
  const list = (root) => fs.readdirSync(path.join(root, 'torneos-gateway')).sort();
  assert.deepEqual(list(FUNCTIONS_DIR).filter((f) => !f.endsWith('.md')), list(BASE_DIR).filter((f) => !f.endsWith('.md')));
  const changed = list(FUNCTIONS_DIR).filter((f) => !f.endsWith('.md') && read(f) !== read(f, BASE_DIR));
  assert.deepEqual(changed, ['config.ts', 'topology.ts']);
});

test('Node lab mirror (integration/torneos-core-contracts/gateway.mjs): loopback same-origin only, exact compare, never a native origin', () => {
  const lab = fs.readFileSync(path.join(REPO_ROOT, 'integration/torneos-core-contracts/gateway.mjs'), 'utf8');
  assert.match(lab, /\(req\.headers\.origin && req\.headers\.origin !== publicOrigin\)\) return json\(res, 403, \{ error: 'origin rejected' \}\)/);
  assert.doesNotMatch(lab, /capacitor:|https:\/\/localhost|access-control-allow-origin/i);
});
