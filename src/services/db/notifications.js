import { supabase } from '../../lib/supabaseClient';
import { getMatchEndAt } from '../../lib/postMatchTime';
import { isFastResults } from '../../lib/resultsDelay';

/**
 * Get match players for notifications
 * @param {number} partidoId - Match ID
 * @returns {Promise<{data, error}>} Players data
 */
export async function getMatchPlayers(partidoId) {
  return await supabase
    .from('jugadores')
    .select('usuario_id')
    .eq('partido_id', partidoId)
    .not('usuario_id', 'is', null);
}

/**
 * DEPRECATED: Survey notifications are now handled by fanout_survey_start_notifications() cron job
 * This function is kept for backward compatibility but should not be used for new matches
 * @deprecated Use fanout_survey_start_notifications() SQL function instead
 */
export async function scheduleSurveyReminderForMatch(partidoId, partidoFechaISO, partidoHoraHHmm) {
  console.warn('[DEPRECATED] scheduleSurveyReminderForMatch is deprecated. Survey notifications are handled by cron job.');
  return { data: [], error: null };
}

/**
 * Borra TODAS las notificaciones del usuario autenticado (server-side con RPC).
 * Requiere función SQL: public.delete_my_notifications()
 * @returns {Promise<{data,error}>}
 */
export async function deleteMyNotifications() {
  return await supabase.rpc('delete_my_notifications');
}