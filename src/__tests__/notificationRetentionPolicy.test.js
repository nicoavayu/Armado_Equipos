const {
  NOTIFICATIONS_UI_WINDOW_DAYS,
  ACTIVITY_WINDOW_DEFAULT_DAYS,
  ACTIVITY_WINDOW_ACTIONABLE_UNREAD_DAYS,
  ACTIVITY_WINDOW_ACTIONABLE_READ_DAYS,
  ACTIVITY_WINDOW_SURVEY_LIKE_DAYS,
  getNotificationDisplayTimestampMs,
  getNotificationsUiCutoffIso,
} = require('../utils/notificationRetentionPolicy');

describe('notification retention policy helpers', () => {
  test('keeps expected visibility windows', () => {
    expect(NOTIFICATIONS_UI_WINDOW_DAYS).toBe(5);
    expect(ACTIVITY_WINDOW_DEFAULT_DAYS).toBe(3);
    expect(ACTIVITY_WINDOW_ACTIONABLE_UNREAD_DAYS).toBe(5);
    expect(ACTIVITY_WINDOW_ACTIONABLE_READ_DAYS).toBe(3);
    expect(ACTIVITY_WINDOW_SURVEY_LIKE_DAYS).toBe(3);
  });

  test('computes notifications cutoff at 5 days', () => {
    const nowMs = Date.parse('2026-03-18T12:00:00.000Z');
    const cutoffIso = getNotificationsUiCutoffIso(nowMs);
    expect(cutoffIso).toBe('2026-03-13T12:00:00.000Z');
  });

  test('uses send_at as primary display timestamp and falls back to created_at', () => {
    const withSendAt = getNotificationDisplayTimestampMs({
      created_at: '2026-03-10T10:00:00.000Z',
      send_at: '2026-03-11T10:00:00.000Z',
    });
    expect(withSendAt).toBe(Date.parse('2026-03-11T10:00:00.000Z'));

    const fallbackCreatedAt = getNotificationDisplayTimestampMs({
      created_at: '2026-03-10T10:00:00.000Z',
      send_at: null,
    });
    expect(fallbackCreatedAt).toBe(Date.parse('2026-03-10T10:00:00.000Z'));
  });
});
