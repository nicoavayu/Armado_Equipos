// SOCIAL-V1 gateway contract, against the real gateway source (loaded like plan-read.test.mjs: real index.ts, stubbed
// Postgres, emulated Core and PostgREST). Never touches a network or a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv, BASE } from '../infra/torneos-competition-v1/test-support.mjs';
import * as G from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { mintBridgeToken } from '../infra/torneos-gateway-auth/bridge-probe.mjs';
import { runtime } from '../../../scripts/torneos-frontend/sandbox.mjs';

const ORG = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const CATEGORY = '40000000-0000-4000-8000-000000000001';
const PHASE = '50000000-0000-4000-8000-000000000001';
const FN = 'backend/torneos/supabase/functions/torneos-gateway/';
const SRC = 'src/features/torneos/';
const CONTRACT = JSON.parse(fs.readFileSync('backend/torneos/social-v1/contract.json', 'utf8'));
const SOCIAL = ['get_tournament_social_studio_context', 'get_tournament_social_snapshot', 'authorize_tournament_social_export'];
const PLAN = ['get_effective_tournament_season_entitlements', 'get_effective_tournament_entitlements'];
const COMMERCIAL = ['get_tournament_purchase', 'create_tournament_season_checkout_purchase', 'create_tournament_season_purchase',
  'create_fake_tournament_season_purchase', 'grant_tournament_season_premium', 'record_tournament_purchase_preference',
  'activate_verified_tournament_purchase', 'activate_verified_fake_tournament_purchase', 'apply_fake_tournament_payment_status',
  'apply_tournament_purchase_reversal', 'apply_verified_tournament_payment_status', 'apply_verified_tournament_payment_reversal',
  'cancel_tournament_purchase', 'grant_tournament_premium'];
const rt = runtime({ modules: { uuid: { v4: () => TOURNAMENT } } });
const fixture = rt.load('src/testUtils/tournamentEntitlementsFixture.js').tournamentEntitlementsFixture;

// What the emulated PostgREST answers. `verdict` emulates the database decision of authorize_tournament_social_export.
const world = { identity: true, core: true, verdict: 'ok', rest: [], sql: [] };
globalThis.__socialWorld = world;
const stub = `export default function postgres() { return { begin: async (fn) => fn({ unsafe: async (q, params) => {
  globalThis.__socialWorld.sql.push(q);
  if (q.startsWith('SELECT id FROM public.torneos_identity')) return globalThis.__socialWorld.identity ? [{ id: params[0] }] : [];
  if (q.startsWith('SET LOCAL ')) return [];
  throw new Error('Unexpected SQL (writes forbidden)');
} }), end: async () => {} }; }`;
const VERDICTS = {
  ok: [200, null],
  premium: [403, { code: '42501', message: 'TORNEOS_SOCIAL_PREMIUM_REQUIRED' }],
  branding: [403, { code: '42501', message: 'TORNEOS_BRANDING_PREMIUM_REQUIRED' }],
  forbidden: [403, { code: '42501', message: 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN' }],
  theme: [400, { code: '22023', message: 'TORNEOS_SOCIAL_THEME_UNKNOWN' }],
};
function restAnswer(name, body) {
  if (name === 'get_tournament_social_studio_context') {
    return [200, { capabilities: ['social.read', 'social.create', 'social.export'], tournaments: [{ id: TOURNAMENT, name: 'Apertura', categories: [] }], freeBaseFamilies: ['round_results', 'standings', 'next_fixture'] }];
  }
  if (name === 'get_tournament_social_snapshot') return [200, { piece: body.p_piece, organizationId: ORG, seasonId: SEASON }];
  if (name === 'authorize_tournament_social_export') {
    const [status, error] = VERDICTS[world.verdict];
    return error ? [status, error] : [200, { authorized: true, piece: body.p_piece, theme: body.p_theme, plan: 'FREE', includeArma2Branding: true }];
  }
  if (PLAN.includes(name)) return [200, fixture({ organizationId: ORG, seasonId: SEASON, plan: 'FREE' })];
  throw new Error(`Unexpected REST rpc ${name}`);
}

let fx, tree, gateway, originalFetch, currentEnv;
test.before(async () => {
  fx = fixtureEnv();
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === G.GATEWAY_TOPOLOGY.coreAuthUrl + '/health') return new Response('{}', { status: 200 });
    if (u === G.GATEWAY_TOPOLOGY.coreContractUrl + '/v1/session') return new Response(
      world.core ? JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }) : '{}', { status: world.core ? 200 : 503 });
    if (u.startsWith(G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/')) {
      const name = u.slice((G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/').length);
      const raw = init.body == null ? '{}' : typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body);
      const body = JSON.parse(raw);
      world.rest.push({ name, body, authorization: init.headers.authorization });
      assert.match(init.headers.authorization, /^Bearer /);
      const [status, payload] = restAnswer(name, body);
      return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected network destination ' + u);
  };
  currentEnv = { ...fx.env, TORNEOS_PLAN_READ_MODE: 'on', TORNEOS_SOCIAL_MODE: 'on' };
  globalThis.Deno = { env: { toObject: () => currentEnv } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
});
test.after(async () => { globalThis.fetch = originalFetch; delete globalThis.Deno; delete globalThis.__socialWorld; await tree.cleanup(); });
test.beforeEach(() => { Object.assign(world, { identity: true, core: true, verdict: 'ok', rest: [], sql: [] }); });

const token = () => mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid });
function request(path, { bearer = token(), params = {}, method = 'POST' } = {}) {
  return new Request(BASE + path, { method, headers: { host: new URL(BASE).host, origin: G.WEB_ORIGIN, 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(params) });
}
const rpc = (name, options) => gateway.handle(request('/torneos/rest/v1/rpc/' + name, options));
const AUTHORIZE = { p_organization_id: ORG, p_tournament_id: TOURNAMENT, p_piece: 'round_results', p_theme: 'base', p_include_arma2_branding: true };

// ── module contract ─────────────────────────────────────────────────────────────────────────────────────────────
test('strict opt-in: absent/""/off keep the allowlist, on adds exactly the 3 RPCs, anything else closes', async () => {
  const { withSocial, SOCIAL_RPCS, SocialConfigError } = await tree.import('torneos-gateway/social.ts');
  const base = new Set(['existing']);
  assert.deepEqual([...withSocial(base, {})], ['existing']);
  assert.deepEqual([...withSocial(base, { TORNEOS_SOCIAL_MODE: '' })], ['existing']);
  assert.deepEqual([...withSocial(base, { TORNEOS_SOCIAL_MODE: 'off' })], ['existing']);
  assert.deepEqual([...withSocial(base, { TORNEOS_SOCIAL_MODE: 'on' })], ['existing', ...SOCIAL]);
  assert.deepEqual([...base], ['existing'], 'the input set is never mutated');
  assert.deepEqual([...SOCIAL_RPCS], SOCIAL);
  for (const mode of ['ON', 'On', 'on ', ' on', 'true', '1', 'yes', 'test', 'production', 'enabled']) {
    assert.throws(() => withSocial(base, { TORNEOS_SOCIAL_MODE: mode }), SocialConfigError, mode);
    assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_SOCIAL_MODE: mode }), SocialConfigError, `boot ${mode}`);
  }
});

test('a tampered allowlist document closes the gateway instead of widening it', async () => {
  const { withSocial, SocialConfigError } = await tree.import('torneos-gateway/social.ts');
  const on = { TORNEOS_SOCIAL_MODE: 'on' };
  const good = JSON.parse(fs.readFileSync(FN + 'social-v1-rpc-allowlist.json', 'utf8'));
  for (const doc of [
    null, {}, { ...good, phase: 'SOCIAL-V2' },
    { ...good, features: { social_studio: [...SOCIAL, 'set_tournament_social_permission'] } },
    { ...good, features: { social_studio: SOCIAL.slice(0, 2) } },
    { ...good, features: { social_studio: [...SOCIAL].reverse() } },
    { ...good, features: { social_studio: SOCIAL, social_permissions: ['set_tournament_social_permission'] } },
    { ...good, features: { social_studio: SOCIAL.map((n) => n.toUpperCase()) } },
  ]) assert.throws(() => withSocial(new Set(), on, doc), SocialConfigError);
  assert.throws(() => withSocial(new Set(['get_tournament_social_snapshot']), on), SocialConfigError, 'already enabled elsewhere');
});

test('the allowlist is the contract: equal to contract.json and disjoint from every other allowlist', async () => {
  const doc = JSON.parse(fs.readFileSync(FN + 'social-v1-rpc-allowlist.json', 'utf8'));
  assert.equal(doc.phase, 'SOCIAL-V1');
  assert.deepEqual(doc.features, { social_studio: CONTRACT.rpcs });
  assert.deepEqual(CONTRACT.rpcs, SOCIAL);
  assert.ok(!SOCIAL.includes('set_tournament_social_permission'));
  for (const file of ['staging-v1-rpc-allowlist.json', 'competition-v1-rpc-allowlist.json', 'officialization-v1-rpc-allowlist.json', 'commerce-test-rpc-allowlist.json']) {
    const other = JSON.stringify(JSON.parse(fs.readFileSync(FN + file, 'utf8')));
    for (const name of [...SOCIAL, 'set_tournament_social_permission']) assert.ok(!other.includes(`"${name}"`), `${name} in ${file}`);
  }
  const { PLAN_READ_RPCS } = await tree.import('torneos-gateway/plan-read.ts');
  for (const name of SOCIAL) assert.ok(!PLAN_READ_RPCS.includes(name));
});

test('boot: SOCIAL adds exactly 3 RPCs next to PLAN READ, never the permission RPC, never commerce', () => {
  const off = gateway.boot({ ...fx.env, TORNEOS_PLAN_READ_MODE: 'on' });
  const on = gateway.boot({ ...fx.env, TORNEOS_PLAN_READ_MODE: 'on', TORNEOS_SOCIAL_MODE: 'on' });
  const socialOnly = gateway.boot({ ...fx.env, TORNEOS_SOCIAL_MODE: 'on' });
  const neither = gateway.boot({ ...fx.env });
  assert.deepEqual([...on.rpcAllowlist].filter((n) => !off.rpcAllowlist.has(n)), SOCIAL);
  assert.deepEqual([...off.rpcAllowlist].filter((n) => !on.rpcAllowlist.has(n)), []);
  assert.deepEqual([...socialOnly.rpcAllowlist].filter((n) => !neither.rpcAllowlist.has(n)), SOCIAL);
  for (const runtime of [off, on, socialOnly, neither]) {
    assert.equal(runtime.commerce.mode, 'off');
    assert.equal(runtime.rpcAllowlist.has('set_tournament_social_permission'), false);
    for (const name of COMMERCIAL) assert.equal(runtime.rpcAllowlist.has(name), false, name);
  }
  for (const name of PLAN) assert.equal(on.rpcAllowlist.has(name), true, 'PLAN READ coexists with SOCIAL');
  for (const name of SOCIAL) assert.equal(off.rpcAllowlist.has(name), false, 'SOCIAL is never on by default');
  for (const mode of ['test', 'production', 'live']) assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_SOCIAL_MODE: 'on', TORNEOS_COMMERCE_MODE: mode }));
});

test('index.ts composes SOCIAL on top of PLAN READ and fails closed on SocialConfigError', () => {
  const index = fs.readFileSync(FN + 'index.ts', 'utf8');
  assert.equal(index.split('withSocial(withPlanRead(effectiveRpcAllowlist(baseAllowlist, commerce), env), env)').length, 2);
  assert.match(index, /error instanceof PlanReadConfigError \|\| error instanceof SocialConfigError \? error\.message/);
  const social = fs.readFileSync(FN + 'social.ts', 'utf8');
  assert.deepEqual(social.match(/^import .*$/gm), ['import socialDoc from "./social-v1-rpc-allowlist.json" with { type: "json" }'], 'social.ts imports only its allowlist');
  assert.doesNotMatch(social.replace(/^\/\/.*$/gm, ''), /commerce|payment|checkout|PUBLIC_RPC|publicRpc|fetch\(|Deno\./i);
});

// ── the real gateway with TORNEOS_SOCIAL_MODE=on ─────────────────────────────────────────────────────────────────
test('SOCIAL on: the three RPCs reach PostgREST with the bridge bearer and their exact payload', async () => {
  for (const [name, params] of [
    ['get_tournament_social_studio_context', { p_organization_id: ORG }],
    ['get_tournament_social_snapshot', { p_organization_id: ORG, p_tournament_id: TOURNAMENT, p_category_id: CATEGORY, p_phase_id: PHASE, p_piece: 'standings', p_round_id: null, p_group_id: null }],
    ['authorize_tournament_social_export', AUTHORIZE],
  ]) {
    world.rest = [];
    const res = await rpc(name, { params });
    assert.equal(res.status, 200, name);
    assert.equal(world.rest.length, 1, name);
    assert.equal(world.rest[0].name, name);
    assert.deepEqual(world.rest[0].body, params);
  }
  assert.ok(world.sql.every((q) => /^(SELECT|SET LOCAL)/.test(q)), 'no SQL write');
});

test('SOCIAL on: the database verdict passes through unchanged (FREE premium, branding, forbidden, NULL theme)', async () => {
  for (const [verdict, status, message] of [
    ['premium', 403, 'TORNEOS_SOCIAL_PREMIUM_REQUIRED'], ['branding', 403, 'TORNEOS_BRANDING_PREMIUM_REQUIRED'],
    ['forbidden', 403, 'TORNEOS_SOCIAL_EXPORT_FORBIDDEN'], ['theme', 400, 'TORNEOS_SOCIAL_THEME_UNKNOWN'],
  ]) {
    world.verdict = verdict;
    const res = await rpc('authorize_tournament_social_export', { params: { ...AUTHORIZE, p_theme: verdict === 'theme' ? null : 'heritage' } });
    assert.equal(res.status, status, verdict);
    assert.equal((await res.json()).message, message);
  }
});

test('SOCIAL on: no bearer / invalid bearer / unknown identity / Core down fail before PostgREST', async () => {
  for (const name of SOCIAL) {
    assert.equal((await rpc(name, { bearer: null, params: AUTHORIZE })).status, 401, `${name} without bearer`);
    assert.equal((await rpc(name, { bearer: 'not-a-jwt', params: AUTHORIZE })).status, 401, `${name} invalid bearer`);
    assert.equal((await rpc(name, { bearer: token().slice(0, -4) + 'AAAA', params: AUTHORIZE })).status, 401, `${name} bad signature`);
  }
  world.identity = false;
  assert.equal((await rpc('authorize_tournament_social_export', { params: AUTHORIZE })).status, 401);
  world.identity = true; world.core = false;
  const res = await rpc('authorize_tournament_social_export', { params: AUTHORIZE });
  assert.equal(res.status, 503); assert.equal((await res.json()).error, 'CORE_UNAVAILABLE');
  assert.equal(world.rest.length, 0);
});

test('SOCIAL on: set_tournament_social_permission and the 14 commercial RPCs stay 403 without reaching PostgREST', async () => {
  for (const name of ['set_tournament_social_permission', ...COMMERCIAL, 'get_tournament_social_snapshot_plan_legacy', 'has_tournament_social_capability']) {
    const res = await rpc(name, { params: {} });
    assert.equal(res.status, 403, name);
    assert.equal((await res.json()).error, 'rpc not enabled');
  }
  assert.equal(world.rest.length, 0); assert.equal(world.sql.length, 0);
});

test('SOCIAL on: checkout/payments paths stay 404 and the public route refuses the Social RPCs', async () => {
  for (const path of ['/commerce/v1/season-checkout', '/internal/v1/season-checkout-preference']) assert.equal((await gateway.handle(request(path))).status, 404);
  for (const name of SOCIAL) {
    assert.equal((await gateway.handle(request('/torneos/public/v1/rpc/' + name, { bearer: null, params: { p_organization_id: ORG } }))).status, 403, name);
  }
  assert.equal(world.rest.length, 0);
});

test('SOCIAL on: PLAN READ keeps working next to it', async () => {
  const res = await rpc('get_effective_tournament_season_entitlements', { params: { p_organization_id: ORG, p_season_id: SEASON } });
  assert.equal(res.status, 200);
  assert.equal(world.rest[0].name, 'get_effective_tournament_season_entitlements');
});

test('frontend adapter → real gateway: each Social alias sends the legacy RPC and payload (Billing OFF)', async () => {
  const service = rt.load(SRC + 'stagingV1/stagingV1WorkspaceService.js').createStagingV1WorkspaceService({
    planRead: true, social: true,
    transport: { rpc: async (name, params) => { const res = await rpc(name, { params }); assert.equal(res.status, 200, name); return res.json(); } },
  });
  await service.loadSocialStudioContext(ORG);
  await service.loadSocialSnapshot({ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, phaseId: PHASE, piece: 'standings' });
  await service.authorizeSocialExport({ organizationId: ORG, tournamentId: TOURNAMENT, piece: 'round_results', theme: 'base', includeArma2Branding: true });
  assert.deepEqual(world.rest.map((r) => r.name), SOCIAL);
  assert.deepEqual(world.rest[2].body, AUTHORIZE);
  for (const name of ['setSocialPermission', 'signMediaReadUrls', 'resolveTeamShieldUrl', 'resolveTournamentLogoUrl', 'loadPurchase', 'createCheckout']) {
    assert.equal(service[name], undefined, name);
  }
});

// ── the real gateway with TORNEOS_SOCIAL_MODE absent (Production today) ──────────────────────────────────────────
test('SOCIAL absent: the three RPCs answer 403 rpc not enabled and nothing reaches PostgREST', async () => {
  currentEnv = { ...fx.env, TORNEOS_PLAN_READ_MODE: 'on' };
  const offTree = await loadGatewayTree({ postgresModule: stub });
  try {
    const off = await offTree.import('torneos-gateway/index.ts');
    for (const name of SOCIAL) {
      const res = await off.handle(request('/torneos/rest/v1/rpc/' + name, { params: AUTHORIZE }));
      assert.equal(res.status, 403, name);
      assert.equal((await res.json()).error, 'rpc not enabled');
    }
    const plan = await off.handle(request('/torneos/rest/v1/rpc/get_effective_tournament_season_entitlements', { params: { p_organization_id: ORG, p_season_id: SEASON } }));
    assert.equal(plan.status, 200);
    assert.deepEqual(world.rest.map((r) => r.name), ['get_effective_tournament_season_entitlements']);
  } finally {
    currentEnv = { ...fx.env, TORNEOS_PLAN_READ_MODE: 'on', TORNEOS_SOCIAL_MODE: 'on' };
    await offTree.cleanup();
  }
});

test('an invalid TORNEOS_SOCIAL_MODE disables the whole gateway (503 on every route, no dependency touched)', async () => {
  currentEnv = { ...fx.env, TORNEOS_PLAN_READ_MODE: 'on', TORNEOS_SOCIAL_MODE: 'true' };
  const badTree = await loadGatewayTree({ postgresModule: stub });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const bad = await badTree.import('torneos-gateway/index.ts');
    for (const name of [...SOCIAL, ...PLAN, 'get_tournament_workspace_context']) {
      assert.equal((await bad.handle(request('/torneos/rest/v1/rpc/' + name, { params: {} }))).status, 503, name);
    }
    assert.equal(world.rest.length, 0); assert.equal(world.sql.length, 0);
    assert.ok(errors.some((line) => line.includes('TORNEOS_SOCIAL_MODE must be on or off')), 'reason logged once, without values');
    assert.ok(errors.every((line) => !line.includes(fx.env.TORNEOS_BRIDGE_KEYS || '\u0000')));
  } finally {
    console.error = originalError;
    currentEnv = { ...fx.env, TORNEOS_PLAN_READ_MODE: 'on', TORNEOS_SOCIAL_MODE: 'on' };
    await badTree.cleanup();
  }
});
