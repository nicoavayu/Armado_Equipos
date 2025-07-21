import React, { useEffect } from 'react';
import { useSurveys } from '../hooks/useSurveys';
import PostMatchSurvey from './PostMatchSurvey';

/**
 * Component to manage post-match surveys
 * This component checks for pending surveys and displays the survey modal when needed
 */
const SurveyManager = () => {
  const { 
    pendingSurveys, 
    currentSurvey, 
    showSurveyModal, 
    openSurvey, 
    closeSurvey, 
    handleSurveySubmit,
    refreshSurveys
  } = useSurveys();

  // Check for pending surveys on component mount
  useEffect(() => {
    // Wait a bit before showing the survey to avoid interrupting the user experience
    const timer = setTimeout(() => {
      if (pendingSurveys.length > 0 && !showSurveyModal) {
        openSurvey(pendingSurveys[0]);
      }
    }, 5000); // 5 seconds delay
    
    return () => clearTimeout(timer);
  }, [pendingSurveys, showSurveyModal, openSurvey]);

  // If there's no current survey or the modal is not shown, don't render anything
  if (!currentSurvey || !showSurveyModal) {
    return null;
  }

  return (
    <PostMatchSurvey
      partido={currentSurvey.partido}
      onClose={closeSurvey}
      onSubmit={() => {
        handleSurveySubmit();
        refreshSurveys();
      }}
    />
  );
};

export default SurveyManager;