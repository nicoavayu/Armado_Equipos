// src/components/WelcomeModal.js
import React from 'react';
import { useTutorial } from '../context/TutorialContext';
// import './WelcomeModal.css'; // REMOVED

const WelcomeModal = () => {
  const { showWelcomeModal, startTutorial, skipTutorial } = useTutorial();

  if (!showWelcomeModal) return null;

  return (
    <>
      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[2000]">
        <div className="bg-gradient-to-br from-[#8178e5] to-[#5d54c0] rounded-xl p-6 max-w-[90%] w-[400px] shadow-[0_10px_25px_rgba(0,0,0,0.3)] text-white text-center animate-[fadeIn_0.3s_ease-out]">
          <h2 className="mt-0 font-oswald text-2xl font-normal">¡Bienvenido a Team Balancer!</h2>
          <p className="mb-6 leading-relaxed">
            Esta aplicación te ayuda a organizar partidos y crear equipos equilibrados.
            ¿Te gustaría hacer un recorrido rápido para conocer todas las funciones?
          </p>
          <div className="flex justify-center gap-3">
            <button
              className="py-2.5 px-5 rounded-full font-bold cursor-pointer transition-all duration-200 font-oswald uppercase border-none bg-white text-[#5d54c0] hover:bg-[#f0f0f0] hover:-translate-y-0.5"
              onClick={startTutorial}
            >
              Iniciar tutorial
            </button>
            <button
              className="py-2.5 px-5 rounded-full font-bold cursor-pointer transition-all duration-200 font-oswald uppercase border border-white bg-transparent text-white hover:bg-white/10"
              onClick={skipTutorial}
            >
              Omitir
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default WelcomeModal;