import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
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
const APERTURA = {
  id: '30000000-0000-4000-8000-000000000001',
  name: 'Apertura 2027',
};
const CLAUSURA = {
  id: '30000000-0000-4000-8000-000000000002',
  name: 'Clausura 2027',
};
const ALL_FLAGS_ON = {
  mediaEnabled: true,
  mediaUploadEnabled: true,
  socialContentGenerator: true,
  officialStats: true,
};

function renderPlan({
  service = null,
  tournament = APERTURA,
  featureFlags = ALL_FLAGS_ON,
} = {}) {
  const planService = service || {
    loadEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture()),
  };
  render(
    <MemoryRouter initialEntries={[
      `/torneos/organizacion/${ORGANIZATION.id}/configuracion/plan`,
    ]}>
      <TorneosWorkspaceProvider service={planService} autoLoad={false}>
        <Routes>
          <Route
            path="/torneos/organizacion/:organizationId/configuracion/plan"
            element={(
              <PlanExperiencePage
                organization={ORGANIZATION}
                tournament={tournament}
                featureFlags={featureFlags}
              />
            )}
          />
        </Routes>
      </TorneosWorkspaceProvider>
    </MemoryRouter>,
  );
  return planService;
}

describe('Arma2 Torneos plan experience por edición', () => {
  test('FREE explains the first tournament and shows centralized pricing', async () => {
    const service = renderPlan();

    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
    expect(screen.getAllByText('Tu primer torneo, gratis').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Todo lo necesario para organizar tu campeonato.').length)
      .toBeGreaterThan(0);
    expect(screen.getByText(/Precio habitual:/)).toHaveTextContent(/49\.900/);
    expect(screen.getByText('Precio lanzamiento').nextElementSibling)
      .toHaveTextContent(/39\.900/);
    expect(screen.getByText('Pago único por torneo · Sin suscripción')).toBeInTheDocument();
    expect(screen.getByText('Este plan corresponde a esta edición.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/100 assets|0 de 1/);
    expect(service.loadEntitlements).toHaveBeenCalledWith({
      organizationId: ORGANIZATION.id,
      tournamentId: APERTURA.id,
    });
  });

  test('PREMIUM is permanent for this edition without ambiguous forever copy', async () => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
          plan: TOURNAMENT_PLANS.PREMIUM,
          galleryAssetLimit: 10000,
          administrativeSeatLimit: 10,
        })),
      },
    });

    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Premium' }))
      .toBeInTheDocument();
    expect(screen.getAllByText('Premium para esta edición').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pago único · acceso permanente para este torneo.').length)
      .toBeGreaterThan(0);
    expect(screen.getByText('Powered by Arma2')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('10.000 assets');
    expect(document.body).not.toHaveTextContent('Premium para siempre');
  });

  test('shows only Premium benefits that are available today', async () => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
          plan: TOURNAMENT_PLANS.PREMIUM,
        })),
      },
    });

    expect(await screen.findByText('Qué suma Premium hoy')).toBeInTheDocument();
    for (const label of ['Multimedia ampliada', 'Más colaboradores', 'Identidad más personalizada']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const hiddenCapability of [
      'Estadísticas avanzadas',
      'Sponsors',
      'Social Studio Premium',
      'Exportaciones profesionales',
    ]) {
      expect(screen.queryByText(hiddenCapability)).not.toBeInTheDocument();
    }
  });

  test('there is no fake checkout CTA or dead purchase flow', async () => {
    renderPlan();
    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /comprar|pagar|pasar a premium/i }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /entitlement|grant|tournament_id|checkout|funcionalidad futura|validado por servidor|licencia pertenece/i,
    );
  });

  test('resolver error fails closed without painting Premium', async () => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockRejectedValue(new Error('resolver unavailable')),
      },
    });

    expect(await screen.findByText('No pudimos cargar el plan'))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Arma2 Torneos Premium' }))
      .not.toBeInTheDocument();
  });

  test('a cross-edition payload is rejected instead of leaking Premium', async () => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
          tournamentId: CLAUSURA.id,
          plan: TOURNAMENT_PLANS.PREMIUM,
        })),
      },
    });

    expect(await screen.findByText('No pudimos cargar el plan'))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Arma2 Torneos Free' }))
      .toBeInTheDocument();
  });

  test('changing edition discards the previous plan before resolving the next', async () => {
    const service = {
      loadEntitlements: jest.fn(({ tournamentId }) => Promise.resolve(
        tournamentEntitlementsFixture({
          tournamentId,
          plan: tournamentId === APERTURA.id
            ? TOURNAMENT_PLANS.PREMIUM : TOURNAMENT_PLANS.FREE,
        }),
      )),
    };

    function TournamentHarness() {
      const [tournament, setTournament] = useState(APERTURA);
      return (
        <>
          <button type="button" onClick={() => setTournament(CLAUSURA)}>Cambiar edición</button>
          <PlanExperiencePage
            organization={ORGANIZATION}
            tournament={tournament}
            featureFlags={ALL_FLAGS_ON}
          />
        </>
      );
    }

    render(
      <MemoryRouter initialEntries={[
        `/torneos/organizacion/${ORGANIZATION.id}/configuracion/plan`,
      ]}>
        <TorneosWorkspaceProvider service={service} autoLoad={false}>
          <Routes>
            <Route
              path="/torneos/organizacion/:organizationId/configuracion/plan"
              element={<TournamentHarness />}
            />
          </Routes>
        </TorneosWorkspaceProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Arma2 Torneos Premium' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar edición' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Arma2 Torneos Free' }))
        .toBeInTheDocument();
    });
    expect(service.loadEntitlements).toHaveBeenLastCalledWith({
      organizationId: ORGANIZATION.id,
      tournamentId: CLAUSURA.id,
    });
  });

  test('without an active edition it asks for one and never calls the resolver', () => {
    const service = renderPlan({ tournament: null });
    expect(screen.getByText(/Elegí un torneo en el selector/i)).toBeInTheDocument();
    expect(service.loadEntitlements).not.toHaveBeenCalled();
  });
});
