// CONNECTED-V1 — the connected product in both compositions.
//   • each connected alias sends the same RPC name and p_* payload as the LOCAL service (the REAL legacy module
//     against a recording Core stub, the hybrid adapter against a recording transport)
//   • the client scope equals the gateway allowlist; without `connected: true` it fails closed before the network
//   • the public catalog: same arguments on the LOCAL stack and on the gateway's public route; closed elsewhere
//   • the composition: connected only with hybrid + REACT_APP_TORNEOS_CONNECTED_MODE=on (always on the LOCAL stack)
//   • the platform removal lever never exists on any client
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';

const ADAPTER = 'src/features/torneos/stagingV1/stagingV1WorkspaceService.js';
const LEGACY = 'src/features/torneos/api/tournamentWorkspaceService.js';
const ALLOWLIST = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/connected-v1-rpc-allowlist.json'));
const AUTHENTICATED = Object.values(ALLOWLIST.features).flat();
const PUBLIC = Object.values(ALLOWLIST.public).flat();
const ORG = '10000000-0000-4000-8000-000000000001';
const TOURNAMENT = '30000000-0000-4000-8000-000000000001';
const CATEGORY = '40000000-0000-4000-8000-000000000001';
const ENTRY = '50000000-0000-4000-8000-000000000001';
const CORE_TEAM = '60000000-0000-4000-8000-000000000001';
const KEY = '70000000-0000-4000-8000-000000000001';
const NOTIFICATION = '80000000-0000-4000-8000-000000000001';
const uuidStub = { v4: () => KEY };
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
const explicitNulls = (params) => Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, v === undefined ? null : v]));

function recordingTransport() {
  const calls = [];
  return {
    calls,
    transport: {
      rpc: async (name, params) => { calls.push({ name, params }); return { ok: true }; },
      publicRpc: async (name, params) => { calls.push({ name, params, public: true }); return { ok: true }; },
      clear() {},
      dispose() {},
    },
  };
}
const loadAdapter = (transport, options = {}) => runtime({ modules: { uuid: uuidStub } }).load(ADAPTER)
  .createStagingV1WorkspaceService({ transport, ...options });
function loadLegacy(path = LEGACY) {
  const calls = [];
  const supabase = {
    rpc: async (name, params) => { calls.push({ name, params }); return { data: { ok: true }, error: null }; },
    from: () => { throw new Error('no table access expected'); },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  };
  const rt = runtime({ modules: {
    uuid: uuidStub,
    'src/services/api/supabase.js': { supabase, default: supabase },
    'src/lib/supabaseClient.js': { supabase, supabaseCore: supabase, default: supabase },
  } });
  return { calls, module: rt.load(path) };
}

const SAMPLES = {
  loadTorneosProfile: [[]],
  updateTorneosProfile: [[{ displayName: 'Capi Halcones', notifyRegistrationRequests: true }], [{ displayName: null, notifyRegistrationRequests: false }]],
  loadTorneosNotifications: [[{}], [{ unreadOnly: true, limit: 5, offset: 10 }]],
  markTorneosNotificationsRead: [[{ notificationIds: [NOTIFICATION] }], [{ notificationIds: null }]],
  loadTorneosInboxSummary: [[]],
  loadCatalogListingSettings: [[{ organizationId: ORG, tournamentId: TOURNAMENT }]],
  saveCatalogListing: [
    [{ organizationId: ORG, tournamentId: TOURNAMENT, summary: 'Fútbol 5 los sábados.', locality: 'Rosario' }],
    [{ organizationId: ORG, tournamentId: TOURNAMENT, summary: 'Fútbol 5 los sábados.', locality: 'Rosario', venueId: CATEGORY, entryFeeCents: 1500000, entryFeeIncludes: 'Árbitro', paymentNote: 'Transferencia', requirements: 'DNI', rulesSummary: 'FIFA' }],
    [{ organizationId: ORG, tournamentId: TOURNAMENT, summary: 'Fútbol 5.', locality: 'Rosario', entryFeeCents: 0, entryFeeUnit: 'player', contactWhatsapp: '5491122223333', contactPublic: true }],
  ],
  setCatalogListingStatus: [[{ organizationId: ORG, tournamentId: TOURNAMENT, listed: true }], [{ organizationId: ORG, tournamentId: TOURNAMENT, listed: false }]],
  setApplicationsState: [[{ organizationId: ORG, tournamentId: TOURNAMENT, state: 'paused' }]],
  saveCategoryCapacity: [[{ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, maxTeams: 8 }], [{ organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, maxTeams: null }]],
  loadApplicationInbox: [[{ organizationId: ORG, tournamentId: TOURNAMENT }], [{ organizationId: ORG, tournamentId: TOURNAMENT, status: 'approved', limit: 5, offset: 5 }]],
  searchApplicableCoreTeams: [[{ publicSlug: 'copa-abierta', query: 'halc' }]],
  startTournamentApplication: [
    [{ publicSlug: 'copa-abierta', categorySlug: 'primera', coreTeamId: CORE_TEAM, acceptConditions: true, idempotencyKey: KEY }],
    [{ publicSlug: 'copa-abierta', categorySlug: 'primera', teamName: 'Nuevo FC', message: 'Hola', acceptConditions: true, idempotencyKey: KEY }],
  ],
  loadMyRegistrations: [[{}], [{ limit: 50, offset: 0 }]],
  listMyCoreTeamsForApplication: [[{ publicSlug: 'copa-abierta' }]],
  loadMyParticipations: [[{}], [{ limit: 6, offset: 12 }]],
};

test('each connected alias sends the same RPC name and p_* payload as the LOCAL service', async () => {
  const legacy = loadLegacy();
  const service = legacy.module.tournamentWorkspaceService;
  const recorder = recordingTransport();
  const adapter = loadAdapter(recorder.transport, { connected: true });
  const reached = new Set();
  for (const [alias, samples] of Object.entries(SAMPLES)) {
    for (const args of samples) {
      legacy.calls.length = 0; recorder.calls.length = 0;
      await service[alias](...args);
      await adapter[alias](...args);
      assert.equal(legacy.calls.length, 1, `${alias}: LOCAL makes one RPC`);
      assert.equal(recorder.calls.length, 1, `${alias}: hybrid makes one call`);
      assert.equal(recorder.calls[0].name, legacy.calls[0].name, alias);
      same(recorder.calls[0].params, explicitNulls(legacy.calls[0].params));
      reached.add(recorder.calls[0].name);
    }
  }
  assert.deepEqual([...reached].sort(), [...AUTHENTICATED].sort(), 'the aliases cover exactly the authenticated contract');
});

test('the client scope is the gateway allowlist and stays closed without connected: true', async () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const scope = rt.load('src/features/torneos/foundation/connectedV1Scope.js');
  same(scope.connectedV1Scope, ALLOWLIST.features);
  same(scope.connectedV1PublicScope, ALLOWLIST.public);
  const { createTorneosClient, createTorneosPublicClient } = rt.load('src/features/torneos/foundation/torneosClient.js');
  const recorder = recordingTransport();
  for (const options of [{}, { planRead: true }, { social: true }, { connected: 'true' }, { connected: 1 }, { commerce: true }]) {
    const client = createTorneosClient({ transport: recorder.transport, ...options });
    for (const name of AUTHENTICATED) {
      await assert.rejects(client.execute(name, {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1', `${name} ${JSON.stringify(options)}`);
    }
  }
  const open = createTorneosClient({ transport: recorder.transport, connected: true });
  for (const name of ['platform_remove_tournament_catalog_listing', ...PUBLIC, 'get_tournament_purchase']) {
    await assert.rejects(open.execute(name, {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1', name);
  }
  assert.equal(recorder.calls.length, 0);
  for (const name of AUTHENTICATED) await open.execute(name, {});
  assert.deepEqual(recorder.calls.map((c) => c.name), AUTHENTICATED);

  recorder.calls.length = 0;
  const closedPublic = createTorneosPublicClient({ transport: recorder.transport });
  for (const name of PUBLIC) await assert.rejects(closedPublic.execute(name, {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1', name);
  const openPublic = createTorneosPublicClient({ transport: recorder.transport, connected: true });
  for (const name of [...AUTHENTICATED, 'platform_remove_tournament_catalog_listing']) {
    await assert.rejects(openPublic.execute(name, {}), (e) => e.code === 'TORNEOS_OUTSIDE_STAGING_V1', name);
  }
  for (const name of PUBLIC) await openPublic.execute(name, {});
  assert.deepEqual(recorder.calls.map((c) => [c.name, c.public]), PUBLIC.map((name) => [name, true]));
  await openPublic.execute('get_public_tournament_page', { p_public_slug: 'copa', p_category_slug: null });
});

test('without connected the hybrid adapter has no connected alias; with it, never the platform lever', () => {
  const recorder = recordingTransport();
  const { CONNECTED_METHODS } = runtime({ modules: { uuid: uuidStub } }).load(ADAPTER);
  assert.deepEqual([...CONNECTED_METHODS].sort(), Object.keys(SAMPLES).sort());
  for (const options of [{}, { planRead: true }, { social: true }, { connected: 'true' }]) {
    const service = loadAdapter(recorder.transport, options);
    for (const name of CONNECTED_METHODS) assert.equal(service[name], undefined, `${name} ${JSON.stringify(options)}`);
  }
  const service = loadAdapter(recorder.transport, { connected: true });
  for (const name of CONNECTED_METHODS) assert.equal(typeof service[name], 'function', name);
  assert.equal(service.platformRemoveCatalogListing, undefined);
  const { withoutCommerce } = runtime({ modules: { uuid: uuidStub } }).load(ADAPTER);
  const stripped = withoutCommerce(service);
  for (const name of CONNECTED_METHODS) assert.equal(typeof stripped[name], 'function', `${name} survives the commerce strip`);
});

test('invalid input fails before the network', async () => {
  const recorder = recordingTransport();
  const service = loadAdapter(recorder.transport, { connected: true });
  for (const action of [
    () => service.updateTorneosProfile({ displayName: 'x', notifyRegistrationRequests: 'yes' }),
    () => service.updateTorneosProfile({ displayName: 'x' }),
    () => service.markTorneosNotificationsRead({ notificationIds: ['not-a-uuid'] }),
    () => service.markTorneosNotificationsRead({ notificationIds: 'all' }),
  ]) {
    await assert.rejects(action(), (e) => e.code === 'TORNEOS_INVALID_REQUEST');
  }
  assert.equal(recorder.calls.length, 0);
});

test('the public catalog sends the same arguments on the LOCAL stack and on the gateway public route', async () => {
  const legacy = loadLegacy('src/features/torneos/api/publicCatalogService.js');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { createHybridPublicCatalogService, resolvePublicCatalogService, closedPublicCatalogService } = rt.load(
    'src/features/torneos/stagingV1/publicTournamentComposition.js',
  );
  const hybrid = createHybridPublicCatalogService({ gatewayUrl: 'https://gateway.example.test/functions/v1/torneos-gateway', fetchImpl });
  const filters = { query: '  Copa   Norte ', locality: 'Rosario', sport: 'football_5', gender: 'mixed', scope: 'all', from: '2026-11-01', to: '2026-12-31', sort: 'starting', page: 3 };
  await legacy.module.publicCatalogService.search(filters);
  await hybrid.search(filters);
  same(calls[0].body, legacy.calls[0].params);
  assert.equal(legacy.calls[0].name, 'search_tournament_catalog');
  assert.match(calls[0].url, /\/torneos\/public\/v1\/rpc\/search_tournament_catalog$/);
  assert.equal(calls[0].headers.authorization, undefined, 'the public route never carries a credential');
  same(legacy.calls[0].params, {
    p_query: 'Copa Norte', p_locality: 'Rosario', p_sport: 'football_5', p_gender: 'mixed', p_scope: 'all',
    p_from: '2026-11-01', p_to: '2026-12-31', p_sort: 'starting', p_page: '3',
  });
  await legacy.module.publicCatalogService.loadEntry('copa-abierta');
  await hybrid.loadEntry('copa-abierta');
  same(calls[1].body, legacy.calls[1].params);
  assert.equal(await hybrid.loadEntry('NOT A SLUG'), null);
  assert.equal(calls.length, 2, 'an invalid slug never leaves the browser');

  const flags = { torneosEnabled: true, publicPages: true };
  const hybridEnv = { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test/functions/v1/torneos-gateway', REACT_APP_DEPLOY_ENV: 'staging', REACT_APP_TORNEOS_DATA_ENV: 'staging' };
  assert.equal(resolvePublicCatalogService({ env: hybridEnv, flags }), closedPublicCatalogService, 'hybrid without the opt-in: closed');
  assert.equal(resolvePublicCatalogService({ env: { ...hybridEnv, REACT_APP_TORNEOS_CONNECTED_MODE: 'true' }, flags }), closedPublicCatalogService, 'only "on" opens it');
  assert.equal(resolvePublicCatalogService({ env: { ...hybridEnv, REACT_APP_TORNEOS_CONNECTED_MODE: 'on' }, flags }).mode, 'hybrid');
  assert.equal(resolvePublicCatalogService({ env: { ...hybridEnv, REACT_APP_TORNEOS_CONNECTED_MODE: 'on' }, flags: { ...flags, publicPages: false } }), closedPublicCatalogService);
});

test('the composition: connected exists only with hybrid + the explicit opt-in, and always on the LOCAL stack', () => {
  const rt = runtime();
  const { resolveTorneosConnectedProduct } = rt.load('src/features/torneos/foundation/config.js');
  const { stagingV1FeaturesFor, stagingV1Features, stagingV1ConnectedOverlay, legacyFeatures } = rt.load('src/features/torneos/stagingV1/stagingV1Features.js');
  const hybrid = { mode: 'hybrid', gatewayUrl: 'https://gateway.example.test/functions/v1/torneos-gateway' };
  assert.equal(resolveTorneosConnectedProduct({}, { backendMode: hybrid }), false);
  assert.equal(resolveTorneosConnectedProduct({ REACT_APP_TORNEOS_CONNECTED_MODE: 'ON' }, { backendMode: hybrid }), false);
  assert.equal(resolveTorneosConnectedProduct({ REACT_APP_TORNEOS_CONNECTED_MODE: 'on' }, { backendMode: hybrid }), true);
  assert.equal(resolveTorneosConnectedProduct({ REACT_APP_TORNEOS_CONNECTED_MODE: 'on' }, { backendMode: { mode: 'disabled' } }), false);
  assert.equal(resolveTorneosConnectedProduct({}, { backendMode: { mode: 'legacy-local' } }), true);
  const keys = Object.keys(stagingV1ConnectedOverlay);
  for (const key of keys) assert.equal(stagingV1Features[key], false, `${key} is off by default`);
  for (const key of keys) assert.equal(stagingV1FeaturesFor('off', { connected: true })[key], true, key);
  const on = stagingV1FeaturesFor('off', { connected: true });
  assert.deepEqual(Object.keys(on).filter((key) => on[key] !== stagingV1Features[key]).sort(), [...keys].sort(), 'connected changes nothing else');
  for (const key of keys) assert.equal(legacyFeatures[key], true, `${key} on in the LOCAL composition`);
});
