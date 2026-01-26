import { supabase } from '../supabase';

export async function computeAwardsForMatch(partidoId) {
  try {
    const { data, error } = await supabase.rpc('compute_awards_for_match', { partido_id: Number(partidoId) });
    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Ensure awards are computed for the match. This is a light client-side wrapper
// that calls the DB RPC. Notifications to users are handled server-side by the
// cron/job (process_awards_for_matches) and by the compute_awards_for_match RPC itself.
export async function ensureAwards(partidoId) {
  try {
    // Call server RPC to compute/persist awards (idempotent server implementation expected)
    const { data: rpcData, error: rpcErr } = await supabase.rpc('compute_awards_for_match', { partido_id: Number(partidoId) });
    if (rpcErr) return { ok: false, error: rpcErr };

    // Re-select persisted survey_results for the UI
    const { data: after, error: afterErr } = await supabase
      .from('survey_results')
      .select('*')
      .eq('partido_id', partidoId)
      .single();

    if (afterErr && afterErr.code !== 'PGRST116') {
      return { ok: false, error: afterErr };
    }

    return { ok: true, row: after || null, applied: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}
