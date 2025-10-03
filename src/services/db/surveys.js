import { supabase } from '../../lib/supabaseClient';

/**
 * Check if surveys for a match have been processed
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} Whether surveys have been processed
 */
export const checkSurveysProcessed = async (partidoId) => {
  try {
    const { data, error } = await supabase
      .from('partidos')
      .select('surveys_processed')
      .eq('id', partidoId)
      .single();
      
    if (error) throw error;
    return !!data?.surveys_processed;
  } catch (error) {
    console.error('Error checking surveys processed:', error);
    return false;
  }
};

/**
 * Mark surveys as processed for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<void>}
 */
export const markSurveysAsProcessed = async (partidoId) => {
  try {
    const { error } = await supabase
      .from('partidos')
      .update({ surveys_processed: true })
      .eq('id', partidoId);
      
    if (error) throw error;
  } catch (error) {
    console.error('Error marking surveys as processed:', error);
    throw error;
  }
};

/**
 * Process post-match surveys and update player stats (MVP, red cards, ratings)
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Processing results
 */
export const processPostMatchSurveys = async (partidoId) => {
  if (!partidoId) {
    throw new Error('Match ID is required');
  }
  
  console.log('[POST_MATCH] Processing surveys for match:', partidoId);
  
  try {
    // Get all surveys for this match
    const { data: surveys, error: surveysError } = await supabase
      .from('post_match_surveys')
      .select('*')
      .eq('partido_id', partidoId);
      
    if (surveysError) throw surveysError;
    
    if (!surveys || surveys.length === 0) {
      console.log('[POST_MATCH] No surveys found for match:', partidoId);
      return { message: 'No surveys to process' };
    }
    
    console.log('[POST_MATCH] Found', surveys.length, 'surveys');
    
    // Get match players
    const { getJugadoresDelPartido } = await import('./matches');
    const matchPlayers = await getJugadoresDelPartido(partidoId);
    if (!matchPlayers || matchPlayers.length === 0) {
      throw new Error('No players found for this match');
    }
    
    // Process MVP votes (combine both teams)
    const mvpVotes = {};
    surveys.forEach((survey) => {
      if (survey.mejor_jugador_eq_a) {
        mvpVotes[survey.mejor_jugador_eq_a] = (mvpVotes[survey.mejor_jugador_eq_a] || 0) + 1;
      }
      if (survey.mejor_jugador_eq_b) {
        mvpVotes[survey.mejor_jugador_eq_b] = (mvpVotes[survey.mejor_jugador_eq_b] || 0) + 1;
      }
    });
    
    // Process violent player votes
    const violentVotes = {};
    surveys.forEach((survey) => {
      if (survey.jugadores_violentos && Array.isArray(survey.jugadores_violentos)) {
        survey.jugadores_violentos.forEach((playerId) => {
          violentVotes[playerId] = (violentVotes[playerId] || 0) + 1;
        });
      }
    });
    
    // Process absent players with detailed analysis
    const absentPlayersSet = new Set();
    surveys.forEach((survey) => {
      if (survey.jugadores_ausentes && Array.isArray(survey.jugadores_ausentes)) {
        survey.jugadores_ausentes.forEach((playerId) => {
          absentPlayersSet.add(playerId);
        });
      }
    });
    
    // Get absence data for all absent players
    const { getAbsenceDataForSurveyProcessing } = await import('../absenceService');
    const absentPlayersData = await getAbsenceDataForSurveyProcessing(
      partidoId, 
      Array.from(absentPlayersSet),
    );
    
    console.log('[POST_MATCH] Vote counts:', {
      mvpVotes,
      violentVotes,
      absentPlayersData,
    });
    
    // Determine MVP (most voted) - ONLY 1 MVP per match
    let mvpPlayerId = null;
    let maxMvpVotes = 0;
    Object.entries(mvpVotes).forEach(([playerId, votes]) => {
      if (votes > maxMvpVotes) {
        maxMvpVotes = votes;
        mvpPlayerId = playerId;
      } else if (votes === maxMvpVotes && maxMvpVotes > 0) {
        // In case of tie, use random selection
        if (Math.random() < 0.5) {
          mvpPlayerId = playerId;
        }
      }
    });
    
    // Determine most violent player - ONLY 1 red card per match
    let violentPlayerId = null;
    let maxViolentVotes = 0;
    Object.entries(violentVotes).forEach(([playerId, votes]) => {
      if (votes > maxViolentVotes) {
        maxViolentVotes = votes;
        violentPlayerId = playerId;
      } else if (votes === maxViolentVotes && maxViolentVotes > 0) {
        // In case of tie, use random selection
        if (Math.random() < 0.5) {
          violentPlayerId = playerId;
        }
      }
    });
    
    console.log('[POST_MATCH] Winners:', {
      mvpPlayerId,
      maxMvpVotes,
      violentPlayerId,
      maxViolentVotes,
    });
    
    // Update player stats
    const updates = [];
    
    // Update MVP - only if there are votes
    if (mvpPlayerId && maxMvpVotes > 0) {
      const mvpPlayer = matchPlayers.find((p) => p.uuid === mvpPlayerId || p.usuario_id === mvpPlayerId);
      if (mvpPlayer?.usuario_id) {
        console.log('[POST_MATCH] Updating MVP for player:', mvpPlayer.nombre);
        updates.push(
          supabase
            .from('usuarios')
            .update({ mvps: supabase.raw('COALESCE(mvps, 0) + 1') })
            .eq('id', mvpPlayer.usuario_id),
        );
      }
    }
    
    // Update red card - only if there are votes
    if (violentPlayerId && maxViolentVotes > 0) {
      const violentPlayer = matchPlayers.find((p) => p.uuid === violentPlayerId || p.usuario_id === violentPlayerId);
      if (violentPlayer?.usuario_id) {
        console.log('[POST_MATCH] Updating red card for player:', violentPlayer.nombre);
        updates.push(
          supabase
            .from('usuarios')
            .update({ tarjetas_rojas: supabase.raw('COALESCE(tarjetas_rojas, 0) + 1') })
            .eq('id', violentPlayer.usuario_id),
        );
      }
    }
    
    // Update ratings for absent players (penalty) - only if conditions are met
    Object.entries(absentPlayersData).forEach(([playerId, data]) => {
      const absentPlayer = matchPlayers.find((p) => p.uuid === playerId || p.usuario_id === playerId);
      if (absentPlayer?.usuario_id) {
        if (data.shouldApplyPenalty) {
          console.log('[POST_MATCH] Applying rating penalty for absent player:', absentPlayer.nombre, {
            notifiedInTime: data.notifiedInTime,
            foundReplacement: data.foundReplacement,
          });
          updates.push(
            supabase
              .from('usuarios')
              .update({ 
                rating: supabase.raw('GREATEST(COALESCE(rating, 5.0) - 0.5, 1.0)'), // Min rating of 1.0
              })
              .eq('id', absentPlayer.usuario_id),
          );
        } else {
          console.log('[POST_MATCH] Skipping rating penalty for player:', absentPlayer.nombre, {
            reason: data.notifiedInTime ? 'notified in time' : 'found replacement',
          });
        }
      }
    });
    
    // Execute all updates
    if (updates.length > 0) {
      console.log('[POST_MATCH] Executing', updates.length, 'updates');
      const results = await Promise.all(updates);
      
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) {
        console.error('[POST_MATCH] Update errors:', errors);
        throw new Error(`Failed to update ${errors.length} player stats`);
      }
    }
    
    const result = {
      surveysProcessed: surveys.length,
      mvpAwarded: mvpPlayerId && maxMvpVotes > 0 ? 1 : 0,
      redCardsAwarded: violentPlayerId && maxViolentVotes > 0 ? 1 : 0,
      ratingPenalties: Object.values(absentPlayersData).filter((d) => d.shouldApplyPenalty).length,
      updatesExecuted: updates.length,
    };
    
    console.log('[POST_MATCH] Processing completed:', result);
    return result;
    
  } catch (error) {
    console.error('[POST_MATCH] Error processing surveys:', error);
    throw error;
  }
};

/**
 * Check if a player has already rated a match
 * @param {number} partidoId - Match ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Whether player has already rated
 */
export const checkPartidoCalificado = async (partidoId, userId) => {
  if (!partidoId || !userId) return false;
  
  try {
    // Primero obtener los jugadores del partido para encontrar el ID numérico
    const { getJugadoresDelPartido } = await import('./matches');
    const jugadores = await getJugadoresDelPartido(partidoId);
    const currentUserPlayer = jugadores.find(j => j.usuario_id === userId);
    
    if (!currentUserPlayer) {
      console.log('Usuario no encontrado en el partido:', userId);
      return false;
    }
    
    const { data, error } = await supabase
      .from('post_match_surveys')
      .select('id')
      .eq('partido_id', partidoId)
      .eq('votante_id', currentUserPlayer.id) // Usar ID numérico del jugador
      .maybeSingle();
    
    if (error) {
      console.error('Error verificando calificación:', error);
      return false;
    }
    
    return !!data;
    
  } catch (error) {
    console.error('Error en checkPartidoCalificado:', error);
    return false;
  }
};