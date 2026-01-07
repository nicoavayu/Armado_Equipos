import React, { useState, useEffect } from 'react';
import { supabase, addFreePlayer, removeFreePlayer, getFreePlayerStatus } from './supabase';
import { toast } from 'react-toastify';
import { useAuth } from './components/AuthProvider';
import { useInterval } from './hooks/useInterval';
import { PlayerCardTrigger } from './components/ProfileComponents';
import PageTitle from './components/PageTitle';
import LoadingSpinner from './components/LoadingSpinner';
import InviteAmigosModal from './components/InviteAmigosModal';
import { handleError } from './lib/errorHandler';
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
  const [matchSortBy, setMatchSortBy] = useState('proximidad'); // 'proximidad' or 'recientes'
  const [activeTab, setActiveTab] = useState(() => {
    // Read from sessionStorage if available
    const savedTab = sessionStorage.getItem('quiero-jugar-tab');
    return savedTab === 'players' || savedTab === 'matches' ? savedTab : 'matches';
  }); // 'matches' or 'players'
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);

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
          console.log('Geolocation error, using default location:', error);
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
  const { setIntervalSafe, clearIntervalSafe } = useInterval();
  
  useEffect(() => {
    if (user && activeTab === 'players') {
      setIntervalSafe(() => {
        fetchFreePlayers();
      }, 5000);
      return () => clearIntervalSafe();
    }
  }, [user, activeTab, setIntervalSafe, clearIntervalSafe]);

  // Auto-refresh partidos abiertos every 5 seconds
  useEffect(() => {
    if (activeTab === 'matches') {
      setIntervalSafe(() => {
        fetchPartidosAbiertos();
      }, 5000);
      return () => clearIntervalSafe();
    }
  }, [activeTab, setIntervalSafe, clearIntervalSafe]);

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
      handleError(error, { showToast: false });
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
        .select('id, nombre, avatar_url, localidad, latitud, longitud, ranking, partidos_jugados, posicion, acepta_invitaciones, bio, fecha_alta, updated_at, nacionalidad')
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
          nacionalidad: userProfile?.nacionalidad || 'Argentina',
        };
      });
      setFreePlayers(players);
    } catch (error) {
      handleError(error, { showToast: false });
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

  const handleInviteFriends = (partido) => {
    if (!user) {
      toast.error('Debes iniciar sesión para invitar amigos');
      return;
    }
    setSelectedMatch(partido);
    setShowInviteModal(true);
  };

  const _formatTimeAgo = (timestamp) => {
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

  const getCountryFlag = (nationality) => {
    if (!nationality) return '🌍';
    
    const flags = {
      'argentina': '🇦🇷',
      'brasil': '🇧🇷',
      'uruguay': '🇺🇾',
      'chile': '🇨🇱',
      'paraguay': '🇵🇾',
      'bolivia': '🇧🇴',
      'perú': '🇵🇪',
      'peru': '🇵🇪',
      'colombia': '🇨🇴',
      'venezuela': '🇻🇪',
      'ecuador': '🇪🇨',
      'españa': '🇪🇸',
      'spain': '🇪🇸',
      'italia': '🇮🇹',
      'italy': '🇮🇹',
      'francia': '🇫🇷',
      'france': '🇫🇷',
      'alemania': '🇩🇪',
      'germany': '🇩🇪',
      'portugal': '🇵🇹',
      'méxico': '🇲🇽',
      'mexico': '🇲🇽',
      'estados unidos': '🇺🇸',
      'united states': '🇺🇸',
      'reino unido': '🇬🇧',
      'united kingdom': '🇬🇧'
    };
    
    return flags[nationality.toLowerCase()] || '🌍';
  };

  const _handleBorrarPartido = async (partido) => {
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

  const _handleSumarse = async (partido) => {
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
          <LoadingSpinner size="large" />
        </div>
      </div>
    );
  }

  return (
    <>
      <PageTitle onBack={onVolver}>QUIERO JUGAR</PageTitle>
      <div className={containerClass}>
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
          (() => {
            // Filter out matches that are more than 1 hour past their scheduled time
            const filteredPartidos = partidosAbiertos.filter((partido) => {
              const matchDateTime = new Date(`${partido.fecha}T${partido.hora}`);
              const now = new Date();
              const oneHourAfter = new Date(matchDateTime.getTime() + 60 * 60 * 1000);
              return now <= oneHourAfter;
            });
            
            // Sort matches based on selected criteria
            const sortedPartidos = [...filteredPartidos].sort((a, b) => {
              if (matchSortBy === 'proximidad') {
                const dateA = new Date(`${a.fecha}T${a.hora}`);
                const dateB = new Date(`${b.fecha}T${b.hora}`);
                return dateA - dateB;
              } else {
                return new Date(b.created_at) - new Date(a.created_at);
              }
            });
            
            return filteredPartidos.length === 0 ? (
              <div className="empty-message">
                No hay partidos buscando jugadores en este momento
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', width: '100%', maxWidth: '500px' }}>
                  <button 
                    onClick={() => setMatchSortBy('proximidad')}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      background: matchSortBy === 'proximidad' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '8px',
                      color: matchSortBy === 'proximidad' ? 'white' : 'rgba(255, 255, 255, 0.7)',
                      fontFamily: 'Oswald, Arial, sans-serif',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      textTransform: 'uppercase',
                    }}
                  >
                    📅 Proximidad
                  </button>
                  <button 
                    onClick={() => setMatchSortBy('recientes')}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      background: matchSortBy === 'recientes' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '8px',
                      color: matchSortBy === 'recientes' ? 'white' : 'rgba(255, 255, 255, 0.7)',
                      fontFamily: 'Oswald, Arial, sans-serif',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      textTransform: 'uppercase',
                    }}
                  >
                    🕒 Recientes
                  </button>
                </div>
                {sortedPartidos.map((partido) => {
                  const jugadoresCount = partido.jugadores?.length || 0;
                  const cupoMaximo = partido.cupo_jugadores || 20;
                  const _faltanJugadores = cupoMaximo - jugadoresCount;
                  
                  const isComplete = jugadoresCount >= cupoMaximo;
                  
                  return (
                    <div key={partido.id} className="compact-match-card">
                      <div className="card-header" style={{ marginBottom: '12px' }}>
                        <div className="match-datetime-xl" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor">
                            <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z"/>
                          </svg>
                          <span>{new Date(partido.fecha + 'T00:00:00').toLocaleDateString('es-ES', { 
                            weekday: 'long', 
                            day: 'numeric', 
                            month: 'short',
                          })} {partido.hora}</span>
                        </div>
                        <div className="player-count-corner">
                          {isComplete ? (
                            <span className="complete-corner">¡Completo!</span>
                          ) : (
                            <span className="players-corner">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor" style={{ marginRight: '4px' }}>
                                <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z"/>
                              </svg>
                              {jugadoresCount}/{cupoMaximo}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="match-info-large" style={{ marginBottom: '16px' }}>
                        <div className={`match-type-large ${(() => {
                          const modalidad = partido.modalidad || 'F5';
                          if (modalidad.includes('5')) return 'futbol-5';
                          if (modalidad.includes('6')) return 'futbol-6';
                          if (modalidad.includes('7')) return 'futbol-7';
                          if (modalidad.includes('8')) return 'futbol-8';
                          if (modalidad.includes('11')) return 'futbol-11';
                          return 'futbol-5';
                        })()}`} style={{ fontSize: '12px', padding: '4px 8px' }}>
                          {partido.modalidad || 'F5'}
                        </div>
                        <div className={`gender-large ${(() => {
                          const tipo = (partido.tipo_partido || 'Masculino').toLowerCase();
                          if (tipo.includes('masculino')) return 'masculino';
                          if (tipo.includes('femenino')) return 'femenino';
                          if (tipo.includes('mixto')) return 'mixto';
                          return 'masculino';
                        })()}`} style={{ fontSize: '12px', padding: '4px 8px' }}>
                          {partido.tipo_partido || 'Masculino'}
                        </div>
                      </div>
                      
                      <div className="venue-large" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="16" height="16" fill="rgba(255, 255, 255, 0.9)">
                          <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z"/>
                        </svg>
                        <span>{partido.sede?.split(',')[0] || partido.sede}</span>
                      </div>
                      
                      <div className="match-buttons">
                        <button 
                          className="cyan-btn"
                          onClick={() => {
                            try {
                              if (typeof window !== 'undefined' && window.history) {
                                window.history.pushState({}, '', `/admin/${partido.id}`);
                                window.dispatchEvent(new PopStateEvent('popstate'));
                              } else {
                                window.location.href = `/admin/${partido.id}`;
                              }
                            } catch {
                              window.location.href = `/admin/${partido.id}`;
                            }
                          }}
                        >
                          VER PARTIDO
                        </button>
                        <button 
                          className="cyan-btn"
                          onClick={() => handleInviteFriends(partido)}
                        >
                          INVITAR AMIGOS
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            );
          })()
        ) : (
          // Free Players Tab
          <>
            {user ? (
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '8px', 
                margin: '0px 50px', 
                fontSize: '14px', 
                color: 'rgba(255,255,255,0.8)',
                fontFamily: 'Oswald, Arial, sans-serif',
                width: '100%',
                maxWidth: '500px',
              }}>
                <span>¿Disponible para jugar?</span>
                <label style={{ 
                  position: 'relative', 
                  display: 'inline-block', 
                  width: '50px', 
                  height: '24px',
                  cursor: 'pointer',
                }}>
                  <input 
                    type="checkbox" 
                    checked={isRegisteredAsFree}
                    onChange={isRegisteredAsFree ? handleUnregisterAsFree : handleRegisterAsFree}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'inherit',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: isRegisteredAsFree ? '#009dffff' : '#ccc',
                    transition: '0.3s',
                    borderRadius: '24px',
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '',
                      height: '18px',
                      width: '18px',
                      left: isRegisteredAsFree ? '29px' : '3px',
                      bottom: '3px',
                      backgroundColor: 'white',
                      transition: '0.3s',
                      borderRadius: '50%',
                    }} />
                  </span>
                </label>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
                  {isRegisteredAsFree ? 'Disponible' : 'No disponible'}
                </span>
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
                          const avatarUrl = player.avatar_url;
                          return avatarUrl ? (
                            <img 
                              src={avatarUrl} 
                              alt={player.nombre}
                              className="free-player-img"
                              onError={(e) => {
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
                        <div className="free-player-distance" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="12" height="12" fill="rgba(255, 255, 255, 0.6)">
                            <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z"/>
                          </svg>
                          <span>{userLocation ? 
                            Math.round(calculateDistance(
                              userLocation.lat, 
                              userLocation.lng, 
                              player.latitud || -34.6037, 
                              player.longitud || -58.3816,
                            )) : '?'
                          } km</span>
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
      
      {/* Modal de invitar amigos */}
      <InviteAmigosModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        currentUserId={user?.id}
        partidoActual={selectedMatch}
      />
    </>
  );
}