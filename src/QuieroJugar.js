import React, { useState, useEffect } from 'react';
import { supabase, addFreePlayer, removeFreePlayer, getFreePlayerStatus, getFreePlayersList } from './supabase';
import { toast } from 'react-toastify';
import { useAuth } from './components/AuthProvider';
import './QuieroJugar.css';
import './VotingView.css';

export default function QuieroJugar({ onVolver }) {
  // Clase para dar espacio al TabBar
  const containerClass = "quiero-jugar-container content-with-tabbar";
  const { user } = useAuth();
  const [partidosAbiertos, setPartidosAbiertos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRegisteredAsFree, setIsRegisteredAsFree] = useState(false);
  const [freePlayers, setFreePlayers] = useState([]);
  const [activeTab, setActiveTab] = useState('matches'); // 'matches' or 'players'

  useEffect(() => {
    fetchPartidosAbiertos();
    if (user) {
      checkFreePlayerStatus();
      fetchFreePlayers();
    }
  }, [user]);

  const fetchPartidosAbiertos = async () => {
    try {
      const { data, error } = await supabase
        .from('partidos')
        .select('*')
        .eq('falta_jugadores', true)
        .eq('estado', 'activo')
        .order('fecha', { ascending: true });

      if (error) throw error;
      setPartidosAbiertos(data || []);
    } catch (error) {
      toast.error('Error cargando partidos: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const checkFreePlayerStatus = async () => {
    try {
      const status = await getFreePlayerStatus();
      setIsRegisteredAsFree(status);
    } catch (error) {
      console.error('Error checking free player status:', error);
    }
  };

  const fetchFreePlayers = async () => {
    try {
      const players = await getFreePlayersList();
      setFreePlayers(players);
    } catch (error) {
      console.error('Error fetching free players:', error);
    }
  };

  const handleRegisterAsFree = async () => {
    try {
      await addFreePlayer();
      setIsRegisteredAsFree(true);
      fetchFreePlayers();
      toast.success('¡Te anotaste como disponible!');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const handleUnregisterAsFree = async () => {
    try {
      await removeFreePlayer();
      setIsRegisteredAsFree(false);
      fetchFreePlayers();
      toast.success('Ya no estás disponible');
    } catch (error) {
      toast.error('Error: ' + error.message);
    }
  };

  const formatTimeAgo = (timestamp) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInHours = Math.floor((now - time) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Hace menos de 1 hora';
    if (diffInHours === 1) return 'Hace 1 hora';
    if (diffInHours < 24) return `Hace ${diffInHours} horas`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return 'Hace 1 día';
    return `Hace ${diffInDays} días`;
  };

  const handleBorrarPartido = async (partido) => {
    if (!window.confirm(`¿Borrar el partido "${partido.nombre || partido.modalidad}"?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('partidos')
        .delete()
        .eq('id', partido.id);

      if (error) throw error;

      toast.success('Partido borrado');
      fetchPartidosAbiertos(); // Refrescar lista
    } catch (error) {
      toast.error('Error al borrar: ' + error.message);
    }
  };

  const handleSumarse = async (partido) => {
    // Verificar si ya se sumó desde este dispositivo
    const yaSesumo = localStorage.getItem(`sumado_partido_${partido.id}`);
    if (yaSesumo) {
      toast.error('Ya te sumaste a este partido desde este dispositivo');
      return;
    }

    const nombre = prompt('Ingresá tu nombre para sumarte al partido:');
    if (!nombre?.trim()) return;

    try {
      const jugadoresActuales = partido.jugadores || [];
      const cupoMaximo = partido.cupo_jugadores || 20;

      if (jugadoresActuales.length >= cupoMaximo) {
        toast.error('El partido ya está completo');
        return;
      }

      // Verificar si ya está anotado por nombre
      if (jugadoresActuales.some(j => j.nombre.toLowerCase() === nombre.trim().toLowerCase())) {
        toast.error('Ya hay un jugador con ese nombre en el partido');
        return;
      }

      const nuevoJugador = {
        nombre: nombre.trim(),
        uuid: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        foto_url: null,
        score: 5
      };

      // Don't add to global table, just use in match

      const nuevosJugadores = [...jugadoresActuales, nuevoJugador];
      const partidoCompleto = nuevosJugadores.length >= cupoMaximo;

      const { error } = await supabase
        .from('partidos')
        .update({ 
          jugadores: nuevosJugadores,
          falta_jugadores: partidoCompleto ? false : true // Only close when full
        })
        .eq('id', partido.id);

      if (error) throw error;

      // Marcar como sumado en este dispositivo
      localStorage.setItem(`sumado_partido_${partido.id}`, nombre.trim());
      
      toast.success('¡Te sumaste al partido!');
      fetchPartidosAbiertos(); // Refrescar lista
    } catch (error) {
      toast.error('Error al sumarse: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="voting-bg">
        <div className="voting-modern-card">
          <div className="match-name">CARGANDO...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <h1 className="quiero-jugar-title">QUIERO JUGAR</h1>
      
      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === 'matches' ? 'active' : ''}`}
          onClick={() => setActiveTab('matches')}
        >
          PARTIDOS ABIERTOS
        </button>
        <button
          className={`tab-button ${activeTab === 'players' ? 'active' : ''}`}
          onClick={() => setActiveTab('players')}
        >
          JUGADORES LIBRES
        </button>
      </div>

      {activeTab === 'matches' ? (
        // Matches Tab
        partidosAbiertos.length === 0 ? (
          <div className="empty-message">
            No hay partidos buscando jugadores en este momento
          </div>
        ) : (
          <>
            {partidosAbiertos.map(partido => {
              const jugadoresCount = partido.jugadores?.length || 0;
              const cupoMaximo = partido.cupo_jugadores || 20;
              const faltanJugadores = cupoMaximo - jugadoresCount;
              
              return (
                <div key={partido.id} className="match-card">
                  <div className="match-title">
                    {partido.nombre || `${partido.modalidad || 'F5'}`}
                  </div>
                  <div className="match-details">
                    {partido.modalidad?.replace('F', 'FÚTBOL ')} • FALTAN {faltanJugadores} JUGADOR{faltanJugadores !== 1 ? 'ES' : ''}
                  </div>
                  <div className="match-details">
                    {new Date(partido.fecha + 'T00:00:00').toLocaleDateString('es-ES', { 
                      weekday: 'long', 
                      day: 'numeric', 
                      month: 'numeric' 
                    }).toUpperCase()} {partido.hora}
                  </div>
                  <div className="match-location">
                    <span>📍</span> {partido.sede}
                  </div>
                  <div className="match-actions">
                    <button
                      className="sumarme-button"
                      onClick={() => handleSumarse(partido)}
                    >
                      SUMARME <span className="player-count">({jugadoresCount}/{cupoMaximo})</span>
                    </button>
                    <button
                      className="delete-button"
                      onClick={() => handleBorrarPartido(partido)}
                      title="Borrar partido"
                    >
                      X
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )
      ) : (
        // Free Players Tab
        <>
          {user ? (
            <div style={{ width: '100%', maxWidth: '500px', marginBottom: '16px' }}>
              {!isRegisteredAsFree ? (
                <button
                  className="sumarme-button"
                  onClick={handleRegisterAsFree}
                  
                >
                  ANOTARME COMO DISPONIBLE
                </button>
              ) : (
                <button
                  className="sumarme-button"
                  onClick={handleUnregisterAsFree}
                  style={{ background: '#dc3545' }}
                >
                  ❌ YA NO ESTOY DISPONIBLE
                </button>
              )}
            </div>
          ) : (
            <div className="empty-message">
              Inicia sesión para anotarte como jugador disponible
            </div>
          )}
          
          {freePlayers.length === 0 ? (
            <div className="empty-message">
              No hay jugadores disponibles en este momento
            </div>
          ) : (
            <>
              {freePlayers.map(player => (
                <div key={player.id} className="match-card">
                  <div className="match-title">
                    {player.nombre}
                  </div>
                  <div className="match-location">
                    <span>📍</span> {player.localidad || 'Sin especificar'}
                  </div>
                  <div className="match-details">
                    {formatTimeAgo(player.created_at)}
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* Botón de volver eliminado ya que ahora tenemos el TabBar */}
    </div>
  );
}