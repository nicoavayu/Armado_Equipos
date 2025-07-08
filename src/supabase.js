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
  if (error) throw error;
  return data;
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
  const { data, error } = await supabase
    .from('votos')
    .select('id')
    .eq('votante_id', jugadorUuid)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
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

function generarCodigoPartido(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++)
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

export const getPartidoPorCodigo = async (codigo) => {
  const { data, error } = await supabase
    .from("partidos")
    .select("*")
    .eq("codigo", codigo)
    .single();
  if (error) throw error;
  return data;
};

export const updateJugadoresPartido = async (partidoId, nuevosJugadores) => {
  const { error } = await supabase
    .from("partidos")
    .update({ jugadores: nuevosJugadores })
    .eq("id", partidoId);
  if (error) throw error;
};


export const crearPartidoFrecuente = async ({
  nombre, dia_semana, hora, sede, jugadores_frecuentes, creado_por
}) => {
  const { data, error } = await supabase
    .from("partidos_frecuentes")
    .insert([{ nombre, dia_semana, hora, sede, jugadores_frecuentes, creado_por }])
    .select()
    .single();
  if (error) throw error;
  return data;
};


export const getPartidosFrecuentes = async () => {
  const { data, error } = await supabase
    .from("partidos_frecuentes")
    .select("*");
  if (error) throw error;
  return data;
};