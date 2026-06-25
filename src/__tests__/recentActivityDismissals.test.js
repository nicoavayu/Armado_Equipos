import {
  dismissRecentActivityItem,
  filterDismissedRecentActivityItems,
  getDismissedRecentActivityIds,
  getRecentActivityDismissalStorageKey,
  getRecentActivityItemKey,
  isRecentActivityDismissed,
  restoreRecentActivityItem,
} from '../utils/recentActivityDismissals';

describe('recent activity dismissals', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test('persists dismissed ids locally by user', () => {
    dismissRecentActivityItem('user-123', 'activity-friend_request-42');

    expect(getRecentActivityDismissalStorageKey('user-123')).toBe('arma2_recent_activity_dismissed_user-123');
    expect(getDismissedRecentActivityIds('user-123')).toEqual(new Set(['activity-friend_request-42']));
    expect(isRecentActivityDismissed('user-123', 'activity-friend_request-42')).toBe(true);
    expect(window.localStorage.getItem('arma2_recent_activity_dismissed_user-123')).toBe(
      JSON.stringify(['activity-friend_request-42']),
    );
  });

  test('filters dismissed items without mutating the notification source list', () => {
    const items = [
      { id: 'activity-friend_request-42', title: 'Nueva solicitud' },
      { id: 'activity-match_today-9', title: 'Jugás hoy' },
    ];
    const notifications = [{ id: 'notification-42', type: 'friend_request' }];

    dismissRecentActivityItem('user-123', 'activity-friend_request-42');

    expect(filterDismissedRecentActivityItems(items, 'user-123')).toEqual([
      { id: 'activity-match_today-9', title: 'Jugás hoy' },
    ]);
    expect(notifications).toEqual([{ id: 'notification-42', type: 'friend_request' }]);
  });

  test('restores dismissed ids when requested', () => {
    dismissRecentActivityItem('user-123', 'activity-match_today-9');
    restoreRecentActivityItem('user-123', 'activity-match_today-9');

    expect(isRecentActivityDismissed('user-123', 'activity-match_today-9')).toBe(false);
    expect(getDismissedRecentActivityIds('user-123')).toEqual(new Set());
  });

  test('builds a stable fallback key for grouped feed items without an id', () => {
    expect(getRecentActivityItemKey({
      source: 'notification',
      type: 'match_join_request',
      partidoId: 77,
      createdAt: '2026-06-25T10:00:00.000Z',
    })).toBe('notification:match_join_request:77:2026-06-25T10:00:00.000Z');
  });
});
