import { extractNotificationMatchId } from './notificationRoutes';

export const normalizeInviteStatus = (status) => String(status || 'pending').trim().toLowerCase();

export const isPendingInviteStatus = (status) => normalizeInviteStatus(status) === 'pending';
export const MATCH_CANCELLATION_KEEP_ALIVE_MS = 72 * 60 * 60 * 1000;
const MATCH_CANCELLATION_TYPES = new Set(['match_cancelled', 'match_deleted']);

export const getNotificationTimestampMs = (notification) => {
  const raw = notification?.send_at || notification?.created_at || null;
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getNotificationMatchIdText = (notification) => {
  const raw = extractNotificationMatchId(notification);
  const text = String(raw ?? '').trim();
  return text || null;
};

export const isPendingMatchInviteNotification = (notification) => {
  if (notification?.type !== 'match_invite') return false;
  if (notification?.read === true) return false;
  return isPendingInviteStatus(notification?.data?.status);
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
  const type = String(notification?.type || '').trim().toLowerCase();
  return MATCH_CANCELLATION_TYPES.has(type);
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

    if (notification.type === 'match_kicked') {
      return false;
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
