// T4 / T7 + COMPETITION-V1 — the hybrid composition renders the full competition journey with ONLY
// the adapter, while every surface that stays OFF (media, social studio, billing/plan, branding
// uploads, portraits, team photos, visual policy) stays off without a request and without touching
// the Core singleton. The singleton is replaced by a proxy that records — and refuses — any access:
// a bypass would show up here as an access. The last block drives the REAL hybrid adapter over a
// recording transport: every RPC that leaves the client belongs to the two gateway allowlists.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import StagingV1TorneosApp from '../features/torneos/stagingV1/StagingV1TorneosApp';
import { stagingV1Features, competitionV1OnFeatures, officializationV1OnFeatures, stagingV1OnFeatures } from '../features/torneos/stagingV1/stagingV1Features';
import { createStagingV1WorkspaceService } from '../features/torneos/stagingV1/stagingV1WorkspaceService';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import stagingAllowlist from '../../backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json';
import competitionAllowlist from '../../backend/torneos/supabase/functions/torneos-gateway/competition-v1-rpc-allowlist.json';
import officializationAllowlist from '../../backend/torneos/supabase/functions/torneos-gateway/officialization-v1-rpc-allowlist.json';

const coreAccesses = [];
jest.mock('../lib/supabaseClient', () => {
  const trap = new Proxy({}, {
    get(_, property) {
      if (property === '__esModule') return false;
      if (property === 'then') return undefined;
      // eslint-disable-next-line no-undef
      coreAccesses.push(String(property));
      throw new Error(`Core singleton accessed from the hybrid composition: ${String(property)}`);
    },
  });
  return { supabase: trap, supabaseCore: trap, default: trap };
});
jest.mock('../components/global-header/GlobalHeader', () => () => <header data-testid="global-header" />);

const ORG = '91000000-0000-4000-8000-000000000001';
const SEASON = '92000000-0000-4000-8000-000000000001';
const TOURNAMENT = '93000000-0000-4000-8000-000000000001';
const ENTRY = '94000000-0000-4000-8000-000000000001';
const CATEGORY = '95000000-0000-4000-8000-000000000001';
const PHASE = '96000000-0000-4000-8000-000000000001';

function competition() {
  return {
    preference: { organizationId: ORG, activeSeasonId: SEASON, activeTournamentId: TOURNAMENT },
    seasons: [{ id: SEASON, organizationId: ORG, name: 'Apertura 2026', status: 'active' }],
    tournaments: [{
      id: TOURNAMENT,
      organizationId: ORG,
      seasonId: SEASON,
      name: 'Liga Híbrida',
      slug: 'liga-hibrida',
      status: 'registration',
      sportModality: 'football_5',
      competitionFormat: 'league',
      genderCategory: 'mixed',
      categories: [{ id: CATEGORY, name: 'Primera', status: 'active', sortOrder: 0 }],
      checklist: { ready: true, checks: {} },
      logoPath: null,
      organizationLogoPath: null,
    }],
    modalities: [{ id: 'football_5', name: 'Fútbol 5' }],
    formats: [{ id: 'league', name: 'Liga' }],
  };
}

function registration() {
  return {
    entry: { id: ENTRY, organizationId: ORG, tournamentId: TOURNAMENT, categoryId: CATEGORY, name: 'Napoli', status: 'in_progress', linked: false },
    tournament: { id: TOURNAMENT, name: 'Liga Híbrida', status: 'registration' },
    category: { id: CATEGORY, name: 'Primera' },
    settings: { minimumPlayers: 5, maximumPlayers: 10, minimumGoalkeepers: 1, shirtNumberRequired: false, uniqueShirtNumbers: true, positionRequired: false, allowProvisionalPlayers: true },
    managers: [{ id: 'manager-a', displayName: 'Nico Capitán', role: 'captain', status: 'active', isCurrentUser: false }],
    roster: { id: 'roster-a', version: 1, status: 'draft', players: [{ id: 'player-1', displayName: 'Ana Gol', arma2UserId: null, shirtNumber: 9, primaryPosition: 'DEL', eligibilityStatus: 'eligible' }] },
    reviews: [],
    audit: [],
    visualAssets: { policy: 'organization_only', canManageShield: true, canManagePortraits: true },
  };
}

function hub() {
  return {
    tournament: { id: TOURNAMENT, organizationId: ORG, organizationName: 'Liga Devoto', name: 'Liga Híbrida', status: 'active', seasonName: 'Apertura 2026', readOnly: false, logoPath: null, organizationLogoPath: null },
    audience: { organizationRole: null, managerRole: null, isPlayer: true, canManageTournament: false, canManageTeam: false },
    categories: [{ id: CATEGORY, name: 'Primera' }],
    activeCategoryId: CATEGORY,
    competition: { hasPublishedFixture: true, phaseId: PHASE, groupId: null, phases: [{ id: PHASE, name: 'Fase regular' }], groups: [] },
    nextMatches: [],
    recentResults: [],
    standings: [],
    topScorers: [],
    myStatistics: { appearances: 0, starts: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 },
    mySuspensions: [],
    myTeam: null,
    alerts: [],
  };
}

const membership = { tournamentId: TOURNAMENT, teamEntryId: ENTRY, categoryId: CATEGORY, tournamentName: 'Liga Híbrida', seasonName: 'Apertura 2026', categoryName: 'Primera', organizationName: 'Liga Devoto', teamName: 'Napoli', role: 'player', tournamentStatus: 'active' };

// The hybrid adapter surface (staging v1 + COMPETITION-V1) and nothing else: exactly what
// createStagingV1WorkspaceService exposes (adapter.test.mjs / competition-adapter.test.mjs pin that list).
function createAdapter() {
  const organization = { id: ORG, name: 'Liga Devoto', slug: 'liga-devoto', role: 'owner', status: 'active', capabilities: getCapabilitiesForRole('owner') };
  return Object.freeze({
    loadContext: jest.fn().mockResolvedValue({ preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG }, organizations: [organization] }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    createOrganization: jest.fn(),
    checkSlugAvailability: jest.fn(),
    updateOrganization: jest.fn(),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    loadMyTournaments: jest.fn().mockResolvedValue({ items: [membership], pagination: { hasMore: false } }),
    loadExperienceRelations: jest.fn().mockResolvedValue({ items: [membership], pagination: { hasMore: false } }),
    listMembers: jest.fn().mockResolvedValue([
      { id: 'member-owner', user_id: 'owner-user', role: 'owner', status: 'active', joined_at: '2026-08-01T12:00:00Z' },
      { id: 'member-admin', user_id: 'admin-user', role: 'admin', status: 'active', joined_at: '2026-08-02T12:00:00Z' },
    ]),
    listSeasonMemberAssignments: jest.fn().mockResolvedValue([]),
    assignSeasonMember: jest.fn(),
    removeSeasonMemberAssignment: jest.fn(),
    loadCompetitionContext: jest.fn().mockResolvedValue(competition()),
    createSeason: jest.fn(),
    updateSeason: jest.fn(),
    createTournament: jest.fn(),
    updateTournament: jest.fn(),
    saveCategory: jest.fn(),
    changeTournamentStatus: jest.fn(),
    loadTeamsContext: jest.fn().mockResolvedValue({ settings: { minimumPlayers: 5 }, entries: [{ id: ENTRY, name: 'Napoli', categoryName: 'Primera', status: 'approved', linked: false, manager: { displayName: 'Nico Capitán' }, roster: { playerCount: 5, goalkeeperCount: 1 } }] }),
    loadTeamRegistration: jest.fn().mockResolvedValue(registration()),
    createTeamEntry: jest.fn(),
    updateTeamEntry: jest.fn(),
    createProvisionalPlayer: jest.fn(),
    addRosterPlayer: jest.fn(),
    updateRosterPlayer: jest.fn(),
    removeRosterPlayer: jest.fn(),
    submitTeamEntry: jest.fn(),
    withdrawTeamEntry: jest.fn(),
    archiveTeamEntry: jest.fn(),
    loadTournamentCreationEligibility: jest.fn(),
    searchPlayers: jest.fn().mockResolvedValue([]),
    inviteTeamManager: jest.fn(),
    acceptTeamInvitation: jest.fn(),
    searchArma2Teams: jest.fn().mockResolvedValue([]),
    reviewTeamEntry: jest.fn(),
    // COMPETITION-V1
    loadFixtureContext: jest.fn().mockResolvedValue({
      versions: [{ id: 'fixture-a', status: 'published' }],
      phases: [{ id: PHASE, fixtureVersionId: 'fixture-a', name: 'Fase regular' }],
    }),
    loadScheduleContext: jest.fn().mockResolvedValue({}),
    freezeParticipants: jest.fn(),
    reopenParticipants: jest.fn(),
    saveDrawPots: jest.fn(),
    executeGroupDraw: jest.fn(),
    generateFixture: jest.fn(),
    createManualFixture: jest.fn(),
    updateDraftFixture: jest.fn(),
    validateFixture: jest.fn(),
    publishFixture: jest.fn(),
    appendPlayoffPhase: jest.fn(),
    supersedeFixture: jest.fn(),
    loadOrganizationVenues: jest.fn().mockResolvedValue({ venues: [], courts: [] }),
    createVenue: jest.fn(),
    createCourt: jest.fn(),
    saveScheduleWindows: jest.fn(),
    validateMatchSchedule: jest.fn(),
    scheduleMatch: jest.fn(),
    rescheduleMatch: jest.fn(),
    autoScheduleMatches: jest.fn(),
    loadPlayerMatches: jest.fn().mockResolvedValue([]),
    respondMatchAvailability: jest.fn(),
    loadMatchSquad: jest.fn(),
    loadMyManagedMatchSquad: jest.fn(),
    saveMatchSquad: jest.fn(),
    submitMatchSquad: jest.fn(),
    loadMatchOperations: jest.fn().mockResolvedValue({ matches: [] }),
    loadMatchOperation: jest.fn(),
    openMatchOperation: jest.fn(),
    setMatchOutcome: jest.fn(),
    setMatchScore: jest.fn(),
    addMatchEvent: jest.fn(),
    voidMatchEvent: jest.fn(),
    submitMatchOperation: jest.fn(),
    reviewMatchOperation: jest.fn(),
    validateMatchOperation: jest.fn(),
    makeMatchOfficial: jest.fn(),
    requestMatchCorrection: jest.fn(),
    createMatchCorrection: jest.fn(),
    loadStandings: jest.fn().mockResolvedValue({ revision: null, standings: [] }),
    loadStatistics: jest.fn().mockResolvedValue({ players: [], teams: [], discipline: [] }),
    rebuildStandings: jest.fn(),
    publishStandings: jest.fn(),
    resolveQualification: jest.fn(),
    startCompetition: jest.fn(),
    finishCompetition: jest.fn(),
    reopenCompetition: jest.fn(),
    withdrawCompetitionParticipant: jest.fn(),
    loadParticipantHub: jest.fn().mockResolvedValue(hub()),
    setHubCategory: jest.fn(),
    loadPublishedMatches: jest.fn().mockResolvedValue({ items: [], pagination: { total: 0 } }),
    loadParticipantMatch: jest.fn(),
    loadPublishedTeams: jest.fn().mockResolvedValue({ items: [], pagination: { total: 0 } }),
    loadPublishedStandings: jest.fn().mockResolvedValue({ standings: [] }),
    loadPublishedStatistics: jest.fn().mockResolvedValue({ players: [], teams: [], discipline: [] }),
    loadCommunicationsInbox: jest.fn().mockResolvedValue({ items: [], unreadCount: 0, pagination: { total: 0 } }),
    loadAnnouncement: jest.fn(),
    markAnnouncementRead: jest.fn(),
    loadNotificationPreferences: jest.fn().mockResolvedValue({ tournamentId: TOURNAMENT, general: true, matchChanges: true, callups: true, discipline: true, documents: true, summaries: true, channels: { internal: true, push: false, email: false } }),
    updateNotificationPreferences: jest.fn(),
    loadPublishedDocuments: jest.fn().mockResolvedValue({ items: [] }),
    acknowledgeDocument: jest.fn(),
    loadCommunicationsAdminContext: jest.fn().mockResolvedValue({ organizationId: ORG, scheduledPublishingEnabled: false, channels: { internal: true, push: false, email: false }, capabilities: ['announcements.read', 'announcements.create', 'announcements.update_draft', 'announcements.publish', 'documents.read', 'documents.create', 'documents.update_draft', 'documents.publish', 'audiences.preview'], tournaments: [], announcements: [], documents: [] }),
    createAnnouncementDraft: jest.fn(),
    replaceAnnouncementAudience: jest.fn(),
    setAnnouncementLink: jest.fn(),
    updateAnnouncementDraft: jest.fn(),
    previewAnnouncementAudience: jest.fn(),
    publishAnnouncement: jest.fn(),
    createDocument: jest.fn(),
    publishDocumentVersion: jest.fn(),
    loadPublicPageSettings: jest.fn().mockResolvedValue({ published: false, publicSlug: null, canPublish: true, reasons: [] }),
    setPublicPagePublished: jest.fn(),
    createIdempotencyKey: jest.fn(() => 'request-key'),
  });
}

let currentPath = '';
function LocationProbe() {
  const location = useLocation();
  currentPath = `${location.pathname}${location.search}`;
  return null;
}

function renderPath(path, adapter = createAdapter()) {
  currentPath = path;
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/torneos/*" element={<StagingV1TorneosApp gatewayUrl="https://gateway.example.test" service={adapter} />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...utils, adapter };
}

const unavailable = async () => screen.findByText(/todavía no está habilitada/);
const notUnavailable = () => expect(screen.queryByText(/todavía no está habilitada/)).toBeNull();

describe('hybrid composition — full competition through the adapter; OFF surfaces stay off without requests', () => {
  beforeEach(() => { coreAccesses.length = 0; });
  afterEach(() => { expect(coreAccesses).toEqual([]); });

  test('the sidebar offers the competition surfaces and the tournament index opens the fixture', async () => {
    const { adapter } = renderPath(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}`);
    await waitFor(() => expect(currentPath).toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/fixture`));
    const nav = screen.getAllByRole('navigation', { name: /Navegación de la organización/ })[0];
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Inicio', 'Torneos', 'Equipos', 'Fixture', 'Partidos', 'Competencia', 'Comunicaciones', 'Configuración']);
    await waitFor(() => expect(adapter.loadFixtureContext).toHaveBeenCalledWith(ORG, TOURNAMENT, CATEGORY));
    expect(adapter.loadScheduleContext).toHaveBeenCalledWith(ORG, TOURNAMENT, CATEGORY);
  });

  test.each([
    ['fixture', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/fixture`, 'loadFixtureContext'],
    ['programacion', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/programacion`, 'loadScheduleContext'],
    ['partidos', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos`, 'loadMatchOperations'],
    ['competencia/tabla', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/competencia/tabla`, 'loadStandings'],
    ['competencia/estadisticas', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/competencia/estadisticas`, 'loadStatistics'],
    ['sedes', `/torneos/organizacion/${ORG}/sedes`, 'loadOrganizationVenues'],
    ['comunicaciones', `/torneos/organizacion/${ORG}/comunicaciones`, 'loadCommunicationsAdminContext'],
    ['mis-partidos', '/torneos/mis-partidos', 'loadPlayerMatches'],
    ['comunicados', '/torneos/comunicados', 'loadCommunicationsInbox'],
    ['hub', `/torneos/torneo/${TOURNAMENT}`, 'loadParticipantHub'],
  ])('%s renders its screen through the adapter', async (_, path, alias) => {
    const { adapter } = renderPath(path);
    await waitFor(() => expect(adapter[alias]).toHaveBeenCalled());
    notUnavailable();
  });

  test.each([
    ['plan', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/plan`],
    ['configuracion/plan', `/torneos/organizacion/${ORG}/configuracion/plan`],
    ['identidad-visual', `/torneos/organizacion/${ORG}/equipos/${ENTRY}/identidad-visual`],
  ])('%s (OFF) renders the unavailable page instead of its screen', async (_, path) => {
    const { adapter } = renderPath(path);
    await unavailable();
    for (const blocked of ['loadPurchase', 'loadSeasonEntitlements', 'loadTeamVisualPolicy', 'loadMediaAdminContext', 'loadPublishedMedia', 'archiveFixture', 'changeMatchPlan', 'lockRoster']) {
      expect(adapter[blocked]).toBeUndefined();
    }
  });

  test('participant hub — no Fotos section (media OFF): the gallery is never mounted and /fotos goes back to the hub', async () => {
    const { adapter } = renderPath(`/torneos/torneo/${TOURNAMENT}/fotos`);
    await waitFor(() => expect(currentPath.startsWith(`/torneos/torneo/${TOURNAMENT}?`)).toBe(true));
    await waitFor(() => expect(adapter.loadParticipantHub).toHaveBeenCalled());
    const sections = await screen.findByRole('navigation', { name: 'Secciones del torneo' });
    const labels = within(sections).getAllByRole('link').map((link) => link.textContent.trim());
    expect(labels).toEqual(['Resumen', 'Novedades', 'Partidos', 'Tabla', 'Estadísticas', 'Equipos', 'Disciplina']);
    expect(adapter.loadPublishedMedia).toBeUndefined();
  });

  test('F8(a) — the wizard of an existing tournament shows the public page settings (through the adapter), never visual policy or logo upload', async () => {
    const { adapter } = renderPath(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/configuracion`);
    await screen.findByRole('heading', { name: 'Liga Híbrida' });
    await waitFor(() => expect(adapter.loadPublicPageSettings).toHaveBeenCalledWith({ organizationId: ORG, tournamentId: TOURNAMENT }));
    expect(screen.queryByText(/Autogestión visual|imágenes por los equipos/i)).toBeNull();
    expect(screen.queryByText('Logo del torneo')).toBeNull();
  });

  test('F8(b) — the registration page renders the roster without portraits, team photo, shield upload or the visual identity tab', async () => {
    const { adapter } = renderPath(`/torneos/organizacion/${ORG}/equipos/${ENTRY}/plantel`);
    await screen.findByText('Ana Gol');
    expect(adapter.loadTeamRegistration).toHaveBeenCalledWith(ORG, ENTRY);
    expect(screen.queryByRole('link', { name: 'Identidad visual' })).toBeNull();
    expect(screen.queryByText(/No pudimos cargar las fotos/)).toBeNull();
    expect(screen.queryByText(/Cambiar foto|Agregar foto|Foto del equipo/i)).toBeNull();
    expect(screen.queryByText('Escudo del equipo')).toBeNull();
  });

  test('F8(c) — organization settings render without the logo field and without the Plan section', async () => {
    renderPath(`/torneos/organizacion/${ORG}/configuracion`);
    await screen.findByLabelText('Nombre');
    expect(screen.queryByText('Logo de la organización')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Plan' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Miembros' })).toBeTruthy();
  });

  test('collaborators — members from the table read, seats from the RPC, the limit shown as unknown without the entitlements RPC', async () => {
    const { adapter } = renderPath(`/torneos/organizacion/${ORG}/miembros`);
    await screen.findByText('2 miembros');
    expect(adapter.listMembers).toHaveBeenCalledWith(ORG);
    await waitFor(() => expect(adapter.listSeasonMemberAssignments).toHaveBeenCalledWith({ organizationId: ORG, seasonId: SEASON }));
    expect(adapter.loadSeasonEntitlements).toBeUndefined();
    await screen.findByText('cupos usados en esta temporada');
  });

  test('dashboard — fixture panel and competition links are offered; teams summary still loads', async () => {
    const { adapter } = renderPath(`/torneos/organizacion/${ORG}/inicio`);
    await screen.findByRole('heading', { name: 'Liga Híbrida' });
    await waitFor(() => expect(adapter.loadTeamsContext).toHaveBeenCalledWith(ORG, TOURNAMENT));
    expect(screen.getByRole('link', { name: /Ver equipos/ })).toBeTruthy();
    expect(screen.queryByText(/todavía no está habilitada/)).toBeNull();
  });

  test('landing — "Mis partidos" and "Avisos" are offered; mis-torneos links to the participant hub', async () => {
    renderPath('/torneos');
    await screen.findByText('Mi actividad');
    expect(screen.getAllByRole('link', { name: /Mis torneos/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Mis partidos/ })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Avisos/ }).length).toBeGreaterThan(0);
    // Without REACT_APP_TORNEOS_CONNECTED_MODE the connected product does not exist: no Explorar entry.
    expect(screen.queryByRole('link', { name: /Explorar torneos/ })).toBeNull();
    renderPath('/torneos/mis-torneos');
    await screen.findAllByText('Liga Híbrida');
    expect(screen.queryByText(/Portal del participante no disponible/)).toBeNull();
  });

  test('the feature map is the static staging-v1 + COMPETITION-V1 + OFFICIALIZATION-V1 map; media, social studio and billing stay off', () => {
    expect(Object.entries(stagingV1Features).filter(([, on]) => on).map(([key]) => key).sort())
      .toEqual([...stagingV1OnFeatures, ...competitionV1OnFeatures, ...officializationV1OnFeatures].sort());
    expect(Object.values(stagingV1Features).filter(Boolean)).toHaveLength(19);
    for (const key of ['media', 'social_studio', 'billing', 'plan', 'entitlements', 'branding_assets', 'player_portraits', 'team_photos', 'team_visual_policy', 'roster_lock']) {
      expect(stagingV1Features[key]).toBe(false);
    }
  });
});

describe('hybrid composition — the REAL adapter only sends allowlisted RPCs', () => {
  beforeEach(() => { coreAccesses.length = 0; });
  afterEach(() => { expect(coreAccesses).toEqual([]); });

  const allowed = new Set([...Object.values(stagingAllowlist.features).flat(), ...Object.values(competitionAllowlist.features).flat(), ...Object.values(officializationAllowlist.features).flat()]);
  const organization = { id: ORG, name: 'Liga Devoto', slug: 'liga-devoto', role: 'owner', status: 'active', capabilities: getCapabilitiesForRole('owner') };
  const replies = {
    get_tournament_workspace_context: { preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG }, organizations: [organization] },
    get_tournament_competition_context: competition(),
    get_my_tournament_memberships: { items: [membership], pagination: { hasMore: false } },
    get_tournament_teams_context: { settings: { minimumPlayers: 5 }, entries: [] },
    get_tournament_fixture_context: {},
    get_tournament_schedule_context: {},
    get_tournament_match_operations_context: { matches: [] },
    get_tournament_standings_context: { revision: null, standings: [] },
    get_tournament_statistics_context: { players: [], teams: [], discipline: [] },
    get_tournament_participant_hub: hub(),
    get_published_tournament_matches: { items: [], pagination: { total: 0 } },
    get_player_tournament_matches: [],
    get_managed_tournament_matches: [],
    get_tournament_communications_inbox: { items: [], unreadCount: 0, pagination: { total: 0 } },
  };
  function realAdapter() {
    const sent = [];
    const transport = {
      rpc: async (name) => { sent.push(name); return replies[name] ?? null; },
      select: async (table) => { sent.push(`table:${table}`); return []; },
      clear() {},
      dispose() {},
    };
    return { sent, service: createStagingV1WorkspaceService({ transport }) };
  }

  test.each([
    [`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/fixture`],
    [`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos`],
    [`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/competencia/tabla`],
    [`/torneos/organizacion/${ORG}/sedes`],
    ['/torneos/mis-partidos'],
    [`/torneos/torneo/${TOURNAMENT}`],
  ])('%s', async (path) => {
    const { sent, service } = realAdapter();
    renderPath(path, service);
    await waitFor(() => expect(sent.length).toBeGreaterThan(2));
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    for (const name of sent) {
      if (name.startsWith('table:')) expect(['table:tournament_organization_members', 'table:tournament_venues', 'table:tournament_courts']).toContain(name);
      else expect(allowed.has(name)).toBe(true);
    }
  });
});
