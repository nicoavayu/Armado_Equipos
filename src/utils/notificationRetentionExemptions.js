import { DAY_MS } from './notificationRetentionPolicy';

const ACTIVE_STATUS = new Set([
  'pending',
  'open',
  'active',
  'queued',
  'processing',
  'retryable_failed',
  'in_progress',
]);

const ACTIONABLE_UNREAD_TYPES = new Set([
  'friend_request',
  'match_invite',
  'team_invite',
  'match_join_request',
  'call_to_vote',
  'survey_start',
  'post_match_survey',
  'survey_reminder',
  'survey_reminder_12h',
  'challenge_squad_open',
  'challenge_result_survey',
  'challenge_result_pending',
]);

const TERMINAL_DELIVERY_LOG_STATUS = new Set(['sent', 'failed', 'skipped']);

const normalize = (value) => String(value || '').trim().toLowerCase();

const parseTimestampMs = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isNotificationRetentionExempt = (
  notification,
  options = {},
) => {
  if (!notification) return false;

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const data = notification?.data || {};
  const type = normalize(notification?.type);
  const status = normalize(notification?.status);
  const dataStatus = normalize(data?.status);
  const read = notification?.read === true;

  const sendAtMs = parseTimestampMs(notification?.send_at);
  if (sendAtMs > nowMs) return true;

  if (ACTIVE_STATUS.has(status) || ACTIVE_STATUS.has(dataStatus)) return true;

  if (!read && ACTIONABLE_UNREAD_TYPES.has(type)) return true;

  const friendRequestStatusByRequestId = options.friendRequestStatusByRequestId || new Map();
  const friendRequestStatusBySenderId = options.friendRequestStatusBySenderId || new Map();
  const teamInvitationStatusById = options.teamInvitationStatusById || new Map();

  if (type === 'friend_request') {
    const requestId = String(data?.requestId || data?.request_id || '').trim();
    const senderId = String(data?.senderId || data?.sender_id || '').trim();
    if (normalize(friendRequestStatusByRequestId.get(requestId)) === 'pending') return true;
    if (normalize(friendRequestStatusBySenderId.get(senderId)) === 'pending') return true;
  }

  if (type === 'team_invite') {
    const invitationId = String(data?.invitation_id || data?.invitationId || '').trim();
    if (normalize(teamInvitationStatusById.get(invitationId)) === 'pending') return true;
  }

  if (type === 'match_invite' && (status === 'pending' || dataStatus === 'pending')) {
    return true;
  }

  return false;
};

export const isDeliveryLogPurgeEligible = (
  row,
  {
    nowMs = Date.now(),
    retentionDays = 7,
  } = {},
) => {
  if (!row) return false;

  const createdAtMs = parseTimestampMs(row?.created_at);
  if (!createdAtMs) return false;
  const ageMs = nowMs - createdAtMs;
  if (ageMs < Math.max(1, retentionDays) * DAY_MS) return false;

  return TERMINAL_DELIVERY_LOG_STATUS.has(normalize(row?.status));
};
