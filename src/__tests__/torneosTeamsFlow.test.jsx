import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

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
  };
}

function createService({ role = 'owner', organizations = true } = {}) {
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
    loadCompetitionContext: jest.fn().mockResolvedValue(competition()),
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

  test('allows a relational captain route without organization membership', async () => {
    const service = createService({ organizations: false });
    renderPath(`/torneos/organizacion/${ORG}/equipos/${ENTRY}/plantel`, service);
    expect(await screen.findByRole('heading', { name: 'Napoli' })).toBeInTheDocument();
    expect(screen.getByText('Plantel vacío')).toBeInTheDocument();
    expect(service.loadTeamRegistration).toHaveBeenCalledWith(ORG, ENTRY);
    await waitFor(() => expect(screen.getByText('Presentar plantel')).toBeDisabled());
  });
});
