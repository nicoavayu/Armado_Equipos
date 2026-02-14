import { supabase } from '../supabase';
import { toBigIntId } from '../utils';
import { parseLocalDateTime } from '../utils/dateLocal';
import { SURVEY_FINALIZE_DELAY_MS, SURVEY_START_DELAY_MS } from '../config/surveyConfig';
import { getSurveyStartMessage } from '../utils/surveyNotificationCopy';

const isForeignKeyError = (error) => {
  if (!error) return false;
  const raw = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === '23503' || raw.includes('foreign key');
};

/**
 * Checks if a match has finished and sends survey notifications
 * @param {Object} partido - The match object
 * @returns {Promise<boolean>} - True if notifications were sent
 */
export const checkAndNotifyMatchFinish = async (partido) => {
  if (!partido || !partido.fecha || !partido.hora) return false;

  try {
    const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
    if (!partidoDateTime) return false;
    const now = new Date();

    // Encuesta habilitada tras delay configurable (debug: 1 minuto, prod: 1 hora).
    const surveyStartTime = new Date(partidoDateTime.getTime() + SURVEY_START_DELAY_MS);
    if (now < surveyStartTime) return false;

    const partidoId = Number(partido.id);
    if (!partidoId || Number.isNaN(partidoId)) return false;

    // Idempotencia: si ya existe una noti de encuesta, no reenviar.
    const { data: existingNotifications, error: existingError } = await supabase
      .from('notifications')
      .select('id')
      .eq('partido_id', partidoId)
      .in('type', ['survey_start', 'post_match_survey'])
      .limit(1);

    if (existingError) {
      console.warn('[MATCH_FINISH] Could not check existing survey notifications:', existingError);
    } else if ((existingNotifications || []).length > 0) {
      return false;
    }

    const nowIso = new Date().toISOString();
    const surveyDeadlineAt = new Date(new Date(nowIso).getTime() + SURVEY_FINALIZE_DELAY_MS).toISOString();
    const title = '¡Encuesta lista!';
    const message = getSurveyStartMessage({
      source: { created_at: nowIso, data: { survey_deadline_at: surveyDeadlineAt } },
      matchName: partido.nombre || formatMatchDate(partido.fecha) || 'este partido',
    });
    const payload = {
      match_id: partidoId,
      matchCode: partido.codigo || null,
      link: `/encuesta/${partidoId}`,
      partido_nombre: partido.nombre || null,
      partido_fecha: partido.fecha || null,
      partido_hora: partido.hora || null,
      partido_sede: partido.sede || null,
      survey_deadline_at: surveyDeadlineAt,
    };

    // Intentar camino canónico (RPC fanout para todos los logueados del partido).
    const { data: rpcData, error: rpcError } = await supabase.rpc('enqueue_partido_notification', {
      p_partido_id: partidoId,
      p_type: 'survey_start',
      p_title: title,
      p_message: message,
      p_payload: payload,
    });

    if (!rpcError) {
      const recipients = Number(rpcData?.recipients_count || 0);
      return recipients > 0;
    }

    if (rpcError?.code === '23505' || String(rpcError?.message || '').toLowerCase().includes('duplicate key')) {
      console.warn('[MATCH_FINISH] survey_start notification already exists, skipping fallback', rpcError);
      return false;
    }

    console.warn('[MATCH_FINISH] enqueue_partido_notification failed, using direct insert fallback:', rpcError);

    // Get all players in the match
    const { data: jugadores, error: playersError } = await supabase
      .from('jugadores')
      .select('usuario_id, nombre')
      .eq('partido_id', partidoId)
      .not('usuario_id', 'is', null);
      
    if (playersError) throw playersError;
    if (!jugadores || jugadores.length === 0) return false;

    const jugadoresValidos = [];
    const seenUserIds = new Set();
    for (const jugador of jugadores) {
      const uid = jugador?.usuario_id;
      if (!uid || seenUserIds.has(uid)) continue;
      seenUserIds.add(uid);
      jugadoresValidos.push(jugador);
    }
    if (jugadoresValidos.length === 0) return false;

    // Create survey notifications for each player
    const notifications = jugadoresValidos.map((jugador) => ({
      user_id: jugador.usuario_id,
      type: 'survey_start',
      title,
      message,
      partido_id: partidoId,
      match_ref: partidoId,
      data: {
        match_id: String(partidoId),
        // legacy for consumers aún no migrados
        matchId: partidoId,
        partido_id: partidoId,
        partido_nombre: partido.nombre,
        partido_fecha: partido.fecha,
        partido_hora: partido.hora,
        partido_sede: partido.sede,
        link: `/encuesta/${partidoId}`,
        survey_deadline_at: surveyDeadlineAt,
      },
      read: false,
      created_at: nowIso,
    }));

    // Insert notifications in bulk first; if one FK fails, retry by user to avoid blocking valid recipients.
    const { error: insertError } = await supabase
      .from('notifications')
      .insert(notifications);

    if (!insertError) {
      console.log(`Sent ${notifications.length} survey notifications for finished match ${partidoId}`);
      return true;
    }

    if (!isForeignKeyError(insertError)) throw insertError;

    console.warn('[MATCH_FINISH] Bulk notification insert failed due FK, retrying one by one:', insertError);

    let sentCount = 0;
    let skippedCount = 0;
    for (const notification of notifications) {
      const { error: singleError } = await supabase
        .from('notifications')
        .insert([notification]);

      if (!singleError) {
        sentCount += 1;
        continue;
      }

      if (isForeignKeyError(singleError)) {
        skippedCount += 1;
        continue;
      }

      throw singleError;
    }

    if (skippedCount > 0) {
      console.warn(`[MATCH_FINISH] Skipped ${skippedCount} recipients due missing auth user/profile linkage`);
    }

    if (sentCount > 0) {
      console.log(`Sent ${sentCount} survey notifications for finished match ${partidoId}`);
      return true;
    }

    return false;
    
  } catch (error) {
    console.error('Error checking and notifying match finish:', error);
    return false;
  }
};

/**
 * Clears a match from user's upcoming matches list
 * @param {string} userId - User ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} - Success status
 */
export const clearMatchFromList = async (userId, partidoId) => {
  if (!userId || !partidoId) return false;
  
  try {
    const { error } = await supabase
      .from('cleared_matches')
      .insert([{
        user_id: userId,
        partido_id: toBigIntId(partidoId),
      }]);
      
    if (error) {
      // Fallback to localStorage if table doesn't exist
      console.log('Using localStorage fallback for cleared matches');
      const key = `cleared_matches_${userId}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      if (!existing.includes(partidoId)) {
        existing.push(partidoId);
        localStorage.setItem(key, JSON.stringify(existing));
      }
      return true;
    }
    
    console.log(`Match ${partidoId} cleared from user ${userId}'s list`);
    return true;
    
  } catch (error) {
    console.error('Error clearing match from list, using localStorage fallback:', error);
    // Fallback to localStorage
    const key = `cleared_matches_${userId}`;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    if (!existing.includes(partidoId)) {
      existing.push(partidoId);
      localStorage.setItem(key, JSON.stringify(existing));
    }
    return true;
  }
};

/**
 * Checks if a match has been cleared by a user
 * @param {string} userId - User ID
 * @param {number} partidoId - Match ID
 * @returns {Promise<boolean>} - True if match was cleared
 */
export const isMatchCleared = async (userId, partidoId) => {
  if (!userId || !partidoId) return false;
  
  try {
    const { data, error } = await supabase
      .from('cleared_matches')
      .select('id')
      .eq('user_id', userId)
      .eq('partido_id', toBigIntId(partidoId))
      .single();
      
    if (error && error.code !== 'PGRST116') throw error;
    
    return !!data;
    
  } catch (error) {
    console.error('Error checking if match is cleared:', error);
    return false;
  }
};

/**
 * Formats match date for display
 * @param {string} fecha - Date string
 * @returns {string} - Formatted date
 */
const formatMatchDate = (fecha) => {
  try {
    return new Date(fecha).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'numeric',
    });
  } catch {
    return fecha;
  }
};
