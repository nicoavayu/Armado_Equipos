import { useEffect } from 'react';
import { checkMatchesForSurveys } from '../services/surveyScheduler';

/**
 * Hook to periodically check for matches that need post-match survey notifications
 */
export const useSurveyScheduler = () => {
  useEffect(() => {
    // Check immediately on mount
    checkMatchesForSurveys();
    
    // Then check every 5 minutes
    const interval = setInterval(() => {
      checkMatchesForSurveys();
    }, 5 * 60 * 1000);
    
    // Clean up on unmount
    return () => clearInterval(interval);
  }, []);
};