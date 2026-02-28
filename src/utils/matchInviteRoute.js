function isSafeInternalPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}

function hasInviteCode(path) {
  if (!isSafeInternalPath(path)) return false;
  try {
    const parsed = new URL(path, 'http://localhost');
    if (!/^\/partido\/\d+\/invitacion$/.test(parsed.pathname)) return false;
    const code = parsed.searchParams.get('codigo') || parsed.searchParams.get('c');
    return Boolean(String(code || '').trim());
  } catch (_error) {
    return false;
  }
}

function isInvitePath(path) {
  if (!isSafeInternalPath(path)) return false;
  if (/^\/i\/[^/]+(?:\?.*)?$/.test(path)) return true;
  return hasInviteCode(path);
}

export function resolveMatchInviteRoute(notification) {
  const data = notification?.data || {};
  const candidatePath = notification?.deep_link || notification?.deepLink || data?.deep_link || data?.deepLink || data?.link;
  if (isInvitePath(candidatePath)) {
    return candidatePath;
  }

  const matchId = notification?.partido_id
    ?? data?.match_id
    ?? data?.matchId
    ?? data?.partido_id
    ?? data?.partidoId
    ?? notification?.match_ref
    ?? null;

  if (!matchId) return null;

  const inviteCodeRaw = data?.codigo ?? data?.matchCode ?? data?.code ?? null;
  const inviteCode = inviteCodeRaw == null ? '' : String(inviteCodeRaw).trim();
  if (!inviteCode) return null;
  const query = `?codigo=${encodeURIComponent(inviteCode)}`;

  return `/partido/${matchId}/invitacion${query}`;
}
