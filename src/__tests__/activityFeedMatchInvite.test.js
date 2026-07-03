jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildActivityFeed } = require('../utils/activityFeed');

describe('buildActivityFeed match_invite copy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-28T23:45:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const buildInviteNotification = (data = {}) => ({
    id: 'invite-notification-1',
    type: 'match_invite',
    read: false,
    created_at: '2026-04-28T23:40:00.000Z',
    data: {
      match_id: 987,
      matchId: 987,
      status: 'pending',
      link: '/partido/987/invitacion',
      ...data,
    },
  });

  const runFeed = (notification) => buildActivityFeed([notification], {
    activeMatches: [],
    currentUserId: 'user-1',
    supabaseClient: null,
  });

  test('uses camelCase matchName from the invite payload', async () => {
    const items = await runFeed(buildInviteNotification({
      matchName: 'Fulbito martes',
    }));

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Invitación a "Fulbito martes"');
    expect(items[0].route).toBe('/partido/987/invitacion');
  });

  test('does not quote the generic fallback as a match name', async () => {
    const items = await runFeed(buildInviteNotification({
      matchName: 'este partido',
    }));

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Invitación a partido');
    expect(items[0].title).not.toContain('"este partido"');
  });

  test('drops a stale pending invite when real roster state says the user already joined', async () => {
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      in: jest.fn(async () => ({
        data: [{ partido_id: 987 }],
        error: null,
      })),
    };

    const items = await buildActivityFeed([buildInviteNotification({
      matchName: 'Fulbito martes',
    })], {
      activeMatches: [],
      currentUserId: 'user-1',
      supabaseClient: { from: jest.fn(() => query) },
    });

    expect(items).toEqual([]);
  });
});
