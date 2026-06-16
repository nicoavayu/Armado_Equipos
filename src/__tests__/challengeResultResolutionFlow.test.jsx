import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MisDesafiosTab from '../features/equipos/views/MisDesafiosTab';
import {
  getTeamMatchByChallengeId,
  listMyChallenges,
  listMyManageableTeams,
  resolveChallengeResult,
} from '../services/db/teamChallenges';

jest.mock('../services/db/teamChallenges', () => ({
  cancelChallenge: jest.fn(),
  reportChallengeResult: jest.fn(),
  resolveChallengeResult: jest.fn(),
  getTeamMatchByChallengeId: jest.fn(),
  listMyManageableTeams: jest.fn(),
  listMyChallenges: jest.fn(),
  updateChallenge: jest.fn(),
}));

jest.mock('../utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

const CREATOR_USER = 'owner-user';

const baseChallenge = {
  id: 'challenge-1',
  created_by_user_id: CREATOR_USER,
  accepted_by_user_id: 'accepted-user',
  challenger_team_id: 'team-a',
  accepted_team_id: 'team-b',
  status: 'confirmed',
  scheduled_at: '2026-06-14T20:00:00.000Z',
  format: 5,
  challenger_team: { id: 'team-a', name: 'Napoli' },
  accepted_team: { id: 'team-b', name: 'Bico' },
};

const baseTeamMatch = {
  id: 'match-1',
  challenge_id: 'challenge-1',
  team_a_id: 'team-a',
  team_b_id: 'team-b',
  status: 'played',
  scheduled_at: '2026-06-14T20:00:00.000Z',
  result_status: null,
  result_confirmed: false,
  result_conflict: false,
  team_a: { id: 'team-a', name: 'Napoli' },
  team_b: { id: 'team-b', name: 'Bico' },
};

const provisionalTeamMatch = {
  ...baseTeamMatch,
  result_status: 'team_b_win',
  result_confirmed: false,
  result_conflict: false,
  result_reported_by_team_id: 'team-b',
};

const conflictTeamMatch = {
  ...baseTeamMatch,
  result_status: null,
  result_confirmed: false,
  result_conflict: true,
};

const renderMisDesafios = async ({
  challenge = baseChallenge,
  manageableTeams = [{ id: 'team-a', name: 'Napoli' }],
  teamMatch = baseTeamMatch,
  userId = CREATOR_USER,
} = {}) => {
  listMyChallenges.mockResolvedValue([challenge]);
  listMyManageableTeams.mockResolvedValue(manageableTeams);
  getTeamMatchByChallengeId.mockResolvedValue(teamMatch);

  render(
    <MemoryRouter>
      <MisDesafiosTab userId={userId} initialStatusTab={challenge.status} />
    </MemoryRouter>,
  );

  await waitFor(() => expect(listMyChallenges).toHaveBeenCalledWith(userId));
  await waitFor(() => expect(screen.queryByText('Cargando desafios...')).not.toBeInTheDocument());
};

describe('challenge result resolution flow UI', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Test 11: a provisional (one-team) result keeps the match in "Mis Partidos".
  test('un resultado provisorio sigue visible en Mis Partidos', async () => {
    await renderMisDesafios({ teamMatch: provisionalTeamMatch });

    expect(await screen.findByText('Resultados pendientes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /responder/i })).toBeInTheDocument();
  });

  // Test 12: a conflict keeps the match visible under a clear section.
  test('un resultado en conflicto sigue visible en Mis Partidos', async () => {
    await renderMisDesafios({ teamMatch: conflictTeamMatch });

    expect(
      await screen.findByRole('heading', { name: 'Resultado en conflicto' }),
    ).toBeInTheDocument();
  });

  // Test 13: the challenge creator sees "Resolver resultado".
  test('el creador del desafío ve el botón Resolver resultado', async () => {
    await renderMisDesafios({ teamMatch: conflictTeamMatch, userId: CREATOR_USER });

    expect(
      await screen.findByRole('button', { name: /resolver resultado/i }),
    ).toBeInTheDocument();
  });

  // Test 14: a non-creator never sees "Resolver resultado".
  test('un usuario que no es el creador no ve Resolver resultado', async () => {
    await renderMisDesafios({
      teamMatch: conflictTeamMatch,
      manageableTeams: [{ id: 'team-b', name: 'Bico' }],
      userId: 'captain-b',
    });

    expect(
      await screen.findByRole('heading', { name: 'Resultado en conflicto' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolver resultado/i })).not.toBeInTheDocument();
  });

  // Test 15: resolving a conflict calls the resolve RPC with the chosen result.
  test('resolver el conflicto envía el resultado elegido', async () => {
    resolveChallengeResult.mockResolvedValue({ id: 'match-1', result_status: 'team_a_win', result_confirmed: true });

    await renderMisDesafios({ teamMatch: conflictTeamMatch, userId: CREATOR_USER });

    fireEvent.click(await screen.findByRole('button', { name: /resolver resultado/i }));

    expect(await screen.findByRole('heading', { name: 'Resolver resultado' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ganó Napoli' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(resolveChallengeResult).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      resultStatus: 'team_a_win',
    }));
  });

  // Test 4 (UI): a common player without management role never sees report/resolve.
  test('un jugador común no ve botones de reportar ni resolver', async () => {
    await renderMisDesafios({
      teamMatch: conflictTeamMatch,
      manageableTeams: [],
      userId: 'common-player',
    });

    await waitFor(() => expect(screen.queryByText('Cargando desafios...')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolver resultado/i })).not.toBeInTheDocument();
  });
});
