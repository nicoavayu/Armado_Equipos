import { supabase } from '../supabase';
import { createPostMatchSurveyNotifications } from './surveyService';

/**
 * Checks for matches that need post-match survey notifications
 * This function should be called periodically (e.g., every 5 minutes)
 */
export const checkMatchesForSurveys = async () => {
  try {
    const now = new Date();
    const nowStr = now.toISOString();
    
    // Buscar partidos con tiempo de encuesta programado (survey_time)
    const { data: matchesWithScheduledTime, error: scheduleError } = await supabase
      .from('partidos')
      .select('*')
      .eq('estado', 'activo')
      .not('survey_time', 'is', null)
      .lt('survey_time', nowStr);
      
    if (scheduleError) throw scheduleError;
    
    const matches = matchesWithScheduledTime || [];
    
    // Crear notificaciones de encuesta para cada partido
    for (const match of matches) {
      console.log(`Creando notificaciones de encuesta para partido ${match.id}`);
      await createPostMatchSurveyNotifications(match);
      
      // Marcar partido como procesado (usando survey_time como null para evitar reprocesamiento)
      await supabase
        .from('partidos')
        .update({ survey_time: null })
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
  // Check immediately on startup
  checkMatchesForSurveys();
  
  // Then check every 5 minutes
  setInterval(checkMatchesForSurveys, 5 * 60 * 1000);
};