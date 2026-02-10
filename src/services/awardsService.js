import { supabase } from '../supabase';
import { finalizeIfComplete, computeResultsAverages } from './surveyCompletionService';

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
    const id = Number(partidoId);
    const hasAnyAwardData = (row) => Boolean(
      row?.mvp ||
      row?.golden_glove ||
      row?.dirty_player ||
      (Array.isArray(row?.red_cards) && row.red_cards.length > 0) ||
      row?.awards?.mvp?.player_id ||
      row?.awards?.best_gk?.player_id ||
      row?.awards?.red_card?.player_id,
    );

    const withTimeout = async (promise, ms) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('ensureAwards timeout')), ms)),
      ]);
    };

    // Call server RPC if available (some environments don't have this function deployed).
    let rpcErr = null;
    try {
      const rpcRes = await withTimeout(
        supabase.rpc('compute_awards_for_match', { partido_id: id }),
        2000,
      );
      rpcErr = rpcRes?.error || null;
      const rpcMsg = `${rpcErr?.message || ''} ${rpcErr?.code || ''}`.toLowerCase();
      if (rpcErr && (rpcMsg.includes('404') || rpcMsg.includes('not found') || rpcMsg.includes('does not exist'))) {
        rpcErr = null; // treat missing RPC as optional; fallback path below handles computation
      }
    } catch (e) {
      rpcErr = e;
    }

    // Re-select persisted survey_results for the UI
    let { data: after, error: afterErr } = await supabase
      .from('survey_results')
      .select('*')
      .eq('partido_id', id)
      .single();

    if (afterErr && afterErr.code !== 'PGRST116') {
      return { ok: false, error: afterErr };
    }

    // If RPC didn't produce ready results yet, trigger client finalization path
    // (idempotent, and in debug closes as soon as min votes threshold is reached).
    if (!after || !after.results_ready || !hasAnyAwardData(after)) {
      try {
        await finalizeIfComplete(id, { fastResults: true, skipSideEffects: true });
      } catch (_) {
        // non-blocking fallback
      }

      const refetch = await supabase
        .from('survey_results')
        .select('*')
        .eq('partido_id', id)
        .single();
      after = refetch.data || null;
      afterErr = refetch.error || null;
      if (afterErr && afterErr.code !== 'PGRST116') {
        return { ok: false, error: afterErr };
      }
    }

    // Last-resort local recompute path for stale/inconsistent rows.
    if (after?.results_ready && !hasAnyAwardData(after)) {
      try {
        const computed = await computeResultsAverages(id);
        if (hasAnyAwardData(computed)) {
          let upsertRes = await supabase
            .from('survey_results')
            .upsert({
              partido_id: id,
              ...computed,
              results_ready: true,
            }, { onConflict: 'partido_id' });

          if (upsertRes.error) {
            upsertRes = await supabase
              .from('survey_results')
              .upsert({
                partido_id: id,
                mvp: computed?.mvp ?? null,
                golden_glove: computed?.golden_glove ?? null,
                results_ready: true,
              }, { onConflict: 'partido_id' });
          }

          const refetch2 = await supabase
            .from('survey_results')
            .select('*')
            .eq('partido_id', id)
            .single();
          after = refetch2.data || after;
        }
      } catch (_) {
        // non-blocking
      }
    }

    if (rpcErr && !after?.results_ready) {
      return { ok: false, error: rpcErr };
    }

    return { ok: true, row: after || null, applied: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}
