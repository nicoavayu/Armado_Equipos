import { supabase } from '../../lib/supabaseClient';
import { schedulePostMatchNotification } from '../notificationService';
import { incrementPartidosAbandonados } from '../matchStatsService';

/**
 * Fetch ALL players for a match (deduped by normalized nombre).
 * Kept for backward compatibility (used by Admin/Encuesta flows).
 * @param {number} partidoId
 * @returns {Promise<Array>} jugadores rows
 */
export const getJugadoresDelPartido = async (partidoId) => {
  const pid = Number(partidoId);
  if (!pid || Number.isNaN(pid)) {
    console.warn('[getJugadoresDelPartido] Invalid ID:', partidoId);
    return [];
  }

  console.log('[getJugadoresDelPartido] Fetching for:', pid);

  const { data, error } = await supabase
    .from('jugadores')
    .select('*')
    .eq('partido_id', pid)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getJugadoresDelPartido] Error:', error);
    throw new Error(`Error fetching match players: ${error.message}`);
  }

  console.log('[getJugadoresDelPartido] Raw data:', data?.length, data);

  const seen = new Set();
  const unique = [];
  (data || []).forEach((p) => {
    const key = String(p?.nombre || '').toLowerCase().trim();
    if (!key) {
      unique.push(p);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(p);
  });

  return unique;
};

/**
 * Fetch a match by numeric id.
 * Legacy export used by AdminPanel routes.
 * @param {number} partidoId
 * @returns {Promise<Object|null>}
 */
export const getPartidoPorId = async (partidoId) => {
  const pid = Number(partidoId);
  if (!pid || Number.isNaN(pid)) return null;
  const { data, error } = await supabase
    .from('partidos')
    .select('*')
    .eq('id', pid)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data || null;
};

/**
 * Fetch match by join code.
 * @param {string} codigo
 * @returns {Promise<Object|null>}
 */
export const getPartidoPorCodigo = async (codigo) => {
  const code = String(codigo || '').trim();
  if (!code) return null;
  const { data, error } = await supabase
    .from('partidos')
    .select('*')
    .eq('codigo', code)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

/**
 * Legacy alias used by old codepaths.
 * @param {number} partidoId
 * @returns {Promise<Array>}
 */
export const refreshJugadoresPartido = async (partidoId) => getJugadoresDelPartido(partidoId);

/**
 * Update match players list.
 * Legacy API: replaces jugadores rows for partido_id.
 * @param {number} partidoId
 * @param {Array<Object>} nuevosJugadores
 * @returns {Promise<Array>}
 */
export const updateJugadoresPartido = async (partidoId, nuevosJugadores) => {
  const pid = Number(partidoId);
  if (!pid || Number.isNaN(pid)) throw new Error('partidoId inválido');

  // Remove current players for match
  const { error: delErr } = await supabase
    .from('jugadores')
    .delete()
    .eq('partido_id', pid);
  if (delErr) throw delErr;

  // Deduplicate rows by UUID to prevent 23505 errors
  const uniqueRowsMap = new Map();
  (nuevosJugadores || []).forEach((j) => {
    if (j.uuid && !uniqueRowsMap.has(j.uuid)) {
      uniqueRowsMap.set(j.uuid, { ...j, partido_id: pid });
    }
  });
  const rows = Array.from(uniqueRowsMap.values());

  if (!rows.length) return [];

  const { data: inserted, error: insErr } = await supabase
    .from('jugadores')
    .insert(rows)
    .select('*');
  if (insErr) throw insErr;
  return inserted || [];
};

/**
 * Create match.
 * Minimal legacy wrapper; expects payload matching partidos table.
 * @param {Object} partidoData
 * @returns {Promise<Object>}
 */
export const crearPartido = async (partidoData) => {
  const { data, error } = await supabase
    .from('partidos')
    .insert([partidoData])
    .select()
    .single();
  if (error) throw error;
  return data;
};

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

  const pid = Number(partidoId);

  if (!votanteId || !pid || Number.isNaN(pid)) {
    console.warn('❗️ checkIfAlreadyVoted: Parámetros inválidos', { votanteId, partidoId });
    return false;
  }

  console.log('🔎 Chequeando si YA VOTÓ:', { votanteId, partidoId: pid, typeofPartidoId: typeof pid });

  const { data, error } = await supabase
    .from('votos')
    .select('id')
    .eq('votante_id', votanteId)
    .eq('partido_id', pid)
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
        reason: e.reason,
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
          .in('partido_id', pidTargets),
      );

      const results = await Promise.allSettled(resetPromises);
      const successCount = results.filter((r) => r.status === 'fulfilled').length;

      console.log('✅ SUPABASE: Player scores reset:', {
        total: jugadores.length,
        successful: successCount,
      });
    }

    // Reset partido estado y limpiar equipos formados
    console.log('🔄 SUPABASE: Resetting partido estado to "votacion"...');
    // Some deployments don't have equipos_json; attempt full update, then fallback to estado-only.
    let partidoError = null;
    {
      const { error } = await supabase
        .from('partidos')
        .update({ estado: 'votacion', equipos_json: null })
        .eq('id', pidNumber);
      partidoError = error;
    }

    if (partidoError) {
      console.warn('⚠️ SUPABASE: update(partidos) with equipos_json failed, retrying estado-only', partidoError);
      const { error: estadoOnlyErr } = await supabase
        .from('partidos')
        .update({ estado: 'votacion' })
        .eq('id', pidNumber);
      if (estadoOnlyErr) {
        console.error('❌ SUPABASE: Error updating partido estado:', estadoOnlyErr);
        throw new Error('Error al resetear estado del partido: ' + estadoOnlyErr.message);
      }
    }

    console.log('✅ SUPABASE: Partido estado reset to "votacion"');

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
 * @returns {Promise<Object>}
 */
export const debugTestVoting = async (partidoId) => {
  console.log('🔍 Debug Test Voting for match:', partidoId);

  try {
    // Obtener información del partido
    const { data: partido, error: partidoError } = await supabase
      .from('partidos')
      .select('id, estado, equipos_json')
      .eq('id', partidoId)
      .single();

    if (partidoError) {
      throw new Error('Error al obtener el partido: ' + partidoError.message);
    }

    console.log('Partido encontrado:', partido);

    // Si el partido ya está cerrado, no se puede votar
    if (partido.estado !== 'votacion') {
      return { message: 'El partido ya está cerrado para votación', partidoId };
    }

    // Obtener jugadores en el partido
    const { data: jugadores, error: jugadoresError } = await supabase
      .from('jugadores')
      .select('uuid, nombre')
      .eq('partido_id', partidoId);

    if (jugadoresError) {
      throw new Error('Error al obtener los jugadores: ' + jugadoresError.message);
    }

    if (!jugadores || jugadores.length === 0) {
      return { message: 'No hay jugadores disponibles para votar', partidoId };
    }

    // Asignar puntajes de ejemplo (1 a 10) a cada jugador
    const votosEjemplo = {};
    jugadores.forEach((j, index) => {
      // Puntaje aleatorio entre 1 y 10
      const puntaje = Math.floor(Math.random() * 10) + 1;
      votosEjemplo[j.uuid] = puntaje;
    });

    console.log('Votos de ejemplo generados:', votosEjemplo);

    // Enviar votos usando la función existente
    const resultadoVotos = await submitVotos(votosEjemplo, jugadores[0].uuid, partidoId, jugadores[0].nombre, null);

    return {
      message: 'Votación de prueba realizada con éxito',
      partidoId,
      votos: resultadoVotos,
    };

  } catch (error) {
    console.error('❌ Error en debugTestVoting:', error);
    return { error: error.message };
  }
};