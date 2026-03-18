const {
  isDeliveryLogPurgeEligible,
  isNotificationRetentionExempt,
} = require('../utils/notificationRetentionExemptions');

describe('notification retention exemptions', () => {
  const nowMs = Date.parse('2026-03-18T12:00:00.000Z');

  test('marks old inactive notifications as purge-eligible (not exempt)', () => {
    const exempt = isNotificationRetentionExempt({
      id: 'inactive-old',
      type: 'friend_accepted',
      read: true,
      status: 'sent',
      created_at: '2026-03-01T12:00:00.000Z',
      data: {},
    }, { nowMs });

    expect(exempt).toBe(false);
  });

  test('preserves pending friend requests', () => {
    const exempt = isNotificationRetentionExempt({
      id: 'friend-pending',
      type: 'friend_request',
      read: true,
      status: 'sent',
      created_at: '2026-03-01T12:00:00.000Z',
      data: {
        requestId: 'req-1',
        senderId: 'sender-1',
      },
    }, {
      nowMs,
      friendRequestStatusByRequestId: new Map([['req-1', 'pending']]),
    });

    expect(exempt).toBe(true);
  });

  test('preserves pending match invites', () => {
    const exempt = isNotificationRetentionExempt({
      id: 'invite-pending',
      type: 'match_invite',
      read: true,
      status: 'pending',
      created_at: '2026-03-01T12:00:00.000Z',
      data: {
        status: 'pending',
        match_id: 123,
      },
    }, { nowMs });

    expect(exempt).toBe(true);
  });

  test('preserves unread actionable notifications conservatively', () => {
    const exempt = isNotificationRetentionExempt({
      id: 'actionable-unread',
      type: 'call_to_vote',
      read: false,
      status: 'sent',
      created_at: '2026-03-01T12:00:00.000Z',
      data: {},
    }, { nowMs });

    expect(exempt).toBe(true);
  });

  test('marks only terminal delivery logs older than retention as purge-eligible', () => {
    expect(isDeliveryLogPurgeEligible({
      id: 'log-old-sent',
      status: 'sent',
      created_at: '2026-03-10T10:00:00.000Z',
    }, { nowMs, retentionDays: 7 })).toBe(true);

    expect(isDeliveryLogPurgeEligible({
      id: 'log-old-processing',
      status: 'processing',
      created_at: '2026-03-10T10:00:00.000Z',
    }, { nowMs, retentionDays: 7 })).toBe(false);

    expect(isDeliveryLogPurgeEligible({
      id: 'log-recent-sent',
      status: 'sent',
      created_at: '2026-03-17T10:00:00.000Z',
    }, { nowMs, retentionDays: 7 })).toBe(false);
  });
});
