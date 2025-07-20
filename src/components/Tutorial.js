import React, { useEffect } from 'react';
import Joyride, { STATUS } from 'react-joyride';
import { useTutorial } from '../context/TutorialContext';
import './Tutorial.css';

const Tutorial = () => {
  const { run, setRun, completeTutorial } = useTutorial();

  // Define the tutorial steps
  const steps = [
    // TabBar navigation
    {
      target: '.tab-bar',
      content: 'Esta es la barra de navegación principal. Aquí puedes acceder a todas las secciones de la app.',
      placement: 'top',
      disableBeacon: true,
    },
    // Armar Equipos
    {
      target: '.tab-bar .tab-item:nth-child(1)',
      content: 'Aquí puedes crear nuevos partidos y armar equipos equilibrados.',
      placement: 'top',
    },
    // Quiero Jugar
    {
      target: '.tab-bar .tab-item:nth-child(2)',
      content: 'En esta sección puedes unirte a partidos existentes usando un código.',
      placement: 'top',
    },
    // Amigos
    {
      target: '.tab-bar .tab-item:nth-child(3)',
      content: 'Aquí puedes gestionar tus amigos, enviar solicitudes y ver solicitudes pendientes.',
      placement: 'top',
    },
    // Notificaciones
    {
      target: '.tab-bar .tab-item:nth-child(4)',
      content: 'Aquí verás todas tus notificaciones, invitaciones a partidos y solicitudes de amistad.',
      placement: 'top',
    },
    // Perfil
    {
      target: '.tab-bar .tab-item:nth-child(5)',
      content: 'En tu perfil puedes editar tus datos personales y preferencias.',
      placement: 'top',
    },
    // Crear partido nuevo
    {
      target: '.voting-confirm-btn:nth-child(2)',
      content: 'Haz clic aquí para crear un nuevo partido y añadir jugadores.',
      placement: 'bottom',
      spotlightClicks: true,
    },
    // Historial
    {
      target: '.voting-confirm-btn:nth-child(3)',
      content: 'Aquí puedes ver tu historial de partidos frecuentes.',
      placement: 'bottom',
    },
    // Modo Rápido
    {
      target: '.voting-confirm-btn:nth-child(4)',
      content: 'El modo rápido te permite crear equipos al instante sin guardar el partido.',
      placement: 'bottom',
    },
    // Final step
    {
      target: 'body',
      content: (
        <div>
          <h3>¡Listo para jugar!</h3>
          <p>Ya conoces las funciones principales de Team Balancer. Puedes volver a ver este tutorial desde la sección de Perfil.</p>
        </div>
      ),
      placement: 'center',
    },
  ];

  // Handle tutorial completion
  const handleJoyrideCallback = (data) => {
    const { status } = data;
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
      setRun(false);
      completeTutorial();
    }
  };

  // Custom styles for the tutorial
  const joyrideStyles = {
    options: {
      primaryColor: '#8178e5',
      backgroundColor: '#ffffff',
      textColor: '#333333',
      arrowColor: '#ffffff',
    },
    tooltipContainer: {
      textAlign: 'left',
    },
    buttonBack: {
      color: '#5d54c0',
    },
    buttonNext: {
      backgroundColor: '#8178e5',
    },
    buttonSkip: {
      color: '#999999',
    },
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showSkipButton
      showProgress
      disableScrolling={false}
      disableOverlayClose
      spotlightClicks
      callback={handleJoyrideCallback}
      styles={joyrideStyles}
      locale={{
        back: 'Anterior',
        close: 'Cerrar',
        last: 'Finalizar',
        next: 'Siguiente',
        skip: 'Omitir',
      }}
    />
  );
};

export default Tutorial;