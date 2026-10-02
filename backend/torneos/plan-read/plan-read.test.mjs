import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv, BASE } from '../infra/torneos-competition-v1/test-support.mjs';
import * as G from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { mintBridgeToken } from '../infra/torneos-gateway-auth/bridge-probe.mjs';
import { runtime } from '../../../scripts/torneos-frontend/sandbox.mjs';

// Approved UX baseline 33eee168 is not on origin. Its gateway entrypoint and Torneos baseline SQL are the very
// same blobs as origin/main at the integration base, so the baseline is read from there and pinned by blob id.
const UX_BASELINE = {
  commit: '4a8c5bbe62fc340df9308b3e3b773a98d75b6cd1',
  blobs: {
    'backend/torneos/supabase/functions/torneos-gateway/index.ts': '6abec1b1b6519dd6b7b0ac5c0f1501f003667c62',
    'backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql': 'c9ceb50800bbd0cff113db461a25423781daa661',
  },
};
function uxBaseline(file) {
  const ref = `${UX_BASELINE.commit}:${file}`;
  assert.equal(execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim(), UX_BASELINE.blobs[file], `UX baseline blob ${file}`);
  return execFileSync('git', ['show', ref], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

const ORG = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const FN = 'backend/torneos/supabase/functions/torneos-gateway/';
const SRC = 'src/features/torneos/';
const rt = runtime({ modules: { uuid: { v4: () => TOURNAMENT } } });
const fixture = rt.load('src/testUtils/tournamentEntitlementsFixture.js').tournamentEntitlementsFixture;
const normalize = rt.load(SRC + 'domain/entitlements.js').normalizeTournamentEntitlements;
const world = { identity: true, core: true, denyScope: false, rest: [], sql: [], plan: 'FREE' };
globalThis.__planReadWorld = world;
const stub = `export default function postgres() { return { begin: async (fn) => fn({ unsafe: async (q, params) => {
  globalThis.__planReadWorld.sql.push(q);
  if (q.startsWith('SELECT id FROM public.torneos_identity')) return globalThis.__planReadWorld.identity ? [{ id: params[0] }] : [];
  if (q.startsWith('SET LOCAL ')) return [];
  throw new Error('Unexpected SQL (writes forbidden)');
} }), end: async () => {} }; }`;
let fx, tree, gateway, originalFetch;
test.before(async () => {
  fx = fixtureEnv();
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === G.GATEWAY_TOPOLOGY.coreAuthUrl + '/health') return new Response('{}', { status: 200 });
    if (u === G.GATEWAY_TOPOLOGY.coreContractUrl + '/v1/session') return new Response(
      world.core ? JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }) : '{}', { status: world.core ? 200 : 503 });
    if (u.startsWith(G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/')) {
      world.rest.push({ u, init });
      assert.match(init.headers.authorization, /^Bearer /);
      if (world.denyScope) return new Response('{"code":"42501","message":"TORNEOS_ENTITLEMENTS_FORBIDDEN"}', { status: 403 });
      return new Response(JSON.stringify(fixture({ organizationId: ORG, seasonId: SEASON, plan: world.plan })), { status: 200 });
    }
    throw new Error('Unexpected network destination');
  };
  globalThis.Deno = { env: { toObject: () => ({ ...fx.env, TORNEOS_PLAN_READ_MODE: 'on' }) } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
});
test.after(async () => { globalThis.fetch = originalFetch; delete globalThis.Deno; delete globalThis.__planReadWorld; await tree.cleanup(); });
test.beforeEach(() => { Object.assign(world, { identity: true, core: true, denyScope: false, plan: 'FREE', rest: [], sql: [] }); });
function call(path = '/torneos/rest/v1/rpc/get_effective_tournament_season_entitlements', { token = mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid }), params = { p_organization_id: ORG, p_season_id: SEASON } } = {}) {
  return gateway.handle(new Request(BASE + path, { method: 'POST', headers: { host: new URL(BASE).host, origin: G.WEB_ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(params) }));
}
for (const plan of ['FREE', 'PREMIUM']) test(`Billing OFF: real gateway → service → trusted ${plan}, limits/capabilities`, async () => {
  world.plan = plan;
  const service = rt.load(SRC + 'stagingV1/stagingV1WorkspaceService.js').createStagingV1WorkspaceService({ planRead: true, transport: { rpc: async (name, params) => {
    const res = await call('/torneos/rest/v1/rpc/' + name, { params }); assert.equal(res.status, 200); return res.json();
  } } });
  const data = normalize(await service.loadSeasonEntitlements({ organizationId: ORG, seasonId: SEASON }), { organizationId: ORG, seasonId: SEASON });
  assert.equal(data.isTrusted, true); assert.equal(data.plan, plan);
  assert.ok(data.capabilities); assert.ok(data.limits);
  for (const name of ['loadPurchase', 'createCheckout', 'simulateFakePayment', 'cancelPurchase']) assert.equal(service[name], undefined);
  assert.equal(world.rest.length, 1);
  assert.ok(world.sql.every(q => /^(SELECT|SET LOCAL)/.test(q)));
});
test('tournament read uses only the certified RPC', async () => {
  const res = await call('/torneos/rest/v1/rpc/get_effective_tournament_entitlements', { params: { p_organization_id: ORG, p_tournament_id: TOURNAMENT } });
  assert.equal(res.status, 200);
  assert.equal(world.rest.length, 1);
});
test('season B payload never confirms season A', () => {
  assert.equal(normalize(fixture({ seasonId: OTHER, plan: 'PREMIUM' }), { organizationId: ORG, seasonId: SEASON }).isTrusted, false);
});
test('missing bearer rejected before dependencies', async () => { assert.equal((await call(undefined, { token: null })).status, 401); assert.equal(world.rest.length, 0); assert.equal(world.sql.length, 0); });
test('identity mismatch rejected before REST', async () => { world.identity = false; assert.equal((await call()).status, 401); assert.equal(world.rest.length, 0); });
test('Core unavailable fails closed before REST', async () => { world.core = false; const res = await call(); assert.equal(res.status, 503); assert.equal((await res.json()).error, 'CORE_UNAVAILABLE'); assert.equal(world.rest.length, 0); });
for (const params of [{ p_organization_id: OTHER, p_season_id: SEASON }, { p_organization_id: ORG, p_season_id: OTHER }]) test('DB org/season denial passes through unchanged (emulated DB verdict)', async () => {
  world.denyScope = true; const res = await call(undefined, { params }); assert.equal(res.status, 403); assert.equal((await res.json()).message, 'TORNEOS_ENTITLEMENTS_FORBIDDEN');
});
for (const name of ['get_tournament_purchase', 'create_tournament_season_checkout_purchase', 'create_tournament_season_purchase', 'create_fake_tournament_season_purchase', 'grant_tournament_season_premium', 'record_tournament_purchase_preference', 'activate_verified_tournament_purchase', 'activate_verified_fake_tournament_purchase', 'apply_fake_tournament_payment_status', 'apply_tournament_purchase_reversal', 'apply_verified_tournament_payment_status', 'apply_verified_tournament_payment_reversal', 'cancel_tournament_purchase', 'grant_tournament_premium']) test(`${name} stays blocked with plan ON`, async () => {
  assert.equal((await call('/torneos/rest/v1/rpc/' + name)).status, 403); assert.equal(world.rest.length, 0); assert.equal(world.sql.length, 0);
});
test('checkout and payments paths stay OFF', async () => {
  for (const path of ['/commerce/v1/season-checkout', '/internal/v1/season-checkout-preference']) assert.equal((await call(path)).status, 404);
  assert.equal(world.rest.length, 0); assert.equal(world.sql.length, 0);
  const config = (await tree.import('torneos-gateway/commerce.ts')).loadCommerceConfig(fx.env, {});
  assert.equal(config.mode, 'off');
});
test('public route refuses plan RPCs', async () => {
  assert.equal((await call('/torneos/public/v1/rpc/get_effective_tournament_season_entitlements', { token: null })).status, 403);
  assert.equal(world.rest.length, 0);
});
test('strict opt-in: exact allowlist delta, OFF defaults, invalid mode closes boot', async () => {
  const { withPlanRead, PLAN_READ_RPCS } = await tree.import('torneos-gateway/plan-read.ts');
  const base = new Set(['existing']);
  assert.deepEqual([...withPlanRead(base, {})], ['existing']);
  assert.deepEqual([...withPlanRead(base, { TORNEOS_PLAN_READ_MODE: 'off' })], ['existing']);
  assert.deepEqual([...withPlanRead(base, { TORNEOS_PLAN_READ_MODE: 'on' })], ['existing', ...PLAN_READ_RPCS]);
  assert.deepEqual([...base], ['existing']);
  for (const mode of ['true', 'test', 'production', 'ON', 'on ']) assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_PLAN_READ_MODE: mode }));
});
test('frontend read opt-in works in production without billing and strips commercial aliases', async () => {
  const { resolveTorneosPlanRead, resolveTorneosBillingMode } = rt.load(SRC + 'foundation/config.js');
  const backendMode = { mode: 'hybrid', gatewayUrl: BASE };
  const env = { NODE_ENV: 'production', REACT_APP_TORNEOS_PLAN_READ_MODE: 'on' };
  assert.equal(resolveTorneosPlanRead(env, { backendMode }), true);
  assert.equal(resolveTorneosBillingMode(env, { backendMode }).mode, 'off');
  for (const mode of [undefined, 'off', 'true', 'test', 'ON']) assert.equal(resolveTorneosPlanRead({ ...env, REACT_APP_TORNEOS_PLAN_READ_MODE: mode }, { backendMode }), false);
  assert.equal(resolveTorneosPlanRead(env, { backendMode: { mode: 'disabled' } }), false);
  const { withoutCommerce } = rt.load(SRC + 'stagingV1/stagingV1WorkspaceService.js');
  const source = Object.fromEntries(['loadSeasonEntitlements', 'loadEntitlements', 'loadPurchase', 'createCheckout', 'simulateFakePayment', 'cancelPurchase'].map(n => [n, () => {}]));
  assert.deepEqual(Object.keys(withoutCommerce(source, { planRead: true })), ['loadSeasonEntitlements', 'loadEntitlements']);
  const f = rt.load(SRC + 'stagingV1/stagingV1Features.js').stagingV1FeaturesFor('off', { planRead: true });
  assert.equal(f.entitlements, true); assert.equal(f.billing, false);
  const client = rt.load(SRC + 'foundation/torneosClient.js').createTorneosClient({ planRead: true, transport: { rpc: () => { throw Error('unexpected'); }, commerce: () => { throw Error('unexpected'); } } });
  await assert.rejects(client.checkout({}), e => e.code === 'TORNEOS_OUTSIDE_STAGING_V1');
  await assert.rejects(client.execute('get_tournament_purchase'), e => e.code === 'TORNEOS_OUTSIDE_STAGING_V1');
});
test('G1 session/identity authorization code is byte-identical to approved UX baseline', () => {
  const current = fs.readFileSync(FN + 'index.ts', 'utf8');
  const old = uxBaseline(FN + 'index.ts');
  const section = (s, start, end) => s.slice(s.indexOf(start), s.indexOf(end, s.indexOf(start)));
  assert.equal(section(current, 'async function activeSession', 'async function verifiedCore'), section(old, 'async function activeSession', 'async function verifiedCore'));
  assert.equal(section(current, '    const rest =', '    return json(404'), section(old, '    const rest =', '    return json(404'));
});

// Inspect the exact Torneos data-plane baseline, not the old single-project auth.uid() migrations.
test('certified SQL read dependency closure: STABLE, fixed search_path, no writes/dynamic SQL, scoped authorization and unchanged ACL/RLS', () => {
  const file = 'backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql';
  const sql = fs.readFileSync(file, 'utf8');
  assert.equal(sql, uxBaseline(file));
  const functions = new Map();
  for (const m of sql.matchAll(/CREATE FUNCTION ((?:public|private)\.[a-z0-9_]+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)) functions.set(m[1], { full: m[0], body: m[2] });
  const seen = new Set();
  const audit = name => {
    if (seen.has(name)) return;
    seen.add(name);
    const fn = functions.get(name); assert.ok(fn, name);
    assert.match(fn.full, /\bSTABLE\b/, name);
    assert.match(fn.full, /SET search_path (?:TO|=) ''/, name);
    const body = fn.body.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(body, /\b(insert|update|delete|merge|execute|perform|call|nextval|setval)\b/i, name);
    for (const match of body.matchAll(/\b((?:public|private)\.[a-z0-9_]+)\s*\(/g)) audit(match[1]);
  };
  for (const name of ['get_effective_tournament_entitlements', 'get_effective_tournament_season_entitlements']) {
    audit('public.' + name);
    assert.match(functions.get('public.' + name).body, /private\.current_identity_id\(\) is null/);
    assert.match(functions.get('public.' + name).body, /public\.has_tournament_season_access\(/);
    assert.match(sql, new RegExp('REVOKE ALL ON FUNCTION public\\.' + name + '\\([^;]+FROM PUBLIC;'));
    assert.match(sql, new RegExp('GRANT ALL ON FUNCTION public\\.' + name + '\\([^;]+TO authenticated;'));
    assert.doesNotMatch(sql, new RegExp('GRANT [^;]+ON FUNCTION public\\.' + name + '\\([^;]+TO anon;'));
  }
  const access = functions.get('public.has_tournament_season_access').body;
  for (const fragment of ["membership.status = 'active'", "organization.status = 'active'", "membership.role = 'owner'", 'assignment.season_id = p_season_id', 'assignment.membership_id = membership.id']) assert.ok(access.includes(fragment), fragment);
  assert.match(sql, /ALTER TABLE public\.tournament_season_plan_grants ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE POLICY tournament_seasons_select_season_scope[^;]+has_tournament_season_access/);
  assert.match(sql, /CREATE POLICY tournaments_select_season_scope[^;]+has_tournament_season_access/);
  assert.ok(seen.has('private.current_identity_id'));
});

test('Production boot keeps commerce OFF; plan reads add exactly two RPCs and cannot enable Production billing', () => {
  const off = gateway.boot({ ...fx.env, TORNEOS_PLAN_READ_MODE: 'off' });
  const on = gateway.boot({ ...fx.env, TORNEOS_PLAN_READ_MODE: 'on' });
  assert.equal(off.commerce.mode, 'off'); assert.equal(on.commerce.mode, 'off');
  assert.deepEqual([...on.rpcAllowlist].filter(n => !off.rpcAllowlist.has(n)), [
    'get_effective_tournament_season_entitlements', 'get_effective_tournament_entitlements',
  ]);
  assert.equal(off.rpcAllowlist.has('get_effective_tournament_season_entitlements'), false);
  assert.equal(off.rpcAllowlist.has('get_effective_tournament_entitlements'), false);
  assert.equal(on.rpcAllowlist.has('get_tournament_purchase'), false);
  for (const mode of ['test', 'production', 'live']) assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_PLAN_READ_MODE: 'on', TORNEOS_COMMERCE_MODE: mode }));
});
