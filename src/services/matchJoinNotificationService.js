import { supabase } from '../supabase';

const normalizeName = (value, fallback = 'Un jugador') => {
  const raw = String(value || '').trim();
  return raw || fallback;
};

const toMatchId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeUserId = (value) => {
  const raw = String(value || '').trim();
  return raw || null;
};

const resolveNotificationRecipients = async ({
  matchId,
  includeParticipants = false,
  includeAdmin = true,
  excludeUserId = null,
  adminUserId = null,
}) => {
  const matchIdNumber = toMatchId(matchId);
  if (!matchIdNumber) return [];

  const recipients = new Set();
  const normalizedExclude = normalizeUserId(excludeUserId);
  const normalizedAdminFromArgs = normalizeUserId(adminUserId);

  if (includeAdmin && normalizedAdminFromArgs && normalizedAdminFromArgs !== normalizedExclude) {
    recipients.add(normalizedAdminFromArgs);
  }

  try {
    const [{ data: matchRow }, participantRowsResult] = await Promise.all([
      supabase
        .from('partidos')
        .select('creado_por')
        .eq('id', matchIdNumber)
        .maybeSingle(),
      includeParticipants
        ? supabase
          .from('jugadores')
          .select('usuario_id')
          .eq('partido_id', matchIdNumber)
          .not('usuario_id', 'is', null)
        : Promise.resolve({ data: [] }),
    ]);

    if (includeAdmin) {
      const adminId = normalizeUserId(matchRow?.creado_por);
      if (adminId && adminId !== normalizedExclude) {
        recipients.add(adminId);
      }
    }

    (participantRowsResult?.data || []).forEach((row) => {
      const recipientId = normalizeUserId(row?.usuario_id);
      if (!recipientId || recipientId === normalizedExclude) return;
      recipients.add(recipientId);
    });
  } catch (error) {
    console.warn('[JOIN_NOTIFICATIONS] resolveNotificationRecipients failed', {
      matchId: matchIdNumber,
      includeParticipants,
      includeAdmin,
      error: error?.message || String(error),
    });
    return [];
  }

  return Array.from(recipients);
};

const directInsertNotifications = async ({
  matchId,
  type,
  title,
  message,
  payload = {},
  recipients = [],
}) => {
  const matchIdNumber = toMatchId(matchId);
  if (!matchIdNumber || !Array.isArray(recipients) || recipients.length === 0) {
    return { ok: false, reason: 'no_recipients' };
  }

  const nowIso = new Date().toISOString();
  const notifications = recipients.map((recipientId) => ({
    user_id: recipientId,
    partido_id: matchIdNumber,
    type,
    title: title || 'Notificación de partido',
    message: message || 'Tienes una nueva notificación',
    data: payload,
    read: false,
    created_at: nowIso,
  }));

  try {
    const { error } = await supabase
      .from('notifications')
      .insert(notifications);

    if (error) {
      console.warn('[JOIN_NOTIFICATIONS] direct insert fallback failed', {
        matchId: matchIdNumber,
        type,
        recipients: recipients.length,
        code: error.code,
        message: error.message,
      });
      return { ok: false, reason: 'direct_insert_error', error };
    }

    return { ok: true, reason: 'direct_insert' };
  } catch (error) {
    console.warn('[JOIN_NOTIFICATIONS] direct insert fallback exception', {
      matchId: matchIdNumber,
      type,
      recipients: recipients.length,
      error: error?.message || String(error),
    });
    return { ok: false, reason: 'direct_insert_exception', error };
  }
};

const enqueueAdminNotification = async ({
  matchId,
  type,
  title,
  message,
  payload = {},
  adminUserId = null,
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

      const recipients = await resolveNotificationRecipients({
        matchId: matchIdNumber,
        includeParticipants: false,
        includeAdmin: true,
        adminUserId,
      });
      const fallbackResult = await directInsertNotifications({
        matchId: matchIdNumber,
        type,
        title,
        message,
        payload: {
          ...payload,
          direct_insert_fallback: true,
          direct_insert_reason: 'enqueue_partido_notification_rpc_error',
        },
        recipients,
      });

      if (fallbackResult.ok) return { ok: true, reason: fallbackResult.reason };
      return { ok: false, reason: 'rpc_error', error };
    }

    return { ok: true };
  } catch (error) {
    console.warn('[JOIN_NOTIFICATIONS] unexpected error', {
      matchId: matchIdNumber,
      type,
      error: error?.message || String(error),
    });

    const recipients = await resolveNotificationRecipients({
      matchId: matchIdNumber,
      includeParticipants: false,
      includeAdmin: true,
      adminUserId,
    });
    const fallbackResult = await directInsertNotifications({
      matchId: matchIdNumber,
      type,
      title,
      message,
      payload: {
        ...payload,
        direct_insert_fallback: true,
        direct_insert_reason: 'enqueue_partido_notification_unexpected_error',
      },
      recipients,
    });

    if (fallbackResult.ok) return { ok: true, reason: fallbackResult.reason };
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
  adminUserId = null,
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
      adminUserId,
    });

    if (fallbackResult.ok) {
      return { ok: true, reason: 'admin_fallback' };
    }

    const recipients = await resolveNotificationRecipients({
      matchId: matchIdNumber,
      includeParticipants: true,
      includeAdmin,
      excludeUserId,
      adminUserId,
    });
    const directResult = await directInsertNotifications({
      matchId: matchIdNumber,
      type,
      title,
      message,
      payload: {
        ...fallbackPayload,
        direct_insert_fallback: true,
        direct_insert_reason: fallbackReason,
      },
      recipients,
    });
    if (directResult.ok) {
      return { ok: true, reason: 'direct_insert_fallback' };
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
  adminUserId = null,
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
    adminUserId,
  });
};

export const notifyAdminPlayerJoined = async ({
  matchId,
  playerName,
  playerUserId = null,
  joinedVia = 'invite_link',
  adminUserId = null,
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
    adminUserId,
  });
};

export default {
  notifyAdminJoinRequest,
  notifyAdminPlayerJoined,
};
