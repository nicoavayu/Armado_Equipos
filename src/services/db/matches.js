import { supabase } from '../../lib/supabaseClient';
import { schedulePostMatchNotification } from '../notificationService';
import { incrementPartidosAbandonados } from '../matchStatsService';
import { scheduleSurveyReminderForMatch } from './notifications';

// --- Guest Session Management ---

/**
 * Generate or get existing guest session ID for a specific match
 * @param {number} partidoId - Match ID
 * @returns {string} Guest session ID
 */
export const getGuestSessionId = (partidoId) => {
  const storageKey = `guest_session_${partidoId}`;
  let guestId = localStorage.getItem(storageKey);
  if (!guestId) {
    guestId = `guest_${partidoId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(storageKey, guestId);
  }
  return guestId;
};

/**
 * Get current user ID (authenticated user or guest session)
 * @param {number} partidoId - Match ID (optional)
 * @returns {Promise<string>} User ID
 */
export const getCurrentUserId = async (partidoId = null) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) {
    return user.id;
  }
  // For guests, we need a match-specific ID
  if (partidoId) {
    return getGuestSessionId(partidoId);
  }
  // Fallback for general guest ID
  let guestId = localStorage.getItem('guest_session_id');
  if (!guestId) {
    guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('guest_session_id', guestId);
  }
  return guestId;
};

/**
 * Clear guest session for a specific match (useful for testing)
 * @param {number} partidoId - Match ID (optional)
 */
export const clearGuestSession = (partidoId) => {
  if (partidoId) {
    localStorage.removeItem(`guest_session_${partidoId}`);
    console.log(`Cleared guest session for match ${partidoId}`);
  } else {
    // Clear all guest sessions
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('guest_session'));
    keys.forEach((key) => localStorage.removeItem(key));
    console.log(`Cleared ${keys.length} guest sessions`);
  }
};

// --- API de Votos ---

/**
 * Get voter IDs for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array>} Array of voter IDs
 */
export const getVotantesIds = async (partidoId) => {
  if (!partidoId) {
    console.warn('getVotantesIds: No partidoId provided');
    return [];
  }
  
  console.log('Fetching voters for match:', partidoId);
  
  const { data, error } = await supabase
    .from('votos')
    .select('votante_id')
    .eq('partido_id', partidoId);
    
  if (error) {
    console.error('Error fetching voters:', error);
    throw new Error(`Error fetching voters: ${error.message}`);
  }
  
  const votantes = Array.from(new Set((data || []).map((v) => v.votante_id).filter((id) => id)));
  const authVoters = votantes.filter((id) => !id.startsWith('guest_'));
  const guestVoters = votantes.filter((id) => id.startsWith('guest_'));
  
  console.log('Voters found for match:', { 
    partidoId, 
    total: votantes.length,
    authenticated: authVoters.length,
    guests: guestVoters.length,
  });
  
  return votantes;
};

/**
 * Get voters with names for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array>} Array of voters with names
 */
export const getVotantesConNombres = async (partidoId) => {
  if (!partidoId) {
    console.warn('getVotantesConNombres: No partidoId provided');
    return [];
  }
  
  console.log('Fetching voters with names for match:', partidoId);
  
  const { data, error } = await supabase
    .from('votos')
    .select('votante_id, jugador_nombre, jugador_avatar_url')
    .eq('partido_id', partidoId);
    
  if (error) {
    console.error('Error fetching voters with names:', error);
    throw new Error(`Error fetching voters: ${error.message}`);
  }
  
  // Group by votante_id and get unique voters with their names
  const votantesMap = new Map();
  (data || []).forEach((voto) => {
    if (voto.votante_id && !votantesMap.has(voto.votante_id)) {
      votantesMap.set(voto.votante_id, {
        nombre: voto.jugador_nombre || 'Jugador',
        avatar_url: voto.jugador_avatar_url,
      });
    }
  });
  
  const votantes = Array.from(votantesMap.entries()).map(([id, data]) => ({
    id,
    nombre: data.nombre,
    avatar_url: data.avatar_url,
  }));
  
  console.log('Voters with names found:', votantes);
  return votantes;
};

/**
 * Check if user has already voted in a match
 * @param {string} votanteId - Voter ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} Whether user has voted
 */
export const checkIfAlreadyVoted = async (votanteId, partidoId) => {
  if (!votanteId) {
    votanteId = await getCurrentUserId(partidoId);
  }

  if (!votanteId || !partidoId || partidoId === 'undefined' || partidoId === 'null') {
    console.warn('❗️ checkIfAlreadyVoted: Parámetros inválidos', { votanteId, partidoId });
    return false;
  }

  console.log('🔎 Chequeando si YA VOTÓ:', { votanteId, partidoId, typeofPartidoId: typeof partidoId });

  const { data, error } = await supabase
    .from('votos')
    .select('id')
    .eq('votante_id', votanteId)
    .eq('partido_id', partidoId)
    .limit(1);

  if (error) {
    console.error('❌ Error consultando votos:', error);
    throw new Error(`Error consultando votos: ${error.message}`);
  }

  const hasVoted = Array.isArray(data) && data.length > 0;

  if (hasVoted) {
    console.log('🔴 YA VOTASTE en este partido:', { votanteId, partidoId });
  } else {
    console.log('🟢 No hay voto previo, podés votar:', { votanteId, partidoId });
  }

  return hasVoted;
};

/**
 * Submit votes for a match
 * @param {Object} votos - Votes object
 * @param {string} jugadorUuid - Player UUID
 * @param {number} partidoId - Match ID
 * @param {string} jugadorNombre - Player name
 * @param {string} jugadorFoto - Player photo URL
 * @returns {Promise<Array>} Inserted votes
 */
export const submitVotos = async (votos, jugadorUuid, partidoId, jugadorNombre, jugadorFoto) => {
  console.log('🚀 SUBMIT VOTOS CALLED:', { votos, jugadorUuid, partidoId, jugadorNombre });
  
  if (!jugadorUuid || typeof jugadorUuid !== 'string' || jugadorUuid.trim() === '') {
    throw new Error('jugadorUuid must be a valid non-empty string');
  }
  if (!partidoId || typeof partidoId !== 'number' || partidoId <= 0) {
    throw new Error('partido_id must be a valid positive number');
  }
  if (!votos || typeof votos !== 'object' || Object.keys(votos).length === 0) {
    throw new Error('votos must be a valid non-empty object');
  }
  
  const votanteId = await getCurrentUserId(partidoId);
  console.log('Current voter ID:', votanteId, 'Is guest:', votanteId.startsWith('guest_'));
  
  console.log('Checking if already voted...');
  const hasVoted = await checkIfAlreadyVoted(votanteId, partidoId);
  console.log('Has voted result:', hasVoted);
  
  if (hasVoted) {
    throw new Error('Ya votaste en este partido');
  }
  
  const votosParaInsertar = Object.entries(votos)
    .filter(([, puntaje]) => puntaje !== undefined && puntaje !== null)
    .map(([votado_id, puntaje]) => {
      if (!votado_id || typeof votado_id !== 'string' || votado_id.trim() === '') {
        return null;
      }
      return {
        votado_id: votado_id.trim(),
        votante_id: votanteId,
        puntaje: Number(puntaje),
        partido_id: partidoId,
        jugador_nombre: jugadorNombre || 'Jugador',
        jugador_avatar_url: jugadorFoto || null,
      };
    })
    .filter((voto) => voto !== null);
    
  if (votosParaInsertar.length === 0) {
    throw new Error('No hay votos válidos para insertar');
  }
  
  console.log('INSERTING VOTES:', {
    count: votosParaInsertar.length,
    partidoId,
    jugadorUuid,
    votanteId,
    isGuest: votanteId.startsWith('guest_'),
    votes: votosParaInsertar,
  });
  
  const { data, error } = await supabase.from('votos').insert(votosParaInsertar).select();
  if (error) {
    console.error('❌ Error insertando votos:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    
    if (error.code === '23505') {
      throw new Error('Ya votaste en este partido');
    }
    if (error.code === '42501') {
      throw new Error('No tienes permisos para votar. Verifica las políticas de Supabase.');
    }
    throw new Error(`Error al guardar los votos: ${error.message}`);
  }
  
  console.log(`✅ Successfully inserted ${votosParaInsertar.length} votes for match ${partidoId}:`, data);
  return data;
};

/**
 * Close voting and calculate scores for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Calculation results
 */
export const closeVotingAndCalculateScores = async (partidoId) => {
  console.log('📊 SUPABASE: Starting closeVotingAndCalculateScores');
  
  try {
    const { data: votos, error: fetchError } = await supabase
      .from('votos')
      .select('votado_id, puntaje, votante_id')
      .eq('partido_id', partidoId);
      
    if (fetchError) {
      console.error('❌ SUPABASE: Error fetching votes:', fetchError);
      throw new Error('Error al obtener los votos: ' + fetchError.message);
    }
    
    console.log('✅ SUPABASE: Votes fetched:', {
      count: votos?.length || 0,
      sample: votos?.slice(0, 3) || [],
    });
    
    const { data: jugadores, error: playerError } = await supabase
      .from('jugadores')
      .select('uuid, nombre, is_goalkeeper')
      .eq('partido_id', partidoId);
      
    if (playerError) {
      console.error('❌ SUPABASE: Error fetching players:', playerError);
      throw new Error('Error al obtener los jugadores: ' + playerError.message);
    }
    
    console.log('✅ SUPABASE: Players fetched:', {
      count: jugadores?.length || 0,
      players: jugadores?.map((j) => ({ uuid: j.uuid, nombre: encodeURIComponent(j.nombre || '') })) || [],
    });
    
    if (!jugadores || jugadores.length === 0) {
      console.warn('⚠️ SUPABASE: No players found');
      return { message: 'No hay jugadores para actualizar.' };
    }
    
    const votesByPlayer = {};
    const goalkeepers = new Set();
    let totalValidVotes = 0;
    let totalInvalidVotes = 0;
    
    if (votos && votos.length > 0) {
      for (const voto of votos) {
        if (!voto.votado_id) {
          console.warn('⚠️ SUPABASE: Vote without votado_id:', { ...voto, votado_id: encodeURIComponent(voto.votado_id || '') });
          totalInvalidVotes++;
          continue;
        }
        
        if (!votesByPlayer[voto.votado_id]) {
          votesByPlayer[voto.votado_id] = [];
        }
        
        if (voto.puntaje !== null && voto.puntaje !== undefined) {
          const score = Number(voto.puntaje);
          if (!isNaN(score)) {
            if (score === -2) {
              goalkeepers.add(voto.votado_id);
            } else {
              votesByPlayer[voto.votado_id].push(score);
            }
            totalValidVotes++;
          } else {
            console.warn('⚠️ SUPABASE: Invalid score:', encodeURIComponent(String(voto.puntaje || '')));
            totalInvalidVotes++;
          }
        } else {
          totalInvalidVotes++;
        }
      }
    }
    
    console.log('✅ SUPABASE: Votes grouped:', {
      totalValidVotes,
      totalInvalidVotes,
      playersWithVotes: Object.keys(votesByPlayer).length,
      voteDistribution: Object.entries(votesByPlayer).map(([playerId, votes]) => ({
        playerId,
        voteCount: votes.length,
        votes: votes.filter((v) => v !== -1),
      })),
    });
    
    const updates = [];
    const scoreUpdates = [];
    
    for (const jugador of jugadores) {
      const playerVotes = votesByPlayer[jugador.uuid] || [];
      const isGoalkeeper = goalkeepers.has(jugador.uuid);
      
      const numericalVotes = playerVotes
        .map((p) => Number(p))
        .filter((p) => !isNaN(p) && p !== -1 && p !== -2 && p >= 1 && p <= 10);
        
      let avgScore = 5;
      if (numericalVotes.length > 0) {
        const total = numericalVotes.reduce((sum, val) => sum + val, 0);
        avgScore = Math.round((total / numericalVotes.length) * 100) / 100;
      }
      
      scoreUpdates.push({
        uuid: jugador.uuid,
        nombre: jugador.nombre,
        votes: numericalVotes,
        avgScore,
        isGoalkeeper,
      });
      
      const updatePromise = supabase
        .from('jugadores')
        .update({ 
          score: avgScore,
          is_goalkeeper: isGoalkeeper,
        })
        .eq('uuid', jugador.uuid)
        .eq('partido_id', partidoId);
        
      updates.push(updatePromise);
    }
    
    console.log('✅ SUPABASE: Score calculations:', scoreUpdates);
    
    console.log('📊 SUPABASE: Executing score updates');
    const updateResults = await Promise.allSettled(updates);
    const updateErrors = updateResults.filter((res) => res.status === 'rejected');
    const successfulUpdates = updateResults.filter((res) => res.status === 'fulfilled');
    
    if (updateErrors.length > 0) {
      console.error('❌ SUPABASE: Score update errors:', updateErrors.map((e, index) => ({
        index,
        player: scoreUpdates[index]?.nombre,
        uuid: scoreUpdates[index]?.uuid,
        reason: e.reason
      })));
      
      console.warn(`⚠️ SUPABASE: ${updateErrors.length} updates failed, ${successfulUpdates.length} succeeded`);
      
      // Si TODAS las actualizaciones fallaron, lanzar error
      if (successfulUpdates.length === 0) {
        throw new Error('No se pudo actualizar ningún jugador. Verifica los permisos en Supabase.');
      }
      
      // Si solo algunas fallaron, continuar con advertencia
      console.warn(`⚠️ SUPABASE: Continuando con ${successfulUpdates.length} actualizaciones exitosas`);
    }
    
    console.log('✅ SUPABASE: All scores updated successfully');
    
    console.log('📊 SUPABASE: Step 5 - Clearing votes for match:', partidoId);
    const { error: deleteError, count: deletedCount } = await supabase
      .from('votos')
      .delete()
      .eq('partido_id', partidoId);
      
    if (deleteError) {
      console.error('❌ SUPABASE: Error clearing votes:', deleteError);
      throw new Error('Puntajes actualizados, pero hubo un error al limpiar los votos: ' + deleteError.message);
    }
    
    console.log('✅ SUPABASE: Votes cleared:', { deletedCount });
    
    const result = {
      message: `Votación cerrada. Se actualizaron los puntajes de ${successfulUpdates.length}/${jugadores.length} jugadores.`,
      playersUpdated: successfulUpdates.length,
      playersTotal: jugadores.length,
      updateErrors: updateErrors.length,
      votesProcessed: totalValidVotes,
      votesCleared: deletedCount || votos?.length || 0,
    };
    
    console.log('🎉 SUPABASE: closeVotingAndCalculateScores completed successfully:', result);
    return result;
    
  } catch (error) {
    console.error('❌ SUPABASE: closeVotingAndCalculateScores failed:', error);
    console.error('❌ SUPABASE: Error stack:', error.stack);
    throw error;
  }
};

/**
 * Reset all votes for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Reset results
 */
export const resetVotacion = async (partidoId) => {
  console.log('🔄 SUPABASE: Starting resetVotacion for match:', partidoId);

  try {
    if (!partidoId) {
      throw new Error('Match ID is required to reset votes');
    }

    // Normalizar ID para evitar mismatches (string vs number)
    const pidNumber = Number(partidoId);
    const pidTargets = Number.isFinite(pidNumber) ? [pidNumber, String(pidNumber)] : [String(partidoId)];

    // Primero, intentar vía RPC (security definer) para evitar restricciones RLS
    let deletedCount = 0;
    let rpcTried = false;

    try {
      rpcTried = true;
      const { error: rpcError } = await supabase.rpc('reset_votacion', { match_id: pidNumber });
      if (rpcError) {
        console.warn('⚠️ SUPABASE: reset_votacion RPC falló, se usará fallback:', rpcError);
      } else {
        console.log('✅ SUPABASE: reset_votacion RPC ejecutada');
      }
    } catch (rpcErr) {
      console.warn('⚠️ SUPABASE: reset_votacion RPC throw, usando fallback', rpcErr);
    }

    // Fallback o validación: borrar votos manualmente (agresivo, numérico y string)
    for (const target of pidTargets) {
      const { error: deleteError, count } = await supabase
        .from('votos')
        .delete()
        .eq('partido_id', target);

      if (deleteError) {
        console.error('❌ SUPABASE: Error deleting votes:', deleteError);
        throw new Error('Error al resetear votos: ' + deleteError.message);
      }

      deletedCount += count || 0;
    }

    console.log('✅ SUPABASE: Votes deleted (fallback/confirm):', { deletedCount, rpcTried });

    // Reset scores for all players in the match
    const { data: jugadores, error: playerError } = await supabase
      .from('jugadores')
      .select('uuid')
      .in('partido_id', pidTargets);

    if (playerError) {
      console.error('❌ SUPABASE: Error fetching players:', playerError);
      throw new Error('Error al obtener jugadores: ' + playerError.message);
    }

    if (jugadores && jugadores.length > 0) {
      const resetPromises = jugadores.map((j) =>
        supabase
          .from('jugadores')
          .update({ score: null })
          .eq('uuid', j.uuid)
          .in('partido_id', pidTargets)
      );

      const results = await Promise.allSettled(resetPromises);
      const successCount = results.filter((r) => r.status === 'fulfilled').length;

      console.log('✅ SUPABASE: Player scores reset:', {
        total: jugadores.length,
        successful: successCount,
      });
    }

    // Verificar que no queden votos colgando
    try {
      const { data: remaining, error: remainingError } = await supabase
        .from('votos')
        .select('id')
        .in('partido_id', pidTargets);

      if (remainingError) {
        console.warn('⚠️ SUPABASE: No se pudo verificar votos restantes', remainingError);
      } else if (remaining && remaining.length > 0) {
        console.warn('⚠️ SUPABASE: Quedaron votos sin borrar después de reset', remaining.length);
      }
    } catch (verifyError) {
      console.warn('⚠️ SUPABASE: Error verificando votos restantes', verifyError);
    }

    const result = {
      message: 'Votación reseteada exitosamente',
      votesDeleted: deletedCount || 0,
      playersReset: jugadores?.length || 0,
    };

    console.log('🎉 SUPABASE: resetVotacion completed successfully:', result);
    return result;

  } catch (error) {
    console.error('❌ SUPABASE: resetVotacion failed:', error);
    throw error;
  }
};

/**
 * Clear votes for a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<void>}
 */
export const clearVotesForMatch = async (partidoId) => {
  const { error } = await supabase
    .from('votos')
    .delete()
    .eq('partido_id', partidoId);
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Error clearing votes: ${error.message}`);
  }
};

/**
 * Cleanup invalid votes
 * @returns {Promise<Object>} Cleanup results
 */
export const cleanupInvalidVotes = async () => {
  console.log('🧹 Starting cleanup of invalid votes...');
  const { data: invalidVotes, error: checkError } = await supabase
    .from('votos')
    .select('id, votante_id, partido_id, created_at')
    .or('partido_id.is.null,votante_id.is.null,votado_id.is.null');
  if (checkError) throw checkError;
  console.log(`Found ${invalidVotes?.length || 0} invalid votes`);
  if (invalidVotes && invalidVotes.length > 0) {
    const { error: deleteError, count } = await supabase
      .from('votos')
      .delete()
      .or('partido_id.is.null,votante_id.is.null,votado_id.is.null');
    if (deleteError) throw deleteError;
    console.log(`✅ Cleaned up ${count || 0} invalid votes`);
    return { cleaned: count || 0, found: invalidVotes.length };
  }
  return { cleaned: 0, found: 0 };
};

/**
 * Debug function to test voting
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Debug results
 */
export const debugVoting = async (partidoId) => {
  console.log('🔍 DEBUG: Testing voting system...');
  
  try {
    const votanteId = await getCurrentUserId(partidoId);
    console.log('Current user ID:', votanteId);
    
    // Test insert
    const testVote = {
      votado_id: 'test_player_uuid',
      votante_id: votanteId,
      puntaje: 5,
      partido_id: partidoId,
    };
    
    console.log('Testing vote insert:', testVote);
    const { data, error } = await supabase.from('votos').insert([testVote]).select();
    
    if (error) {
      console.error('❌ Insert failed:', error);
      return { success: false, error, votanteId, partidoId };
    }
    
    console.log('✅ Insert successful:', data);
    
    // Clean up test vote
    if (data && data[0]) {
      await supabase.from('votos').delete().eq('id', data[0].id);
      console.log('🧹 Test vote cleaned up');
    }
    
    return { success: true, data, votanteId, partidoId };
  } catch (err) {
    console.error('❌ Debug test failed:', err);
    return { success: false, error: err };
  }
};

/**
 * Debug function to check voting status for current user
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Debug info
 */
export const debugVotingStatus = async (partidoId) => {
  console.log('🔍 DEBUG: Checking voting status...');
  
  try {
    const userId = await getCurrentUserId(partidoId);
    const hasVoted = await checkIfAlreadyVoted(userId, partidoId);
    const voters = await getVotantesIds(partidoId);
    
    const debugInfo = {
      partidoId,
      currentUserId: userId,
      isGuest: userId.startsWith('guest_'),
      hasVoted,
      totalVoters: voters.length,
      allVoters: voters,
    };
    
    console.log('📊 Voting Status Debug:', debugInfo);
    return debugInfo;
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
    return { error: error.message };
  }
};

// --- API de Jugadores ---

/**
 * Get all players with scores
 * @returns {Promise<Array>} Array of players
 */
export const getJugadores = async () => {
  console.log('📊 SUPABASE: Fetching all players with scores');
  
  try {
    const { data, error } = await supabase
      .from('jugadores')
      .select('id, uuid, nombre, foto_url, score, is_goalkeeper')
      .order('nombre', { ascending: true });
      
    if (error) {
      console.error('❌ SUPABASE: Error fetching players:', error);
      throw new Error(`Error fetching players: ${error.message}`);
    }
    
    console.log('✅ SUPABASE: Players fetched successfully:', {
      count: data?.length || 0,
      playersWithScores: data?.filter((p) => p.score !== null && p.score !== undefined).length || 0,
      sample: data?.slice(0, 3).map((p) => ({ 
        nombre: encodeURIComponent(p.nombre || ''), 
        uuid: p.uuid, 
        score: p.score,
      })) || [],
    });
    
    return data || [];
    
  } catch (error) {
    console.error('❌ SUPABASE: getJugadores failed:', error);
    throw error;
  }
};

/**
 * Get ALL players for a match (ignores array in partidos table)
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array>} Array of match players
 */
export const getJugadoresDelPartido = async (partidoId) => {
  console.log('[GET_JUGADORES_PARTIDO] Fetching ALL players for match:', partidoId);
  
  try {
    // SIEMPRE traer todos los jugadores cuyo partido_id coincide
    const { data, error } = await supabase
      .from('jugadores')
      .select('*')
      .eq('partido_id', partidoId) // partido_id es int8
      .order('created_at', { ascending: true }); // Ordenar por fecha de creación
      
    if (error) {
      console.error('[GET_JUGADORES_PARTIDO] Error fetching match players:', error);
      throw new Error(`Error fetching match players: ${error.message}`);
    }
    
    // Eliminar duplicados por nombre (mantener el más antiguo)
    const jugadoresUnicos = [];
    const nombresVistos = new Set();
    
    (data || []).forEach((jugador) => {
      const nombreNormalizado = jugador.nombre.toLowerCase().trim();
      if (!nombresVistos.has(nombreNormalizado)) {
        nombresVistos.add(nombreNormalizado);
        jugadoresUnicos.push(jugador);
      } else {
        console.log('[GET_JUGADORES_PARTIDO] Skipping duplicate player:', jugador.nombre);
      }
    });
    
    console.log('[GET_JUGADORES_PARTIDO] Players fetched (after dedup):', {
      partidoId,
      partidoIdType: typeof partidoId,
      originalCount: data?.length || 0,
      uniqueCount: jugadoresUnicos.length,
      players: jugadoresUnicos.map((p) => ({ 
        nombre: encodeURIComponent(p.nombre || ''), 
        uuid: p.uuid, // uuid es string
        usuario_id: p.usuario_id, // usuario_id es uuid
      })),
    });
    
    return jugadoresUnicos;
    
  } catch (error) {
    console.error('[GET_JUGADORES_PARTIDO] getJugadoresDelPartido failed:', error);
    throw error;
  }
};

/**
 * Add a new player
 * @param {string} nombre - Player name
 * @returns {Promise<Object>} Created player
 */
export const addJugador = async (nombre) => {
  const { data, error } = await supabase
    .from('jugadores')
    .insert([{ nombre, score: 5, is_goalkeeper: false }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

/**
 * Delete a player and their votes
 * @param {string} uuid - Player UUID
 * @returns {Promise<void>}
 */
export const deleteJugador = async (uuid) => {
  await supabase.from('jugadores').delete().eq('uuid', uuid);
  await supabase.from('votos').delete().eq('votante_id', uuid);
  await supabase.from('votos').delete().eq('votado_id', uuid);
};

/**
 * Get match by code
 * @param {string} codigo - Match code
 * @returns {Promise<Object>} Match data
 */
export const getPartidoPorCodigo = async (codigo) => {
  if (!codigo) throw new Error('Match code is required');
  const { data, error } = await supabase
    .from('partidos')
    .select('*')
    .eq('codigo', codigo)
    .single();
  if (error) throw new Error(`Error fetching match: ${error.message}`);
  return data;
};

/**
 * Get match by ID
 * @param {number} id - Match ID
 * @returns {Promise<Object>} Match data
 */
export const getPartidoPorId = async (id) => {
  if (!id) throw new Error('Match ID is required');
  const { data, error } = await supabase
    .from('partidos')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Error fetching match: ${error.message}`);
  return data;
};

/**
 * Update match players array
 * @param {number} partidoId - Match ID
 * @param {Array} nuevosJugadores - New players array
 * @returns {Promise<void>}
 */
export const updateJugadoresPartido = async (partidoId, nuevosJugadores) => {
  console.log('Updating match players:', { partidoId, count: nuevosJugadores.length });
  const { error } = await supabase
    .from('partidos')
    .update({ jugadores: nuevosJugadores })
    .eq('id', partidoId);
  if (error) throw error;
};

/**
 * Refresh match players from jugadores table
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array>} Updated players
 */
export const refreshJugadoresPartido = async (partidoId) => {
  console.log('[REFRESH_JUGADORES] Refreshing players for match:', partidoId);
  
  try {
    // Obtener jugadores actualizados de la tabla jugadores
    const jugadoresActualizados = await getJugadoresDelPartido(partidoId);
    
    // Actualizar la columna jugadores del partido con los datos frescos
    await updateJugadoresPartido(partidoId, jugadoresActualizados);
    
    console.log('[REFRESH_JUGADORES] Match players refreshed successfully:', {
      partidoId,
      count: jugadoresActualizados.length,
    });
    
    return jugadoresActualizados;
    
  } catch (error) {
    console.error('[REFRESH_JUGADORES] Error refreshing match players:', error);
    throw error;
  }
};

/**
 * Create a new match
 * @param {Object} matchData - Match data
 * @returns {Promise<Object>} Created match
 */
export const crearPartido = async ({ nombre, fecha, hora, sede, sedeMaps, modalidad, cupo_jugadores, falta_jugadores, tipo_partido, precio_cancha_por_persona }) => {
   try {
    // Normalize date to prevent timezone issues
    const normalizedDate = typeof fecha === 'string' ? fecha.split('T')[0] : fecha;
    console.log('Creating match with data:', { fecha: normalizedDate, hora, sede, sedeMaps });

    // Get user without throwing error if not authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.warn('Auth error (continuing as guest):', authError);
    }

    const codigo = generarCodigoPartido();
    console.log('Generated match code:', codigo);

    const matchData = {
      codigo,
      nombre: nombre || 'PARTIDO', // Asegurar que siempre tenga nombre
      fecha: normalizedDate,
      hora,
      sede,
      sedeMaps: sedeMaps || '',
      jugadores: [],
      estado: 'activo',
      creado_por: user?.id || null,
      modalidad: modalidad || 'F5',
      cupo_jugadores: cupo_jugadores || 10,
      falta_jugadores: falta_jugadores || false,
      tipo_partido: tipo_partido || 'Masculino',
    };

    // Only include precio_cancha_por_persona if the column exists in the DB and value provided
    if (precio_cancha_por_persona !== undefined && precio_cancha_por_persona !== null) {
      matchData.precio_cancha_por_persona = precio_cancha_por_persona;
    }
    // IMPORTANT: Do NOT write valor_cancha or precio into the partidos table here.
    // The partidos table does not have those columns in the target schema for some deployments.
    console.log('INSERT matchData', matchData);

    // Insert and return the full created object (all available columns).
    const { data, error } = await supabase
      .from('partidos')
      .insert([matchData])
      .select('*')
      .single();

    console.log('INSERT response', { data, error });
    // debug log removed in cleanup

    if (error) {
      console.error('Supabase insert error:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      if (error.code === '42501') {
        throw new Error('Permission denied. Please check Supabase RLS policies for partidos table.');
      }
      if (error.code === '23505') {
        throw new Error('Match code already exists. Please try again.');
      }

      throw new Error(`Error creating match: ${error.message}`);
    }

    const finalData = data; // use the object returned by the INSERT (contains all columns)
    const newId = finalData?.id;
    console.log('Match created with new ID:', newId);

    console.log('Match created successfully:', finalData);

    // Agregar automáticamente al creador como jugador si está autenticado
    if (user?.id && newId) {
      try {
        console.log('[CREAR_PARTIDO] Adding creator as player to match:', {
          userId: user.id,
          matchId: newId,
        });

        // Obtener perfil del usuario
        const { data: userProfile, error: profileError } = await supabase
          .from('usuarios')
          .select('nombre, avatar_url')
          .eq('id', user.id)
          .single();

        const playerData = {
          partido_id: parseInt(newId),  // Asegurar que sea número
          usuario_id: user.id,  // UUID del usuario
          nombre: userProfile?.nombre || user.email?.split('@')[0] || 'Creador',
          avatar_url: userProfile?.avatar_url || null,
          foto_url: userProfile?.avatar_url || null,
          uuid: user.id,
          score: 5,
          is_goalkeeper: false,
        };

        console.log('[CREAR_PARTIDO] Inserting player data:', playerData);

        const { data: insertedPlayer, error: playerError } = await supabase
          .from('jugadores')
          .insert([playerData])
          .select()
          .single();

        if (playerError) {
          console.error('[CREAR_PARTIDO] Error adding creator as player:', playerError);
          // Intentar crear perfil mínimo si no existe
          if (playerError.code === '23503') {
            console.log('[CREAR_PARTIDO] Creating minimal profile for user');
            await supabase.from('usuarios').upsert({
              id: user.id,
              nombre: user.email?.split('@')[0] || 'Usuario',
              email: user.email,
              avatar_url: null,
            }, { onConflict: 'id' });

            // Reintentar inserción
            const { error: retryError } = await supabase
              .from('jugadores')
              .insert([playerData]);

            if (retryError) {
              console.error('[CREAR_PARTIDO] Retry failed:', retryError);
            } else {
              console.log('[CREAR_PARTIDO] Creator added successfully on retry');
            }
          }
        } else {
          console.log('[CREAR_PARTIDO] Creator added as player successfully');
        }
      } catch (playerAddError) {
        console.error('[CREAR_PARTIDO] Exception adding creator as player:', playerAddError);
      }
    }

    // Schedule post-match survey notification
    if (newId) {
      try {
        await schedulePostMatchNotification(newId);
        console.log('[CREAR_PARTIDO] Post-match notification scheduled');
      } catch (notificationError) {
        console.error('[CREAR_PARTIDO] Error scheduling notification:', notificationError);
        // Continue without throwing error
      }
    }

    // NOTE: Survey notifications are now handled by the fanout_survey_start_notifications() cron job
    // No need to schedule survey reminders at match creation time

    return finalData;
 
    } catch (error) {
      console.error('crearPartido failed:', error);
      throw error;
    }
  };

/**
 * Generate random match code
 * @param {number} length - Code length
 * @returns {string} Generated code
 */
const generarCodigoPartido = (length = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++)
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

/**
 * Delete a match and all its associated data
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Success result
 */
export const deletePartido = async (partidoId) => {
  try {
    console.log('Deleting match:', partidoId);
    
    // Step 1: Delete associated messages first
    const { error: messagesError } = await supabase
      .from('mensajes_partido')
      .delete()
      .eq('partido_id', partidoId);
    
    if (messagesError) {
      console.error('Error deleting messages:', messagesError);
      throw new Error(`Error deleting messages: ${messagesError.message}`);
    }
    
    console.log('Messages deleted successfully');
    
    // Step 2: Delete votes for this match
    const { error: votesError } = await supabase
      .from('votos')
      .delete()
      .eq('partido_id', partidoId);
    
    if (votesError && votesError.code !== 'PGRST116') {
      console.error('Error deleting votes:', votesError);
      throw new Error(`Error deleting votes: ${votesError.message}`);
    }
    
    console.log('Votes deleted successfully');
    
    // Step 3: Finally delete the match itself
    const { error: matchError } = await supabase
      .from('partidos')
      .delete()
      .eq('id', partidoId);
    
    if (matchError) {
      console.error('Error deleting match:', matchError);
      throw new Error(`Error deleting match: ${matchError.message}`);
    }
    
    console.log('Match deleted successfully');
    return { success: true };
    
  } catch (error) {
    console.error('Error in deletePartido:', error);
    throw error;
  }
};

/**
 * Remove player from match (self-removal)
 * @param {string} userId - User ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Success result
 */
export const removePlayerFromMatch = async (userId, partidoId) => {
  if (!userId || !partidoId) {
    throw new Error('User ID and Match ID are required');
  }
  
  try {
    const { error } = await supabase
      .from('jugadores')
      .delete()
      .eq('usuario_id', userId)
      .eq('partido_id', partidoId);
      
    if (error) throw error;
    
    // Increment partidos_abandonados for leaving player
    await incrementPartidosAbandonados(userId);
    
    return { success: true };
  } catch (error) {
    console.error('Error removing player from match:', error);
    throw error;
  }
};

/**
 * Check if user has access to a match
 * @param {string} userId - User ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} Whether user has access
 */
export const checkUserAccessToMatch = async (userId, partidoId) => {
  if (!userId || !partidoId) return false;
  
  try {
    // Verificar si es admin del partido
    const { data: partidoData } = await supabase
      .from('partidos')
      .select('creado_por')
      .eq('id', partidoId)
      .single();
      
    if (partidoData?.creado_por === userId) {
      return true;
    }
    
    // Verificar si está en la nómina del partido
    const { data: jugadorData } = await supabase
      .from('jugadores')
      .select('id')
      .eq('partido_id', partidoId)
      .eq('usuario_id', userId)
      .single();
      
    return !!jugadorData;
    
  } catch (error) {
    console.error('Error checking user access to match:', error);
    return false;
  }
};

/**
 * Save teams to database using equipos column
 * @param {number} partidoId - Match ID
 * @param {Object} teams - Teams data
 * @returns {Promise<Object>} Success result
 */
export const saveTeamsToDatabase = async (partidoId, teams) => {
  if (!partidoId || !teams) {
    throw new Error('partidoId and teams are required');
  }
  
  try {
    console.log('[TEAMS_DB] Saving teams to database:', { partidoId, teams });
    
    const { error } = await supabase
      .from('partidos')
      .update({ equipos: teams })
      .eq('id', partidoId);
      
    if (error) throw error;
    
    console.log('[TEAMS_DB] Teams saved successfully');
    return { success: true };
  } catch (error) {
    console.error('[TEAMS_DB] Error saving teams:', error);
    throw error;
  }
};

/**
 * Get teams from database using equipos column
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object|null>} Teams data or null
 */
export const getTeamsFromDatabase = async (partidoId) => {
  if (!partidoId) return null;
  
  try {
    console.log('[TEAMS_DB] Getting teams from database:', partidoId);
    
    const { data, error } = await supabase
      .from('partidos')
      .select('equipos, estado')
      .eq('id', partidoId)
      .single();
      
    if (error) throw error;
    
    console.log('[TEAMS_DB] Teams retrieved:', data?.equipos);
    return data?.equipos || null;
  } catch (error) {
    console.error('[TEAMS_DB] Error getting teams:', error);
    return null;
  }
};

/**
 * Subscribe to real-time changes in teams
 * @param {number} partidoId - Match ID
 * @param {Function} callback - Callback function
 * @returns {Object|null} Subscription object
 */
export const subscribeToTeamsChanges = (partidoId, callback) => {
  if (!partidoId || !callback) return null;
  
  console.log('[TEAMS_REALTIME] Subscribing to teams changes for match:', partidoId);
  
  const subscription = supabase
    .channel(`teams_${partidoId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'partidos',
        filter: `id=eq.${partidoId}`,
      },
      (payload) => {
        console.log('[TEAMS_REALTIME] Teams change detected:', payload);
        if (payload.new?.equipos) {
          callback(payload.new.equipos);
        }
      },
    )
    .subscribe();
    
  return subscription;
};

/**
 * Unsubscribe from teams changes
 * @param {Object} subscription - Subscription object
 */
export const unsubscribeFromTeamsChanges = (subscription) => {
  if (subscription) {
    console.log('[TEAMS_REALTIME] Unsubscribing from teams changes');
    supabase.removeChannel(subscription);
  }
};

/**
 * Cleanup duplicate players in a match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Cleanup results
 */
export const cleanupDuplicatePlayers = async (partidoId) => {
  if (!partidoId) {
    throw new Error('Match ID is required');
  }
  
  console.log('[CLEANUP_DUPLICATES] Starting cleanup for match:', partidoId);
  
  try {
    // Obtener todos los jugadores del partido
    const { data: jugadores, error: fetchError } = await supabase
      .from('jugadores')
      .select('*')
      .eq('partido_id', partidoId)
      .order('created_at', { ascending: true }); // Mantener el más antiguo
      
    if (fetchError) throw fetchError;
    
    if (!jugadores || jugadores.length === 0) {
      console.log('[CLEANUP_DUPLICATES] No players found');
      return { duplicatesRemoved: 0, playersKept: 0 };
    }
    
    console.log('[CLEANUP_DUPLICATES] Found', jugadores.length, 'players');
    
    // Agrupar por nombre (case insensitive)
    const playersByName = {};
    const duplicatesToRemove = [];
    
    jugadores.forEach((jugador) => {
      const normalizedName = jugador.nombre.toLowerCase().trim();
      
      if (playersByName[normalizedName]) {
        // Ya existe un jugador con este nombre, marcar como duplicado
        duplicatesToRemove.push(jugador.id);
        console.log('[CLEANUP_DUPLICATES] Duplicate found:', {
          original: playersByName[normalizedName].nombre,
          duplicate: jugador.nombre,
          duplicateId: jugador.id,
        });
      } else {
        // Primer jugador con este nombre, mantener
        playersByName[normalizedName] = jugador;
      }
    });
    
    if (duplicatesToRemove.length === 0) {
      console.log('[CLEANUP_DUPLICATES] No duplicates found');
      return { duplicatesRemoved: 0, playersKept: jugadores.length };
    }
    
    console.log('[CLEANUP_DUPLICATES] Removing', duplicatesToRemove.length, 'duplicates');
    
    // Eliminar duplicados
    const { error: deleteError } = await supabase
      .from('jugadores')
      .delete()
      .in('id', duplicatesToRemove);
      
    if (deleteError) throw deleteError;
    
    const result = {
      duplicatesRemoved: duplicatesToRemove.length,
      playersKept: jugadores.length - duplicatesToRemove.length,
    };
    
    console.log('[CLEANUP_DUPLICATES] Cleanup completed:', result);
    return result;
    
  } catch (error) {
    console.error('[CLEANUP_DUPLICATES] Error:', error);
    throw error;
  }
};