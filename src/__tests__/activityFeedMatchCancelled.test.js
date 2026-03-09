jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildActivityFeed } = require('../utils/activityFeed');

describe('buildActivityFeed match_cancelled', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders cancellation notifications in recent activity for challenge matches', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-cancel-1',
        type: 'match_cancelled',
        read: false,
        created_at: '2026-03-08T11:55:00.000Z',
        data: {
          team_match_id: 'tm-200',
          cancelled_by_team_name: 'Sardinitis',
          team_a_name: 'Equipo 1',
          team_b_name: 'Deportivo Saque',
        },
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('match_cancelled');
    expect(items[0].title).toBe('Partido cancelado');
    expect(items[0].subtitle).toContain('Sardinitis');
    expect(items[0].subtitle).toContain('Equipo 1 vs Deportivo Saque');
    expect(items[0].route).toBe('/desafios');
  });

  test('keeps only the cancellation item for a cancelled match and includes match identity', async () => {
    const matchId = 777;
    const items = await buildActivityFeed([
      {
        id: 'notif-cancel-2',
        type: 'match_cancelled',
        read: false,
        created_at: '2026-03-08T11:59:00.000Z',
        data: {
          match_id: matchId,
          match_name: 'Partido Jueves',
        },
        message: 'Partido cancelado por el administrador',
      },
      {
        id: 'notif-squad-open-2',
        type: 'challenge_squad_open',
        read: false,
        created_at: '2026-03-08T11:58:00.000Z',
        data: {
          match_id: matchId,
          team_a_name: 'Equipo 1',
          team_b_name: 'Sardinitis',
        },
        message: 'Revisá disponibilidad de tu equipo',
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('match_cancelled');
    expect(items[0].subtitle).toContain('Partido Jueves');
  });
});
