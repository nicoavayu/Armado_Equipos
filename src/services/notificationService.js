import { supabase } from '../supabase';
import { processMatchStats } from './matchStatsService';

// === TEST HELPER ===
// Fuerza todas las notis survey_results_ready (pendientes) de un partido a scheduled_for = ahora
export const forceSurveyResultsNow = async (partidoId) => {
  const nowIso = new Date().toISOString();
  // Traer pendientes del partido
  const { data: pending, error: fetchErr } = await supabase
    .from('notifications')
    .select('id, data')
    .eq('type', 'survey_results_ready')
    .eq('read', false)
    .contains('data', { matchId: partidoId });
  if (fetchErr) throw fetchErr;
  if (!pending || pending.length === 0) return { updated: 0 };

  // Actualizar cada fila seteando scheduled_for = now
  let updated = 0;
  for (const n of pending) {
    const newData = { ...(n.data || {}), scheduled_for: nowIso };
    const { error: upErr } = await supabase
      .from('notifications')
      .update({ data: newData })
      .eq('id', n.id);
    if (!upErr) updated += 1;
  }
  return { updated };
};

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
      .in('type', ['post_match_survey', 'process_match_stats', 'survey_results_ready'])
      .or('read.eq.false,status.eq.pending'); // aceptar ambos esquemas
      
    if (fetchError) throw fetchError;
    
    // Listas si:
    // - NUEVO: data.scheduled_for <= now y read=false
    // - VIEJO: send_at <= now y status='pending'
    const readyNotifications = (pendingNotifications || []).filter((n) => {
      const scheduledNew = n?.data?.scheduled_for;
      const scheduledOld = n?.send_at;
      const isNewReady = n?.read === false && scheduledNew && new Date(scheduledNew) <= new Date(now);
      const isOldReady = n?.status === 'pending' && scheduledOld && new Date(scheduledOld) <= new Date(now);
      return isNewReady || isOldReady;
    });
    
    for (const notification of readyNotifications) {
      if (notification.type === 'process_match_stats') {
        await processMatchStats(notification.data.partido_id);
        // Marcar procesado (ambos esquemas)
        const patch = notification.status === 'pending'
          ? { status: 'sent' }
          : { read: true };
        await supabase.from('notifications').update(patch).eq('id', notification.id);
      } else if (notification.type === 'survey_results_ready') {
        // Enviar al usuario (push / toast / lo que uses) y marcar como enviada
        await sendNotificationToUser(notification);
        const patch = notification.status === 'pending'
          ? { status: 'sent', read: true }
          : { read: true };
        await supabase.from('notifications').update(patch).eq('id', notification.id);
      } else {
        await sendNotificationToUser(notification);
        const patch = notification.status === 'pending'
          ? { status: 'sent', read: true }
          : { read: true };
        await supabase.from('notifications').update(patch).eq('id', notification.id);
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