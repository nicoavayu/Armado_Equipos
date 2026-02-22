import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import { useInterval } from '../hooks/useInterval';
import { useAmigos } from '../hooks/useAmigos';
import PageTitle from '../components/PageTitle';
import PageLoadingState from '../components/PageLoadingState';
import InviteAmigosModal from '../components/InviteAmigosModal';
import InviteToMatchModal from '../components/InviteToMatchModal';
import PlayerActionModal from '../components/PlayerActionModal';
import ProfileCardModal from '../components/ProfileCardModal';
import PlayerMiniCard from '../components/PlayerMiniCard';
import EmptyStateCard from '../components/EmptyStateCard';
import { handleError } from '../lib/errorHandler';
import { PRIMARY_CTA_BUTTON_CLASS } from '../styles/buttonClasses';
import { Calendar, Clock, MapPin, Star, Trophy, ListOrdered, Users, CalendarX2 } from 'lucide-react';
import { notifyBlockingError } from 'utils/notifyBlockingError';

const containerClass = 'flex flex-col items-center w-full pb-6 px-4 box-border font-oswald';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeLocationToken = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const areSameText = (a, b) => normalizeLocationToken(a).toLowerCase() === normalizeLocationToken(b).toLowerCase();

const isPostalCodeToken = (token) => /^[A-Z]?\d{4,}[A-Z0-9-]*$/i.test(token);

const stripPostalAndCountry = (value) => normalizeLocationToken(value)
  .replace(/\bCP\s*[A-Z]?\d{4,}[A-Z0-9-]*\b/gi, '')
  .replace(/\b[A-Z]?\d{4,}[A-Z0-9-]*\b/g, '')
  .replace(/\bargentina\b/gi, '')
  .replace(/\s{2,}/g, ' ')
  .replace(/(^[\s,.-]+|[\s,.-]+$)/g, '')
  .trim();

const buildMatchLocationLabel = (partido) => {
  const rawSede = partido?.sede || '';
  const sedeTokens = String(rawSede)
    .split(',')
    .map(stripPostalAndCountry)
    .filter(Boolean)
    .filter((token) => !isPostalCodeToken(token))
    .filter((token) => token.toLowerCase() !== 'argentina');

  const place = stripPostalAndCountry(sedeTokens[0]) || 'Dirección no disponible';
  const cityFromData = stripPostalAndCountry(partido?.ciudad || partido?.localidad || partido?.city || null);
  const cityFallback = sedeTokens.length >= 2 ? sedeTokens[sedeTokens.length - 1] : null;
  const city = cityFromData || stripPostalAndCountry(cityFallback);

  const neighborhoodFromData = stripPostalAndCountry(partido?.barrio || partido?.zona || partido?.neighborhood || null);
  const neighborhoodFallback = sedeTokens.length >= 3 ? sedeTokens[sedeTokens.length - 2] : null;
  const neighborhood = neighborhoodFromData || stripPostalAndCountry(neighborhoodFallback);

  const parts = [place];

  if (hasText(neighborhood) && !areSameText(neighborhood, place) && !areSameText(neighborhood, city || '')) {
    parts.push(neighborhood);
  }

  if (hasText(city) && !areSameText(city, place) && !areSameText(city, neighborhood || '')) {
    parts.push(city);
  }

  return parts.join(', ');
};

const toCoordinateNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const hasValidCoordinates = (lat, lng) => {
  const parsedLat = toCoordinateNumber(lat);
  const parsedLng = toCoordinateNumber(lng);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return false;
  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) return false;

  // Descarta "Null Island" (0,0), común cuando la ubicación quedó mal guardada.
  if (Math.abs(parsedLat) < 0.0001 && Math.abs(parsedLng) < 0.0001) return false;
  return true;
};

const MATCH_DISTANCE_OPTIONS_KM = [5, 10, 15, 20, 25, 30];

const resolveMatchCoordinates = (partido) => {
  const directPairs = [
    [partido?.latitud, partido?.longitud],
    [partido?.latitude, partido?.longitude],
    [partido?.sede_latitud, partido?.sede_longitud],
    [partido?.sede_lat, partido?.sede_lng],
    [partido?.cancha_latitud, partido?.cancha_longitud],
    [partido?.cancha_lat, partido?.cancha_lng],
    [partido?.location_lat, partido?.location_lng],
    [partido?.geo_lat, partido?.geo_lng],
  ];

  for (const [rawLat, rawLng] of directPairs) {
    const lat = toCoordinateNumber(rawLat);
    const lng = toCoordinateNumber(rawLng);
    if (hasValidCoordinates(lat, lng)) {
      return { lat, lng };
    }
  }

  const mapsData = partido?.sedeMaps || partido?.sede_maps || null;
  if (mapsData && typeof mapsData === 'object') {
    const mapsPairs = [
      [mapsData?.lat, mapsData?.lng],
      [mapsData?.latitude, mapsData?.longitude],
      [mapsData?.location?.lat, mapsData?.location?.lng],
    ];

    for (const [rawLat, rawLng] of mapsPairs) {
      const lat = toCoordinateNumber(rawLat);
      const lng = toCoordinateNumber(rawLng);
      if (hasValidCoordinates(lat, lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
};

const QuieroJugar = () => {
  const MAX_SUBSTITUTE_SLOTS = 4;

  const navigate = useNavigate();
  const onVolver = () => navigate(-1);
  const { user } = useAuth();
  const [partidosAbiertos, setPartidosAbiertos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [freePlayers, setFreePlayers] = useState([]);
  const [sortBy, setSortBy] = useState('distance');
  const [userLocation, setUserLocation] = useState(null);
  const [matchSortBy, setMatchSortBy] = useState('proximidad');
  const [maxMatchDistanceKm, setMaxMatchDistanceKm] = useState(() => {
    const saved = Number(sessionStorage.getItem('quiero-jugar-match-distance-km'));
    return MATCH_DISTANCE_OPTIONS_KM.includes(saved) ? saved : 30;
  });
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = sessionStorage.getItem('quiero-jugar-tab');
    return savedTab === 'players' || savedTab === 'matches' ? savedTab : 'matches';
  });
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [actionPlayer, setActionPlayer] = useState(null);
  const [actionAnchorPoint, setActionAnchorPoint] = useState(null);
  const [profileModalPlayer, setProfileModalPlayer] = useState(null);
  const [inviteTargetPlayer, setInviteTargetPlayer] = useState(null);
  const [actionFriendStatus, setActionFriendStatus] = useState(null);
  const [isSubmittingFriend, setIsSubmittingFriend] = useState(false);
  const { getRelationshipStatus, sendFriendRequest } = useAmigos(user?.id || null);

  useEffect(() => {
    fetchPartidosAbiertos();
    if (user) {
      fetchFreePlayers();
      getUserLocation();
    }
  }, [user]);

  useEffect(() => {
    sessionStorage.setItem('quiero-jugar-match-distance-km', String(maxMatchDistanceKm));
  }, [maxMatchDistanceKm]);

  useEffect(() => {
    const resolveActionPlayerRelationship = async () => {
      const targetUserId = actionPlayer?.user_id || actionPlayer?.uuid || actionPlayer?.id;
      if (!actionPlayer || !targetUserId || !user?.id || targetUserId === user.id) {
        setActionFriendStatus(null);
        return;
      }

      const relation = await getRelationshipStatus(targetUserId);
      setActionFriendStatus(relation?.status || null);
    };

    resolveActionPlayerRelationship();
  }, [actionPlayer, user?.id, getRelationshipStatus]);

  const getUserLocation = () => {
    const setLocationFromProfileFallback = async () => {
      try {
        if (!user?.id) return setUserLocation(null);

        const { data, error } = await supabase
          .from('usuarios')
          .select('latitud, longitud')
          .eq('id', user.id)
          .single();

        if (error) throw error;

        if (hasValidCoordinates(data?.latitud, data?.longitud)) {
          setUserLocation({
            lat: toCoordinateNumber(data.latitud),
            lng: toCoordinateNumber(data.longitud),
          });
          return;
        }

        setUserLocation(null);
      } catch (error) {
        console.log('Could not resolve location from profile:', error);
        setUserLocation(null);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = toCoordinateNumber(position.coords.latitude);
          const lng = toCoordinateNumber(position.coords.longitude);

          if (hasValidCoordinates(lat, lng)) {
            setUserLocation({ lat, lng });
            return;
          }

          setLocationFromProfileFallback();
        },
        (error) => {
          console.log('Geolocation error, trying profile location:', error);
          setLocationFromProfileFallback();
        },
      );
    } else {
      setLocationFromProfileFallback();
    }
  };

  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const { setIntervalSafe, clearIntervalSafe } = useInterval();

  useEffect(() => {
    if (user && activeTab === 'players') {
      setIntervalSafe(() => {
        fetchFreePlayers();
      }, 5000);
      return () => clearIntervalSafe();
    }
  }, [user, activeTab, setIntervalSafe, clearIntervalSafe]);

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
        .from('partidos_view')
        .select('*')
        .eq('falta_jugadores', true)
        .in('estado', ['active', 'activo'])
        .order('fecha', { ascending: true });

      if (error) throw error;
      setPartidosAbiertos(data || []);
    } catch (error) {
      notifyBlockingError('Error cargando partidos: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchFreePlayers = async () => {
    try {
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

      const userIds = freePlayersData.map((fp) => fp.user_id).filter(Boolean);

      if (userIds.length === 0) {
        setFreePlayers([]);
        return;
      }

      const { data: userProfiles, error: usersError } = await supabase
        .from('usuarios')
        .select('id, nombre, avatar_url, localidad, latitud, longitud, ranking, partidos_jugados, posicion, acepta_invitaciones, bio, fecha_alta, updated_at, nacionalidad, mvps')
        .in('id', userIds);

      if (usersError) throw usersError;

      const players = freePlayersData
        .map((freePlayer) => {
          const userProfile = userProfiles?.find((up) => up.id === freePlayer.user_id);
          return {
            ...freePlayer,
            nombre: userProfile?.nombre || freePlayer.nombre || 'Jugador',
            avatar_url: userProfile?.avatar_url || freePlayer.avatar_url,
            localidad: userProfile?.localidad || freePlayer.localidad,
            latitud: userProfile?.latitud || null,
            longitud: userProfile?.longitud || null,
            ranking: userProfile?.ranking || 5,
            rating: userProfile?.ranking || 5,
            mvps: userProfile?.mvps || 0,
            nacionalidad: userProfile?.nacionalidad || 'Argentina',
            posicion: userProfile?.posicion || 'Jugador',
            acepta_invitaciones: userProfile?.acepta_invitaciones,
          };
        })
        .filter((player) => player.acepta_invitaciones !== false);
      setFreePlayers(players);
    } catch (error) {
      handleError(error, { showToast: false, onError: () => console.error(error) });
    }
  }

  const sortedFreePlayers = [...freePlayers].sort((a, b) => {
    if (sortBy === 'rating') {
      const ratingA = a.ranking || a.calificacion || 0;
      const ratingB = b.ranking || b.calificacion || 0;
      return ratingB - ratingA;
    } else if (sortBy === 'position') {
      const posPriority = { 'ARQ': 1, 'DEF': 2, 'MED': 3, 'DEL': 4 };
      const priorityA = posPriority[a.posicion] || 99;
      const priorityB = posPriority[b.posicion] || 99;
      return priorityA - priorityB;
    } else {
      // Si no hay contexto real para distancia, evitar un orden "aleatorio":
      // hacemos fallback a rating para mantener consistencia.
      if (!userLocation) {
        const ratingA = a.ranking || a.calificacion || 0;
        const ratingB = b.ranking || b.calificacion || 0;
        return ratingB - ratingA;
      }
      const hasCoordsA = hasValidCoordinates(a.latitud, a.longitud);
      const hasCoordsB = hasValidCoordinates(b.latitud, b.longitud);

      if (hasCoordsA && hasCoordsB) {
        const distanceA = calculateDistance(userLocation.lat, userLocation.lng, toCoordinateNumber(a.latitud), toCoordinateNumber(a.longitud));
        const distanceB = calculateDistance(userLocation.lat, userLocation.lng, toCoordinateNumber(b.latitud), toCoordinateNumber(b.longitud));
        return distanceA - distanceB;
      }

      if (hasCoordsA && !hasCoordsB) return -1;
      if (!hasCoordsA && hasCoordsB) return 1;
      return 0;
    }
  });

  // Filter out current user from the general list
  const otherPlayers = sortedFreePlayers.filter((p) => p.user_id !== user?.id);

  const handleInviteFriends = (partido) => {
    if (!user) {
      notifyBlockingError('Debes iniciar sesión para invitar amigos');
      return;
    }
    setSelectedMatch(partido);
    setShowInviteModal(true);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] w-screen flex items-center justify-center px-4">
        <PageLoadingState
          title="CARGANDO PARTIDOS"
          description="Estamos buscando partidos y jugadores disponibles cerca tuyo."
          skeletonCards={2}
        />
      </div>
    );
  }

  return (
    <>
      <PageTitle title="QUIERO JUGAR" onBack={onVolver}>QUIERO JUGAR</PageTitle>

      <div className={containerClass} style={{ paddingTop: '126px' }}>

        {/* 2. Tabs with added spacing - Removed overlap */}
        <div className="flex mb-8 rounded-xl overflow-hidden w-full max-w-[500px] bg-white/5 border border-white/10 relative z-10">
          <button
            className={`flex-1 py-3 bg-transparent border-none text-[18px] font-semibold tracking-[0.01em] cursor-pointer transition-all duration-300 uppercase relative ${activeTab === 'matches' ? 'text-white bg-white/10 shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]' : 'text-white/40 hover:text-white/60'}`}
            onClick={() => {
              setActiveTab('matches');
              sessionStorage.setItem('quiero-jugar-tab', 'matches');
            }}
          >
            PARTIDOS
          </button>
          <div className="w-[1px] bg-white/10 h-full self-stretch" />
          <button
            className={`flex-1 py-3 bg-transparent border-none text-[18px] font-semibold tracking-[0.01em] cursor-pointer transition-all duration-300 uppercase relative ${activeTab === 'players' ? 'text-white bg-white/10 shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]' : 'text-white/40 hover:text-white/60'}`}
            onClick={() => {
              setActiveTab('players');
              sessionStorage.setItem('quiero-jugar-tab', 'players');
            }}
          >
            JUGADORES
          </button>
        </div>

        {activeTab === 'matches' ? (
          // Matches Tab
          (() => {
            const now = new Date();
            const activePartidos = partidosAbiertos
              .map((partido) => {
                const matchDateTime = new Date(`${partido.fecha}T${partido.hora}`);
                const oneHourAfter = new Date(matchDateTime.getTime() + 60 * 60 * 1000);
                if (now > oneHourAfter) return null;

                const matchCoordinates = resolveMatchCoordinates(partido);
                const distanceKm = userLocation && matchCoordinates
                  ? calculateDistance(
                    userLocation.lat,
                    userLocation.lng,
                    matchCoordinates.lat,
                    matchCoordinates.lng,
                  )
                  : null;

                return {
                  ...partido,
                  distanceKm,
                };
              })
              .filter(Boolean);

            const filteredPartidos = activePartidos.filter((partido) => {
              if (!Number.isFinite(partido.distanceKm)) return true;
              return partido.distanceKm <= maxMatchDistanceKm;
            });

            const sortedPartidos = [...filteredPartidos].sort((a, b) => {
              if (matchSortBy === 'proximidad') {
                const hasDistanceA = Number.isFinite(a.distanceKm);
                const hasDistanceB = Number.isFinite(b.distanceKm);

                if (hasDistanceA && hasDistanceB) {
                  const byDistance = a.distanceKm - b.distanceKm;
                  if (byDistance !== 0) return byDistance;
                }

                if (hasDistanceA && !hasDistanceB) return -1;
                if (!hasDistanceA && hasDistanceB) return 1;

                const dateA = new Date(`${a.fecha}T${a.hora}`).getTime();
                const dateB = new Date(`${b.fecha}T${b.hora}`).getTime();
                return dateA - dateB;
              }

              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });

            if (activePartidos.length === 0) {
              return (
                <EmptyStateCard
                  icon={CalendarX2}
                  title="Sin partidos abiertos"
                  titleClassName="font-oswald text-[30px] font-semibold leading-tight text-white"
                  description="Cuando se publique un partido con cupos disponibles, te va a aparecer acá."
                  actionLabel="Crear partido"
                  actionClassName={`${PRIMARY_CTA_BUTTON_CLASS} mt-6 max-w-[340px] mx-auto`}
                  onAction={() => navigate('/nuevo-partido')}
                />
              );
            }

            return (
              <>
                <div className="w-full max-w-[500px] mb-4 p-3 rounded-xl border border-white/10 bg-white/5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">
                      Distancia maxima de partidos
                    </span>
                    <span className="text-xs font-bold text-[#9ed3ff]">
                      {maxMatchDistanceKm} km
                    </span>
                  </div>

                  <input
                    type="range"
                    min={5}
                    max={30}
                    step={5}
                    value={maxMatchDistanceKm}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (MATCH_DISTANCE_OPTIONS_KM.includes(value)) {
                        setMaxMatchDistanceKm(value);
                      }
                    }}
                    className="w-full accent-[#128BE9]"
                  />

                  <div className="mt-2 grid grid-cols-6 gap-1.5">
                    {MATCH_DISTANCE_OPTIONS_KM.map((distanceOption) => (
                      <button
                        key={distanceOption}
                        type="button"
                        onClick={() => setMaxMatchDistanceKm(distanceOption)}
                        className={`rounded-md py-1 text-[11px] font-bold transition-all border ${maxMatchDistanceKm === distanceOption
                          ? 'bg-white/15 text-white border-white/30'
                          : 'bg-transparent text-white/45 border-white/10 hover:bg-white/10 hover:text-white/80'
                          }`}
                      >
                        {distanceOption}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMatchSortBy('proximidad')}
                      className={`flex-1 py-2 rounded-lg text-[11px] font-bold tracking-wide uppercase border transition-all ${matchSortBy === 'proximidad'
                        ? 'bg-white/10 text-white border-white/30'
                        : 'bg-transparent text-white/40 border-white/10 hover:bg-white/5'
                        }`}
                    >
                      Proximidad
                    </button>
                    <button
                      type="button"
                      onClick={() => setMatchSortBy('recientes')}
                      className={`flex-1 py-2 rounded-lg text-[11px] font-bold tracking-wide uppercase border transition-all ${matchSortBy === 'recientes'
                        ? 'bg-white/10 text-white border-white/30'
                        : 'bg-transparent text-white/40 border-white/10 hover:bg-white/5'
                        }`}
                    >
                      Recientes
                    </button>
                  </div>

                  <p className="mt-2 text-[11px] text-white/55">
                    {userLocation
                      ? 'Filtramos por distancia solo los partidos con coordenadas.'
                      : 'Activa ubicacion o cargala en tu perfil para filtrar por distancia.'}
                  </p>
                </div>

                {sortedPartidos.length === 0 ? (
                  <div className="w-full max-w-[500px] rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                    <p className="text-white font-oswald text-base">
                      No hay partidos dentro de {maxMatchDistanceKm} km.
                    </p>
                    <p className="text-white/60 font-oswald text-sm mt-1">
                      Proba aumentar la distancia maxima para ver mas opciones.
                    </p>
                  </div>
                ) : (
                  <>
                    {sortedPartidos.map((partido) => {
                      const cupoMaximo = Number(partido.cupo_jugadores || 20);
                      const jugadores = Array.isArray(partido.jugadores) ? partido.jugadores : [];
                      const jugadoresCount = jugadores.length;
                      const flaggedSubstitutes = jugadores.filter((j) => Boolean(j?.is_substitute)).length;
                      const overflowSubstitutes = Math.max(0, jugadoresCount - cupoMaximo);
                      const substitutesCount = Math.min(MAX_SUBSTITUTE_SLOTS, Math.max(flaggedSubstitutes, overflowSubstitutes));
                      const titularesCount = Math.max(0, jugadoresCount - substitutesCount);
                      const titularesDisplayCount = Math.min(titularesCount, cupoMaximo);
                      const isComplete = titularesDisplayCount >= cupoMaximo;
                      const locationLabel = buildMatchLocationLabel(partido);
                      const formattedDate = new Date(partido.fecha + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
                      const roundedDistanceKm = Number.isFinite(partido.distanceKm) ? Math.round(partido.distanceKm) : null;

                      return (
                        <div key={partido.id} className="w-full max-w-[500px] bg-[#1e293b]/70 backdrop-blur-sm rounded-2xl p-5 mb-3 border border-white/10 shadow-lg hover:border-white/20 transition-all duration-300">
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex flex-col flex-1 min-w-0 pr-3">
                              <span className="text-xs text-white/60 font-oswald flex items-center gap-1.5 font-light tracking-wide uppercase">
                                <span className="bg-white/10 px-2 py-1 rounded-lg flex items-center gap-1.5 border border-white/5"><Calendar size={12} className="text-[#128BE9]" /> {formattedDate}</span>
                                <span className="bg-white/10 px-2 py-1 rounded-lg flex items-center gap-1.5 border border-white/5"><Clock size={12} className="text-[#128BE9]" /> {partido.hora} hs</span>
                              </span>
                            </div>
                            <div className="shrink-0 flex items-center gap-1.5">
                              {isComplete ? (
                                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded border border-emerald-400/20 tracking-wider">
                                  {titularesDisplayCount}/{cupoMaximo}
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-white/90 bg-white/10 px-2 py-1 rounded border border-white/20 tracking-wider">
                                  {titularesDisplayCount}/{cupoMaximo}
                                </span>
                              )}
                              {substitutesCount > 0 && (
                                <span className="text-[10px] font-bold text-amber-300 bg-amber-500/10 px-2 py-1 rounded border border-amber-400/30 tracking-wider">
                                  {substitutesCount}/{MAX_SUBSTITUTE_SLOTS}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-[10px] font-bold text-white/40 border border-white/5 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider">{partido.modalidad || 'F5'}</span>
                            <span className="text-[10px] font-bold text-white/40 border border-white/5 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider">{partido.tipo_partido || 'Mixto'}</span>
                          </div>

                          <div className="text-[13px] text-white/60 font-oswald leading-snug break-words">
                            {locationLabel}
                          </div>
                          {userLocation && (
                            <div className={`mt-1 text-[11px] font-oswald flex items-center gap-1.5 ${Number.isFinite(roundedDistanceKm) ? 'text-[#9ed3ff]' : 'text-white/35'}`}>
                              <MapPin size={12} />
                              {Number.isFinite(roundedDistanceKm) ? `A ${roundedDistanceKm} km` : 'Distancia sin datos'}
                            </div>
                          )}

                          <div className="flex gap-2 mt-4">
                            <button
                              className="flex-1 py-3 rounded-xl text-xs font-bold bg-[#128BE9] hover:brightness-110 text-white normal-case shadow-lg active:scale-[0.98] transition-all"
                              onClick={() => navigate(`/partido-publico/${partido.id}`)}
                            >
                              Ver partido
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            );
          })()
        ) : (
          // Players Tab
          <>


            {freePlayers.length === 0 ? (
              <EmptyStateCard
                icon={Users}
                title="SIN JUGADORES DISPONIBLES"
                description="Todavía no hay jugadores marcados como disponibles cerca tuyo."
              />
            ) : (
              <>
                <div className="flex gap-2 mb-4 w-full max-w-[500px]">
                  <button
                    className={`flex-1 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'distance'
                      ? 'bg-white/10 text-white border-white/30'
                      : 'bg-transparent text-white/40 border-white/10 hover:bg-white/5'
                      }`}
                    onClick={() => setSortBy('distance')}
                  >
                    <span className="flex items-center gap-1.5 justify-center"><MapPin size={12} /> Distancia</span>
                  </button>
                  <button
                    className={`flex-1 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'rating'
                      ? 'bg-white/10 text-white border-white/30'
                      : 'bg-transparent text-white/40 border-white/10 hover:bg-white/5'
                      }`}
                    onClick={() => setSortBy('rating')}
                  >
                    <span className="flex items-center gap-1.5 justify-center"><Star size={12} /> Rating</span>
                  </button>
                  <button
                    className={`flex-1 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'position'
                      ? 'bg-white/10 text-white border-white/30'
                      : 'bg-transparent text-white/40 border-white/10 hover:bg-white/5'
                      }`}
                    onClick={() => setSortBy('position')}
                  >
                    <span className="flex items-center gap-1.5 justify-center"><ListOrdered size={12} /> Posición</span>
                  </button>
                </div>

                <div className="w-full max-w-[500px] flex flex-col gap-2.5">
                  {otherPlayers.map((player) => (
                    <PlayerMiniCard
                      key={player.uuid || player.id}
                      profile={player}
                      variant="searching"
                      showDistanceUnavailable={sortBy === 'distance'}
                      distanceKm={userLocation && hasValidCoordinates(player.latitud, player.longitud) ? calculateDistance(
                        userLocation.lat,
                        userLocation.lng,
                        toCoordinateNumber(player.latitud),
                        toCoordinateNumber(player.longitud),
                      ) : null}
                      onClick={(e) => {
                        const rect = e?.currentTarget?.getBoundingClientRect?.();
                        setActionAnchorPoint({
                          x: rect ? (rect.left + rect.width / 2) : window.innerWidth / 2,
                          y: rect ? (rect.top + rect.height / 2) : window.innerHeight / 2,
                        });
                        setActionPlayer(player);
                      }}
                      metaBadge={(player.mvps > 0) ? (
                        <span className="text-[9px] bg-yellow-500/10 text-yellow-500 px-1 py-0.5 rounded flex items-center gap-0.5 border border-yellow-500/20 font-bold">
                          <Trophy size={10} /> {player.mvps}
                        </span>
                      ) : null}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <InviteAmigosModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        currentUserId={user?.id}
        partidoActual={selectedMatch}
      />

      {/* 4. Player Interaction Modal - Centered */}
      <PlayerActionModal
        isOpen={!!actionPlayer}
        onClose={() => {
          setActionPlayer(null);
          setActionAnchorPoint(null);
          setActionFriendStatus(null);
        }}
        player={actionPlayer}
        anchorPoint={actionAnchorPoint}
        friendStatus={actionFriendStatus}
        isSubmittingFriend={isSubmittingFriend}
        onInvite={(p) => {
          const targetId = p?.user_id || p?.uuid || p?.id || null;
          if (!targetId) {
            notifyBlockingError('No se pudo identificar al jugador para invitar');
            return;
          }
          setInviteTargetPlayer({
            nombre: p?.nombre || 'Jugador',
            profile: {
              id: targetId,
              nombre: p?.nombre || 'Jugador',
            },
          });
        }}
        onViewProfile={(p) => setProfileModalPlayer(p)}
        onAddFriend={async (p) => {
          const targetUserId = p?.user_id || p?.uuid || p?.id;
          if (!targetUserId || !user?.id || targetUserId === user.id) return;

          setIsSubmittingFriend(true);
          const result = await sendFriendRequest(targetUserId);
          setIsSubmittingFriend(false);

          if (result.success) {
            setActionFriendStatus('pending');
            console.info('Solicitud de amistad enviada');
            return;
          }

          const currentStatus = await getRelationshipStatus(targetUserId);
          setActionFriendStatus(currentStatus?.status || null);

          if (currentStatus?.status === 'accepted') {
            return;
          }
          if (currentStatus?.status === 'pending') {
            return;
          }

          notifyBlockingError(result.message || 'No se pudo enviar la solicitud');
        }}
      />

      <ProfileCardModal
        isOpen={!!profileModalPlayer}
        onClose={() => setProfileModalPlayer(null)}
        profile={profileModalPlayer}
      />

      <InviteToMatchModal
        isOpen={!!inviteTargetPlayer}
        onClose={() => setInviteTargetPlayer(null)}
        friend={inviteTargetPlayer}
        currentUserId={user?.id}
      />
    </>
  );
};

export default QuieroJugar;
