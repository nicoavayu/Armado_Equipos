import { useState, useEffect } from 'react';
import { STEPS } from '../constants';
import { checkIfAlreadyVoted } from '../supabase';

export const useVotingState = (jugadores, nombre) => {
  const [step, setStep] = useState(STEPS.IDENTIFY);
  const [jugador, setJugador] = useState(null);
  const [votos, setVotos] = useState({});
  const [yaVoto, setYaVoto] = useState(false);
  
  const jugadoresParaVotar = jugadores.filter(j => j.nombre !== nombre);

  useEffect(() => {
    if (!nombre) return;
    const j = jugadores.find(j => j.nombre === nombre);
    setJugador(j || null);
  }, [nombre, jugadores]);

  useEffect(() => {
    async function checkVoteStatus() {
      if (!jugador?.uuid) return;
      try {
        const hasVoted = await checkIfAlreadyVoted(jugador.uuid);
        setYaVoto(hasVoted);
      } catch (error) {
        console.error('Error checking vote status:', error);
      }
    }
    checkVoteStatus();
  }, [jugador]);

  return {
    step,
    setStep,
    jugador,
    votos,
    setVotos,
    yaVoto,
    jugadoresParaVotar
  };
};