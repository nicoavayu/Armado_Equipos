import { supabase } from '../supabase';
import { createPostMatchSurveyNotifications } from './surveyService';

/**
 * Checks for matches that need post-match survey notifications
 * This function should be called periodically (e.g., every 5 minutes)
 */
export const checkMatchesForSurveys = async () => {
  try {
    const now = new Date();
    
    // Get matches that ended in the last hour
    // We're looking for matches that ended between 1 hour ago and now
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Format dates for Supabase query
    const oneHourAgoStr = oneHourAgo.toISOString();
    const nowStr = now.toISOString();
    
    // Get matches that ended in the last hour and haven't had surveys sent yet
    const { data: matches, error } = await supabase
      .from('partidos')
      .select('*')
      .eq('estado', 'activo')
      .is('surveys_sent', false)
      .lt('hora_fin', nowStr)
      .gt('hora_fin', oneHourAgoStr);
      
    if (error) throw error;
    
    // Create survey notifications for each match
    for (const match of matches || []) {
      await createPostMatchSurveyNotifications(match);
      
      // Mark match as having surveys sent
      await supabase
        .from('partidos')
        .update({ surveys_sent: true })
        .eq('id', match.id);
    }
    
    return matches?.length || 0;
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