import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getPartidoPorCodigo } from '../supabase';
import NetworkStatus from '../components/NetworkStatus';
import VotingView from './VotingView';
import FifaHome from './FifaHome';
// import '../HomeStyleKit.css'; // Removed in Tailwind migration

const HomePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [partidoActual, setPartidoActual] = useState(null);
  const [showVotingView, setShowVotingView] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const codigo = params.get('codigo');
    if (codigo) {

      setShowVotingView(true);
      getPartidoPorCodigo(codigo)
        .then((partido) => {
          // temporary debug log removed in cleanup
          setPartidoActual(partido);
        })
        .catch((error) => {
          console.error('Error loading match:', error);
          setPartidoActual(null);
        });
    } else {
      setShowVotingView(false);
      setPartidoActual(null);
    }
  }, [location.search]);

  if (showVotingView) {
    return (
      <div className="pb-24">
        <NetworkStatus />
        <VotingView
          jugadores={partidoActual ? partidoActual.jugadores : []}
          partidoActual={partidoActual}
          onReset={() => {
            setShowVotingView(false);
            setPartidoActual(null);
            // Navegar al home limpio
            navigate('/');
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="min-h-[100dvh] w-screen max-w-[100vw] flex flex-col items-center pt-5 overflow-x-hidden pb-24">
        <div className="flex flex-col items-center pt-0 max-w-[800px]" >
          <FifaHome onModoSeleccionado={(modo) => {
            if (modo === 'admin-historial') {
              // Navegar directamente a la lista de partidos frecuentes
              navigate('/?admin=historial');
            }
          }} />
        </div>
      </div>
    </>
  );
};

export default HomePage;
