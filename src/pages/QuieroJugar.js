import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, addFreePlayer, removeFreePlayer, getFreePlayerStatus } from '../supabase';
import { toast } from 'react-toastify';
import { useAuth } from '../components/AuthProvider';
import { useInterval } from '../hooks/useInterval';
import { PlayerCardTrigger } from '../components/ProfileComponents';
import PageTitle from '../components/PageTitle';
import LoadingSpinner from '../components/LoadingSpinner';
import InviteAmigosModal from '../components/InviteAmigosModal';
import { handleError } from '../lib/errorHandler';
// Clase para dar espacio al TabBar
const containerClass = 'flex flex-col items-center min-h-screen pt-20 pb-24 px-4 box-border font-oswald';
const QuieroJugar = () => {
  const navigate = useNavigate();
  const onVolver = () => navigate(-1);
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
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
      handleError(error, { showToast: false, onError: () => console.error(error) });
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
      handleError(error, { showToast: false, onError: () => console.error(error) });
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
    const diffInHours = Math.floor((now.getTime() - time.getTime()) / (1000 * 60 * 60));

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
      'united kingdom': '🇬🇧',
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
      <div className="min-h-screen w-screen flex items-center justify-center p-0">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <>
      <PageTitle title="QUIERO JUGAR" onBack={onVolver}>QUIERO JUGAR</PageTitle>
      <div className={containerClass}>
        {/* Tab Navigation */}
        <div className="flex mb-6 rounded-xl overflow-hidden w-full max-w-[500px] bg-white/20 border border-white/30 shadow-lg">
          <button
            className={`flex-1 py-3.5 bg-transparent text-white border-none  text-base font-semibold cursor-pointer transition-all duration-300 uppercase relative overflow-hidden hover:bg-white/10 ${activeTab === 'matches' ? 'bg-white/30 shadow-[0_4px_12px_rgba(255,255,255,0.2)]' : ''}`}
            onClick={() => {
              setActiveTab('matches');
              sessionStorage.setItem('quiero-jugar-tab', 'matches');
            }}
          >
            PARTIDOS ABIERTOS
          </button>
          <button
            className={`flex-1 py-3.5 bg-transparent text-white border-none  text-base font-semibold cursor-pointer transition-all duration-300 uppercase relative overflow-hidden hover:bg-white/10 ${activeTab === 'players' ? 'bg-white/30 shadow-[0_4px_12px_rgba(255,255,255,0.2)]' : ''}`}
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
                return dateA.getTime() - dateB.getTime();
              } else {
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              }
            });

            return filteredPartidos.length === 0 ? (
              <div className="text-white/70 text-base text-center my-10  bg-white/10 p-5 rounded-xl w-full max-w-[500px] border border-white/20">
                No hay partidos buscando jugadores en este momento
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-4 w-full max-w-[500px]">
                  <button
                    onClick={() => setMatchSortBy('proximidad')}
                    className={`flex-1 py-2.5 px-3 rounded-lg  text-[13px] font-semibold cursor-pointer transition-all duration-300 uppercase border ${matchSortBy === 'proximidad'
                      ? 'bg-white/20 text-white border-white/40'
                      : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/15 hover:text-white/90'
                    }`}
                  >
                    📅 Proximidad
                  </button>
                  <button
                    onClick={() => setMatchSortBy('recientes')}
                    className={`flex-1 py-2.5 px-3 rounded-lg  text-[13px] font-semibold cursor-pointer transition-all duration-300 uppercase border ${matchSortBy === 'recientes'
                      ? 'bg-white/20 text-white border-white/40'
                      : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/15 hover:text-white/90'
                    }`}
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
                    <div key={partido.id} className="w-full max-w-[500px] bg-white/10 backdrop-blur-md rounded-2xl p-5 mb-3 border border-white/20 shadow-xl hover:-translate-y-0.5 hover:shadow-2xl hover:border-white/40 hover:bg-white/15 transition-all duration-300 max-[600px]:p-4 max-[600px]:mb-3">
                      <div className="flex justify-between items-start mb-5" >
                        <div className=" text-[28px] max-[600px]:text-[22px] font-bold text-white capitalize flex items-center gap-2 flex-1">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="currentColor">
                            <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
                          </svg>
                          <span>{new Date(partido.fecha + 'T00:00:00').toLocaleDateString('es-ES', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'short',
                          })} {partido.hora}</span>
                        </div>
                        <div className="shrink-0">
                          {isComplete ? (
                            <span className=" text-sm max-[600px]:text-xs font-semibold text-[#4CAF50] bg-[#4CAF50]/20 px-3 py-1.5 rounded-lg border border-[#4CAF50]/40 inline-block">¡Completo!</span>
                          ) : (
                            <span className=" text-sm max-[600px]:text-xs font-semibold text-white bg-white/15 px-3 py-1.5 rounded-lg border border-white/30 inline-flex items-center gap-1">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12" height="12" fill="currentColor" className="mr-1">
                                <path d="M320 312C386.3 312 440 258.3 440 192C440 125.7 386.3 72 320 72C253.7 72 200 125.7 200 192C200 258.3 253.7 312 320 312zM290.3 368C191.8 368 112 447.8 112 546.3C112 562.7 125.3 576 141.7 576L498.3 576C514.7 576 528 562.7 528 546.3C528 447.8 448.2 368 349.7 368L290.3 368z" />
                              </svg>
                              {jugadoresCount}/{cupoMaximo}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 mb-6 flex-wrap max-[600px]:gap-2" >
                        <div className={` text-base max-[600px]:text-sm font-semibold text-white px-3 py-2 max-[600px]:px-2.5 max-[600px]:py-1.5 rounded-lg border shrink-0 ${(() => {
                          const modalidad = partido.modalidad || 'F5';
                          if (modalidad.includes('5')) return 'bg-[#4CAF50]/20 border-[#4CAF50]/40';
                          if (modalidad.includes('6')) return 'bg-[#FF9800]/20 border-[#FF9800]/40';
                          if (modalidad.includes('7')) return 'bg-[#9C27B0]/20 border-[#9C27B0]/40';
                          if (modalidad.includes('8')) return 'bg-[#F44336]/20 border-[#F44336]/40';
                          if (modalidad.includes('11')) return 'bg-[#3F51B5]/20 border-[#3F51B5]/40';
                          return 'bg-[#4CAF50]/20 border-[#4CAF50]/40';
                        })()}`}>
                          {partido.modalidad || 'F5'}
                        </div>
                        <div className={` text-base max-[600px]:text-sm font-semibold text-white px-3 py-2 max-[600px]:px-2.5 max-[600px]:py-1.5 rounded-lg border shrink-0 ${(() => {
                          const tipo = (partido.tipo_partido || 'Masculino').toLowerCase();
                          if (tipo.includes('masculino')) return 'bg-[#2196F3]/20 border-[#2196F3]/40';
                          if (tipo.includes('femenino')) return 'bg-[#E91E63]/20 border-[#E91E63]/40';
                          if (tipo.includes('mixto')) return 'bg-[#FFC107]/20 border-[#FFC107]/40';
                          return 'bg-[#2196F3]/20 border-[#2196F3]/40';
                        })()}`}>
                          {partido.tipo_partido || 'Masculino'}
                        </div>
                      </div>

                      <div className=" text-base max-[600px]:text-sm font-bold text-white/90 flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-2 mb-5">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="16" height="16" fill="rgba(255, 255, 255, 0.9)">
                          <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
                        </svg>
                        <span>{partido.sede?.split(',')[0] || partido.sede}</span>
                      </div>

                      <div className="flex gap-3 max-[600px]:gap-2">
                        <button
                          className="flex-1 py-3 px-5 max-[600px]:py-2.5 max-[600px]:px-4 max-[600px]:text-xs rounded-lg  text-sm font-semibold cursor-pointer transition-all duration-300 bg-primary hover:brightness-110 text-white uppercase backdrop-blur-md shadow-md hover:-translate-y-[1px] hover:shadow-lg border-none"
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
                          className="flex-1 py-3 px-5 max-[600px]:py-2.5 max-[600px]:px-4 max-[600px]:text-xs rounded-lg  text-sm font-semibold cursor-pointer transition-all duration-300 bg-white/10 border border-white/20 hover:bg-white/20 text-white uppercase backdrop-blur-md shadow-md hover:-translate-y-[1px] hover:shadow-lg"
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
              <div className="flex flex-col items-center justify-center gap-2 mx-12 text-sm text-white/80  w-full max-w-[500px]">
                <span>¿Disponible para jugar?</span>
                <label className="relative inline-block w-[50px] h-[24px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRegisteredAsFree}
                    onChange={isRegisteredAsFree ? handleUnregisterAsFree : handleRegisterAsFree}
                    className="opacity-0 w-0 h-0"
                  />
                  <span className={`absolute cursor-pointer inset-0 transition-all duration-300 rounded-[24px] ${isRegisteredAsFree ? 'bg-[#009dffff]' : 'bg-[#ccc]'}`}>
                    <span className={`absolute content-[''] h-[18px] w-[18px] bottom-[3px] bg-white transition-all duration-300 rounded-full ${isRegisteredAsFree ? 'left-[29px]' : 'left-[3px]'}`} />
                  </span>
                </label>
                <span className="text-xs text-white/60">
                  {isRegisteredAsFree ? 'Disponible' : 'No disponible'}
                </span>
              </div>
            ) : (
              <div className="text-white/70 text-base text-center my-10  bg-white/10 p-5 rounded-xl w-full max-w-[500px] border border-white/20">
                Inicia sesión para anotarte como jugador disponible
              </div>
            )}

            {freePlayers.length === 0 ? (
              <div className="text-white/70 text-base text-center my-10  bg-white/10 p-5 rounded-xl w-full max-w-[500px] border border-white/20">
                No hay jugadores disponibles en este momento
              </div>
            ) : (
              <>
                {/* Sort buttons */}
                <div className="flex gap-2 mb-4 mt-4 w-full max-w-[500px]">
                  <button
                    className={`flex-1 py-2.5 px-3 rounded-lg  text-[13px] font-semibold cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'distance'
                      ? 'bg-white/20 text-white border-white/40'
                      : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/15 hover:text-white/90'
                    }`}
                    onClick={() => setSortBy('distance')}
                  >
                    📍 Distancia
                  </button>
                  <button
                    className={`flex-1 py-2.5 px-3 rounded-lg  text-[13px] font-semibold cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'rating'
                      ? 'bg-white/20 text-white border-white/40'
                      : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/15 hover:text-white/90'
                    }`}
                    onClick={() => setSortBy('rating')}
                  >
                    ⭐ Rating
                  </button>
                </div>

                {sortedFreePlayers.map((player) => (
                  <PlayerCardTrigger key={player.uuid || player.id} profile={player}>
                    <div className="flex items-center gap-3 bg-white/10 rounded-2xl p-4 mb-3 border border-white/20 transition-all duration-300 w-full max-w-[500px] min-h-[60px] hover:-translate-y-0.5 hover:shadow-xl hover:border-white/40 hover:bg-white/15 max-[600px]:p-3">
                      <div className="w-[44px] h-[44px] rounded-full overflow-hidden shrink-0 border-[2px] border-white/30 max-[600px]:w-[40px] max-[600px]:h-[40px] flex items-center justify-center bg-white/20">
                        {(() => {
                          const avatarUrl = player.avatar_url;
                          return avatarUrl ? (
                            <img
                              src={avatarUrl}
                              alt={player.nombre}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl text-white">👤</div>
                          );
                        })()}
                        <div className="hidden w-full h-full items-center justify-center text-xl text-white">👤</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className=" text-lg font-bold text-white mb-1 uppercase whitespace-nowrap overflow-hidden text-ellipsis max-[600px]:text-base">{player.nombre}</div>
                        <div className=" text-[13px] text-white/70 flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="12" height="12" fill="rgba(255, 255, 255, 0.6)">
                            <path d="M0 188.6C0 84.4 86 0 192 0S384 84.4 384 188.6c0 119.3-120.2 262.3-170.4 316.8-11.8 12.8-31.5 12.8-43.3 0-50.2-54.5-170.4-197.5-170.4-316.8zM192 256a64 64 0 1 0 0-128 64 64 0 1 0 0 128z" />
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
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <div className="flex items-center gap-1 bg-[#FFD700]/20 border border-[#FFD700]/40 rounded-lg px-2 py-1">
                          <span className=" text-sm font-bold text-[#FFD700]">{(player.rating || player.ranking || player.calificacion || 4.5).toFixed(1)}</span>
                          <span className="text-xs">⭐</span>
                        </div>
                        <div className="flex gap-1">
                          {(player?.mvps > 0) && (
                            <div className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-[linear-gradient(135deg,#ffd700cc_60%,#fff3a0cc_100%)] border border-[#ffd70066] text-[#b8860b]">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={12} height={12}>
                                <path fillRule="evenodd" d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 0 0-.584.859 6.753 6.753 0 0 0 6.138 5.6 6.73 6.73 0 0 0 2.743 1.346A6.707 6.707 0 0 1 9.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 0 0-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-2.25-2.25H16.5v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 0 1-1.112-3.173 6.73 6.73 0 0 0 2.743-1.347 6.753 6.753 0 0 0 6.139-5.6.75.75 0 0 0-.585-.858 47.077 47.077 0 0 0-3.07-.543V2.62a.75.75 0 0 0-.658-.744 49.22 49.22 0 0 0-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 0 0-.657.744Z" clipRule="evenodd" />
                              </svg>
                              <span>{player.mvps}</span>
                            </div>
                          )}
                          {(player?.tarjetas_rojas > 0) && (
                            <div className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-[linear-gradient(135deg,#ff1744cc_60%,#ffcdd2cc_100%)] border border-[#ff174466] text-white">
                              <span className="text-[8px] leading-none">🟥</span>
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
};

export default QuieroJugar;
