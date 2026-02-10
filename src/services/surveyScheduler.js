import { supabase } from '../supabase';
import { checkAndNotifyMatchFinish } from './matchFinishService';

/**
 * Checks for matches that need post-match survey notifications
 * This function should be called periodically (e.g., every 5 minutes)
 */
export const checkMatchesForSurveys = async () => {
  try {
    // Buscar partidos activos con fecha y hora
    const { data: activeMatches, error: scheduleError } = await supabase
      .from('partidos')
      .select('*')
      .in('estado', ['activo', 'active'])
      .not('fecha', 'is', null)
      .not('hora', 'is', null);

    if (scheduleError) throw scheduleError;

    let sentCount = 0;
    for (const match of activeMatches || []) {
      const sent = await checkAndNotifyMatchFinish(match);
      if (sent) sentCount += 1;
    }

    return sentCount;
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
  // Client-side fallback scheduler (idempotent): safe to run alongside DB fanout.
  checkMatchesForSurveys();
  setInterval(checkMatchesForSurveys, 5 * 60 * 1000);
};
