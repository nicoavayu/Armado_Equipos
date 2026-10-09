import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import logger from '../utils/logger';

// Survey closure, results and awards run in the client (finalizeIfComplete). The survey
// screen runs it right after saving, but that run can be cut short (the last voter closes
// the app) or fail, and only the match admin's app can close a survey (players cannot
// update partidos). The database lists the surveys this account administers that are due
// (20261010129000); any screen of the organizer's app finishes them with the same
// idempotent pipeline.

export const SURVEY_RECOVERY_START_DELAY_MS = 4000;
export const SURVEY_RECOVERY_INTERVAL_MS = 10 * 60 * 1000;

const isMissingRpc = (error) => ['PGRST202', '42883'].includes(String(error?.code || '').trim());

const loadFinalizeIfComplete = async () => (await import('../services/surveyCompletionService')).finalizeIfComplete;

/**
 * Finishes this account's due surveys. Returns how many it ran; never throws for a single
 * match (the next run retries it).
 */
export async function runSurveyFinalizationRecovery({ limit = 5, loadFinalize = loadFinalizeIfComplete } = {}) {
  const { data, error } = await supabase.rpc('list_my_pending_survey_finalizations', { p_limit: limit });
  if (error) {
    if (isMissingRpc(error)) return { processed: 0, total: 0, unsupported: true };
    throw error;
  }

  const matchIds = Array.from(new Set((data || [])
    .map((row) => Number(row?.partido_id))
    .filter((id) => Number.isFinite(id) && id > 0)));
  if (matchIds.length === 0) return { processed: 0, total: 0 };

  const finalizeIfComplete = await loadFinalize();
  let processed = 0;
  for (const matchId of matchIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await finalizeIfComplete(matchId);
      processed += 1;
    } catch (finalizeError) {
      logger.warn('[SURVEY_RECOVERY] finalize failed; it will be retried', { matchId, code: finalizeError?.code || null });
    }
  }
  return { processed, total: matchIds.length };
}

/** Runs the recovery a few seconds after sign-in and when the app comes back to the foreground. */
export function useSurveyFinalizationRecovery(userId) {
  const stateRef = useRef({ userId: null, lastRunAt: 0, running: false });

  useEffect(() => {
    if (!userId) return undefined;
    if (stateRef.current.userId !== userId) {
      stateRef.current = { userId, lastRunAt: 0, running: false };
    }
    let cancelled = false;

    const run = async () => {
      const state = stateRef.current;
      if (cancelled || state.running || state.userId !== userId) return;
      if (Date.now() - state.lastRunAt < SURVEY_RECOVERY_INTERVAL_MS) return;
      state.running = true;
      state.lastRunAt = Date.now();
      try {
        const result = await runSurveyFinalizationRecovery();
        if (result.total > 0) logger.info('[SURVEY_RECOVERY] finished due surveys', result);
      } catch (recoveryError) {
        logger.warn('[SURVEY_RECOVERY] could not list due surveys', { code: recoveryError?.code || null });
      } finally {
        state.running = false;
      }
    };

    const timer = setTimeout(run, SURVEY_RECOVERY_START_DELAY_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [userId]);
}

/** Mount point inside the signed-in app shell; renders nothing. */
export function SurveyFinalizationRecovery({ userId }) {
  useSurveyFinalizationRecovery(userId);
  return null;
}
