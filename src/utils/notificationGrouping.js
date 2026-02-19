import { extractNotificationMatchId } from './notificationRoutes';

const toTimestamp = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const groupNotificationsByMatch = (notifications = []) => {
  if (!Array.isArray(notifications) || notifications.length === 0) return [];

  const sorted = [...notifications].sort((a, b) => toTimestamp(b?.created_at) - toTimestamp(a?.created_at));
  const groups = new Map();

  sorted.forEach((notification) => {
    const rawMatchId = extractNotificationMatchId(notification);
    const hasMatch = rawMatchId !== null && rawMatchId !== undefined && String(rawMatchId).trim() !== '';
    const matchId = hasMatch ? String(rawMatchId) : null;
    const key = hasMatch ? `match:${matchId}` : `single:${notification.id}`;
    const ts = toTimestamp(notification?.created_at);

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        matchId,
        latest: notification,
        items: [notification],
        ts,
      });
      return;
    }

    existing.items.push(notification);
    if (ts > existing.ts) {
      existing.latest = notification;
      existing.ts = ts;
    }
  });

  return Array.from(groups.values())
    .sort((a, b) => b.ts - a.ts)
    .map((group) => ({
      key: group.key,
      matchId: group.matchId,
      latest: group.latest,
      items: group.items,
      count: group.items.length,
      unreadCount: group.items.filter((item) => !item.read).length,
    }));
};
