import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const ORGANIZATION_ID = '51000000-0000-4000-8000-000000000001';
const SEASON_ID = '52000000-0000-4000-8000-000000000001';
const TOURNAMENT_ID = '53000000-0000-4000-8000-000000000001';

const season = {
  id: SEASON_ID,
  organizationId: ORGANIZATION_ID,
  name: 'Apertura 2027',
  slug: 'apertura-2027',
  status: 'active',
  startDate: '2027-03-01',
  endDate: '2027-07-30',
};
const tournament = {
  id: TOURNAMENT_ID,
  organizationId: ORGANIZATION_ID,
  seasonId: SEASON_ID,
  name: 'Copa Apertura',
  slug: 'copa-apertura',
  description: 'Competencia anual',
  status: 'draft',
  sportModality: 'football_7',
  competitionFormat: 'league',
  genderCategory: 'open',
  teamSize: 7,
  substitutesLimit: 5,
  startDate: '2027-03-10',
  endDate: '2027-07-20',
  formatSettings: { rounds: 'single', qualifiers: 0 },
  categories: [{
    id: 'category-a',
    name: 'Primera',
    slug: 'primera',
    status: 'active',
    sortOrder: 0,
  }],
  scoring: {
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    allowManualPointsAdjustment: false,
    allowAdministrativeResult: false,
  },
  tiebreaks: ['goal_difference', 'goals_for', 'head_to_head', 'fair_play'],
  discipline: {
    yellowsForSuspension: 5,
    suspensionMatches: 1,
    directRedSuggestedMatches: null,
    doubleYellowCountsAsRed: true,
    resetYellowsEachStage: false,
    fairPlayEnabled: true,
    yellowFairPlayPoints: 1,
    redFairPlayPoints: 3,
  },
  checklist: {
    ready: true,
    errors: [],
    warnings: ['registration_dates'],
    checks: {
      information: true,
      season: true,
      modality: true,
      format: true,
      categories: true,
      scoring: true,
      tiebreaks: true,
      discipline: true,
    },
  },
};

function competitionPayload(overrides = {}) {
  return {
    preference: {
      organizationId: ORGANIZATION_ID,
      activeSeasonId: SEASON_ID,
      activeTournamentId: TOURNAMENT_ID,
    },
    seasons: [season],
    tournaments: [tournament],
    modalities: [{
      code: 'football_7',
      name: 'Fútbol 7',
      teamSize: 7,
      recommendedSubstitutes: 5,
      suggestedDurationMinutes: 50,
    }],
    formats: [{
      code: 'league',
      name: 'Liga',
      description: 'Todos compiten por puntos.',
    }],
    ...overrides,
  };
}

function createService({ role = 'owner', competition = competitionPayload() } = {}) {
  const organization = {
    id: ORGANIZATION_ID,
    name: 'Liga Devoto',
    slug: 'liga-devoto',
    role,
    status: 'active',
    createdAt: '2026-07-24T00:00:00.000Z',
    capabilities: getCapabilitiesForRole(role),
  };
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: {
        workspaceType: 'tournament_organization',
        activeOrganizationId: ORGANIZATION_ID,
      },
      organizations: [organization],
    }),
    setPreference: jest.fn().mockResolvedValue({
      workspaceType: 'tournament_organization',
      activeOrganizationId: ORGANIZATION_ID,
    }),
    createOrganization: jest.fn(),
    updateOrganization: jest.fn(),
    listMembers: jest.fn().mockResolvedValue([]),
    loadCompetitionContext: jest.fn().mockResolvedValue(competition),
    loadTeamsContext: jest.fn().mockResolvedValue({ settings: { minimumPlayers: 7 }, entries: [] }),
    loadFixtureContext: jest.fn().mockResolvedValue({}),
    loadScheduleContext: jest.fn().mockResolvedValue({}),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    createSeason: jest.fn(),
    updateSeason: jest.fn(),
    createTournament: jest.fn(),
    updateTournament: jest.fn().mockResolvedValue({}),
    saveCategory: jest.fn().mockResolvedValue({}),
    changeTournamentStatus: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => 'request-key'),
  };
}

function renderPath(path, service) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/torneos/*"
          element={<TorneosFeatureGate enabled service={service} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Arma2 Torneos competition flow', () => {
  test('renders a dashboard using only persisted tournament values', async () => {
    const api = createService();
    renderPath(`/torneos/organizacion/${ORGANIZATION_ID}/inicio`, api);
    expect(await screen.findByRole(
      'heading',
      { name: 'Copa Apertura' },
      { timeout: 5000 },
    ))
      .toBeInTheDocument();
    expect(screen.getAllByText('Apertura 2027').length).toBeGreaterThan(0);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.queryByText('12 equipos')).not.toBeInTheDocument();
    expect(await screen.findByText('0 equipos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Abrí la inscripción de equipos' }))
      .toBeInTheDocument();
  });

  test('shows a useful empty state without invented metrics', async () => {
    const api = createService({
      competition: competitionPayload({
        preference: {
          organizationId: ORGANIZATION_ID,
          activeSeasonId: null,
          activeTournamentId: null,
        },
        seasons: [],
        tournaments: [],
      }),
    });
    renderPath(`/torneos/organizacion/${ORGANIZATION_ID}/torneos`, api);
    expect(await screen.findByRole('heading', { name: /creá la primera temporada/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: /crear temporada/i }))
      .toBeInTheDocument();
    expect(screen.queryByText(/partidos jugados/i)).not.toBeInTheDocument();
  });

  test('keeps a collaborator in read-only mode throughout the wizard', async () => {
    const api = createService({ role: 'collaborator' });
    renderPath(
      `/torneos/organizacion/${ORGANIZATION_ID}/torneos/${TOURNAMENT_ID}/configuracion?step=3`,
      api,
    );
    expect(await screen.findByText(/vista de consulta/i)).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('3').every((input) => input.disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: /guardar borrador/i }))
      .not.toBeInTheDocument();
  });

  test('persists an ordered tiebreak change as a structured patch', async () => {
    const api = createService({
      competition: competitionPayload({
        tournaments: [{
          ...tournament,
          tiebreaks: [
            'head_to_head',
            'goal_difference',
            'goals_for',
            'fair_play',
          ],
        }],
      }),
    });
    // Dirección canónica a propósito: este caso mide el borrador del asistente
    // a lo largo de varios pasos, y entrar por la dirección vieja agregaría un
    // redirect en el medio que no es lo que se está probando. Que la vieja
    // resuelva a ésta lo cubre `torneosCanonicalAdoption`.
    renderPath(
      `/torneos/organizacion/${ORGANIZATION_ID}/torneo/${TOURNAMENT_ID}/configuracion?step=3`,
      api,
    );
    await screen.findByRole(
      'heading',
      { name: 'Copa Apertura' },
      { timeout: 5000 },
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Subir Resultado entre sí' }))
        .toBeDisabled();
    });
    const moveUp = screen.getByRole('button', { name: 'Subir Diferencia de gol' });
    fireEvent.click(moveUp);
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => {
      expect(api.updateTournament).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        tournamentId: TOURNAMENT_ID,
        patch: expect.objectContaining({
          tiebreaks: [
            'goal_difference',
            'head_to_head',
            'goals_for',
            'fair_play',
          ],
        }),
      });
      expect(api.loadCompetitionContext).toHaveBeenCalledTimes(2);
    });
  });

  test('reuses the same creation key when a network failure is retried', async () => {
    const api = createService({
      competition: competitionPayload({
        preference: {
          organizationId: ORGANIZATION_ID,
          activeSeasonId: SEASON_ID,
          activeTournamentId: null,
        },
        tournaments: [],
      }),
    });
    let rejectFirstAttempt;
    api.createTournament
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectFirstAttempt = reject;
      }))
      .mockResolvedValueOnce({ id: 'tournament-retried' });
    renderPath(`/torneos/organizacion/${ORGANIZATION_ID}/torneos/nuevo`, api);
    const nameInput = await screen.findByRole('textbox', { name: /nombre del torneo/i });
    const seasonSelect = screen.getByRole('combobox', { name: 'Temporada' });
    fireEvent.change(seasonSelect, { target: { value: SEASON_ID } });
    expect(seasonSelect).toHaveValue(SEASON_ID);
    fireEvent.change(nameInput, { target: { value: 'Copa Retry' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    await waitFor(() => {
      expect(api.createTournament).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      rejectFirstAttempt(new Error('Sin conexión'));
    });
    expect(await screen.findByRole('alert', {}, { timeout: 5000 }))
      .toHaveTextContent('Sin conexión');
    fireEvent.click(screen.getByRole('button', { name: /guardar borrador/i }));
    expect(await screen.findByRole('heading', { name: 'Temporadas y torneos' }))
      .toBeInTheDocument();
    expect(api.createTournament).toHaveBeenCalledTimes(2);
    expect(api.createTournament.mock.calls[0][0].idempotencyKey).toBe('request-key');
    expect(api.createTournament.mock.calls[1][0].idempotencyKey).toBe('request-key');
    expect(api.createIdempotencyKey).toHaveBeenCalledTimes(1);
  }, 15_000);

  test('blocks registration CTA when the backend checklist is incomplete', async () => {
    const api = createService({
      competition: competitionPayload({
        tournaments: [{
          ...tournament,
          categories: [],
          checklist: {
            ...tournament.checklist,
            ready: false,
            errors: ['categories'],
            checks: { ...tournament.checklist.checks, categories: false },
          },
        }],
      }),
    });
    renderPath(
      `/torneos/organizacion/${ORGANIZATION_ID}/torneos/${TOURNAMENT_ID}/configuracion?step=5`,
      api,
    );
    expect(await screen.findByRole('button', { name: /preparar inscripción/i }))
      .toBeDisabled();
  });

  test('explains consequences before opening registration', async () => {
    const api = createService();
    renderPath(
      `/torneos/organizacion/${ORGANIZATION_ID}/torneos/${TOURNAMENT_ID}/configuracion?step=5`,
      api,
    );
    fireEvent.click(await screen.findByRole('button', { name: /preparar inscripción/i }));
    expect(screen.getByRole('heading', { name: 'Abrir la etapa de inscripción' }))
      .toBeInTheDocument();
    expect(screen.getByText(/se habilita el alta de equipos/i)).toBeInTheDocument();
    expect(api.changeTournamentStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir inscripción' }));
    await waitFor(() => expect(api.changeTournamentStatus).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      tournamentId: TOURNAMENT_ID,
      status: 'registration',
    }));
  });

  test('shows a recoverable dashboard error instead of zero teams', async () => {
    const api = createService({
      competition: competitionPayload({
        tournaments: [{ ...tournament, status: 'registration' }],
      }),
    });
    api.loadTeamsContext.mockRejectedValueOnce(new Error('Falló la consulta de equipos'))
      .mockResolvedValueOnce({ settings: { minimumPlayers: 7 }, entries: [] });
    renderPath(`/torneos/organizacion/${ORGANIZATION_ID}/inicio`, api);
    expect(await screen.findByText('Falló la consulta de equipos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No pudimos leer las inscripciones' }))
      .toBeInTheDocument();
    expect(screen.queryByText('0 equipos')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('0 equipos')).toBeInTheDocument();
  });
});
