import { supabase } from '../supabase';
import { logger } from '../lib/logger';

/**
 * Incrementa partidos_jugados cuando empieza un partido
 */
export const incrementMatchesPlayed = async (partidoId) => {
  try {
    logger.log('[MATCH_STATS] Incrementing matches played for partido:', { partidoId });
    
    // Obtener jugadores del partido
    const { data: partido, error: partidoError } = await supabase
      .from('partidos')
      .select('jugadores')
      .eq('id', partidoId)
      .single();
    
    if (partidoError || !partido?.jugadores) {
      logger.error('[MATCH_STATS] Error getting partido:', partidoError);
      return;
    }
    
    // Incrementar partidos_jugados para cada jugador
    for (const jugador of partido.jugadores) {
      const userId = jugador.usuario_id || jugador.id;
      if (userId) {
        const { error } = await supabase.rpc('increment_matches_played', {
          user_id: userId,
        });
        
        if (error) {
          logger.error('[MATCH_STATS] Error incrementing matches played for user:', { userId, error: encodeURIComponent(error?.message || '') });
        } else {
          logger.log('[MATCH_STATS] Incremented matches played for user:', { userId });
        }
      }
    }
  } catch (error) {
    logger.error('[MATCH_STATS] Error in incrementMatchesPlayed:', error);
  }
};

/**
 * Incrementa partidos_abandonados cuando un jugador se baja 4h antes
 */
export const incrementMatchesAbandoned = async (userId) => {
  try {
    logger.log('[MATCH_STATS] Incrementing matches abandoned for user:', { userId });
    
    const { error } = await supabase.rpc('increment_matches_abandoned', {
      user_id: userId,
    });
    
    if (error) {
      logger.error('[MATCH_STATS] Error incrementing matches abandoned:', { error: encodeURIComponent(error?.message || '') });
    } else {
      logger.log('[MATCH_STATS] Incremented matches abandoned for user:', { userId });
    }
  } catch (error) {
    logger.error('[MATCH_STATS] Error in incrementMatchesAbandoned:', error);
  }
};

/**
 * Procesa ausencia sin aviso desde encuesta: -1 PJ, +1 PA, -0.3 ranking
 */
export const processAbsenceWithoutNotice = async (userId, partidoId, voterId) => {
  try {
    logger.log('[MATCH_STATS] Processing absence without notice:', { userId, partidoId, voterId });
    
    // Skip duplicate check - process absence penalty directly
    
    // Obtener stats actuales
    const { data: user, error: userError } = await supabase
      .from('usuarios')
      .select('partidos_jugados, partidos_abandonados, ranking')
      .eq('id', userId)
      .single();
    
    if (userError) {
      logger.error('[MATCH_STATS] Error getting user stats:', { error: encodeURIComponent(userError?.message || '') });
      return;
    }
    
    const newMatchesPlayed = Math.max(0, (user.partidos_jugados || 0) - 1);
    const newMatchesAbandoned = (user.partidos_abandonados || 0) + 1;
    const newRanking = Math.max(1.0, Math.min(10.0, (user.ranking || 5.0) - 0.3));
    
    // Actualizar stats
    const { error: updateError } = await supabase
      .from('usuarios')
      .update({
        partidos_jugados: newMatchesPlayed,
        partidos_abandonados: newMatchesAbandoned,
        ranking: newRanking,
      })
      .eq('id', userId);
    
    if (updateError) {
      logger.error('[MATCH_STATS] Error updating user stats:', { error: encodeURIComponent(updateError?.message || '') });
      return;
    }
    
    // Registrar la penalización para evitar duplicados
    const { error: penaltyError } = await supabase
      .from('player_awards')
      .insert({
        jugador_id: userId,
        partido_id: partidoId,
        award_type: 'absence_penalty',
      });
    
    if (penaltyError) {
      logger.error('[MATCH_STATS] Error recording absence penalty:', { error: encodeURIComponent(penaltyError?.message || '') });
    } else {
      logger.log('[MATCH_STATS] Processed absence without notice successfully:', {
        userId,
        newMatchesPlayed,
        newMatchesAbandoned,
        newRanking,
      });
    }
  } catch (error) {
    logger.error('[MATCH_STATS] Error in processAbsenceWithoutNotice:', { error: encodeURIComponent(error?.message || '') });
  }
};

/**
 * Verifica si un jugador puede abandonar sin penalización (más de 4h antes)
 */
export const canAbandonWithoutPenalty = (partidoFecha, partidoHora) => {
  try {
    const now = new Date();
    const matchDateTime = new Date(`${partidoFecha}T${partidoHora}`);
    const hoursUntilMatch = (matchDateTime - now) / (1000 * 60 * 60);
    
    return hoursUntilMatch > 4;
  } catch (error) {
    logger.error('[MATCH_STATS] Error calculating time until match:', { error: encodeURIComponent(error?.message || '') });
    return false;
  }
};