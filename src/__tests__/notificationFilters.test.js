import {
  filterNotificationsByCategory,
  getCategoryCount,
  getNotificationFilterKey,
} from '../utils/notificationFilters';

describe('notificationFilters', () => {
  const notifications = [
    { id: 1, type: 'match_invite', read: false },
    { id: 2, type: 'survey_start', read: true },
    { id: 3, type: 'award_won', read: false },
    { id: 4, type: 'friend_request', read: true },
    { id: 5, type: 'payment_reminder', read: false },
  ];

  test('classifies known notification types', () => {
    expect(getNotificationFilterKey('match_invite')).toBe('matches');
    expect(getNotificationFilterKey('substitute_promoted')).toBe('matches');
    expect(getNotificationFilterKey('survey_start')).toBe('surveys');
    expect(getNotificationFilterKey('challenge_result_survey')).toBe('surveys');
    expect(getNotificationFilterKey('award_won')).toBe('rewards');
    expect(getNotificationFilterKey('payment_reminder')).toBe('payments');
    expect(getNotificationFilterKey('payment_reported')).toBe('payments');
  });

  test('filters notifications by category', () => {
    expect(filterNotificationsByCategory(notifications, 'all')).toHaveLength(5);
    expect(filterNotificationsByCategory(notifications, 'matches')).toHaveLength(2);
    expect(filterNotificationsByCategory(notifications, 'surveys')).toHaveLength(1);
    expect(filterNotificationsByCategory(notifications, 'rewards')).toHaveLength(1);
    expect(filterNotificationsByCategory(notifications, 'payments')).toHaveLength(1);
    expect(filterNotificationsByCategory(notifications, 'unread')).toHaveLength(3);
  });

  test('returns category counts', () => {
    expect(getCategoryCount(notifications, 'matches')).toBe(2);
    expect(getCategoryCount(notifications, 'surveys')).toBe(1);
    expect(getCategoryCount(notifications, 'rewards')).toBe(1);
    expect(getCategoryCount(notifications, 'payments')).toBe(1);
    expect(getCategoryCount(notifications, 'unread')).toBe(3);
  });
});
