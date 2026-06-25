const STORAGE_PREFIX = 'arma2_recent_activity_dismissed_';
const FALLBACK_SESSION_KEY = 'session';

const normalizeKeyPart = (value) => String(value ?? '').trim();

const canUseStorage = () => typeof window !== 'undefined';

const getStorage = (userId) => {
  if (!canUseStorage()) return null;

  const normalizedUserId = normalizeKeyPart(userId);
  if (normalizedUserId) return window.localStorage;

  return window.sessionStorage || window.localStorage;
};

export const getRecentActivityDismissalStorageKey = (userId) => {
  const normalizedUserId = normalizeKeyPart(userId);
  return `${STORAGE_PREFIX}${normalizedUserId || FALLBACK_SESSION_KEY}`;
};

const serializeDismissedIds = (ids) => JSON.stringify(
  Array.from(ids)
    .map((id) => normalizeKeyPart(id))
    .filter(Boolean)
    .sort(),
);

const writeDismissedRecentActivityIds = (userId, ids) => {
  const storage = getStorage(userId);
  if (!storage) return;

  try {
    storage.setItem(getRecentActivityDismissalStorageKey(userId), serializeDismissedIds(ids));
  } catch {
    // Ignore private mode/quota errors. Dismiss remains in memory for the current render.
  }
};

export const getDismissedRecentActivityIds = (userId) => {
  const storage = getStorage(userId);
  if (!storage) return new Set();

  try {
    const raw = storage.getItem(getRecentActivityDismissalStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();

    return new Set(
      parsed
        .map((id) => normalizeKeyPart(id))
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
};

export const dismissRecentActivityItem = (userId, itemKey) => {
  const normalizedItemKey = normalizeKeyPart(itemKey);
  if (!normalizedItemKey) return;

  const dismissedIds = getDismissedRecentActivityIds(userId);
  dismissedIds.add(normalizedItemKey);
  writeDismissedRecentActivityIds(userId, dismissedIds);
};

export const restoreRecentActivityItem = (userId, itemKey) => {
  const normalizedItemKey = normalizeKeyPart(itemKey);
  if (!normalizedItemKey) return;

  const dismissedIds = getDismissedRecentActivityIds(userId);
  dismissedIds.delete(normalizedItemKey);
  writeDismissedRecentActivityIds(userId, dismissedIds);
};

export const isRecentActivityDismissed = (userId, itemKey) => {
  const normalizedItemKey = normalizeKeyPart(itemKey);
  if (!normalizedItemKey) return false;
  return getDismissedRecentActivityIds(userId).has(normalizedItemKey);
};

export const getRecentActivityItemKey = (item) => {
  const explicitId = normalizeKeyPart(item?.id);
  if (explicitId) return explicitId;

  return [
    normalizeKeyPart(item?.source) || 'activity',
    normalizeKeyPart(item?.type) || 'unknown',
    normalizeKeyPart(item?.partidoId ?? item?.route ?? item?.title) || 'none',
    normalizeKeyPart(item?.createdAt) || 'undated',
  ].join(':');
};

export const filterDismissedRecentActivityItems = (items = [], userId) => {
  const dismissedIds = getDismissedRecentActivityIds(userId);
  if (dismissedIds.size === 0) return Array.isArray(items) ? items : [];

  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemKey = getRecentActivityItemKey(item);
    return itemKey && !dismissedIds.has(itemKey);
  });
};
