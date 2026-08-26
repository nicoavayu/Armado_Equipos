import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

const mockUploadBranding = jest.fn();
const mockRemoveBranding = jest.fn();

jest.mock('../features/torneos/api/tournamentBrandingService', () => ({
  uploadTournamentBrandingAsset: (...args) => mockUploadBranding(...args),
  removeTournamentBrandingAsset: (...args) => mockRemoveBranding(...args),
}));

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const ORG = '71000000-0000-4000-8000-000000000001';
const SEASON = '72000000-0000-4000-8000-000000000001';
const TOURNAMENT = '73000000-0000-4000-8000-000000000001';
const ENTRY = '74000000-0000-4000-8000-000000000001';

function competition() {
  return {
    preference: { organizationId: ORG, activeSeasonId: SEASON, activeTournamentId: TOURNAMENT },
    seasons: [{ id: SEASON, organizationId: ORG, name: 'Apertura', status: 'active' }],
    tournaments: [{
      id: TOURNAMENT,
      organizationId: ORG,
      seasonId: SEASON,
      name: 'Liga Devoto',
      status: 'registration',
      categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
    }],
    modalities: [],
    formats: [],
  };
}

function registration() {
  return {
    entry: {
      id: ENTRY,
      organizationId: ORG,
      tournamentId: TOURNAMENT,
      categoryId: 'category-a',
      name: 'Napoli',
      status: 'in_progress',
      linked: false,
    },
    tournament: { id: TOURNAMENT, name: 'Liga Devoto', status: 'registration' },
    category: { id: 'category-a', name: 'Primera' },
    settings: {
      minimumPlayers: 5,
      maximumPlayers: 10,
      minimumGoalkeepers: 1,
      shirtNumberRequired: false,
      uniqueShirtNumbers: true,
      positionRequired: false,
      allowProvisionalPlayers: true,
    },
    managers: [{
      id: 'manager-a',
      displayName: 'Nico Capitán',
      role: 'captain',
      status: 'active',
      isCurrentUser: true,
    }],
    roster: { id: 'roster-a', version: 1, status: 'draft', players: [] },
    reviews: [],
    audit: [],
    // 1C.3A: el permiso visual lo resuelve el servidor y viaja resuelto.
    visualAssets: {
      policy: 'organization_only',
      canManageShield: true,
      canManagePortraits: true,
    },
  };
}

function createService({ role = 'owner', organizations = true, tournamentStatus = 'registration' } = {}) {
  const organization = {
    id: ORG,
    name: 'Liga Devoto',
    slug: 'liga-devoto',
    role,
    capabilities: getCapabilitiesForRole(role),
  };
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: organizations
        ? { workspaceType: 'tournament_organization', activeOrganizationId: ORG }
        : { workspaceType: 'personal', activeOrganizationId: null },
      organizations: organizations ? [organization] : [],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    loadCompetitionContext: jest.fn().mockResolvedValue({
      ...competition(),
      tournaments: competition().tournaments.map((item) => ({
        ...item,
        status: tournamentStatus,
      })),
    }),
    setTournamentContext: jest.fn(),
    loadTeamsContext: jest.fn().mockResolvedValue({
      settings: { minimumPlayers: 5 },
      entries: [{
        id: ENTRY,
        name: 'Napoli',
        categoryName: 'Primera',
        status: 'submitted',
        linked: false,
        manager: { displayName: 'Nico Capitán' },
        roster: { playerCount: 5, goalkeeperCount: 1 },
      }],
    }),
    loadTeamRegistration: jest.fn().mockResolvedValue(registration()),
    updateTeamEntry: jest.fn().mockResolvedValue({}),
    createProvisionalPlayer: jest.fn(),
    addRosterPlayer: jest.fn(),
    updateRosterPlayer: jest.fn(),
    removeRosterPlayer: jest.fn(),
    submitTeamEntry: jest.fn(),
    reviewTeamEntry: jest.fn(),
    searchPlayers: jest.fn().mockResolvedValue([]),
    searchArma2Teams: jest.fn().mockResolvedValue([]),
    createTeamEntry: jest.fn().mockResolvedValue({ entryId: ENTRY }),
    inviteTeamManager: jest.fn().mockResolvedValue({
      token: 'a'.repeat(64),
      expiresAt: '2026-08-01T12:00:00.000Z',
    }),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
}

function renderPath(path, service) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Arma2 Torneos teams flow', () => {
  beforeEach(() => {
    mockUploadBranding.mockReset();
    mockRemoveBranding.mockReset();
    URL.createObjectURL = jest.fn(() => 'blob:shield-preview');
    URL.revokeObjectURL = jest.fn();
  });

  test('renders persisted team metrics and filters without invented data', async () => {
    const service = createService();
    renderPath(`/torneos/organizacion/${ORG}/equipos`, service);
    expect(await screen.findByRole('heading', { name: 'Equipos' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.getByText('5/5 jugadores')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aprobados' }));
    expect(screen.getByRole('heading', { name: 'No hay coincidencias' })).toBeInTheDocument();
  });

  test('keeps collaborator list read-only', async () => {
    const service = createService({ role: 'collaborator' });
    renderPath(`/torneos/organizacion/${ORG}/equipos`, service);
    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agregar equipo' })).not.toBeInTheDocument();
  });

  test('keeps the add action visible only while registration is open', async () => {
    const service = createService();
    renderPath(`/torneos/organizacion/${ORG}/equipos`, service);
    expect(await screen.findByRole('link', { name: 'Agregar equipo' })).toBeInTheDocument();
    expect(screen.getByText('Inscripción de equipos habilitada')).toBeInTheDocument();
  });

  test('explains why normal registration is closed after fixture publication', async () => {
    const service = createService({ tournamentStatus: 'scheduled' });
    renderPath(`/torneos/organizacion/${ORG}/equipos`, service);
    expect(await screen.findByText('La inscripción de equipos está cerrada')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.getByText(/fixture ya fue publicado/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agregar equipo' })).not.toBeInTheDocument();
  });

  test('does not invent a zero minimum in the team list', async () => {
    const service = createService();
    service.loadTeamsContext.mockResolvedValue({
      settings: null,
      entries: [{
        id: ENTRY,
        name: 'Barrio Norte',
        categoryName: 'Primera',
        status: 'approved',
        linked: false,
        manager: { displayName: 'QA Owner' },
        roster: { playerCount: 10, goalkeeperCount: 1 },
      }],
    });
    renderPath(`/torneos/organizacion/${ORG}/equipos`, service);
    expect(await screen.findByText('10 jugadores · mínimo sin definir')).toBeInTheDocument();
    expect(screen.queryByText('10/0 jugadores')).not.toBeInTheDocument();
  });

  test('allows a relational captain route without organization membership', async () => {
    const service = createService({ organizations: false });
    renderPath(`/torneos/organizacion/${ORG}/equipos/${ENTRY}/plantel`, service);
    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.getByText('Plantel vacío')).toBeInTheDocument();
    expect(service.loadTeamRegistration).toHaveBeenCalledWith(ORG, ENTRY);
    await waitFor(() => expect(screen.getByText('Presentar plantel')).toBeDisabled());
  });

  test('renders a roster safely when the persisted settings row is absent', async () => {
    const service = createService();
    service.loadTeamRegistration.mockResolvedValue({
      ...registration(),
      entry: { ...registration().entry, name: 'Barrio Norte' },
      settings: null,
    });
    renderPath(`/torneos/organizacion/${ORG}/equipos/${ENTRY}/plantel`, service);

    expect(await screen.findByRole('heading', { name: 'Barrio Norte' })).toBeInTheDocument();
    expect(screen.getByText('Los requisitos del plantel todavía no están configurados.'))
      .toBeInTheDocument();
    expect(screen.getByText('jugadores · mínimo sin definir')).toBeInTheDocument();
    expect(screen.queryByText('0/0')).not.toBeInTheDocument();
    expect(screen.getAllByText('Sin definir')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Presentar plantel' })).toBeDisabled();
  });

  test('keeps approved sports data locked while owner branding can upload, replace and remove', async () => {
    const service = createService();
    const approved = {
      ...registration(),
      entry: {
        ...registration().entry,
        status: 'approved',
        shieldPath: 'qa/shields/barrio-norte.svg',
      },
      roster: { ...registration().roster, status: 'approved' },
    };
    service.loadTeamRegistration.mockResolvedValue(approved);
    mockUploadBranding.mockResolvedValue({ path: `${ORG}/teams/${ENTRY}/new.png` });
    mockRemoveBranding.mockResolvedValue({ path: null });

    renderPath(`/torneos/organizacion/${ORG}/equipos/${ENTRY}/inscripcion`, service);

    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(screen.getByLabelText('Nombre corto')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /guardar datos/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sólo estás editando la identidad visual/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeEnabled();

    const upload = new File(['png'], 'shield.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [upload] },
    });
    await waitFor(() => expect(mockUploadBranding).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG,
      kind: 'team',
      entityId: ENTRY,
      file: upload,
    })));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Quitar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(mockRemoveBranding).toHaveBeenCalledWith({
      organizationId: ORG,
      kind: 'team',
      entityId: ENTRY,
    }));
  });

  test('branding controls follow the server permission, never a local role read', async () => {
    const collaboratorService = createService({ role: 'collaborator' });
    collaboratorService.loadTeamRegistration.mockResolvedValue({
      ...registration(),
      entry: { ...registration().entry, status: 'approved', shieldPath: null },
      roster: { ...registration().roster, status: 'approved' },
      managers: registration().managers.map((manager) => ({
        ...manager,
        isCurrentUser: false,
      })),
      visualAssets: {
        policy: 'organization_only',
        canManageShield: false,
        canManagePortraits: false,
      },
    });
    const collaboratorView = renderPath(
      `/torneos/organizacion/${ORG}/equipos/${ENTRY}/inscripcion`,
      collaboratorService,
    );
    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subir' })).not.toBeInTheDocument();
    collaboratorView.unmount();

    const delegateService = createService({ organizations: false });
    delegateService.loadTeamRegistration.mockResolvedValue({
      ...registration(),
      entry: { ...registration().entry, status: 'approved', shieldPath: null },
      roster: { ...registration().roster, status: 'approved' },
      managers: [{
        ...registration().managers[0],
        role: 'delegate',
        isCurrentUser: true,
      }],
      visualAssets: {
        policy: 'organization_only',
        canManageShield: false,
        canManagePortraits: false,
      },
    });
    const closedView = renderPath(
      `/torneos/organizacion/${ORG}/equipos/${ENTRY}/inscripcion`,
      delegateService,
    );
    // Mismo delegado, misma pantalla: sin la política habilitada no hay CTA,
    // por más que el rol del usuario diga «delegate».
    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subir' })).not.toBeInTheDocument();
    closedView.unmount();

    const selfManagedService = createService({ organizations: false });
    selfManagedService.loadTeamRegistration.mockResolvedValue({
      ...registration(),
      entry: { ...registration().entry, status: 'approved', shieldPath: null },
      roster: { ...registration().roster, status: 'approved' },
      managers: [{
        ...registration().managers[0],
        role: 'delegate',
        isCurrentUser: true,
      }],
      visualAssets: {
        policy: 'delegates',
        canManageShield: true,
        canManagePortraits: true,
      },
    });
    renderPath(`/torneos/organizacion/${ORG}/equipos/${ENTRY}/inscripcion`, selfManagedService);
    expect(await screen.findByRole('button', { name: 'Subir' })).toBeEnabled();
    // El permiso es visual, no administrativo: la inscripción sigue cerrada.
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
  });

  test('does not extend branding writes to terminal team-entry states', async () => {
    const service = createService();
    service.loadTeamRegistration.mockResolvedValue({
      ...registration(),
      entry: { ...registration().entry, status: 'withdrawn', shieldPath: null },
      roster: { ...registration().roster, status: 'approved' },
      // La ventana de estados vive en can_update_tournament_team_branding: un
      // equipo retirado nunca vuelve con permiso, ni siquiera para el owner.
      visualAssets: {
        policy: 'delegates',
        canManageShield: false,
        canManagePortraits: false,
      },
    });

    renderPath(`/torneos/organizacion/${ORG}/equipos/${ENTRY}/inscripcion`, service);
    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subir' })).not.toBeInTheDocument();
  });

  test('creates the manager invitation and shows its token only in the success step', async () => {
    const service = createService();
    renderPath(`/torneos/organizacion/${ORG}/equipos/nuevo`, service);

    expect(await screen.findByRole('heading', { name: 'Agregar equipo' })).toBeInTheDocument();
    const nameInputs = screen.getAllByLabelText('Nombre');
    fireEvent.change(nameInputs[0], { target: { value: 'Equipo QA' } });
    fireEvent.change(nameInputs[1], { target: { value: 'Capitana QA' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'capitana@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar inscripción' }));

    expect(await screen.findByRole('heading', {
      name: 'Compartí la invitación una sola vez',
    })).toBeInTheDocument();
    expect(service.createTeamEntry).toHaveBeenCalled();
    expect(service.inviteTeamManager).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG,
      teamEntryId: ENTRY,
      email: 'capitana@example.test',
    }));
    expect(
      screen.getByLabelText('Enlace privado del responsable').value,
    ).toContain('/torneos/invitacion/equipo/');
  });
});
