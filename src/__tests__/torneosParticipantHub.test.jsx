import React from 'react';
import {
  act,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import MyTournamentsPage from '../features/torneos/components/MyTournamentsPage';
import TournamentHubPage from '../features/torneos/components/TournamentHubPage';

let mockService;

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockService }),
}));

const nextMatch = {
  matchId: 'match-a',
  roundName: 'Fecha 4',
  scheduledAt: '2026-08-02T18:00:00Z',
  status: 'scheduled',
  venueName: 'Cancha Central',
  home: { teamEntryId: 'team-a', name: 'Violetas', shortName: 'VIO' },
  away: { teamEntryId: 'team-b', name: 'Nómades', shortName: 'NOM' },
  isMyTeam: true,
  myAvailability: null,
  myCallupStatus: null,
};

function buildHub(overrides = {}) {
  return {
    tournament: {
      id: 'tournament-a',
      organizationId: 'org-a',
      organizationName: 'Liga Metropolitana',
      name: 'Copa Horizonte',
      description: 'Una competencia oficial.',
      status: 'active',
      seasonName: 'Temporada 2026',
      readOnly: false,
    },
    audience: {
      organizationRole: null,
      managerRole: null,
      isPlayer: true,
      canManageTournament: false,
      canManageTeam: false,
    },
    categories: [
      { id: 'category-a', name: 'Libre' },
      { id: 'category-b', name: 'Senior' },
    ],
    activeCategoryId: 'category-a',
    competition: {
      hasPublishedFixture: true,
      phaseId: 'phase-a',
      groupId: null,
      phases: [{ id: 'phase-a', name: 'Fase regular' }],
      groups: [],
    },
    nextMatches: [nextMatch],
    recentResults: [],
    standings: [{
      position: 1,
      participantId: 'participant-a',
      teamEntryId: 'team-a',
      teamName: 'Violetas',
      shortName: 'VIO',
      played: 3,
      goalDifference: 5,
      points: 9,
      isMyTeam: true,
    }],
    topScorers: [{
      rosterPlayerId: 'player-a',
      name: 'Ada Gol',
      teamEntryId: 'team-a',
      teamName: 'Violetas',
      goals: 4,
      assists: 1,
      appearances: 3,
      isMe: true,
    }],
    myStatistics: {
      appearances: 3,
      starts: 2,
      goals: 4,
      assists: 1,
      yellowCards: 0,
      redCards: 0,
    },
    mySuspensions: [],
    myTeam: {
      id: 'team-a',
      name: 'Violetas',
      shortName: 'VIO',
      primaryColor: '#8b67ff',
      secondaryColor: '#4de2a7',
      managerRole: null,
      canManage: false,
      roster: [{
        id: 'player-a',
        displayName: 'Ada Gol',
        shirtNumber: 9,
        isMe: true,
      }],
      activeSuspensions: [],
      nextMatchResponses: {
        available: 0,
        unavailable: 0,
        maybe: 0,
        total: 0,
      },
    },
    alerts: [],
    ...overrides,
  };
}

function createService(hub = buildHub()) {
  return {
    loadMyTournaments: jest.fn().mockResolvedValue({
      items: [],
      pagination: { total: 0, hasMore: false },
    }),
    loadParticipantHub: jest.fn().mockResolvedValue(hub),
    setHubCategory: jest.fn().mockResolvedValue({ categoryId: 'category-b' }),
    loadPublishedMatches: jest.fn().mockResolvedValue({
      items: [],
      pagination: { total: 0, hasMore: false },
    }),
    loadParticipantMatch: jest.fn().mockResolvedValue(null),
    loadPublishedTeams: jest.fn().mockResolvedValue({
      items: [],
      pagination: { total: 0, hasMore: false },
    }),
    loadStandings: jest.fn().mockResolvedValue({ standings: [] }),
    loadStatistics: jest.fn().mockResolvedValue({
      players: [],
      teams: [],
      discipline: [],
    }),
    loadPublishedStandings: jest.fn().mockResolvedValue({ standings: [] }),
    loadPublishedStatistics: jest.fn().mockResolvedValue({
      players: [],
      teams: [],
      discipline: [],
    }),
    respondMatchAvailability: jest.fn().mockResolvedValue({ response: 'available' }),
  };
}

function renderHub(path = '/torneos/torneo/tournament-a?categoria=category-a', props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/torneos/torneo/:tournamentId"
          element={<TournamentHubPage {...props} />}
        />
        <Route
          path="/torneos/torneo/:tournamentId/partidos"
          element={<TournamentHubPage defaultSection="partidos" {...props} />}
        />
        <Route
          path="/torneos/torneo/:tournamentId/tabla"
          element={<TournamentHubPage defaultSection="tabla" {...props} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function CategoryTestNavigation() {
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate('/torneos/torneo/tournament-a?categoria=category-b')}>
        Ir a Senior
      </button>
      <button type="button" onClick={() => navigate('/torneos/torneo/tournament-a?categoria=category-c')}>
        Ir a Master
      </button>
    </div>
  );
}

describe('Participant Hub', () => {
  beforeEach(() => {
    mockService = createService();
  });

  test('shows the personal empty state for a user without memberships', async () => {
    render(
      <MemoryRouter>
        <MyTournamentsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', {
      name: 'Todavía no tenés torneos vinculados',
    })).toBeInTheDocument();
  });

  test('renders multiple membership cards with role and scoped links', async () => {
    mockService.loadMyTournaments.mockResolvedValue({
      items: [{
        tournamentId: 'tournament-a',
        tournamentName: 'Copa Horizonte',
        tournamentStatus: 'active',
        seasonName: 'Temporada 2026',
        organizationName: 'Liga Metropolitana',
        categoryId: 'category-a',
        categoryName: 'Libre',
        teamName: 'Violetas',
        teamShortName: 'VIO',
        role: 'player',
        position: 1,
        hasPublishedFixture: true,
        nextMatch: null,
      }, {
        tournamentId: 'tournament-b',
        tournamentName: 'Liga Nocturna',
        tournamentStatus: 'registration',
        seasonName: 'Clausura',
        organizationName: 'Asociación Sur',
        categoryId: 'category-b',
        categoryName: 'Senior',
        teamName: 'Nómades',
        role: 'captain',
        position: null,
        hasPublishedFixture: false,
        nextMatch: null,
      }],
      pagination: { total: 2, hasMore: false },
    });
    render(<MemoryRouter><MyTournamentsPage /></MemoryRouter>);
    expect(await screen.findByText('Copa Horizonte')).toBeInTheDocument();
    expect(screen.getByText('Liga Nocturna')).toBeInTheDocument();
    expect(screen.getByText('Violetas')).toBeInTheDocument();
    expect(screen.getByText('Jugador')).toBeInTheDocument();
    expect(screen.getByText('Nómades')).toBeInTheDocument();
    expect(screen.getByText('Capitán')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Abrir torneo/ })[0]).toHaveAttribute(
      'href',
      '/torneos/torneo/tournament-a?categoria=category-a',
    );
  });

  test('renders a player overview with published and personal context', async () => {
    renderHub();
    expect(await screen.findByRole('heading', { name: 'Copa Horizonte' })).toBeInTheDocument();
    expect(screen.getByText('Ada Gol')).toBeInTheDocument();
    expect(screen.getByText('¿Podés jugar?')).toBeInTheDocument();
    expect(screen.getByText('Sin alertas pendientes.')).toBeInTheDocument();
    expect(screen.queryByText(/Asist\./i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir gestor' })).not.toBeInTheDocument();
  });

  test('submits own availability and refreshes authoritative hub data', async () => {
    renderHub();
    await screen.findByRole('heading', { name: 'Copa Horizonte' });
    await userEvent.click(screen.getByRole('button', { name: /Voy/ }));
    await waitFor(() => expect(mockService.respondMatchAvailability).toHaveBeenCalledWith({
      matchId: 'match-a',
      response: 'available',
    }));
    await waitFor(() => expect(mockService.loadParticipantHub).toHaveBeenCalledTimes(2));
  });

  test('shows captain actions and organization management only for their capabilities', async () => {
    mockService = createService(buildHub({
      audience: {
        organizationRole: 'admin',
        managerRole: 'captain',
        isPlayer: true,
        canManageTournament: true,
        canManageTeam: true,
      },
      myTeam: {
        ...buildHub().myTeam,
        managerRole: 'captain',
        canManage: true,
      },
    }));
    renderHub();
    expect(await screen.findByRole('link', { name: 'Abrir gestor' })).toHaveAttribute(
      'href',
      '/torneos/organizacion/org-a/inicio',
    );
    expect(screen.getByRole('link', { name: /Preparar convocatoria/ })).toHaveAttribute(
      'href',
      '/torneos/mis-partidos/match-a/convocatoria',
    );
    expect(screen.getByRole('heading', {
      name: 'Respuestas y convocatoria',
    })).toBeInTheDocument();
  });

  test('keeps archived tournaments read-only for every composed role', async () => {
    mockService = createService(buildHub({
      tournament: {
        ...buildHub().tournament,
        status: 'archived',
        readOnly: true,
      },
      audience: {
        organizationRole: 'admin',
        managerRole: 'captain',
        isPlayer: true,
        canManageTournament: true,
        canManageTeam: true,
      },
      myTeam: {
        ...buildHub().myTeam,
        managerRole: 'captain',
        canManage: true,
      },
    }));
    renderHub();
    expect(await screen.findByText(/Torneo histórico/)).toBeInTheDocument();
    expect(screen.queryByText('¿Podés jugar?')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir gestor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Preparar convocatoria/ })).not.toBeInTheDocument();
  });

  test('persists a category change before loading the replacement category', async () => {
    mockService.loadParticipantHub
      .mockResolvedValueOnce(buildHub())
      .mockResolvedValueOnce(buildHub({ activeCategoryId: 'category-b' }));
    renderHub();
    const selector = await screen.findByLabelText('Categoría');
    await userEvent.click(selector);
    await userEvent.click(screen.getByRole('option', { name: 'Senior' }));
    await waitFor(() => expect(mockService.setHubCategory).toHaveBeenCalledWith({
      tournamentId: 'tournament-a',
      categoryId: 'category-b',
    }));
    await waitFor(() => expect(mockService.loadParticipantHub).toHaveBeenLastCalledWith({
      tournamentId: 'tournament-a',
      categoryId: 'category-b',
    }));
  });

  test('discards older hub responses after rapid category navigation', async () => {
    const pending = {};
    mockService.loadParticipantHub.mockImplementation(({ categoryId }) => (
      new Promise((resolve) => {
        pending[categoryId] = resolve;
      })
    ));
    render(
      <MemoryRouter initialEntries={['/torneos/torneo/tournament-a?categoria=category-a']}>
        <CategoryTestNavigation />
        <Routes>
          <Route
            path="/torneos/torneo/:tournamentId"
            element={<TournamentHubPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(pending['category-a']).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'Ir a Senior' }));
    await waitFor(() => expect(pending['category-b']).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'Ir a Master' }));
    await waitFor(() => expect(pending['category-c']).toBeDefined());

    await act(async () => {
      pending['category-c'](buildHub({
        activeCategoryId: 'category-c',
        tournament: {
          ...buildHub().tournament,
          name: 'Copa Master',
        },
      }));
    });
    expect(await screen.findByRole('heading', { name: 'Copa Master' })).toBeInTheDocument();

    await act(async () => {
      pending['category-a'](buildHub());
      pending['category-b'](buildHub({
        activeCategoryId: 'category-b',
        tournament: {
          ...buildHub().tournament,
          name: 'Copa Senior',
        },
      }));
    });
    expect(screen.getByRole('heading', { name: 'Copa Master' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Copa Senior' })).not.toBeInTheDocument();
  });

  test('renders a safe empty matches state from the published endpoint', async () => {
    renderHub('/torneos/torneo/tournament-a/partidos?categoria=category-a');
    expect(await screen.findByRole('heading', { name: 'Sin partidos publicados' })).toBeInTheDocument();
    expect(mockService.loadPublishedMatches).toHaveBeenCalledWith({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      view: 'all',
      limit: 30,
    });
  });

  test('uses participant-only published projections instead of administrative RPCs', async () => {
    renderHub('/torneos/torneo/tournament-a/tabla?categoria=category-a', {
      defaultSection: 'tabla',
    });
    await waitFor(() => expect(mockService.loadPublishedStandings).toHaveBeenCalledWith({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      phaseId: 'phase-a',
      groupId: null,
    }));
    expect(mockService.loadStandings).not.toHaveBeenCalled();
  });

  test('clears stale hub content when a subsequent category request fails', async () => {
    mockService.loadParticipantHub
      .mockResolvedValueOnce(buildHub())
      .mockRejectedValueOnce(new Error('Acceso removido'));
    renderHub();
    const selector = await screen.findByLabelText('Categoría');
    await userEvent.click(selector);
    await userEvent.click(screen.getByRole('option', { name: 'Senior' }));
    expect(await screen.findByRole('heading', {
      name: 'No pudimos abrir este torneo',
    })).toBeInTheDocument();
    expect(screen.queryByText('Ada Gol')).not.toBeInTheDocument();
  });
});
