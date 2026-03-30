import { extractNotificationMatchId } from './notificationRoutes';
import { awardsNotificationWindowMs } from './notificationRetentionPolicy';
import { parseLocalDateTime } from './dateLocal';

export const normalizeInviteStatus = (status) => String(status || 'pending').trim().toLowerCase();
const normalizeNotificationType = (notification) => String(notification?.type || '').trim().toLowerCase();
const normalizeNotificationText = (value) => String(value || '').trim().toLowerCase();
const POST_SURVEY_RESULTS_NOTIFICATION_TYPES = new Set([
  'awards_ready',
  'award_won',
  'survey_finished',
  'survey_results',
  'survey_results_ready',
]);
const SURVEY_ACTIVE_NOTIFICATION_TYPES = new Set(['survey_start', 'post_match_survey', 'survey_reminder', 'survey_reminder_12h']);
const SOCIAL_NOTIFICATION_TYPES = new Set(['friend_request', 'friend_accepted', 'friend_rejected']);
const SOCIAL_NOTIFICATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const HIDE_AFTER_MATCH_START_TYPES = new Set([
  'match_invite',
  'match_join_request',
  'match_join_approved',
  'match_reminder_1h',
  'call_to_vote',
  'pre_match_vote',
  'match_update',
  'match_player_joined',
  'match_player_left',
  'match_today',
  'match_tomorrow',
  'falta_jugadores',
  'challenge_accepted',
  'team_match_created',
  'challenge_squad_open',
]);

export const isPendingInviteStatus = (status) => normalizeInviteStatus(status) === 'pending';
export const MATCH_CANCELLATION_KEEP_ALIVE_MS = 72 * 60 * 60 * 1000;
const MATCH_CANCELLATION_TYPES = new Set(['match_cancelled', 'match_deleted']);

export const getNotificationTimestampMs = (notification) => {
  const raw = notification?.send_at || notification?.created_at || null;
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseNotificationStartMs = (notification) => {
  const data = notification?.data || {};

  const resolvedStart = notification?._resolved_match_start_at || data?._resolved_match_start_at || null;
  const resolvedParsed = Date.parse(String(resolvedStart || ''));
  if (Number.isFinite(resolvedParsed)) return resolvedParsed;

  const parsedLocal = parseLocalDateTime(
    data?.fecha || data?.match_date || data?.partido_fecha || null,
    data?.hora || data?.match_time || data?.partido_hora || null,
  );
  if (parsedLocal instanceof Date && !Number.isNaN(parsedLocal.getTime())) {
    return parsedLocal.getTime();
  }

  const rawIso = (
    data?.scheduled_at
    || data?.scheduledAt
    || data?.match_start_at
    || data?.match_starts_at
    || data?.starts_at
    || data?.start_at
    || null
  );
  const parsedIso = Date.parse(String(rawIso || ''));
  return Number.isFinite(parsedIso) ? parsedIso : 0;
};

const parseNotificationSurveyClosesAtMs = (notification) => {
  const data = notification?.data || {};

  const resolvedClosesAt = notification?._resolved_survey_closes_at || data?._resolved_survey_closes_at || null;
  const resolvedParsed = Date.parse(String(resolvedClosesAt || ''));
  if (Number.isFinite(resolvedParsed)) return resolvedParsed;

  const rawIso = (
    data?.survey_closes_at
    || data?.surveyClosesAt
    || data?.survey_deadline_at
    || data?.surveyDeadlineAt
    || notification?.survey_closes_at
    || null
  );
  const parsedIso = Date.parse(String(rawIso || ''));
  return Number.isFinite(parsedIso) ? parsedIso : 0;
};

export const getNotificationMatchIdText = (notification) => {
  const raw = extractNotificationMatchId(notification);
  const text = String(raw ?? '').trim();
  return text || null;
};

export const hasPendingMatchInviteStatus = (notification) => {
  if (notification?.type !== 'match_invite') return false;
  return isPendingInviteStatus(notification?.data?.status);
};

export const isResolvedMatchJoinRequestNotification = (notification) => {
  if (normalizeNotificationType(notification) !== 'match_join_request') return false;
  const status = normalizeInviteStatus(
    notification?.data?.status
    ?? notification?.status
    ?? '',
  );
  return status === 'cancelled' || status === 'rejected';
};

export const isPendingMatchInviteNotification = (notification) => {
  if (!hasPendingMatchInviteStatus(notification)) return false;
  if (notification?.read === true) return false;
  return true;
};

export const buildLatestKickTsByMatch = (notifications = []) => {
  const kickTsByMatch = new Map();

  (Array.isArray(notifications) ? notifications : []).forEach((notification) => {
    if (notification?.type !== 'match_kicked') return;
    const matchId = getNotificationMatchIdText(notification);
    if (!matchId) return;
    const ts = getNotificationTimestampMs(notification);
    const current = kickTsByMatch.get(matchId) || 0;
    if (ts > current) {
      kickTsByMatch.set(matchId, ts);
    }
  });

  return kickTsByMatch;
};

export const buildLatestCancellationTsByMatch = (notifications = []) => {
  const cancellationTsByMatch = new Map();

  (Array.isArray(notifications) ? notifications : []).forEach((notification) => {
    const type = String(notification?.type || '').trim().toLowerCase();
    if (!MATCH_CANCELLATION_TYPES.has(type)) return;
    const matchId = getNotificationMatchIdText(notification);
    if (!matchId) return;
    const ts = getNotificationTimestampMs(notification);
    const current = cancellationTsByMatch.get(matchId) || 0;
    if (ts > current) {
      cancellationTsByMatch.set(matchId, ts);
    }
  });

  return cancellationTsByMatch;
};

export const isMatchCancellationNotification = (notification) => {
  return MATCH_CANCELLATION_TYPES.has(normalizeNotificationType(notification));
};

export const isMatchKickedNotification = (notification) => normalizeNotificationType(notification) === 'match_kicked';

export const isPlayerJoinedMatchUpdateNotification = (notification) => {
  if (normalizeNotificationType(notification) !== 'match_update') return false;

  const data = notification?.data || {};
  if (
    data?.player_name
    || data?.playerName
    || data?.player_user_id
    || data?.playerUserId
    || data?.joined_via
    || data?.joinedVia
  ) {
    return true;
  }

  const title = normalizeNotificationText(notification?.title);
  const message = normalizeNotificationText(notification?.message);
  return title.includes('nuevo jugador en el partido') || message.includes('se sumó al partido');
};

export const isPlayerLeftMatchUpdateNotification = (notification) => {
  if (normalizeNotificationType(notification) !== 'match_update') return false;

  const data = notification?.data || {};
  if (
    data?.player_name
    || data?.playerName
    || data?.player_user_id
    || data?.playerUserId
    || data?.left_via
    || data?.leftVia
  ) {
    const message = normalizeNotificationText(notification?.message);
    const title = normalizeNotificationText(notification?.title);
    if (
      title.includes('se bajó')
      || title.includes('jugador se bajó')
      || message.includes('se bajó del partido')
      || message.includes('abandon')
      || message.includes('salió del partido')
    ) {
      return true;
    }
  }

  const title = normalizeNotificationText(notification?.title);
  const message = normalizeNotificationText(notification?.message);
  return (
    title.includes('jugador se bajó del partido')
    || title.includes('se bajó del partido')
    || message.includes('se bajó del partido')
    || message.includes('abandon')
    || message.includes('salió del partido')
  );
};

export const isCancellationNotificationAlive = (
  notification,
  { nowMs = Date.now(), keepAliveMs = MATCH_CANCELLATION_KEEP_ALIVE_MS } = {},
) => {
  if (!isMatchCancellationNotification(notification)) return false;
  const ts = getNotificationTimestampMs(notification);
  if (!ts) return false;
  return nowMs - ts <= keepAliveMs;
};

export const isNotificationSuppressedByCancellation = (notification, cancellationTsByMatch) => {
  if (!notification || isMatchCancellationNotification(notification)) return false;
  const matchId = getNotificationMatchIdText(notification);
  if (!matchId) return false;
  return Boolean(cancellationTsByMatch?.get(matchId));
};

export const isInviteInvalidatedByKick = (notification, kickTsByMatch) => {
  if (notification?.type !== 'match_invite') return false;
  const matchId = getNotificationMatchIdText(notification);
  if (!matchId) return true;

  const inviteTs = getNotificationTimestampMs(notification);
  const kickTs = kickTsByMatch?.get(matchId) || 0;
  if (!kickTs) return false;
  return inviteTs <= kickTs;
};

export const filterNotificationsForInbox = (notifications = []) => {
  const rows = Array.isArray(notifications) ? notifications : [];
  const kickTsByMatch = buildLatestKickTsByMatch(rows);
  const cancellationTsByMatch = buildLatestCancellationTsByMatch(rows);
  const nowMs = Date.now();

  return rows.filter((notification) => {
    if (!notification) return false;

    const matchId = getNotificationMatchIdText(notification);

    if (isResolvedMatchJoinRequestNotification(notification)) {
      return false;
    }

    const notificationType = normalizeNotificationType(notification);

    if (POST_SURVEY_RESULTS_NOTIFICATION_TYPES.has(notificationType)) {
      const ts = getNotificationTimestampMs(notification);
      if (!ts) return false;
      if ((nowMs - ts) > awardsNotificationWindowMs) return false;
    }

    if (SOCIAL_NOTIFICATION_TYPES.has(notificationType)) {
      const ts = getNotificationTimestampMs(notification);
      if (!ts) return false;
      if ((nowMs - ts) > SOCIAL_NOTIFICATION_WINDOW_MS) return false;
    }

    if (SURVEY_ACTIVE_NOTIFICATION_TYPES.has(notificationType)) {
      const surveyClosesAtMs = parseNotificationSurveyClosesAtMs(notification);
      if (surveyClosesAtMs > 0 && surveyClosesAtMs <= nowMs) {
        return false;
      }
    }

    if (HIDE_AFTER_MATCH_START_TYPES.has(notificationType)) {
      const startMs = parseNotificationStartMs(notification);
      if (startMs > 0 && startMs <= nowMs) {
        return false;
      }
    }

    if (isMatchKickedNotification(notification)) {
      return true;
    }

    if (isMatchCancellationNotification(notification)) {
      if (!isCancellationNotificationAlive(notification, { nowMs })) return false;
      if (!matchId) return true;
      const latestCancellationTs = cancellationTsByMatch.get(matchId) || 0;
      return latestCancellationTs === getNotificationTimestampMs(notification);
    }

    if (isNotificationSuppressedByCancellation(notification, cancellationTsByMatch)) {
      return false;
    }

    if (notification.type !== 'match_invite') {
      return true;
    }

    if (!isPendingMatchInviteNotification(notification)) {
      return false;
    }

    return !isInviteInvalidatedByKick(notification, kickTsByMatch);
  });
};
