import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import { organizationVenues } from '../features/torneos/routing/canonicalRoutes';

jest.mock('../components/global-header/GlobalHeader', () => () => (
  <header data-testid="global-header" />
));

const ORG = 'd1000000-0000-4000-8000-000000000001';

function createService({ role = 'owner' } = {}) {
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'tournament_organization', activeOrganizationId: ORG },
      organizations: [{
        id: ORG,
        name: 'Liga Devoto',
        slug: 'liga-devoto',
        role,
        status: 'active',
        capabilities: getCapabilitiesForRole(role),
      }],
    }),
    setPreference: jest.fn().mockResolvedValue({ activeOrganizationId: ORG }),
    // Sin torneos ni temporadas: la organización todavía no configuró nada.
    // Sedes tiene que funcionar igual.
    loadCompetitionContext: jest.fn().mockResolvedValue({
      preference: { organizationId: ORG, activeSeasonId: null, activeTournamentId: null },
      seasons: [],
      tournaments: [],
      modalities: [],
      formats: [],
    }),
    setTournamentContext: jest.fn(),
    loadFixtureContext: jest.fn(),
    loadScheduleContext: jest.fn(),
    loadOrganizationVenues: jest.fn().mockResolvedValue({
      venues: [{
        id: 'venue-a', name: 'Complejo Central', address: 'Av. Central 100', status: 'active',
      }],
      courts: [{
        id: 'court-a', venueId: 'venue-a', name: 'Cancha 1', status: 'active',
      }],
    }),
    createVenue: jest.fn().mockResolvedValue({}),
    createCourt: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => 'key'),
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

describe('Sedes sigue siendo organization-scoped', () => {
  test('opens with no tournament selected at all', async () => {
    const api = createService();
    renderPath(organizationVenues(ORG), api);

    expect(await screen.findByRole('heading', { name: 'Sedes' }, { timeout: 5000 }))
      .toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Complejo Central' }))
      .toBeInTheDocument();
    expect(screen.getByText(/1 canchas/)).toBeInTheDocument();

    // La lectura es de la organización y no pasa por el contexto de torneo.
    expect(api.loadOrganizationVenues).toHaveBeenCalledWith(ORG);
    expect(api.loadFixtureContext).not.toHaveBeenCalled();
    expect(api.loadScheduleContext).not.toHaveBeenCalled();
  });

  test('creates venues and courts against the organization, never a tournament', async () => {
    const api = createService();
    renderPath(organizationVenues(ORG), api);
    const heading = await screen.findByRole('heading', { name: 'Nueva sede' }, { timeout: 5000 });
    const form = heading.closest('form');

    fireEvent.change(within(form).getByLabelText('Nombre'), {
      target: { value: 'Polideportivo Sur' },
    });
    fireEvent.change(within(form).getByLabelText('Dirección'), {
      target: { value: 'Calle 9 1200' },
    });
    fireEvent.click(within(form).getByRole('button', { name: /crear sede/i }));

    await waitFor(() => {
      expect(api.createVenue).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: ORG,
        name: 'Polideportivo Sur',
        address: 'Calle 9 1200',
      }));
    });
    expect(api.createVenue.mock.calls[0][0]).not.toHaveProperty('tournamentId');
    expect(api.createVenue.mock.calls[0][0]).not.toHaveProperty('categoryId');
  });

  test('hides the management forms without the venues capability', async () => {
    const api = createService({ role: 'viewer' });
    renderPath(organizationVenues(ORG), api);
    expect(await screen.findByRole('heading', { name: 'Sedes' }, { timeout: 5000 }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nueva sede' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nueva cancha' })).not.toBeInTheDocument();
  });

  test('the canonical sedes route carries no tournament id', () => {
    expect(organizationVenues(ORG)).toBe(`/torneos/organizacion/${ORG}/sedes`);
    expect(organizationVenues(ORG)).not.toContain('/torneo/');
  });
});
