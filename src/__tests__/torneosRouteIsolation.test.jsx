import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TorneosFeatureGate from '../features/torneos/TorneosFeatureGate';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';

function createService({ organizations = null, error = null } = {}) {
  const available = organizations ?? [{
    id: ORGANIZATION_ID,
    name: 'Liga Devoto',
    slug: 'liga-devoto',
    role: 'owner',
    status: 'active',
    createdAt: '2026-07-24T00:00:00.000Z',
    capabilities: [
      'organization.read',
      'organization.update',
      'organization.archive',
      'members.read',
      'workspace.access',
    ],
  }];
  return {
    loadContext: error
      ? jest.fn().mockRejectedValue(error)
      : jest.fn().mockResolvedValue({
        preference: {
          workspaceType: available.length ? 'tournament_organization' : 'personal',
          activeOrganizationId: available[0]?.id || null,
        },
        organizations: available,
      }),
    setPreference: jest.fn(async (workspaceType, organizationId) => ({
      workspaceType,
      activeOrganizationId: organizationId,
    })),
    createOrganization: jest.fn(),
    updateOrganization: jest.fn(),
    listMembers: jest.fn().mockResolvedValue([]),
    createIdempotencyKey: jest.fn(() => 'key'),
  };
}

describe('Arma2 Torneos route isolation', () => {
  test('redirects to personal home without initializing Torneos when disabled', () => {
    const service = createService();
    render(
      <MemoryRouter initialEntries={['/torneos']}>
        <Routes>
          <Route path="/" element={<div>Arma2 personal</div>} />
          <Route
            path="/torneos/*"
            element={<TorneosFeatureGate enabled={false} service={service} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Arma2 personal')).toBeInTheDocument();
    expect(service.loadContext).not.toHaveBeenCalled();
  });

  test('renders only the private organization shell after authorization', async () => {
    const service = createService();
    render(
      <MemoryRouter
        initialEntries={[`/torneos/organizacion/${ORGANIZATION_ID}/inicio`]}
      >
        <Routes>
          <Route
            path="/torneos/*"
            element={<TorneosFeatureGate enabled service={service} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /bienvenido a liga devoto/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegación de la organización' }))
      .toBeInTheDocument();
    expect(screen.queryByText('Crear partido')).not.toBeInTheDocument();
    expect(screen.queryByText('Amigos')).not.toBeInTheDocument();
    expect(screen.queryByText('Partidos hoy')).not.toBeInTheDocument();
  });

  test('does not reveal an organization that is absent from authorized memberships', async () => {
    const service = createService({ organizations: [] });
    render(
      <MemoryRouter
        initialEntries={['/torneos/organizacion/10000000-0000-4000-8000-000000000099/inicio']}
      >
        <Routes>
          <Route
            path="/torneos/*"
            element={<TorneosFeatureGate enabled service={service} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /el centro de mando/i }))
      .toBeInTheDocument();
    expect(screen.queryByText(/organización secreta/i)).not.toBeInTheDocument();
    expect(service.setPreference).not.toHaveBeenCalled();
  });

  test('shows a safe session/network error instead of workspace data', async () => {
    const service = createService({
      error: new Error('Tu sesión venció. Volvé a iniciar sesión para continuar.'),
    });
    render(
      <MemoryRouter initialEntries={['/torneos']}>
        <Routes>
          <Route
            path="/torneos/*"
            element={<TorneosFeatureGate enabled service={service} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión venció');
    expect(screen.queryByText('Liga Devoto')).not.toBeInTheDocument();
  });
});
