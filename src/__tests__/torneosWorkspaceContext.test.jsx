import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  TORNEOS_WORKSPACE_STORAGE_KEY,
  TorneosWorkspaceProvider,
  useTorneosWorkspace,
} from '../features/torneos/context/TorneosWorkspaceContext';

const ORGANIZATIONS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Liga Devoto',
    slug: 'liga-devoto',
    role: 'owner',
    status: 'active',
    capabilities: ['workspace.access'],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Copa El Potrero',
    slug: 'copa-el-potrero',
    role: 'collaborator',
    status: 'active',
    capabilities: ['workspace.access'],
  },
];

function createService(payload = {}) {
  return {
    loadContext: jest.fn().mockResolvedValue({
      preference: {
        workspaceType: 'personal',
        activeOrganizationId: null,
      },
      organizations: ORGANIZATIONS,
      ...payload,
    }),
    setPreference: jest.fn(async (workspaceType, organizationId) => ({
      workspaceType,
      activeOrganizationId: organizationId,
    })),
    createOrganization: jest.fn(),
    updateOrganization: jest.fn(),
    listMembers: jest.fn(),
    createIdempotencyKey: jest.fn(() => 'key'),
  };
}

function WorkspaceProbe() {
  const {
    activeOrganization,
    availableOrganizations,
    isAuthoritative,
    notice,
    selectOrganization,
    selectPersonal,
  } = useTorneosWorkspace();

  return (
    <div>
      <span>{activeOrganization?.name || 'Personal'}</span>
      <span>{isAuthoritative ? 'authoritative' : 'pending'}</span>
      <span>{notice}</span>
      <span>{availableOrganizations.length} organizaciones</span>
      <button
        type="button"
        onClick={() => selectOrganization(ORGANIZATIONS[1].id)}
      >
        Cambiar
      </button>
      <button
        type="button"
        onClick={() => selectOrganization('workspace-falsificado')}
      >
        Falsificar
      </button>
      <button type="button" onClick={() => selectPersonal()}>
        Personal
      </button>
    </div>
  );
}

describe('TorneosWorkspaceProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('uses the server preference as authority and persists only a validated hint', async () => {
    window.localStorage.setItem(
      TORNEOS_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        workspaceType: 'tournament_organization',
        activeOrganizationId: 'workspace-local-falsificado',
      }),
    );
    const service = createService({
      preference: {
        workspaceType: 'tournament_organization',
        activeOrganizationId: ORGANIZATIONS[0].id,
      },
    });

    render(
      <TorneosWorkspaceProvider service={service}>
        <WorkspaceProbe />
      </TorneosWorkspaceProvider>,
    );

    expect(await screen.findByText('Liga Devoto')).toBeInTheDocument();
    expect(screen.getByText('authoritative')).toBeInTheDocument();
    expect(JSON.parse(
      window.localStorage.getItem(TORNEOS_WORKSPACE_STORAGE_KEY),
    )).toEqual({
      workspaceType: 'tournament_organization',
      activeOrganizationId: ORGANIZATIONS[0].id,
    });
  });

  test('persists a valid workspace through the backend before activating it', async () => {
    const service = createService();
    render(
      <TorneosWorkspaceProvider service={service}>
        <WorkspaceProbe />
      </TorneosWorkspaceProvider>,
    );

    expect(await screen.findByText('2 organizaciones')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));

    expect(await screen.findByText('Copa El Potrero')).toBeInTheDocument();
    expect(service.setPreference).toHaveBeenCalledWith(
      'tournament_organization',
      ORGANIZATIONS[1].id,
    );
  });

  test('rejects a workspace id outside the authorized server result', async () => {
    const service = createService();
    render(
      <TorneosWorkspaceProvider service={service}>
        <WorkspaceProbe />
      </TorneosWorkspaceProvider>,
    );

    await screen.findByText('2 organizaciones');
    fireEvent.click(screen.getByRole('button', { name: 'Falsificar' }));

    expect(await screen.findByText('Ya no tenés acceso a ese espacio.'))
      .toBeInTheDocument();
    expect(service.setPreference).not.toHaveBeenCalled();
  });

  test('discards a stale organization preference returned without membership', async () => {
    const service = createService({
      preference: {
        workspaceType: 'tournament_organization',
        activeOrganizationId: '10000000-0000-4000-8000-000000000099',
      },
      organizations: [],
    });

    render(
      <TorneosWorkspaceProvider service={service}>
        <WorkspaceProbe />
      </TorneosWorkspaceProvider>,
    );

    expect(await screen.findByText('0 organizaciones')).toBeInTheDocument();
    expect(screen.getAllByText('Personal')).toHaveLength(2);
    await waitFor(() => {
      expect(JSON.parse(
        window.localStorage.getItem(TORNEOS_WORKSPACE_STORAGE_KEY),
      )).toEqual({
        workspaceType: 'personal',
        activeOrganizationId: null,
      });
    });
  });

  test('resolves normally under React StrictMode remount checks', async () => {
    const service = createService({
      preference: {
        workspaceType: 'tournament_organization',
        activeOrganizationId: ORGANIZATIONS[0].id,
      },
    });

    render(
      <React.StrictMode>
        <TorneosWorkspaceProvider service={service}>
          <WorkspaceProbe />
        </TorneosWorkspaceProvider>
      </React.StrictMode>,
    );

    expect(await screen.findByText('Liga Devoto')).toBeInTheDocument();
    expect(screen.getByText('authoritative')).toBeInTheDocument();
  });
});
