import { supabase } from '../lib/supabaseClient';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const normalizeEventType = (value) => String(value || '').trim().toLowerCase();
const normalizeId = (value) => {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
};
const normalizeOptionalInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};
const normalizeLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
};

export const requestImmediatePushDispatch = async ({
  eventType,
  matchId = null,
  requestId = null,
  recipientUserId = null,
  limit = DEFAULT_LIMIT,
}) => {
  const normalizedEventType = normalizeEventType(eventType);
  if (!normalizedEventType) {
    throw new Error('invalid_event_type');
  }

  const payload = {
    event_type: normalizedEventType,
    limit: normalizeLimit(limit),
  };

  const normalizedMatchId = normalizeOptionalInt(matchId);
  if (normalizedMatchId !== null) {
    payload.match_id = normalizedMatchId;
  }

  const normalizedRequestId = normalizeId(requestId);
  if (normalizedRequestId) {
    payload.request_id = normalizedRequestId;
  }

  const normalizedRecipientUserId = normalizeId(recipientUserId);
  if (normalizedRecipientUserId) {
    payload.recipient_user_id = normalizedRecipientUserId;
  }

  const { data, error } = await supabase.functions.invoke('push-dispatch-now', {
    body: payload,
  });

  if (error) {
    throw error;
  }

  if (!data?.ok) {
    throw new Error(data?.reason || 'push_dispatch_kick_failed');
  }

  return data;
};

export const requestImmediatePushDispatchSafe = (params) => {
  requestImmediatePushDispatch(params).catch((error) => {
    console.warn('[PUSH_DISPATCH] immediate dispatch kick failed:', {
      message: error?.message || String(error),
      eventType: params?.eventType || null,
    });
  });
};
