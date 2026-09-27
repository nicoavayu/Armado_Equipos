// T2 / T3: the staging-v1 workspace adapter.
//   • exactly the legacy aliases of the 34 migrable RPCs (+ the table read for members)
//   • the same RPC name and p_* payload the legacy service sends — checked by running
//     the REAL legacy service against a recording Core stub and the adapter against a
//     recording transport, alias by alias
//   • nothing outside the scope, nothing that points at the Core singleton
//   • boundary errors become TournamentWorkspaceError with stable codes/copy
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';
import { COMPETITION_SAMPLE, COMPETITION_COMPOSITE, COMPETITION_EXCLUDED } from './competition-samples.mjs';
// OFFICIALIZATION-V1: membership + dual-control aliases (their payloads are guarded in officialization-adapter.test.mjs).
const OFFICIALIZATION_ALIASES = ['listMemberInvitations', 'inviteMember', 'revokeMemberInvitation', 'acceptOrganizationInvitation',
  'updateMemberRole', 'removeMember', 'loadMatchDualControl', 'setMatchDualControl'];

const SCOPE = JSON.parse(read('backend/torneos/phase2d/staging-v1-rpc-allowlist.json')).features;
const ALLOWLIST = new Set(Object.values(SCOPE).flat());
const ADAPTER = 'src/features/torneos/stagingV1/stagingV1WorkspaceService.js';
const LEGACY = 'src/features/torneos/api/tournamentWorkspaceService.js';
const ORG = '33333333-3333-4333-8333-333333333333';
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

function loadAdapter(transport) {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const mod = rt.load(ADAPTER);
  return { rt, mod, service: mod.createStagingV1WorkspaceService({ transport }) };
}

function loadLegacy() {
  const calls = [];
  const rows = [];
  const from = (table) => {
    const call = { kind: 'from', table, ops: [] };
    calls.push(call);
    const builder = new Proxy({}, {
      get: (_, op) => {
        if (op === 'then') return (resolve) => resolve({ data: rows, error: null });
        return (...args) => { call.ops.push([op, ...args]); return builder; };
      },
    });
    return builder;
  };
  const supabase = {
    rpc: async (name, params) => { calls.push({ kind: 'rpc', name, params }); return { data: null, error: null }; },
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
  return { rt, calls, service: rt.load(LEGACY).tournamentWorkspaceService };
}

// One representative input per alias, in the shape the pages send.
const SAMPLE = {
  loadContext: [],
  setPreference: ['tournament_organization', ORG],
  createOrganization: [{ name: 'Liga', slug: 'liga', idempotencyKey: 'k1' }],
  checkSlugAvailability: ['liga'],
  updateOrganization: [{ organizationId: ORG, name: 'Liga 2', slug: null, status: null }],
  setTournamentContext: [{ organizationId: ORG, seasonId: 's1', tournamentId: 't1' }],
  loadMyTournaments: [{ limit: 18, offset: 36 }],
  listSeasonMemberAssignments: [{ organizationId: ORG, seasonId: 's1' }],
  assignSeasonMember: [{ organizationId: ORG, seasonId: 's1', membershipId: 'm1' }],
  removeSeasonMemberAssignment: [{ organizationId: ORG, seasonId: 's1', membershipId: 'm1' }],
  createSeason: [{ organizationId: ORG, name: 'Apertura', slug: 'apertura', startDate: '', endDate: null, idempotencyKey: 'k2' }],
  updateSeason: [{ organizationId: ORG, seasonId: 's1', name: 'Apertura', startDate: '', endDate: '2027-01-01', status: 'active' }],
  createTournament: [{ organizationId: ORG, seasonId: 's1', name: 'Copa', slug: 'copa', description: '', sportModality: 'f5', competitionFormat: 'league', genderCategory: 'mixed', startDate: null, endDate: '', idempotencyKey: 'k3' }],
  updateTournament: [{ organizationId: ORG, tournamentId: 't1', patch: { name: 'Copa 2' } }],
  saveCategory: [{ organizationId: ORG, tournamentId: 't1', name: 'Libre', slug: 'libre' }],
  changeTournamentStatus: [{ organizationId: ORG, tournamentId: 't1', status: 'registration' }],
  loadTeamsContext: [ORG, 't1'],
  loadTeamRegistration: [ORG, 'e1'],
  createTeamEntry: [{ organizationId: ORG, tournamentId: 't1', categoryId: 'c1', arma2TeamId: null, name: 'Equipo', shortName: '', primaryColor: '#000', secondaryColor: '', registrationSource: 'provisional', managerEmail: 'x@example.test', managerDisplayName: 'X', idempotencyKey: 'k4' }],
  updateTeamEntry: [{ organizationId: ORG, teamEntryId: 'e1', patch: { name: 'E' } }],
  createProvisionalPlayer: [{ organizationId: ORG, teamEntryId: 'e1', displayName: 'Ana' }],
  // shirtNumber deliberately omitted: the page's "add player" never sets it.
  addRosterPlayer: [{ organizationId: ORG, teamEntryId: 'e1', rosterId: 'r1', arma2UserId: 'u1', displayName: 'Ana', avatarUrl: null, primaryPosition: 'DEF', isGoalkeeper: false }],
  updateRosterPlayer: [{ organizationId: ORG, teamEntryId: 'e1', rosterPlayerId: 'p1', shirtNumber: 9, primaryPosition: null, secondaryPosition: 'MED', isGoalkeeper: true }],
  removeRosterPlayer: [{ organizationId: ORG, teamEntryId: 'e1', rosterPlayerId: 'p1' }],
  submitTeamEntry: [{ organizationId: ORG, teamEntryId: 'e1' }],
  withdrawTeamEntry: [{ organizationId: ORG, teamEntryId: 'e1', reason: 'r' }],
  archiveTeamEntry: [{ organizationId: ORG, teamEntryId: 'e1', reason: 'r' }],
  loadTournamentCreationEligibility: [{ organizationId: ORG }],
  searchPlayers: [{ organizationId: ORG, tournamentId: 't1', teamEntryId: 'e1', query: 'an' }],
  inviteTeamManager: [{ organizationId: ORG, teamEntryId: 'e1', email: 'c@example.test', displayName: 'C' }],
  acceptTeamInvitation: ['token-placeholder'],
  searchArma2Teams: [{ organizationId: ORG, tournamentId: 't1', query: 'eq' }],
  reviewTeamEntry: [{ organizationId: ORG, teamEntryId: 'e1', decision: 'approved', reason: 'ok' }],
};
// The 9 allowlisted predicates without a UI caller (the UI receives them embedded).
const PREDICATES_WITHOUT_CALLER = ['is_tournament_organization_member', 'has_tournament_organization_capability', 'has_tournament_capability',
  'tournament_role_capabilities', 'has_tournament_season_access', 'has_tournament_season_capability', 'has_organization_consumed_free_tournament',
  'can_read_tournament_team_entry', 'is_tournament_team_manager'];
const MIGRABLE = [...ALLOWLIST].filter((name) => !PREDICATES_WITHOUT_CALLER.includes(name));

test('the adapter exposes exactly the legacy aliases of the staging-v1 + COMPETITION-V1 scope, the OFFICIALIZATION-V1 aliases and nothing of the blocked surfaces', () => {
  const { service } = loadAdapter(recordingTransport().transport);
  const aliases = Object.keys(service).sort();
  const expected = [...Object.keys(SAMPLE), 'listMembers', 'loadCompetitionContext', 'loadExperienceRelations', 'createIdempotencyKey',
    ...Object.keys(COMPETITION_SAMPLE), ...COMPETITION_COMPOSITE, ...OFFICIALIZATION_ALIASES].sort();
  assert.deepEqual(aliases, expected);
  assert.ok(Object.isFrozen(service));
  for (const blocked of ['loadEntitlements', 'loadSeasonEntitlements', 'createCheckout', 'loadPurchase', ...COMPETITION_EXCLUDED]) {
    assert.equal(service[blocked], undefined, blocked);
  }
});

test('every alias sends the same RPC name and p_* payload as the legacy service; together they cover the 34 migrable RPCs and no other', async () => {
  const legacy = loadLegacy();
  const recorder = recordingTransport();
  const { service } = loadAdapter(recorder.transport);
  const covered = new Set();
  for (const [alias, args] of Object.entries(SAMPLE)) {
    legacy.calls.length = 0; recorder.calls.length = 0;
    await legacy.service[alias](...args);
    await service[alias](...args);
    const expected = legacy.calls.filter((c) => c.kind === 'rpc');
    assert.equal(expected.length, 1, `${alias}: legacy makes one RPC`);
    assert.equal(recorder.calls.length, 1, `${alias}: adapter makes one call`);
    assert.equal(recorder.calls[0].kind, 'rpc', alias);
    assert.equal(recorder.calls[0].name, expected[0].name, alias);
    // A zero-argument legacy call sends no params object; the gateway RPC route gets `{}`.
    // An argument the page leaves undefined travels as an explicit null (PostgREST
    // needs every declared argument): compare both sides with that normalization.
    const explicitNulls = (params) => Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, v === undefined ? null : v]));
    same(recorder.calls[0].params, explicitNulls(expected[0].params));
    assert.ok(!Object.values(recorder.calls[0].params).includes(undefined), `${alias}: no undefined argument leaves the client`);
    assert.ok(ALLOWLIST.has(recorder.calls[0].name), `${alias} → ${recorder.calls[0].name} is allowlisted`);
    covered.add(recorder.calls[0].name);
  }
  // loadCompetitionContext: the legacy composes a blocked branding RPC; the adapter must not.
  legacy.calls.length = 0; recorder.calls.length = 0;
  await legacy.service.loadCompetitionContext(ORG);
  assert.deepEqual(legacy.calls.filter((c) => c.kind === 'rpc').map((c) => c.name), ['get_tournament_competition_context', 'get_tournament_branding_context']);
  const context = await loadAdapter(recordingTransport((name) => (name === 'get_tournament_competition_context'
    ? { seasons: [{ id: 's1' }], tournaments: [{ id: 't1', seasonId: 's1', logoPath: 'stale' }], modalities: [], formats: [], preference: {} }
    : null)).transport).service.loadCompetitionContext(ORG);
  same(context, { seasons: [{ id: 's1' }], tournaments: [{ id: 't1', seasonId: 's1', logoPath: null, organizationLogoPath: null }], modalities: [], formats: [], preference: {}, organizationBranding: null });
  covered.add('get_tournament_competition_context');
  assert.deepEqual([...covered].sort(), MIGRABLE.sort());
  assert.equal(covered.size, 34);
});

test('loadExperienceRelations paginates get_my_tournament_memberships like the legacy service (page 50, max 500)', async () => {
  const pages = [{ items: Array.from({ length: 50 }, (_, i) => ({ id: i })), pagination: { hasMore: true } }, { items: [{ id: 50 }], pagination: { hasMore: false } }];
  const recorder = recordingTransport(() => pages.shift());
  const { service } = loadAdapter(recorder.transport);
  const result = await service.loadExperienceRelations();
  assert.equal(result.items.length, 51);
  assert.deepEqual(recorder.calls.map((c) => [c.name, c.params.p_limit, c.params.p_offset]), [['get_my_tournament_memberships', 50, 0], ['get_my_tournament_memberships', 50, 50]]);
});

test('listMembers reads the OFFICIALIZATION-V1 membership RPC (it replaced the Phase 2D table read); a non-uuid id never reaches the network', async () => {
  const recorder = recordingTransport(() => [{ id: 'm1', userId: 'u1', role: 'owner', status: 'active' }]);
  const { service } = loadAdapter(recorder.transport);
  same(await service.listMembers(ORG), [{ id: 'm1', user_id: 'u1', role: 'owner', status: 'active', email: null, is_viewer: false }]);
  same(recorder.calls[0], { kind: 'rpc', name: 'list_tournament_organization_members', params: { p_organization_id: ORG } });
  await assert.rejects(service.listMembers("x' or 1=1"), { code: 'TORNEOS_INVALID_REQUEST' });
  assert.equal(recorder.calls.length, 1);
});

test('T3 — statuses served by other RPCs (active/completed/scheduled) are refused before the network; only draft/registration/archived leave the client', async () => {
  const recorder = recordingTransport();
  const { service } = loadAdapter(recorder.transport);
  for (const status of ['active', 'completed', 'scheduled', 'cancelled', '', null]) {
    await assert.rejects(service.changeTournamentStatus({ organizationId: ORG, tournamentId: 't1', status }), { code: 'TORNEOS_INVALID_TOURNAMENT_TRANSITION' });
  }
  assert.equal(recorder.calls.length, 0);
  for (const status of ['draft', 'registration', 'archived']) await service.changeTournamentStatus({ organizationId: ORG, tournamentId: 't1', status });
  assert.deepEqual(recorder.calls.map((c) => c.params.p_status), ['draft', 'registration', 'archived']);
});

test('boundary errors become TournamentWorkspaceError with the codes and copy the pages already understand', async () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { TorneosBoundaryError } = rt.load('src/features/torneos/foundation/errors.js');
  const { ERROR_MESSAGES } = rt.load('src/features/torneos/api/tournamentWorkspaceErrors.js');
  const { createStagingV1WorkspaceService, BOUNDARY_MESSAGES } = rt.load(ADAPTER);
  const failWith = (error) => createStagingV1WorkspaceService({ transport: { rpc: async () => { throw error; }, select: async () => { throw error; } } });
  const cases = [
    [new TorneosBoundaryError('CORE_AUTH_REQUIRED'), 'TORNEOS_AUTH_REQUIRED', ERROR_MESSAGES.TORNEOS_AUTH_REQUIRED],
    [new TorneosBoundaryError('TORNEOS_SESSION_INVALID', { status: 401 }), 'TORNEOS_AUTH_REQUIRED', ERROR_MESSAGES.TORNEOS_AUTH_REQUIRED],
    [new TorneosBoundaryError('TORNEOS_EXCHANGE_DENIED', { status: 401 }), 'TORNEOS_AUTH_REQUIRED', ERROR_MESSAGES.TORNEOS_AUTH_REQUIRED],
    [new TorneosBoundaryError('CORE_UNAVAILABLE', { status: 503 }), 'CORE_UNAVAILABLE', BOUNDARY_MESSAGES.CORE_UNAVAILABLE],
    [new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: 503 }), 'TORNEOS_UNAVAILABLE', BOUNDARY_MESSAGES.TORNEOS_UNAVAILABLE],
    [new TorneosBoundaryError('TORNEOS_FORBIDDEN', { status: 403 }), 'TORNEOS_FORBIDDEN', BOUNDARY_MESSAGES.TORNEOS_FORBIDDEN],
    [new TorneosBoundaryError('TORNEOS_RATE_LIMITED', { status: 429 }), 'TORNEOS_RATE_LIMITED', BOUNDARY_MESSAGES.TORNEOS_RATE_LIMITED],
    [new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1'), 'TORNEOS_OUTSIDE_STAGING_V1', BOUNDARY_MESSAGES.TORNEOS_OUTSIDE_STAGING_V1],
    [new TorneosBoundaryError('TORNEOS_RPC_ERROR', { status: 400, rpcError: { message: 'TORNEOS_SLUG_TAKEN', code: 'P0001', details: null, hint: null } }), 'TORNEOS_SLUG_TAKEN', ERROR_MESSAGES.TORNEOS_SLUG_TAKEN],
    [new TorneosBoundaryError('TORNEOS_RPC_ERROR', { status: 403, rpcError: { message: 'TORNEOS_RESOURCE_FORBIDDEN', code: 'TORNEOS_RESOURCE_FORBIDDEN', details: null, hint: null } }), 'TORNEOS_RESOURCE_FORBIDDEN', ERROR_MESSAGES.TORNEOS_RESOURCE_FORBIDDEN],
    [new TorneosBoundaryError('TORNEOS_RPC_ERROR', { status: 429, rpcError: { message: 'TORNEOS_SEARCH_RATE_LIMITED', code: 'TORNEOS_SEARCH_RATE_LIMITED', details: null, hint: null } }), 'TORNEOS_SEARCH_RATE_LIMITED', ERROR_MESSAGES.TORNEOS_SEARCH_RATE_LIMITED],
    [new TorneosBoundaryError('TORNEOS_RPC_ERROR', { status: 404, rpcError: { message: 'CORE_DENIED', code: 'CORE_DENIED', details: null, hint: null } }), 'CORE_DENIED', BOUNDARY_MESSAGES.CORE_DENIED],
    [new TorneosBoundaryError('TORNEOS_RPC_ERROR', { status: 403, rpcError: { message: 'permission denied for function x', code: '42501', details: null, hint: null } }), 'TORNEOS_REQUEST_FAILED', 'No pudimos cargar tus espacios. Revisá la conexión y volvé a intentar.'],
  ];
  for (const [error, code, message] of cases) {
    await assert.rejects(failWith(error).loadContext(), (thrown) => {
      assert.equal(thrown.name, 'TournamentWorkspaceError', error.code);
      assert.equal(thrown.code, code, error.code);
      assert.equal(thrown.message, message, error.code);
      // RPC errors with a legacy code keep the PostgREST body as cause (lifecycle
      // copy reads `details`); every other failure keeps the boundary error itself.
      const gatewayCode = error.code === 'TORNEOS_RPC_ERROR' && BOUNDARY_MESSAGES[error.rpcError.code] && !ERROR_MESSAGES[code];
      assert.equal(thrown.cause, error.code === 'TORNEOS_RPC_ERROR' && !gatewayCode ? error.rpcError : error);
      return true;
    });
  }
});

test('T2 — with the transport failing, the Core singleton receives zero calls and the adapter holds no legacy function', async () => {
  const legacy = loadLegacy();
  const legacyFunctions = new Set(Object.values(legacy.service).filter((v) => typeof v === 'function'));
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { TorneosBoundaryError } = rt.load('src/features/torneos/foundation/errors.js');
  const { createStagingV1WorkspaceService } = rt.load(ADAPTER);
  const service = createStagingV1WorkspaceService({ transport: { rpc: async () => { throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: 503 }); }, select: async () => { throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: 503 }); } } });
  for (const [alias, args] of Object.entries(SAMPLE)) {
    await assert.rejects(service[alias](...args), { code: 'TORNEOS_UNAVAILABLE' });
  }
  await assert.rejects(service.listMembers(ORG), { code: 'TORNEOS_UNAVAILABLE' });
  assert.equal(legacy.calls.length, 0, 'the legacy/Core path was never reached');
  for (const value of Object.values(service)) assert.ok(!legacyFunctions.has(value));
  assert.equal(rt.creations.length, 0); assert.equal(rt.networkCalls(), 0);
  const source = read(ADAPTER);
  for (const forbidden of ['supabaseClient', 'services/api/supabase', 'tournamentWorkspaceService\'', '.rpc(', '.from(', '.storage.', 'functions.invoke', 'localStorage', 'createClient']) {
    assert.ok(!source.includes(forbidden), `adapter must not reference ${forbidden}`);
  }
});

test('the adapter refuses to be built without a connected transport', () => {
  const rt = runtime({ modules: { uuid: uuidStub } });
  const { createStagingV1WorkspaceService } = rt.load(ADAPTER);
  assert.throws(() => createStagingV1WorkspaceService({ transport: null }), { code: 'TORNEOS_TRANSPORT_NOT_CONNECTED' });
  assert.throws(() => createStagingV1WorkspaceService({}), { code: 'TORNEOS_TRANSPORT_NOT_CONNECTED' });
});
