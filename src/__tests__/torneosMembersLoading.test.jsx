import React from 'react';
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

// POST-BETA issue 4 (Miembros ~13 s): the page read get_tournament_competition_context on its own,
// although OrganizationRouteGuard's provider already holds it, and the season accesses waited for
// that second read. Now the seasons come from the provider.

const ORG = 'f1000000-0000-4000-8000-000000000001';
const SEASON = 'f2000000-0000-4000-8000-000000000001';

function createService() {
  const organization = {
    id: ORG, name: 'Liga QA', slug: 'liga-qa', role: 'owner', capabilities: getCapabilitiesForRole('owner'),
  };
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG },
      organizations: [organization],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    loadCompetitionContext: jest.fn().mockResolvedValue({
      preference: { organizationId: ORG, activeSeasonId: SEASON, activeTournamentId: null },
      seasons: [{ id: SEASON, name: 'Apertura', status: 'active' }],
      tournaments: [],
      modalities: [],
      formats: [],
    }),
    listMembers: jest.fn().mockResolvedValue([{
      id: 'membership-owner',
      user_id: 'user-owner',
      role: 'owner',
      status: 'active',
      joined_at: '2026-09-01T00:00:00Z',
      created_at: '2026-09-01T00:00:00Z',
      email: null,
      is_viewer: true,
    }]),
    listSeasonMemberAssignments: jest.fn().mockResolvedValue([]),
    createIdempotencyKey: jest.fn(() => 'request-a'),
  };
}

function renderMembers(service) {
  return render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORG}/miembros`]}>
      <Routes>
        <Route path="/torneos/*" element={<TorneosFeatureGate enabled service={service} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Miembros: las temporadas salen del contexto de la organización', () => {
  test('una sola lectura del contexto competitivo; los accesos de la temporada se piden con él', async () => {
    const service = createService();
    renderMembers(service);
    expect(await screen.findByText('1 miembro', {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(service.listSeasonMemberAssignments).toHaveBeenCalledWith({
      organizationId: ORG, seasonId: SEASON,
    }));
    expect(service.loadCompetitionContext).toHaveBeenCalledTimes(1);
    expect(service.listMembers).toHaveBeenCalledTimes(1);
  });

  test('si el contexto competitivo falla, la página no inventa temporadas: error y Reintentar', async () => {
    const service = createService();
    service.loadCompetitionContext.mockRejectedValueOnce(new Error('No pudimos cargar temporadas y torneos.'));
    renderMembers(service);
    expect(await screen.findByText('No pudimos cargar temporadas y torneos.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(service.listSeasonMemberAssignments).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('1 miembro')).toBeInTheDocument();
    await waitFor(() => expect(service.listSeasonMemberAssignments).toHaveBeenCalledTimes(1));
    expect(service.loadCompetitionContext).toHaveBeenCalledTimes(2);
  });
});
