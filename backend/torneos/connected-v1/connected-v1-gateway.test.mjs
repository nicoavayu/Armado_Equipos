// CONNECTED-V1 gateway contract, against the real gateway source (loaded like social-v1-gateway.test.mjs: real
// index.ts, stubbed Postgres, emulated Core and PostgREST). Never touches a network or a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGatewayTree } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { fixtureEnv, BASE } from '../infra/torneos-competition-v1/test-support.mjs';
import * as G from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';
import { mintBridgeToken } from '../infra/torneos-gateway-auth/bridge-probe.mjs';

const FN = 'backend/torneos/supabase/functions/torneos-gateway/';
const TEST_CA = '-----BEGIN CERTIFICATE-----\nQ09OTkVDVEVELVYxLXRlc3QtY2E=\n-----END CERTIFICATE-----\n';
const CONTRACT = JSON.parse(fs.readFileSync('backend/torneos/connected-v1/contract.json', 'utf8'));
const DOC = JSON.parse(fs.readFileSync(FN + 'connected-v1-rpc-allowlist.json', 'utf8'));
const AUTHENTICATED = Object.values(DOC.features).flat();
const PUBLIC = Object.values(DOC.public).flat();

const world = { identity: true, core: true, rest: [], sql: [] };
globalThis.__connectedWorld = world;
const stub = `export default function postgres() { return { begin: async (fn) => fn({ unsafe: async (q, params) => {
  globalThis.__connectedWorld.sql.push(q);
  if (q.startsWith('SELECT id FROM public.torneos_identity')) return globalThis.__connectedWorld.identity ? [{ id: params[0] }] : [];
  if (q.startsWith('SET LOCAL ')) return [];
  throw new Error('Unexpected SQL (writes forbidden)');
} }), end: async () => {} }; }`;

let fx, tree, gateway, originalFetch, currentEnv;
test.before(async () => {
  fx = fixtureEnv({ caPem: TEST_CA });
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === G.GATEWAY_TOPOLOGY.coreAuthUrl + '/health') return new Response('{}', { status: 200 });
    if (u === G.GATEWAY_TOPOLOGY.coreContractUrl + '/v1/session') return new Response(
      world.core ? JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }) : '{}', { status: world.core ? 200 : 503 });
    if (u.startsWith(G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/')) {
      const name = u.slice((G.GATEWAY_TOPOLOGY.torneosRestUrl + '/rpc/').length);
      const raw = init.body == null ? '{}' : typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body);
      world.rest.push({ name, body: JSON.parse(raw), authorization: init.headers.authorization ?? null });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected network destination ' + u);
  };
  currentEnv = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on' };
  globalThis.Deno = { env: { toObject: () => currentEnv } };
  tree = await loadGatewayTree({ postgresModule: stub });
  gateway = await tree.import('torneos-gateway/index.ts');
});
test.after(async () => { globalThis.fetch = originalFetch; delete globalThis.Deno; delete globalThis.__connectedWorld; await tree.cleanup(); });
test.beforeEach(() => { Object.assign(world, { identity: true, core: true, rest: [], sql: [] }); });

const token = () => mintBridgeToken({ pkcs8: fx.k1.pkcs8, kid: fx.k1.kid });
function request(path, { bearer = token(), body = {}, raw = null, headers = {} } = {}) {
  return new Request(BASE + path, {
    method: 'POST',
    headers: { host: new URL(BASE).host, origin: G.WEB_ORIGIN, 'content-type': 'application/json',
      ...(bearer ? { authorization: 'Bearer ' + bearer } : {}), ...headers },
    body: raw ?? JSON.stringify(body),
  });
}
const rpc = (name, options) => gateway.handle(request('/torneos/rest/v1/rpc/' + name, options));
const pub = (name, body, options = {}) => gateway.handle(request('/torneos/public/v1/rpc/' + name, { bearer: null, body, ...options }));

test('the allowlist is the contract and is disjoint from every other allowlist', () => {
  assert.equal(DOC.phase, 'CONNECTED-V1');
  assert.deepEqual(AUTHENTICATED, CONTRACT.rpcs);
  assert.deepEqual(PUBLIC, CONTRACT.public_rpcs);
  for (const file of ['staging-v1-rpc-allowlist.json', 'competition-v1-rpc-allowlist.json', 'officialization-v1-rpc-allowlist.json',
    'commerce-test-rpc-allowlist.json', 'social-v1-rpc-allowlist.json']) {
    const other = JSON.stringify(JSON.parse(fs.readFileSync(FN + file, 'utf8')));
    for (const name of [...AUTHENTICATED, ...PUBLIC, ...CONTRACT.service_only]) assert.ok(!other.includes(`"${name}"`), `${name} in ${file}`);
  }
  for (const name of [...CONTRACT.service_only, ...CONTRACT.internal]) {
    assert.ok(!JSON.stringify(DOC).includes(`"${name}"`), `${name} is never served`);
  }
});

test('strict opt-in: absent/""/off add nothing, on adds exactly the contract, anything else closes the gateway', async () => {
  const { loadConnectedContract, withConnected, ConnectedConfigError } = await tree.import('torneos-gateway/connected.ts');
  const base = new Set(['existing']);
  for (const env of [{}, { TORNEOS_CONNECTED_MODE: '' }, { TORNEOS_CONNECTED_MODE: 'off' }]) {
    const contract = loadConnectedContract(env, base, new Set());
    assert.equal(contract.mode, 'off');
    assert.deepEqual([...withConnected(base, contract)], ['existing']);
    assert.equal(contract.publicRpcs.size, 0);
  }
  const on = loadConnectedContract({ TORNEOS_CONNECTED_MODE: 'on' }, base, new Set(['get_public_tournament_page']));
  assert.deepEqual([...withConnected(base, on)], ['existing', ...AUTHENTICATED]);
  assert.deepEqual([...on.publicRpcs], PUBLIC);
  assert.deepEqual([...base], ['existing'], 'the input set is never mutated');
  for (const mode of ['ON', 'On', 'on ', 'true', '1', 'yes', 'production']) {
    assert.throws(() => loadConnectedContract({ TORNEOS_CONNECTED_MODE: mode }, base, new Set()), ConnectedConfigError, mode);
    assert.throws(() => gateway.boot({ ...fx.env, TORNEOS_CONNECTED_MODE: mode }), ConnectedConfigError, `boot ${mode}`);
  }
});

test('a tampered allowlist document closes the gateway instead of widening it', async () => {
  const { loadConnectedContract, ConnectedConfigError } = await tree.import('torneos-gateway/connected.ts');
  const on = { TORNEOS_CONNECTED_MODE: 'on' };
  for (const doc of [
    null, {}, { ...DOC, phase: 'CONNECTED-V2' },
    { ...DOC, features: {} },
    { ...DOC, public: {} },
    { ...DOC, features: { ...DOC.features, extra: ['platform_remove_tournament_catalog_listing'] } },
    { ...DOC, public: { tournament_catalog: [...PUBLIC, 'get_my_torneos_profile'] } },
    { ...DOC, public: { tournament_catalog: PUBLIC.slice(0, 2) } },
    { ...DOC, features: { ...DOC.features, dup: ['get_my_torneos_profile'] } },
    { ...DOC, features: { torneos_profile: ['GET_MY_TORNEOS_PROFILE'] } },
  ]) assert.throws(() => loadConnectedContract(on, new Set(), new Set(), doc), ConnectedConfigError);
  assert.throws(() => loadConnectedContract(on, new Set(['get_my_torneos_profile']), new Set()), ConnectedConfigError, 'already enabled elsewhere');
  assert.throws(() => loadConnectedContract(on, new Set(), new Set(['search_tournament_catalog'])), ConnectedConfigError, 'already public elsewhere');
});

test('boot: CONNECTED adds exactly its 14 authenticated RPCs and its 3 public RPCs, next to everything else', () => {
  const off = gateway.boot({ ...fx.env });
  const on = gateway.boot({ ...fx.env, TORNEOS_CONNECTED_MODE: 'on' });
  assert.deepEqual([...on.rpcAllowlist].filter((name) => !off.rpcAllowlist.has(name)), AUTHENTICATED);
  assert.deepEqual([...off.rpcAllowlist].filter((name) => !on.rpcAllowlist.has(name)), []);
  assert.deepEqual([...on.connected.publicRpcs], PUBLIC);
  assert.equal(off.connected.publicRpcs.size, 0);
  for (const runtime of [off, on]) assert.equal(runtime.rpcAllowlist.has('platform_remove_tournament_catalog_listing'), false);
  const both = gateway.boot({ ...fx.env, TORNEOS_CONNECTED_MODE: 'on', TORNEOS_PLAN_READ_MODE: 'on', TORNEOS_SOCIAL_MODE: 'on' });
  for (const name of AUTHENTICATED) assert.equal(both.rpcAllowlist.has(name), true, `${name} coexists with PLAN READ and SOCIAL`);
});

test('index.ts keeps the certified authenticated route; the connected contract only widens the name sets', () => {
  const index = fs.readFileSync(FN + 'index.ts', 'utf8');
  assert.match(index, /await rt\.adapter\.prepare\(p, CONTRACTS\[rpc\]\.contract, request\)/);
  assert.match(index, /withConnected\(servedAllowlist, connected\)/);
  assert.match(index, /error instanceof ConnectedConfigError/);
  const connected = fs.readFileSync(FN + 'connected.ts', 'utf8');
  assert.deepEqual(connected.match(/^import .*$/gm), ['import connectedDoc from "./connected-v1-rpc-allowlist.json" with { type: "json" }']);
  assert.doesNotMatch(connected.replace(/^\/\/.*$/gm, ''), /commerce|payment|checkout|fetch\(|Deno\./i);
});

test('CONNECTED on: the authenticated RPCs reach PostgREST with the bridge bearer and their exact payload', async () => {
  const samples = {
    get_my_torneos_profile: {},
    update_my_torneos_profile: { p_display_name: 'Capi', p_notify_registration_requests: true },
    get_my_torneos_inbox_summary: {},
    get_my_tournament_registrations: { p_limit: 20, p_offset: 0 },
    get_tournament_application_inbox: { p_organization_id: '10000000-0000-4000-8000-000000000001', p_tournament_id: '30000000-0000-4000-8000-000000000001', p_status: 'submitted', p_limit: 20, p_offset: 0 },
    // A new team needs no Core attestation: straight to PostgREST.
    start_tournament_application: { p_public_slug: 'copa', p_category_slug: 'libre', p_core_team_id: null, p_team_name: 'Nuevo', p_message: null, p_accept_conditions: true, p_idempotency_key: '70000000-0000-4000-8000-000000000001' },
  };
  for (const [name, body] of Object.entries(samples)) {
    world.rest = [];
    const res = await rpc(name, { body });
    assert.equal(res.status, 200, name);
    assert.deepEqual(world.rest.map((call) => [call.name, call.body]), [[name, body]], name);
    assert.match(world.rest[0].authorization, /^Bearer /);
  }
  assert.ok(world.sql.every((q) => /^(SELECT|SET LOCAL)/.test(q)), 'no SQL write');
});

test('CONNECTED on: a Core team request goes through the applicant authorizer before PostgREST', async () => {
  const { CONTRACTS, authorizerFor } = await tree.import('torneos-gateway/adapter.ts');
  const search = CONTRACTS.search_my_applicable_core_teams.request({ p_public_slug: 'copa', p_query: 'hal', p_limit: 5, p_x: 'ignored' });
  assert.deepEqual(search, { applicant_public_slug: 'copa', query: 'hal', limit: 5 });
  assert.equal(CONTRACTS.search_my_applicable_core_teams.contract, 'directory_teams');
  const team = CONTRACTS.start_tournament_application.request({ p_public_slug: 'copa', p_category_slug: 'libre', p_core_team_id: 'c', p_team_name: 'x' });
  assert.deepEqual(team, { application_public_slug: 'copa', category_slug: 'libre', core_team_id: 'c' });
  assert.equal(CONTRACTS.start_tournament_application.request({ p_public_slug: 'copa', p_category_slug: 'libre', p_core_team_id: null }), null);
  assert.equal(authorizerFor(search), 'authorize_applicant_core_contract');
  assert.equal(authorizerFor(team), 'authorize_applicant_core_contract');
  // Core contract v1.2: the applicant's own teams; the limit is fixed by the gateway, nothing else travels.
  const mine = CONTRACTS.list_my_core_teams_for_application.request({ p_public_slug: 'copa', p_limit: 500, p_query: 'x' });
  assert.deepEqual(mine, { applicant_public_slug: 'copa', limit: 30 });
  assert.equal(CONTRACTS.list_my_core_teams_for_application.contract, 'my_teams');
  assert.equal(authorizerFor(mine), 'authorize_applicant_core_contract');
  for (const [name, mapper] of Object.entries(CONTRACTS)) {
    if (['search_my_applicable_core_teams', 'start_tournament_application', 'list_my_core_teams_for_application'].includes(name)) continue;
    const sample = mapper.request({ p_token: 't'.repeat(64), p_organization_id: 'o', p_tournament_id: 't', p_category_id: 'c', p_arma2_team_id: 'a', p_query: 'q', p_limit: 3, applicant_public_slug: 'injected' });
    if (sample) assert.equal(authorizerFor(sample), 'authorize_core_contract', `${name} keeps the certified authorizer whatever the client sends`);
  }
  // With the Core team the stubbed adapter role cannot authorize (writes are forbidden in this sandbox): the request
  // never reaches PostgREST, which is the point — no attestation, no RPC.
  world.rest = [];
  const res = await rpc('start_tournament_application', { body: { p_public_slug: 'copa', p_category_slug: 'libre', p_core_team_id: '60000000-0000-4000-8000-000000000001', p_team_name: null, p_message: null, p_accept_conditions: true, p_idempotency_key: '70000000-0000-4000-8000-000000000001' } });
  assert.notEqual(res.status, 200);
  assert.equal(world.rest.length, 0);
});

test('CONNECTED on: the public catalog is anonymous, with an exact body contract', async () => {
  world.rest = [];
  const ok = await pub('search_tournament_catalog', { p_query: 'Copa Norte', p_scope: 'all', p_sort: 'starting', p_page: '2' });
  assert.equal(ok.status, 200);
  assert.deepEqual(world.rest[0], { name: 'search_tournament_catalog', authorization: null, body: {
    p_query: 'Copa Norte', p_locality: null, p_sport: null, p_gender: null, p_scope: 'all', p_from: null, p_to: null, p_sort: 'starting', p_page: '2',
  } });
  assert.equal((await pub('get_tournament_catalog_facets', {})).status, 200);
  assert.deepEqual(world.rest[1].body, {});
  assert.equal((await pub('get_tournament_catalog_entry', { p_public_slug: 'copa-abierta' })).status, 200);
  for (const [name, body, status] of [
    ['search_tournament_catalog', { p_sort: 'cheapest' }, 400],
    ['search_tournament_catalog', { p_page: '0' }, 400],
    ['search_tournament_catalog', { p_from: '01/12/2026' }, 400],
    ['search_tournament_catalog', { p_query: 'drop table; --' }, 400],
    ['search_tournament_catalog', { p_extra: 'x' }, 400],
    ['get_tournament_catalog_entry', {}, 400],
    ['get_tournament_catalog_facets', { p_any: 'x' }, 400],
    ['get_my_torneos_profile', {}, 403],
    ['platform_remove_tournament_catalog_listing', {}, 403],
  ]) {
    world.rest = [];
    assert.equal((await pub(name, body)).status, status, `${name} ${JSON.stringify(body)}`);
    assert.equal(world.rest.length, 0);
  }
  assert.equal((await pub('search_tournament_catalog', {}, { headers: { authorization: 'Bearer x' } })).status, 400, 'credentials refused');
  assert.equal((await pub('get_public_tournament_page', { p_public_slug: 'copa-abierta' })).status, 200, 'COMPETITION-V1 public page unchanged');
});

test('CONNECTED off: nothing new is served on either route', async () => {
  currentEnv = { ...fx.env };
  const offTree = await loadGatewayTree({ postgresModule: stub });
  try {
    const off = await offTree.import('torneos-gateway/index.ts');
    for (const name of AUTHENTICATED) {
      const res = await off.handle(request('/torneos/rest/v1/rpc/' + name, { body: {} }));
      assert.equal(res.status, 403, name);
      assert.equal((await res.json()).error, 'rpc not enabled');
    }
    for (const name of PUBLIC) {
      const res = await off.handle(request('/torneos/public/v1/rpc/' + name, { bearer: null, body: {} }));
      assert.equal(res.status, 403, name);
    }
  } finally {
    currentEnv = { ...fx.env, TORNEOS_CONNECTED_MODE: 'on' };
    await offTree.cleanup();
  }
});
