// T4 / T7 — the staging-v1 (hybrid) composition renders the permitted journey with
// ONLY the adapter, while every blocked surface stays off without a request and
// without touching the Core singleton. The singleton is replaced by a proxy that
// records — and refuses — any access: a bypass would show up here as an access.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import StagingV1TorneosApp from '../features/torneos/stagingV1/StagingV1TorneosApp';
import { stagingV1Features } from '../features/torneos/stagingV1/stagingV1Features';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

const coreAccesses = [];
jest.mock('../lib/supabaseClient', () => {
  const trap = new Proxy({}, {
    get(_, property) {
      if (property === '__esModule') return false;
      if (property === 'then') return undefined;
      // eslint-disable-next-line no-undef
      coreAccesses.push(String(property));
      throw new Error(`Core singleton accessed from the staging-v1 composition: ${String(property)}`);
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

// The adapter surface of staging v1 and nothing else: exactly what
// createStagingV1WorkspaceService exposes (adapter.test.mjs pins that list).
function createAdapter() {
  const organization = { id: ORG, name: 'Liga Devoto', slug: 'liga-devoto', role: 'owner', status: 'active', capabilities: getCapabilitiesForRole('owner') };
  return Object.freeze({
    loadContext: jest.fn().mockResolvedValue({ preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG }, organizations: [organization] }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    createOrganization: jest.fn(),
    checkSlugAvailability: jest.fn(),
    updateOrganization: jest.fn(),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    loadMyTournaments: jest.fn().mockResolvedValue({ items: [{ tournamentId: TOURNAMENT, teamEntryId: ENTRY, categoryId: CATEGORY, tournamentName: 'Liga Híbrida', seasonName: 'Apertura 2026', categoryName: 'Primera', organizationName: 'Liga Devoto', teamName: 'Napoli', role: 'player', tournamentStatus: 'registration' }], pagination: { hasMore: false } }),
    loadExperienceRelations: jest.fn().mockResolvedValue({ items: [{ tournamentId: TOURNAMENT, teamEntryId: ENTRY, categoryId: CATEGORY, tournamentName: 'Liga Híbrida', seasonName: 'Apertura 2026', categoryName: 'Primera', organizationName: 'Liga Devoto', teamName: 'Napoli', role: 'player', tournamentStatus: 'registration' }], pagination: { hasMore: false } }),
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

describe('staging-v1 composition — blocked surfaces stay off without requests', () => {
  beforeEach(() => { coreAccesses.length = 0; });
  afterEach(() => { expect(coreAccesses).toEqual([]); });

  test('the sidebar only offers the staging-v1 surfaces and the tournament index opens the teams, not the fixture', async () => {
    const { adapter } = renderPath(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}`);
    await waitFor(() => expect(currentPath).toBe(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/equipos`));
    await screen.findAllByText('Napoli');
    const nav = screen.getAllByRole('navigation', { name: /Navegación de la organización/ })[0];
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Inicio', 'Torneos', 'Equipos', 'Configuración']);
    expect(adapter.loadTeamsContext).toHaveBeenCalledWith(ORG, TOURNAMENT);
    expect(adapter.setTournamentContext).not.toHaveBeenCalledWith(expect.objectContaining({ tournamentId: 'fixture' }));
  });

  test.each([
    ['fixture', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/fixture`],
    ['programacion', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/programacion`],
    ['partidos', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/partidos`],
    ['competencia/tabla', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/competencia/tabla`],
    ['plan', `/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/plan`],
    ['sedes', `/torneos/organizacion/${ORG}/sedes`],
    ['comunicaciones', `/torneos/organizacion/${ORG}/comunicaciones`],
    ['configuracion/plan', `/torneos/organizacion/${ORG}/configuracion/plan`],
    ['identidad-visual', `/torneos/organizacion/${ORG}/equipos/${ENTRY}/identidad-visual`],
  ])('%s renders the unavailable page instead of its screen', async (_, path) => {
    const { adapter } = renderPath(path);
    await unavailable();
    // The adapter has no method for these surfaces; the pages never got to ask.
    for (const blocked of ['loadFixtureContext', 'loadScheduleContext', 'loadMatchOperations', 'loadStandings', 'loadPurchase', 'loadOrganizationVenues', 'loadCommunicationsAdminContext']) {
      expect(adapter[blocked]).toBeUndefined();
    }
  });

  test.each([
    ['mis-partidos', '/torneos/mis-partidos'],
    ['comunicados', '/torneos/comunicados'],
    ['hub', `/torneos/torneo/${TOURNAMENT}`],
    ['hub/tabla', `/torneos/torneo/${TOURNAMENT}/tabla`],
  ])('%s outside the organization is unavailable too', async (_, path) => {
    renderPath(path);
    await unavailable();
  });

  test('F8(a) — the wizard of an existing tournament renders without public page / visual policy / logo upload', async () => {
    renderPath(`/torneos/organizacion/${ORG}/torneo/${TOURNAMENT}/configuracion`);
    await screen.findByRole('heading', { name: 'Liga Híbrida' });
    expect(screen.queryByText(/Página pública/i)).toBeNull();
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
    expect(screen.getByRole('link', { name: 'Información' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Plantel/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Revisión' })).toBeTruthy();
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
    expect(screen.getByText((_, node) => node?.tagName === 'STRONG' && /0\s*\/\s*—/.test(node.textContent))).toBeTruthy();
    expect(screen.getByRole('button', { name: /Asignar/ })).toBeTruthy();
  });

  test('dashboard — no lifecycle actions, no fixture panels, no links to partidos/tabla/comunicaciones; teams summary still loads', async () => {
    const { adapter } = renderPath(`/torneos/organizacion/${ORG}/inicio`);
    await screen.findByRole('heading', { name: 'Liga Híbrida' });
    await waitFor(() => expect(adapter.loadTeamsContext).toHaveBeenCalledWith(ORG, TOURNAMENT));
    expect(screen.queryByRole('button', { name: /Iniciar competencia|Finalizar competencia|Reabrir/ })).toBeNull();
    expect(screen.queryByText('Fixture y programación')).toBeNull();
    expect(screen.queryByRole('link', { name: /Abrir fixture|Programar partidos/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Herramientas disponibles' })).toBeNull();
    expect(screen.getByRole('link', { name: /Ver equipos/ })).toBeTruthy();
    expect(screen.getByText(/Plan no verificado/)).toBeTruthy();
  });

  test('landing — participant activity without "Mis partidos" / "Comunicados"; mis-torneos lists without a hub link', async () => {
    renderPath('/torneos');
    await screen.findByRole('link', { name: /Mis torneos/ });
    expect(screen.queryByRole('link', { name: /Mis partidos/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Comunicados/ })).toBeNull();
    renderPath('/torneos/mis-torneos');
    await screen.findAllByText('Liga Híbrida');
    expect(screen.queryByRole('link', { name: /Abrir torneo/ })).toBeNull();
    expect(screen.getByText(/Portal del participante no disponible/)).toBeTruthy();
  });

  test('the composition uses the injected adapter only and its feature map is the static staging-v1 map', () => {
    expect(Object.values(stagingV1Features).filter(Boolean)).toHaveLength(8);
    renderPath('/torneos');
  });
});
