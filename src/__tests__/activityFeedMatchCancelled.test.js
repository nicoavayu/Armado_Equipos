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
});
