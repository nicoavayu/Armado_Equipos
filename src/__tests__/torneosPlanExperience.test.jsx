import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PlanExperiencePage from '../features/torneos/components/PlanExperiencePage';
import { TorneosWorkspaceProvider } from '../features/torneos/context/TorneosWorkspaceContext';

const ORG_A = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Liga Devoto',
  slug: 'liga-devoto',
  role: 'owner',
  capabilities: ['organization.read', 'workspace.access', 'workspace.manage'],
};
const ORG_B = {
  ...ORG_A,
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Liga Norte',
  slug: 'liga-norte',
};

const ALL_FLAGS_ON = {
  mediaEnabled: true,
  mediaUploadEnabled: true,
  socialContentGenerator: true,
  officialStats: true,
};

function entitlementPayload({
  organizationId = ORG_A.id,
  plan = 'FREE',
  subscriptionStatus = plan === 'PRO' ? 'active' : 'none',
  capabilities = {},
  media = {},
} = {}) {
  return {
    schemaVersion: 1,
    plan,
    subscriptionStatus,
    scope: {
      organizationId,
      tournamentId: null,
      audience: 'organization_member',
    },
    capabilities: {
      'media.upload': plan === 'FREE',
      'media.history': plan === 'PRO',
      'media.extended_retention': plan === 'PRO',
      'social_studio.basic': true,
      'social_studio.full': plan === 'PRO',
      advanced_stats: plan === 'PRO',
      higher_limits: plan === 'PRO',
      ...capabilities,
    },
    media: {
      maxPhotosPerMatchday: plan === 'FREE' ? 20 : null,
      retainedMatchdays: plan === 'FREE' ? 3 : null,
      retentionGraceDays: 7,
      postExpirationRetentionDays: plan === 'PRO' ? 90 : 0,
      postProProtectedUntil: null,
      ...media,
    },
  };
}

function renderPlan({
  organization = ORG_A,
  service,
  featureFlags = ALL_FLAGS_ON,
} = {}) {
  const planService = service || {
    loadEntitlements: jest.fn().mockResolvedValue(entitlementPayload()),
  };
  render(
    <MemoryRouter initialEntries={[
      `/torneos/organizacion/${organization.id}/configuracion/plan`,
    ]}>
      <TorneosWorkspaceProvider service={planService} autoLoad={false}>
        <Routes>
          <Route
            path="/torneos/organizacion/:organizationId/configuracion/plan"
            element={(
              <PlanExperiencePage
                organization={organization}
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

describe('Arma2 Torneos plan experience', () => {
  test('organization without subscription resolves FREE and displays server media limits', async () => {
    const service = renderPlan();

    expect(await screen.findByRole('heading', { name: 'PLAN FREE' })).toBeInTheDocument();
    expect(screen.getByText('Sin suscripción PRO')).toBeInTheDocument();
    expect(screen.getByText('20 fotos')).toBeInTheDocument();
    expect(screen.getByText('3 fechas')).toBeInTheDocument();
    expect(screen.getAllByText('7 días').length).toBeGreaterThan(0);
    expect(screen.getByText('Sin precio publicado')).toBeInTheDocument();
    expect(service.loadEntitlements).toHaveBeenCalledWith({
      organizationId: ORG_A.id,
      tournamentId: null,
    });
  });

  test.each([
    ['active', 'Activo'],
    ['cancelled', 'Cancelado'],
    ['grace_period', 'Período de gracia'],
  ])('PRO %s keeps PRO with its canonical lifecycle label', async (status, label) => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockResolvedValue(entitlementPayload({
          plan: 'PRO',
          subscriptionStatus: status,
        })),
      },
    });

    expect(await screen.findByRole('heading', { name: 'PLAN PRO' })).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  test.each([
    ['expired', 'PRO vencido'],
    ['past_due', 'Acceso PRO pausado'],
  ])('%s resolves FREE and never paints an active PRO plan', async (status, label) => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockResolvedValue(entitlementPayload({
          plan: 'FREE',
          subscriptionStatus: status,
        })),
      },
    });

    expect(await screen.findByRole('heading', { name: 'PLAN FREE' })).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'PLAN PRO' })).not.toBeInTheDocument();
  });

  test('feature flag off prevails over a true Social Studio entitlement', async () => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockResolvedValue(entitlementPayload({
          capabilities: { 'social_studio.basic': true },
        })),
      },
      featureFlags: { ...ALL_FLAGS_ON, socialContentGenerator: false },
    });

    expect(await screen.findByRole('heading', { name: 'PLAN FREE' })).toBeInTheDocument();
    const socialRow = screen.getByText('Estudio Social básico').closest('li');
    expect(socialRow).toHaveAttribute('data-status', 'feature_unavailable');
    expect(socialRow).toHaveTextContent('No disponible en este entorno');
  });

  test('upgrade CTA is local-only and cannot grant PRO', async () => {
    const service = renderPlan();
    const upgrade = await screen.findByRole('button', { name: /Pasar a PRO/i });
    fireEvent.click(upgrade);

    expect(screen.getByRole('dialog', { name: 'Disponible próximamente' })).toBeInTheDocument();
    expect(screen.getByText(/no compra, no crea una suscripción/i)).toBeInTheDocument();
    expect(service.loadEntitlements).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'PLAN FREE' })).toBeInTheDocument();
  });

  test('collaborator may read the plan but cannot use future commercial actions', async () => {
    renderPlan({
      organization: {
        ...ORG_A,
        role: 'collaborator',
        capabilities: ['organization.read', 'workspace.access'],
      },
    });

    expect(await screen.findByRole('heading', { name: 'PLAN FREE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pasar a PRO/i })).toBeDisabled();
    expect(screen.getByText(/Tu rol permite ver el plan/i)).toBeInTheDocument();
  });

  test('resolver error fails closed without breaking the plan route', async () => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockRejectedValue(new Error('resolver unavailable')),
      },
    });

    expect(await screen.findByText('Plan no verificado · acceso cerrado')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PLAN FREE' })).toBeInTheDocument();
    expect(screen.getAllByText('No verificado').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'PLAN PRO' })).not.toBeInTheDocument();
  });

  test('a cross-organization payload is rejected instead of leaking PRO', async () => {
    renderPlan({
      service: {
        loadEntitlements: jest.fn().mockResolvedValue(entitlementPayload({
          organizationId: ORG_B.id,
          plan: 'PRO',
        })),
      },
    });

    expect(await screen.findByText('Plan no verificado · acceso cerrado')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PLAN FREE' })).toBeInTheDocument();
  });

  test('changing workspace discards the previous plan before resolving the next organization', async () => {
    const service = {
      loadEntitlements: jest.fn(({ organizationId }) => Promise.resolve(
        entitlementPayload({
          organizationId,
          plan: organizationId === ORG_A.id ? 'PRO' : 'FREE',
          subscriptionStatus: organizationId === ORG_A.id ? 'active' : 'none',
        }),
      )),
    };

    function WorkspaceHarness() {
      const [organization, setOrganization] = useState(ORG_A);
      return (
        <>
          <button type="button" onClick={() => setOrganization(ORG_B)}>Cambiar organización</button>
          <PlanExperiencePage organization={organization} featureFlags={ALL_FLAGS_ON} />
        </>
      );
    }

    render(
      <MemoryRouter initialEntries={[
        `/torneos/organizacion/${ORG_A.id}/configuracion/plan`,
      ]}>
        <TorneosWorkspaceProvider service={service} autoLoad={false}>
          <Routes>
            <Route
              path="/torneos/organizacion/:organizationId/configuracion/plan"
              element={<WorkspaceHarness />}
            />
          </Routes>
        </TorneosWorkspaceProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'PLAN PRO' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar organización' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'PLAN FREE' })).toBeInTheDocument();
    });
    expect(service.loadEntitlements).toHaveBeenLastCalledWith({
      organizationId: ORG_B.id,
      tournamentId: null,
    });
  });
});
