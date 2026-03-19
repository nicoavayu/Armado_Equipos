const MATCH_INVITED_GROUPS_CACHE_PREFIX = 'match_invited_groups_v1';

const buildInvitedGroupsCacheKey = (matchId) => (
  `${MATCH_INVITED_GROUPS_CACHE_PREFIX}:${String(matchId || '').trim()}`
);

export const readCachedInvitedGroupIds = (matchId) => {
  const matchIdText = String(matchId || '').trim();
  if (!matchIdText) return new Set();

  try {
    const raw = localStorage.getItem(buildInvitedGroupsCacheKey(matchIdText));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    );
  } catch (_error) {
    return new Set();
  }
};

export const writeCachedInvitedGroupIds = (matchId, groupIds = []) => {
  const matchIdText = String(matchId || '').trim();
  if (!matchIdText) return;

  try {
    const normalized = Array.from(groupIds || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    localStorage.setItem(buildInvitedGroupsCacheKey(matchIdText), JSON.stringify(normalized));
  } catch (_error) {
    // Ignore localStorage failures (private mode / quota).
  }
};

export const rememberCachedInvitedGroupIds = (matchId, groupIds = []) => {
  const next = readCachedInvitedGroupIds(matchId);
  Array.from(groupIds || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .forEach((groupId) => next.add(groupId));
  writeCachedInvitedGroupIds(matchId, next);
  return next;
};
