import { supabase } from '../supabase';
import { processMatchStats } from './matchStatsService';

// Schedule post-match survey notification
export const schedulePostMatchNotification = async (partidoId) => {
  try {
    const { data: partido, error: matchError } = await supabase
      .from('partidos')
      .select('fecha, hora, id')
      .eq('id', partidoId)
      .single();
      
    if (matchError) throw matchError;
    
    // Calculate notification time (1 hour after match)
    const matchDateTime = new Date(`${partido.fecha}T${partido.hora}`);
    const notificationTime = new Date(matchDateTime.getTime() + 60 * 60 * 1000);
    
    // Get match players
    const { data: jugadores, error: playersError } = await supabase
      .from('jugadores')
      .select('usuario_id, nombre')
      .eq('partido_id', partidoId)
      .not('usuario_id', 'is', null);
      
    if (playersError) throw playersError;
    
    // Create notifications for each player
    const notifications = jugadores.map((jugador) => ({
      user_id: jugador.usuario_id,
      type: 'post_match_survey',
      title: 'Califica el partido',
      message: 'Ya puedes calificar el partido. ¡Tu opinión es importante!',
      data: { partido_id: partidoId, scheduled_for: notificationTime.toISOString() },
      read: false,
    }));
    
    // Also schedule match stats processing
    notifications.push({
      user_id: null,
      type: 'process_match_stats',
      title: 'Process Match Stats',
      message: 'Internal notification to process match statistics',
      data: { partido_id: partidoId, scheduled_for: notificationTime.toISOString() },
      read: false,
    });
    
    const { error: insertError } = await supabase
      .from('notifications')
      .insert(notifications);
      
    if (insertError) throw insertError;
    
    console.log(`Scheduled ${notifications.length} post-match notifications for match ${partidoId}`);
    return { success: true, count: notifications.length };
    
  } catch (error) {
    console.error('Error scheduling post-match notifications:', error);
    throw error;
  }
};

// Check and send pending notifications
export const processPendingNotifications = async () => {
  try {
    const now = new Date().toISOString();
    
    const { data: pendingNotifications, error: fetchError } = await supabase
      .from('notifications')
      .select('*')
      .in('type', ['post_match_survey', 'process_match_stats'])
      .eq('read', false);
      
    if (fetchError) throw fetchError;
    
    const readyNotifications = (pendingNotifications || []).filter((n) => {
      const scheduledTime = n.data?.scheduled_for;
      return scheduledTime && new Date(scheduledTime) <= new Date(now);
    });
    
    for (const notification of readyNotifications) {
      if (notification.type === 'process_match_stats') {
        await processMatchStats(notification.data.partido_id);
        // Mark as processed
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', notification.id);
      } else {
        await sendNotificationToUser(notification);
      }
    }
    
    return { processed: readyNotifications.length };
    
  } catch (error) {
    console.error('Error processing pending notifications:', error);
    throw error;
  }
};

// Send notification to user (placeholder for actual implementation)
const sendNotificationToUser = async (notification) => {
  console.log(`Sending notification to user ${notification.user_id}:`, notification.title);
  // Here you would integrate with your notification system (Firebase, etc.)
};

// Get user notifications
export const getUserNotifications = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    return data || [];
    
  } catch (error) {
    console.error('Error fetching user notifications:', error);
    return [];
  }
};

// Mark notification as read
export const markNotificationAsRead = async (notificationId) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);
      
    if (error) throw error;
    
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};