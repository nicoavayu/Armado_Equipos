import { supabase } from '../supabase';

/**
 * Checks if a match has finished and sends survey notifications
 * @param {Object} partido - The match object
 * @returns {Promise<boolean>} - True if notifications were sent
 */
export const checkAndNotifyMatchFinish = async (partido) => {
  if (!partido || !partido.fecha || !partido.hora) return false;
  
  try {
    const [hours, minutes] = partido.hora.split(':').map(Number);
    const partidoDateTime = new Date(partido.fecha);
    partidoDateTime.setHours(hours, minutes, 0, 0);
    const now = new Date();
    
    // Check if match just finished (within last 5 minutes)
    const timeDiff = now - partidoDateTime;
    const justFinished = timeDiff >= 0 && timeDiff <= 5 * 60 * 1000;
    
    if (!justFinished) return false;
    
    // Get all players in the match
    const { data: jugadores, error: playersError } = await supabase
      .from('jugadores')
      .select('usuario_id, nombre')
      .eq('partido_id', partido.id)
      .not('usuario_id', 'is', null);
      
    if (playersError) throw playersError;
    if (!jugadores || jugadores.length === 0) return false;
    
    // Create survey notifications for each player
    const notifications = jugadores.map((jugador) => ({
      user_id: jugador.usuario_id,
      type: 'post_match_survey',
      title: '¡Encuesta lista!',
      message: `La encuesta ya está lista para completar sobre el partido ${partido.nombre || formatMatchDate(partido.fecha)}.`,
      data: {
        partido_id: partido.id,
        partido_nombre: partido.nombre,
        partido_fecha: partido.fecha,
        partido_hora: partido.hora,
        partido_sede: partido.sede
      },
      read: false
    }));
    
    // Insert notifications
    const { error: insertError } = await supabase
      .from('notifications')
      .insert(notifications);
      
    if (insertError) throw insertError;
    
    console.log(`Sent ${notifications.length} survey notifications for finished match ${partido.id}`);
    return true;
    
  } catch (error) {
    console.error('Error checking and notifying match finish:', error);
    return false;
  }
};

/**
 * Clears a match from user's upcoming matches list
 * @param {string} userId - User ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} - Success status
 */
export const clearMatchFromList = async (userId, partidoId) => {
  if (!userId || !partidoId) return false;
  
  try {
    const { error } = await supabase
      .from('cleared_matches')
      .insert([{
        user_id: userId,
        partido_id: partidoId
      }]);
      
    if (error) {
      if (error.message && error.message.includes('relation "public.cleared_matches" does not exist')) {
        console.log('cleared_matches table not found, cannot clear match');
        return false;
      }
      console.log('cleared_matches table not found, cannot clear match');
      return false;
    }
    
    console.log(`Match ${partidoId} cleared from user ${userId}'s list`);
    return true;
    
  } catch (error) {
    console.error('Error clearing match from list:', error);
    return false;
  }
};

/**
 * Checks if a match has been cleared by a user
 * @param {string} userId - User ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} - True if match was cleared
 */
export const isMatchCleared = async (userId, partidoId) => {
  if (!userId || !partidoId) return false;
  
  try {
    const { data, error } = await supabase
      .from('cleared_matches')
      .select('id')
      .eq('user_id', userId)
      .eq('partido_id', partidoId)
      .single();
      
    if (error && error.code !== 'PGRST116') throw error;
    
    return !!data;
    
  } catch (error) {
    console.error('Error checking if match is cleared:', error);
    return false;
  }
};

/**
 * Formats match date for display
 * @param {string} fecha - Date string
 * @returns {string} - Formatted date
 */
const formatMatchDate = (fecha) => {
  try {
    return new Date(fecha).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'numeric'
    });
  } catch {
    return fecha;
  }
};