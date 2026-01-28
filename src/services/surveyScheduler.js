import { supabase } from '../supabase';
import { createPostMatchSurveyNotifications } from './surveyService';

/**
 * Checks for matches that need post-match survey notifications
 * This function should be called periodically (e.g., every 5 minutes)
 */
export const checkMatchesForSurveys = async () => {
  try {
    const now = new Date();
    const _nowStr = new Date().toISOString();
    
    // Buscar partidos activos con fecha y hora
    const { data: activeMatches, error: scheduleError } = await supabase
      .from('partidos')
      .select('*')
      .eq('estado', 'activo')
      .not('fecha', 'is', null)
      .not('hora', 'is', null);
      
    if (scheduleError) throw scheduleError;
    
    // Filtrar partidos donde ya pasó 1 hora desde el inicio
    const matches = (activeMatches || []).filter((match) => {
      try {
        const matchDateTime = new Date(`${match.fecha}T${match.hora}`);
        const surveyTime = new Date(matchDateTime.getTime() + 1 * 60 * 1000); // +1 minuto (para test)
        return now >= surveyTime;
      } catch (error) {
        console.error('Error calculating survey time for match:', match.id, error);
        return false;
      }
    });
    
    // Crear notificaciones de encuesta para cada partido
    for (const match of matches) {
      console.log(`Creando notificaciones de encuesta para partido ${match.id}`);
      await createPostMatchSurveyNotifications(match);
      
      // Marcar partido como procesado cambiando estado
      await supabase
        .from('partidos')
        .update({ estado: 'encuesta_enviada' })
        .eq('id', match.id);
    }
    
    return matches.length;
  } catch (error) {
    console.error('Error checking matches for surveys:', error);
    return 0;
  }
};

/**
 * Initialize the survey scheduler
 * This function sets up a periodic check for matches that need surveys
 */
export const initSurveyScheduler = () => {
  // DEPRECATED: use the DB-side cron job fanout_survey_start_notifications() instead.
  // Running JS-based scheduler in production can cause duplication with the DB cron
  // and make notifications non-idempotent. To enable JS fanout for local/dev testing,
  // set the environment variable USE_JS_FANOUT=1 when starting the app.
  const useJsFanout = typeof process !== 'undefined' && process.env && process.env.USE_JS_FANOUT === '1';
  if (!useJsFanout) {
    console.warn('[DEPRECATED] initSurveyScheduler is disabled. Use DB cron fanout_survey_start_notifications(). To enable JS fanout for dev set USE_JS_FANOUT=1');
    return;
  }

  // If explicitly enabled for dev, run the original scheduler behavior
  checkMatchesForSurveys();
  setInterval(checkMatchesForSurveys, 5 * 60 * 1000);
};