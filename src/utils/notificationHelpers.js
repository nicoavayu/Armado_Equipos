import { supabase } from '../supabase';

/**
 * Create a match invitation notification for a user
 * @param {string} userId - User ID to send notification to
 * @param {string} senderName - Name of the person sending the invitation
 * @param {object} matchData - Data about the match
 * @returns {Promise<object>} - Created notification or null if error
 */
export const createMatchInviteNotification = async (userId, senderName, matchData) => {
  if (!userId || !matchData?.id) return null;
  
  try {
    const notification = {
      user_id: userId,
      type: 'match_invite',
      title: 'Invitación a partido',
      message: `${senderName || 'Alguien'} te ha invitado a un partido`,
      data: {
        matchId: matchData.id,
        matchCode: matchData.codigo,
        matchDate: matchData.fecha,
        matchTime: matchData.hora,
        matchVenue: matchData.sede
      },
      read: false,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('notifications')
      .insert([notification])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating match invite notification:', error);
    return null;
  }
};

/**
 * Create a match update notification for all participants
 * @param {object} matchData - Data about the match
 * @param {string} updateType - Type of update (e.g., 'teams_created', 'match_cancelled')
 * @param {string} message - Message to display in the notification
 * @returns {Promise<Array>} - Array of created notifications or empty array if error
 */
export const createMatchUpdateNotification = async (matchData, updateType, message) => {
  if (!matchData?.id || !matchData?.jugadores) return [];
  
  try {
    // Get unique user IDs from the match participants
    const userIds = matchData.jugadores
      .filter(jugador => jugador.uuid && !jugador.uuid.startsWith('guest_'))
      .map(jugador => jugador.uuid);
    
    if (userIds.length === 0) return [];
    
    // Create notifications for all participants
    const notifications = userIds.map(userId => ({
      user_id: userId,
      type: 'match_update',
      title: 'Actualización de partido',
      message,
      data: {
        matchId: matchData.id,
        matchCode: matchData.codigo,
        updateType,
        matchDate: matchData.fecha,
        matchTime: matchData.hora,
        matchVenue: matchData.sede
      },
      read: false,
      created_at: new Date().toISOString()
    }));

    const { data, error } = await supabase
      .from('notifications')
      .insert(notifications)
      .select();

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error creating match update notifications:', error);
    return [];
  }
};

/**
 * Mark all notifications of a specific type as read
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @returns {Promise<boolean>} - Success status
 */
export const markNotificationTypeAsRead = async (userId, type) => {
  if (!userId || !type) return false;
  
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('type', type)
      .eq('read', false);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Error marking ${type} notifications as read:`, error);
    return false;
  }
};