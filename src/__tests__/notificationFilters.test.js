import {
  filterNotificationsByCategory,
  getCategoryCount,
  getNotificationFilterKey,
} from '../utils/notificationFilters';

describe('notificationFilters', () => {
  const notifications = [
    { id: 1, type: 'match_invite' },
    { id: 2, type: 'survey_start' },
    { id: 3, type: 'award_won' },
    { id: 4, type: 'friend_request' },
  ];

  test('classifies known notification types', () => {
    expect(getNotificationFilterKey('match_invite')).toBe('matches');
    expect(getNotificationFilterKey('survey_start')).toBe('surveys');
    expect(getNotificationFilterKey('award_won')).toBe('rewards');
  });

  test('filters notifications by category', () => {
    expect(filterNotificationsByCategory(notifications, 'all')).toHaveLength(4);
    expect(filterNotificationsByCategory(notifications, 'matches')).toHaveLength(2);
    expect(filterNotificationsByCategory(notifications, 'surveys')).toHaveLength(1);
    expect(filterNotificationsByCategory(notifications, 'rewards')).toHaveLength(1);
  });

  test('returns category counts', () => {
    expect(getCategoryCount(notifications, 'matches')).toBe(2);
    expect(getCategoryCount(notifications, 'surveys')).toBe(1);
    expect(getCategoryCount(notifications, 'rewards')).toBe(1);
  });
});

