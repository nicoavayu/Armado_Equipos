import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
      playersWithScores: data?.filter(p => p.score !== null && p.score !== undefined).length || 0,
      sample: data?.slice(0, 3).map(p => ({ 
        nombre: p.nombre, 
        uuid: p.uuid, 
        score: p.score 
      })) || []
    });
    
    return data || [];
    
  } catch (error) {
    console.error('❌ SUPABASE: getJugadores failed:', error);
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
        quality
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
  console.log('uploadFoto updating:', { jugador: jugador.uuid, fotoUrl });
  
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
      data: { avatar_url: fotoUrl }
    });
    console.log('Updated user metadata with avatar_url:', fotoUrl);
  } catch (error) {
    console.error('Error updating user metadata:', error);
    // Continue even if this fails
  }
  
  console.log('uploadFoto success:', fotoUrl);
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
  
  const votantes = Array.from(new Set((data || []).map(v => v.votante_id).filter(id => id)));
  const authVoters = votantes.filter(id => !id.startsWith('guest_'));
  const guestVoters = votantes.filter(id => id.startsWith('guest_'));
  
  console.log('Voters found for match:', { 
    partidoId, 
    total: votantes.length,
    authenticated: authVoters.length,
    guests: guestVoters.length
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
  (data || []).forEach(voto => {
    if (voto.votante_id && !votantesMap.has(voto.votante_id)) {
      votantesMap.set(voto.votante_id, {
        nombre: voto.jugador_nombre || 'Jugador',
        avatar_url: voto.jugador_avatar_url // Use avatar_url as the field name
      });
    }
  });
  
  const votantes = Array.from(votantesMap.entries()).map(([id, data]) => ({
    id,
    nombre: data.nombre,
    avatar_url: data.avatar_url
  }));
  
  console.log('Voters with names found:', votantes);
  return votantes;
};





/**
 * Verifica si un partido específico ya fue calificado por el usuario
 * @param {number} partidoId - ID del partido
 * @param {string} userId - ID del usuario
 * @returns {boolean} True si ya fue calificado, false si no
 */
export const checkPartidoCalificado = async (partidoId, userId) => {
  if (!partidoId || !userId) return false;
  
  try {
    const { data, error } = await supabase
      .from('post_match_surveys')
      .select('id')
      .eq('partido_id', partidoId)
      .eq('user_id', userId)
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

// Chequea si el usuario (auth o guest) ya votó en un partido específico
export const checkIfAlreadyVoted = async (votanteId, partidoId) => {
  // Obtiene el votanteId si no se pasó explícito
  if (!votanteId) {
    votanteId = await getCurrentUserId(partidoId);
  }

  // Chequeo fuerte: partidoId debe estar definido y ser un número o string válido
  if (!votanteId || !partidoId || partidoId === 'undefined' || partidoId === 'null') {
    console.warn('❗️ checkIfAlreadyVoted: Parámetros inválidos', { votanteId, partidoId });
    return false; // Permite votar para evitar bloqueos fantasma
  }

  // DEBUG: Mostramos por consola los valores usados en el chequeo
  console.log('🔎 Chequeando si YA VOTÓ:', { votanteId, partidoId, typeofPartidoId: typeof partidoId });

  // Consulta Supabase para ver si ya existe el voto
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

  // Si encuentra un voto, devuelve true (ya votó), si no, false
  const hasVoted = Array.isArray(data) && data.length > 0;

  if (hasVoted) {
    console.log('🔴 YA VOTASTE en este partido:', { votanteId, partidoId });
  } else {
    console.log('🟢 No hay voto previo, podés votar:', { votanteId, partidoId });
  }

  return hasVoted;
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
      partido_id: partidoId
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

export const submitVotos = async (votos, jugadorUuid, partidoId, jugadorNombre, jugadorFoto) => {
  console.log('🚀 SUBMIT VOTOS CALLED:', { votos, jugadorUuid, partidoId, jugadorNombre });
  
  // Validation first
  if (!jugadorUuid || typeof jugadorUuid !== 'string' || jugadorUuid.trim() === '') {
    throw new Error('jugadorUuid must be a valid non-empty string');
  }
  if (!partidoId || typeof partidoId !== 'number' || partidoId <= 0) {
    throw new Error('partido_id must be a valid positive number');
  }
  if (!votos || typeof votos !== 'object' || Object.keys(votos).length === 0) {
    throw new Error('votos must be a valid non-empty object');
  }
  
  // Get current user ID (authenticated or guest) for this specific match
  const votanteId = await getCurrentUserId(partidoId);
  console.log('Current voter ID:', votanteId, 'Is guest:', votanteId.startsWith('guest_'));
  
  // Check if this user (authenticated or guest) has already voted
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
        votante_id: votanteId, // Current user (auth or guest)
        puntaje: Number(puntaje),
        partido_id: partidoId,
        jugador_nombre: jugadorNombre || 'Jugador',
        jugador_avatar_url: jugadorFoto || null // Use only avatar_url field
      };
    })
    .filter(voto => voto !== null);
    
  if (votosParaInsertar.length === 0) {
    throw new Error('No hay votos válidos para insertar');
  }
  
  console.log('INSERTING VOTES:', {
    count: votosParaInsertar.length,
    partidoId,
    jugadorUuid,
    votanteId,
    isGuest: votanteId.startsWith('guest_'),
    votes: votosParaInsertar
  });
  
  const { data, error } = await supabase.from('votos').insert(votosParaInsertar).select();
  if (error) {
    console.error('❌ Error insertando votos:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint
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

// --- Suscripciones Realtime ---

export const subscribeToChanges = (callback) => {
  const subscription = supabase
    .channel('public-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
      console.log('Change received!', payload);
      callback(payload);
    })
    .subscribe();
  return subscription;
};

export const removeSubscription = (subscription) => {
  supabase.removeChannel(subscription);
};

// --- Cierre de votación y cálculo de promedios ---

/**
 * Closes voting phase and calculates player average scores
 * Aggregates all votes, calculates averages, updates player scores, and clears votes
 * @returns {Object} Result message with number of players updated
 */
export const closeVotingAndCalculateScores = async (partidoId) => {
  console.log('📊 SUPABASE: Starting closeVotingAndCalculateScores');
  
  try {
    // Step 1: Fetch votes for this match
    console.log('📊 SUPABASE: Step 1 - Fetching votes for match:', partidoId);
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
      sample: votos?.slice(0, 3) || []
    });
    
    // Step 2: Fetch all players
    console.log('📊 SUPABASE: Step 2 - Fetching players');
    const { data: jugadores, error: playerError } = await supabase
      .from('jugadores')
      .select('uuid, nombre, is_goalkeeper');
      
    if (playerError) {
      console.error('❌ SUPABASE: Error fetching players:', playerError);
      throw new Error('Error al obtener los jugadores: ' + playerError.message);
    }
    
    console.log('✅ SUPABASE: Players fetched:', {
      count: jugadores?.length || 0,
      players: jugadores?.map(j => ({ uuid: j.uuid, nombre: j.nombre })) || []
    });
    
    if (!jugadores || jugadores.length === 0) {
      console.warn('⚠️ SUPABASE: No players found');
      return { message: 'No hay jugadores para actualizar.' };
    }
    
    // Step 3: Group votes by player and check for goalkeepers
    console.log('📊 SUPABASE: Step 3 - Grouping votes by player');
    const votesByPlayer = {};
    const goalkeepers = new Set(); // Track players marked as goalkeepers
    let totalValidVotes = 0;
    let totalInvalidVotes = 0;
    
    if (votos && votos.length > 0) {
      for (const voto of votos) {
        if (!voto.votado_id) {
          console.warn('⚠️ SUPABASE: Vote without votado_id:', voto);
          totalInvalidVotes++;
          continue;
        }
        
        if (!votesByPlayer[voto.votado_id]) {
          votesByPlayer[voto.votado_id] = [];
        }
        
        if (voto.puntaje !== null && voto.puntaje !== undefined) {
          const score = Number(voto.puntaje);
          if (!isNaN(score)) {
            // Check if player is marked as goalkeeper (score -2)
            if (score === -2) {
              goalkeepers.add(voto.votado_id);
            } else {
              votesByPlayer[voto.votado_id].push(score);
            }
            totalValidVotes++;
          } else {
            console.warn('⚠️ SUPABASE: Invalid score:', voto.puntaje);
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
        votes: votes.filter(v => v !== -1) // Exclude "don't know" votes
      }))
    });
    
    // Step 4: Calculate averages and update scores
    console.log('📊 SUPABASE: Step 4 - Calculating averages and updating scores');
    const updates = [];
    const scoreUpdates = [];
    
    for (const jugador of jugadores) {
      const playerVotes = votesByPlayer[jugador.uuid] || [];
      const isGoalkeeper = goalkeepers.has(jugador.uuid);
      
      // Filter out "don't know" votes (-1) and goalkeeper votes (-2)
      const numericalVotes = playerVotes
        .map(p => Number(p))
        .filter(p => !isNaN(p) && p !== -1 && p !== -2 && p >= 1 && p <= 10);
        
      let avgScore = 5; // Default score
      if (numericalVotes.length > 0) {
        const total = numericalVotes.reduce((sum, val) => sum + val, 0);
        avgScore = Math.round((total / numericalVotes.length) * 100) / 100; // Round to 2 decimals
      }
      
      scoreUpdates.push({
        uuid: jugador.uuid,
        nombre: jugador.nombre,
        votes: numericalVotes,
        avgScore,
        isGoalkeeper
      });
      
      // Create update promise - update both score and goalkeeper status
      const updatePromise = supabase
        .from('jugadores')
        .update({ 
          score: avgScore,
          is_goalkeeper: isGoalkeeper
        })
        .eq('uuid', jugador.uuid);
        
      updates.push(updatePromise);
    }
    
    console.log('✅ SUPABASE: Score calculations:', scoreUpdates);
    
    // Execute all updates
    console.log('📊 SUPABASE: Executing score updates');
    const updateResults = await Promise.all(updates);
    const updateErrors = updateResults.filter(res => res.error);
    
    if (updateErrors.length > 0) {
      console.error('❌ SUPABASE: Score update errors:', updateErrors.map(e => e.error));
      throw new Error(`Error al actualizar los puntajes de ${updateErrors.length} jugadores.`);
    }
    
    console.log('✅ SUPABASE: All scores updated successfully');
    
    // Step 5: Clear votes for this match
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
      message: `Votación cerrada. Se actualizaron los puntajes de ${jugadores.length} jugadores.`,
      playersUpdated: jugadores.length,
      votesProcessed: totalValidVotes,
      votesCleared: deletedCount || votos?.length || 0
    };
    
    console.log('🎉 SUPABASE: closeVotingAndCalculateScores completed successfully:', result);
    return result;
    
  } catch (error) {
    console.error('❌ SUPABASE: closeVotingAndCalculateScores failed:', error);
    console.error('❌ SUPABASE: Error stack:', error.stack);
    throw error;
  }
};

// --- API de Partidos ---

export const crearPartido = async ({ fecha, hora, sede, sedeMaps, modalidad, cupo_jugadores, falta_jugadores, tipo_partido }) => {
  try {
    console.log('Creating match with data:', { fecha, hora, sede, sedeMaps });
    
    // Get user without throwing error if not authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.warn('Auth error (continuing as guest):', authError);
    }
    
    const codigo = generarCodigoPartido();
    console.log('Generated match code:', codigo);
    
    const matchData = {
      codigo,
      fecha,
      hora,
      sede,
      sedeMaps: sedeMaps || "",
      jugadores: [],
      estado: "activo",
      creado_por: user?.id || null,
      modalidad: modalidad || 'F5',
      cupo_jugadores: cupo_jugadores || 10,
      falta_jugadores: falta_jugadores || false,
      tipo_partido: tipo_partido || 'Masculino'
    };
    
    console.log('Inserting match data:', matchData);
    
    const { data, error } = await supabase
      .from("partidos")
      .insert([matchData])
      .select()
      .single();
    
    if (error) {
      console.error('Supabase insert error:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      
      if (error.code === '42501') {
        throw new Error('Permission denied. Please check Supabase RLS policies for partidos table.');
      }
      if (error.code === '23505') {
        throw new Error('Match code already exists. Please try again.');
      }
      
      throw new Error(`Error creating match: ${error.message}`);
    }
    
    console.log('Match created successfully:', data);
    
    // Actualizar el partido para que sea frecuente y su propio partido_frecuente_id sea igual a su id
    if (data && data.id) {
      const { error: updateError } = await supabase
        .from("partidos")
        .update({
          partido_frecuente_id: data.id,
          es_frecuente: true
        })
        .eq("id", data.id);
      
      if (updateError) {
        console.error('Error updating match as frequent:', updateError);
      } else {
        // Actualizar el objeto data con las nuevas propiedades
        data.partido_frecuente_id = data.id;
        data.es_frecuente = true;
      }
    }
    
    return data;
    
  } catch (error) {
    console.error('crearPartido failed:', error);
    throw error;
  }
};

const generarCodigoPartido = (length = 6) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++)
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

export const getPartidoPorCodigo = async (codigo) => {
  if (!codigo) throw new Error('Match code is required');
  const { data, error } = await supabase
    .from("partidos")
    .select("*")
    .eq("codigo", codigo)
    .single();
  if (error) throw new Error(`Error fetching match: ${error.message}`);
  return data;
};

export const updateJugadoresPartido = async (partidoId, nuevosJugadores) => {
  console.log('Updating match players:', { partidoId, count: nuevosJugadores.length });
  const { error } = await supabase
    .from("partidos")
    .update({ jugadores: nuevosJugadores })
    .eq("id", partidoId);
  if (error) throw error;
};

// New function to update frequent match players specifically
export const updateJugadoresFrecuentes = async (partidoFrecuenteId, nuevosJugadores) => {
  console.log('Updating frequent match players:', { partidoFrecuenteId, count: nuevosJugadores.length });
  return updatePartidoFrecuente(partidoFrecuenteId, {
    jugadores_frecuentes: nuevosJugadores
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
    tipo_partido: tipo_partido || 'Masculino'
  };
  
  const { data, error } = await supabase
    .from("partidos_frecuentes")
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
      .from("partidos_frecuentes")
      .select("*");
    
    console.log('All frequent matches in table:', allData);
    console.log('Count of all records:', allData?.length || 0);
    
    if (allError) {
      console.error('Error fetching all frequent matches:', allError);
    }
    
    // Now get only enabled ones
    const { data, error } = await supabase
      .from("partidos_frecuentes")
      .select("*")
      .eq("habilitado", true)
      .order("creado_en", { ascending: false });
      
    if (error) {
      console.error('Error fetching enabled frequent matches:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details
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
    updateData.jugadores_frecuentes = updates.jugadores_frecuentes.map(j => ({
      nombre: j.nombre,
      avatar_url: j.avatar_url || null, // Use only avatar_url
      uuid: j.uuid || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }));
  }
  
  const { data, error } = await supabase
    .from("partidos_frecuentes")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`Error updating frequent match: ${error.message}`);
  return data;
};

export const deletePartidoFrecuente = async (id) => {
  const { error } = await supabase
    .from("partidos_frecuentes")
    .update({ habilitado: false })
    .eq("id", id);
  if (error) throw new Error(`Error deleting frequent match: ${error.message}`);
};

export const crearPartidoDesdeFrec = async (partidoFrecuente, fecha, modalidad = 'F5', cupo = 10) => {
  console.log('Creating/finding match from frequent match:', partidoFrecuente, 'for date:', fecha);
  
  // First, check if a match already exists for this frequent match and date
  const { data: existingMatches, error: searchError } = await supabase
    .from('partidos')
    .select('*')
    .eq('fecha', fecha)
    .eq('sede', partidoFrecuente.sede)
    .eq('hora', partidoFrecuente.hora)
    .eq('estado', 'activo');
    
  if (searchError) {
    console.error('Error searching for existing match:', searchError);
  }
  
  // If we found an existing match, return it
  if (existingMatches && existingMatches.length > 0) {
    const existingMatch = existingMatches[0];
    console.log('Found existing match:', existingMatch.id);
    
    // Add frequent match metadata
    existingMatch.nombre = partidoFrecuente.nombre;
    existingMatch.frequent_match_name = partidoFrecuente.nombre;
    existingMatch.from_frequent_match_id = partidoFrecuente.id;
    
    return existingMatch;
  }
  
  // If no existing match, create a new one
  console.log('No existing match found, creating new one');
  const partido = await crearPartido({
    fecha,
    hora: partidoFrecuente.hora,
    sede: partidoFrecuente.sede,
    sedeMaps: "",
    modalidad,
    cupo_jugadores: cupo,
    falta_jugadores: false
  });
  
  // Add frequent match name, type, and reference
  partido.nombre = partidoFrecuente.nombre;
  partido.frequent_match_name = partidoFrecuente.nombre;
  partido.from_frequent_match_id = partidoFrecuente.id;
  partido.tipo_partido = partidoFrecuente.tipo_partido || 'Masculino';
  
  // Always copy the players from the frequent match, even if empty
  const jugadoresFrecuentes = partidoFrecuente.jugadores_frecuentes || [];
  
  if (jugadoresFrecuentes.length > 0) {
    // Clean player data - keep only nombre and foto_url
    const jugadoresLimpios = jugadoresFrecuentes.map(j => ({
      nombre: j.nombre,
      avatar_url: j.avatar_url || null, // Use only avatar_url
      uuid: j.uuid || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      score: j.score || 5 // Default score
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
    const keys = Object.keys(localStorage).filter(key => key.startsWith('guest_session'));
    keys.forEach(key => localStorage.removeItem(key));
    console.log(`Cleared ${keys.length} guest sessions`);
  }
};

// --- Amigos (Friends) API ---

/**
 * Get all friends for a user with status 'accepted'
 * @param {string} userId - Current user ID
 * @returns {Array} List of accepted friends
 */
export const getAmigos = async (userId) => {
  if (!userId) return [];
  
  try {
    // Get friends where current user is user_id
    const { data, error } = await supabase
      .from('amigos')
      .select(`
        id, 
        status, 
        created_at,
        friend_id,
        jugadores!friend_id(id, nombre, avatar_url, email, posicion, ranking, partidos_jugados, pais_codigo, numero, telefono, localidad)
      `)
      .eq('user_id', userId)
      .eq('status', 'accepted');
      
    if (error) throw error;
    
    // Also get friends where current user is friend_id
    const { data: reverseData, error: reverseError } = await supabase
      .from('amigos')
      .select(`
        id, 
        status, 
        created_at,
        user_id,
        jugadores!user_id(id, nombre, avatar_url, email, posicion, ranking, partidos_jugados, pais_codigo, numero, telefono, localidad)
      `)
      .eq('friend_id', userId)
      .eq('status', 'accepted');
      
    if (reverseError) throw reverseError;
    
    // Combine and format both sets of friends
    const formattedAmigos = [
      ...data.map(item => ({
        id: item.id,
        status: 'accepted',
        created_at: item.created_at,
        profile: item.jugadores
      })),
      ...reverseData.map(item => ({
        id: item.id,
        status: 'accepted',
        created_at: item.created_at,
        profile: item.jugadores
      }))
    ];
    
    return formattedAmigos;
  } catch (err) {
    console.error('Error fetching friends:', err);
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
        status: 'pending'
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
    
    return data.map(item => ({
      id: item.id,
      status: item.status,
      created_at: item.created_at,
      profile: item.jugadores
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
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) {
    console.error('getProfile error:', error);
    throw error;
  }
  
  console.log('getProfile result:', {
    data: data,
    avatar_url: data?.avatar_url,
    foto_url: data?.foto_url,
    all_fields: Object.keys(data || {})
  });
  
  return data;
};

export const updateProfile = async (userId, profileData) => {
  const completion = calculateProfileCompletion(profileData);
  
  const { data, error } = await supabase
    .from('usuarios')
    .update({ ...profileData, profile_completion: completion })
    .eq('id', userId)
    .select()
    .single();
  
  if (error) throw error;
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
    numero: null
  };

  // Actualizar metadata en Supabase Auth
  if (avatarUrl) {
    try {
      await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl }
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
    'bio'
  ];
  
  const filledFields = fields.filter(field => {
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
        localidad: 'Sin especificar'
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
          localidad: minimalProfile.localidad
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
      localidad: profile.localidad
    });
    
    const { error: insertError } = await supabase
      .from('jugadores_sin_partido')
      .insert([{
        user_id: user.id,
        nombre: profile.nombre || 'Usuario',
        localidad: profile.localidad || 'Sin especificar'
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
      allVoters: voters
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
      creado_en: new Date().toISOString()
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


