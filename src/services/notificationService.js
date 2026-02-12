import { supabase } from '../supabase';
import { handleError } from '../lib/errorHandler';
import logger from '../utils/logger';

/**
 * Get match invite notification for a user and match
 * @param {string} userId - User ID
 * @param {string|number} partidoId - Match ID
 * @returns {Promise<{data, error}>}
 */
export async function getMatchInviteNotification(userId, partidoId) {
  // Validate inputs to prevent 400 errors
  if (!userId || !partidoId || partidoId === 'undefined' || partidoId === 'null') {
    logger.warn('[NOTIFICATION_SERVICE] Invalid userId or partidoId', { userId, partidoId });
    return { data: null, error: { message: 'Invalid parameters' } };
  }

  logger.log('[NOTIFICATION_SERVICE] Querying match invite', { userId, partidoId });

  return supabase
    .from('notifications_ext')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'match_invite')
    .eq('read', false)
    .eq('match_id_text', String(partidoId));
}

/**
 * Envía notificaciones a los usuarios registrados (jugadores) de un partido.
 * @param {string|number} partidoId
 * @param {{title?: string, message?: string, type?: string}} meta
 */
export async function sendVotingNotifications(partidoId, meta = {}) {
  const title = meta.title ?? '¡Hora de votar!';
  const message = meta.message ?? 'Entrá a la app y calificá a los jugadores para armar los equipos.';
  const type = meta.type ?? 'call_to_vote';

  logger.log('[CallToVote] start', { partidoId, type });

  try {
    // Fetch partido metadata early to decide whether to proceed
    let partidoMeta = null;
    let partidoMetaError = null;

    try {
      const res = await supabase
        .from('partidos')
        .select('codigo, survey_scheduled, survey_time')
        .eq('id', partidoId)
        .single();
      partidoMeta = res.data;
      partidoMetaError = res.error;
    } catch (e) {
      // supabase client can throw in some environments
      partidoMetaError = e;
    }

    if (partidoMetaError) {
      // If the error is due to missing column (e.g. 42703), fallback to minimal query
      const isMissingColumn = String(partidoMetaError.code || partidoMetaError.message || '').includes('42703') || String(partidoMetaError.message || '').toLowerCase().includes('does not exist');
      if (isMissingColumn) {
        logger.warn('[Notifications] partido survey column missing, falling back to minimal metadata query', { partidoId, error: partidoMetaError });
        try {
          const fallback = await supabase
            .from('partidos')
            .select('codigo')
            .eq('id', partidoId)
            .single();
          partidoMeta = { codigo: fallback.data?.codigo, survey_scheduled: false };
        } catch (fallbackErr) {
          console.error('[Notifications] fallback partido query failed', fallbackErr);
          // Give up but don't crash the whole app: set sensible defaults
          partidoMeta = { codigo: null, survey_scheduled: false };
        }
      } else {
        console.error('[Notifications] error fetching partido metadata', partidoMetaError);
        throw partidoMetaError;
      }
    }

    // If the partido already has a scheduled survey, skip sending call_to_vote
    if (partidoMeta?.survey_scheduled) {
      logger.log('[Notifications] partido already has survey_scheduled=true, skipping call_to_vote', { partidoId });
      return { inserted: 0, skippedDueToSurveyScheduled: true };
    }

    // --- NEW: also check if there's already a survey-related notification for this partido, skip if present ---
    const orExpr = `partido_id.eq.${partidoId},data->>match_id.eq.${String(partidoId)},data->>matchId.eq.${String(partidoId)}`;
    const { data: existingSurvey, error: existingError } = await supabase
      .from('notifications')
      .select('id')
      .or(orExpr)
      .in('type', ['survey_start', 'post_match_survey', 'survey_reminder'])
      .limit(1);

    if (existingError) {
      console.error('[Notifications] error checking existing survey notifications', existingError);
      throw existingError;
    }

    if (existingSurvey && existingSurvey.length > 0) {
      logger.log('[Notifications] Survey notification exists for partido, skipping call_to_vote', { partidoId });
      return { inserted: 0, skippedDueToSurvey: true };
    }
    // --- END NEW ---

    logger.log('[Notifications] query result', { matchCode: partidoMeta?.codigo });

    // --- USE RPC FOR SECURE NOTIFICATION SENDING ---
    const { data: rpcResult, error: rpcError } = await supabase.rpc('send_call_to_vote', {
      p_partido_id: Number(partidoId),
      p_title: title,
      p_message: message
    });

    if (rpcError) {
      // Duplicate notification for same user/match/type should not block the flow.
      if (rpcError.code === '23505' || String(rpcError.message || '').toLowerCase().includes('duplicate key')) {
        logger.warn('[Notifications] call_to_vote already exists (duplicate), treating as started', {
          partidoId,
          error: rpcError,
        });
        return { inserted: 0, alreadyExists: true };
      }
      console.error('[Notifications] RPC error', rpcError);
      throw rpcError;
    }

    logger.log('[CallToVote] success', rpcResult);

    // Normalize RPC result to expected format
    if (rpcResult && rpcResult.success) {
      return { inserted: rpcResult.inserted };
    } else {
      // Handle cases where RPC returns success: false (e.g. survey already exists)
      logger.log('[CallToVote] RPC skipped insertion:', rpcResult?.reason);
      return { inserted: 0, reason: rpcResult?.reason };
    }
  } catch (err) {
    console.error('[CallToVote] failed', err);
    handleError(err, { showToast: true, onError: () => { } });
    // Return a failure object so caller can handle it instead of only throwing
    return { inserted: 0, error: err };
  }
}

/**
 * Programa notificación post-partido (encuesta)
 */
export async function schedulePostMatchNotification(matchId) {
  try {
    // Canonical guard: if DB is canonical, do not schedule from JS
    const SURVEY_FANOUT_MODE = process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE || 'db';
    if (SURVEY_FANOUT_MODE === 'db') {
      logger.log('[Notify] schedulePostMatchNotification skipped because SURVEY_FANOUT_MODE=db');
      return null;
    }

    // Programar para 2 horas después del partido
    const sendAt = new Date();
    sendAt.setHours(sendAt.getHours() + 2);
    const pidNumber = Number(matchId);
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        type: 'survey_start',
        partido_id: pidNumber,
        match_ref: pidNumber,
        status: 'pending',
        send_at: sendAt.toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[Notify] schedulePostMatchNotification failed', err);
    throw err;
  }
}

/**
 * Fuerza resultados de encuesta ahora (para testing)
 */
export async function forceSurveyResultsNow(matchId) {
  try {
    const pidNumber = Number(matchId);
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        type: 'survey_results_ready',
        partido_id: pidNumber,
        match_ref: pidNumber,
        status: 'pending',
        send_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[Notify] forceSurveyResultsNow failed', err);
    throw err;
  }
}
