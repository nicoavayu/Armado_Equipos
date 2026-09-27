// COMPETITION-V1 — the competition half of the hybrid workspace adapter and the public-page composition.
//   • every competition alias sends the same RPC name and p_* payload as the legacy service (the REAL legacy
//     module against a recording Core stub, the adapter against a recording transport), alias by alias
//   • together they reach exactly the 74 RPCs of the gateway competition allowlist, nothing else
//   • aliases outside the contract are absent (service-only fixture/match actions, roster lock, discipline
//     bookkeeping, media/branding/social) so the pages hide them instead of failing
//   • venues/courts read the two certified table routes and map rows exactly like the legacy service
//   • the public page: anonymous client + transport (no credential, only the public RPC), branding paths
//     dropped, and a closed composition that never touches the network
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';
import { ORG, COMPETITION_SAMPLE, COMPETITION_COMPOSITE, COMPETITION_EXCLUDED } from './competition-samples.mjs';

const COMPETITION = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/competition-v1-rpc-allowlist.json'));
const COMPETITION_RPCS = new Set(Object.values(COMPETITION.features).flat());
const ADAPTER = 'src/features/torneos/stagingV1/stagingV1WorkspaceService.js';
const LEGACY = 'src/features/torneos/api/tournamentWorkspaceService.js';
const COMPOSITION = 'src/features/torneos/stagingV1/publicTournamentComposition.js';
const uuidStub = { v4: () => 'idempotency-placeholder' };
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

function recordingTransport(reply = () => null) {
  const calls = [];
  return {
    calls,
    transport: {
      rpc: async (name, params) => { calls.push({ kind: 'rpc', name, params }); return reply(name, params); },
      select: async (table, query) => { calls.push({ kind: 'select', table, query }); return reply(table, query); },
      clear() {}, dispose() {},
    },
  };
}
const loadAdapter = (transport) => runtime({ modules: { uuid: uuidStub } }).load(ADAPTER).createStagingV1WorkspaceService({ transport });
function loadLegacy(reply = () => null, rows = []) {
  const calls = [];
  const from = (table) => {
    const call = { kind: 'from', table, ops: [] };
    calls.push(call);
    const builder = new Proxy({}, {
      get: (_, op) => {
        if (op === 'then') return (resolve) => resolve({ data: typeof rows === 'function' ? rows(table) : rows, error: null });
        return (...args) => { call.ops.push([op, ...args]); return builder; };
      },
    });
    return builder;
  };
  const supabase = {
    rpc: async (name, params) => { calls.push({ kind: 'rpc', name, params }); return { data: reply(name, params), error: null }; },
    from,
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  };
  const rt = runtime({ modules: {
    uuid: uuidStub,
    'src/services/api/supabase.js': { supabase, default: supabase },
    'src/lib/supabaseClient.js': { supabase, supabaseCore: supabase, default: supabase },
  } });
  return { calls, service: rt.load(LEGACY).tournamentWorkspaceService };
}
const explicitNulls = (params) => Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, v === undefined ? null : v]));

test('every competition alias sends the same RPC name and p_* payload as the legacy service; together they reach exactly the 74 competition RPCs', async () => {
  const legacy = loadLegacy();
  const recorder = recordingTransport();
  const service = loadAdapter(recorder.transport);
  const covered = new Set();
  for (const [alias, args] of Object.entries(COMPETITION_SAMPLE)) {
    legacy.calls.length = 0; recorder.calls.length = 0;
    assert.equal(typeof legacy.service[alias], 'function', `${alias} is a legacy alias`);
    assert.equal(typeof service[alias], 'function', `${alias} is offered by the hybrid adapter`);
    await legacy.service[alias](...args);
    await service[alias](...args);
    const expected = legacy.calls.filter((c) => c.kind === 'rpc');
    assert.equal(expected.length, 1, `${alias}: legacy makes one RPC`);
    assert.equal(recorder.calls.length, 1, `${alias}: adapter makes one call`);
    assert.equal(recorder.calls[0].name, expected[0].name, alias);
    same(recorder.calls[0].params, explicitNulls(expected[0].params));
    assert.ok(!Object.values(recorder.calls[0].params).includes(undefined), `${alias}: no undefined argument leaves the client`);
    assert.ok(COMPETITION_RPCS.has(recorder.calls[0].name), `${alias} → ${recorder.calls[0].name} is in the competition allowlist`);
    covered.add(recorder.calls[0].name);
  }
  // loadPlayerMatches: the same two RPCs and the same relation-tagged merge.
  const rows = { get_player_tournament_matches: [{ matchId: 'm1', teamEntryId: 'e1', x: 1 }], get_managed_tournament_matches: [{ matchId: 'm1', teamEntryId: 'e1', y: 2 }, { matchId: 'm2', teamEntryId: 'e2' }] };
  const legacyMerged = await loadLegacy((name) => rows[name] ?? null).service.loadPlayerMatches();
  const r2 = recordingTransport((name) => rows[name] ?? null);
  const adapterMerged = await loadAdapter(r2.transport).loadPlayerMatches();
  same(adapterMerged, legacyMerged);
  assert.deepEqual(r2.calls.map((c) => [c.name, JSON.stringify(c.params)]), [['get_player_tournament_matches', '{}'], ['get_managed_tournament_matches', '{}']]);
  r2.calls.forEach((c) => covered.add(c.name));
  // loadParticipantHub: the hub RPC only — the legacy branding composition (get_tournament_branding_context) is outside the contract.
  const hub = { tournament: { id: 't1', organizationId: ORG, name: 'Copa', logoPath: 'stale' }, audience: { isPlayer: true } };
  const legacyHub = loadLegacy((name) => (name === 'get_tournament_participant_hub' ? hub : null));
  await legacyHub.service.loadParticipantHub({ tournamentId: 't1' });
  assert.deepEqual(legacyHub.calls.filter((c) => c.kind === 'rpc').map((c) => c.name), ['get_tournament_participant_hub', 'get_tournament_branding_context']);
  const r3 = recordingTransport((name) => (name === 'get_tournament_participant_hub' ? hub : null));
  const hybridHub = await loadAdapter(r3.transport).loadParticipantHub({ tournamentId: 't1' });
  assert.deepEqual(r3.calls.map((c) => c.name), ['get_tournament_participant_hub']);
  same(r3.calls[0].params, explicitNulls(legacyHub.calls[0].params));
  same(hybridHub, { ...hub, tournament: { ...hub.tournament, logoPath: null, organizationLogoPath: null } });
  covered.add('get_tournament_participant_hub');
  assert.deepEqual([...covered].sort(), [...COMPETITION_RPCS].sort());
  assert.equal(covered.size, 74);
});

test('venues and courts come from the two certified table routes and map rows exactly like the legacy service; a non-uuid id never reaches the network', async () => {
  const venueRows = [{ id: 'v1', name: 'Club', address: 'Calle', place_id: 'pl', latitude: 1, longitude: 2, locality: 'CABA', timezone: 'America/Argentina/Buenos_Aires', status: 'active', notes: null }];
  const courtRows = [{ id: 'c1', venue_id: 'v1', name: 'Cancha 1', sport_modality: 'football_5', status: 'active', notes: 'n' }];
  const legacy = await loadLegacy(() => null, (table) => (table === 'tournament_venues' ? venueRows : courtRows)).service.loadOrganizationVenues(ORG);
  const recorder = recordingTransport((table) => (table === 'tournament_venues' ? venueRows : courtRows));
  const service = loadAdapter(recorder.transport);
  same(await service.loadOrganizationVenues(ORG), legacy);
  same(recorder.calls, [
    { kind: 'select', table: 'tournament_venues', query: { select: 'id,name,address,place_id,latitude,longitude,locality,timezone,status,notes', organization_id: `eq.${ORG}`, order: 'status.asc,name.asc' } },
    { kind: 'select', table: 'tournament_courts', query: { select: 'id,venue_id,name,sport_modality,status,notes', organization_id: `eq.${ORG}`, order: 'status.asc,name.asc' } },
  ]);
  recorder.calls.length = 0;
  await assert.rejects(service.loadOrganizationVenues('not-a-uuid'), { code: 'TORNEOS_INVALID_REQUEST' });
  assert.deepEqual(recorder.calls, []);
});

test('the hybrid adapter offers no alias outside the contract (service-only actions, roster lock, discipline bookkeeping, media, branding, social)', () => {
  const service = loadAdapter(recordingTransport().transport);
  for (const alias of COMPETITION_EXCLUDED) assert.equal(service[alias], undefined, alias);
  for (const alias of [...Object.keys(COMPETITION_SAMPLE), ...COMPETITION_COMPOSITE]) assert.equal(typeof service[alias], 'function', alias);
});

test('the public page: anonymous transport posts only to the public route, with no credential; the client permits only the public RPC', async () => {
  const fetches = [];
  const fetchImpl = async (url, init) => { fetches.push({ url, init }); return { status: 200, headers: { get: () => 'application/json' }, text: async () => 'null' }; };
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { createTorneosPublicTransport } = rt.load('src/features/torneos/foundation/torneosTransport.js');
  const { createTorneosPublicClient } = rt.load('src/features/torneos/foundation/torneosClient.js');
  const client = createTorneosPublicClient({ transport: createTorneosPublicTransport({ gatewayUrl: 'https://gateway.example.test/functions/v1/torneos-gateway/', fetchImpl }) });
  await client.execute('get_public_tournament_page', { p_public_slug: 'liga-copa', p_category_slug: undefined });
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].url, 'https://gateway.example.test/functions/v1/torneos-gateway/torneos/public/v1/rpc/get_public_tournament_page');
  const { init } = fetches[0];
  assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
  assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'Content-Type']);
  assert.equal(init.body, JSON.stringify({ p_public_slug: 'liga-copa', p_category_slug: null }));
  for (const name of ['get_published_tournament_matches', 'get_tournament_participant_hub', 'get_tournament_workspace_context']) {
    await assert.rejects(client.execute(name, {}), { code: 'TORNEOS_OUTSIDE_STAGING_V1' });
  }
  assert.equal(fetches.length, 1);
  // Refusals and outages are reported, never retried.
  const failing = createTorneosPublicClient({ transport: createTorneosPublicTransport({ gatewayUrl: 'https://gateway.example.test', fetchImpl: async () => ({ status: 503, headers: { get: () => 'application/json' }, text: async () => '{"error":"access denied"}' }) }) });
  await assert.rejects(failing.execute('get_public_tournament_page', { p_public_slug: 'x' }), { code: 'TORNEOS_UNAVAILABLE' });
});

test('the public page composition: hybrid → gateway public route without branding paths; legacy-local → legacy service; anything else closed (no request)', async () => {
  const fetches = [];
  const page = { organization: { name: 'Liga', logoPath: 'org/logo.png' }, tournament: { name: 'Copa', logoPath: 't/logo.png' }, teams: [{ name: 'A', shieldPath: 'a.png' }], competition: [] };
  const fetchImpl = async (url, init) => { fetches.push({ url, init }); return { status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(page) }; };
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { resolvePublicTournamentService, closedPublicTournamentService } = rt.load(COMPOSITION);
  const legacyService = { mode: 'legacy', loadPage: async () => 'legacy' };
  const on = { torneosEnabled: true, publicPages: true };
  const hybridEnv = { REACT_APP_SUPABASE_URL: 'https://core.example.test', REACT_APP_TORNEOS_GATEWAY_URL: 'https://gateway.example.test' };
  const hybrid = resolvePublicTournamentService({ env: hybridEnv, flags: on, legacyService, fetchImpl });
  assert.equal(hybrid.mode, 'hybrid');
  same(await hybrid.loadPage({ publicSlug: 'liga-copa' }), { organization: { name: 'Liga', logoPath: null }, tournament: { name: 'Copa', logoPath: null }, teams: [{ name: 'A', shieldPath: null }], competition: [] });
  assert.equal(fetches.length, 1);
  assert.equal(await hybrid.loadPage({ publicSlug: 'INVALID/' }), null);
  assert.equal(fetches.length, 1, 'an invalid slug never reaches the network');
  assert.equal(resolvePublicTournamentService({ env: { REACT_APP_TORNEOS_DATA_ENV: 'local' }, flags: on, legacyService }), legacyService);
  for (const [env, flags] of [[hybridEnv, { torneosEnabled: true, publicPages: false }], [hybridEnv, { torneosEnabled: false, publicPages: true }],
    [{ REACT_APP_SUPABASE_URL: 'https://core.example.test' }, on], [{}, on]]) {
    const closed = resolvePublicTournamentService({ env, flags, legacyService, fetchImpl });
    assert.equal(closed, closedPublicTournamentService, JSON.stringify({ env, flags }));
    assert.equal(await closed.loadPage({ publicSlug: 'liga-copa' }), null);
  }
  // A static map without public pages keeps the hybrid composition closed too.
  assert.equal(resolvePublicTournamentService({ env: hybridEnv, flags: on, features: { public_pages: false }, legacyService, fetchImpl }), closedPublicTournamentService);
  assert.equal(fetches.length, 1);
  assert.equal(rt.networkCalls(), 0);
});
