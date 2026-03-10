import { supabase } from '../supabase';
import {
  SURVEY_FINALIZE_DELAY_MS,
  SURVEY_REMINDER_12H_LEAD_MS,
  SURVEY_REMINDER_1H_LEAD_MS,
} from '../config/surveyConfig';
import { getSurveyReminderMessage, getSurveyStartMessage } from '../utils/surveyNotificationCopy';
import { finalizeIfComplete } from './surveyCompletionService';
import { ensureAwards } from './awardsService';

/**
 * Creates post-match survey notifications for all players in a match
 * @param {Object} partido - The match object
 * @returns {Promise<Array>} - Array of created notifications or empty array if error
 */
export const createPostMatchSurveyNotifications = async (partido) => {
  // DEPRECATED: Prefer DB-side fanout via fanout_survey_start_notifications() cron job.
  // To enable JS fanout for local/dev testing set USE_JS_FANOUT=1 in the environment.
  const useJsFanout = typeof process !== 'undefined' && process.env && process.env.USE_JS_FANOUT === '1';
  if (!useJsFanout) {
    console.warn('[DEPRECATED] createPostMatchSurveyNotifications is disabled in production. Use DB cron fanout_survey_start_notifications(). To enable JS fanout for dev set USE_JS_FANOUT=1');
    return [];
  }

  // --- CANONICAL MODE CHECK: prevent JS creation when DB is canonical ---
  const type = 'survey_start';
  const SURVEY_FANOUT_MODE = process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE || 'db';
  if (SURVEY_FANOUT_MODE === 'db' && (type === 'survey_start' || type === 'post_match_survey')) return;

  if (!partido || !partido.jugadores || !partido.jugadores.length) return [];

  try {
    // Get unique user IDs from the match participants (exclude guest users)
    const userIds = partido.jugadores
      .filter((jugador) => jugador.uuid && !jugador.uuid.startsWith('guest_'))
      .map((jugador) => jugador.uuid);

    if (userIds.length === 0) return [];

    // Create notifications for all players
    const nowIso = new Date().toISOString();
    const surveyDeadlineAt = new Date(new Date(nowIso).getTime() + SURVEY_FINALIZE_DELAY_MS).toISOString();
    const reminder12hSendAt = new Date(new Date(surveyDeadlineAt).getTime() - SURVEY_REMINDER_12H_LEAD_MS).toISOString();
    const reminder1hSendAt = new Date(new Date(surveyDeadlineAt).getTime() - SURVEY_REMINDER_1H_LEAD_MS).toISOString();

    const startNotifications = userIds.map((userId) => ({
      user_id: userId,
      type: 'survey_start',
      title: '¡Encuesta lista!',
      message: getSurveyStartMessage({
        source: { created_at: nowIso, data: { survey_deadline_at: surveyDeadlineAt } },
        matchName: partido.nombre || 'reciente',
      }),
      partido_id: Number(partido.id),
      match_ref: Number(partido.id),
      data: {
        match_id: String(partido.id),
        // legacy compatibility (to be removed after full migration)
        matchId: Number(partido.id),
        matchCode: partido.codigo,
        matchDate: partido.fecha,
        matchTime: partido.hora,
        matchVenue: partido.sede,
        survey_deadline_at: surveyDeadlineAt,
      },
      read: false,
      created_at: nowIso,
      send_at: nowIso,
    }));

    const reminderNotifications = userIds.flatMap((userId) => ([
      {
        user_id: userId,
        type: 'survey_reminder_12h',
        title: 'Recordatorio de encuesta',
        message: getSurveyReminderMessage({
          source: { created_at: nowIso, data: { survey_deadline_at: surveyDeadlineAt, reminder_type: '12h_before_deadline' } },
          matchName: partido.nombre || 'reciente',
          now: new Date(reminder12hSendAt),
        }),
        partido_id: Number(partido.id),
        match_ref: Number(partido.id),
        data: {
          match_id: String(partido.id),
          matchId: Number(partido.id),
          matchCode: partido.codigo,
          matchDate: partido.fecha,
          matchTime: partido.hora,
          matchVenue: partido.sede,
          survey_deadline_at: surveyDeadlineAt,
          reminder_send_at: reminder12hSendAt,
          reminder_type: '12h_before_deadline',
        },
        read: false,
        created_at: nowIso,
        send_at: reminder12hSendAt,
      },
      {
        user_id: userId,
        type: 'survey_reminder',
        title: 'Recordatorio de encuesta',
        message: getSurveyReminderMessage({
          source: { created_at: nowIso, data: { survey_deadline_at: surveyDeadlineAt, reminder_type: '1h_before_deadline' } },
          matchName: partido.nombre || 'reciente',
          now: new Date(reminder1hSendAt),
        }),
        partido_id: Number(partido.id),
        match_ref: Number(partido.id),
        data: {
          match_id: String(partido.id),
          matchId: Number(partido.id),
          matchCode: partido.codigo,
          matchDate: partido.fecha,
          matchTime: partido.hora,
          matchVenue: partido.sede,
          survey_deadline_at: surveyDeadlineAt,
          reminder_send_at: reminder1hSendAt,
          reminder_type: '1h_before_deadline',
        },
        read: false,
        created_at: nowIso,
        send_at: reminder1hSendAt,
      },
    ]));

    // Insert notifications into the database
    const { data, error } = await supabase
      .from('notifications')
      .insert([...startNotifications, ...reminderNotifications])
      .select();

    if (error) throw error;

    console.log(`Creadas ${data?.length || 0} notificaciones de encuesta post-partido`);
    return data || [];
  } catch (error) {
    console.error('Error creating post-match survey notifications:', error);
    return [];
  }
};

/**
 * Checks if a user has a pending post-match survey
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} - Array of pending surveys
 */
export const checkPendingSurveys = async (userId) => {
  if (!userId) return [];

  try {
    // Get unread post-match survey notifications
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*, partidos(*)')
      .eq('user_id', userId)
      .in('type', ['post_match_survey', 'survey_start'])
      .eq('read', false);

    if (error) throw error;

    // Check if user has already submitted a survey for these matches
    const pendingSurveys = [];

    for (const notification of notifications || []) {
      const notifMatchId =
        notification.match_id ??
        notification?.data?.match_id ??
        notification?.data?.matchId ??
        notification?.partidos?.id;
      if (!notifMatchId) continue;

      // Check if user has already submitted a survey for this match
      const { data: existingSurvey, error: surveyError } = await supabase
        .from('post_match_surveys')
        .select('id')
        .eq('partido_id', notifMatchId)
        .eq('votante_id', userId)
        .single();

      if (surveyError && surveyError.code !== 'PGRST116') {
        console.error('Error checking existing survey:', surveyError);
        continue;
      }

      // If no survey exists, add to pending surveys
      if (!existingSurvey) {
        pendingSurveys.push({
          notification,
          partido: notification.partidos,
        });
      } else {
        // Mark notification as read since survey was already submitted
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', notification.id);
      }
    }

    return pendingSurveys;
  } catch (error) {
    console.error('Error checking pending surveys:', error);
    return [];
  }
};

/**
 * DEPRECATED compatibility wrapper.
 * Canonical closure flow:
 * EncuestaPartido -> finalizeIfComplete -> computeAndPersistAwards -> ensureAwards.
 *
 * This wrapper intentionally does not emit legacy survey_results_ready notifications.
 * @param {number} partidoId - The match ID
 */
export const processSurveyResults = async (partidoId) => {
  const idNum = Number(partidoId);
  if (!Number.isFinite(idNum) || idNum <= 0) return false;

  try {
    const finalizeRes = await finalizeIfComplete(idNum);
    if (!finalizeRes?.done) {
      return false;
    }

    if (finalizeRes?.awardsSkipped) {
      return true;
    }

    const ensureRes = await ensureAwards(idNum);
    if (!ensureRes?.ok) {
      console.warn('[SURVEY_SERVICE] ensureAwards failed after finalizeIfComplete', {
        partidoId: idNum,
        ensureRes,
      });
      return false;
    }

    return Boolean(ensureRes?.applied || ensureRes?.row?.results_ready);
  } catch (error) {
    console.error('[SURVEY_SERVICE] processSurveyResults compatibility flow failed:', error);
    return false;
  }
};
