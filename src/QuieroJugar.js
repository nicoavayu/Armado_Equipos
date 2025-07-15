import React, { useState, useEffect } from 'react';
import { supabase, addFreePlayer, removeFreePlayer, getFreePlayerStatus, getFreePlayersList } from './supabase';
import { toast } from 'react-toastify';
import { useAuth } from './components/AuthProvider';
import './VotingView.css';

export default function QuieroJugar({ onVolver }) {
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
    <div className="voting-bg">
      <div className="voting-modern-card">
        <div className="match-name">QUIERO JUGAR</div>
        
        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          marginBottom: 20,
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.3)'
        }}>
          <button
            onClick={() => setActiveTab('matches')}
            style={{
              flex: 1,
              padding: '12px',
              background: activeTab === 'matches' ? '#0EA9C6' : 'transparent',
              color: '#fff',
              border: 'none',
              fontFamily: "'Oswald', Arial, sans-serif",
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            PARTIDOS ABIERTOS
          </button>
          <button
            onClick={() => setActiveTab('players')}
            style={{
              flex: 1,
              padding: '12px',
              background: activeTab === 'players' ? '#0EA9C6' : 'transparent',
              color: '#fff',
              border: 'none',
              fontFamily: "'Oswald', Arial, sans-serif",
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            JUGADORES LIBRES
          </button>
        </div>

        {activeTab === 'matches' ? (
          // Matches Tab
          partidosAbiertos.length === 0 ? (
            <div style={{
              color: "rgba(255,255,255,0.7)",
              fontSize: 16,
              textAlign: "center",
              margin: "40px 0",
              fontFamily: "'Oswald', Arial, sans-serif"
            }}>
              No hay partidos buscando jugadores en este momento
            </div>
          ) : (
            <div className="frequent-list">
              {partidosAbiertos.map(partido => {
                const jugadoresCount = partido.jugadores?.length || 0;
                const cupoMaximo = partido.cupo_jugadores || 20;
                const faltanJugadores = cupoMaximo - jugadoresCount;
                
                return (
                  <div key={partido.id} className="frequent-list-item">
                    <div className="frequent-item-info">
                      <div className="frequent-item-name">
                        {partido.nombre || `${partido.modalidad || 'Fútbol'}`}
                      </div>
                      <div className="frequent-item-details">
                        {partido.modalidad?.replace('F', 'Fútbol ')} • Faltan {faltanJugadores} jugador{faltanJugadores !== 1 ? 'es' : ''}
                      </div>
                      <div className="frequent-item-details">
                        {new Date(partido.fecha + 'T00:00:00').toLocaleDateString('es-ES', { 
                          weekday: 'long', 
                          day: 'numeric', 
                          month: 'numeric' 
                        })} {partido.hora}
                      </div>
                      <div className="frequent-item-sede">
                        📍 {partido.sede}
                      </div>
                    </div>
                    <div className="frequent-item-actions">
                      <button
                        className="frequent-action-btn"
                        onClick={() => handleSumarse(partido)}
                        style={{ background: '#0EA9C6', borderColor: '#0EA9C6', flex: 1 }}
                      >
                        SUMARME ({jugadoresCount}/{cupoMaximo})
                      </button>
                      <button
                        className="frequent-action-btn"
                        onClick={() => handleBorrarPartido(partido)}
                        style={{ background: '#dc3545', borderColor: '#dc3545', marginLeft: '8px', minWidth: '60px' }}
                        title="Borrar partido"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          // Free Players Tab
          <div>
            {user ? (
              <div style={{ marginBottom: 20 }}>
                {!isRegisteredAsFree ? (
                  <button
                    className="voting-confirm-btn"
                    onClick={handleRegisterAsFree}
                    style={{ background: '#28a745', borderColor: '#28a745', marginBottom: 16 }}
                  >
                    🙋 ANOTARME COMO DISPONIBLE
                  </button>
                ) : (
                  <button
                    className="voting-confirm-btn"
                    onClick={handleUnregisterAsFree}
                    style={{ background: '#dc3545', borderColor: '#dc3545', marginBottom: 16 }}
                  >
                    ❌ YA NO ESTOY DISPONIBLE
                  </button>
                )}
              </div>
            ) : (
              <div style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: 16,
                textAlign: "center",
                margin: "20px 0",
                fontFamily: "'Oswald', Arial, sans-serif",
                background: "rgba(255,255,255,0.1)",
                padding: "16px",
                borderRadius: "8px"
              }}>
                Inicia sesión para anotarte como jugador disponible
              </div>
            )}
            
            {freePlayers.length === 0 ? (
              <div style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: 16,
                textAlign: "center",
                margin: "40px 0",
                fontFamily: "'Oswald', Arial, sans-serif"
              }}>
                No hay jugadores disponibles en este momento
              </div>
            ) : (
              <div className="frequent-list">
                {freePlayers.map(player => (
                  <div key={player.id} className="frequent-list-item">
                    <div className="frequent-item-info">
                      <div className="frequent-item-name">
                        {player.nombre}
                      </div>
                      <div className="frequent-item-details">
                        📍 {player.localidad}
                      </div>
                      <div className="frequent-item-sede">
                        {formatTimeAgo(player.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          className="voting-confirm-btn"
          style={{ 
            background: 'rgba(255,255,255,0.1)', 
            borderColor: '#fff', 
            color: '#fff',
            marginTop: 20
          }}
          onClick={onVolver}
        >
          VOLVER AL INICIO
        </button>
      </div>
    </div>
  );
}