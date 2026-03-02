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

const MATCH_DISTANCE_STORAGE_KEY = 'quiero-jugar-match-distance-km';
const MIN_MATCH_DISTANCE_KM = 1;
const MAX_MATCH_DISTANCE_KM = 50;
const DEFAULT_MATCH_DISTANCE_KM = 30;

const clampMatchDistanceKm = (value) => {
  if (!Number.isFinite(value)) return DEFAULT_MATCH_DISTANCE_KM;
  return Math.min(MAX_MATCH_DISTANCE_KM, Math.max(MIN_MATCH_DISTANCE_KM, Math.round(value)));
};

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

const QuieroJugar = ({
  secondaryTabsTop = 126,
  secondaryTabsDirection = 'right',
  secondaryTabsTransitionKey = 'individual',
}) => {
  const MAX_SUBSTITUTE_SLOTS = 4;

  const navigate = useNavigate();
  const onVolver = () => navigate(-1);
  const { user } = useAuth();
  const [partidosAbiertos, setPartidosAbiertos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [freePlayers, setFreePlayers] = useState([]);
  const [sortBy, setSortBy] = useState('distance');
  const [userLocation, setUserLocation] = useState(null);
  const [maxMatchDistanceKm, setMaxMatchDistanceKm] = useState(() => {
    const saved = Number(sessionStorage.getItem(MATCH_DISTANCE_STORAGE_KEY));
    return clampMatchDistanceKm(saved);
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
  const [showSecondaryTabs, setShowSecondaryTabs] = useState(false);
  const { getRelationshipStatus, sendFriendRequest } = useAmigos(user?.id || null);

  useEffect(() => {
    fetchPartidosAbiertos();
    if (user) {
      fetchFreePlayers();
      getUserLocation();
    }
  }, [user]);

  useEffect(() => {
    sessionStorage.setItem(MATCH_DISTANCE_STORAGE_KEY, String(maxMatchDistanceKm));
  }, [maxMatchDistanceKm]);

  useEffect(() => {
    setShowSecondaryTabs(false);
    const frameId = window.requestAnimationFrame(() => {
      setShowSecondaryTabs(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [secondaryTabsDirection, secondaryTabsTransitionKey]);

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

      <div className={containerClass} style={{ paddingTop: `${secondaryTabsTop}px` }}>

        {/* Secondary tabs (contextual filter) */}
        <div
          className="w-full mb-8 relative z-10 transition-[transform,opacity] duration-200 ease-out will-change-transform"
          style={{
            transform: showSecondaryTabs
              ? 'translateX(0)'
              : `translateX(${secondaryTabsDirection === 'left' ? '-18px' : '18px'})`,
            opacity: showSecondaryTabs ? 1 : 0.01,
          }}
        >
          <div className="relative left-1/2 w-screen -translate-x-1/2">
            <div className="flex h-[44px] w-full overflow-hidden border-y border-[rgba(106,126,202,0.40)] bg-[rgba(17,26,59,0.96)]">
              <button
                className={`relative flex-1 min-w-0 border px-0 py-0 font-bebas text-[0.95rem] tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${activeTab === 'matches'
                  ? 'z-[2] border-[rgba(132,112,255,0.64)] bg-[#31239f] text-white shadow-[inset_0_0_0_1px_rgba(160,142,255,0.26)]'
                  : 'z-[1] border-[rgba(106,126,202,0.40)] bg-[rgba(17,26,59,0.96)] text-white/65 hover:text-white/88 hover:bg-[rgba(26,37,83,0.98)]'
                  }`}
                onClick={() => {
                  setActiveTab('matches');
                  sessionStorage.setItem('quiero-jugar-tab', 'matches');
                }}
              >
                {activeTab === 'matches' ? (
                  <span className="pointer-events-none absolute left-0 top-0 h-[3px] w-full bg-[#644dff]" />
                ) : null}
                Partidos
              </button>
              <button
                className={`relative flex-1 min-w-0 border border-l-0 px-0 py-0 font-bebas text-[0.95rem] tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${activeTab === 'players'
                  ? 'z-[2] border-[rgba(132,112,255,0.64)] bg-[#31239f] text-white shadow-[inset_0_0_0_1px_rgba(160,142,255,0.26)]'
                  : 'z-[1] border-[rgba(106,126,202,0.40)] bg-[rgba(17,26,59,0.96)] text-white/65 hover:text-white/88 hover:bg-[rgba(26,37,83,0.98)]'
                  }`}
                onClick={() => {
                  setActiveTab('players');
                  sessionStorage.setItem('quiero-jugar-tab', 'players');
                }}
              >
                {activeTab === 'players' ? (
                  <span className="pointer-events-none absolute left-0 top-0 h-[3px] w-full bg-[#644dff]" />
                ) : null}
                Jugadores
              </button>
            </div>
          </div>
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
              const createdA = new Date(a.created_at || '').getTime();
              const createdB = new Date(b.created_at || '').getTime();
              const hasCreatedA = Number.isFinite(createdA);
              const hasCreatedB = Number.isFinite(createdB);

              if (hasCreatedA && hasCreatedB && createdA !== createdB) return createdB - createdA;
              if (hasCreatedA && !hasCreatedB) return -1;
              if (!hasCreatedA && hasCreatedB) return 1;

              const startA = new Date(`${a.fecha || ''}T${a.hora || '00:00'}`).getTime();
              const startB = new Date(`${b.fecha || ''}T${b.hora || '00:00'}`).getTime();
              const hasStartA = Number.isFinite(startA);
              const hasStartB = Number.isFinite(startB);

              if (hasStartA && hasStartB && startA !== startB) return startA - startB;
              if (hasStartA && !hasStartB) return -1;
              if (!hasStartA && hasStartB) return 1;

              const hasDistanceA = Number.isFinite(a.distanceKm);
              const hasDistanceB = Number.isFinite(b.distanceKm);

              if (hasDistanceA && hasDistanceB) return a.distanceKm - b.distanceKm;
              if (hasDistanceA && !hasDistanceB) return -1;
              if (!hasDistanceA && hasDistanceB) return 1;

              return 0;
            });

            if (activePartidos.length === 0) {
              return (
                <EmptyStateCard
                  icon={CalendarX2}
                  title="Sin partidos abiertos"
                  titleClassName="font-oswald text-[30px] font-semibold leading-tight text-white"
                  description="Cuando se publique un partido con cupos disponibles, te va a aparecer acá."
                  actionLabel="Crear partido"
                  onAction={() => navigate('/nuevo-partido')}
                />
              );
            }

            return (
              <>
                <div className="w-full max-w-[500px] mb-4 border border-[rgba(88,107,170,0.46)] bg-[#1e293b]/92 px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="font-bebas text-[0.9rem] uppercase tracking-[0.06em] text-white/85">
                      Distancia maxima de partidos
                    </span>
                    <span className="font-oswald text-sm font-semibold text-[#9ed3ff]">
                      {maxMatchDistanceKm} km
                    </span>
                  </div>

                  <input
                    type="range"
                    min={MIN_MATCH_DISTANCE_KM}
                    max={MAX_MATCH_DISTANCE_KM}
                    step={1}
                    value={maxMatchDistanceKm}
                    onChange={(e) => setMaxMatchDistanceKm(clampMatchDistanceKm(Number(e.target.value)))}
                    className="w-full accent-[#6a43ff]"
                  />

                  <p className="mt-2 text-[11px] font-oswald text-white/55">
                    {userLocation
                      ? 'Filtramos por distancia solo los partidos con coordenadas.'
                      : 'Activa ubicacion o cargala en tu perfil para filtrar por distancia.'}
                  </p>
                </div>

                {sortedPartidos.length === 0 ? (
                  <div className="w-full max-w-[500px] border border-[rgba(88,107,170,0.46)] bg-[#1e293b]/92 p-6 text-center">
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
                        <div
                          key={partido.id}
                          className="w-full max-w-[500px] bg-[#1e293b]/92 border border-[rgba(88,107,170,0.46)] p-5 mb-3 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition-all duration-200 hover:brightness-[1.03] hover:border-[#4a7ed6]"
                        >
                          <div className="flex justify-between items-start mb-3 gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="inline-flex items-center gap-1.5 font-oswald text-[15px] font-bold text-white capitalize min-w-0">
                                <Calendar size={14} className="text-white/80 shrink-0" />
                                <span className="truncate">{formattedDate}</span>
                                <span className="text-white/50">•</span>
                                <Clock size={14} className="text-white/80 shrink-0" />
                                <span>{partido.hora} hs</span>
                              </div>
                            </div>
                            <div className="shrink-0 flex items-center gap-2">
                              {isComplete ? (
                                <span className="px-2.5 py-1.5 rounded-none text-[11px] font-semibold shrink-0 whitespace-nowrap bg-[#165a2e] text-[#22c55e] border border-[#22c55e]">
                                  {titularesDisplayCount}/{cupoMaximo}
                                </span>
                              ) : (
                                <span className="px-2.5 py-1.5 rounded-none text-[11px] font-semibold shrink-0 whitespace-nowrap bg-slate-900 text-slate-300 border border-slate-700">
                                  {titularesDisplayCount}/{cupoMaximo}
                                </span>
                              )}
                              {substitutesCount > 0 && (
                                <span className="px-2.5 py-1.5 rounded-none text-[11px] font-semibold shrink-0 whitespace-nowrap border border-amber-400/30 bg-amber-500/10 text-amber-300">
                                  {substitutesCount}/{MAX_SUBSTITUTE_SLOTS}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mb-3">
                            <span className="font-oswald text-[11px] font-semibold px-2.5 py-1.5 rounded-none shrink-0 whitespace-nowrap bg-[#0f2f23] border-2 border-[#22c55e] text-[#dcfce7]">{partido.modalidad || 'F5'}</span>
                            <span className="font-oswald text-[11px] font-semibold px-2.5 py-1.5 rounded-none shrink-0 whitespace-nowrap bg-[#213448] border-2 border-[#2dd4bf] text-[#ccfbf1]">{partido.tipo_partido || 'Mixto'}</span>
                          </div>

                          <div className="font-oswald text-sm font-medium text-white/90 flex items-start gap-2 overflow-hidden text-ellipsis">
                            <MapPin size={16} className="mt-0.5 shrink-0 text-white/85" />
                            <span className="break-words">{locationLabel}</span>
                          </div>
                          <div className={`mt-1 text-[12px] font-oswald flex items-center gap-1.5 ${Number.isFinite(roundedDistanceKm) ? 'text-[#9ed3ff]' : 'text-white/35'}`}>
                            <MapPin size={12} />
                            {Number.isFinite(roundedDistanceKm) ? `A ${roundedDistanceKm} km` : 'Distancia sin datos'}
                          </div>

                          <div className="flex gap-2 mt-4">
                            <button
                              className="flex-1 font-bebas text-base px-4 py-2.5 border border-[#7d5aff] rounded-none cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-[#6a43ff] shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:bg-[#7550ff]"
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
                    className={`flex-1 py-2 rounded-none text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'distance'
                      ? 'bg-white/10 text-white border-white/30'
                      : 'bg-transparent text-white/40 border-white/10 hover:bg-white/5'
                      }`}
                    onClick={() => setSortBy('distance')}
                  >
                    <span className="flex items-center gap-1.5 justify-center"><MapPin size={12} /> Distancia</span>
                  </button>
                  <button
                    className={`flex-1 py-2 rounded-none text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'rating'
                      ? 'bg-white/10 text-white border-white/30'
                      : 'bg-transparent text-white/40 border-white/10 hover:bg-white/5'
                      }`}
                    onClick={() => setSortBy('rating')}
                  >
                    <span className="flex items-center gap-1.5 justify-center"><Star size={12} /> Rating</span>
                  </button>
                  <button
                    className={`flex-1 py-2 rounded-none text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'position'
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
