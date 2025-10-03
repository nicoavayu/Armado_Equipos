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
 * Schedule survey reminder notification for match end
 * @param {number} partidoId - Match ID
 * @param {string} partidoFechaISO - Match date in ISO format
 * @param {string} partidoHoraHHmm - Match time in HH:mm format
 * @returns {Promise<{data, error}>} Insert result
 */
export async function scheduleSurveyReminderForMatch(partidoId, partidoFechaISO, partidoHoraHHmm) {
  const now = new Date();
  const sendDate = isFastResults() 
    ? new Date(now.getTime() + 10 * 1000)
    : getMatchEndAt(partidoFechaISO, partidoHoraHHmm, Number(process.env.REACT_APP_MATCH_DURATION_MIN || process.env.NEXT_PUBLIC_MATCH_DURATION_MIN || 90));
  const send_at = sendDate.toISOString();

  const { data: players, error: playersErr } = await getMatchPlayers(partidoId);
  if (playersErr) return { error: playersErr };

  const rows = (players || [])
    .filter(p => p?.usuario_id)
    .map(p => ({
      user_id: p.usuario_id,
      type: 'survey_reminder',
      title: '¡Hora de calificar!',
      message: 'Completá la encuesta del partido.',
      data: { matchId: Number(partidoId) },
      send_at,
      status: 'pending',
      created_at: now.toISOString(),
    }));

  if (!rows.length) return { data: [], error: null };

  return await supabase.from('notifications').insert(rows).select('id');
}

/**
 * Borra TODAS las notificaciones del usuario autenticado (server-side con RPC).
 * Requiere función SQL: public.delete_my_notifications()
 * @returns {Promise<{data,error}>}
 */
export async function deleteMyNotifications() {
  return await supabase.rpc('delete_my_notifications');
}