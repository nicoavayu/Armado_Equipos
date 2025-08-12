import { createClient } from '@supabase/supabase-js';
import { schedulePostMatchNotification } from './services/notificationService';
import { incrementPartidosAbandonados } from './services/matchStatsService';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Export default para que el resto del proyecto pueda importar "supabase" por default
export default supabase;

/**
 * Borra TODAS las notificaciones del usuario autenticado (server-side con RPC).
 * Requiere función SQL: public.delete_my_notifications()
 */
export async function deleteMyNotifications() {
  return await supabase.rpc('delete_my_notifications');
}

// --- API de Jugadores ---

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

// Función para obtener TODOS los jugadores de un partido (ignora array en tabla partidos)
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

export const addJugador = async (nombre) => {
  const { data, error } = await supabase
    .from('jugadores')
    .insert([{ nombre, score: 5, is_goalkeeper: false }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deleteJugador = async (uuid) => {
  await supabase.from('jugadores').delete().eq('uuid', uuid);
  await supabase.from('votos').delete().eq('votante_id', uuid);
  await supabase.from('votos').delete().eq('votado_id', uuid);
};

// Compress image to reduce file size
const compressImage = (file, maxSizeMB = 1.5, quality = 0.8) => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      // Calculate new dimensions (max 800px width/height)
      const maxDimension = 800;
      let { width, height } = img;
      
      if (width > height && width > maxDimension) {
        height = (height * maxDimension) / width;
        width = maxDimension;
      } else if (height > maxDimension) {
        width = (width * maxDimension) / height;
        height = maxDimension;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (blob) => {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    
    img.src = URL.createObjectURL(file);
  });
};

export const uploadFoto = async (file, jugador) => {
  // Compress image if it's larger than 1.5MB
  let fileToUpload = file;
  if (file.size > 1.5 * 1024 * 1024) {
    console.log('Compressing image:', file.size, 'bytes');
    fileToUpload = await compressImage(file);
    console.log('Compressed to:', fileToUpload.size, 'bytes');
  }
  
  const fileExt = file.name.split('.').pop() || 'jpg';
  const fileName = `${jugador.uuid}_${Date.now()}.${fileExt}`;
  const { error: uploadError } = await supabase.storage
    .from('jugadores-fotos')
    .upload(fileName, fileToUpload, { upsert: true });
  if (uploadError) throw uploadError;
  
  const { data } = supabase.storage
    .from('jugadores-fotos')
    .getPublicUrl(fileName);
  
  const fotoUrl = data?.publicUrl;
  if (!fotoUrl) throw new Error('No se pudo obtener la URL pública de la foto.');
  console.log('uploadFoto updating:', { jugador: jugador.uuid, fotoUrl: encodeURIComponent(fotoUrl || '') });
  
  // Update usuarios table with avatar_url
  const { error: updateError } = await supabase
    .from('usuarios')
    .update({ avatar_url: fotoUrl })
    .eq('id', jugador.uuid);

  if (updateError) {
    console.error('uploadFoto update error:', updateError);
    throw updateError;
  }

  // Ahora ACTUALIZÁ la foto en la tabla jugadores
  const { error: updateJugadorError } = await supabase
    .from('jugadores')
    .update({ foto_url: fotoUrl })
    .eq('uuid', jugador.uuid);

  if (updateJugadorError) {
    console.error('uploadFoto update jugador error:', updateJugadorError);
  // No lanzamos el error, solo lo logueamos
  }
  
  // Also update user metadata to ensure consistency
  try {
    await supabase.auth.updateUser({
      data: { avatar_url: fotoUrl },
    });
    console.log('Updated user metadata with avatar_url:', fotoUrl);
  } catch (error) {
    console.error('Error updating user metadata:', error);
    // Continue even if this fails
  }
  
  console.log('uploadFoto success:', encodeURIComponent(fotoUrl || ''));
  return fotoUrl;
};

// --- Guest Session Management ---

// Generate or get existing guest session ID for a specific match
export const getGuestSessionId = (partidoId) => {
  const storageKey = `guest_session_${partidoId}`;
  let guestId = localStorage.getItem(storageKey);
  if (!guestId) {
    guestId = `guest_${partidoId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(storageKey, guestId);
  }
  return guestId;
};

// Get current user ID (authenticated user or guest session)
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

// --- API de Votos ---

/*
 * RECOMMENDED DATABASE CONSTRAINT:
 * To enforce unique votes per player per match, add this constraint to your 'votos' table:
 * 
 * ALTER TABLE votos ADD CONSTRAINT unique_vote_per_match 
 * UNIQUE (votante_id, partido_id);
 * 
 * This prevents duplicate votes at the database level.
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

export const checkPartidoCalificado = async (partidoId, userId) => {
  if (!partidoId || !userId) return false;
  
  try {
    // Primero obtener los jugadores del partido para encontrar el ID numérico
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

// Debug function to test voting
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

// --- Suscripciones Realtime ---

export const subscribeToChanges = (callback) => {
  const subscription = supabase
    .channel('public-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      console.log('Change received!', payload);
      callback(payload);
    })
    .subscribe();
  return subscription;
};

export const removeSubscription = (subscription) => {
  supabase.removeChannel(subscription);
};



// --- API de Partidos ---

export const crearPartido = async ({ nombre, fecha, hora, sede, sedeMaps, modalidad, cupo_jugadores, falta_jugadores, tipo_partido }) => {
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
    
    console.log('Inserting match data:', matchData);
    
    const { data, error } = await supabase
      .from('partidos')
      .insert([matchData])
      .select('id')
      .single();
    
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
    
    const newId = data.id;
    console.log('Match created with new ID:', newId);
    
    // Get the full match data with the new ID
    const { data: fullMatchData, error: fetchError } = await supabase
      .from('partidos')
      .select('*')
      .eq('id', newId)
      .single();
      
    if (fetchError) {
      console.error('Error fetching created match:', fetchError);
      throw new Error(`Error fetching created match: ${fetchError.message}`);
    }
    
    console.log('Match created successfully:', fullMatchData);
    
    // Use the full match data for the rest of the function
    const finalData = fullMatchData;
    
    // Actualizar el partido para que sea frecuente y su propio partido_frecuente_id sea igual a su id
    if (finalData && newId) {
      const { error: updateError } = await supabase
        .from('partidos')
        .update({
          partido_frecuente_id: newId,
          es_frecuente: true,
        })
        .eq('id', newId);
      
      if (updateError) {
        console.error('Error updating match as frequent:', updateError);
      } else {
        // Actualizar el objeto finalData con las nuevas propiedades
        finalData.partido_frecuente_id = newId;
        finalData.es_frecuente = true;
      }
    }
    
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
    
    return finalData;
    
  } catch (error) {
    console.error('crearPartido failed:', error);
    throw error;
  }
};

const generarCodigoPartido = (length = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++)
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

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

export const updateJugadoresPartido = async (partidoId, nuevosJugadores) => {
  console.log('Updating match players:', { partidoId, count: nuevosJugadores.length });
  const { error } = await supabase
    .from('partidos')
    .update({ jugadores: nuevosJugadores })
    .eq('id', partidoId);
  if (error) throw error;
};

// Nueva función para refrescar jugadores del partido desde la tabla jugadores
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

// New function to update frequent match players specifically
export const updateJugadoresFrecuentes = async (partidoFrecuenteId, nuevosJugadores) => {
  console.log('Updating frequent match players:', { partidoFrecuenteId, count: nuevosJugadores.length });
  return updatePartidoFrecuente(partidoFrecuenteId, {
    jugadores_frecuentes: nuevosJugadores,
  });
};

// --- API de Partidos Frecuentes ---

/**
 * Creates a new frequent match template
 * @param {Object} matchData - Frequent match data
 * @param {string} matchData.nombre - Match name
 * @param {string} matchData.sede - Venue
 * @param {string} matchData.hora - Time
 * @param {Array} matchData.jugadores_frecuentes - Default players
 * @param {number} matchData.dia_semana - Day of week (0-6)
 * @param {boolean} matchData.habilitado - Whether the match is enabled
 * @returns {Object} Created frequent match record
 */
export const crearPartidoFrecuente = async ({ nombre, sede, hora, jugadores_frecuentes, dia_semana, habilitado, imagen_url, tipo_partido }) => {
  // Get current authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    throw new Error('User must be authenticated to create frequent matches');
  }
  
  // Validate required fields
  if (!nombre || !sede || !hora || dia_semana === undefined) {
    const missingFields = [];
    if (!nombre) missingFields.push('nombre');
    if (!sede) missingFields.push('sede');
    if (!hora) missingFields.push('hora');
    if (dia_semana === undefined) missingFields.push('dia_semana');
    
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }
  
  const insertData = {
    nombre: nombre.trim(),
    sede: sede.trim(),
    hora: hora.trim(),
    jugadores_frecuentes: jugadores_frecuentes || [],
    creado_por: user.id, // Automatically set to current user's UID
    creado_en: new Date().toISOString(),
    habilitado: habilitado !== undefined ? habilitado : true,
    dia_semana: parseInt(dia_semana),
    imagen_url: imagen_url || null,
    tipo_partido: tipo_partido || 'Masculino',
  };
  
  const { data, error } = await supabase
    .from('partidos_frecuentes')
    .insert([insertData])
    .select()
    .single();
    
  if (error) {
    throw new Error(`Error creating frequent match: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('No data returned from frequent match creation');
  }
  
  return data;
};

export const getPartidosFrecuentes = async () => {
  console.log('Fetching frequent matches...');
  
  try {
    // First, let's get ALL records to see what's in the table
    const { data: allData, error: allError } = await supabase
      .from('partidos_frecuentes')
      .select('*');
    
    console.log('All frequent matches in table:', allData);
    console.log('Count of all records:', allData?.length || 0);
    
    if (allError) {
      console.error('Error fetching all frequent matches:', allError);
    }
    
    // Now get only enabled ones
    const { data, error } = await supabase
      .from('partidos_frecuentes')
      .select('*')
      .eq('habilitado', true)
      .order('creado_en', { ascending: false });
      
    if (error) {
      console.error('Error fetching enabled frequent matches:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      throw new Error(`Error fetching frequent matches: ${error.message}`);
    }
    
    console.log('Enabled frequent matches fetched:', data);
    console.log('Count of enabled records:', data?.length || 0);
    
    if (data && data.length > 0) {
      console.log('Sample record structure:', data[0]);
    }
    
    return data || [];
    
  } catch (err) {
    console.error('Exception in getPartidosFrecuentes:', err);
    throw err;
  }
};

export const updatePartidoFrecuente = async (id, updates) => {
  // Only update the provided fields, don't touch jugadores_frecuentes unless explicitly provided
  const updateData = { ...updates };
  
  // Only clean jugadores_frecuentes if it's being updated
  if (updates.jugadores_frecuentes) {
    updateData.jugadores_frecuentes = updates.jugadores_frecuentes.map((j) => ({
      nombre: j.nombre,
      avatar_url: j.avatar_url || null, // Use only avatar_url
      uuid: j.uuid || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    }));
  }
  
  const { data, error } = await supabase
    .from('partidos_frecuentes')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Error updating frequent match: ${error.message}`);
  return data;
};

export const deletePartidoFrecuente = async (id) => {
  const { error } = await supabase
    .from('partidos_frecuentes')
    .update({ habilitado: false })
    .eq('id', id);
  if (error) throw new Error(`Error deleting frequent match: ${error.message}`);
};

export const crearPartidoDesdeFrec = async (partidoFrecuente, fecha, modalidad = 'F5', cupo = 10) => {
  console.log('Creating/finding match from frequent match:', partidoFrecuente, 'for date:', fecha);
  
  // Ensure date is in YYYY-MM-DD format without timezone conversion
  const normalizedDate = typeof fecha === 'string' ? fecha.split('T')[0] : fecha;
  
  // Get current user to make search more specific
  const { data: { user } } = await supabase.auth.getUser();
  
  // First, check if a match already exists for this frequent match, date AND user
  const { data: existingMatches, error: searchError } = await supabase
    .from('partidos')
    .select('*')
    .eq('fecha', normalizedDate)
    .eq('sede', partidoFrecuente.sede)
    .eq('hora', partidoFrecuente.hora)
    .eq('estado', 'activo')
    .eq('creado_por', user?.id); // Solo buscar partidos del mismo usuario
    
  if (searchError) {
    console.error('Error searching for existing match:', searchError);
  }
  
  // If we found an existing match, return it
  if (existingMatches && existingMatches.length > 0) {
    const existingMatch = existingMatches[0];
    console.log('Found existing match:', existingMatch.id);
    

    
    // Add frequent match metadata
    existingMatch.frequent_match_name = partidoFrecuente.nombre;
    existingMatch.from_frequent_match_id = partidoFrecuente.id;
    
    return existingMatch;
  }
  
  // If no existing match, create a new one
  console.log('No existing match found, creating new one');
  const partido = await crearPartido({
    nombre: partidoFrecuente.nombre, // Usar el nombre del partido frecuente
    fecha: normalizedDate,
    hora: partidoFrecuente.hora,
    sede: partidoFrecuente.sede,
    sedeMaps: '',
    modalidad,
    cupo_jugadores: cupo,
    falta_jugadores: false,
    tipo_partido: partidoFrecuente.tipo_partido || 'Masculino',
  });
  
  console.log('New match created with ID:', partido.id);
  
  // Add frequent match type and reference
  partido.frequent_match_name = partidoFrecuente.nombre;
  partido.from_frequent_match_id = partidoFrecuente.id;
  partido.tipo_partido = partidoFrecuente.tipo_partido || 'Masculino';
  
  // Always copy the players from the frequent match, even if empty
  const jugadoresFrecuentes = partidoFrecuente.jugadores_frecuentes || [];
  
  if (jugadoresFrecuentes.length > 0) {
    // Clean player data - keep only nombre and foto_url
    const jugadoresLimpios = jugadoresFrecuentes.map((j) => ({
      nombre: j.nombre,
      avatar_url: j.avatar_url || null, // Use only avatar_url
      uuid: j.uuid || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      score: j.score || 5, // Default score
    }));
    
    console.log('Adding players to new match:', jugadoresLimpios);
    await updateJugadoresPartido(partido.id, jugadoresLimpios);
    partido.jugadores = jugadoresLimpios;
  } else {
    partido.jugadores = [];
  }
  
  return partido;
};

export const clearVotesForMatch = async (partidoId) => {
  const { error } = await supabase
    .from('votos')
    .delete()
    .eq('partido_id', partidoId);
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Error clearing votes: ${error.message}`);
  }
};

// Delete a match and all its associated data (messages, votes)
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

// Clear guest session for a specific match (useful for testing)
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

// --- Amigos (Friends) API ---

/**
 * Get all friends for a user with status 'accepted'
 * Devuelve array de objetos usuario con datos completos
 * @param {string} userId - Current user ID (UUID)
 * @returns {Array} Array de usuarios amigos (sin duplicados, sin el propio usuario)
 */
export const getAmigos = async (userId) => {
  if (!userId) return [];
  
  console.log('[GET_AMIGOS] Fetching friends for user:', userId);
  
  try {
    // 1. Traer relaciones donde user_id = userId y status = "accepted"
    const { data: directFriends, error: directError } = await supabase
      .from('amigos')
      .select('friend_id')
      .eq('user_id', userId)
      .eq('status', 'accepted');
      
    if (directError) throw directError;
    
    // 2. Traer relaciones donde friend_id = userId y status = "accepted"
    const { data: reverseFriends, error: reverseError } = await supabase
      .from('amigos')
      .select('user_id')
      .eq('friend_id', userId)
      .eq('status', 'accepted');
      
    if (reverseError) throw reverseError;
    
    // 3. Armar array con los IDs del otro usuario en cada relación
    const friendIds = [
      ...(directFriends || []).map((f) => f.friend_id),
      ...(reverseFriends || []).map((f) => f.user_id),
    ];
    
    // Eliminar duplicados y el propio userId
    const uniqueFriendIds = [...new Set(friendIds)].filter((id) => id !== userId);
    
    console.log('[GET_AMIGOS] userId:', userId, 'allIds:', uniqueFriendIds);
    
    if (uniqueFriendIds.length === 0) {
      console.log('[GET_AMIGOS] No friends found');
      return [];
    }
    
    // 4. Hacer SELECT * FROM usuarios WHERE id IN (...) para traer datos completos
    const { data: users, error: usersError } = await supabase
      .from('usuarios')
      .select('*')
      .in('id', uniqueFriendIds);
      
    if (usersError) throw usersError;
    
    console.log('[GET_AMIGOS] userId:', userId, 'allIds:', uniqueFriendIds, 'users:', users?.length || 0);
    
    return users || [];
    
  } catch (err) {
    console.error('[GET_AMIGOS] Error fetching friends:', err);
    throw err;
  }
};

/**
 * Get relationship status between current user and another player
 * @param {string} userId - Current user ID
 * @param {string} friendId - Other player ID
 * @returns {Object|null} Relationship status or null if no relationship exists
 */
export const getRelationshipStatus = async (userId, friendId) => {
  if (!userId || !friendId) return null;
  
  try {
    // Check if there's a relationship where current user is user_id
    const { data, error } = await supabase
      .from('amigos')
      .select('id, status')
      .eq('user_id', userId)
      .eq('friend_id', friendId)
      .maybeSingle();
      
    if (error) throw error;
    
    if (data) return data;
    
    // Check if there's a relationship where current user is friend_id
    const { data: reverseData, error: reverseError } = await supabase
      .from('amigos')
      .select('id, status')
      .eq('user_id', friendId)
      .eq('friend_id', userId)
      .maybeSingle();
      
    if (reverseError) throw reverseError;
    
    return reverseData;
  } catch (err) {
    console.error('Error getting relationship status:', err);
    return null;
  }
};

/**
 * Send a friend request
 * @param {string} userId - Current user ID
 * @param {string} friendId - Player ID to send request to
 * @returns {Object} Result of the operation
 */
export const sendFriendRequest = async (userId, friendId) => {
  if (!userId || !friendId) {
    return { success: false, message: 'IDs de usuario inválidos' };
  }
  
  try {
    // Check if a relationship already exists
    const existingRelation = await getRelationshipStatus(userId, friendId);
    if (existingRelation) {
      return { success: false, message: 'Ya existe una relación con este jugador' };
    }
    
    // Create new friend request
    const { data, error } = await supabase
      .from('amigos')
      .insert([{
        user_id: userId,
        friend_id: friendId,
        status: 'pending',
      }])
      .select()
      .single();
      
    if (error) throw error;
    
    return { success: true, data };
  } catch (err) {
    console.error('Error sending friend request:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Accept a friend request
 * @param {string} requestId - ID of the friend request
 * @returns {Object} Result of the operation
 */
export const acceptFriendRequest = async (requestId) => {
  try {
    const { data, error } = await supabase
      .from('amigos')
      .update({ status: 'accepted' })
      .eq('id', requestId)
      .select()
      .single();
      
    if (error) throw error;
    
    return { success: true, data };
  } catch (err) {
    console.error('Error accepting friend request:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Reject a friend request
 * @param {string} requestId - ID of the friend request
 * @returns {Object} Result of the operation
 */
export const rejectFriendRequest = async (requestId) => {
  try {
    const { data, error } = await supabase
      .from('amigos')
      .update({ status: 'rejected' })
      .eq('id', requestId)
      .select()
      .single();
      
    if (error) throw error;
    
    return { success: true, data };
  } catch (err) {
    console.error('Error rejecting friend request:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Remove a friend
 * @param {string} friendshipId - ID of the friendship
 * @returns {Object} Result of the operation
 */
export const removeFriend = async (friendshipId) => {
  try {
    const { error } = await supabase
      .from('amigos')
      .delete()
      .eq('id', friendshipId);
      
    if (error) throw error;
    
    return { success: true };
  } catch (err) {
    console.error('Error removing friend:', err);
    return { success: false, message: err.message };
  }
};

/**
 * Get pending friend requests for a user
 * @param {string} userId - Current user ID
 * @returns {Array} List of pending friend requests
 */
export const getPendingRequests = async (userId) => {
  if (!userId) return [];
  
  try {
    const { data, error } = await supabase
      .from('amigos')
      .select(`
        id, 
        status, 
        created_at,
        user_id,
        jugadores!user_id(id, nombre, avatar_url, email, posicion, ranking, partidos_jugados, pais_codigo, numero)
      `)
      .eq('friend_id', userId)
      .eq('status', 'pending');
      
    if (error) throw error;
    
    return data.map((item) => ({
      id: item.id,
      status: item.status,
      created_at: item.created_at,
      profile: item.jugadores,
    }));
  } catch (err) {
    console.error('Error fetching pending requests:', err);
    return [];
  }
};

// --- Profile Management ---

export const getProfile = async (userId) => {
  console.log('getProfile called for userId:', userId);
  const { data, error } = await supabase
    .from('usuarios')
    .select('*, lesion_activa')
    .eq('id', userId)
    .single();
  
  if (error) {
    console.error('getProfile error:', error);
    throw error;
  }
  
  // Get badge counts from player_awards table
  if (data) {
    try {
      const { data: badges, error: badgesError } = await supabase
        .from('player_awards')
        .select('award_type')
        .eq('jugador_id', userId);
      
      if (!badgesError && badges) {
        // Count badges by type
        const badgeCounts = {
          mvps: 0,
          guantes_dorados: 0,
          tarjetas_rojas: 0,
        };
        
        badges.forEach((badge) => {
          if (badge.award_type === 'mvp') badgeCounts.mvps++;
          if (badge.award_type === 'guante_dorado') badgeCounts.guantes_dorados++;
          if (badge.award_type === 'tarjeta_roja') badgeCounts.tarjetas_rojas++;
        });
        
        // Add badge counts to profile data
        data.mvps = badgeCounts.mvps;
        data.guantes_dorados = badgeCounts.guantes_dorados;
        data.tarjetas_rojas = badgeCounts.tarjetas_rojas;
        
        console.log('[GET_PROFILE] Badge counts added:', badgeCounts);
      }
    } catch (badgeError) {
      console.error('[GET_PROFILE] Error fetching badges:', badgeError);
      // Continue without badges if there's an error
    }
  }
  
  // Convert date format for frontend - FORCE conversion
  if (data && data.fecha_nacimiento) {
    let dateValue = data.fecha_nacimiento;
    
    if (typeof dateValue === 'string') {
      // Handle ISO string format
      if (dateValue.includes('T')) {
        dateValue = dateValue.split('T')[0];
      }
      // Handle other date formats
      else if (dateValue.includes(' ')) {
        dateValue = dateValue.split(' ')[0];
      }
    } else if (dateValue instanceof Date) {
      // Convert Date object to YYYY-MM-DD format
      dateValue = dateValue.toISOString().split('T')[0];
    }
    
    // Ensure final format is YYYY-MM-DD
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
      data.fecha_nacimiento = dateValue.substring(0, 10); // Take only first 10 chars (YYYY-MM-DD)
    }
    
    // Update the actual data field
    data.fecha_nacimiento = dateValue;
    
    console.log('[GET_PROFILE] Date conversion:', {
      original: data.fecha_nacimiento,
      converted: dateValue,
    });
  }
  
  console.log('getProfile result:', {
    data: data,
    avatar_url: data?.avatar_url,
    foto_url: data?.foto_url,
    all_fields: Object.keys(data || {}),
  });
  
  return data;
};

export const updateProfile = async (userId, profileData) => {
  console.log('[UPDATE_PROFILE] Input fields:', Object.keys(profileData));
  console.log('[UPDATE_PROFILE] Input data:', profileData);
  
  const completion = calculateProfileCompletion(profileData);
  
  // Valid columns in usuarios table
  const validColumns = [
    'nombre', 'email', 'avatar_url', 'red_social', 'localidad', 'ranking',
    'partidos_jugados', 'posicion', 'acepta_invitaciones', 'bio',
    'perfil_completo', 'profile_completion', 'pais_codigo', 'nacionalidad',
    'latitud', 'longitud', 'fecha_nacimiento', 'partidos_abandonados',
    'numero', 'telefono', 'mvps', 'tarjetas_rojas', 'rating', 'updated_at',
    'lesion_activa',
  ];
  
  // Field mapping for frontend to database
  const fieldMapping = {
    'social': 'red_social',
    'socialHandle': 'red_social',
    'social_handle': 'red_social',
    'ciudad': 'localidad',
    'city': 'localidad',
    'birthDate': 'fecha_nacimiento',
    'dateOfBirth': 'fecha_nacimiento',
    'birth_date': 'fecha_nacimiento',
    'phone': 'telefono',
    'position': 'posicion',
    'country': 'pais_codigo',
    'nationality': 'nacionalidad',
    'number': 'numero',
    'playerNumber': 'numero',
    'player_number': 'numero',
  };
  
  // Filter and map fields
  const cleanProfileData = {};
  Object.keys(profileData).forEach((key) => {
    const dbKey = fieldMapping[key] || key;
    if (validColumns.includes(dbKey)) {
      let value = profileData[key];
      
      // Convert date format for fecha_nacimiento
      if (dbKey === 'fecha_nacimiento' && value) {
        if (typeof value === 'string') {
          // Convert from "2025-07-10T00:00:00" to "2025-07-10"
          if (value.includes('T')) {
            value = value.split('T')[0];
          }
          // Ensure it's a valid date format (YYYY-MM-DD)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            console.warn('[UPDATE_PROFILE] Invalid date format:', value);
            value = null;
          }
        } else if (value instanceof Date) {
          // Convert Date object to YYYY-MM-DD format
          value = value.toISOString().split('T')[0];
        }
      }
      
      if (value === null || value === undefined || 
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        cleanProfileData[dbKey] = value;
      }
    }
  });
  
  const finalData = { ...cleanProfileData, profile_completion: completion, updated_at: new Date().toISOString() };
  
  console.log('[UPDATE_PROFILE] Mapped fields:', Object.keys(finalData));
  console.log('[UPDATE_PROFILE] Final data:', finalData);
  
  const { data, error } = await supabase
    .from('usuarios')
    .update(finalData)
    .eq('id', userId)
    .select()
    .single();
  
  if (error) throw error;
  
  // Actualizar el nombre en todos los partidos donde el usuario es jugador
  if (finalData.nombre) {
    try {
      await supabase
        .from('jugadores')
        .update({ nombre: finalData.nombre })
        .eq('usuario_id', userId);
      console.log('[UPDATE_PROFILE] Updated player name in all matches');
    } catch (updateError) {
      console.error('[UPDATE_PROFILE] Error updating player names:', updateError);
      // No lanzar error, solo loguearlo
    }
  }
  
  return data;
};

export const createOrUpdateProfile = async (user) => {
  // Avatar de Google o proveedor social
  const avatarUrl =
    user.user_metadata?.picture ||
    user.user_metadata?.avatar_url ||
    null;

  // Buscá si ya existe el usuario
  const { data: existingUser } = await supabase
    .from('usuarios')
    .select('avatar_url')
    .eq('id', user.id)
    .single();

  // SOLO campos que EXISTEN en la tabla usuarios
  const profileData = {
    id: user.id,
    nombre: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
    email: user.email,
    avatar_url: avatarUrl || existingUser?.avatar_url || null,
    red_social: null,                 // o traelo si lo tenés
    localidad: null,                  // editable luego
    ranking: 0,
    partidos_jugados: 0,
    posicion: null,                   // editable luego
    acepta_invitaciones: true,
    bio: null,                        // editable luego
    fecha_alta: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    perfil_completo: false,
    profile_completion: 0,
    pais_codigo: null,                // editable luego
    nacionalidad: 'argentina',
    latitud: null,
    longitud: null,
    fecha_nacimiento: null,
    partidos_abandonados: 0,
    numero: null,
  };

  // Actualizar metadata en Supabase Auth
  if (avatarUrl) {
    try {
      await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl },
      });
      console.log('Updated user metadata with avatar_url:', avatarUrl);
    } catch (error) {
      console.error('Error updating user metadata:', error);
    }
  }

  // Insertar o actualizar (upsert)
  const { data, error } = await supabase
    .from('usuarios')
    .upsert(profileData, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('Error upserting user profile:', error);
    throw error;
  }

  console.log('createOrUpdateProfile OK:', data);
  return data;
};


export const calculateProfileCompletion = (profile) => {
  if (!profile) return 0;
  
  const fields = [
    'nombre',
    'avatar_url',
    'email',
    'numero_jugador',
    'nacionalidad',
    'telefono', 
    'localidad', 
    'fecha_nacimiento',
    'posicion_favorita',
    'bio',
  ];
  
  const filledFields = fields.filter((field) => {
    const value = profile[field];
    return value && value.toString().trim() !== '';
  });
  
  return Math.round((filledFields.length / fields.length) * 100);
};

// --- Free Players Management ---

export const addFreePlayer = async () => {
  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('User must be authenticated');
    }

    console.log('Adding free player for user:', user.id);

    // Get user profile
    const profile = await getProfile(user.id);
    console.log('User profile:', profile);
    
    if (!profile) {
      console.warn('Profile not found, creating minimal profile');
      // Create a minimal profile if none exists
      const minimalProfile = {
        nombre: user.email?.split('@')[0] || 'Usuario',
        localidad: 'Sin especificar',
      };
      
      // Check if already registered
      const { data: existing, error: checkError } = await supabase
        .from('jugadores_sin_partido')
        .select('id')
        .eq('user_id', user.id)
        .eq('disponible', true);
      
      if (checkError) {
        console.error('Error checking existing free player:', checkError);
        throw checkError;
      }

      if (existing && existing.length > 0) {
        console.log('User already registered as free player');
        throw new Error('Ya estás anotado como disponible');
      }

      // Add to free players with minimal profile
      console.log('Inserting free player with minimal profile:', minimalProfile);
      const { error: insertError } = await supabase
        .from('jugadores_sin_partido')
        .insert([{
          user_id: user.id,
          nombre: minimalProfile.nombre,
          localidad: minimalProfile.localidad,
        }]);

      if (insertError) {
        console.error('Error inserting free player:', insertError);
        throw insertError;
      }
      
      return;
    }

    // Check if already registered
    const { data: existing, error: checkError } = await supabase
      .from('jugadores_sin_partido')
      .select('id')
      .eq('user_id', user.id)
      .eq('disponible', true);
    
    if (checkError) {
      console.error('Error checking existing free player:', checkError);
      throw checkError;
    }

    if (existing && existing.length > 0) {
      console.log('User already registered as free player');
      throw new Error('Ya estás anotado como disponible');
    }

    // Add to free players
    console.log('Inserting free player with profile:', {
      nombre: profile.nombre,
      localidad: profile.localidad,
    });
    
    const { error: insertError } = await supabase
      .from('jugadores_sin_partido')
      .insert([{
        user_id: user.id,
        nombre: profile.nombre || 'Usuario',
        localidad: profile.localidad || 'Sin especificar',
      }]);

    if (insertError) {
      console.error('Error inserting free player:', insertError);
      throw insertError;
    }
  } catch (error) {
    console.error('addFreePlayer failed:', error);
    throw error;
  }
};

export const removeFreePlayer = async () => {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('User must be authenticated');
  }

  const { error } = await supabase
    .from('jugadores_sin_partido')
    .update({ disponible: false })
    .eq('user_id', user.id);

  if (error) throw error;
};

export const getFreePlayerStatus = async () => {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return false;

  const { data } = await supabase
    .from('jugadores_sin_partido')
    .select('id')
    .eq('user_id', user.id)
    .eq('disponible', true)
    .single();

  return !!data;
};

export const getFreePlayersList = async () => {
  const { data, error } = await supabase
    .from('jugadores_sin_partido')
    .select('*')
    .eq('disponible', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

// Debug function to check voting status for current user
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

// Debug function to check table schema
export const checkPartidosFrecuentesSchema = async () => {
  console.log('Checking partidos_frecuentes table schema...');
  
  try {
    // Try to insert a test record to see what fields are expected
    const testData = {
      nombre: 'TEST_SCHEMA_CHECK',
      sede: 'TEST',
      hora: '12:00',
      jugadores_frecuentes: [],
      creado_por: 'test',
      dia_semana: 1,
      habilitado: true,
      creado_en: new Date().toISOString(),
    };
    
    const { data, error } = await supabase
      .from('partidos_frecuentes')
      .insert([testData])
      .select()
      .single();
    
    if (error) {
      console.error('Schema check failed:', error);
      return { success: false, error };
    }
    
    // Clean up test record
    if (data?.id) {
      await supabase
        .from('partidos_frecuentes')
        .delete()
        .eq('id', data.id);
    }
    
    console.log('Schema check passed:', data);
    return { success: true, data };
    
  } catch (err) {
    console.error('Exception during schema check:', err);
    return { success: false, error: err };
  }
};

// Función para limpiar jugadores duplicados en un partido
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

// [TEAM_BALANCER_EDIT] Verificar si un usuario tiene acceso a un partido
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

// [TEAM_BALANCER_EDIT] Eliminar jugador del partido (auto-eliminación)
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

// Save teams to database using equipos column as single source of truth
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

// Get teams from database using equipos column
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

// Subscribe to real-time changes in teams
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

// Unsubscribe from teams changes
export const unsubscribeFromTeamsChanges = (subscription) => {
  if (subscription) {
    console.log('[TEAMS_REALTIME] Unsubscribing from teams changes');
    supabase.removeChannel(subscription);
  }
};

// --- Post Match Survey Processing ---

/**
 * Process post-match surveys and update player stats (MVP, red cards, ratings)
 * @param {number} partidoId - Match ID
 * @returns {Object} Processing results
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
    const { getAbsenceDataForSurveyProcessing } = await import('../services/absenceService');
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
 * Check if surveys for a match have been processed
 * @param {number} partidoId - Match ID
 * @returns {boolean} Whether surveys have been processed
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


