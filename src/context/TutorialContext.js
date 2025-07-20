import React, { createContext, useContext, useState, useEffect } from 'react';

const TutorialContext = createContext();

export const useTutorial = () => useContext(TutorialContext);

export const TutorialProvider = ({ children }) => {
  const [showTutorial, setShowTutorial] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [run, setRun] = useState(false);

  // Check if it's the first time the user opens the app
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
    if (!hasSeenTutorial) {
      setShowWelcomeModal(true);
    }
  }, []);

  const startTutorial = () => {
    setShowWelcomeModal(false);
    setShowTutorial(true);
    setRun(true);
    setTutorialStep(0);
  };

  const skipTutorial = () => {
    setShowWelcomeModal(false);
    setShowTutorial(false);
    setRun(false);
    localStorage.setItem('hasSeenTutorial', 'true');
  };

  const completeTutorial = () => {
    setShowTutorial(false);
    setRun(false);
    localStorage.setItem('hasSeenTutorial', 'true');
  };

  const replayTutorial = () => {
    setShowTutorial(true);
    setRun(true);
    setTutorialStep(0);
  };

  const value = {
    showTutorial,
    showWelcomeModal,
    tutorialStep,
    run,
    setTutorialStep,
    setRun,
    startTutorial,
    skipTutorial,
    completeTutorial,
    replayTutorial
  };

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
};