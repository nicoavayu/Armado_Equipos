import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CompetitionSelector from '../features/torneos/components/CompetitionSelector';
import { TorneosCompetitionProvider } from '../features/torneos/context/TorneosCompetitionContext';
import { TOURNAMENT_PLANS } from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

const ORGANIZATION = '10000000-0000-4000-8000-000000000001';
const SEASON = '20000000-0000-4000-8000-000000000001';
const FREE = '30000000-0000-4000-8000-000000000001';
const PREMIUM = '30000000-0000-4000-8000-000000000002';

function competitionPayload(activeTournamentId = FREE) {
  return {
    preference: {
      organizationId: ORGANIZATION,
      activeSeasonId: SEASON,
      activeTournamentId,
    },
    seasons: [{ id: SEASON, name: 'Temporada 2027' }],
    tournaments: [
      { id: FREE, seasonId: SEASON, name: 'Primer Torneo' },
      { id: PREMIUM, seasonId: SEASON, name: 'Torneo Apertura QA 2026' },
    ],
    modalities: [],
    formats: [],
  };
}

function createService(loadEntitlements, activeTournamentId = FREE) {
  return {
    loadCompetitionContext: jest.fn().mockResolvedValue(competitionPayload(activeTournamentId)),
    loadEntitlements,
    setTournamentContext: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => 'key'),
  };
}

function renderSelector(service) {
  render(
    <MemoryRouter initialEntries={[
      `/torneos/organizacion/${ORGANIZATION}/configuracion/plan`,
    ]}>
      <TorneosCompetitionProvider organizationId={ORGANIZATION} service={service}>
        <CompetitionSelector />
      </TorneosCompetitionProvider>
    </MemoryRouter>,
  );
}

describe('selected tournament plan awareness', () => {
  test('shows the Free badge from trusted server state', async () => {
    renderSelector(createService(jest.fn().mockResolvedValue(
      tournamentEntitlementsFixture({ tournamentId: FREE }),
    )));
    const badge = await screen.findByLabelText('Plan del torneo: Free');
    const seasonControl = screen.getByRole('combobox', { name: 'Temporada activa' });
    const tournamentControl = screen.getByRole('combobox', { name: 'Torneo activo' });

    expect(badge).toHaveTextContent('Free');
    expect(tournamentControl.closest('label')).toContainElement(badge);
    expect(seasonControl.closest('label')).not.toContainElement(badge);
  });

  test('shows the richer Premium badge from trusted server state', async () => {
    renderSelector(createService(
      jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
        tournamentId: PREMIUM,
        plan: TOURNAMENT_PLANS.PREMIUM,
      })),
      PREMIUM,
    ));
    expect(await screen.findByLabelText('Plan del torneo: Premium')).toHaveTextContent('Premium');
  });

  test('loading never temporarily labels a tournament Free', async () => {
    const unresolved = new Promise(() => {});
    renderSelector(createService(jest.fn(() => unresolved)));
    expect(await screen.findByLabelText('Plan del torneo: Verificando plan'))
      .toHaveTextContent('Verificando plan');
    expect(screen.queryByLabelText('Plan del torneo: Free')).not.toBeInTheDocument();
  });

  test('resolver failure says Plan no verificado instead of Free', async () => {
    renderSelector(createService(jest.fn().mockRejectedValue(new Error('offline'))));
    expect(await screen.findByLabelText('Plan del torneo: Plan no verificado'))
      .toHaveTextContent('Plan no verificado');
    expect(screen.queryByLabelText('Plan del torneo: Free')).not.toBeInTheDocument();
  });

  test('changing tournament discards Premium immediately and resolves the new Free plan', async () => {
    let releaseFree;
    const nextFree = new Promise((resolve) => { releaseFree = resolve; });
    const loadEntitlements = jest.fn(({ tournamentId }) => (
      tournamentId === PREMIUM
        ? Promise.resolve(tournamentEntitlementsFixture({
          tournamentId,
          plan: TOURNAMENT_PLANS.PREMIUM,
        }))
        : nextFree
    ));
    renderSelector(createService(loadEntitlements, PREMIUM));
    expect(await screen.findByLabelText('Plan del torneo: Premium')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Torneo activo' }), {
      target: { value: FREE },
    });
    expect(await screen.findByLabelText('Plan del torneo: Verificando plan')).toBeInTheDocument();
    expect(screen.queryByLabelText('Plan del torneo: Premium')).not.toBeInTheDocument();

    releaseFree(tournamentEntitlementsFixture({ tournamentId: FREE }));
    await waitFor(() => expect(screen.getByLabelText('Plan del torneo: Free')).toBeInTheDocument());
    expect(loadEntitlements).toHaveBeenLastCalledWith({
      organizationId: ORGANIZATION,
      tournamentId: FREE,
    });
  });
});
