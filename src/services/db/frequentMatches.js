import { supabase } from '../../lib/supabaseClient';

/**
 * Creates a new frequent match template
 * @param {Object} matchData - Frequent match data
 * @returns {Promise<Object>} Created frequent match record
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
 * @returns {Promise<Array>} Array of frequent matches
 */
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

/**
 * Update a frequent match
 * @param {number} id - Frequent match ID
 * @param {Object} updates - Updates to apply
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
 * Delete (disable) a frequent match
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
 * @param {Object} partidoFrecuente - Frequent match data
 * @param {string} fecha - Match date
 * @param {string} modalidad - Match modality
 * @param {number} cupo - Player capacity
 * @returns {Promise<Object>} Created match
 */
export const crearPartidoDesdeFrec = async (partidoFrecuente, fecha, modalidad = 'F5', cupo = 10) => {
  console.log('Creating/finding match from frequent match:', partidoFrecuente, 'for date:', fecha);
  
  // Ensure date is in YYYY-MM-DD format without timezone conversion
  const normalizedDate = typeof fecha === 'string' ? fecha.split('T')[0] : fecha;
  
  // Get current user to make search more specific
  const { data: { user } } = await supabase.auth.getUser();
  
  // ALWAYS create a new match - no reuse of existing matches
  console.log('Creating fresh match - no reuse policy');
  
  console.log('Creating new match');
  const { crearPartido, updateJugadoresPartido } = await import('./matches');
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

/**
 * Update frequent match players specifically
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
 * Debug function to check table schema
 * @returns {Promise<Object>} Schema check results
 */
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