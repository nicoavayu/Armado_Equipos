/**
 * Match Service
 * 
 * This service handles all match-related API operations including:
 * - Creating and updating matches
 * - Managing frequent matches
 * - Handling match players
 * - Voting operations
 */

import { supabase, getCurrentUserId, generarCodigoPartido } from './supabase';
import { toast } from 'react-toastify';

/**
 * Create a new match
 * @param {Object} matchData - Match data
 * @returns {Promise<Object>} Created match
 */
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
      .select()
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
    
    console.log('Match created successfully:', data);
    
    // Actualizar el partido para que sea frecuente y su propio partido_frecuente_id sea igual a su id
    if (data && data.id) {
      const { error: updateError } = await supabase
        .from('partidos')
        .update({
          partido_frecuente_id: data.id,
          es_frecuente: true,
        })
        .eq('id', data.id);
      
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

/**
 * Get a match by its code
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
 * Update players in a match
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
 * Update players in a frequent match
 * @param {number} partidoFrecuenteId - Frequent match ID
 * @param {Array} nuevosJugadores - New players array
 * @returns {Promise<Object>} Updated frequent match
 */
export const updateJugadoresFrecuentes = async (partidoFrecuenteId, nuevosJugadores) => {
  console.log('Updating frequent match players:', { partidoFrecuenteId, count: nuevosJugadores.length });
  return updatePartidoFrecuente(partidoFrecuenteId, {
    jugadores_frecuentes: nuevosJugadores,
  });
};

/**
 * Create a new frequent match template
 * @param {Object} matchData - Frequent match data
 * @returns {Promise<Object>} Created frequent match
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

/**
 * Get all enabled frequent matches
 * @returns {Promise<Array>} List of frequent matches
 */
export const getPartidosFrecuentes = async () => {
  console.log('Fetching frequent matches...');
  
  try {
    // Now get only enabled ones
    const { data, error } = await supabase
      .from('partidos_frecuentes')
      .select('*')
      .eq('habilitado', true)
      .order('creado_en', { ascending: false });
      
    if (error) {
      console.error('Error fetching enabled frequent matches:', error);
      throw new Error(`Error fetching frequent matches: ${error.message}`);
    }
    
    return data || [];
    
  } catch (err) {
    console.error('Exception in getPartidosFrecuentes:', err);
    throw err;
  }
};

/**
 * Update a frequent match
 * @param {number} id - Frequent match ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated frequent match
 */
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

/**
 * Delete a frequent match (soft delete by setting habilitado=false)
 * @param {number} id - Frequent match ID
 * @returns {Promise<void>}
 */
export const deletePartidoFrecuente = async (id) => {
  const { error } = await supabase
    .from('partidos_frecuentes')
    .update({ habilitado: false })
    .eq('id', id);
  if (error) throw new Error(`Error deleting frequent match: ${error.message}`);
};

/**
 * Create a match from a frequent match template
 * @param {Object} partidoFrecuente - Frequent match template
 * @param {string} fecha - Date for the new match
 * @param {string} modalidad - Match modality (default: 'F5')
 * @param {number} cupo - Player capacity (default: 10)
 * @returns {Promise<Object>} Created match
 */
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
    sedeMaps: '',
    modalidad,
    cupo_jugadores: cupo,
    falta_jugadores: false,
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

/**
 * Clear votes for a specific match
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
 * Delete a match and all its associated data (messages, votes)
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Result with success status
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
 * Get voters IDs for a specific match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array>} List of voter IDs
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
 * Get voters with names for a specific match
 * @param {number} partidoId - Match ID
 * @returns {Promise<Array>} List of voters with names
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
        avatar_url: voto.jugador_avatar_url, // Use avatar_url as the field name
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
 * Check if a user has already voted in a match
 * @param {string} votanteId - Voter ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} True if already voted, false otherwise
 */
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

/**
 * Submit votes for a match
 * @param {Object} votos - Votes object (key: player ID, value: score)
 * @param {string} jugadorUuid - Voter player UUID
 * @param {number} partidoId - Match ID
 * @param {string} jugadorNombre - Voter player name
 * @param {string} jugadorFoto - Voter player photo URL
 * @returns {Promise<Object>} Result of the operation
 */
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
        jugador_avatar_url: jugadorFoto || null, // Use only avatar_url field
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
 * Close voting phase and calculate player average scores
 * @param {number} partidoId - Match ID
 * @returns {Promise<Object>} Result message with number of players updated
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
      sample: votos?.slice(0, 3) || [],
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
      players: jugadores?.map((j) => ({ uuid: j.uuid, nombre: j.nombre })) || [],
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
        votes: votes.filter((v) => v !== -1), // Exclude "don't know" votes
      })),
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
        .map((p) => Number(p))
        .filter((p) => !isNaN(p) && p !== -1 && p !== -2 && p >= 1 && p <= 10);
        
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
        isGoalkeeper,
      });
      
      // Create update promise - update both score and goalkeeper status
      const updatePromise = supabase
        .from('jugadores')
        .update({ 
          score: avgScore,
          is_goalkeeper: isGoalkeeper,
        })
        .eq('uuid', jugador.uuid);
        
      updates.push(updatePromise);
    }
    
    console.log('✅ SUPABASE: Score calculations:', scoreUpdates);
    
    // Execute all updates
    console.log('📊 SUPABASE: Executing score updates');
    const updateResults = await Promise.all(updates);
    const updateErrors = updateResults.filter((res) => res.error);
    
    if (updateErrors.length > 0) {
      console.error('❌ SUPABASE: Score update errors:', updateErrors.map((e) => e.error));
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
 * Clean up invalid votes in the database
 * @returns {Promise<Object>} Result with counts of found and cleaned votes
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
 * Check if a match has been rated by a user
 * @param {number} partidoId - Match ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if rated, false otherwise
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

// Export all functions
export default {
  crearPartido,
  getPartidoPorCodigo,
  updateJugadoresPartido,
  updateJugadoresFrecuentes,
  crearPartidoFrecuente,
  getPartidosFrecuentes,
  updatePartidoFrecuente,
  deletePartidoFrecuente,
  crearPartidoDesdeFrec,
  clearVotesForMatch,
  deletePartido,
  getVotantesIds,
  getVotantesConNombres,
  checkIfAlreadyVoted,
  submitVotos,
  closeVotingAndCalculateScores,
  cleanupInvalidVotes,
  checkPartidoCalificado,
};