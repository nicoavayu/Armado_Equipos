// POST-SMOKE regression: "Grupos y playoffs" → Generar borrador before the draw. The backend answers a
// domain 4xx (TORNEOS_GROUP_DRAW_SEED_INVALID); the page used to be replaced by "No pudimos abrir
// Torneos". It must stay mounted and explain the next step next to the form.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FixtureWorkspacePage from '../features/torneos/components/FixtureWorkspacePage';
import { TorneosFixtureProvider } from '../features/torneos/context/TorneosFixtureContext';
import { getCapabilitiesForRole } from '../features/torneos/domain/capabilities';
import { TorneosBoundaryError } from '../features/torneos/foundation/errors';
import { translateBoundaryError } from '../features/torneos/stagingV1/stagingV1WorkspaceService';

const mockOrganization = { id: 'org-a', role: 'owner', capabilities: getCapabilitiesForRole('owner') };
const mockTournament = {
  id: 'tournament-a',
  name: 'Copa QA',
  status: 'registration',
  competitionFormat: 'groups_and_playoffs',
  sportModality: 'football_5',
  categories: [{ id: 'category-a', name: 'Primera', status: 'active' }],
};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useOutletContext: () => ({ organization: mockOrganization }),
}));
jest.mock('../features/torneos/context/TorneosCompetitionContext', () => ({
  useTorneosCompetition: () => ({ activeTournament: mockTournament, refresh: jest.fn() }),
}));
jest.mock('../features/torneos/components/CompetitionSelector', () => (
  function CompetitionSelectorMock() { return <div>Temporada</div>; }
));

// The exact answer of generate_tournament_fixture when the groups carry no draw seed, through the
// real boundary translation of the hybrid adapter.
const drawMissing = () => translateBoundaryError(
  new TorneosBoundaryError('TORNEOS_RPC_ERROR', {
    status: 400,
    rpcError: { code: '23514', message: 'TORNEOS_GROUP_DRAW_SEED_INVALID', details: null, hint: null },
  }),
  'No pudimos generar el fixture.',
);

test('generating a groups fixture before the draw keeps the page and explains the next step inline', async () => {
  const service = {
    loadFixtureContext: jest.fn().mockResolvedValue({
      participantSet: { id: 'set-a', status: 'frozen', versionNumber: 1 },
      participants: [
        { id: 'p1', name: 'Epsilon', status: 'active', seedNumber: 1 },
        { id: 'p2', name: 'Zeta', status: 'active', seedNumber: 2 },
      ],
    }),
    loadScheduleContext: jest.fn().mockResolvedValue({}),
    createIdempotencyKey: jest.fn(() => 'key-a'),
    generateFixture: jest.fn(() => Promise.reject(drawMissing())),
  };
  render(
    <MemoryRouter>
      <TorneosFixtureProvider organizationId="org-a" service={service}>
        <FixtureWorkspacePage mode="generate" />
      </TorneosFixtureProvider>
    </MemoryRouter>,
  );
  const generate = await screen.findByRole('button', { name: /Generar borrador/ });
  fireEvent.click(generate);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Primero sorteá y publicá los grupos.');
  expect(screen.queryByText('No pudimos cargar esta pantalla')).not.toBeInTheDocument();
  await waitFor(() => expect(service.loadFixtureContext).toHaveBeenCalledTimes(2));
  // The form is still there and usable.
  expect(screen.getByRole('button', { name: /Generar borrador/ })).toBeEnabled();
  expect(service.generateFixture).toHaveBeenCalledTimes(1);
});
