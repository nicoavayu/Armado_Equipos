import logger from '../utils/logger';
import { supabase } from '../lib/supabaseClient';

const ALLOWED_AUTO_MATCH_EVENTS = new Set([
  'auto_match_gestating',
  'auto_match_almost_full',
  'auto_match_ready',
  'auto_match_cancelled',
]);

export const requestImmediateAutoMatchPushDispatch = async ({ eventType, limit = 100 } = {}) => {
  const normalized = String(eventType || '').trim().toLowerCase();
  if (!ALLOWED_AUTO_MATCH_EVENTS.has(normalized)) {
    throw new Error('invalid_auto_match_event_type');
  }

  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 100)));
  const { data, error } = await supabase.functions.invoke('push-auto-match-now', {
    body: { event_type: normalized, limit: safeLimit },
  });

  if (error) throw error;
  if (!data?.ok) throw new Error(data?.reason || 'auto_match_push_dispatch_failed');
  return data;
};

export const requestImmediateAutoMatchPushDispatchSafe = (params) => {
  requestImmediateAutoMatchPushDispatch(params).catch((error) => {
    logger.warn('[AUTO_MATCH_PUSH] immediate dispatch failed:', {
      message: error?.message || String(error),
      eventType: params?.eventType || null,
    });
  });
};
