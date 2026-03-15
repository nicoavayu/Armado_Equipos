jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildActivityFeed } = require('../utils/activityFeed');

const createSupabaseMock = ({ weeklyMatchDate = '2026-03-10' } = {}) => ({
  from: jest.fn((table) => {
    if (table === 'jugadores') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(async () => ({
            data: [{ partido_id: 101 }],
            error: null,
          })),
        })),
      };
    }

    if (table === 'partidos') {
      return {
        select: jest.fn(() => ({
          in: jest.fn(() => ({
            in: jest.fn(() => ({
              gte: jest.fn(async () => ({
                data: [{ id: 101, estado: 'finalizado', fecha: weeklyMatchDate }],
                error: null,
              })),
            })),
          })),
        })),
      };
    }

    throw new Error(`Unexpected table mock: ${table}`);
  }),
});

describe('buildActivityFeed weekly insight scheduling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    window.localStorage.clear();
  });

  test('shows weekly insight on sunday when the user played this week', async () => {
    jest.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));

    const items = await buildActivityFeed([], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: createSupabaseMock(),
    });

    expect(items.some((item) => item.type === 'insight_weekly_matches')).toBe(true);
  });

  test('does not show weekly insight outside sunday', async () => {
    jest.setSystemTime(new Date('2026-03-14T12:00:00.000Z'));

    const items = await buildActivityFeed([], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: createSupabaseMock(),
    });

    expect(items.some((item) => item.type === 'insight_weekly_matches')).toBe(false);
  });
});
