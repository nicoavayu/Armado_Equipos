import { buildSurveyOutcomeStats } from '../utils/statsOutcomeAssignment';

const makeUserContext = (userId) => {
  const normalizedUserId = String(userId || '').trim().toLowerCase();
  return {
    userIdentitySet: new Set([normalizedUserId]),
    isCurrentUserPlayer: (player) => {
      const refs = [
        player?.usuario_id,
        player?.uuid,
        player?.id,
        player?.email,
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      return refs.includes(normalizedUserId);
    },
    getPlayerIdentityCandidates: (player) => (
      [
        player?.usuario_id,
        player?.uuid,
        player?.id,
        player?.email,
        player?.nombre,
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  };
};

const makeMatch = ({
  id,
  nombre = 'Partido QA',
  jugadores = [],
  fecha = '2026-03-11',
  hora = '21:00',
  estado = 'active',
  survey_status = 'closed',
  result_status = 'finished',
}) => ({
  id,
  nombre,
  jugadores,
  fecha,
  hora,
  estado,
  survey_status,
  result_status,
});

describe('stats outcome assignment', () => {
  test('draw with winner_team null counts draw for players in both teams', () => {
    const rawUserMatches = [
      makeMatch({
        id: 101,
        jugadores: [{ id: 1, usuario_id: 'user-a' }, { id: 2, usuario_id: 'user-b' }],
        result_status: 'draw',
      }),
    ];
    const surveyRows = [{ partido_id: 101, result_status: 'draw', winner_team: null, finished_at: '2026-03-11T21:00:00Z' }];
    const teamRows = [{
      partido_id: 101,
      participants: [{ ref: 'user-a' }, { ref: 'user-b' }],
      team_a: ['user-a'],
      team_b: ['user-b'],
    }];

    const resultA = buildSurveyOutcomeStats({
      rawUserMatches,
      surveyRows,
      teamRows,
      lifecycleRows: [],
      ...makeUserContext('user-a'),
    });
    const resultB = buildSurveyOutcomeStats({
      rawUserMatches,
      surveyRows,
      teamRows,
      lifecycleRows: [],
      ...makeUserContext('user-b'),
    });

    expect(resultA.empatados).toBe(1);
    expect(resultB.empatados).toBe(1);
    expect(resultA.ganados + resultA.perdidos).toBe(0);
    expect(resultB.ganados + resultB.perdidos).toBe(0);
  });

  test('user in final roster gets W/L even if user did not answer survey', () => {
    const rawUserMatches = [
      makeMatch({
        id: 102,
        jugadores: [{ id: 1, usuario_id: 'winner-user' }, { id: 2, usuario_id: 'loser-user' }],
        result_status: 'finished',
      }),
    ];
    const surveyRows = [{ partido_id: 102, result_status: 'finished', winner_team: 'equipo_a', finished_at: '2026-03-11T21:00:00Z' }];
    const lifecycleRows = [{
      id: 102,
      result_status: 'finished',
      winner_team: 'equipo_a',
      final_team_a: ['winner-user'],
      final_team_b: ['loser-user'],
      finished_at: '2026-03-11T21:00:00Z',
    }];

    const winnerResult = buildSurveyOutcomeStats({
      rawUserMatches,
      surveyRows,
      teamRows: [],
      lifecycleRows,
      ...makeUserContext('winner-user'),
    });
    const loserResult = buildSurveyOutcomeStats({
      rawUserMatches,
      surveyRows,
      teamRows: [],
      lifecycleRows,
      ...makeUserContext('loser-user'),
    });

    expect(winnerResult.ganados).toBe(1);
    expect(winnerResult.perdidos).toBe(0);
    expect(loserResult.ganados).toBe(0);
    expect(loserResult.perdidos).toBe(1);
  });

  test('falls back to partidos lifecycle data when survey_results are unavailable', () => {
    const rawUserMatches = [
      makeMatch({
        id: 103,
        jugadores: [{ id: 7, usuario_id: 'user-b' }],
        result_status: 'finished',
      }),
    ];
    const lifecycleRows = [{
      id: 103,
      result_status: 'finished',
      winner_team: 'equipo_b',
      final_team_a: ['user-a'],
      final_team_b: ['user-b'],
      finished_at: '2026-03-11T21:00:00Z',
    }];

    const result = buildSurveyOutcomeStats({
      rawUserMatches,
      surveyRows: [],
      teamRows: [],
      lifecycleRows,
      ...makeUserContext('user-b'),
    });

    expect(result.ganados).toBe(1);
    expect(result.perdidos).toBe(0);
    expect(result.empatados).toBe(0);
  });

  test('selects the most complete team source when higher-priority source is partial', () => {
    const rawUserMatches = [
      makeMatch({
        id: 104,
        jugadores: [{ id: 8, usuario_id: 'user-a' }, { id: 9, usuario_id: 'user-b' }],
      }),
    ];
    const surveyRows = [{ partido_id: 104, result_status: 'finished', winner_team: 'equipo_a', finished_at: '2026-03-11T21:00:00Z' }];
    const lifecycleRows = [{
      id: 104,
      result_status: 'finished',
      winner_team: 'equipo_a',
      survey_team_a: ['user-a'],
      survey_team_b: [],
      final_team_a: ['user-a'],
      final_team_b: ['user-b'],
      finished_at: '2026-03-11T21:00:00Z',
    }];

    const result = buildSurveyOutcomeStats({
      rawUserMatches,
      surveyRows,
      teamRows: [],
      lifecycleRows,
      includeDebug: true,
      ...makeUserContext('user-a'),
    });

    expect(result.ganados).toBe(1);
    expect(result.sinEquipoDetectado).toBe(0);
    expect(result.debugEntries[0]?.team_selection?.selected_source).toBe('final_team');
  });

  test('dedupes repeated matchId so aggregates are counted only once', () => {
    const rawUserMatches = [
      makeMatch({ id: 105, jugadores: [{ id: 10, usuario_id: 'user-a' }] }),
      makeMatch({ id: 105, jugadores: [{ id: 10, usuario_id: 'user-a' }] }),
    ];
    const surveyRows = [{ partido_id: 105, result_status: 'finished', winner_team: 'equipo_a', finished_at: '2026-03-11T21:00:00Z' }];
    const lifecycleRows = [{
      id: 105,
      result_status: 'finished',
      winner_team: 'equipo_a',
      final_team_a: ['user-a'],
      final_team_b: ['user-b'],
      finished_at: '2026-03-11T21:00:00Z',
    }];

    const result = buildSurveyOutcomeStats({
      rawUserMatches,
      surveyRows,
      teamRows: [],
      lifecycleRows,
      includeDebug: true,
      ...makeUserContext('user-a'),
    });

    expect(result.ganados).toBe(1);
    expect(result.recientes).toHaveLength(1);
    expect(result.debugEntries.filter((entry) => entry?.result_application?.excluded_reason === 'duplicate_match')).toHaveLength(1);
  });

  test('not_played is excluded from W/D/L outcome assignment', () => {
    const rawUserMatches = [
      makeMatch({
        id: 106,
        jugadores: [{ id: 11, usuario_id: 'user-a' }],
        result_status: 'not_played',
      }),
    ];
    const surveyRows = [{ partido_id: 106, result_status: 'not_played', winner_team: null, finished_at: '2026-03-11T21:00:00Z' }];

    const result = buildSurveyOutcomeStats({
      rawUserMatches,
      surveyRows,
      teamRows: [],
      lifecycleRows: [],
      includeDebug: true,
      ...makeUserContext('user-a'),
    });

    expect(result.ganados).toBe(0);
    expect(result.empatados).toBe(0);
    expect(result.perdidos).toBe(0);
    expect(result.pendientes).toBe(0);
    expect(result.debugEntries[0]?.result_application?.excluded_reason).toBe('not_played');
  });
});
