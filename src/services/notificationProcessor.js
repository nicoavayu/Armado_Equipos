import { supabase } from '../supabase';

/**
 * Procesa notificaciones programadas que ya están listas para enviar
 */
export const processScheduledNotifications = async () => {
  try {
    const now = new Date().toISOString();
    
    // Buscar notificaciones programadas que ya están listas
    const { data: scheduledNotifications, error: fetchError } = await supabase
      .from('notifications')
      .select('*')
      .eq('type', 'survey_results')
      .eq('read', false)
      .lte('created_at', now); // Notificaciones cuyo tiempo ya llegó
    
    if (fetchError) {
      console.error('[NOTIFICATION_PROCESSOR] Error fetching scheduled notifications:', fetchError);
      return;
    }
    
    if (!scheduledNotifications || scheduledNotifications.length === 0) {
      return;
    }
    
    console.log('[NOTIFICATION_PROCESSOR] Found', scheduledNotifications.length, 'ready notifications');
    
    // Agrupar por partido para evitar duplicados
    const notificationsByMatch = {};
    scheduledNotifications.forEach((notification) => {
      const partidoId = notification.data?.partido_id;
      if (partidoId) {
        if (!notificationsByMatch[partidoId]) {
          notificationsByMatch[partidoId] = [];
        }
        notificationsByMatch[partidoId].push(notification);
      }
    });
    
    // Procesar cada partido
    for (const [partidoId, notifications] of Object.entries(notificationsByMatch)) {
      await processMatchResultsNotifications(parseInt(partidoId), notifications);
    }
    
  } catch (error) {
    console.error('[NOTIFICATION_PROCESSOR] Error processing scheduled notifications:', error);
  }
};

/**
 * Procesa las notificaciones de resultados para un partido específico
 */
const processMatchResultsNotifications = async (partidoId, notifications) => {
  try {
    // Verificar que los resultados estén listos
    const { data: awards, error: awardsError } = await supabase
      .from('player_awards')
      .select('*')
      .eq('partido_id', partidoId);
    
    if (awardsError) {
      console.error('[MATCH_RESULTS] Error fetching awards:', awardsError);
      return;
    }
    
    if (!awards || awards.length === 0) {
      console.log('[MATCH_RESULTS] No awards found for partido:', partidoId);
      // Marcar notificaciones como leídas si no hay resultados
      const notificationIds = notifications.map((n) => n.id);
      await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', notificationIds);
      return;
    }
    
    // Actualizar las notificaciones con los datos de los resultados
    const updatedNotifications = notifications.map((notification) => ({
      ...notification,
      data: {
        ...notification.data,
        awards: awards,
        results_ready: true,
      },
    }));
    
    // Las notificaciones ya están en la base de datos, solo necesitamos que el frontend las procese
    console.log('[MATCH_RESULTS] Results ready for partido:', partidoId, 'awards:', awards.length);
    
  } catch (error) {
    console.error('[MATCH_RESULTS] Error processing match results:', error);
  }
};

/**
 * Obtiene los resultados de un partido para mostrar en la UI
 */
export const getMatchResults = async (partidoId) => {
  try {
    // Obtener premios del partido
    const { data: awards, error: awardsError } = await supabase
      .from('player_awards')
      .select(`
        *,
        jugadores!inner(nombre, avatar_url, foto_url)
      `)
      .eq('partido_id', partidoId);
    
    if (awardsError) throw awardsError;
    
    // Obtener datos del partido
    const { data: partido, error: partidoError } = await supabase
      .from('partidos')
      .select('nombre, fecha, hora, sede')
      .eq('id', partidoId)
      .single();
    
    if (partidoError) throw partidoError;
    
    // Organizar resultados por tipo de premio
    const results = {
      partido: partido,
      mvp: awards.find((a) => a.award_type === 'mvp'),
      guante_dorado: awards.find((a) => a.award_type === 'guante_dorado'),
      tarjetas_rojas: awards.filter((a) => a.award_type === 'tarjeta_roja'),
      total_awards: awards.length,
    };
    
    return results;
    
  } catch (error) {
    console.error('[GET_MATCH_RESULTS] Error:', error);
    return null;
  }
};

/**
 * Marca una notificación de resultados como leída
 */
export const markResultsNotificationAsRead = async (notificationId) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);
    
    if (error) throw error;
    
  } catch (error) {
    console.error('[MARK_NOTIFICATION_READ] Error:', error);
  }
};