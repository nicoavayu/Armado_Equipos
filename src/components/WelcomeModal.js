import React from 'react';
import { useTutorial } from '../context/TutorialContext';
import './WelcomeModal.css';

const WelcomeModal = () => {
  const { showWelcomeModal, startTutorial, skipTutorial } = useTutorial();

  if (!showWelcomeModal) return null;

  return (
    <div className="welcome-modal-overlay">
      <div className="welcome-modal">
        <h2>¡Bienvenido a Team Balancer!</h2>
        <p>
          Esta aplicación te ayuda a organizar partidos y crear equipos equilibrados.
          ¿Te gustaría hacer un recorrido rápido para conocer todas las funciones?
        </p>
        <div className="welcome-modal-buttons">
          <button 
            className="welcome-modal-button primary" 
            onClick={startTutorial}
          >
            Iniciar tutorial
          </button>
          <button 
            className="welcome-modal-button secondary" 
            onClick={skipTutorial}
          >
            Omitir
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeModal;