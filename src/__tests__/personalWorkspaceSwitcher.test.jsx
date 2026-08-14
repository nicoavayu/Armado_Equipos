import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { WorkspaceList } from '../features/torneos/components/PersonalWorkspaceSwitcher';
import {
  TorneosWorkspaceProvider,
} from '../features/torneos/context/TorneosWorkspaceContext';

const ORGANIZATION = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Liga Metropolitana del Sur',
  slug: 'liga-metropolitana-del-sur',
  role: 'owner',
  status: 'active',
  capabilities: ['workspace.access'],
};

function LocationProbe() {
  return <output>{useLocation().pathname}</output>;
}

test('switches from the personal profile to an authorized organization', async () => {
  const service = {
    loadContext: jest.fn().mockResolvedValue({
      preference: { workspaceType: 'personal', activeOrganizationId: null },
      organizations: [ORGANIZATION],
    }),
    setPreference: jest.fn().mockResolvedValue({
      workspaceType: 'tournament_organization',
      activeOrganizationId: ORGANIZATION.id,
    }),
  };

  render(
    <MemoryRouter initialEntries={['/profile']}>
      <TorneosWorkspaceProvider service={service}>
        <WorkspaceList />
        <LocationProbe />
      </TorneosWorkspaceProvider>
    </MemoryRouter>,
  );

  fireEvent.click(await screen.findByRole('button', {
    name: /liga metropolitana del sur propietario/i,
  }));

  expect(await screen.findByText(
    `/torneos/organizacion/${ORGANIZATION.id}/inicio`,
  )).toBeInTheDocument();
  expect(service.setPreference).toHaveBeenCalledWith(
    'tournament_organization',
    ORGANIZATION.id,
  );
});
