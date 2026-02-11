import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { resolveMatchIdFromQueryParams, fetchMatchById, handleMatchResolutionError } from '../utils/matchResolver';
import NetworkStatus from '../components/NetworkStatus';
import VotingView from './VotingView';
import FifaHome from './FifaHome';
// import '../HomeStyleKit.css'; // Removed in Tailwind migration

const HomePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [partidoActual, setPartidoActual] = useState(null);
  const [showVotingView, setShowVotingView] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Prevent double-fetch with ref to track last processed search
  const lastSearchRef = useRef('');

  useEffect(() => {
    const currentSearch = location.search;

    // Prevent double-fetch: skip if same search string
    if (currentSearch === lastSearchRef.current) {
      return;
    }
    lastSearchRef.current = currentSearch;

    const params = new URLSearchParams(currentSearch);
    const partidoId = params.get('partidoId');
    const codigo = params.get('codigo');

    // No voting parameters - show home
    if (!partidoId && !codigo) {
      setShowVotingView(false);
      setPartidoActual(null);
      setIsLoading(false);
      return;
    }

    // Has voting parameters - resolve and load
    setShowVotingView(true);
    setIsLoading(true);

    resolveMatchIdFromQueryParams(params)
      .then(async ({ partidoId: resolvedId, error }) => {
        if (error || !resolvedId) {
          handleMatchResolutionError(error, navigate);
          setPartidoActual(null);
          setIsLoading(false);
          return;
        }

        // Fetch match data
        const { partido, error: fetchError } = await fetchMatchById(resolvedId);
        if (fetchError || !partido) {
          handleMatchResolutionError(fetchError, navigate);
          setPartidoActual(null);
          setIsLoading(false);
          return;
        }

        setPartidoActual(partido);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[VOTING] Unexpected error:', err);
        handleMatchResolutionError('Error inesperado al cargar el partido', navigate);
        setPartidoActual(null);
        setIsLoading(false);
      });
  }, [location.search, navigate]);

  if (showVotingView) {
    return (
      <div className="pb-24">
        <NetworkStatus />
        <VotingView
          jugadores={partidoActual ? partidoActual.jugadores : []}
          partidoActual={partidoActual}
          isLoading={isLoading}
          onReset={() => {
            setShowVotingView(false);
            setPartidoActual(null);
            lastSearchRef.current = ''; // Reset ref on manual reset
            // Navegar al home limpio
            navigate('/');
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="w-full overflow-x-hidden">
        <div className="w-full max-w-[800px] mx-auto px-4 pt-5 box-border">
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

/*
MANUAL TEST CASES:
==================

1. Link with partidoId:
   URL: /?partidoId=123
   Expected: Direct load, no codigo resolution
   
2. Link with codigo:
   URL: /?codigo=ABC123
   Expected: Resolve codigo -> partidoId, then load
   
3. Both parameters:
   URL: /?partidoId=123&codigo=ABC123
   Expected: Use partidoId (priority), ignore codigo
   
4. No parameters:
   URL: /
   Expected: Show home page, no voting view
   
5. Invalid codigo:
   URL: /?codigo=INVALID999
   Expected: Toast error, navigate back to home after 2s
   
6. Invalid partidoId:
   URL: /?partidoId=abc
   Expected: Toast error, navigate back to home after 2s
   
7. Non-existent partidoId:
   URL: /?partidoId=999999
   Expected: Toast error, navigate back to home after 2s
*/
