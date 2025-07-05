import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- API de Jugadores ---

export const getJugadores = async () => {
  const { data, error } = await supabase
    .from('jugadores')
    .select('id, uuid, nombre, foto_url, score') // Corregido a 'score'
    .order('nombre', { ascending: true });
  if (error) throw error;
  return data;
};

export const addJugador = async (nombre) => {
  console.log(`[Supabase] Recibido para insertar: ${nombre}`);
  const { data, error } = await supabase
    .from('jugadores')
    .insert([{ nombre, score: 5 }]) // Corregido a 'score'
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] Error al insertar:', error);
    throw error;
  }
  
  console.log('[Supabase] Datos insertados:', data);
  return data;
};

export const deleteJugador = async (uuid) => {
  const { error } = await supabase.from('jugadores').delete().eq('uuid', uuid);
  if (error) throw error;
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
    .filter(([, puntaje]) => puntaje !== undefined)
    .map(([votado_id, puntaje]) => ({
      votado_id,
      votante_id: jugadorUuid,
      puntaje,
    }));

  if (votosParaInsertar.length === 0) return;

  const { error } = await supabase.from('votos').insert(votosParaInsertar);
  if (error) throw error;
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

export const closeVotingAndCalculateScores = async () => {
  // 1. Fetch all votes
  const { data: votos, error: fetchError } = await supabase
    .from('votos')
    .select('votado_id, puntaje');

  if (fetchError) throw new Error('Error al obtener los votos: ' + fetchError.message);
  
  if (!votos || votos.length === 0) {
    return { message: 'No hay votos para calcular. La votación ha sido cerrada.' };
  }

  // 2. Calculate average scores
  const scores = {}; // { votado_id: { total: score, count: num_votes } }
  for (const voto of votos) {
    if (!scores[voto.votado_id]) {
      scores[voto.votado_id] = { total: 0, count: 0 };
    }
    scores[voto.votado_id].total += voto.puntaje;
    scores[voto.votado_id].count += 1;
  }

  const updates = Object.entries(scores).map(([votado_id, data]) => {
    const avgScore = data.count > 0 ? data.total / data.count : 5;
    return supabase
      .from('jugadores')
      .update({ score: avgScore }) // Corregido a 'score'
      .eq('uuid', votado_id);
  });

  // 3. Update player scores in the database
  const updateResults = await Promise.all(updates);
  const updateErrors = updateResults.filter(res => res.error);
  if (updateErrors.length > 0) {
    console.error('Error updating scores:', updateErrors.map(e => e.error));
    throw new Error(`Error al actualizar los puntajes de ${updateErrors.length} jugadores.`);
  }

  // 4. Delete all votes
  const { error: deleteError } = await supabase
    .from('votos')
    .delete()
    .neq('id', -1); // Trick to delete all rows

  if (deleteError) {
    throw new Error('Puntajes actualizados, pero hubo un error al limpiar los votos: ' + deleteError.message);
  }

  return { message: `Votación cerrada. Se actualizaron los puntajes de ${updates.length} jugadores.` };
};
