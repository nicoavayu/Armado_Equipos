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
    
    // Método 1: Buscar partidos que terminaron hace 1 hora (hora_fin)
    const { data: matchesWithEndTime, error: endTimeError } = await supabase
      .from('partidos')
      .select('*')
      .eq('estado', 'activo')
      .is('surveys_sent', false)
      .lt('hora_fin', nowStr);
      
    if (endTimeError) throw endTimeError;
    
    // Método 2: Buscar partidos con tiempo de encuesta programado (survey_time)
    const { data: matchesWithScheduledTime, error: scheduleError } = await supabase
      .from('partidos')
      .select('*')
      .eq('estado', 'activo')
      .is('surveys_sent', false)
      .eq('survey_scheduled', true)
      .lt('survey_time', nowStr);
      
    if (scheduleError) throw scheduleError;
    
    // Combinar resultados y eliminar duplicados
    const matchIds = new Set();
    const matches = [];
    
    // Procesar partidos con hora_fin
    for (const match of matchesWithEndTime || []) {
      if (!matchIds.has(match.id)) {
        matchIds.add(match.id);
        matches.push(match);
      }
    }
    
    // Procesar partidos con survey_time
    for (const match of matchesWithScheduledTime || []) {
      if (!matchIds.has(match.id)) {
        matchIds.add(match.id);
        matches.push(match);
      }
    }
    
    // Crear notificaciones de encuesta para cada partido
    for (const match of matches) {
      console.log(`Creando notificaciones de encuesta para partido ${match.id}`);
      await createPostMatchSurveyNotifications(match);
      
      // Marcar partido como con encuestas enviadas
      await supabase
        .from('partidos')
        .update({ surveys_sent: true })
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