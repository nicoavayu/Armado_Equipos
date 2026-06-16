import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChallengeResultCtaCard from '../features/equipos/components/ChallengeResultCtaCard';
import ReportChallengeResultModal from '../features/equipos/components/ReportChallengeResultModal';
import MisDesafiosTab from '../features/equipos/views/MisDesafiosTab';
import { RESULT_STATUS } from '../features/equipos/utils/challengeResult';
import {
  getTeamMatchByChallengeId,
  listMyChallenges,
  listMyManageableTeams,
  reportChallengeResult,
} from '../services/db/teamChallenges';

jest.mock('../services/db/teamChallenges', () => ({
  cancelChallenge: jest.fn(),
  reportChallengeResult: jest.fn(),
  getTeamMatchByChallengeId: jest.fn(),
  listMyManageableTeams: jest.fn(),
  listMyChallenges: jest.fn(),
  updateChallenge: jest.fn(),
}));

jest.mock('../utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

const baseChallenge = {
  id: 'challenge-1',
  created_by_user_id: 'owner-user',
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
  status: 'confirmed',
  scheduled_at: '2026-06-14T20:00:00.000Z',
  result_status: null,
};

const renderMisDesafios = async ({
  challenge = baseChallenge,
  manageableTeams = [{ id: 'team-a', name: 'Napoli' }],
  teamMatch = baseTeamMatch,
  userId = 'owner-user',
} = {}) => {
  listMyChallenges.mockResolvedValueOnce([challenge]);
  listMyManageableTeams.mockResolvedValueOnce(manageableTeams);
  getTeamMatchByChallengeId.mockResolvedValue(teamMatch);

  render(
    <MemoryRouter>
      <MisDesafiosTab userId={userId} initialStatusTab={challenge.status} />
    </MemoryRouter>,
  );

  await waitFor(() => expect(listMyChallenges).toHaveBeenCalledWith(userId));
  await waitFor(() => expect(screen.queryByText('Cargando desafios...')).not.toBeInTheDocument());
};

describe('challenge result flow UI', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('aparece encuesta pendiente cuando hay rival y no hay resultado', async () => {
    await renderMisDesafios();

    expect(await screen.findByText('Resultado pendiente')).toBeInTheDocument();
    expect(screen.getByText('¿Cómo salió el desafío contra Bico?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /responder/i })).toBeInTheDocument();
  });

  test('no aparece CTA si no hay rival aceptado', async () => {
    await renderMisDesafios({
      challenge: {
        ...baseChallenge,
        accepted_team_id: null,
        accepted_team: null,
      },
      teamMatch: null,
    });

    await waitFor(() => expect(screen.queryByText('Resultado pendiente')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
  });

  test('no pide resultado si el desafío aceptado es futuro', async () => {
    await renderMisDesafios({
      challenge: {
        ...baseChallenge,
        status: 'accepted',
        scheduled_at: '2999-06-14T20:00:00.000Z',
      },
      teamMatch: {
        ...baseTeamMatch,
        status: 'confirmed',
        scheduled_at: '2999-06-14T20:00:00.000Z',
      },
    });

    await waitFor(() => expect(screen.queryByText('Resultado pendiente')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
  });

  test('no pide resultado si el desafío está cancelado', async () => {
    await renderMisDesafios({
      challenge: {
        ...baseChallenge,
        status: 'canceled',
      },
      teamMatch: {
        ...baseTeamMatch,
        status: 'cancelled',
      },
    });

    await waitFor(() => expect(screen.queryByText('Resultado pendiente')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
  });

  test('usuario no autorizado no puede responder ni editar resultado', async () => {
    await renderMisDesafios({
      manageableTeams: [],
      userId: 'random-user',
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /editar respuesta/i })).not.toBeInTheDocument();
  });

  test('jugador involucrado sin rol de gestión queda como follow-up, no responde en MVP', async () => {
    await renderMisDesafios({
      manageableTeams: [],
      userId: 'member-user',
    });

    await waitFor(() => expect(screen.queryByText('Resultado pendiente')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
  });

  test('muestra resultado cargado sin accion de edición', async () => {
    await renderMisDesafios({
      challenge: {
        ...baseChallenge,
        status: 'completed',
      },
      teamMatch: {
        ...baseTeamMatch,
        status: 'played',
        result_status: RESULT_STATUS.TEAM_A_WIN,
      },
    });

    expect(await screen.findByText('Resultado cargado: Ganamos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /editar respuesta/i })).not.toBeInTheDocument();
  });

  test('permite al otro equipo responder un resultado provisorio', async () => {
    reportChallengeResult.mockResolvedValueOnce({
      id: 'match-1',
      result_status: RESULT_STATUS.TEAM_A_WIN,
      result_confirmed: true,
    });
    await renderMisDesafios({
      manageableTeams: [{ id: 'team-b', name: 'Bico' }],
      teamMatch: {
        ...baseTeamMatch,
        status: 'played',
        result_status: RESULT_STATUS.TEAM_A_WIN,
        result_confirmed: false,
        result_conflict: false,
        result_reported_by_team_id: 'team-a',
      },
      userId: 'accepted-user',
    });

    expect(await screen.findByText('Resultado pendiente')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /responder/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Perdimos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));

    await waitFor(() => expect(reportChallengeResult).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      resultStatus: RESULT_STATUS.TEAM_A_WIN,
    }));
  });

  test('muestra resultado en conflicto sin accion de respuesta', async () => {
    await renderMisDesafios({
      teamMatch: {
        ...baseTeamMatch,
        status: 'played',
        result_status: null,
        result_confirmed: false,
        result_conflict: true,
      },
    });

    // "Resultado en conflicto" now appears as both the section heading and the
    // card banner once the match lands in the dedicated conflict section.
    expect((await screen.findAllByText('Resultado en conflicto')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Los equipos cargaron resultados distintos. Revisá el resultado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /responder/i })).not.toBeInTheDocument();
  });

  test('card visible de detalle muestra la encuesta pendiente', () => {
    render(
      <ChallengeResultCtaCard
        rivalName="Bico"
        onLoad={jest.fn()}
      />,
    );

    expect(screen.getByText('Resultado pendiente')).toBeInTheDocument();
    expect(screen.getByText('¿Cómo salió el desafío contra Bico?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /responder/i })).toBeInTheDocument();
  });

  test('modal muestra Ganamos / Empatamos / Perdimos y guarda desde la perspectiva del usuario', () => {
    const onSubmit = jest.fn();

    render(
      <ReportChallengeResultModal
        isOpen
        challenge={baseChallenge}
        perspectiveIsChallenger
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('heading', { name: '¿Cómo salió el desafío?' })).toBeInTheDocument();
    expect(screen.getByText('¿Cómo salió el desafío contra Bico?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ganamos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empatamos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Perdimos' })).toBeInTheDocument();
    expect(screen.queryByText(/goles/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/comentarios/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mvp/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ganamos' }));
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /guardar respuesta/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));

    expect(onSubmit).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      resultStatus: RESULT_STATUS.TEAM_A_WIN,
      outcome: 'won',
    });
  });

  test.each([
    ['Ganamos', RESULT_STATUS.TEAM_A_WIN],
    ['Empatamos', RESULT_STATUS.DRAW],
    ['Perdimos', RESULT_STATUS.TEAM_B_WIN],
  ])('guardar %s persiste via reportChallengeResult', async (label, expectedStatus) => {
    reportChallengeResult.mockResolvedValueOnce({ id: 'match-1', result_status: expectedStatus });
    await renderMisDesafios();

    fireEvent.click(await screen.findByRole('button', { name: /responder/i }));
    fireEvent.click(await screen.findByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));

    await waitFor(() => expect(reportChallengeResult).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      resultStatus: expectedStatus,
    }));
    await waitFor(() => expect(listMyChallenges).toHaveBeenCalledTimes(2));
  });

  test.each([
    ['Ganamos', RESULT_STATUS.TEAM_B_WIN],
    ['Empatamos', RESULT_STATUS.DRAW],
    ['Perdimos', RESULT_STATUS.TEAM_A_WIN],
  ])('desde accepted team %s persiste el resultado inverso correcto', async (label, expectedStatus) => {
    reportChallengeResult.mockResolvedValueOnce({ id: 'match-1', result_status: expectedStatus });
    await renderMisDesafios({
      manageableTeams: [{ id: 'team-b', name: 'Bico' }],
      userId: 'accepted-user',
    });

    fireEvent.click(await screen.findByRole('button', { name: /responder/i }));
    fireEvent.click(await screen.findByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));

    await waitFor(() => expect(reportChallengeResult).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      resultStatus: expectedStatus,
    }));
  });

});
