import { supabase } from '../supabase';

const normalizeName = (value, fallback = 'Un jugador') => {
  const raw = String(value || '').trim();
  return raw || fallback;
};

const toMatchId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const enqueueAdminNotification = async ({
  matchId,
  type,
  title,
  message,
  payload = {},
}) => {
  const matchIdNumber = toMatchId(matchId);
  if (!matchIdNumber) return { ok: false, reason: 'invalid_match_id' };

  try {
    const { error } = await supabase.rpc('enqueue_partido_notification', {
      p_partido_id: matchIdNumber,
      p_type: type,
      p_title: title,
      p_message: message,
      p_payload: payload,
    });

    if (error) {
      console.warn('[JOIN_NOTIFICATIONS] enqueue_partido_notification failed', {
        matchId: matchIdNumber,
        type,
        code: error.code,
        message: error.message,
      });
      return { ok: false, reason: 'rpc_error', error };
    }

    return { ok: true };
  } catch (error) {
    console.warn('[JOIN_NOTIFICATIONS] unexpected error', {
      matchId: matchIdNumber,
      type,
      error: error?.message || String(error),
    });
    return { ok: false, reason: 'unexpected_error', error };
  }
};

const enqueueParticipantNotification = async ({
  matchId,
  type,
  title,
  message,
  payload = {},
  excludeUserId = null,
  includeAdmin = true,
}) => {
  const matchIdNumber = toMatchId(matchId);
  if (!matchIdNumber) return { ok: false, reason: 'invalid_match_id' };

  const fallbackToAdminNotification = async (fallbackReason, sourceError = null) => {
    const fallbackPayload = {
      ...payload,
      participant_fanout_fallback: true,
      participant_fanout_reason: fallbackReason,
    };

    const fallbackResult = await enqueueAdminNotification({
      matchId: matchIdNumber,
      type,
      title,
      message,
      payload: fallbackPayload,
    });

    if (fallbackResult.ok) {
      return { ok: true, reason: 'admin_fallback' };
    }

    return {
      ok: false,
      reason: fallbackReason,
      error: sourceError || fallbackResult.error || null,
      fallback: fallbackResult,
    };
  };

  try {
    const { error } = await supabase.rpc('enqueue_match_participant_notification', {
      p_partido_id: matchIdNumber,
      p_type: type,
      p_title: title,
      p_message: message,
      p_payload: payload,
      p_exclude_user_id: excludeUserId || null,
      p_include_admin: includeAdmin,
    });

    if (error) {
      console.warn('[JOIN_NOTIFICATIONS] enqueue_match_participant_notification failed', {
        matchId: matchIdNumber,
        type,
        code: error.code,
        message: error.message,
      });
      return await fallbackToAdminNotification('rpc_error', error);
    }

    return { ok: true };
  } catch (error) {
    console.warn('[JOIN_NOTIFICATIONS] unexpected participant notification error', {
      matchId: matchIdNumber,
      type,
      error: error?.message || String(error),
    });
    return await fallbackToAdminNotification('unexpected_error', error);
  }
};

export const notifyAdminJoinRequest = async ({
  matchId,
  requestId,
  requesterUserId,
  requesterName,
}) => {
  const name = normalizeName(requesterName, 'Un jugador');
  const matchIdNumber = toMatchId(matchId);
  if (!matchIdNumber) return { ok: false, reason: 'invalid_match_id' };

  return enqueueAdminNotification({
    matchId: matchIdNumber,
    type: 'match_join_request',
    title: 'Nueva solicitud para unirse',
    message: `${name} pidió unirse al partido.`,
    payload: {
      match_id: matchIdNumber,
      matchId: matchIdNumber,
      requestId: requestId || null,
      request_user_id: requesterUserId || null,
      requester_name: name,
      link: `/admin/${matchIdNumber}?tab=solicitudes`,
    },
  });
};

export const notifyAdminPlayerJoined = async ({
  matchId,
  playerName,
  playerUserId = null,
  joinedVia = 'invite_link',
}) => {
  const name = normalizeName(playerName, 'Un jugador');
  const matchIdNumber = toMatchId(matchId);
  if (!matchIdNumber) return { ok: false, reason: 'invalid_match_id' };

  return enqueueParticipantNotification({
    matchId: matchIdNumber,
    type: 'match_update',
    title: 'Nuevo jugador en el partido',
    message: `${name} se sumó al partido.`,
    payload: {
      match_id: matchIdNumber,
      matchId: matchIdNumber,
      player_name: name,
      player_user_id: playerUserId || null,
      joined_via: joinedVia,
      link: `/partido-publico/${matchIdNumber}`,
    },
    excludeUserId: playerUserId || null,
    includeAdmin: true,
  });
};

export default {
  notifyAdminJoinRequest,
  notifyAdminPlayerJoined,
};
