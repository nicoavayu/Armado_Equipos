import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
import {
  createIdempotencyKey,
  createTournamentCheckout,
} from '../features/torneos/api/tournamentWorkspaceService';
import {
  TorneosCompetitionProvider,
  useTorneosCompetition,
} from '../features/torneos/context/TorneosCompetitionContext';
import { TorneosWorkspaceProvider } from '../features/torneos/context/TorneosWorkspaceContext';
import { TOURNAMENT_PLANS } from '../features/torneos/domain/entitlements';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

jest.mock('../features/torneos/api/tournamentWorkspaceService', () => ({
  ...jest.requireActual('../features/torneos/api/tournamentWorkspaceService'),
  createIdempotencyKey: jest.fn(),
  createTournamentCheckout: jest.fn(),
}));

const ORGANIZATION = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Liga Devoto',
  slug: 'liga-devoto',
  role: 'owner',
  capabilities: ['organization.read', 'workspace.access', 'workspace.manage'],
};
const SEASON = { id: '20000000-0000-4000-8000-000000000001', name: 'Temporada 2027' };
const SECOND_SEASON = { id: '20000000-0000-4000-8000-000000000002', name: 'Temporada 2028' };
const APERTURA = {
  id: '30000000-0000-4000-8000-000000000001', seasonId: SEASON.id, name: 'Apertura 2027',
};
const CLAUSURA = {
  id: '30000000-0000-4000-8000-000000000002', seasonId: SEASON.id, name: 'Clausura 2027',
};

function competitionPayload(activeTournamentId = APERTURA.id) {
  return {
    preference: {
      organizationId: ORGANIZATION.id,
      activeSeasonId: activeTournamentId ? SEASON.id : null,
      activeTournamentId,
    },
    seasons: [SEASON, SECOND_SEASON],
    tournaments: [APERTURA, CLAUSURA],
    modalities: [],
    formats: [],
  };
}

function createService({ loadSeasonEntitlements, activeTournamentId = APERTURA.id } = {}) {
  return {
    loadCompetitionContext: jest.fn().mockResolvedValue(competitionPayload(activeTournamentId)),
    setTournamentContext: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => 'key'),
    loadSeasonEntitlements: loadSeasonEntitlements || jest.fn().mockResolvedValue(
      tournamentEntitlementsFixture({ seasonId: SEASON.id, tournamentId: null }),
    ),
  };
}

function renderPlan({ service = createService(), child = null } = {}) {
  render(
    <MemoryRouter initialEntries={[
      `/torneos/organizacion/${ORGANIZATION.id}/temporada/${SEASON.id}/plan`,
    ]}>
      <TorneosWorkspaceProvider service={service} autoLoad={false}>
        <TorneosCompetitionProvider organizationId={ORGANIZATION.id} routeSeasonId={SEASON.id} service={service}>
          <Routes>
            <Route
              path="/torneos/organizacion/:organizationId/temporada/:seasonId/plan"
              element={child || <PlanExperiencePage organization={ORGANIZATION} />}
            />
            <Route
              path="/torneos/organizacion/:organizationId/temporada/:seasonId/plan/compra/:purchaseId/pendiente"
              element={<div data-testid="checkout-test-status">Checkout TEST</div>}
            />
          </Routes>
          <RouteLocationProbe />
        </TorneosCompetitionProvider>
      </TorneosWorkspaceProvider>
    </MemoryRouter>,
  );
  return service;
}

function RouteLocationProbe() {
  const location = useLocation();
  return <output data-testid="route-location">{location.pathname}</output>;
}

describe('Arma2 Torneos plan experience por temporada', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createIdempotencyKey.mockReturnValue('40000000-0000-4000-8000-000000000001');
    createTournamentCheckout.mockResolvedValue({
      purchase: { id: '50000000-0000-4000-8000-000000000001' },
      preference: { provider: 'FAKE', checkoutUrl: '/compra/pendiente' },
    });
  });
  test('FREE explains the commercial model and shows centralized pricing', async () => {
    const service = renderPlan();

    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
    expect(screen.getAllByText('Gratis para siempre por temporada.').length).toBeGreaterThan(0);
    expect(screen.getByText(/Precio habitual:/)).toHaveTextContent(/49\.900/);
    expect(screen.getByText('Precio lanzamiento').nextElementSibling)
      .toHaveTextContent(/39\.900/);
    expect(screen.getAllByText('Pago único para esta temporada · Sin suscripción').length)
      .toBeGreaterThan(0);
    expect(screen.getByText(
      /Cada temporada nace FREE para siempre\. Premium se paga una sola vez por la temporada/,
    )).toBeInTheDocument();
    expect(screen.getByText(/Owner \+ 1 colaborador/)).toBeInTheDocument();
    expect(service.loadSeasonEntitlements).toHaveBeenCalledWith({
      organizationId: ORGANIZATION.id,
      seasonId: SEASON.id,
    });
  });

  test('PREMIUM is permanent for this tournament without ambiguous forever copy', async () => {
    renderPlan({
      service: createService({
        loadSeasonEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
          seasonId: SEASON.id,
          tournamentId: null,
          plan: TOURNAMENT_PLANS.PREMIUM,
        })),
      }),
    });

    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Premium' }))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Profesionalizá esta temporada' }))
      .toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Powered by Arma2');
    expect(document.body).not.toHaveTextContent('Premium para siempre');
  });

  test('shows only the Premium result styles that are available today', async () => {
    renderPlan();

    expect(await screen.findByText('INCLUYE TODO LO DE FREE, MÁS:')).toBeInTheDocument();
    expect(screen.getByText('Multimedia ampliada')).toBeInTheDocument();
    expect(screen.getByText('Más colaboradores')).toBeInTheDocument();
    expect(screen.getByText('Las 11 familias Base de Social Studio')).toBeInTheDocument();
    expect(screen.getByText('Acceso Premium permanente')).toBeInTheDocument();
    expect(screen.getByText(/Street y Editorial disponibles donde están implementados: Resultados/)).toBeInTheDocument();
    expect(screen.getByText('ARS · por temporada')).toBeInTheDocument();
    expect(screen.getByText('Pago único para esta temporada · Sin suscripción')).toBeInTheDocument();
    expect(screen.getByText('Acceso Premium permanente para todos sus torneos.')).toBeInTheDocument();
    for (const unsupportedClaim of [
      'Identidad más personalizada',
      'Estadísticas avanzadas',
      'Sponsors',
      'Exportaciones profesionales',
      'white-label',
    ]) {
      expect(document.body).not.toHaveTextContent(unsupportedClaim);
    }
  });

  test('owner sees the checkout CTA without internal commercial terminology', async () => {
    renderPlan();
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /comprar|pagar|pasar a premium/i }))
      .toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /entitlement|grant|tournament_id|checkout|funcionalidad futura|validado por servidor/i,
    );
  });

  test('checkout navigates to the canonical pending route returned by the server flow', async () => {
    renderPlan();
    fireEvent.click(await screen.findByRole('button', { name: /Comprar Premium/i }));

    await waitFor(() => expect(createTournamentCheckout).toHaveBeenCalledWith({
      organizationId: ORGANIZATION.id,
      seasonId: SEASON.id,
      idempotencyKey: '40000000-0000-4000-8000-000000000001',
    }));
    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent(
      `/torneos/organizacion/${ORGANIZATION.id}/temporada/${SEASON.id}/plan/compra/50000000-0000-4000-8000-000000000001/pendiente`,
    ));
    expect(screen.getByTestId('checkout-test-status')).toHaveTextContent('Checkout TEST');
  });

  test('Mercado Pago Checkout Pro redirects only to its verified HTTPS checkout URL', async () => {
    const checkoutRedirect = jest.fn();
    createTournamentCheckout.mockResolvedValueOnce({
      purchase: { id: '50000000-0000-4000-8000-000000000001' },
      preference: {
        provider: 'MERCADO_PAGO',
        checkoutUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=test',
      },
    });
    renderPlan({ child: <PlanExperiencePage organization={ORGANIZATION} checkoutRedirect={checkoutRedirect} /> });
    fireEvent.click(await screen.findByRole('button', { name: /Comprar Premium/i }));
    await waitFor(() => expect(checkoutRedirect).toHaveBeenCalledWith(
      'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=test',
    ));
    expect(screen.getByRole('button', { name: /Redirigiendo/i })).toBeDisabled();
  });

  test('a provider URL outside Mercado Pago is rejected instead of becoming an open redirect', async () => {
    const checkoutRedirect = jest.fn();
    createTournamentCheckout.mockResolvedValueOnce({
      purchase: { id: '50000000-0000-4000-8000-000000000001' },
      preference: {
        provider: 'MERCADO_PAGO',
        checkoutUrl: 'https://attacker.invalid/checkout',
      },
    });
    renderPlan({ child: <PlanExperiencePage organization={ORGANIZATION} checkoutRedirect={checkoutRedirect} /> });
    fireEvent.click(await screen.findByRole('button', { name: /Comprar Premium/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/dirección de pago inválida/i);
    expect(checkoutRedirect).not.toHaveBeenCalled();
  });

  test('a new season remains FREE and never requires Premium to operate', async () => {
    renderPlan();
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Premium requerido');
    expect(screen.getByRole('button', { name: /Comprar Premium/i })).toBeEnabled();
  });

  test('collaborator cannot start checkout', async () => {
    renderPlan({ child: <PlanExperiencePage organization={{ ...ORGANIZATION, role: 'collaborator' }} /> });
    const button = await screen.findByRole('button', { name: /Comprar Premium/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Sólo el Propietario o un Administrador/)).toBeInTheDocument();
  });

  test('resolver error fails closed without mislabeling the tournament as Free', async () => {
    renderPlan({
      service: createService({
        loadSeasonEntitlements: jest.fn().mockRejectedValue(new Error('resolver unavailable')),
      }),
    });

    expect(await screen.findByRole('heading', { name: 'Plan no verificado' }))
      .toBeInTheDocument();
    expect(screen.getByText('No pudimos cargar el plan')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Arma2 Torneos (Free|Premium)/ }))
      .not.toBeInTheDocument();
  });

  test('a cross-season payload is rejected instead of leaking Premium or Free', async () => {
    renderPlan({
      service: createService({
        loadSeasonEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
          seasonId: SECOND_SEASON.id,
          tournamentId: null,
          plan: TOURNAMENT_PLANS.PREMIUM,
        })),
      }),
    });

    expect(await screen.findByRole('heading', { name: 'Plan no verificado' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Arma2 Torneos (Free|Premium)/ }))
      .not.toBeInTheDocument();
  });

  test('changing a child tournament keeps the parent season plan', async () => {
    const service = createService({
      loadSeasonEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
        seasonId: SEASON.id,
        tournamentId: null,
        plan: TOURNAMENT_PLANS.PREMIUM,
      })),
    });

    function TournamentHarness() {
      const competition = useTorneosCompetition();
      return (
        <>
          <button
            type="button"
            onClick={() => competition.selectContext(SEASON.id, CLAUSURA.id)}
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
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Premium' }))
      .toBeInTheDocument();
    expect(service.loadSeasonEntitlements).toHaveBeenCalledTimes(1);
    expect(service.loadSeasonEntitlements).toHaveBeenCalledWith({
      organizationId: ORGANIZATION.id,
      seasonId: SEASON.id,
    });
  });
});
