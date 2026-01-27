import { supabase } from '../supabase';
import { handleError } from '../lib/errorHandler';

/**
 * Get match invite notification for a user and match
 * @param {string} userId - User ID
 * @param {string|number} partidoId - Match ID
 * @returns {Promise<{data, error}>}
 */
export async function getMatchInviteNotification(userId, partidoId) {
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

  console.log('[CallToVote] start', { partidoId, type });

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
        console.warn('[Notifications] partido survey column missing, falling back to minimal metadata query', { partidoId, error: partidoMetaError });
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
      console.log('[Notifications] partido already has survey_scheduled=true, skipping call_to_vote', { partidoId });
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
      console.log('[Notifications] Survey notification exists for partido, skipping call_to_vote', { partidoId });
      return { inserted: 0, skippedDueToSurvey: true };
    }
    // --- END NEW ---

    console.log('[Notifications] query result', { matchCode: partidoMeta?.codigo });

    const { data: roster, error: rosterError } = await supabase
      .from('jugadores')
      .select('usuario_id')
      .eq('partido_id', partidoId);

    if (rosterError) {
      console.error('[Notifications] roster query error', rosterError);
      throw rosterError;
    }

    const userIds = (roster ?? [])
      .map((j) => j.usuario_id)
      .filter(Boolean);

    if (userIds.length === 0) {
      console.log('[Notifications] empty roster, nothing to send');
      return { inserted: 0 };
    }

    const nowIso = new Date().toISOString();
    const pidNumber = Number(partidoId);
    const rows = userIds.map((uid) => ({
      user_id: uid,
      title,
      message,
      type,
      partido_id: pidNumber,
      // Do not insert match_ref explicitly; let DB defaults/computed columns handle it
      data: { match_id: String(partidoId), matchId: pidNumber, matchCode: partidoMeta?.codigo },
      read: false,
      created_at: nowIso,
      send_at: nowIso,
    }));

    console.log('[Notifications] inserting', { count: rows.length, sampleData: rows[0]?.data });

    const { data, error } = await supabase
      .from('notifications')
      .insert(rows)
      .select();

    if (error) {
      console.error('[Notifications] insert error', error);
      throw error;
    }

    console.log('[CallToVote] success', { inserted: data?.length });
    return { inserted: data?.length || 0 };
  } catch (err) {
    console.error('[CallToVote] failed', err);
    handleError(err, { showToast: true, onError: () => {} });
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
      console.log('[Notify] schedulePostMatchNotification skipped because SURVEY_FANOUT_MODE=db');
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
