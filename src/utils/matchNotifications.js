import { supabase } from '../supabase';

/**
 * Crea notificaciones para llamar a votar a todos los jugadores de un partido
 * @param {Object} matchData - Datos del partido
 * @returns {Promise<Array>} - Array de notificaciones creadas o array vacío si hay error
 */
export const createCallToVoteNotifications = async (matchData) => {
  if (!matchData?.id || !matchData?.jugadores) return [];
  
  try {
    // Obtener IDs de usuarios únicos de los participantes del partido
    const userIds = matchData.jugadores
      .filter(jugador => jugador.uuid && !jugador.uuid.startsWith('guest_'))
      .map(jugador => jugador.uuid);
    
    if (userIds.length === 0) return [];
    
    // Crear notificaciones para todos los participantes
    const notifications = userIds.map(userId => ({
      user_id: userId,
      type: 'call_to_vote',
      title: '¡Hora de votar!',
      message: `Ya podés calificar a los jugadores del partido ${matchData.nombre || 'actual'}.`,
      data: {
        matchId: matchData.id,
        matchCode: matchData.codigo,
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
    console.error('Error creando notificaciones de llamado a votar:', error);
    return [];
  }
};

/**
 * Crea notificaciones para la encuesta post-partido una hora después de finalizado
 * @param {Object} matchData - Datos del partido
 * @returns {Promise<boolean>} - True si se crearon las notificaciones, false si hubo error
 */
export const schedulePostMatchSurveyNotifications = async (matchData) => {
  if (!matchData?.id || !matchData?.jugadores) return false;
  
  try {
    // Calcular la hora de finalización del partido (hora de inicio + 1 hora por defecto)
    const matchTime = matchData.hora || '19:00';
    const [hours, minutes] = matchTime.split(':').map(Number);
    
    const matchDate = matchData.fecha ? new Date(matchData.fecha) : new Date();
    matchDate.setHours(hours, minutes, 0, 0);
    
    // Agregar duración del partido (1 hora por defecto) + 1 hora para la notificación
    const notificationTime = new Date(matchDate.getTime() + 2 * 60 * 60 * 1000);
    
    // Actualizar el partido con la hora de finalización y programación de encuesta
    const { error: updateError } = await supabase
      .from('partidos')
      .update({ 
        hora_fin: new Date(matchDate.getTime() + 60 * 60 * 1000).toISOString(),
        survey_scheduled: true,
        survey_time: notificationTime.toISOString()
      })
      .eq('id', matchData.id);
      
    if (updateError) throw updateError;
    
    return true;
  } catch (error) {
    console.error('Error programando notificaciones de encuesta post-partido:', error);
    return false;
  }
};