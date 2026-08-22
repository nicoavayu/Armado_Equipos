import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
import {
  TorneosCompetitionProvider,
  useTorneosCompetition,
} from '../features/torneos/context/TorneosCompetitionContext';
import { TorneosWorkspaceProvider } from '../features/torneos/context/TorneosWorkspaceContext';
import { TOURNAMENT_PLANS } from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

const ORGANIZATION = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Liga Devoto',
  slug: 'liga-devoto',
  role: 'owner',
  capabilities: ['organization.read', 'workspace.access', 'workspace.manage'],
};
const SEASON = '20000000-0000-4000-8000-000000000001';
const APERTURA = {
  id: '30000000-0000-4000-8000-000000000001', seasonId: SEASON, name: 'Apertura 2027',
};
const CLAUSURA = {
  id: '30000000-0000-4000-8000-000000000002', seasonId: SEASON, name: 'Clausura 2027',
};

function competitionPayload(activeTournamentId = APERTURA.id) {
  return {
    preference: {
      organizationId: ORGANIZATION.id,
      activeSeasonId: activeTournamentId ? SEASON : null,
      activeTournamentId,
    },
    seasons: [{ id: SEASON, name: 'Temporada 2027' }],
    tournaments: [APERTURA, CLAUSURA],
    modalities: [],
    formats: [],
  };
}

function createService({ loadEntitlements, activeTournamentId = APERTURA.id } = {}) {
  return {
    loadCompetitionContext: jest.fn().mockResolvedValue(competitionPayload(activeTournamentId)),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => 'key'),
    loadEntitlements: loadEntitlements || jest.fn().mockResolvedValue(
      tournamentEntitlementsFixture({ tournamentId: activeTournamentId }),
    ),
  };
}

function renderPlan({ service = createService(), child = null } = {}) {
  render(
    <MemoryRouter initialEntries={[
      `/torneos/organizacion/${ORGANIZATION.id}/configuracion/plan`,
    ]}>
      <TorneosWorkspaceProvider service={service} autoLoad={false}>
        <TorneosCompetitionProvider organizationId={ORGANIZATION.id} service={service}>
          <Routes>
            <Route
              path="/torneos/organizacion/:organizationId/configuracion/plan"
              element={child || <PlanExperiencePage organization={ORGANIZATION} />}
            />
          </Routes>
        </TorneosCompetitionProvider>
      </TorneosWorkspaceProvider>
    </MemoryRouter>,
  );
  return service;
}

describe('Arma2 Torneos plan experience por edición', () => {
  test('FREE explains the commercial model and shows centralized pricing', async () => {
    const service = renderPlan();

    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
    expect(screen.getAllByText('Tu primer torneo, gratis').length).toBeGreaterThan(0);
    expect(screen.getByText(/Precio habitual:/)).toHaveTextContent(/49\.900/);
    expect(screen.getByText('Precio lanzamiento').nextElementSibling)
      .toHaveTextContent(/39\.900/);
    expect(screen.getAllByText('Pagás una sola vez. Sin suscripción.').length)
      .toBeGreaterThan(0);
    expect(screen.getByText(
      /Tu primer torneo es gratis\. Después, pagás una sola vez por cada nuevo torneo\. Sin suscripción\./,
    )).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\bowner\b/i);
    expect(service.loadEntitlements).toHaveBeenCalledWith({
      organizationId: ORGANIZATION.id,
      tournamentId: APERTURA.id,
    });
  });

  test('PREMIUM is permanent for this tournament without ambiguous forever copy', async () => {
    renderPlan({
      service: createService({
        loadEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
          tournamentId: APERTURA.id,
          plan: TOURNAMENT_PLANS.PREMIUM,
        })),
      }),
    });

    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Premium' }))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Premium para este torneo' }))
      .toBeInTheDocument();
    expect(screen.getByText('Powered by Arma2')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium para siempre');
  });

  test('shows only the Premium result styles that are available today', async () => {
    renderPlan();

    expect(await screen.findByText('Qué suma Premium hoy')).toBeInTheDocument();
    expect(screen.getByText('Más estilos para resultados')).toBeInTheDocument();
    expect(screen.getByText(/Street y Editorial a Classic/)).toBeInTheDocument();
    for (const unsupportedClaim of [
      'Multimedia ampliada',
      'Más colaboradores',
      'Identidad más personalizada',
      'Estadísticas avanzadas',
      'Sponsors',
      'Exportaciones profesionales',
      'Hasta 10 colaboradores',
    ]) {
      expect(document.body).not.toHaveTextContent(unsupportedClaim);
    }
  });

  test('there is no fake checkout CTA or internal commercial terminology', async () => {
    renderPlan();
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /comprar|pagar|pasar a premium/i }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /entitlement|grant|tournament_id|checkout|funcionalidad futura|validado por servidor/i,
    );
  });

  test('resolver error fails closed without mislabeling the tournament as Free', async () => {
    renderPlan({
      service: createService({
        loadEntitlements: jest.fn().mockRejectedValue(new Error('resolver unavailable')),
      }),
    });

    expect(await screen.findByRole('heading', { name: 'Plan no verificado' }))
      .toBeInTheDocument();
    expect(screen.getByText('No pudimos cargar el plan')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Arma2 Torneos (Free|Premium)/ }))
      .not.toBeInTheDocument();
  });

  test('a cross-edition payload is rejected instead of leaking Premium or Free', async () => {
    renderPlan({
      service: createService({
        loadEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
          tournamentId: CLAUSURA.id,
          plan: TOURNAMENT_PLANS.PREMIUM,
        })),
      }),
    });

    expect(await screen.findByRole('heading', { name: 'Plan no verificado' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Arma2 Torneos (Free|Premium)/ }))
      .not.toBeInTheDocument();
  });

  test('changing edition discards the previous plan before resolving the next', async () => {
    let releaseFree;
    const freePlan = new Promise((resolve) => { releaseFree = resolve; });
    const service = createService({
      loadEntitlements: jest.fn(({ tournamentId }) => (
        tournamentId === APERTURA.id
          ? Promise.resolve(tournamentEntitlementsFixture({
            tournamentId,
            plan: TOURNAMENT_PLANS.PREMIUM,
          }))
          : freePlan
      )),
    });

    function TournamentHarness() {
      const competition = useTorneosCompetition();
      return (
        <>
          <button
            type="button"
            onClick={() => competition.selectContext(SEASON, CLAUSURA.id)}
          >
            Cambiar edición
          </button>
          <PlanExperiencePage organization={ORGANIZATION} />
        </>
      );
    }

    renderPlan({ service, child: <TournamentHarness /> });
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Premium' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar edición' }));
    expect(await screen.findByText('Cargando el plan de este torneo…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Arma2 Torneos Premium' }))
      .not.toBeInTheDocument();

    releaseFree(tournamentEntitlementsFixture({ tournamentId: CLAUSURA.id }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Arma2 Torneos Free' })).toBeInTheDocument();
    });
    expect(service.loadEntitlements).toHaveBeenLastCalledWith({
      organizationId: ORGANIZATION.id,
      tournamentId: CLAUSURA.id,
    });
  });

  test('without an active edition it asks for one and never calls the resolver', async () => {
    const service = createService({ activeTournamentId: null });
    renderPlan({ service });
    expect(await screen.findByText(/Elegí un torneo en el selector/i)).toBeInTheDocument();
    expect(service.loadEntitlements).not.toHaveBeenCalled();
  });
});
