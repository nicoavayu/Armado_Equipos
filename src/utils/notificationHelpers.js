import { supabase } from '../supabase';

// Crear notificación de invitación a partido
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

  const { error } = await supabase
    .from('notifications')
    .insert([notification]);

  if (error) throw error;
};

// Crear notificación de solicitud de amistad
export const createFriendRequestNotification = async (recipientId, requesterName) => {
  const notification = {
    user_id: recipientId,
    type: 'friend_request',
    title: 'Solicitud de amistad',
    message: `${requesterName} te envió una solicitud de amistad`,
    data: {
      requesterName,
    },
    read: false,
  };

  const { error } = await supabase
    .from('notifications')
    .insert([notification]);

  if (error) throw error;
};

// Crear notificación de amistad aceptada
export const createFriendAcceptedNotification = async (recipientId, accepterName) => {
  const notification = {
    user_id: recipientId,
    type: 'friend_accepted',
    title: 'Solicitud aceptada',
    message: `${accepterName} aceptó tu solicitud de amistad`,
    data: {
      accepterName,
    },
    read: false,
  };

  const { error } = await supabase
    .from('notifications')
    .insert([notification]);

  if (error) throw error;
};

// Crear notificación de actualización de partido
export const createMatchUpdateNotification = async (recipientId, matchData, updateType) => {
  let title, message;

  switch (updateType) {
    case 'cancelled':
      title = 'Partido cancelado';
      message = `¡Atención! El partido ha sido cancelado`;
      break;
    case 'rescheduled':
      title = 'Partido reprogramado';
      message = `¡Atención! El partido ha sido reprogramado`;
      break;
    case 'location_changed':
      title = 'Cambio de sede';
      message = `¡Cambio de planes! La sede ha cambiado a ${matchData.sede}`;
      break;
    default:
      title = 'Actualización de partido';
      message = `¡Atención! El partido ha sido actualizado`;
  }

  const notification = {
    user_id: recipientId,
    type: 'match_update',
    title,
    message,
    data: {
      matchId: matchData.id,
      matchName: matchData.nombre,
      updateType,
    },
    read: false,
  };

  const { error } = await supabase
    .from('notifications')
    .insert([notification]);

  if (error) throw error;
};