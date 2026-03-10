const {
  filterNotificationsForInbox,
  hasPendingMatchInviteStatus,
  isPendingMatchInviteNotification,
  MATCH_CANCELLATION_KEEP_ALIVE_MS,
} = require('../utils/notificationInviteState');

describe('filterNotificationsForInbox cancellation handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-09T20:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('hides other notifications from cancelled matches and keeps latest cancellation', () => {
    const rows = [
      {
        id: 'cancel-old',
        type: 'match_cancelled',
        created_at: '2026-03-09T18:00:00.000Z',
        data: { match_id: 501 },
      },
      {
        id: 'cancel-latest',
        type: 'match_cancelled',
        created_at: '2026-03-09T19:00:00.000Z',
        data: { match_id: 501 },
      },
      {
        id: 'challenge-open',
        type: 'challenge_squad_open',
        created_at: '2026-03-09T19:30:00.000Z',
        data: { match_id: 501 },
      },
      {
        id: 'other-match-invite',
        type: 'match_invite',
        read: false,
        created_at: '2026-03-09T19:10:00.000Z',
        data: { status: 'pending', match_id: 777 },
      },
    ];

    const filtered = filterNotificationsForInbox(rows);
    const ids = filtered.map((row) => row.id);

    expect(ids).toContain('cancel-latest');
    expect(ids).toContain('other-match-invite');
    expect(ids).not.toContain('cancel-old');
    expect(ids).not.toContain('challenge-open');
  });

  test('expires cancellation notice after keep-alive window and keeps match hidden', () => {
    const oldTs = new Date(Date.now() - MATCH_CANCELLATION_KEEP_ALIVE_MS - 60_000).toISOString();
    const rows = [
      {
        id: 'cancel-expired',
        type: 'match_cancelled',
        created_at: oldTs,
        data: { match_id: 900 },
      },
      {
        id: 'old-match-update',
        type: 'match_update',
        created_at: '2026-03-09T19:30:00.000Z',
        data: { match_id: 900 },
        message: 'Se sumó un jugador',
      },
    ];

    const filtered = filterNotificationsForInbox(rows);
    expect(filtered).toHaveLength(0);
  });

  test('keeps invite status pending even when read is true, but hides it from inbox pending filter', () => {
    const readPendingInvite = {
      id: 'invite-read-pending',
      type: 'match_invite',
      read: true,
      data: { status: 'pending', match_id: 712 },
    };

    expect(hasPendingMatchInviteStatus(readPendingInvite)).toBe(true);
    expect(isPendingMatchInviteNotification(readPendingInvite)).toBe(false);
  });
});
