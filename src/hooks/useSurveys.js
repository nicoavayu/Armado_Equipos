import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthProvider';
import { checkPendingSurveys, processSurveyResults } from '../services/surveyService';

/**
 * Hook to manage post-match surveys
 * @returns {Object} Survey state and functions
 */
export const useSurveys = () => {
  const { user } = useAuth();
  const [pendingSurveys, setPendingSurveys] = useState([]);
  const [currentSurvey, setCurrentSurvey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSurveyModal, setShowSurveyModal] = useState(false);

  // Check for pending surveys when user changes
  useEffect(() => {
    if (user) {
      fetchPendingSurveys();
    } else {
      setPendingSurveys([]);
      setCurrentSurvey(null);
      setLoading(false);
    }
  }, [user]);

  // Fetch pending surveys for the current user
  const fetchPendingSurveys = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const surveys = await checkPendingSurveys(user.id);
      setPendingSurveys(surveys);
      
      // If there are pending surveys, set the first one as current
      if (surveys.length > 0) {
        setCurrentSurvey(surveys[0]);
      } else {
        setCurrentSurvey(null);
      }
    } catch (error) {
      console.error('Error fetching pending surveys:', error);
    } finally {
      setLoading(false);
    }
  };

  // Open survey modal for a specific match
  const openSurvey = (survey) => {
    setCurrentSurvey(survey);
    setShowSurveyModal(true);
  };

  // Close survey modal
  const closeSurvey = () => {
    setShowSurveyModal(false);
  };

  // Handle survey submission
  const handleSurveySubmit = async () => {
    if (!currentSurvey) return;
    
    try {
      // Process survey results
      await processSurveyResults(currentSurvey.partido.id);
      
      // Remove the submitted survey from pending surveys
      setPendingSurveys(prev => prev.filter(s => s.notification.id !== currentSurvey.notification.id));
      
      // Close the modal
      setShowSurveyModal(false);
      
      // If there are more pending surveys, set the next one as current
      if (pendingSurveys.length > 1) {
        const nextSurvey = pendingSurveys.find(s => s.notification.id !== currentSurvey.notification.id);
        setCurrentSurvey(nextSurvey);
      } else {
        setCurrentSurvey(null);
      }
    } catch (error) {
      console.error('Error handling survey submission:', error);
    }
  };

  return {
    pendingSurveys,
    currentSurvey,
    loading,
    showSurveyModal,
    openSurvey,
    closeSurvey,
    handleSurveySubmit,
    refreshSurveys: fetchPendingSurveys
  };
};