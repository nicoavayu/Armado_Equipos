import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

const ORG = 'a1000000-0000-4000-8000-000000000001';
const TOURNAMENT = 'a2000000-0000-4000-8000-000000000001';
const CATEGORY = 'a3000000-0000-4000-8000-000000000001';
const MATCH = 'a4000000-0000-4000-8000-000000000001';
const HOME = 'a5000000-0000-4000-8000-000000000001';
const AWAY = 'a5000000-0000-4000-8000-000000000002';

function competition() {
  return {
    preference: {
      organizationId: ORG,
      activeSeasonId: 'season-a',
      activeTournamentId: TOURNAMENT,
    },
    seasons: [{ id: 'season-a', name: 'Apertura', status: 'active' }],
    tournaments: [{
      id: TOURNAMENT,
      seasonId: 'season-a',
      name: 'Liga Devoto',
      status: 'active',
      categories: [{ id: CATEGORY, name: 'Primera', status: 'active' }],
    }],
    modalities: [],
    formats: [],
  };
}

function operationalMatch(overrides = {}) {
  return {
    id: MATCH,
    categoryId: CATEGORY,
    matchNumber: 7,
    scheduledAt: '2030-06-01T18:00:00.000Z',
    planningStatus: 'ready',
    venue: 'Club Horizonte',
    court: 'Cancha 1',
    homeTeamEntryId: HOME,
    awayTeamEntryId: AWAY,
    homeName: 'Napoli',
    awayName: 'Belgrano',
    homeSquadStatus: 'submitted',
    awaySquadStatus: null,
    operationId: null,
    operationStatus: null,
    ...overrides,
  };
}

function createService({ organizations = true, playerMatches = [] } = {}) {
  const organization = {
    id: ORG,
    name: 'Liga Devoto',
    slug: 'liga-devoto',
    role: 'owner',
    capabilities: getCapabilitiesForRole('owner'),
  };
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: organizations
        ? { workspaceType: 'tournament_organization', activeOrganizationId: ORG }
        : { workspaceType: 'personal', activeOrganizationId: null },
      organizations: organizations ? [organization] : [],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    loadCompetitionContext: jest.fn().mockResolvedValue(competition()),
    setTournamentContext: jest.fn(),
    loadFixtureContext: jest.fn().mockResolvedValue({}),
    loadScheduleContext: jest.fn().mockResolvedValue({}),
    loadMatchOperations: jest.fn().mockResolvedValue({
      matches: [operationalMatch()],
    }),
    loadMatchOperation: jest.fn(),
    loadMatchSquad: jest.fn(),
    openMatchOperation: jest.fn().mockResolvedValue({ operation: { id: 'operation-a' } }),
    loadPlayerMatches: jest.fn().mockResolvedValue(playerMatches),
    respondMatchAvailability: jest.fn().mockResolvedValue({ response: 'available' }),
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

describe('Arma2 Torneos match operations flow', () => {
  test('renders the persisted operational queue and its alerts', async () => {
    const service = createService();
    renderPath(`/torneos/organizacion/${ORG}/partidos`, service);
    expect(await screen.findByRole('heading', { name: 'Partidos' })).toBeInTheDocument();
    expect(await screen.findByText('Napoli')).toBeInTheDocument();
    expect(await screen.findByText('Belgrano')).toBeInTheDocument();
    const metrics = screen.getByLabelText('Resumen operativo');
    const withoutSquadMetric = within(metrics)
      .getByText('Sin convocatoria')
      .closest('article');
    expect(within(withoutSquadMetric).getByText('1')).toBeInTheDocument();
    expect(service.loadMatchOperations).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG,
      tournamentId: TOURNAMENT,
    }));
  });

  test('protects act opening from repeated clicks', async () => {
    const service = createService();
    let resolveOpen;
    service.openMatchOperation.mockImplementation(() => new Promise((resolve) => {
      resolveOpen = resolve;
    }));
    renderPath(`/torneos/organizacion/${ORG}/partidos/${MATCH}`, service);
    const button = await screen.findByRole('button', { name: 'Abrir acta' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(service.openMatchOperation).toHaveBeenCalledTimes(1);
    await act(async () => resolveOpen({}));
    await waitFor(() => expect(service.loadMatchOperations.mock.calls.length).toBeGreaterThan(1));
  });

  test('shows an empty player surface without exposing another roster', async () => {
    const service = createService({ organizations: false, playerMatches: [] });
    renderPath('/torneos/mis-partidos', service);
    expect(await screen.findByRole('heading', { name: 'Mis partidos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No tenés partidos próximos' })).toBeInTheDocument();
    expect(screen.queryByText('Napoli')).not.toBeInTheDocument();
  });

  test('lets the linked player respond only for the rendered match', async () => {
    const service = createService({
      organizations: false,
      playerMatches: [{
        matchId: MATCH,
        teamName: 'Napoli',
        opponentName: 'Belgrano',
        isHome: true,
        scheduledAt: '2030-06-01T18:00:00.000Z',
        status: 'ready',
        venue: 'Club Horizonte',
        court: 'Cancha 1',
        availability: null,
      }],
    });
    renderPath('/torneos/mis-partidos', service);
    expect(await screen.findByRole('heading', { name: 'VS. Belgrano' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Voy' }));
    expect(service.respondMatchAvailability).toHaveBeenCalledWith({
      matchId: MATCH,
      response: 'available',
    });
    await waitFor(() => expect(service.loadPlayerMatches).toHaveBeenCalledTimes(2));
  });

  test('keeps availability read-only when the match is postponed', async () => {
    const service = createService({
      organizations: false,
      playerMatches: [{
        matchId: MATCH,
        teamName: 'Napoli',
        opponentName: 'Belgrano',
        isHome: true,
        scheduledAt: null,
        status: 'postponed',
        venue: null,
        court: null,
        availability: 'available',
      }],
    });
    renderPath('/torneos/mis-partidos', service);
    const available = await screen.findByRole('button', { name: 'Voy' });
    expect(available).toBeDisabled();
    fireEvent.click(available);
    expect(service.respondMatchAvailability).not.toHaveBeenCalled();
  });
});
