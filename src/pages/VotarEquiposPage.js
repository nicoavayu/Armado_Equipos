import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveMatchIdFromQueryParams, fetchMatchById, handleMatchResolutionError } from '../utils/matchResolver';
import NetworkStatus from '../components/NetworkStatus';
import VotingView from './VotingView';

const VotarEquiposPage = () => {
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

    // No voting parameters - show empty state
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

  if (!showVotingView) {
    return null;
  }

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
          lastSearchRef.current = '';
          navigate('/');
        }}
      />
    </div>
  );
};

export default VotarEquiposPage;
