jest.mock('../config/surveyConfig', () => ({
  SURVEY_FINALIZE_DELAY_MS: 24 * 60 * 60 * 1000,
  SURVEY_START_DELAY_MS: 60 * 60 * 1000,
}));

const { buildActivityFeed } = require('../utils/activityFeed');

describe('buildActivityFeed retention windows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-18T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const runFeed = async (notification) => {
    return buildActivityFeed([notification], {
      activeMatches: [],
      currentUserId: null,
      supabaseClient: null,
    });
  };

  test('keeps survey-like notifications for up to 3 days', async () => {
    const items = await runFeed({
      id: 'vote-2d',
      type: 'call_to_vote',
      read: false,
      created_at: '2026-03-16T12:00:00.000Z',
      data: {},
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('call_to_vote');
  });

  test('drops survey-like notifications older than 3 days', async () => {
    const items = await runFeed({
      id: 'vote-4d',
      type: 'call_to_vote',
      read: false,
      created_at: '2026-03-14T11:59:59.000Z',
      data: {},
    });

    expect(items).toHaveLength(0);
  });

  test('keeps unread team invites for up to 5 days', async () => {
    const items = await runFeed({
      id: 'team-invite-4d',
      type: 'team_invite',
      read: false,
      created_at: '2026-03-14T13:00:00.000Z',
      data: { invitation_id: 'inv-1' },
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('team_invite');
    expect(items[0].route).toBe('/desafios?tab=mis-equipos');
  });

  test('drops unread team invites older than 5 days', async () => {
    const items = await runFeed({
      id: 'team-invite-6d',
      type: 'team_invite',
      read: false,
      created_at: '2026-03-12T11:00:00.000Z',
      data: { invitation_id: 'inv-2' },
    });

    expect(items).toHaveLength(0);
  });

  test('drops read team invites older than 3 days', async () => {
    const items = await runFeed({
      id: 'team-invite-read-4d',
      type: 'team_invite',
      read: true,
      created_at: '2026-03-14T11:00:00.000Z',
      data: { invitation_id: 'inv-3' },
    });

    expect(items).toHaveLength(0);
  });

  test('keeps default activity types for up to 3 days only', async () => {
    const withinWindow = await runFeed({
      id: 'friend-ok-2d',
      type: 'friend_accepted',
      read: false,
      created_at: '2026-03-16T14:00:00.000Z',
      data: {},
    });
    expect(withinWindow).toHaveLength(1);

    const outsideWindow = await runFeed({
      id: 'friend-old-4d',
      type: 'friend_accepted',
      read: false,
      created_at: '2026-03-14T09:00:00.000Z',
      data: {},
    });
    expect(outsideWindow).toHaveLength(0);
  });

  test('shows who accepted a friend request from legacy message copy', async () => {
    const items = await runFeed({
      id: 'friend-accepted-legacy',
      type: 'friend_accepted',
      read: false,
      created_at: '2026-03-16T14:00:00.000Z',
      message: 'Nico ha aceptado tu solicitud de amistad',
      data: {},
    });

    expect(items).toHaveLength(1);
    expect(items[0].subtitle).toBe('Nico aceptó tu solicitud');
  });

  test('shows who accepted a friend request from notification data', async () => {
    const items = await runFeed({
      id: 'friend-accepted-data',
      type: 'friend_accepted',
      read: false,
      created_at: '2026-03-16T14:00:00.000Z',
      data: { accepterName: 'Matias' },
    });

    expect(items).toHaveLength(1);
    expect(items[0].subtitle).toBe('Matias aceptó tu solicitud');
  });
});
