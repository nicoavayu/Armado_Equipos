import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveMatchIdFromQueryParams, fetchMatchById, handleMatchResolutionError } from '../utils/matchResolver';
import NetworkStatus from '../components/NetworkStatus';
import VotingView from './VotingView';
import { CircleX } from 'lucide-react';

const VotarEquiposPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [partidoActual, setPartidoActual] = useState(null);
  const [showVotingView, setShowVotingView] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [terminalError, setTerminalError] = useState(null);

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

  const resetVotingShell = (targetRoute = resolveVotingExitRoute()) => {
    setShowVotingView(false);
    setPartidoActual(null);
    setTerminalError(null);
    lastSearchRef.current = '';
    navigate(targetRoute, { replace: true });
  };

  const handlePublicVotingError = (error) => {
    handleMatchResolutionError(error);
    setShowVotingView(true);
    setPartidoActual(null);
    setIsLoading(false);
    setTerminalError(error || 'No se pudo cargar la votación.');
  };

  const terminalErrorTitle = String(terminalError || '').includes('No se encontró partido con código')
    ? 'Link inválido'
    : 'No se pudo cargar la votación';

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
      setTerminalError(null);
      return;
    }

    // Has voting parameters - resolve and load
    setShowVotingView(true);
    setIsLoading(true);
    setTerminalError(null);

    resolveMatchIdFromQueryParams(params)
      .then(async ({ partidoId: resolvedId, error }) => {
        if (error || !resolvedId) {
          handlePublicVotingError(error);
          return;
        }

        // Fetch match data
        const { partido, error: fetchError } = await fetchMatchById(resolvedId);
        if (fetchError || !partido) {
          handlePublicVotingError(fetchError);
          return;
        }

        setPartidoActual(partido);
        setTerminalError(null);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[VOTING] Unexpected error:', err);
        handlePublicVotingError('Error inesperado al cargar el partido');
      });
  }, [location.search, navigate]);

  if (!showVotingView) {
    return null;
  }

  return (
    <div className="pb-0">
      <NetworkStatus />
      {terminalError ? (
        <div className="min-h-[100dvh] w-screen bg-fifa-gradient flex items-center justify-center p-4">
          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 max-w-md w-full text-center">
            <div className="flex items-center justify-center mb-4">
              <CircleX className="w-12 h-12 text-red-300/90" />
            </div>
            <h1 className="text-white text-2xl font-bold mb-3">{terminalErrorTitle}</h1>
            <p className="text-white/70">{terminalError}</p>
          </div>
        </div>
      ) : (
        <VotingView
          jugadores={partidoActual ? partidoActual.jugadores : []}
          partidoActual={partidoActual}
          isLoading={isLoading}
          onReset={() => resetVotingShell()}
          onCancel={() => resetVotingShell('/')}
        />
      )}
    </div>
  );
};

export default VotarEquiposPage;
