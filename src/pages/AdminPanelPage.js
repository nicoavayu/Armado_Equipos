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
  updateJugadoresPartido,
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
    try {
      await updateJugadoresPartido(partidoActual.id, nuevosJugadores);
      setPartidoActual({ ...partidoActual, jugadores: nuevosJugadores });
      if (partidoActual.from_frequent_match_id) {
        try {
          await updateJugadoresFrecuentes(partidoActual.from_frequent_match_id, nuevosJugadores);
        } catch (error) {
          toast.error('Error actualizando partido frecuente');
        }
      }
    } catch (error) {
      console.error('Error updating players:', error);
      if (error?.code === '23505') {
        console.warn('Duplicate key error, refreshing players...');
        // Silent recovery or mild warning
        try {
          const refreshedPlayers = await refreshJugadoresPartido(partidoActual.id);
          setJugadoresDelPartido(refreshedPlayers);
          // Optional: toast.success('Lista de jugadores sincronizada');
        } catch (refreshError) {
          console.error('Error refreshing after duplicate error:', refreshError);
        }
      } else if (error?.message?.includes('row-level security policy')) {
        console.warn('Suppressing RLS error during sync (expected for non-admins):', error);
      } else {
        toast.error('Error al actualizar jugadores: ' + (error.message || 'Error desconocido'));
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
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-clip pb-24 flex flex-col items-center pt-20">
        <div className="bg-white/10 p-8 rounded-2xl shadow-fifa-card backdrop-blur-md flex flex-col items-center gap-4">
          <div className="text-white text-3xl font-bebas tracking-wide">PARTIDO NO ENCONTRADO</div>
          <Button onClick={() => navigate('/')} ariaLabel="Volver al inicio">VOLVER AL INICIO</Button>
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-[100dvh] w-full max-w-full pb-24 overflow-x-clip">
        <div className="mx-auto w-[90vw] max-w-[650px] pt-5 min-w-0 overflow-x-clip">
          <AdminPanel
            partidoActual={partidoActual}
            jugadores={jugadoresDelPartido}
            onJugadoresChange={(nuevosJugadores) => {
              console.log('Players changed:', nuevosJugadores.length);
              handleJugadoresChange(nuevosJugadores);
              setJugadoresDelPartido(nuevosJugadores);
            }}
            onBackToHome={() => navigateWithAnimation('/', 'back')}
          />
        </div>
      </div>
    </PageTransition>
  );
};

export default AdminPanelPage;
