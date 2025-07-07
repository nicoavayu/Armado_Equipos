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
  // Delete player from 'jugadores' table
  const { error: playerError } = await supabase.from('jugadores').delete().eq('uuid', uuid);
  if (playerError) throw playerError;

  // Also delete all votes associated with this player (both as voter and as voted)
  const { error: votesAsVoterError } = await supabase.from('votos').delete().eq('votante_id', uuid);
  if (votesAsVoterError) console.error("Error deleting player's cast votes:", votesAsVoterError);

  const { error: votesAsVotadoError } = await supabase.from('votos').delete().eq('votado_id', uuid);
  if (votesAsVotadoError) console.error("Error deleting player's received votes:", votesAsVotadoError);
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
  // 1. Fetch all votes and all players
  const { data: votos, error: fetchError } = await supabase.from('votos').select('votado_id, puntaje');
  if (fetchError) throw new Error('Error al obtener los votos: ' + fetchError.message);

  const { data: jugadores, error: playerError } = await supabase.from('jugadores').select('uuid');
  if (playerError) throw new Error('Error al obtener los jugadores: ' + playerError.message);

  if (!jugadores || jugadores.length === 0) {
    return { message: 'No hay jugadores para actualizar.' };
  }

  // 2. Group votes by player
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

  // 3. Iterate over ALL players and calculate scores
  const updates = jugadores.map(jugador => {
    const playerVotes = votesByPlayer[jugador.uuid] || [];
    
    // Filter out non-numerical votes (-1) and ensure all values are numbers
    const numericalVotes = playerVotes
      .map(p => Number(p))
      .filter(p => p !== -1);

    let avgScore;
    if (numericalVotes.length > 0) {
      // If there are any numerical votes, calculate the average
      const total = numericalVotes.reduce((sum, val) => sum + val, 0);
      avgScore = total / numericalVotes.length;
    } else {
      // Otherwise (no votes, or only "No lo conozco" votes), default to 5
      avgScore = 5;
    }

    return supabase
      .from('jugadores')
      .update({ score: avgScore })
      .eq('uuid', jugador.uuid);
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
