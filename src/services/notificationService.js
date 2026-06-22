import { supabase } from '../supabase';
import { handleError } from '../lib/errorHandler';
import { requestImmediatePushDispatchSafe } from './pushDispatchService';
import logger from '../utils/logger';
import { isChallengeLikeTeamMatchRow } from '../utils/surveyChallengePolicy';

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
    let partidoMeta = { codigo: null };

    try {
      const { data: partidoData, error: partidoMetaError } = await supabase
        .from('partidos')
        .select('codigo')
        .eq('id', partidoId)
        .single();

      if (partidoMetaError) {
        logger.error('[Notifications] error fetching partido metadata', partidoMetaError);
        throw partidoMetaError;
      }

      partidoMeta = { codigo: partidoData?.codigo ?? null };
    } catch (partidoMetaError) {
      logger.error('[Notifications] fallback partido query failed', partidoMetaError);
      partidoMeta = { codigo: null };
    }

    // --- NEW: also check if there's already a survey-related notification for this partido, skip if present ---
    const orExpr = `partido_id.eq.${partidoId},data->>match_id.eq.${String(partidoId)},data->>matchId.eq.${String(partidoId)}`;
    const { data: existingSurvey, error: existingError } = await supabase
      .from('notifications')
      .select('id')
      .or(orExpr)
      .in('type', ['survey_start', 'post_match_survey', 'survey_reminder', 'survey_reminder_12h'])
      .limit(1);

    if (existingError) {
      logger.error('[Notifications] error checking existing survey notifications', existingError);
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
        logger.log('[CallToVote] triggering immediate push dispatch after duplicate', {
          partidoId,
          eventType: 'call_to_vote',
        });
        requestImmediatePushDispatchSafe({
          eventType: 'call_to_vote',
          matchId: Number(partidoId),
          limit: 50,
        });
        return { inserted: 0, alreadyExists: true };
      }
      logger.error('[Notifications] RPC error', rpcError);
      throw rpcError;
    }

    logger.log('[CallToVote] success', rpcResult);

    // Normalize RPC result to expected format
    if (rpcResult && rpcResult.success) {
      logger.log('[CallToVote] triggering immediate push dispatch', {
        partidoId,
        eventType: 'call_to_vote',
      });
      requestImmediatePushDispatchSafe({
        eventType: 'call_to_vote',
        matchId: Number(partidoId),
        limit: 50,
      });
      return { inserted: rpcResult.inserted };
    } else {
      // Handle cases where RPC returns success: false (e.g. survey already exists)
      logger.log('[CallToVote] RPC skipped insertion:', rpcResult?.reason);
      return {
        inserted: 0,
        reason: rpcResult?.reason,
        skippedDueToSurvey: rpcResult?.reason === 'survey_exists',
        matchAssumedNotPlayed: rpcResult?.match_assumed_not_played === true,
        modalidad: rpcResult?.modalidad ?? null,
        cupoJugadores: rpcResult?.cupo_jugadores ?? null,
        starterSlots: rpcResult?.starter_slots ?? null,
        requiredPlayers: rpcResult?.required_players ?? null,
        rosterCount: rpcResult?.roster_count ?? null,
        registeredRosterCount: rpcResult?.registered_roster_count ?? null,
      };
    }
  } catch (err) {
    logger.error('[CallToVote] failed', err);
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
    const SURVEY_FANOUT_MODE =
      process.env.REACT_APP_SURVEY_FANOUT_MODE
      || process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE
      || 'db';
    if (SURVEY_FANOUT_MODE === 'db') {
      logger.log('[Notify] schedulePostMatchNotification skipped because SURVEY_FANOUT_MODE=db');
      return null;
    }

    // Programar para 2 horas después del partido
    const sendAt = new Date();
    sendAt.setHours(sendAt.getHours() + 2);
    const pidNumber = Number(matchId);
    try {
      const { data: teamMatchRow } = await supabase
        .from('team_matches')
        .select('id, origin_type, challenge_id')
        .eq('partido_id', pidNumber)
        .maybeSingle();
      if (isChallengeLikeTeamMatchRow(teamMatchRow)) {
        logger.log('[Notify] schedulePostMatchNotification skipped for challenge/team_match', { matchId: pidNumber });
        return null;
      }
    } catch (_teamMatchError) {
      // Non-blocking for legacy environments without team_matches.
    }

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
    logger.error('[Notify] schedulePostMatchNotification failed', err);
    throw err;
  }
}

/**
 * Fuerza resultados de encuesta ahora (para testing)
 */
export async function forceSurveyResultsNow(matchId) {
  logger.warn('[Notify] forceSurveyResultsNow is disabled to prevent premature readiness notifications', { matchId });
  return { skipped: true, reason: 'disabled_premature_readiness_signal' };
}
