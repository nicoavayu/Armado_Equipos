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

  const resolveVotingExitRoute = () => {
    const params = new URLSearchParams(location.search);
    const returnTo = params.get('returnTo');
    const adminPartidoId = params.get('adminPartidoId') || params.get('partidoId');

    if (returnTo === 'armar-equipos' && adminPartidoId) {
      return `/admin/${adminPartidoId}?view=armar-equipos`;
    }

    return '/';
  };

  const currentParams = new URLSearchParams(location.search);
  const hasVotingParams = currentParams.has('partidoId') || currentParams.has('codigo');

  const resetVotingShell = (targetRoute = resolveVotingExitRoute()) => {
    setShowVotingView(false);
    setPartidoActual(null);
    lastSearchRef.current = '';
    navigate(targetRoute, { replace: true });
  };

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
    if (hasVotingParams) return null;

    return (
      <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center px-4">
        <NetworkStatus />
        <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#1a1f46]/90 p-6 text-center text-white">
          <h1 className="font-oswald text-3xl font-semibold tracking-[0.01em]">Link incompleto</h1>
          <p className="mt-3 text-white/75">
            No encontramos el partido para votar. Abrí el link original o pedile uno nuevo al organizador.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-0">
      <NetworkStatus />
      <VotingView
        jugadores={partidoActual ? partidoActual.jugadores : []}
        partidoActual={partidoActual}
        isLoading={isLoading}
        onReset={() => resetVotingShell()}
        onCancel={() => resetVotingShell('/')}
      />
    </div>
  );
};

export default VotarEquiposPage;
