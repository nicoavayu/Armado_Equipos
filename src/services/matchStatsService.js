import { supabase } from '../supabase';

// Process match stats 1 hour after match end
export const processMatchStats = async (partidoId) => {
  try {
    console.log('[MATCH_STATS] Processing stats for match:', partidoId);
    
    // Get match players
    const { data: jugadores, error: playersError } = await supabase
      .from('jugadores')
      .select('usuario_id, nombre')
      .eq('partido_id', partidoId)
      .not('usuario_id', 'is', null);
      
    if (playersError) throw playersError;
    
    // Get surveys to check for absent players
    const { data: surveys, error: surveysError } = await supabase
      .from('post_match_surveys')
      .select('jugadores_ausentes')
      .eq('partido_id', partidoId);
      
    if (surveysError) throw surveysError;
    
    // Collect all absent players from surveys
    const absentPlayersSet = new Set();
    (surveys || []).forEach((survey) => {
      if (survey.jugadores_ausentes && Array.isArray(survey.jugadores_ausentes)) {
        survey.jugadores_ausentes.forEach((playerId) => {
          absentPlayersSet.add(playerId);
        });
      }
    });
    
    const updates = [];
    
    // Process each player
    for (const jugador of jugadores || []) {
      const isAbsent = absentPlayersSet.has(jugador.usuario_id);
      
      if (isAbsent) {
        // Player was absent - increment partidos_abandonados
        updates.push(
          supabase
            .from('usuarios')
            .update({ partidos_abandonados: supabase.raw('COALESCE(partidos_abandonados, 0) + 1') })
            .eq('id', jugador.usuario_id),
        );
      } else {
        // Player participated - increment partidos_jugados
        updates.push(
          supabase
            .from('usuarios')
            .update({ partidos_jugados: supabase.raw('COALESCE(partidos_jugados, 0) + 1') })
            .eq('id', jugador.usuario_id),
        );
      }
    }
    
    // Execute all updates
    if (updates.length > 0) {
      const results = await Promise.all(updates);
      const errors = results.filter((r) => r.error);
      
      if (errors.length > 0) {
        console.error('[MATCH_STATS] Update errors:', errors);
        throw new Error(`Failed to update ${errors.length} player stats`);
      }
    }
    
    console.log('[MATCH_STATS] Updated stats for', updates.length, 'players');
    return { playersUpdated: updates.length };
    
  } catch (error) {
    console.error('[MATCH_STATS] Error processing match stats:', error);
    throw error;
  }
};

// Increment partidos_abandonados when player leaves match
export const incrementPartidosAbandonados = async (userId) => {
  try {
    const { error } = await supabase
      .from('usuarios')
      .update({ partidos_abandonados: supabase.raw('COALESCE(partidos_abandonados, 0) + 1') })
      .eq('id', userId);
      
    if (error) throw error;
    console.log('[MATCH_STATS] Incremented partidos_abandonados for user:', userId);
    
  } catch (error) {
    console.error('[MATCH_STATS] Error incrementing partidos_abandonados:', error);
    throw error;
  }
};