function isSafeInternalPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}

function isInvitePath(path) {
  if (!isSafeInternalPath(path)) return false;
  return /^\/partido\/\d+\/invitacion(?:\?.*)?$/.test(path) || /^\/i\/[^/]+(?:\?.*)?$/.test(path);
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
  const query = inviteCode ? `?codigo=${encodeURIComponent(inviteCode)}` : '';

  return `/partido/${matchId}/invitacion${query}`;
}
