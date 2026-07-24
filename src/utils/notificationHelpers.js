import { supabase } from '../supabase';
import { isMissingRpcError } from './backendFallback';

// Central, secure notification insert used across the app.
//
// Primary path: the SECURITY DEFINER RPC `create_notification`, which validates
// the sender↔recipient relationship server-side and GENERATES type/title/
// message/data from typed IDs (never trusts client free text).
//
// Fallback: a direct insert of `legacyRow`, used ONLY when the RPC is not
// deployed yet (PGRST202). After Stage B this fallback is rejected by RLS —
// by then the RPC is the primary path. Any non-missing error is surfaced.
//
// @param {{ type: string, recipientId: string, context?: object, legacyRow: object }} args
export const insertNotificationSecure = async ({ type, recipientId, context = {}, legacyRow }) => {
  const { error: rpcError } = await supabase.rpc('create_notification', {
    p_type: type,
    p_recipient_id: recipientId,
    p_context: context,
  });

  if (!rpcError) return;

  if (!isMissingRpcError(rpcError)) {
    throw rpcError;
  }

  // SEC: routed-helper — this direct insert is the create_notification fallback
  // and runs ONLY when that RPC is not deployed yet (PGRST202). Once Stage B is
  // applied the RPC is the primary path, so this branch is never reached.
  const { error } = await supabase.from('notifications').insert([legacyRow]);
  if (error) throw error;
};

// Route several notifications through the secure path (best-effort per item:
// one failing recipient does not abort the rest). Each item is
// { type, recipientId, context, legacyRow }. Returns counts for logging.
export const insertNotificationsSecure = async (items = []) => {
  let sent = 0;
  const errors = [];
  for (const item of items) {
    if (!item?.recipientId) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await insertNotificationSecure(item);
      sent += 1;
    } catch (error) {
      errors.push(error);
    }
  }
  return { sent, errors };
};

// NOTE: the helpers below are legacy (referenced only by docs). They now route
// through the secure path so any future use stays safe.

// Crear notificación de solicitud de amistad
export const createFriendRequestNotification = async (recipientId, requesterName) => {
  await insertNotificationSecure({
    type: 'friend_request',
    recipientId,
    context: {},
    legacyRow: {
      user_id: recipientId,
      type: 'friend_request',
      title: 'Solicitud de amistad',
      message: `${requesterName} te envió una solicitud de amistad`,
      data: { requesterName },
      read: false,
    },
  });
};

// Crear notificación de amistad aceptada
export const createFriendAcceptedNotification = async (recipientId, accepterName) => {
  await insertNotificationSecure({
    type: 'friend_accepted',
    recipientId,
    context: {},
    legacyRow: {
      user_id: recipientId,
      type: 'friend_accepted',
      title: 'Solicitud aceptada',
      message: `${accepterName} aceptó tu solicitud de amistad`,
      data: { accepterName },
      read: false,
    },
  });
};

// Crear notificación de actualización de partido
export const createMatchUpdateNotification = async (recipientId, matchData, updateType) => {
  await insertNotificationSecure({
    type: 'match_update',
    recipientId,
    context: { match_id: matchData?.id },
    legacyRow: {
      user_id: recipientId,
      type: 'match_update',
      title: 'Actualización de partido',
      message: '¡Atención! El partido ha sido actualizado',
      data: { matchId: matchData?.id, matchName: matchData?.nombre, updateType },
      read: false,
    },
  });
};
