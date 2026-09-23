// MP-A5 — frontend hybrid commerce (Mercado Pago Checkout Pro TEST, local lab only).
//
//   • feature model: entitlements / plan / billing stay OFF in the staging-v1 map; a TEST overlay turns
//     them on only for billing mode "test" + hybrid + loopback gateway and Core + loopback app + a
//     non-production environment (fail-closed matrix)
//   • transport: `commerce()` is POST /commerce/v1/season-checkout over the certified send() — bridge
//     bearer, no credentials, no-store, redirect error, per-call timeout, one re-exchange on 401, no retry
//     on 403/409/503, business codes preserved
//   • commerce scope: exactly the two MP-A4 reads + the fixed checkout path, equal to the gateway contract
//   • service: loadSeasonEntitlements / loadPurchase / createCheckout exist only with commerce on, send
//     exactly the contract body and fail closed on foreign purchases or malformed answers
//   • Production: no env file, Vercel config or prebuild path can carry billing
//
// Every test runs the REAL src modules in the vm sandbox with a fake fetch; nothing touches the network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read, root } from './audit.mjs';

const FIX = JSON.parse(read('scripts/torneos-frontend/fixtures/gateway-contract.json'));
const prefix = 'src/features/torneos/foundation/';
const ADAPTER = 'src/features/torneos/stagingV1/stagingV1WorkspaceService.js';
const FEATURES = 'src/features/torneos/stagingV1/stagingV1Features.js';
const GATEWAY = 'https://gateway.example.test/torneos-gateway';
const CHECKOUT_PATH = '/commerce/v1/season-checkout';
const ORG = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const OTHER_SEASON = '20000000-0000-4000-8000-000000000002';
const OTHER_ORG = '10000000-0000-4000-8000-000000000002';
const PURCHASE = '50000000-0000-4000-8000-000000000001';
const KEY = '40000000-0000-4000-8000-000000000001';
const uuidStub = { v4: () => KEY };
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

// ---------------------------------------------------------------- the lab configuration the overlay needs
const LAB_ENV = Object.freeze({
  NODE_ENV: 'development',
  REACT_APP_DEPLOY_ENV: 'development',
  REACT_APP_SUPABASE_URL: 'http://127.0.0.1:58422',
  REACT_APP_SUPABASE_ANON_KEY: 'public-placeholder',
  REACT_APP_TORNEOS_GATEWAY_URL: 'http://127.0.0.1:58423',
  REACT_APP_TORNEOS_BILLING_MODE: 'test',
});

function billing(env, appHostname = 'localhost') {
  const { resolveTorneosBillingMode, resolveTorneosBackendMode } = runtime().load(prefix + 'config.js');
  return JSON.parse(JSON.stringify(resolveTorneosBillingMode(env, { backendMode: resolveTorneosBackendMode(env), appHostname })));
}

test('MP-A5 F1 — the staging-v1 map keeps entitlements, plan and billing OFF; the TEST overlay turns exactly those three on', () => {
  const rt = runtime();
  const { stagingV1Features, stagingV1BillingTestOverlay, stagingV1FeaturesFor, legacyFeatures } = rt.load(FEATURES);
  for (const key of ['entitlements', 'plan', 'billing', 'plan_legacy_routes']) assert.equal(stagingV1Features[key], false, key);
  same(stagingV1BillingTestOverlay, { entitlements: true, plan: true, billing: true });
  assert.ok(Object.isFrozen(stagingV1BillingTestOverlay));
  same(stagingV1FeaturesFor('off'), stagingV1Features);
  same(stagingV1FeaturesFor({ mode: 'off' }), stagingV1Features);
  for (const bogus of [undefined, null, '', 'live', 'production', 'TEST', { mode: 'live' }, { mode: 'production' }]) {
    same(stagingV1FeaturesFor(bogus), stagingV1Features);
  }
  const overlaid = stagingV1FeaturesFor({ mode: 'test' });
  assert.ok(Object.isFrozen(overlaid));
  same(overlaid, { ...stagingV1Features, entitlements: true, plan: true, billing: true });
  // The legacy redirects of Plan stay off in hybrid, overlay or not.
  assert.equal(overlaid.plan_legacy_routes, false);
  // Legacy composition: everything on, as before (billing and the legacy routes included).
  assert.ok(Object.values(legacyFeatures).every((v) => v === true));
  same(Object.keys(legacyFeatures), Object.keys(stagingV1Features));
});

test('MP-A5 F2 — billing mode matrix: only test + hybrid + loopback gateway/Core/app + non-production environment is ON', () => {
  assert.equal(billing(LAB_ENV).mode, 'test');
  assert.equal(billing({ ...LAB_ENV, REACT_APP_SUPABASE_URL: 'http://localhost:58422', REACT_APP_TORNEOS_GATEWAY_URL: 'http://localhost:58423' }, '127.0.0.1').mode, 'test');
  const off = (env, appHostname = 'localhost') => {
    const result = billing(env, appHostname);
    assert.equal(result.mode, 'off', JSON.stringify(env));
    assert.equal(typeof result.reason, 'string');
    return result.reason;
  };
  // default hybrid (no billing variable) and unset → OFF
  off({ ...LAB_ENV, REACT_APP_TORNEOS_BILLING_MODE: undefined });
  off({ ...LAB_ENV, REACT_APP_TORNEOS_BILLING_MODE: '' });
  off({ ...LAB_ENV, REACT_APP_TORNEOS_BILLING_MODE: '   ' });
  // there is no live / production / anything-else mode
  for (const mode of ['live', 'production', 'prod', 'TEST', 'Test', 'true', '1', 'test ', 'sandbox']) {
    if (mode === 'test ') continue; // trimmed, see below
    off({ ...LAB_ENV, REACT_APP_TORNEOS_BILLING_MODE: mode });
  }
  // legacy-local and disabled compositions never bill
  off({ ...LAB_ENV, REACT_APP_TORNEOS_GATEWAY_URL: '', REACT_APP_TORNEOS_DATA_ENV: 'local' });
  off({ ...LAB_ENV, REACT_APP_TORNEOS_GATEWAY_URL: '' });
  // a public (https) gateway or Core, even with the variable set → OFF
  off({ ...LAB_ENV, REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test/functions/v1/torneos-gateway' });
  off({ ...LAB_ENV, REACT_APP_SUPABASE_URL: 'https://core.example.test' });
  off({ ...LAB_ENV, REACT_APP_TORNEOS_GATEWAY_URL: 'https://127.0.0.1.example.test' });
  // Production ref anywhere in the targets → OFF (hostname or path)
  const ref = 'abcdefghijklmnopqrst';
  off({ ...LAB_ENV, REACT_APP_PRODUCTION_PROJECT_REF: ref, REACT_APP_TORNEOS_GATEWAY_URL: `https://${ref}.supabase.co/functions/v1/torneos-gateway` });
  off({ ...LAB_ENV, REACT_APP_PRODUCTION_PROJECT_REF: ref, REACT_APP_TORNEOS_GATEWAY_URL: `http://127.0.0.1:58423/${ref}` });
  off({ ...LAB_ENV, REACT_APP_PRODUCTION_PROJECT_REF: ref, REACT_APP_SUPABASE_URL: `http://127.0.0.1:58422/${ref}` });
  // Production environment / build → OFF
  off({ ...LAB_ENV, REACT_APP_DEPLOY_ENV: 'production' });
  off({ ...LAB_ENV, REACT_APP_DEPLOY_ENV: 'preview' });
  off({ ...LAB_ENV, REACT_APP_DEPLOY_ENV: undefined });
  off({ ...LAB_ENV, NODE_ENV: 'production' });
  off({ ...LAB_ENV, REACT_APP_TORNEOS_PRODUCTION_ENABLED: 'true' });
  // the app itself must be served from loopback
  off(LAB_ENV, 'app.arma2.example.test');
  off(LAB_ENV, null);
  off(LAB_ENV, '');
  // exact value, surrounding whitespace tolerated (env files)
  assert.equal(billing({ ...LAB_ENV, REACT_APP_TORNEOS_BILLING_MODE: ' test ' }).mode, 'test');
});

test('MP-A5 F3 — Production can never carry billing: env files, Vercel config and the prebuild', async () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const productionFiles = tracked.filter((f) => /(^|\/)\.env\.production/.test(f) || /(^|\/)vercel\.json$/.test(f));
  for (const file of productionFiles) {
    const text = read(file);
    assert.doesNotMatch(text, /TORNEOS_BILLING_MODE|MERCADO_PAGO|TORNEOS_COMMERCE_MODE|TORNEOS_PAYMENTS_/, file);
  }
  // Untracked local Production env files (never committed) are checked too when present.
  for (const entry of fs.readdirSync(root).filter((f) => /^\.env\.production/.test(f))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, entry), 'utf8'), /TORNEOS_BILLING_MODE|MERCADO_PAGO/, entry);
  }
  const { validateTorneosBillingMode } = await import('../validate-build-env.mjs');
  assert.equal(validateTorneosBillingMode({}), null);
  assert.equal(validateTorneosBillingMode({ REACT_APP_TORNEOS_BILLING_MODE: '' }), null);
  for (const mode of ['test', 'live', 'production']) {
    assert.match(String(validateTorneosBillingMode({ REACT_APP_TORNEOS_BILLING_MODE: mode })), /REACT_APP_TORNEOS_BILLING_MODE/);
  }
});

test('MP-A5 F4 — no Mercado Pago secret or payments configuration is readable by the frontend', () => {
  const offenders = [];
  const sources = execFileSync('git', ['ls-files', 'src', 'public', 'scripts/validate-build-env.mjs'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  for (const file of sources) {
    if (!/\.(m?js|jsx|ts|tsx|html|json)$/.test(file) || /__tests__|\.test\./.test(file)) continue;
    const text = read(file);
    if (/REACT_APP_[A-Z_]*(MERCADO|MP_|ACCESS_TOKEN|WEBHOOK|PAYMENTS_INTERNAL|SELLER|CLIENT_SECRET)/.test(text)) offenders.push(file);
    if (/TEST-[0-9a-f]{24}|APP_USR-/.test(text)) offenders.push(`${file} (MP token shape)`);
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------- commerce scope ↔ MP-A4 gateway contract
test('MP-A5 S1 — the frontend commerce scope is exactly the MP-A4 gateway contract: 2 reads + the fixed checkout path', () => {
  const rt = runtime();
  const scope = rt.load(prefix + 'stagingV1CommerceScope.js');
  const allowlist = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/commerce-test-rpc-allowlist.json'));
  const gateway = read('backend/torneos/supabase/functions/torneos-gateway/commerce.ts');
  same([...scope.STAGING_V1_COMMERCE_READS].sort(), [...allowlist.rpcs].sort());
  assert.equal(scope.STAGING_V1_COMMERCE_READS.length, 2);
  assert.equal(scope.SEASON_CHECKOUT_PATH, CHECKOUT_PATH);
  assert.equal(gateway.match(/export const COMMERCE_ROUTE = "([^"]+)"/)[1], scope.SEASON_CHECKOUT_PATH);
  same([...scope.STAGING_V1_COMMERCE_READS].sort(), JSON.parse(gateway.match(/EXPECTED_COMMERCE_RPCS: readonly string\[\] = Object\.freeze\((\[[^\]]+\])\)/)[1]).sort());
  assert.ok(Object.isFrozen(scope.STAGING_V1_COMMERCE_READS));
  for (const name of scope.STAGING_V1_COMMERCE_READS) assert.equal(scope.isStagingV1CommerceRead(name), true);
  for (const name of ['create_tournament_season_checkout_purchase', 'get_effective_tournament_entitlements', 'create_tournament_season_purchase', 'get_tournament_workspace_context', '__proto__', '', null]) {
    assert.equal(scope.isStagingV1CommerceRead(name), false, String(name));
  }
  // The staging-v1 scope of 43 is untouched and disjoint from commerce.
  const { stagingV1Scope } = rt.load(prefix + 'stagingV1Scope.js');
  const base = Object.values(stagingV1Scope).flat();
  assert.equal(base.length, 43);
  same(JSON.parse(JSON.stringify(stagingV1Scope)), JSON.parse(read('backend/torneos/phase2d/staging-v1-rpc-allowlist.json')).features);
  assert.ok(scope.STAGING_V1_COMMERCE_READS.every((name) => !base.includes(name)));
});

test('MP-A5 S2 — the client reaches the commerce reads and the checkout only when built with commerce; nothing else widens', async () => {
  const rt = runtime();
  const { createTorneosClient } = rt.load(prefix + 'torneosClient.js');
  const calls = [];
  const transport = {
    rpc: async (name, params) => { calls.push(['rpc', name, params]); return null; },
    select: async () => [],
    commerce: async (p, body, options) => { calls.push(['commerce', p, body, options]); return { ok: true }; },
  };
  const plain = createTorneosClient({ transport });
  await assert.rejects(plain.execute('get_tournament_purchase', { p_purchase_id: PURCHASE }), { code: 'TORNEOS_OUTSIDE_STAGING_V1' });
  await assert.rejects(plain.execute('get_effective_tournament_season_entitlements', {}), { code: 'TORNEOS_OUTSIDE_STAGING_V1' });
  await assert.rejects(plain.checkout({ organizationId: ORG }), { code: 'TORNEOS_OUTSIDE_STAGING_V1' });
  assert.deepEqual(calls, []);
  const commerce = createTorneosClient({ transport, commerce: true });
  await commerce.execute('get_tournament_purchase', { p_purchase_id: PURCHASE });
  await commerce.execute('get_effective_tournament_season_entitlements', { p_organization_id: ORG, p_season_id: SEASON });
  await commerce.checkout({ organizationId: ORG, seasonId: SEASON, idempotencyKey: KEY }, { timeoutMs: 1234 });
  for (const name of ['create_tournament_season_checkout_purchase', 'get_effective_tournament_entitlements', 'create_tournament_season_purchase', 'simulate_fake_tournament_payment']) {
    await assert.rejects(commerce.execute(name, {}), { code: 'TORNEOS_OUTSIDE_STAGING_V1' }, name);
  }
  same(calls, [
    ['rpc', 'get_tournament_purchase', { p_purchase_id: PURCHASE }],
    ['rpc', 'get_effective_tournament_season_entitlements', { p_organization_id: ORG, p_season_id: SEASON }],
    ['commerce', CHECKOUT_PATH, { organizationId: ORG, seasonId: SEASON, idempotencyKey: KEY }, { timeoutMs: 1234 }],
  ]);
  // A transport without the commerce channel is not connected for checkout.
  const legacyTransport = createTorneosClient({ transport: { rpc: async () => null, select: async () => [] }, commerce: true });
  await assert.rejects(legacyTransport.checkout({}), { code: 'TORNEOS_TRANSPORT_NOT_CONNECTED' });
});

// ---------------------------------------------------------------- transport
function response({ status, body, headers = {} }) {
  const all = { ...FIX.headers, ...headers };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => all[name.toLowerCase()] ?? null, has: (name) => name.toLowerCase() in all },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}
function harness(script, { timeoutMs = 10_000 } = {}) {
  const rt = runtime();
  const mod = rt.load(prefix + 'torneosTransport.js');
  const calls = [];
  const queue = { exchange: [...(script.exchange || [])], rest: [...(script.rest || [])] };
  const fetchImpl = async (url, init = {}) => {
    const route = url.endsWith('/exchange') ? 'exchange' : 'rest';
    calls.push({ url, init, body: init.body, headers: init.headers });
    const next = queue[route].shift();
    if (!next) throw new Error(`unscripted ${route} call`);
    if (typeof next.hang === 'number') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, next.hang);
        init.signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
      });
    }
    return response(next);
  };
  const transport = mod.createTorneosTransport({
    gatewayUrl: GATEWAY, getCoreAccessToken: async () => 'core-token-a', fetchImpl, requestTimeoutMs: timeoutMs,
  });
  return { mod, transport, calls, exchanges: () => calls.filter((c) => c.url.endsWith('/exchange')), rest: () => calls.filter((c) => !c.url.endsWith('/exchange')) };
}
const BODY = Object.freeze({ organizationId: ORG, seasonId: SEASON, idempotencyKey: KEY });
const CHECKOUT_OK = { status: 200, body: {
  purchase: { id: PURCHASE, organizationId: ORG, seasonId: SEASON, status: 'created', provider: 'MERCADO_PAGO', providerEnvironment: 'test', amount: 39900, currency: 'ARS' },
  preference: { provider: 'MERCADO_PAGO', preferenceId: 'pref-1', checkoutUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1', expiresAt: '2026-09-24T00:00:00Z' },
} };

test('MP-A5 T1 — commerce(): POST to the fixed path with the bridge bearer, exact JSON body, no credentials, no-store, redirect error', async () => {
  const h = harness({ exchange: [FIX.exchange.ok], rest: [CHECKOUT_OK] });
  const json = await h.transport.commerce(CHECKOUT_PATH, BODY);
  same(json, CHECKOUT_OK.body);
  assert.equal(h.exchanges().length, 1);
  const [call] = h.rest();
  assert.equal(call.url, `${GATEWAY}${CHECKOUT_PATH}`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.headers.Authorization, `Bearer ${FIX.exchange.ok.body.access_token}`);
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.equal(call.body, JSON.stringify(BODY));
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.cache, 'no-store');
  assert.equal(call.init.redirect, 'error');
  assert.ok(!call.url.includes('?'));
  assert.equal(h.mod.COMMERCE_REQUEST_TIMEOUT_MS > h.mod.DEFAULT_REQUEST_TIMEOUT_MS, true, 'checkout outlives gateway REST 4 s + payments 8 s');
});

test('MP-A5 T2 — commerce() refuses any other path, method-less or non-object body before the network', async () => {
  const h = harness({ exchange: [], rest: [] });
  for (const bad of ['/commerce/v1/season-checkout/', '/commerce/v1/other', '/commerce/v1/season-checkout?x=1', '/torneos/rest/v1/rpc/create_tournament_season_checkout_purchase',
    'https://evil.example.test/commerce/v1/season-checkout', '//evil.example.test/commerce/v1/season-checkout', '/exchange', '', null, undefined, {}]) {
    await assert.rejects(h.transport.commerce(bad, BODY), { code: 'TORNEOS_INVALID_REQUEST' }, String(bad));
  }
  for (const body of [null, undefined, [], 'x', 42]) {
    await assert.rejects(h.transport.commerce(CHECKOUT_PATH, body), { code: 'TORNEOS_INVALID_REQUEST' });
  }
  for (const timeoutMs of [0, -1, 1.5, 'x', 120_001]) {
    await assert.rejects(h.transport.commerce(CHECKOUT_PATH, BODY, { timeoutMs }), { code: 'TORNEOS_INVALID_REQUEST' });
  }
  assert.equal(h.calls.length, 0);
  // No generic commerce channel: the transport exposes exactly rpc/select/commerce + lifecycle.
  same(Object.keys(h.transport).sort(), ['clear', 'commerce', 'dispose', 'rpc', 'select', 'status'].sort());
});

test('MP-A5 T3 — per-call timeout: the checkout uses its own deadline, not the RPC default', async () => {
  const h = harness({ exchange: [FIX.exchange.ok], rest: [{ ...CHECKOUT_OK, hang: 150 }] }, { timeoutMs: 50 });
  const json = await h.transport.commerce(CHECKOUT_PATH, BODY, { timeoutMs: 1000 });
  same(json, CHECKOUT_OK.body);
  const late = harness({ exchange: [FIX.exchange.ok], rest: [{ ...CHECKOUT_OK, hang: 500 }] });
  await assert.rejects(late.transport.commerce(CHECKOUT_PATH, BODY, { timeoutMs: 60 }), { code: 'TORNEOS_UNAVAILABLE' });
  assert.equal(late.rest().length, 1, 'a timed-out checkout is never retried automatically');
});

test('MP-A5 T4 — 401 renews the bridge once and repeats once; a second 401 is terminal', async () => {
  const once = harness({ exchange: [FIX.exchange.ok, FIX.exchange.okRenewed], rest: [FIX.rpc.bearerInvalid, CHECKOUT_OK] });
  same(await once.transport.commerce(CHECKOUT_PATH, BODY), CHECKOUT_OK.body);
  assert.equal(once.exchanges().length, 2);
  assert.equal(once.rest().length, 2);
  assert.equal(once.rest()[1].headers.Authorization, `Bearer ${FIX.exchange.okRenewed.body.access_token}`);
  assert.equal(once.rest()[1].body, JSON.stringify(BODY), 'the repeat carries the same idempotency key');
  const twice = harness({ exchange: [FIX.exchange.ok, FIX.exchange.okRenewed], rest: [FIX.rpc.bearerInvalid, FIX.rpc.bearerInvalid] });
  await assert.rejects(twice.transport.commerce(CHECKOUT_PATH, BODY), { code: 'TORNEOS_SESSION_INVALID', status: 401 });
  assert.equal(twice.exchanges().length, 2);
  assert.equal(twice.rest().length, 2);
});

test('MP-A5 T5 — 400/403/409/413/502/503 are single attempts; business and dependency codes are preserved', async () => {
  const cases = [
    [{ status: 400, body: { error: 'TORNEOS_CHECKOUT_INVALID' } }, 'TORNEOS_RPC_ERROR', 400, 'TORNEOS_CHECKOUT_INVALID'],
    [{ status: 403, body: { error: 'TORNEOS_BILLING_FORBIDDEN' } }, 'TORNEOS_RPC_ERROR', 403, 'TORNEOS_BILLING_FORBIDDEN'],
    [{ status: 403, body: { error: 'rpc not enabled' } }, 'TORNEOS_FORBIDDEN', 403, 'rpc not enabled'],
    [{ status: 409, body: { error: 'TORNEOS_SEASON_ALREADY_PREMIUM' } }, 'TORNEOS_RPC_ERROR', 409, 'TORNEOS_SEASON_ALREADY_PREMIUM'],
    [{ status: 409, body: { error: 'TORNEOS_SEASON_PREMIUM_SUSPENDED' } }, 'TORNEOS_RPC_ERROR', 409, 'TORNEOS_SEASON_PREMIUM_SUSPENDED'],
    [{ status: 409, body: { error: 'TORNEOS_CHECKOUT_EXPIRED' } }, 'TORNEOS_RPC_ERROR', 409, 'TORNEOS_CHECKOUT_EXPIRED'],
    [{ status: 409, body: { error: 'TORNEOS_PREFERENCE_CONFLICT' } }, 'TORNEOS_RPC_ERROR', 409, 'TORNEOS_PREFERENCE_CONFLICT'],
    [{ status: 413, body: { error: 'TORNEOS_CHECKOUT_TOO_LARGE' } }, 'TORNEOS_RPC_ERROR', 413, 'TORNEOS_CHECKOUT_TOO_LARGE'],
    [{ status: 502, body: { error: 'TORNEOS_CHECKOUT_FAILED' } }, 'TORNEOS_UNAVAILABLE', 502, 'TORNEOS_CHECKOUT_FAILED'],
    [{ status: 503, body: { error: 'TORNEOS_PAYMENTS_UNAVAILABLE' } }, 'TORNEOS_UNAVAILABLE', 503, 'TORNEOS_PAYMENTS_UNAVAILABLE'],
    [{ status: 503, body: { error: 'TORNEOS_UNAVAILABLE' } }, 'TORNEOS_UNAVAILABLE', 503, 'TORNEOS_UNAVAILABLE'],
    [{ status: 503, body: { error: 'CORE_UNAVAILABLE' } }, 'CORE_UNAVAILABLE', 503, 'CORE_UNAVAILABLE'],
  ];
  for (const [reply, code, status, gatewayError] of cases) {
    const h = harness({ exchange: [FIX.exchange.ok], rest: [reply] });
    await assert.rejects(h.transport.commerce(CHECKOUT_PATH, BODY), (error) => {
      assert.equal(error.code, code, JSON.stringify(reply));
      assert.equal(error.status, status);
      assert.equal(error.gatewayError, gatewayError);
      return true;
    });
    assert.equal(h.rest().length, 1, `${status} ${gatewayError} is not retried`);
    assert.equal(h.exchanges().length, 1);
  }
});

test('MP-A5 T6 — the RPC/table semantics of send() are unchanged by the commerce channel', async () => {
  const h = harness({ exchange: [FIX.exchange.ok], rest: [FIX.rpc.ok, FIX.table.members, CHECKOUT_OK] });
  same(await h.transport.rpc('get_tournament_workspace_context', {}), FIX.rpc.ok.body);
  same(await h.transport.select('tournament_organization_members', { select: 'id' }), FIX.table.members.body);
  await h.transport.commerce(CHECKOUT_PATH, BODY);
  assert.equal(h.exchanges().length, 1, 'one bridge bearer serves RPC, table and commerce');
  assert.deepEqual(h.rest().map((c) => [c.init.method, c.url.replace(GATEWAY, '')]), [
    ['POST', '/torneos/rest/v1/rpc/get_tournament_workspace_context'],
    ['GET', '/torneos/rest/v1/tournament_organization_members?select=id'],
    ['POST', CHECKOUT_PATH],
  ]);
});

// ---------------------------------------------------------------- staging-v1 service (commerce on)
function recordingTransport(reply = () => null) {
  const calls = [];
  return {
    calls,
    transport: {
      rpc: async (name, params) => { calls.push({ kind: 'rpc', name, params }); return reply('rpc', name, params); },
      select: async (table, query) => { calls.push({ kind: 'select', table, query }); return []; },
      commerce: async (p, body, options) => { calls.push({ kind: 'commerce', path: p, body, options }); return reply('commerce', p, body); },
      clear() {}, dispose() {},
    },
  };
}
function loadService(transport, options = {}) {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const mod = rt.load(ADAPTER);
  return { rt, mod, service: mod.createStagingV1WorkspaceService({ transport, ...options }) };
}
const purchase = (overrides = {}) => ({ schemaVersion: 3, id: PURCHASE, organizationId: ORG, seasonId: SEASON, tournamentId: null, status: 'pending',
  amount: 39900, listAmount: 49900, currency: 'ARS', provider: 'MERCADO_PAGO', providerEnvironment: 'test', ...overrides });

test('MP-A5 V1 — without commerce the hybrid service has no commerce method at all (0 commerce requests possible)', () => {
  const { transport, calls } = recordingTransport();
  const { service } = loadService(transport);
  for (const name of ['loadSeasonEntitlements', 'loadPurchase', 'createCheckout', 'loadEntitlements', 'simulateFakePayment', 'cancelPurchase']) {
    assert.equal(service[name], undefined, name);
  }
  assert.equal(calls.length, 0);
});

test('MP-A5 V2 — loadSeasonEntitlements uses exactly get_effective_tournament_season_entitlements', async () => {
  const payload = { schemaVersion: 4, plan: 'FREE' };
  const { transport, calls } = recordingTransport(() => payload);
  const { service } = loadService(transport, { commerce: true });
  same(await service.loadSeasonEntitlements({ organizationId: ORG, seasonId: SEASON }), payload);
  same(calls, [{ kind: 'rpc', name: 'get_effective_tournament_season_entitlements', params: { p_organization_id: ORG, p_season_id: SEASON } }]);
  await assert.rejects(service.loadSeasonEntitlements({ organizationId: 'x', seasonId: SEASON }), { code: 'TORNEOS_INVALID_REQUEST' });
  await assert.rejects(service.loadSeasonEntitlements({ organizationId: ORG, seasonId: null }), { code: 'TORNEOS_INVALID_REQUEST' });
  assert.equal(calls.length, 1);
});

test('MP-A5 V3 — loadPurchase reads get_tournament_purchase and fails closed on another org, season or purchase', async () => {
  let answer = purchase();
  const { transport, calls } = recordingTransport(() => answer);
  const { service } = loadService(transport, { commerce: true });
  same(await service.loadPurchase({ purchaseId: PURCHASE, organizationId: ORG, seasonId: SEASON, tournamentId: undefined }), purchase());
  same(calls[0], { kind: 'rpc', name: 'get_tournament_purchase', params: { p_purchase_id: PURCHASE } });
  for (const foreign of [purchase({ organizationId: OTHER_ORG }), purchase({ seasonId: OTHER_SEASON }), purchase({ id: KEY }), null, 'x', []]) {
    answer = foreign;
    await assert.rejects(service.loadPurchase({ purchaseId: PURCHASE, organizationId: ORG, seasonId: SEASON }), { code: 'TORNEOS_PURCHASE_FORBIDDEN' }, JSON.stringify(foreign));
  }
  const before = calls.length;
  for (const input of [{ purchaseId: 'nope', organizationId: ORG, seasonId: SEASON }, { purchaseId: PURCHASE, organizationId: ORG }, { purchaseId: PURCHASE, organizationId: 'x', seasonId: SEASON }]) {
    await assert.rejects(service.loadPurchase(input), { code: 'TORNEOS_INVALID_REQUEST' });
  }
  assert.equal(calls.length, before, 'invalid input never reaches the transport');
});

test('MP-A5 V4 — createCheckout sends exactly {organizationId, seasonId, idempotencyKey}; never price, provider, currency or environment', async () => {
  const { transport, calls } = recordingTransport(() => CHECKOUT_OK.body);
  const { service, mod } = loadService(transport, { commerce: true });
  const result = await service.createCheckout({
    organizationId: ORG, seasonId: SEASON, idempotencyKey: KEY,
    amount: 1, price: 1, provider: 'FAKE', currency: 'USD', environment: 'production', providerEnvironment: 'live', checkoutUrl: 'x', tournamentId: 'y',
  });
  same(result, CHECKOUT_OK.body);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'commerce');
  assert.equal(calls[0].path, CHECKOUT_PATH);
  same(calls[0].body, { organizationId: ORG, seasonId: SEASON, idempotencyKey: KEY });
  assert.deepEqual(Object.keys(calls[0].body), ['organizationId', 'seasonId', 'idempotencyKey']);
  assert.equal(calls[0].options.timeoutMs, mod.CHECKOUT_TIMEOUT_MS);
  // The key is the caller's: never generated or replaced here.
  for (const idempotencyKey of [undefined, '', 'not-a-uuid']) {
    await assert.rejects(service.createCheckout({ organizationId: ORG, seasonId: SEASON, idempotencyKey }), { code: 'TORNEOS_INVALID_REQUEST' });
  }
  assert.equal(calls.length, 1);
});

test('MP-A5 V5 — createCheckout validates the answer: stale purchase + valid preference is OK; foreign or malformed answers fail closed', async () => {
  let answer;
  const { transport } = recordingTransport(() => answer);
  const { service } = loadService(transport, { commerce: true });
  // G1: the purchase snapshot says `created` while the preference is already valid → accepted as is.
  answer = CHECKOUT_OK.body;
  same(await service.createCheckout(BODY), CHECKOUT_OK.body);
  // Not open (pending / approved / …) → preference null is a valid answer.
  answer = { purchase: purchase({ status: 'pending' }), preference: null };
  same(await service.createCheckout(BODY), answer);
  for (const bad of [
    null, {}, { purchase: null, preference: null },
    { purchase: purchase({ organizationId: OTHER_ORG }), preference: null },
    { purchase: purchase({ seasonId: OTHER_SEASON }), preference: null },
    { purchase: purchase({ id: 'x' }), preference: null },
    { purchase: purchase(), preference: { provider: 'FAKE', checkoutUrl: '/x' } },
    { purchase: purchase(), preference: { provider: 'MERCADO_PAGO' } },
    { purchase: purchase(), preference: 'https://www.mercadopago.com.ar/checkout' },
  ]) {
    answer = bad;
    await assert.rejects(service.createCheckout(BODY), { code: 'TORNEOS_CHECKOUT_FAILED' }, JSON.stringify(bad));
  }
});

test('MP-A5 V6 — error mapping: 400 input, 401 session, 403 permission, 409 business (suspended is its own code), 502 contract, 503 unavailable', async () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { createStagingV1WorkspaceService } = rt.load(ADAPTER);
  const { TorneosBoundaryError } = rt.load(prefix + 'errors.js');
  const rpcError = (status, gatewayError) => new TorneosBoundaryError('TORNEOS_RPC_ERROR', { status, gatewayError, rpcError: { message: gatewayError, code: gatewayError, details: null, hint: null } });
  const cases = [
    [rpcError(400, 'TORNEOS_CHECKOUT_INVALID'), 'TORNEOS_CHECKOUT_INVALID'],
    [rpcError(413, 'TORNEOS_CHECKOUT_TOO_LARGE'), 'TORNEOS_CHECKOUT_INVALID'],
    [new TorneosBoundaryError('TORNEOS_SESSION_INVALID', { status: 401 }), 'TORNEOS_AUTH_REQUIRED'],
    [rpcError(403, 'TORNEOS_BILLING_FORBIDDEN'), 'TORNEOS_BILLING_FORBIDDEN'],
    [rpcError(403, 'TORNEOS_PURCHASE_FORBIDDEN'), 'TORNEOS_PURCHASE_FORBIDDEN'],
    [new TorneosBoundaryError('TORNEOS_FORBIDDEN', { status: 403, gatewayError: 'rpc not enabled' }), 'TORNEOS_FORBIDDEN'],
    [rpcError(409, 'TORNEOS_SEASON_ALREADY_PREMIUM'), 'TORNEOS_SEASON_ALREADY_PREMIUM'],
    [rpcError(409, 'TORNEOS_SEASON_PREMIUM_SUSPENDED'), 'TORNEOS_SEASON_PREMIUM_SUSPENDED'],
    [rpcError(409, 'TORNEOS_IDEMPOTENCY_CONFLICT'), 'TORNEOS_IDEMPOTENCY_CONFLICT'],
    [rpcError(409, 'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT'), 'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT'],
    [rpcError(409, 'TORNEOS_PREFERENCE_CONFLICT'), 'TORNEOS_PREFERENCE_CONFLICT'],
    [rpcError(409, 'TORNEOS_CHECKOUT_EXPIRED'), 'TORNEOS_CHECKOUT_EXPIRED'],
    [rpcError(409, 'TORNEOS_PURCHASE_NOT_PAYABLE'), 'TORNEOS_PURCHASE_NOT_PAYABLE'],
    [rpcError(409, 'TORNEOS_PRODUCT_UNAVAILABLE'), 'TORNEOS_PRODUCT_UNAVAILABLE'],
    [rpcError(409, 'TORNEOS_OFFER_UNAVAILABLE'), 'TORNEOS_OFFER_UNAVAILABLE'],
    [new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: 502, gatewayError: 'TORNEOS_CHECKOUT_FAILED' }), 'TORNEOS_CHECKOUT_FAILED'],
    [new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: 503, gatewayError: 'TORNEOS_PAYMENTS_UNAVAILABLE' }), 'TORNEOS_PAYMENTS_UNAVAILABLE'],
    [new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: 503, gatewayError: 'TORNEOS_UNAVAILABLE' }), 'TORNEOS_UNAVAILABLE'],
    [new TorneosBoundaryError('CORE_UNAVAILABLE', { status: 503, gatewayError: 'CORE_UNAVAILABLE' }), 'CORE_UNAVAILABLE'],
  ];
  const messages = new Set();
  for (const [thrown, code] of cases) {
    const service = createStagingV1WorkspaceService({ commerce: true, transport: {
      rpc: async () => { throw thrown; }, select: async () => [], commerce: async () => { throw thrown; }, clear() {}, dispose() {},
    } });
    await assert.rejects(service.createCheckout(BODY), (error) => {
      assert.equal(error.name, 'TournamentWorkspaceError');
      assert.equal(error.code, code, `${thrown.code} ${thrown.status} ${thrown.gatewayError}`);
      assert.equal(typeof error.message, 'string');
      assert.ok(error.message.length > 10);
      assert.doesNotMatch(error.message, /TORNEOS_|MERCADO|preference|gateway|\b50\d\b/i, 'user copy carries no internal codes');
      messages.add(`${code}:${error.message}`);
      return true;
    });
  }
  const suspended = [...messages].find((m) => m.startsWith('TORNEOS_SEASON_PREMIUM_SUSPENDED:'));
  assert.match(suspended, /suspendid/i);
  assert.match(suspended, /contracargo|disputa/i);
});

// ---------------------------------------------------------------- static guards (pages + routing)
test('MP-A5 G1 — Plan and PurchaseStatus import neither the legacy service nor a Supabase client: commerce comes from the injected context', async () => {
  const { inspect } = await import('./audit.mjs');
  for (const page of ['src/features/torneos/components/PlanExperiencePage.jsx', 'src/features/torneos/components/PurchaseStatusPage.jsx']) {
    const sources = inspect(page, read(page)).imports.map((entry) => entry.source);
    for (const forbidden of [/api\/tournamentWorkspaceService$/, /supabase/i, /coreSupabaseClient/, /lib\/supabaseClient/, /\/foundation\//]) {
      assert.ok(!sources.some((s) => forbidden.test(s)), `${page} imports ${forbidden}`);
    }
    assert.ok(sources.includes('../context/TorneosCommerceContext'), `${page} uses the commerce context`);
    assert.doesNotMatch(read(page), /\b39900\b|\b49900\b|39\.900|49\.900/, `${page} hardcodes a price`);
  }
  // The legacy service is reachable only through the legacy adapter, which the hybrid provider replaces.
  const context = read('src/features/torneos/context/TorneosCommerceContext.jsx');
  assert.match(context, /createContext\(legacyCommerce\)/);
  const app = read('src/features/torneos/stagingV1/StagingV1TorneosApp.jsx');
  assert.match(app, /<TorneosCommerceProvider commerce=/);
  assert.doesNotMatch(app, /legacyCommerce|tournamentWorkspaceService/);
});

test('MP-A5 G2 — routing: season plan + purchase status are gated by `plan`; every legacy Plan route stays behind `plan_legacy_routes`', () => {
  const shell = read('src/features/torneos/components/TorneosShell.jsx');
  const routes = [...shell.matchAll(/<Route\s+path="([^"]+)"\s+element=\{gate\('([a-z_]+)',\s*<([A-Za-z]+)/g)].map((m) => [m[1], m[2], m[3]]);
  const planRoutes = routes.filter(([, , element]) => /Plan|Purchase/.test(element));
  same(planRoutes.filter(([, feature]) => feature === 'plan'), [
    ['temporada/:seasonId/plan', 'plan', 'PlanExperiencePage'],
    ['temporada/:seasonId/plan/compra/:purchaseId/exito', 'plan', 'PurchaseStatusPage'],
    ['temporada/:seasonId/plan/compra/:purchaseId/pendiente', 'plan', 'PurchaseStatusPage'],
    ['temporada/:seasonId/plan/compra/:purchaseId/fallo', 'plan', 'PurchaseStatusPage'],
  ]);
  same(planRoutes.filter(([, feature]) => feature !== 'plan').map(([p, feature]) => [p, feature]), [
    ['plan', 'plan_legacy_routes'],
    ['plan/compra/:purchaseId/exito', 'plan_legacy_routes'],
    ['plan/compra/:purchaseId/pendiente', 'plan_legacy_routes'],
    ['plan/compra/:purchaseId/fallo', 'plan_legacy_routes'],
    ['configuracion/plan', 'plan_legacy_routes'],
  ]);
});
