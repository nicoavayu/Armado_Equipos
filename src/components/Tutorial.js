import React from 'react';
import Joyride, { STATUS } from 'react-joyride';
import { useTutorial } from '../context/TutorialContext';

const Tutorial = () => {
  const { run, setRun, completeTutorial } = useTutorial();

  const steps = [
    {
      target: 'body',
      content: (
        <div>
          <h3 className="font-oswald text-[22px] text-[#5d54c0] m-0 mb-2">Armá o sumate rápido</h3>
          <p className="m-0 leading-relaxed">
            Podés crear tu partido en minutos o sumarte a un partido abierto desde "Quiero jugar" si no tenés cancha o grupo.
          </p>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="font-oswald text-[22px] text-[#5d54c0] m-0 mb-2">Equipos parejos con votación</h3>
          <p className="m-0 leading-relaxed">
            Invitás al grupo, cada jugador vota y la app balancea los equipos para que el partido sea competitivo y justo.
          </p>
        </div>
      ),
      placement: 'center',
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="font-oswald text-[22px] text-[#5d54c0] m-0 mb-2">Invitá amigos o abrí a la comunidad</h3>
          <p className="m-0 leading-relaxed">
            Si te falta gente, abrís cupos públicos y otros jugadores se pueden unir. Si preferís, dejás el partido solo para tu grupo.
          </p>
        </div>
      ),
      placement: 'center',
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="font-oswald text-[22px] text-[#5d54c0] m-0 mb-2">Encuesta post partido y reputación</h3>
          <p className="m-0 leading-relaxed">
            Al terminar, la encuesta define resultado (Equipo A, Equipo B o Empate), suma premios y mejora tu reputación dentro de la app.
          </p>
        </div>
      ),
      placement: 'center',
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="font-oswald text-[22px] text-[#5d54c0] m-0 mb-2">Recap automático del año</h3>
          <p className="m-0 leading-relaxed">
            Se guarda tu historial para ver partidos jugados, ganados, empatados y perdidos durante todo el período.
          </p>
        </div>
      ),
      placement: 'center',
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="font-oswald text-[22px] text-[#5d54c0] m-0 mb-2">Listo para jugar</h3>
          <p className="m-0 leading-relaxed">
            Consejo: ajustá tu visibilidad y completá tu perfil para recibir mejores invitaciones y conseguir partidos más rápido.
          </p>
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
      zIndex: 10000,
    },
    tooltipContainer: {
      textAlign: 'left',
    },
    buttonBack: {
      color: '#5d54c0',
    },
    buttonNext: {
      backgroundColor: '#8178e5',
      fontWeight: 'bold',
      fontFamily: 'Oswald, sans-serif',
    },
    buttonSkip: {
      color: '#999999',
    },
    tooltip: {
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      fontFamily: 'system-ui, sans-serif',
    },
    tooltipContent: {
      padding: '20px',
    },
    tooltipTitle: {
      marginTop: 0,
      fontFamily: 'Oswald, sans-serif',
      color: '#5d54c0',
      fontSize: '18px',
      fontWeight: 'bold',
    },
  };

  return (
    <>
      <style>
        {`
          .react-joyride__tooltip h3 {
            margin-top: 0;
            font-family: 'Oswald', sans-serif;
            color: #5d54c0;
          }
          .react-joyride__spotlight {
            z-index: 1500 !important;
          }
          .__floater {
            z-index: 2000 !important;
          }
        `}
      </style>
      <Joyride
        steps={steps}
        run={run}
        continuous
        showSkipButton
        showProgress
        disableScrolling
        disableOverlayClose
        spotlightClicks={false}
        callback={handleJoyrideCallback}
        styles={joyrideStyles}
        locale={{
          back: 'Anterior',
          close: 'Cerrar',
          last: 'Finalizar',
          next: 'Siguiente',
          skip: 'Omitir',
        }}
        floaterProps={{
          disableAnimation: true,
        }}
      />
    </>
  );
};

export default Tutorial;
