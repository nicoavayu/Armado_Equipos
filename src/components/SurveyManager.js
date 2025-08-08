import React, { useEffect } from 'react';
import { useSurveys } from '../hooks/useSurveys';

/**
 * Component to manage post-match surveys
 * This component checks for pending surveys and redirects to the survey page when needed
 */
const SurveyManager = () => {
  const { pendingSurveys } = useSurveys();

  // Check for pending surveys on component mount
  useEffect(() => {
    // Wait a bit before redirecting to avoid interrupting the user experience
    const timer = setTimeout(() => {
      if (pendingSurveys.length > 0) {
        const firstSurvey = pendingSurveys[0];
        if (firstSurvey.partido?.id) {
          window.location.href = `/encuesta/${firstSurvey.partido.id}`;
        }
      }
    }, 5000); // 5 seconds delay
    
    return () => clearTimeout(timer);
  }, [pendingSurveys]);

  // This component doesn't render anything, it just manages redirects
  return null;
};

export default SurveyManager;