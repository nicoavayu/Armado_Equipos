import { supabase } from '../supabase';
import { finalizeIfComplete, computeAndPersistAwards, computeResultsAverages, setMatchAwardsStatus } from './surveyCompletionService';
import { hasAnyAwardData, isAwardsTrulyReady } from '../utils/awardsReadiness';

export async function computeAwardsForMatch(partidoId) {
  try {
    const { data, error } = await supabase.rpc('compute_awards_for_match', { partido_id: Number(partidoId) });
    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Ensure awards are computed for the match while respecting survey close rules.
export async function ensureAwards(partidoId) {
  try {
    const id = Number(partidoId);
    const normalizeToken = (value) => String(value || '').trim().toLowerCase();
    const normalizeSurveyStatus = (value) => {
      const token = normalizeToken(value);
      if (token === 'closed' || token === 'cerrada') return 'closed';
      if (token === 'open' || token === 'abierta') return 'open';
      return null;
    };
    const normalizeResultStatus = (value) => {
      const token = normalizeToken(value);
      if (!token) return null;
      if (token === 'finished' || token === 'played') return 'finished';
      if (token === 'draw' || token === 'empate') return 'draw';
      if (token === 'not_played' || token === 'cancelled' || token === 'cancelado') return 'not_played';
      if (token === 'pending' || token === 'pendiente') return 'pending';
      return null;
    };
    const withTimeout = async (promise, ms) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('ensureAwards timeout')), ms)),
      ]);
    };

    const isPendingRetryStatus = (row) => String(row?.awards_status || '').trim().toLowerCase() === 'pending_retry';

    const fetchSurveyResultsRow = async () => {
      const res = await supabase
        .from('survey_results')
        .select('*')
        .eq('partido_id', id)
        .maybeSingle();
      return { row: res.data || null, error: res.error || null };
    };

    const persistAwardsStatus = async (status) => {
      const statusRes = await setMatchAwardsStatus(id, status);
      if (!statusRes?.ok && !statusRes?.unsupported) {
        console.warn('[AWARDS] could not persist awards status', { partidoId: id, status, statusRes });
      }
    };

    // Gate: never force awards while the survey window is still open.
    let finalizeGate = null;
    try {
      finalizeGate = await finalizeIfComplete(id);
    } catch (_) {
      finalizeGate = null;
    }

    let { row: after, error: afterErr } = await fetchSurveyResultsRow();
    if (afterErr && afterErr.code !== 'PGRST116') {
      return { ok: false, error: afterErr };
    }

    if (finalizeGate?.done === false) {
      return {
        ok: true,
        row: after || null,
        applied: false,
        waiting: true,
        deadlineAt: finalizeGate?.deadlineAt || null,
      };
    }

    // Guardrail: if finalize gate failed or is inconclusive, don't compute awards while survey is still open.
    if (!finalizeGate || finalizeGate?.done !== true) {
      try {
        const { data: matchLifecycle, error: lifecycleErr } = await supabase
          .from('partidos')
          .select('survey_status, result_status')
          .eq('id', id)
          .maybeSingle();
        if (!lifecycleErr && matchLifecycle) {
          const surveyStatus = normalizeSurveyStatus(matchLifecycle.survey_status);
          const resultStatus = normalizeResultStatus(matchLifecycle.result_status);
          if (surveyStatus === 'open' || resultStatus === 'pending') {
            return {
              ok: true,
              row: after || null,
              applied: false,
              waiting: true,
            };
          }
        }
      } catch (_) {
        // Non-blocking.
      }
    }

    if (finalizeGate?.awardsSkipped) {
      return {
        ok: true,
        row: after || null,
        applied: false,
        awardsSkipped: true,
      };
    }

    if (after?.results_ready && isAwardsTrulyReady(after)) {
      if (isPendingRetryStatus(after)) {
        await persistAwardsStatus('ready');
        const refetchReady = await fetchSurveyResultsRow();
        after = refetchReady.row || after;
      }
      return { ok: true, row: after, applied: true };
    }

    let retryResult = null;
    const shouldRetryLocally = (
      isPendingRetryStatus(after)
      || (after?.results_ready && !isAwardsTrulyReady(after))
      || (!after && finalizeGate?.done === true)
    );

    if (shouldRetryLocally) {
      try {
        retryResult = await computeAndPersistAwards(id);
      } catch (retryErr) {
        retryResult = {
          persisted: false,
          reason: 'retry_exception',
          awardsCount: 0,
          error: retryErr,
        };
      }

      const refetchAfterRetry = await fetchSurveyResultsRow();
      after = refetchAfterRetry.row || after;
      afterErr = refetchAfterRetry.error;
      if (afterErr && afterErr.code !== 'PGRST116') {
        return { ok: false, error: afterErr };
      }

      if (after?.results_ready && isAwardsTrulyReady(after)) {
        await persistAwardsStatus('ready');
        const refetchReady = await fetchSurveyResultsRow();
        return {
          ok: true,
          row: refetchReady.row || after,
          applied: true,
          retried: true,
          retryResult,
        };
      }
    }

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

    const refetch = await fetchSurveyResultsRow();
    after = refetch.row;
    afterErr = refetch.error;
    if (afterErr && afterErr.code !== 'PGRST116') {
      return { ok: false, error: afterErr };
    }

    // Last-resort local recompute path for stale/inconsistent rows.
    if (after?.results_ready && !isAwardsTrulyReady(after)) {
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

          const refetch2 = await fetchSurveyResultsRow();
          after = refetch2.row || after;
        }
      } catch (_) {
        // non-blocking
      }
    }

    if (after?.results_ready && isAwardsTrulyReady(after)) {
      await persistAwardsStatus('ready');
      const refetchReady = await fetchSurveyResultsRow();
      return {
        ok: true,
        row: refetchReady.row || after,
        applied: true,
        retried: Boolean(retryResult),
        retryResult,
      };
    }

    if (after?.results_ready && !isAwardsTrulyReady(after)) {
      await persistAwardsStatus('pending_retry');
      return {
        ok: true,
        row: after || null,
        applied: false,
        pendingRetry: true,
        retried: Boolean(retryResult),
        retryResult,
      };
    }

    if (rpcErr && !after?.results_ready) {
      return { ok: false, error: rpcErr };
    }

    return {
      ok: true,
      row: after || null,
      applied: false,
      retried: Boolean(retryResult),
      retryResult,
    };
  } catch (err) {
    return { ok: false, error: err };
  }
}
