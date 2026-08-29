import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom';
import OrganizationMembersPage from '../features/torneos/components/OrganizationMembersPage';
import OrganizationSettingsPage from '../features/torneos/components/OrganizationSettingsPage';
import {
  getCapabilitiesForRole,
} from '../features/torneos/domain/capabilities';

let mockWorkspace;

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => mockWorkspace,
}));

const organizationFor = (role) => ({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Liga Metropolitana',
  slug: 'liga-metropolitana',
  status: 'active',
  role,
  capabilities: getCapabilitiesForRole(role),
});

function renderOrganizationRoute(element, organization, path = 'configuracion') {
  return render(
    <MemoryRouter initialEntries={[
      `/torneos/organizacion/${organization.id}/${path}`,
    ]}
    >
      <Routes>
        <Route
          path="/torneos/organizacion/:organizationId"
          element={<Outlet context={{ organization }} />}
        >
          <Route path={path} element={element} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('organization settings permission contract', () => {
  beforeEach(() => {
    mockWorkspace = {
      updateOrganization: jest.fn().mockResolvedValue({}),
      service: {
        listMembers: jest.fn().mockResolvedValue([]),
        loadCompetitionContext: jest.fn().mockResolvedValue({ seasons: [] }),
        listSeasonMemberAssignments: jest.fn().mockResolvedValue([]),
        loadSeasonEntitlements: jest.fn().mockResolvedValue({
          limits: { administrativeCollaboratorLimit: 1 },
        }),
        assignSeasonMember: jest.fn().mockResolvedValue({}),
        removeSeasonMemberAssignment: jest.fn().mockResolvedValue(true),
      },
    };
  });

  test('keeps collaborator on the settings route in read-only mode', () => {
    renderOrganizationRoute(
      <OrganizationSettingsPage />,
      organizationFor('collaborator'),
    );

    expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByText(/Tenés acceso de lectura/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(screen.getByLabelText('Identificador')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archivar' })).not.toBeInTheDocument();

    fireEvent.submit(screen.getByLabelText('Nombre').closest('form'));
    expect(mockWorkspace.updateOrganization).not.toHaveBeenCalled();
  });

  test.each([
    ['owner', true],
    ['admin', false],
  ])('allows %s to edit while preserving its archive contract', async (role, canArchive) => {
    renderOrganizationRoute(<OrganizationSettingsPage />, organizationFor(role));

    const name = screen.getByLabelText('Nombre');
    expect(name).toBeEnabled();
    fireEvent.change(name, { target: { value: 'Liga Metropolitana Renovada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(mockWorkspace.updateOrganization).toHaveBeenCalledWith({
        organizationId: '10000000-0000-4000-8000-000000000001',
        name: 'Liga Metropolitana Renovada',
        slug: 'liga-metropolitana',
      });
    });
    expect(await screen.findByText('Los cambios se guardaron.')).toBeInTheDocument();
    expect(Boolean(screen.queryByRole('heading', { name: 'Archivar organización' })))
      .toBe(canArchive);
  });

  test('shows centralized labels and permission explanations in the member review', async () => {
    mockWorkspace.service.listMembers.mockResolvedValue([
      {
        id: 'member-owner',
        user_id: 'owner-user',
        role: 'owner',
        status: 'active',
        joined_at: '2026-08-01T12:00:00Z',
      },
      {
        id: 'member-collaborator',
        user_id: 'collaborator-user',
        role: 'collaborator',
        status: 'active',
        joined_at: '2026-08-02T12:00:00Z',
      },
    ]);

    renderOrganizationRoute(
      <OrganizationMembersPage />,
      organizationFor('owner'),
      'miembros',
    );

    expect((await screen.findAllByText('Propietario')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Colaborador').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Control total de la organización/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sin realizar cambios administrativos/).length).toBeGreaterThan(0);
    expect(screen.getByText('Delegado')).toBeInTheDocument();
    expect(screen.getByText(/equipos o planteles que tiene asignados/)).toBeInTheDocument();
    expect(screen.getByText('Jugador')).toBeInTheDocument();
    expect(screen.queryByText(/\bOwner\b|\bCollaborator\b/)).not.toBeInTheDocument();
  });

  test('assigns an administrator explicitly to a season without counting the owner', async () => {
    mockWorkspace.service.listMembers.mockResolvedValue([
      {
        id: 'member-owner', user_id: 'owner-user', role: 'owner', status: 'active',
      },
      {
        id: 'member-admin', user_id: 'admin-user', role: 'admin', status: 'active',
      },
    ]);
    mockWorkspace.service.loadCompetitionContext.mockResolvedValue({
      seasons: [{ id: 'season-1', name: 'Apertura 2026' }],
    });
    mockWorkspace.service.listSeasonMemberAssignments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ membershipId: 'member-admin' }]);

    renderOrganizationRoute(
      <OrganizationMembersPage />,
      organizationFor('owner'),
      'miembros',
    );

    expect(await screen.findByText('0 / 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }));

    await waitFor(() => {
      expect(mockWorkspace.service.assignSeasonMember).toHaveBeenCalledWith({
        organizationId: '10000000-0000-4000-8000-000000000001',
        seasonId: 'season-1',
        membershipId: 'member-admin',
      });
    });
    expect(await screen.findByRole('button', { name: 'Asignado' })).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });
});
