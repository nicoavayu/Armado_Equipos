import React, { useState, useEffect } from 'react';
import { supabase, addFreePlayer, removeFreePlayer, getFreePlayerStatus, getFreePlayersList } from './supabase';
import { toast } from 'react-toastify';
import { useAuth } from './components/AuthProvider';
import { PlayerCardTrigger } from './components/ProfileComponents';
import './QuieroJugar.css';
import './VotingView.css';

export default function QuieroJugar({ onVolver }) {
  // Clase para dar espacio al TabBar
  const containerClass = 'quiero-jugar-container content-with-tabbar';
  const { user } = useAuth();
  const [partidosAbiertos, setPartidosAbiertos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRegisteredAsFree, setIsRegisteredAsFree] = useState(false);
  const [freePlayers, setFreePlayers] = useState([]);
  const [sortBy, setSortBy] = useState('distance'); // 'distance' or 'rating'
  const [userLocation, setUserLocation] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    // Read from sessionStorage if available
    const savedTab = sessionStorage.getItem('quiero-jugar-tab');
    return savedTab === 'players' || savedTab === 'matches' ? savedTab : 'matches';
  }); // 'matches' or 'players'

  useEffect(() => {
    fetchPartidosAbiertos();
    if (user) {
      checkFreePlayerStatus();
      fetchFreePlayers();
      getUserLocation();
    }
  }, [user]);

  // Get user's current location
  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.log('Geolocation error:', error);
          // Fallback to default location (Buenos Aires)
          setUserLocation({ lat: -34.6037, lng: -58.3816 });
        },
      );
    } else {
      // Fallback to default location
      setUserLocation({ lat: -34.6037, lng: -58.3816 });
    }
  };

  // Calculate distance between two points
  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Auto-refresh free players every 5 seconds
  useEffect(() => {
    if (user && activeTab === 'players') {
      const interval = setInterval(() => {
        fetchFreePlayers();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [user, activeTab]);

  // Auto-refresh free players every 5 seconds
  useEffect(() => {
    if (user && activeTab === 'players') {
      const interval = setInterval(() => {
        fetchFreePlayers();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [user, activeTab]);

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
      // Step 1: Get free players data
      const { data: freePlayersData, error: freePlayersError } = await supabase
        .from('jugadores_sin_partido')
        .select('*')
        .eq('disponible', true)
        .order('created_at', { ascending: false });
        
      if (freePlayersError) throw freePlayersError;
      
      if (!freePlayersData || freePlayersData.length === 0) {
        setFreePlayers([]);
        return;
      }
      
      // Step 2: Get user IDs and fetch user profiles
      const userIds = freePlayersData.map((fp) => fp.user_id).filter(Boolean);
      
      if (userIds.length === 0) {
        setFreePlayers([]);
        return;
      }
      
      const { data: userProfiles, error: usersError } = await supabase
        .from('usuarios')
        .select('id, nombre, avatar_url, localidad, latitud, longitud, ranking, partidos_jugados, posicion, acepta_invitaciones, bio, fecha_alta, updated_at')
        .in('id', userIds);
        
      if (usersError) throw usersError;
      
      // Step 3: Map and combine the data
      const players = freePlayersData.map((freePlayer) => {
        const userProfile = userProfiles?.find((up) => up.id === freePlayer.user_id);
        return {
          ...freePlayer,
          // Ensure we have all the necessary fields from user profile
          nombre: userProfile?.nombre || freePlayer.nombre,
          avatar_url: userProfile?.avatar_url || null, // Always map to avatar_url
          localidad: userProfile?.localidad || freePlayer.localidad,
          latitud: userProfile?.latitud || null,
          longitud: userProfile?.longitud || null,
          ranking: userProfile?.ranking || 4.5,
          rating: userProfile?.ranking || 4.5,
        };
      });
      
      console.log('Free players data:', players); // Debug log
      players.forEach((player, index) => {
        console.log(`Player ${index}:`, {
          nombre: player.nombre,
          avatar_url: player.avatar_url,
          localidad: player.localidad,
          all_fields: Object.keys(player),
        });
      });
      
      setFreePlayers(players);
    } catch (error) {
      console.error('Error fetching free players:', error);
    }
  };

  // Sort free players
  const sortedFreePlayers = [...freePlayers].sort((a, b) => {
    if (sortBy === 'rating') {
      const ratingA = a.ranking || a.calificacion || 0;
      const ratingB = b.ranking || b.calificacion || 0;
      return ratingB - ratingA; // Higher rating first
    } else {
      if (!userLocation) return 0;
      // Use player coordinates or default to Buenos Aires
      const latA = a.latitud || -34.6037;
      const lngA = a.longitud || -58.3816;
      const latB = b.latitud || -34.6037;
      const lngB = b.longitud || -58.3816;
      
      const distanceA = calculateDistance(userLocation.lat, userLocation.lng, latA, lngA);
      const distanceB = calculateDistance(userLocation.lat, userLocation.lng, latB, lngB);
      return distanceA - distanceB; // Closer first
    }
  });

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
      if (jugadoresActuales.some((j) => j.nombre.toLowerCase() === nombre.trim().toLowerCase())) {
        toast.error('Ya hay un jugador con ese nombre en el partido');
        return;
      }

      const nuevoJugador = {
        nombre: nombre.trim(),
        uuid: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        foto_url: null,
        score: 5,
      };

      // Don't add to global table, just use in match

      const nuevosJugadores = [...jugadoresActuales, nuevoJugador];
      const partidoCompleto = nuevosJugadores.length >= cupoMaximo;

      const { error } = await supabase
        .from('partidos')
        .update({ 
          jugadores: nuevosJugadores,
          falta_jugadores: partidoCompleto ? false : true, // Only close when full
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
      <div style={{ position: 'relative', marginBottom: '24px' }}>
        <button 
          onClick={onVolver}
          style={{
            position: 'absolute',
            top: '15px',
            left: '-95px',
            background: 'none',
            border: 'none',
            color: 'white',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '12px',
            transition: 'background 0.2s',
            minWidth: '40px',
            minHeight: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
          onMouseEnter={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.15)'}
          onMouseLeave={(e) => e.target.style.background = 'none'}
        >
          ◀
        </button>
        <h1 className="quiero-jugar-title" style={{ paddingLeft: '0px'  }}>QUIERO JUGAR</h1>
      </div>
      
      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === 'matches' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('matches');
            sessionStorage.setItem('quiero-jugar-tab', 'matches');
          }}
        >
          PARTIDOS ABIERTOS
        </button>
        <button
          className={`tab-button ${activeTab === 'players' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('players');
            sessionStorage.setItem('quiero-jugar-tab', 'players');
          }}
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
            {partidosAbiertos.map((partido) => {
              const jugadoresCount = partido.jugadores?.length || 0;
              const cupoMaximo = partido.cupo_jugadores || 20;
              const faltanJugadores = cupoMaximo - jugadoresCount;
              
              return (
                <div key={partido.id} className="match-card">
                  <div className="match-title">
                    {partido.nombre || `${partido.modalidad || 'F5'}`}
                  </div>
                  <div className="match-details">
                    {partido.modalidad?.replace('F', 'FÚTBOL ')} • {partido.tipo_partido || 'Masculino'} • FALTAN {faltanJugadores} JUGADOR{faltanJugadores !== 1 ? 'ES' : ''}
                  </div>
                  <div className="match-details">
                    {new Date(partido.fecha + 'T00:00:00').toLocaleDateString('es-ES', { 
                      weekday: 'long', 
                      day: 'numeric', 
                      month: 'numeric', 
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
              {/* Sort buttons */}
              <div className="sort-buttons">
                <button 
                  className={`sort-btn ${sortBy === 'distance' ? 'active' : ''}`}
                  onClick={() => setSortBy('distance')}
                >
                  📍 Distancia
                </button>
                <button 
                  className={`sort-btn ${sortBy === 'rating' ? 'active' : ''}`}
                  onClick={() => setSortBy('rating')}
                >
                  ⭐ Rating
                </button>
              </div>
              
              {sortedFreePlayers.map((player) => (
                <PlayerCardTrigger key={player.uuid || player.id} profile={player}>
                  <div className="free-player-card">
                    <div className="free-player-avatar">
                      {(() => {
                        console.log('Renderizando jugador:', player);
                        const avatarUrl = player.avatar_url;
                        console.log(`Avatar for ${player.nombre}:`, avatarUrl);
                        return avatarUrl ? (
                          <img 
                            src={avatarUrl} 
                            alt={player.nombre}
                            className="free-player-img"
                            onError={(e) => {
                              console.log('Avatar failed to load:', avatarUrl);
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        ) : (
                          <div className="free-player-placeholder">👤</div>
                        );
                      })()}
                      <div className="free-player-placeholder" style={{ display: 'none' }}>👤</div>
                    </div>
                    <div className="free-player-info">
                      <div className="free-player-name">{player.nombre}</div>
                      <div className="free-player-distance">
                        📍 {userLocation ? 
                          Math.round(calculateDistance(
                            userLocation.lat, 
                            userLocation.lng, 
                            player.latitud || -34.6037, 
                            player.longitud || -58.3816,
                          )) : '?'
                        } km
                      </div>
                    </div>
                    <div className="free-player-stats">
                      <div className="free-player-rating">
                        <span className="rating-value">{(player.rating || player.ranking || player.calificacion || 4.5).toFixed(1)}</span>
                        <span className="rating-stars">⭐</span>
                      </div>
                      <div className="free-player-badges">
                        {(player?.mvps > 0) && (
                          <div className="free-badge mvp">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={12} height={12}>
                              <path fillRule="evenodd" d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 0 0-.584.859 6.753 6.753 0 0 0 6.138 5.6 6.73 6.73 0 0 0 2.743 1.346A6.707 6.707 0 0 1 9.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 0 0-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-2.25-2.25H16.5v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 0 1-1.112-3.173 6.73 6.73 0 0 0 2.743-1.347 6.753 6.753 0 0 0 6.139-5.6.75.75 0 0 0-.585-.858 47.077 47.077 0 0 0-3.07-.543V2.62a.75.75 0 0 0-.658-.744 49.22 49.22 0 0 0-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 0 0-.657.744Z" clipRule="evenodd" />
                            </svg>
                            <span>{player.mvps}</span>
                          </div>
                        )}
                        {(player?.tarjetas_rojas > 0) && (
                          <div className="free-badge red-card">
                            <span className="red-card-emoji">🟥</span>
                            <span>{player.tarjetas_rojas}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </PlayerCardTrigger>
              ))}
            </>
          )}
        </>
      )}

      {/* Botón de volver eliminado ya que ahora tenemos el TabBar */}
    </div>
  );
}