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
    console.log('[Notifications] query start - fetching match code');
    
    const { data: partido, error: partidoError } = await supabase
      .from('partidos')
      .select('codigo')
      .eq('id', partidoId)
      .single();
    
    if (partidoError) {
      console.error('[Notifications] query error', partidoError);
      throw partidoError;
    }
    
    console.log('[Notifications] query result', { matchCode: partido?.codigo });
    
    const { data: roster, error: rosterError } = await supabase
      .from('jugadores')
      .select('usuario_id')
      .eq('partido_id', partidoId);
    
    if (rosterError) {
      console.error('[Notifications] roster query error', rosterError);
      throw rosterError;
    }
    
    const userIds = (roster ?? [])
      .map(j => j.usuario_id)
      .filter(Boolean);

    if (userIds.length === 0) {
      console.log('[Notifications] empty roster, nothing to send');
      return { inserted: 0 };
    }

    const nowIso = new Date().toISOString();
    const rows = userIds.map(uid => ({
      user_id: uid,
      title,
      message,
      type,
      data: { matchId: partidoId, matchCode: partido.codigo },
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
    handleError(err, { showToast: true });
    throw err;
  }
}

/**
 * Programa notificación post-partido (encuesta)
 */
export async function schedulePostMatchNotification(matchId) {
  try {
    // Programar para 2 horas después del partido
    const sendAt = new Date();
    sendAt.setHours(sendAt.getHours() + 2);
    
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        type: 'post_match_survey',
        partido_id: matchId,
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
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        type: 'survey_results_ready',
        partido_id: matchId,
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
