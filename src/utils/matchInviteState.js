const toText = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const normalizeType = (value) => String(value || '').trim().toLowerCase();

export const normalizeInviteStatus = (value) => String(value || 'pending').trim().toLowerCase();

export const getNotificationTimestampMs = (row) => {
  const raw = row?.send_at || row?.created_at || null;
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export const resolveNotificationMatchIdText = (row) => toText(
  row?.match_id_text
  ?? row?.partido_id
  ?? row?.match_ref
  ?? row?.data?.match_id
  ?? row?.data?.matchId
  ?? row?.data?.partido_id
  ?? row?.data?.partidoId,
);

export const resolveNotificationUserIdText = (row) => toText(row?.user_id);

export const buildMatchNotificationOrFilter = (matchId) => {
  const matchIdText = toText(matchId);
  const matchIdNumber = Number(matchId);

  return [
    Number.isFinite(matchIdNumber) ? `partido_id.eq.${matchIdNumber}` : null,
    `data->>matchId.eq.${matchIdText}`,
    `data->>match_id.eq.${matchIdText}`,
    `data->>partido_id.eq.${matchIdText}`,
    `data->>partidoId.eq.${matchIdText}`,
  ]
    .filter(Boolean)
    .join(',');
};

export const EMPTY_MATCH_INVITE_STATE = Object.freeze({
  latestInvite: null,
  latestKick: null,
  latestInviteStatus: null,
  effectiveStatus: null,
  hasPendingInvite: false,
  blockedByKick: false,
  hadHistory: false,
  isReinvitable: false,
});

const resolveInviteStateForScopedRows = (rows = []) => {
  const ordered = [...(Array.isArray(rows) ? rows : [])]
    .sort((left, right) => getNotificationTimestampMs(right) - getNotificationTimestampMs(left));

  const latestInvite = ordered.find((row) => normalizeType(row?.type) === 'match_invite') || null;
  const latestKick = ordered.find((row) => normalizeType(row?.type) === 'match_kicked') || null;
  const latestInviteStatus = latestInvite ? normalizeInviteStatus(latestInvite?.data?.status) : null;
  const inviteTs = getNotificationTimestampMs(latestInvite);
  const kickTs = getNotificationTimestampMs(latestKick);
  const hasPendingInvite = Boolean(latestInvite)
    && latestInviteStatus === 'pending'
    && (kickTs === 0 || inviteTs > kickTs);
  const blockedByKick = Boolean(latestKick) && (!latestInvite || inviteTs <= kickTs);

  return {
    latestInvite,
    latestKick,
    latestInviteStatus,
    effectiveStatus: hasPendingInvite ? 'pending' : (blockedByKick ? 'kicked' : latestInviteStatus),
    hasPendingInvite,
    blockedByKick,
    hadHistory: Boolean(latestInvite || latestKick),
    isReinvitable: Boolean(latestInvite || latestKick) && !hasPendingInvite,
  };
};

export const buildInviteStateByMatch = (rows = []) => {
  const grouped = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const matchId = resolveNotificationMatchIdText(row);
    if (!matchId) return;
    const bucket = grouped.get(matchId) || [];
    bucket.push(row);
    grouped.set(matchId, bucket);
  });

  const states = new Map();
  grouped.forEach((groupRows, matchId) => {
    states.set(matchId, resolveInviteStateForScopedRows(groupRows));
  });
  return states;
};

export const buildInviteStateByUser = (rows = []) => {
  const grouped = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const userId = resolveNotificationUserIdText(row);
    if (!userId) return;
    const bucket = grouped.get(userId) || [];
    bucket.push(row);
    grouped.set(userId, bucket);
  });

  const states = new Map();
  grouped.forEach((groupRows, userId) => {
    states.set(userId, resolveInviteStateForScopedRows(groupRows));
  });
  return states;
};

export const normalizeSendMatchInviteResult = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const status = String(value.status || '').trim().toLowerCase();
    return status || 'sent';
  }
  return 'sent';
};
