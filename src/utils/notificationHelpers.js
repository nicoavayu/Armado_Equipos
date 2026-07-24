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

  const { error } = await supabase.from('notifications').insert([legacyRow]);
  if (error) throw error;
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

// Crear notificación de invitación a partido.
// La vía real de invitaciones usa la RPC SECURITY DEFINER `send_match_invite`
// (ver InviteToMatchModal/InviteAmigosModal). Este helper legacy queda como
// inserción directa (cubierta por la policy interina de Stage A).
export const createMatchInviteNotification = async (recipientId, inviterName, matchData) => {
  const notification = {
    user_id: recipientId,
    type: 'match_invite',
    title: 'Invitación a partido',
    message: `${inviterName} te invitó a jugar el ${new Date(matchData.fecha).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })} a las ${matchData.hora}`,
    data: {
      matchId: matchData.id,
      matchName: matchData.nombre,
      matchDate: matchData.fecha,
      matchTime: matchData.hora,
      matchLocation: matchData.sede,
      inviterName,
    },
    read: false,
  };

  const { error } = await supabase.from('notifications').insert([notification]);
  if (error) throw error;
};
