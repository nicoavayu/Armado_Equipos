import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import { useAuth } from '../components/AuthProvider';
import PageTransition from '../components/PageTransition';
import LoadingSpinner from '../components/LoadingSpinner';
import Button from '../components/Button';
import AdminPanel from './AdminPanel';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import {
  getPartidoPorId,
  updateJugadoresFrecuentes,
  getJugadoresDelPartido,
  refreshJugadoresPartido,
} from '../supabase';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';
import { useSupabaseRealtime } from '../hooks/useSupabaseRealtime';
import { useInterval } from '../hooks/useInterval';

const AdminPanelPage = () => {
  const navigate = useNavigate();
  const { navigateWithAnimation } = useAnimatedNavigation();
  const { partidoId } = useParams();
  const { user } = useAuth();
  const [partidoActual, setPartidoActual] = useState(null);
  const [jugadoresDelPartido, setJugadoresDelPartido] = useState([]);
  const [loading, setLoading] = useState(true);
  const matchId = Number(partidoId);
  const partidoActualRef = useRef(null);
  const bundleRefreshInFlightRef = useRef(false);
  const { setIntervalSafe, clearIntervalSafe } = useInterval();

  useEffect(() => {
    partidoActualRef.current = partidoActual;
  }, [partidoActual]);

  const loadMatchBundle = useCallback(async ({
    withLoading = false,
    allowRedirect = false,
    refreshPlayersOnly = false,
  } = {}) => {
    if (!matchId || Number.isNaN(matchId)) return;
    if (!withLoading && bundleRefreshInFlightRef.current) return;

    if (withLoading) {
      setLoading(true);
    }

    try {
      bundleRefreshInFlightRef.current = true;
      let partido = refreshPlayersOnly ? partidoActualRef.current : await getPartidoPorId(matchId);

      if (!refreshPlayersOnly) {
        if (!partido) {
          notifyBlockingError('Partido no encontrado');
          if (allowRedirect) {
            navigate('/');
          }
          return;
        }

        setPartidoActual((prev) => ({
          ...(prev || {}),
          ...partido,
        }));
      }

      let jugadores = await getJugadoresDelPartido(matchId);

      if (!refreshPlayersOnly && jugadores.length === 0 && partido?.jugadores?.length > 0) {
        try {
          jugadores = await refreshJugadoresPartido(matchId);
        } catch (refreshError) {
          console.error('Error refreshing players:', refreshError);
        }
      }

      setJugadoresDelPartido(jugadores);
      setPartidoActual((prev) => {
        if (!prev && !partido) return prev;
        return {
          ...(prev || {}),
          ...(partido || {}),
          jugadores,
        };
      });
    } catch (error) {
      console.error('Error loading match bundle:', error);
      if (allowRedirect) {
        notifyBlockingError('Error al cargar el partido');
        navigate('/');
      }
    } finally {
      bundleRefreshInFlightRef.current = false;
      if (withLoading) {
        setLoading(false);
      }
    }
  }, [matchId, navigate]);

  useEffect(() => {
    if (partidoId) {
      loadMatchBundle({ withLoading: true, allowRedirect: true });
    }
  }, [partidoId, loadMatchBundle, user]);

  useRefreshOnVisibility(() => {
    loadMatchBundle();
  }, {
    enabled: Boolean(matchId),
  });

  useEffect(() => {
    if (!matchId || Number.isNaN(matchId)) {
      clearIntervalSafe();
      return undefined;
    }

    setIntervalSafe(() => {
      if (document.visibilityState !== 'visible') return;
      loadMatchBundle();
    }, 5000);

    return clearIntervalSafe;
  }, [clearIntervalSafe, loadMatchBundle, matchId, setIntervalSafe]);

  const realtimeEvents = useMemo(() => (
    matchId ? [
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'partidos',
        filter: `id=eq.${matchId}`,
        handler: () => {
          loadMatchBundle({ refreshPlayersOnly: false });
        },
      },
      {
        event: '*',
        schema: 'public',
        table: 'jugadores',
        filter: `partido_id=eq.${matchId}`,
        handler: () => {
          loadMatchBundle({ refreshPlayersOnly: true });
        },
      },
    ] : []
  ), [loadMatchBundle, matchId]);

  useSupabaseRealtime({
    enabled: Boolean(matchId),
    channelName: matchId ? `admin-panel-page-${matchId}` : null,
    deps: [matchId],
    events: realtimeEvents,
  });

  const handleJugadoresChange = async (nuevosJugadores) => {
    if (!partidoActual) return;
    const safeJugadores = Array.isArray(nuevosJugadores) ? nuevosJugadores : [];

    // Persist changes are already handled by the child flow (insert/delete/rpc).
    // Here we only sync parent state to avoid double-write collisions when roster is full.
    setJugadoresDelPartido(safeJugadores);
    setPartidoActual((prev) => {
      if (!prev) return prev;
      return { ...prev, jugadores: safeJugadores };
    });

    if (partidoActual.from_frequent_match_id) {
      try {
        await updateJugadoresFrecuentes(partidoActual.from_frequent_match_id, safeJugadores);
      } catch (error) {
        notifyBlockingError('Error actualizando partido frecuente');
      }
    } else if (safeJugadores.length === 0 && partidoActual.id) {
      // Defensive refresh if an unexpected empty payload arrives.
      try {
        const refreshedPlayers = await refreshJugadoresPartido(partidoActual.id);
        setJugadoresDelPartido(refreshedPlayers);
      } catch (_refreshError) {
        // non-blocking
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-clip flex items-center justify-center content-with-tabbar">
        <LoadingSpinner size="large" fullScreen />
      </div>
    );
  }

  if (!partidoActual) {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-clip flex flex-col items-center pt-20">
        <div className="bg-white/10 p-8 rounded-2xl shadow-fifa-card backdrop-blur-md flex flex-col items-center gap-4">
          <div className="text-white text-3xl font-oswald font-semibold tracking-[0.01em]">Partido no encontrado</div>
          <Button onClick={() => navigate('/')} ariaLabel="Volver al inicio">VOLVER AL INICIO</Button>
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-[100dvh] w-full max-w-full overflow-visible">
        <div className="mx-auto w-[90vw] max-w-[650px] pt-5 min-w-0 overflow-visible">
          <AdminPanel
            partidoActual={partidoActual}
            jugadores={jugadoresDelPartido}
            onJugadoresChange={(nuevosJugadores) => {
              console.log('Players changed:', Array.isArray(nuevosJugadores) ? nuevosJugadores.length : 0);
              handleJugadoresChange(nuevosJugadores);
            }}
            onBackToHome={() => navigateWithAnimation('/', 'back')}
          />
        </div>
      </div>
    </PageTransition>
  );
};

export default AdminPanelPage;
