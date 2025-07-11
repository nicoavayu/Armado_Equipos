import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- API de Jugadores ---

export const getJugadores = async () => {
  const { data, error } = await supabase
    .from('jugadores')
    .select('id, uuid, nombre, foto_url, score')
    .order('nombre', { ascending: true });
  if (error) throw new Error(`Error fetching players: ${error.message}`);
  return data || [];
};

export const addJugador = async (nombre) => {
  const { data, error } = await supabase
    .from('jugadores')
    .insert([{ nombre, score: 5 }])
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

export const uploadFoto = async (file, jugador) => {
  const fileExt = file.name.split('.').pop();
  const fileName = `${jugador.uuid}_${Date.now()}.${fileExt}`;
  const { error: uploadError } = await supabase.storage
    .from('jugadores-fotos')
    .upload(fileName, file, { upsert: true });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage
    .from('jugadores-fotos')
    .getPublicUrl(fileName);
  const fotoUrl = data?.publicUrl;
  if (!fotoUrl) throw new Error('No se pudo obtener la URL pública de la foto.');
  const { error: updateError } = await supabase
    .from('jugadores')
    .update({ foto_url: fotoUrl })
    .eq('uuid', jugador.uuid);
  if (updateError) throw updateError;
  return fotoUrl;
};

// --- API de Votos ---

export const getVotantesIds = async () => {
  const { data, error } = await supabase.from('votos').select('votante_id');
  if (error) throw error;
  return Array.from(new Set((data || []).map(v => v.votante_id)));
};

export const checkIfAlreadyVoted = async (jugadorUuid) => {
  if (!jugadorUuid) return false;
  const { data, error } = await supabase
    .from('votos')
    .select('id')
    .eq('votante_id', jugadorUuid)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(`Error checking vote status: ${error.message}`);
  return !!data;
};

export const submitVotos = async (votos, jugadorUuid) => {
  const votosParaInsertar = Object.entries(votos)
    .filter(([, puntaje]) => puntaje !== undefined && puntaje !== null)
    .map(([votado_id, puntaje]) => ({
      votado_id,
      votante_id: jugadorUuid,
      puntaje,
    }));
  console.log("VOTOS PARA INSERTAR:", votosParaInsertar);
  if (votosParaInsertar.length === 0) {
    console.warn("No hay votos para insertar.");
    return;
  }
  const { error } = await supabase.from('votos').insert(votosParaInsertar);
  if (error) {
    console.error("Error insertando votos:", error);
    throw error;
  }
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

export const closeVotingAndCalculateScores = async () => {
  // 1. Traer todos los votos y jugadores
  const { data: votos, error: fetchError } = await supabase.from('votos').select('votado_id, puntaje');
  if (fetchError) throw new Error('Error al obtener los votos: ' + fetchError.message);

  const { data: jugadores, error: playerError } = await supabase.from('jugadores').select('uuid');
  if (playerError) throw new Error('Error al obtener los jugadores: ' + playerError.message);

  if (!jugadores || jugadores.length === 0) {
    return { message: 'No hay jugadores para actualizar.' };
  }

  // 2. Agrupar votos por jugador
  const votesByPlayer = {};
  if (votos) {
    for (const voto of votos) {
      if (!votesByPlayer[voto.votado_id]) {
        votesByPlayer[voto.votado_id] = [];
      }
      if (voto.puntaje !== null && voto.puntaje !== undefined) {
        votesByPlayer[voto.votado_id].push(voto.puntaje);
      }
    }
  }

  // 3. Calcular promedio y actualizar score de cada jugador
  const updates = jugadores.map(jugador => {
    const playerVotes = votesByPlayer[jugador.uuid] || [];
    // Solo promedia votos válidos, -1 = "no lo conozco"
    const numericalVotes = playerVotes
      .map(p => Number(p))
      .filter(p => p !== -1);
    let avgScore;
    if (numericalVotes.length > 0) {
      const total = numericalVotes.reduce((sum, val) => sum + val, 0);
      avgScore = total / numericalVotes.length;
    } else {
      avgScore = 5;
    }
    // Actualiza el score en la tabla jugadores
    return supabase
      .from('jugadores')
      .update({ score: avgScore })
      .eq('uuid', jugador.uuid);
  });

  const updateResults = await Promise.all(updates);
  const updateErrors = updateResults.filter(res => res.error);
  if (updateErrors.length > 0) {
    console.error('Error updating scores:', updateErrors.map(e => e.error));
    throw new Error(`Error al actualizar los puntajes de ${updateErrors.length} jugadores.`);
  }

  // 4. Limpiar votos (borra todos)
  const { error: deleteError } = await supabase
    .from('votos')
    .delete()
    .neq('id', -1);
  if (deleteError) {
    throw new Error('Puntajes actualizados, pero hubo un error al limpiar los votos: ' + deleteError.message);
  }

  return { message: `Votación cerrada. Se actualizaron los puntajes de ${updates.length} jugadores.` };
};

// --- API de Partidos ---

export const crearPartido = async ({ fecha, hora, sede, sedeMaps }) => {
  const codigo = generarCodigoPartido();
  const { data, error } = await supabase
    .from("partidos")
    .insert([
      {
        codigo,
        fecha,
        hora,
        sede,
        sedeMaps,
        jugadores: [],
        estado: "activo"
      }
    ])
    .select()
    .single();
  if (error) throw error;
  return data;
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
  const { error } = await supabase
    .from("partidos")
    .update({ jugadores: nuevosJugadores })
    .eq("id", partidoId);
  if (error) throw error;
};

// --- API de Partidos Frecuentes ---

export const crearPartidoFrecuente = async ({ nombre, sede, hora, jugadores_frecuentes, creado_por, dia_semana, habilitado, creado_en }) => {
  console.log('Creating frequent match with params:', { nombre, sede, hora, jugadores_frecuentes, creado_por, dia_semana, habilitado, creado_en });
  
  // Validate required fields
  if (!nombre || !sede || !hora || dia_semana === undefined) {
    const missingFields = [];
    if (!nombre) missingFields.push('nombre');
    if (!sede) missingFields.push('sede');
    if (!hora) missingFields.push('hora');
    if (dia_semana === undefined) missingFields.push('dia_semana');
    
    const errorMsg = `Missing required fields: ${missingFields.join(', ')}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  const insertData = {
    nombre: nombre.trim(),
    sede: sede.trim(),
    hora: hora.trim(),
    jugadores_frecuentes: jugadores_frecuentes || [],
    creado_por,
    creado_en: creado_en || new Date().toISOString(),
    habilitado: habilitado !== undefined ? habilitado : true,
    dia_semana: parseInt(dia_semana)
  };
  
  console.log('Inserting data into partidos_frecuentes:', insertData);
  
  const { data, error } = await supabase
    .from("partidos_frecuentes")
    .insert([insertData])
    .select()
    .single();
    
  if (error) {
    console.error('Supabase error creating frequent match:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint
    });
    throw new Error(`Error creating frequent match: ${error.message} (Code: ${error.code})`);
  }
  
  if (!data) {
    console.error('No data returned from insert operation');
    throw new Error('No data returned from frequent match creation');
  }
  
  console.log('Frequent match created successfully:', data);
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
  const { data, error } = await supabase
    .from("partidos_frecuentes")
    .update({
      ...updates,
      // Clean jugadores_frecuentes data
      jugadores_frecuentes: updates.jugadores_frecuentes?.map(j => ({
        nombre: j.nombre,
        foto_url: j.foto_url || null,
        uuid: j.uuid || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }))
    })
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

export const crearPartidoDesdeFrec = async (partidoFrecuente, fecha) => {
  const partido = await crearPartido({
    fecha,
    hora: partidoFrecuente.hora,
    sede: partidoFrecuente.sede,
    sedeMaps: ""
  });
  
  if (partidoFrecuente.jugadores_frecuentes?.length > 0) {
    // Clean player data - keep only nombre and foto_url
    const jugadoresLimpios = partidoFrecuente.jugadores_frecuentes.map(j => ({
      nombre: j.nombre,
      foto_url: j.foto_url || null,
      uuid: j.uuid || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }));
    
    await updateJugadoresPartido(partido.id, jugadoresLimpios);
    partido.jugadores = jugadoresLimpios;
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
