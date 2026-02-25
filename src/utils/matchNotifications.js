import { supabase } from '../supabase';

/**
 * Crea notificaciones para llamar a votar a todos los jugadores de un partido
 * @param {Object} matchData - Datos del partido
 * @returns {Promise<Array>} - Array de notificaciones creadas o array vacío si hay error
 */
export const createCallToVoteNotifications = async (matchData) => {
  if (!matchData?.id) return [];
  
  try {
    // Obtener IDs de usuarios únicos de los participantes del partido
    const recipients = (matchData.jugadores || [])
      .filter((jugador) => jugador.usuario_id && !jugador.usuario_id.startsWith('guest_'))
      .map((jugador) => jugador.usuario_id);
    
    // incluir admin sí o sí
    const adminUserId = matchData.creado_por;
    if (adminUserId && !recipients.includes(adminUserId)) {
      recipients.push(adminUserId);
    }
    
    // si quedó vacío (partido chico), al menos el admin
    if (recipients.length === 0 && adminUserId) {
      recipients.push(adminUserId);
    }
    
    if (recipients.length === 0) return [];
    
    // construir payload (usar nombres de columnas REALES de la tabla)
    const rows = recipients.map((user_id) => ({
      user_id,
      type: 'pre_match_vote',
      title: '¡Armemos los equipos!',
      message: 'Calificá a los jugadores para armar el partido más parejo.',
      data: {
        target_route: 'voting_view',
        target_params: { partido_id: matchData.id },
        action: { label: 'Ir a Voting View', route: 'voting_view' },
        matchId: matchData.id,
        matchCode: matchData.codigo,
        matchDate: matchData.fecha,
        matchTime: matchData.hora,
        matchVenue: matchData.sede,
      },
      read: false,
    }));

    const { data, error } = await supabase
      .from('notifications')
      .insert(rows)
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
    
    // Notificar encuesta al instante cuando termina el partido (inicio + 1h por defecto)
    const notificationTime = new Date(matchDate.getTime() + 60 * 60 * 1000);
    
    // Actualizar el partido con la hora de finalización y programación de encuesta
    const { error: updateError } = await supabase
      .from('partidos')
      .update({ 
        hora_fin: new Date(matchDate.getTime() + 60 * 60 * 1000).toISOString(),
        survey_scheduled: true,
        survey_time: notificationTime.toISOString(),
      })
      .eq('id', matchData.id);
      
    if (updateError) throw updateError;
    
    return true;
  } catch (error) {
    console.error('Error programando notificaciones de encuesta post-partido:', error);
    return false;
  }
};
