import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAnimatedNavigation } from '../hooks/useAnimatedNavigation';
import { useAuth } from '../components/AuthProvider';
import PageTransition from '../components/PageTransition';
import LoadingSpinner from '../components/LoadingSpinner';
import Button from '../components/Button';
import AdminPanel from './AdminPanel';
import {
  getPartidoPorId,
  updateJugadoresFrecuentes,
  getJugadoresDelPartido,
  refreshJugadoresPartido,
} from '../supabase';

const AdminPanelPage = () => {
  const navigate = useNavigate();
  const { navigateWithAnimation } = useAnimatedNavigation();
  const { partidoId } = useParams();
  const { user } = useAuth();
  const [partidoActual, setPartidoActual] = useState(null);
  const [jugadoresDelPartido, setJugadoresDelPartido] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.has('codigo')) return;

    const cargarPartido = async () => {
      try {
        const id = Number(partidoId);
        const partido = await getPartidoPorId(id);
        if (partido) {
          setPartidoActual(partido);

          const jugadores = await getJugadoresDelPartido(id);
          setJugadoresDelPartido(jugadores);

          if (jugadores.length === 0 && partido.jugadores && partido.jugadores.length > 0) {
            console.log('Refreshing players for match:', id);
            try {
              const refreshedPlayers = await refreshJugadoresPartido(id);
              setJugadoresDelPartido(refreshedPlayers);
            } catch (refreshError) {
              console.error('Error refreshing players:', refreshError);
            }
          }
        } else {
          toast.error('Partido no encontrado');
          navigate('/');
        }
      } catch (error) {
        console.error('Error loading match:', error);
        toast.error('Error al cargar el partido');
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    if (partidoId) {
      cargarPartido();
    }
  }, [partidoId, navigate, user]);

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
        toast.error('Error actualizando partido frecuente');
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
        <LoadingSpinner size="large" />
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
