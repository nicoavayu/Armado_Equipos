import { useEffect } from 'react';
import { checkMatchesForSurveys } from '../services/surveyScheduler';

/**
 * Hook to periodically check for matches that need post-match survey notifications
 */
export const useSurveyScheduler = (enabled = true) => {
  useEffect(() => {
    if (!enabled) return;

    // Check immediately on mount
    checkMatchesForSurveys();
    
    // Then check every minute for debug feedback
    const interval = setInterval(() => {
      checkMatchesForSurveys();
    }, 60 * 1000);
    
    // Clean up on unmount
    return () => clearInterval(interval);
  }, [enabled]);
};
