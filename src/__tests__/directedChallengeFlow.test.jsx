import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DesafiosTab from '../features/equipos/views/DesafiosTab';
import {
  acceptChallenge,
  cancelChallenge,
  listMyDirectedChallenges,
  listMyManageableTeams,
  listOpenChallenges,
  rejectDirectedChallenge,
} from '../services/db/teamChallenges';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('../hooks/useInterval', () => ({
  useInterval: () => ({ setIntervalSafe: jest.fn(), clearIntervalSafe: jest.fn() }),
}));
jest.mock('../hooks/useRefreshOnVisibility', () => ({ useRefreshOnVisibility: () => {} }));
jest.mock('../utils/notifyBlockingError', () => ({ notifyBlockingError: jest.fn() }));
jest.mock('../features/equipos/components/NeighborhoodAutocomplete', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../services/db/teamChallenges', () => ({
  acceptChallenge: jest.fn(),
  cancelChallenge: jest.fn(),
  createChallenge: jest.fn(),
  getTeamMatchByChallengeId: jest.fn(),
  listMyDirectedChallenges: jest.fn(),
  listMyManageableTeams: jest.fn(),
  listOpenChallenges: jest.fn(),
  rejectDirectedChallenge: jest.fn(),
  updateChallenge: jest.fn(),
}));

const futureExpiry = new Date(Date.now() + 36 * 3600 * 1000).toISOString();

const incoming = {
  id: 'c-in',
  status: 'open',
  challenged_team_id: 'my-team',
  challenger_team: { name: 'Napoli' },
  scheduled_at: '2026-06-20T21:00:00Z',
  expires_at: futureExpiry,
  notes: '¿Juegan el jueves?',
};

const outgoing = {
  id: 'c-out',
  status: 'open',
  challenged_team_id: 'rival-9',
  challenger_team: { name: 'Fulbo FC' },
  challenged_team: { name: 'Roma' },
  scheduled_at: '2026-06-21T20:00:00Z',
  expires_at: futureExpiry,
};

beforeEach(() => {
  jest.clearAllMocks();
  listOpenChallenges.mockResolvedValue([]);
  listMyManageableTeams.mockResolvedValue([
    { id: 'my-team', name: 'Fulbo FC', format: 5, is_active: true },
  ]);
  listMyDirectedChallenges.mockResolvedValue({ incoming: [incoming], outgoing: [outgoing] });
  acceptChallenge.mockResolvedValue({ matchId: 'm1', challenge: {} });
  rejectDirectedChallenge.mockResolvedValue({});
  cancelChallenge.mockResolvedValue({});
});

describe('DesafiosTab — desafíos dirigidos', () => {
  test('renders "Te desafiaron" with the rival name and Aceptar/Rechazar', async () => {
    render(<DesafiosTab userId="u1" />);
    await waitFor(() => expect(screen.getByText('Te desafiaron')).toBeInTheDocument());
    expect(screen.getByText('Napoli')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
  });

  test('accepting an incoming challenge calls acceptChallenge with the challenged team', async () => {
    render(<DesafiosTab userId="u1" />);
    await waitFor(() => expect(screen.getByText('Napoli')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));

    await waitFor(() => expect(acceptChallenge).toHaveBeenCalledWith(
      'c-in',
      'my-team',
      expect.objectContaining({ currentUserId: 'u1' }),
    ));
  });

  test('rejecting an incoming challenge calls rejectDirectedChallenge', async () => {
    render(<DesafiosTab userId="u1" />);
    await waitFor(() => expect(screen.getByText('Napoli')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));

    await waitFor(() => expect(rejectDirectedChallenge).toHaveBeenCalledWith('c-in'));
  });

  test('outgoing section lets the challenger cancel the pending challenge', async () => {
    render(<DesafiosTab userId="u1" />);
    await waitFor(() => expect(screen.getByText('Desafíos enviados')).toBeInTheDocument());
    expect(screen.getByText('Roma')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cancelar desafío/ }));

    await waitFor(() => expect(cancelChallenge).toHaveBeenCalledWith('c-out'));
  });
});
