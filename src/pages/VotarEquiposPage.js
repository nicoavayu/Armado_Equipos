import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MATCH_RESOLUTION_STATUS,
  resolveMatchIdFromQueryParams,
  fetchMatchById,
  handleMatchResolutionError,
  isExpectedMatchResolution,
} from '../utils/matchResolver';
import NetworkStatus from '../components/NetworkStatus';
import VotingView from './VotingView';
import { ArrowLeft, CircleX, Search } from 'lucide-react';

const normalizeCodigoInput = (value) => {
  const rawValue = String(value || '').trim();
  const token = rawValue.match(/[A-Za-z0-9]+/)?.[0] || '';
  return token.toUpperCase();
};

const VotarEquiposPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [partidoActual, setPartidoActual] = useState(null);
  const [showVotingView, setShowVotingView] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [terminalError, setTerminalError] = useState(null);
  const [manualCodigo, setManualCodigo] = useState('');

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
    setManualCodigo('');
    lastSearchRef.current = '';
    navigate(targetRoute, { replace: true });
  };

  const handlePublicVotingError = (result) => {
    const resolution = typeof result === 'object' && result !== null
      ? result
      : {
        error: result || 'No se pudo cargar la votación.',
        status: MATCH_RESOLUTION_STATUS.ERROR,
        shouldReport: true,
        cause: result,
      };

    if (!isExpectedMatchResolution(resolution)) {
      handleMatchResolutionError(resolution);
    }

    setShowVotingView(true);
    setPartidoActual(null);
    setIsLoading(false);
    setTerminalError({
      message: resolution.error || 'No se pudo cargar la votación.',
      status: resolution.status || MATCH_RESOLUTION_STATUS.ERROR,
    });
    setManualCodigo('');
  };

  const terminalErrorMessage = terminalError?.message || '';
  const terminalErrorTitle = terminalError?.status === MATCH_RESOLUTION_STATUS.NOT_FOUND
    ? 'No encontramos ese partido'
    : terminalError?.status === MATCH_RESOLUTION_STATUS.INVALID_PARAMS
      ? 'Link inválido'
      : 'No se pudo cargar la votación';
  const canRetryWithCode = [
    MATCH_RESOLUTION_STATUS.NOT_FOUND,
    MATCH_RESOLUTION_STATUS.INVALID_PARAMS,
    MATCH_RESOLUTION_STATUS.MISSING_PARAMS,
  ].includes(terminalError?.status);

  const handleManualCodigoSubmit = (event) => {
    event.preventDefault();
    const codigo = normalizeCodigoInput(manualCodigo);
    if (!codigo) return;

    lastSearchRef.current = '';
    navigate(`/votar-equipos?codigo=${encodeURIComponent(codigo)}`, { replace: true });
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
      setTerminalError(null);
      return;
    }

    // Has voting parameters - resolve and load
    setShowVotingView(true);
    setIsLoading(true);
    setTerminalError(null);

    resolveMatchIdFromQueryParams(params)
      .then(async (resolution) => {
        const { partidoId: resolvedId, error } = resolution;
        if (error || !resolvedId) {
          handlePublicVotingError(resolution);
          return;
        }

        // Fetch match data
        const matchResult = await fetchMatchById(resolvedId);
        const { partido, error: fetchError } = matchResult;
        if (fetchError || !partido) {
          handlePublicVotingError(matchResult);
          return;
        }

        setPartidoActual(partido);
        setTerminalError(null);
        setIsLoading(false);
      })
      .catch((err) => {
        handlePublicVotingError({
          error: 'Error inesperado al cargar el partido',
          status: MATCH_RESOLUTION_STATUS.ERROR,
          shouldReport: true,
          cause: err,
          context: { action: 'load_public_voting' },
        });
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
            <p className="text-white/70">{terminalErrorMessage}</p>
            {canRetryWithCode ? (
              <form className="mt-5 space-y-3" onSubmit={handleManualCodigoSubmit}>
                <label className="sr-only" htmlFor="voting-code-retry">Código del partido</label>
                <input
                  id="voting-code-retry"
                  value={manualCodigo}
                  onChange={(event) => setManualCodigo(event.target.value)}
                  placeholder="Código del partido"
                  autoComplete="off"
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-center text-white placeholder:text-white/45 outline-none focus:border-white/50"
                />
                <button
                  type="submit"
                  className="w-full min-h-[44px] rounded-lg bg-white text-[#15152d] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!normalizeCodigoInput(manualCodigo)}
                >
                  <Search size={18} aria-hidden="true" />
                  <span>Buscar</span>
                </button>
              </form>
            ) : null}
            <button
              type="button"
              onClick={() => resetVotingShell('/')}
              className="mt-3 w-full min-h-[44px] rounded-lg border border-white/20 text-white font-semibold inline-flex items-center justify-center gap-2 hover:bg-white/10"
            >
              <ArrowLeft size={18} aria-hidden="true" />
              <span>Volver al inicio</span>
            </button>
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
