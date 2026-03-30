export const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Canonical temporal criteria:
 * - UI visibility cutoff uses `created_at` (event age window).
 * - UI ordering/display uses `send_at` when present, fallback `created_at`.
 * - DB purge uses `created_at` (implemented in SQL cleanup migration).
 * - `read_at` is informational/audit only; it is not used as retention or ordering key.
 */

// UI visibility windows
export const NOTIFICATIONS_UI_WINDOW_DAYS = 5;
export const ACTIVITY_WINDOW_DEFAULT_DAYS = 3;
export const ACTIVITY_WINDOW_ACTIONABLE_UNREAD_DAYS = 5;
export const ACTIVITY_WINDOW_ACTIONABLE_READ_DAYS = 3;
export const ACTIVITY_WINDOW_SURVEY_LIKE_DAYS = 3;
export const AWARDS_NOTIFICATION_WINDOW_DAYS = 1;

// DB retention targets (documented here for consistency with SQL cleanup jobs)
export const NOTIFICATIONS_DB_RETENTION_DAYS = 14;
export const DELIVERY_LOG_DB_RETENTION_DAYS = 7;

export const notificationsUiWindowMs = NOTIFICATIONS_UI_WINDOW_DAYS * DAY_MS;
export const activityWindowDefaultMs = ACTIVITY_WINDOW_DEFAULT_DAYS * DAY_MS;
export const activityWindowActionableUnreadMs = ACTIVITY_WINDOW_ACTIONABLE_UNREAD_DAYS * DAY_MS;
export const activityWindowActionableReadMs = ACTIVITY_WINDOW_ACTIONABLE_READ_DAYS * DAY_MS;
export const activityWindowSurveyLikeMs = ACTIVITY_WINDOW_SURVEY_LIKE_DAYS * DAY_MS;
export const awardsNotificationWindowMs = AWARDS_NOTIFICATION_WINDOW_DAYS * DAY_MS;

export const getNotificationsUiCutoffIso = (nowMs = Date.now()) => {
  const cutoff = new Date(nowMs - notificationsUiWindowMs);
  return cutoff.toISOString();
};

const parseTimestamp = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

// Canonical timestamp for display/order in UI lists.
export const getNotificationDisplayTimestampMs = (notification) => {
  if (!notification) return 0;
  const sendAt = parseTimestamp(notification.send_at);
  if (sendAt > 0) return sendAt;
  return parseTimestamp(notification.created_at);
};
