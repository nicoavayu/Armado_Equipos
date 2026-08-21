import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QaTournamentReviewMapPage from '../QaTournamentReviewMapPage';
import { canonicalRoutes } from '../../torneos/routing/canonicalRoutes';

const ORG = '11000000-0000-4000-8000-000000000001';
const TOURNAMENT = '12000000-0000-4000-8000-000000000001';
const CATEGORY = '13000000-0000-4000-8000-000000000001';
const TEAM = '14000000-0000-4000-8000-000000000001';
const MATCH = '15000000-0000-4000-8000-000000000001';
const FREE_ORG = '16000000-0000-4000-8000-000000000001';
const FREE_TOURNAMENT = '17000000-0000-4000-8000-000000000001';

function createService({ organizations = null } = {}) {
  return {
    loadContext: jest.fn().mockResolvedValue({
      organizations: organizations ?? [
        { id: ORG, slug: 'qa-metropolitana', name: 'AMFA' },
        { id: FREE_ORG, slug: 'qa-planes-first-free', name: 'QA Planes' },
      ],
    }),
    loadCompetitionContext: jest.fn().mockImplementation(async (organizationId) => (
      organizationId === FREE_ORG ? {
        preference: { activeTournamentId: FREE_TOURNAMENT },
        tournaments: [{ id: FREE_TOURNAMENT, name: 'Primer Torneo Free QA', categories: [] }],
      } : {
        preference: { activeTournamentId: TOURNAMENT },
        tournaments: [{
          id: TOURNAMENT,
          name: 'Torneo Apertura QA 2026',
          categories: [{ id: CATEGORY, name: 'Abierta', status: 'active' }],
        }],
      }
    )),
    loadTeamsContext: jest.fn().mockResolvedValue({
      entries: [{ id: TEAM, name: 'Barrio Norte FC' }],
    }),
    loadMatchOperations: jest.fn().mockResolvedValue({
      matches: [{ id: MATCH, matchNumber: 4, operationId: 'operation-a' }],
    }),
    loadPublicPageSettings: jest.fn().mockResolvedValue({
      published: true,
      publicPath: '/torneos/publico/qa-metropolitana',
    }),
    loadEntitlements: jest.fn().mockImplementation(async ({ organizationId }) => ({
      plan: organizationId === FREE_ORG ? 'FREE' : 'PREMIUM',
    })),
  };
}

function renderMap(service) {
  return render(
    <MemoryRouter>
      <QaTournamentReviewMapPage service={service} />
    </MemoryRouter>,
  );
}

describe('QA tournament review map', () => {
  test('builds canonical links from data returned through the current session', async () => {
    const service = createService();
    renderMap(service);

    expect(await screen.findByRole('heading', { name: 'QA · Recorrido Torneos' }))
      .toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Identidad visual · Escudo y Foto del equipo/i }))
      .toHaveAttribute('href', canonicalRoutes.organizationTeamEntryVisualIdentity(ORG, TEAM));
    expect(screen.getByRole('link', { name: /Partido rico Acta/i })).toHaveAttribute(
      'href',
      canonicalRoutes.tournamentMatchReport(ORG, TOURNAMENT, MATCH, { categoryId: CATEGORY }),
    );
    expect(screen.getByRole('link', { name: /Pública Página pública/i }))
      .toHaveAttribute('href', '/torneos/publico/qa-metropolitana');
    expect(screen.getByRole('link', { name: /Ejemplo Free · Primer torneo/i }))
      .toHaveAttribute('href', canonicalRoutes.organizationSettingsPlan(FREE_ORG));
    expect(screen.getByRole('link', { name: /Ejemplo Premium · Edición preexistente/i }))
      .toHaveAttribute('href', canonicalRoutes.organizationSettingsPlan(ORG));
    expect(service.loadMatchOperations).toHaveBeenCalledWith({
      organizationId: ORG,
      tournamentId: TOURNAMENT,
      categoryId: CATEGORY,
    });
  });

  test('fails closed for a role without an authorized organization', async () => {
    const service = createService({ organizations: [] });
    renderMap(service);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este rol no tiene una organización QA disponible.',
    );
    expect(service.loadCompetitionContext).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Destinos del recorrido QA' })).toBeNull();
  });
});
