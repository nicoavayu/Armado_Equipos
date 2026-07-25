import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import CreateOrganizationPage from '../features/torneos/components/CreateOrganizationPage';
import {
  TorneosWorkspaceProvider,
} from '../features/torneos/context/TorneosWorkspaceContext';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000010';
const IDEMPOTENCY_KEY = '20000000-0000-4000-8000-000000000010';

function LocationProbe() {
  const location = useLocation();
  return <span>{location.pathname}</span>;
}

function createService(overrides = {}) {
  return {
    loadContext: jest.fn(),
    setPreference: jest.fn(),
    checkSlugAvailability: jest.fn().mockResolvedValue(true),
    createOrganization: jest.fn().mockResolvedValue({
      organization: {
        id: ORGANIZATION_ID,
        name: 'Liga Devoto',
        slug: 'liga-devoto',
        status: 'active',
        createdAt: '2026-07-24T00:00:00.000Z',
      },
      membership: {
        role: 'owner',
        status: 'active',
        capabilities: ['workspace.access'],
      },
      preference: {
        workspaceType: 'tournament_organization',
        activeOrganizationId: ORGANIZATION_ID,
      },
    }),
    updateOrganization: jest.fn(),
    listMembers: jest.fn(),
    createIdempotencyKey: jest.fn(() => IDEMPOTENCY_KEY),
    ...overrides,
  };
}

function renderCreation(service) {
  return render(
    <MemoryRouter initialEntries={['/torneos/nueva-organizacion']}>
      <TorneosWorkspaceProvider service={service} autoLoad={false}>
        <Routes>
          <Route
            path="/torneos/nueva-organizacion"
            element={<CreateOrganizationPage />}
          />
          <Route
            path="/torneos/organizacion/:organizationId/inicio"
            element={<LocationProbe />}
          />
        </Routes>
      </TorneosWorkspaceProvider>
    </MemoryRouter>,
  );
}

describe('Torneos organization creation', () => {
  test('suggests a slug and enters the atomically created workspace', async () => {
    const service = createService();
    renderCreation(service);

    fireEvent.change(screen.getByLabelText('Nombre de la organización'), {
      target: { value: 'Liga Devoto' },
    });
    expect(screen.getByLabelText('Identificador')).toHaveValue('liga-devoto');
    fireEvent.click(screen.getByRole('button', { name: 'Crear organización' }));

    expect(await screen.findByText(
      `/torneos/organizacion/${ORGANIZATION_ID}/inicio`,
    )).toBeInTheDocument();
    expect(service.createOrganization).toHaveBeenCalledWith({
      name: 'Liga Devoto',
      slug: 'liga-devoto',
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    expect(service.createOrganization).toHaveBeenCalledTimes(1);
  });

  test('does not submit invalid values', () => {
    const service = createService();
    renderCreation(service);

    fireEvent.change(screen.getByLabelText('Nombre de la organización'), {
      target: { value: 'Li' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear organización' }));

    expect(screen.getByText(/nombre de al menos 3/i)).toBeInTheDocument();
    expect(service.createOrganization).not.toHaveBeenCalled();
  });

  test('prevents duplicate clicks while the atomic request is pending', async () => {
    let resolveRequest;
    const pending = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    const service = createService({
      createOrganization: jest.fn(() => pending),
    });
    renderCreation(service);

    fireEvent.change(screen.getByLabelText('Nombre de la organización'), {
      target: { value: 'Liga Devoto' },
    });
    const submit = screen.getByRole('button', { name: 'Crear organización' });
    fireEvent.click(submit);
    expect(await screen.findByRole('button', { name: /creando de forma segura/i }))
      .toBeDisabled();
    await waitFor(() => expect(service.createOrganization).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /creando de forma segura/i }));
    expect(service.createOrganization).toHaveBeenCalledTimes(1);

    resolveRequest({
      organization: {
        id: ORGANIZATION_ID,
        name: 'Liga Devoto',
        slug: 'liga-devoto',
        status: 'active',
      },
      membership: { role: 'owner', status: 'active', capabilities: [] },
      preference: {
        workspaceType: 'tournament_organization',
        activeOrganizationId: ORGANIZATION_ID,
      },
    });
    await waitFor(() => expect(service.createOrganization).toHaveBeenCalledTimes(1));
  });

  test('shows a controlled slug conflict without navigating', async () => {
    const service = createService({
      createOrganization: jest.fn().mockRejectedValue(
        new Error('Ese identificador ya está en uso. Probá con otro.'),
      ),
    });
    renderCreation(service);

    fireEvent.change(screen.getByLabelText('Nombre de la organización'), {
      target: { value: 'Liga Devoto' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear organización' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ya está en uso');
    expect(screen.getByLabelText('Nombre de la organización')).toBeInTheDocument();
  });

  test('stops before creation when the slug preflight is unavailable', async () => {
    const service = createService({
      checkSlugAvailability: jest.fn().mockResolvedValue(false),
    });
    renderCreation(service);

    fireEvent.change(screen.getByLabelText('Nombre de la organización'), {
      target: { value: 'Liga Devoto' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear organización' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ya está en uso');
    expect(service.createOrganization).not.toHaveBeenCalled();
  });
});
