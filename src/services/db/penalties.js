import { supabase } from '../../lib/supabaseClient';

/**
 * Get match players for penalty calculation
 * @param {number} matchId - Match ID
 * @returns {Promise<{data, error}>} Players data
 */
async function getMatchPlayers(matchId) {
  return await supabase
    .from('jugadores')
    .select('id, usuario_id, presente, asistio, present, estado, no_show')
    .eq('partido_id', matchId);
}

/**
 * Apply no-show penalties to registered players only
 * @param {number} matchId - Match ID
 * @returns {Promise<{data, error}>} Result with penalized players
 */
export async function applyNoShowPenalties(matchId) {
  const id = Number(matchId);
  const { data: players, error } = await getMatchPlayers(id);
  if (error) return { error };

  // Detect no-shows (present/asistio false/estado='absent'/no_show true)
  const noShows = (players || []).filter(p => {
    const present = (p.present ?? p.asistio ?? p.presente ?? (p.estado === 'present'));
    const isNoShow = (present === false) || p.no_show === true || p.estado === 'absent';
    const registered = !!p.usuario_id;
    return isNoShow && registered;
  });

  if (!noShows.length) return { data: [], error: null };

  // Register penalties (idempotent with UNIQUE constraint)
  const rows = noShows.map(p => ({ 
    match_id: id, 
    player_id: Number(p.id), 
    amount: -0.3 
  }));
  
  const { error: insertError } = await supabase
    .from('no_show_penalties')
    .upsert(rows, { onConflict: 'match_id,player_id' });
  
  if (insertError && !String(insertError.message || '').includes('duplicate')) {
    return { error: insertError };
  }

  // Apply ranking penalties - try profiles first, fallback to players
  const table = 'profiles';
  await Promise.allSettled(noShows.map(async p => {
    const pid = p.usuario_id; // Use usuario_id for profiles table
    if (!pid) return;
    
    try {
      // Try RPC function first
      await supabase.rpc('dec_numeric', { 
        p_table: table, 
        p_column: 'ranking', 
        p_id: pid, 
        p_amount: 0.3 
      });
    } catch (rpcError) {
      // Fallback: read current value and update
      const { data: curr } = await supabase
        .from(table)
        .select('ranking')
        .eq('id', pid)
        .single();
      
      const newVal = (curr?.ranking ?? 0) - 0.3;
      await supabase
        .from(table)
        .update({ ranking: newVal })
        .eq('id', pid);
    }
  }));

  return { data: noShows.map(p => p.usuario_id), error: null };
}