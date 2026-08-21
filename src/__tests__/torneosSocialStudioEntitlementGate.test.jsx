import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SocialStudioEntitlementGate, {
  useSocialStudioEntitlement,
} from '../features/torneos/components/SocialStudioEntitlementGate';
import { tournamentEntitlementsFixture } from '../testUtils/tournamentEntitlementsFixture';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';

function GateHarness({ service, enabled = true }) {
  const access = useSocialStudioEntitlement({
    organizationId: ORGANIZATION_ID,
    service,
    enabled,
  });
  return (
    <SocialStudioEntitlementGate access={access} organizationId={ORGANIZATION_ID}>
      <div>Estudio autorizado por rol</div>
    </SocialStudioEntitlementGate>
  );
}

function renderGate(service, enabled = true) {
  return render(
    <MemoryRouter initialEntries={[`/torneos/organizacion/${ORGANIZATION_ID}/estudio-social`]}>
      <Routes>
        <Route
          path="/torneos/organizacion/:organizationId/estudio-social"
          element={<GateHarness service={service} enabled={enabled} />}
        />
        <Route
          path="/torneos/organizacion/:organizationId/inicio"
          element={<div>Inicio de organización</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Social Studio entitlement gate', () => {
  test('requires the canonical basic entitlement before rendering the role-gated studio', async () => {
    const service = {
      loadEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
        tournamentId: null,
      })),
    };
    renderGate(service);

    expect(await screen.findByText('Estudio autorizado por rol')).toBeInTheDocument();
    expect(service.loadEntitlements).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      tournamentId: null,
    });
  });

  test('fails closed when the entitlement is disabled', async () => {
    const service = {
      loadEntitlements: jest.fn().mockResolvedValue(tournamentEntitlementsFixture({
        tournamentId: null,
        plan: 'PREMIUM',
        capabilities: { 'social_studio.basic': false, 'social_studio.full': true },
      })),
    };
    renderGate(service);

    expect(await screen.findByText('Inicio de organización')).toBeInTheDocument();
    expect(screen.queryByText('Estudio autorizado por rol')).not.toBeInTheDocument();
  });

  test('feature flag off does not call entitlements and fails closed', async () => {
    const service = { loadEntitlements: jest.fn() };
    renderGate(service, false);

    expect(await screen.findByText('Inicio de organización')).toBeInTheDocument();
    expect(service.loadEntitlements).not.toHaveBeenCalled();
  });
});
