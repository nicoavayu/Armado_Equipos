export const NOTIFICATION_FILTER_OPTIONS = [
  { key: 'all', label: 'Todo' },
  { key: 'matches', label: 'Partidos' },
  { key: 'surveys', label: 'Encuestas' },
  { key: 'rewards', label: 'Premios/Sanciones' },
];

const MATCH_TYPES = new Set([
  'match_invite',
  'match_update',
  'match_cancelled',
  'match_deleted',
  'match_kicked',
  'match_join_request',
  'match_join_approved',
  'call_to_vote',
  'pre_match_vote',
  // Social notifications stay visible under "Partidos" to avoid a separate filter tab.
  'friend_request',
  'friend_accepted',
  'friend_rejected',
]);

const SURVEY_TYPES = new Set([
  'survey_start',
  'post_match_survey',
  'survey_reminder',
  'survey_finished',
  'survey_results',
  'survey_results_ready',
]);

const REWARD_TYPES = new Set([
  'awards_ready',
  'award_won',
  'no_show_penalty_applied',
  'no_show_recovery_applied',
]);

export const getNotificationFilterKey = (type) => {
  const normalizedType = String(type || '').trim();
  if (SURVEY_TYPES.has(normalizedType)) return 'surveys';
  if (REWARD_TYPES.has(normalizedType)) return 'rewards';
  if (MATCH_TYPES.has(normalizedType)) return 'matches';
  return 'matches';
};

export const filterNotificationsByCategory = (notifications = [], category = 'all') => {
  if (!Array.isArray(notifications)) return [];
  if (category === 'all') return notifications;
  return notifications.filter((notification) => getNotificationFilterKey(notification?.type) === category);
};

export const getCategoryCount = (notifications = [], category = 'all') => (
  filterNotificationsByCategory(notifications, category).length
);

