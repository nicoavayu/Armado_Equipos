import { supabase } from '../supabase';
import { toBigIntId } from '../utils';
import { parseLocalDateTime } from '../utils/dateLocal';
import { SURVEY_FINALIZE_DELAY_MS, SURVEY_REMINDER_LEAD_MS, SURVEY_START_DELAY_MS } from '../config/surveyConfig';
import { getSurveyReminderMessage, getSurveyStartMessage } from '../utils/surveyNotificationCopy';

const isForeignKeyError = (error) => {
  if (!error) return false;
  const raw = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === '23503' || raw.includes('foreign key');
};

const resolveSurveyDeadlineAt = (notificationLike, fallbackIso) => {
  const explicitDeadline = notificationLike?.data?.survey_deadline_at
    || notificationLike?.data?.deadline_at
    || notificationLike?.data?.deadlineAt
    || null;

  if (explicitDeadline) {
    const explicitDate = new Date(explicitDeadline);
    if (!Number.isNaN(explicitDate.getTime())) return explicitDate.toISOString();
  }

  const anchor = notificationLike?.created_at || fallbackIso;
  const anchorDate = new Date(anchor);
  if (Number.isNaN(anchorDate.getTime())) return null;
  return new Date(anchorDate.getTime() + SURVEY_FINALIZE_DELAY_MS).toISOString();
};

const resolveReminderSendAt = (surveyDeadlineAtIso, nowDate = new Date()) => {
  const deadlineDate = new Date(surveyDeadlineAtIso);
  if (Number.isNaN(deadlineDate.getTime())) return null;

  const reminderAtMs = deadlineDate.getTime() - SURVEY_REMINDER_LEAD_MS;
  if (reminderAtMs <= nowDate.getTime()) {
    // If we're already inside the final hour but the survey is still open, send reminder now.
    if (deadlineDate.getTime() > nowDate.getTime()) {
      return new Date(nowDate.getTime() + 5000).toISOString();
    }
    return null;
  }

  return new Date(reminderAtMs).toISOString();
};

const fetchMatchRecipientIds = async (partidoId, adminUserId = null) => {
  const { data: jugadores, error: playersError } = await supabase
    .from('jugadores')
    .select('usuario_id')
    .eq('partido_id', partidoId)
    .not('usuario_id', 'is', null);

  if (playersError) throw playersError;

  const recipients = new Set();
  (jugadores || []).forEach((jugador) => {
    const uid = jugador?.usuario_id;
    if (uid) recipients.add(uid);
  });
  if (adminUserId) recipients.add(adminUserId);

  return Array.from(recipients);
};

const scheduleSurveyReminderNotifications = async ({
  partidoId,
  partido,
  surveyDeadlineAt,
  reminderSendAt,
  nowIso,
}) => {
  if (!partidoId || !surveyDeadlineAt || !reminderSendAt) return { inserted: 0 };

  const recipientIds = await fetchMatchRecipientIds(partidoId, partido?.creado_por || null);
  if (recipientIds.length === 0) return { inserted: 0 };

  const { data: existingReminders, error: existingRemindersError } = await supabase
    .from('notifications')
    .select('id, user_id')
    .eq('partido_id', partidoId)
    .eq('type', 'survey_reminder');

  if (existingRemindersError) {
    console.warn('[MATCH_FINISH] Could not check existing survey reminders:', existingRemindersError);
  }

  const existingReminderUsers = new Set((existingReminders || []).map((row) => row.user_id).filter(Boolean));
  const pendingRecipients = recipientIds.filter((userId) => !existingReminderUsers.has(userId));
  if (pendingRecipients.length === 0) return { inserted: 0 };

  const reminderMessage = getSurveyReminderMessage({
    source: { created_at: nowIso, data: { survey_deadline_at: surveyDeadlineAt } },
    matchName: partido?.nombre || formatMatchDate(partido?.fecha) || 'este partido',
    now: new Date(reminderSendAt),
  });

  const reminderRows = pendingRecipients.map((userId) => ({
    user_id: userId,
    type: 'survey_reminder',
    title: 'Recordatorio de encuesta',
    message: reminderMessage,
    partido_id: partidoId,
    match_ref: partidoId,
    data: {
      match_id: String(partidoId),
      matchId: partidoId,
      matchCode: partido?.codigo || null,
      link: `/encuesta/${partidoId}`,
      partido_nombre: partido?.nombre || null,
      partido_fecha: partido?.fecha || null,
      partido_hora: partido?.hora || null,
      partido_sede: partido?.sede || null,
      survey_deadline_at: surveyDeadlineAt,
      reminder_send_at: reminderSendAt,
      reminder_type: '1h_before_deadline',
    },
    read: false,
    created_at: nowIso,
    send_at: reminderSendAt,
  }));

  const { error: bulkInsertError } = await supabase
    .from('notifications')
    .insert(reminderRows);

  if (!bulkInsertError) {
    return { inserted: reminderRows.length };
  }

  // Duplicate races are fine (another worker/client already inserted).
  if (bulkInsertError.code === '23505' || String(bulkInsertError.message || '').toLowerCase().includes('duplicate key')) {
    console.warn('[MATCH_FINISH] survey_reminder duplicate detected, skipping duplicates');
    return { inserted: 0 };
  }

  if (!isForeignKeyError(bulkInsertError)) throw bulkInsertError;

  let inserted = 0;
  for (const row of reminderRows) {
    // eslint-disable-next-line no-await-in-loop
    const { error: singleInsertError } = await supabase.from('notifications').insert([row]);
    if (!singleInsertError) {
      inserted += 1;
      continue;
    }
    if (
      isForeignKeyError(singleInsertError)
      || singleInsertError.code === '23505'
      || String(singleInsertError.message || '').toLowerCase().includes('duplicate key')
    ) {
      continue;
    }
    throw singleInsertError;
  }

  return { inserted };
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

    // Encuesta habilitada al finalizar el partido (por defecto: hora de inicio + 1h).
    const surveyStartTime = new Date(partidoDateTime.getTime() + SURVEY_START_DELAY_MS);
    if (now < surveyStartTime) return false;

    const partidoId = Number(partido.id);
    if (!partidoId || Number.isNaN(partidoId)) return false;

    const nowIso = new Date().toISOString();
    const surveyDeadlineAt = new Date(new Date(nowIso).getTime() + SURVEY_FINALIZE_DELAY_MS).toISOString();
    const reminderSendAt = resolveReminderSendAt(surveyDeadlineAt, now);

    // Idempotencia: si ya existe una noti de encuesta, no reenviar.
    const { data: existingNotifications, error: existingError } = await supabase
      .from('notifications')
      .select('id, type, created_at, data')
      .eq('partido_id', partidoId)
      .in('type', ['survey_start', 'post_match_survey', 'survey_reminder'])
      .limit(5);

    if (existingError) {
      console.warn('[MATCH_FINISH] Could not check existing survey notifications:', existingError);
    } else if ((existingNotifications || []).length > 0) {
      const types = new Set((existingNotifications || []).map((n) => n.type));
      const hasSurveyStart = types.has('survey_start') || types.has('post_match_survey');
      const hasSurveyReminder = types.has('survey_reminder');

      if (hasSurveyStart && !hasSurveyReminder) {
        const startNotification = (existingNotifications || []).find((n) => n.type === 'survey_start' || n.type === 'post_match_survey');
        const resolvedDeadline = resolveSurveyDeadlineAt(startNotification, nowIso);
        const resolvedReminderAt = resolvedDeadline ? resolveReminderSendAt(resolvedDeadline, now) : null;

        if (resolvedDeadline && resolvedReminderAt) {
          try {
            await scheduleSurveyReminderNotifications({
              partidoId,
              partido,
              surveyDeadlineAt: resolvedDeadline,
              reminderSendAt: resolvedReminderAt,
              nowIso,
            });
          } catch (reminderError) {
            console.warn('[MATCH_FINISH] Could not backfill survey reminder:', reminderError);
          }
        }
      }
      return false;
    }

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
      if (recipients > 0 && reminderSendAt) {
        try {
          await scheduleSurveyReminderNotifications({
            partidoId,
            partido,
            surveyDeadlineAt,
            reminderSendAt,
            nowIso,
          });
        } catch (reminderError) {
          console.warn('[MATCH_FINISH] survey reminder scheduling failed after RPC success:', reminderError);
        }
      }
      return recipients > 0;
    }

    if (rpcError?.code === '23505' || String(rpcError?.message || '').toLowerCase().includes('duplicate key')) {
      console.warn('[MATCH_FINISH] survey_start notification already exists, skipping fallback', rpcError);
      if (reminderSendAt) {
        try {
          await scheduleSurveyReminderNotifications({
            partidoId,
            partido,
            surveyDeadlineAt,
            reminderSendAt,
            nowIso,
          });
        } catch (reminderError) {
          console.warn('[MATCH_FINISH] survey reminder scheduling failed on duplicate race:', reminderError);
        }
      }
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
      send_at: nowIso,
    }));

    // Insert notifications in bulk first; if one FK fails, retry by user to avoid blocking valid recipients.
    const { error: insertError } = await supabase
      .from('notifications')
      .insert(notifications);

    if (!insertError) {
      console.log(`Sent ${notifications.length} survey notifications for finished match ${partidoId}`);
      if (reminderSendAt) {
        try {
          await scheduleSurveyReminderNotifications({
            partidoId,
            partido,
            surveyDeadlineAt,
            reminderSendAt,
            nowIso,
          });
        } catch (reminderError) {
          console.warn('[MATCH_FINISH] survey reminder scheduling failed after fallback bulk insert:', reminderError);
        }
      }
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
      if (reminderSendAt) {
        try {
          await scheduleSurveyReminderNotifications({
            partidoId,
            partido,
            surveyDeadlineAt,
            reminderSendAt,
            nowIso,
          });
        } catch (reminderError) {
          console.warn('[MATCH_FINISH] survey reminder scheduling failed after fallback single inserts:', reminderError);
        }
      }
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
