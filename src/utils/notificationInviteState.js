import { extractNotificationMatchId } from './notificationRoutes';

export const normalizeInviteStatus = (status) => String(status || 'pending').trim().toLowerCase();

export const isPendingInviteStatus = (status) => normalizeInviteStatus(status) === 'pending';

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

  return rows.filter((notification) => {
    if (!notification) return false;

    if (notification.type === 'match_kicked') {
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

