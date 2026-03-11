jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildActivityFeed } = require('../utils/activityFeed');

describe('buildActivityFeed survey route guards', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not expose closed surveys as clickable activity items', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-closed-1',
        type: 'survey_start',
        read: false,
        created_at: '2026-03-08T10:00:00.000Z',
        partido_id: 901,
        data: {
          survey_deadline_at: '2026-03-08T11:00:00.000Z',
          match_name: 'Desafío: Equipo 1 vs Equipo 2',
        },
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toEqual([]);
  });

  test('keeps open surveys actionable with survey route', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-open-1',
        type: 'survey_start',
        read: false,
        created_at: '2026-03-08T10:00:00.000Z',
        partido_id: 902,
        data: {
          survey_deadline_at: '2026-03-09T11:00:00.000Z',
          match_name: 'Desafío: Equipo 1 vs Equipo 2',
        },
      },
    ], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('survey_start');
    expect(items[0].route).toBe('/encuesta/902');
  });

  test('hides survey activity when match is already closed even with future deadline', async () => {
    const items = await buildActivityFeed([
      {
        id: 'notif-closed-by-status',
        type: 'survey_start',
        read: false,
        created_at: '2026-03-08T10:00:00.000Z',
        partido_id: 903,
        data: {
          survey_deadline_at: '2026-03-09T11:00:00.000Z',
          match_name: 'Amistoso nocturno',
        },
      },
    ], {
      activeMatches: [
        {
          id: 903,
          nombre: 'Amistoso nocturno',
          survey_status: 'closed',
          result_status: 'finished',
          finished_at: '2026-03-08T10:30:00.000Z',
        },
      ],
      currentUserId: 'user-1',
      supabaseClient: null,
    });

    expect(items).toEqual([]);
  });
});
