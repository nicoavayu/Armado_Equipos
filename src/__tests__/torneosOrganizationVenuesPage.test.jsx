import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrganizationVenuesPage from '../features/torneos/components/OrganizationVenuesPage';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';

const mockOrganization = { id: 'org-a', name: 'Liga Norte', role: 'owner', capabilities: getCapabilitiesForRole('owner') };
const mockService = {
  loadOrganizationVenues: jest.fn(),
  createVenue: jest.fn(),
  createCourt: jest.fn(),
};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useOutletContext: () => ({ organization: mockOrganization }),
  useParams: () => ({ organizationId: 'org-a' }),
}));

jest.mock('../features/torneos/context/TorneosWorkspaceContext', () => ({
  useTorneosWorkspace: () => ({ service: mockService }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockService.loadOrganizationVenues.mockResolvedValue({
    venues: [
      { id: 'venue-a', name: 'Complejo Norte', address: 'Calle 1', status: 'active' },
      { id: 'venue-b', name: 'Club Sur', address: 'Calle 2', status: 'active' },
    ],
    courts: [
      { id: 'court-a', venueId: 'venue-a', name: 'Cancha 1', status: 'active', sportModality: 'football_5' },
      { id: 'court-b', venueId: 'venue-b', name: 'Cancha 1', status: 'active', sportModality: 'football_5' },
      { id: 'court-c', venueId: 'venue-b', name: 'Cancha 2', status: 'active', sportModality: 'football_5' },
    ],
  });
  mockService.createCourt.mockResolvedValue({});
});

test('a new court has no preselected modality: the organizer chooses it before creating', async () => {
  render(<MemoryRouter><OrganizationVenuesPage /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Complejo Norte' });
  const modality = screen.getByLabelText('Modalidad');
  expect(modality).toBeRequired();
  expect(modality).toHaveValue('');
  expect(screen.getByRole('option', { name: 'Elegí la modalidad' })).toBeDisabled();
  fireEvent.change(screen.getAllByLabelText('Sede').at(-1), { target: { value: 'venue-a' } });
  fireEvent.change(screen.getAllByLabelText('Nombre').at(-1), { target: { value: 'Cancha 2' } });
  fireEvent.change(modality, { target: { value: 'football_5' } });
  fireEvent.click(screen.getByRole('button', { name: /Crear cancha/ }));
  await waitFor(() => expect(mockService.createCourt).toHaveBeenCalledTimes(1));
  expect(mockService.createCourt.mock.calls[0][0]).toEqual(expect.objectContaining({ venueId: 'venue-a', sportModality: 'football_5' }));
});

test('the court count reads in singular and plural', async () => {
  render(<MemoryRouter><OrganizationVenuesPage /></MemoryRouter>);
  expect(await screen.findByText(/^1 cancha · Activa$/)).toBeInTheDocument();
  expect(screen.getByText(/^2 canchas · Activa$/)).toBeInTheDocument();
});
