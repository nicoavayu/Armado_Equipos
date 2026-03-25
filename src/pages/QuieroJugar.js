import React, { useState, useEffect, useMemo, useRef, useDeferredValue, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../components/AuthProvider';
import { useInterval } from '../hooks/useInterval';
import { useAmigos } from '../hooks/useAmigos';
import { useScrollResetOnChange } from '../hooks/useScrollReset';
import PageTitle from '../components/PageTitle';
import PageLoadingState from '../components/PageLoadingState';
import InviteAmigosModal from '../components/InviteAmigosModal';
import InviteToMatchModal from '../components/InviteToMatchModal';
import PlayerActionModal from '../components/PlayerActionModal';
import ProfileCardModal from '../components/ProfileCardModal';
import PlayerMiniCard from '../components/PlayerMiniCard';
import PlayerBadges from '../components/PlayerBadges';
import EmptyStateCard from '../components/EmptyStateCard';
import { handleError } from '../lib/errorHandler';
import { Calendar, Clock, MapPin, Star, ListOrdered, Users, CalendarX2 } from 'lucide-react';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { hasValidCoordinates, toCoordinateNumber } from '../utils/matchLocation';
import {
  countOperationallyOpenMatches,
  fetchOpenMatchesForQuieroJugar,
} from '../services/db/openMatches';
import { distanceInMeters, getCurrentPosition, getLocalhostDevelopmentLocation } from '../services/locationService';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';
import { useSupabaseRealtime } from '../hooks/useSupabaseRealtime';

const containerClass = 'flex flex-col items-center w-full pb-6 px-4 box-border font-oswald';

const normalizeLocationToken = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const isPostalCodeToken = (token) => /^[A-Z]?\d{4,}[A-Z0-9-]*$/i.test(token);

const stripPostalAndCountry = (value) => normalizeLocationToken(value)
  .replace(/\bCP\s*[A-Z]?\d{4,}[A-Z0-9-]*\b/gi, '')
  .replace(/\b[A-Z]?\d{4,}[A-Z0-9-]*\b/g, '')
  .replace(/\bargentina\b/gi, '')
  .replace(/\s{2,}/g, ' ')
  .replace(/(^[\s,.-]+|[\s,.-]+$)/g, '')
  .trim();

const buildMatchLocationLabel = (partido) => {
  const rawSede = partido?.sede_direccion_normalizada || partido?.sede || '';
  const sedeTokens = String(rawSede)
    .split(',')
    .map(stripPostalAndCountry)
    .filter(Boolean)
    .filter((token) => !isPostalCodeToken(token))
    .filter((token) => token.toLowerCase() !== 'argentina');

  const fromNamedVenue = stripPostalAndCountry(
    partido?.nombre_cancha
    || partido?.cancha_nombre
    || partido?.location_name
    || partido?.sede_nombre
    || null,
  );
  const place = stripPostalAndCountry(sedeTokens[0]) || 'Dirección no disponible';
  return fromNamedVenue || place;
};

const MATCH_DISTANCE_STORAGE_KEY = 'quiero-jugar-match-distance-km';
const MIN_MATCH_DISTANCE_KM = 1;
const MAX_MATCH_DISTANCE_KM = 30;
const DEFAULT_MATCH_DISTANCE_KM = 30;
const QUIERO_JUGAR_MATCHES_POLL_MS = 20000;
const QUIERO_JUGAR_PLAYERS_POLL_MS = 30000;
const MATCH_DISTANCE_SLIDER_CLASS = 'quiero-jugar-distance-slider w-full';

const clampMatchDistanceKm = (value) => {
  if (!Number.isFinite(value)) return DEFAULT_MATCH_DISTANCE_KM;
  return Math.min(MAX_MATCH_DISTANCE_KM, Math.max(MIN_MATCH_DISTANCE_KM, Math.round(value)));
};

const QuieroJugar = ({
  secondaryTabsTop = 80,
  secondaryTabsDirection = 'right',
  secondaryTabsTransitionKey = 'individual',
}) => {
  const MAX_SUBSTITUTE_SLOTS = 4;

  const navigate = useNavigate();
  const goBackSmart = useSmartBackNavigation({
    fallback: '/',
  });
  const onVolver = () => goBackSmart();
  const { user } = useAuth();
  const [partidosAbiertos, setPartidosAbiertos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [freePlayers, setFreePlayers] = useState([]);
  const [sortBy, setSortBy] = useState('distance');
  const [userLocation, setUserLocation] = useState(null);
  const [locationResolved, setLocationResolved] = useState(false);
  const [openMatchesBaseCount, setOpenMatchesBaseCount] = useState(0);
  const [matchesError, setMatchesError] = useState('');
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
  const matchesRequestRef = useRef(0);
  const deferredMaxMatchDistanceKm = useDeferredValue(maxMatchDistanceKm);
  const { getRelationshipStatus, sendFriendRequest } = useAmigos(user?.id || null);

  useScrollResetOnChange(activeTab);

  const handleMatchDistanceChange = (event) => {
    setMaxMatchDistanceKm(clampMatchDistanceKm(Number(event.target.value)));
  };

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

  const getUserLocation = useCallback(async () => {
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

        const devLocation = getLocalhostDevelopmentLocation();
        if (devLocation) {
          setUserLocation({
            lat: devLocation.lat,
            lng: devLocation.lng,
          });
          return;
        }

        setUserLocation(null);
      } catch (error) {
        const devLocation = getLocalhostDevelopmentLocation();
        if (devLocation) {
          setUserLocation({
            lat: devLocation.lat,
            lng: devLocation.lng,
          });
        } else {
          setUserLocation(null);
        }
      } finally {
        setLocationResolved(true);
      }
    };

    try {
      const currentPosition = await getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 300000,
      });
      const lat = toCoordinateNumber(currentPosition?.lat);
      const lng = toCoordinateNumber(currentPosition?.lng);

      if (hasValidCoordinates(lat, lng)) {
        setUserLocation({ lat, lng });
        setLocationResolved(true);
        return;
      }
    } catch (error) {
    }

    await setLocationFromProfileFallback();
  }, [user?.id]);

  const { setIntervalSafe, clearIntervalSafe } = useInterval();

  const fetchPartidosAbiertos = useCallback(async () => {
    if (!user?.id) return;
    const requestId = matchesRequestRef.current + 1;
    matchesRequestRef.current = requestId;

    try {
      setMatchesError('');
      const [nextMatches, baseCount] = await Promise.all([
        fetchOpenMatchesForQuieroJugar({
          userLocation,
          maxDistanceKm: deferredMaxMatchDistanceKm,
        }),
        countOperationallyOpenMatches(),
      ]);

      if (requestId !== matchesRequestRef.current) return;

      setPartidosAbiertos(nextMatches);
      setOpenMatchesBaseCount(baseCount);
    } catch (error) {
      if (requestId !== matchesRequestRef.current) return;
      setMatchesError(error.message || 'No se pudieron cargar los partidos.');
      notifyBlockingError('Error cargando partidos: ' + error.message);
    } finally {
      if (requestId === matchesRequestRef.current) {
        setLoading(false);
      }
    }
  }, [deferredMaxMatchDistanceKm, user?.id, userLocation]);

  const fetchFreePlayers = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setPartidosAbiertos([]);
      setOpenMatchesBaseCount(0);
      setMatchesError('');
      setLocationResolved(false);
      setLoading(false);
      return;
    }
    if (!locationResolved) return;
    fetchPartidosAbiertos();
  }, [fetchPartidosAbiertos, locationResolved, user?.id, userLocation?.lat, userLocation?.lng, deferredMaxMatchDistanceKm]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setLocationResolved(false);
    setMatchesError('');
    fetchFreePlayers();
    getUserLocation();
  }, [fetchFreePlayers, getUserLocation, user]);

  useEffect(() => {
    clearIntervalSafe();

    if (!user?.id) {
      return undefined;
    }

    if (activeTab === 'players') {
      setIntervalSafe(() => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        fetchFreePlayers();
      }, QUIERO_JUGAR_PLAYERS_POLL_MS);
    } else if (activeTab === 'matches') {
      setIntervalSafe(() => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        fetchPartidosAbiertos();
      }, QUIERO_JUGAR_MATCHES_POLL_MS);
    }

    return () => clearIntervalSafe();
  }, [activeTab, clearIntervalSafe, fetchFreePlayers, fetchPartidosAbiertos, setIntervalSafe, user?.id]);

  useRefreshOnVisibility(
    () => {
      if (!user?.id) return;

      if (activeTab === 'players') {
        fetchFreePlayers();
        return;
      }

      if (!locationResolved) {
        getUserLocation();
        return;
      }

      fetchPartidosAbiertos();
    },
    {
      enabled: Boolean(user?.id),
    },
  );

  useEffect(() => {
    if (activeTab !== 'players' || !user?.id) return;
    fetchFreePlayers();
  }, [activeTab, fetchFreePlayers, user?.id]);

  useSupabaseRealtime({
    enabled: Boolean(user?.id) && activeTab === 'players',
    channelName: `quiero-jugar-players-${user?.id}`,
    deps: [activeTab, user?.id],
    events: [
      {
        event: 'INSERT',
        schema: 'public',
        table: 'jugadores_sin_partido',
        handler: () => {
          fetchFreePlayers();
        },
      },
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'jugadores_sin_partido',
        handler: () => {
          fetchFreePlayers();
        },
      },
      {
        event: 'DELETE',
        schema: 'public',
        table: 'jugadores_sin_partido',
        handler: () => {
          fetchFreePlayers();
        },
      },
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'usuarios',
        handler: () => {
          fetchFreePlayers();
        },
      },
    ],
  });

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
        const distanceA = distanceInMeters(
          userLocation.lat,
          userLocation.lng,
          toCoordinateNumber(a.latitud),
          toCoordinateNumber(a.longitud),
        ) || 0;
        const distanceB = distanceInMeters(
          userLocation.lat,
          userLocation.lng,
          toCoordinateNumber(b.latitud),
          toCoordinateNumber(b.longitud),
        ) || 0;
        return distanceA - distanceB;
      }

      if (hasCoordsA && !hasCoordsB) return -1;
      if (!hasCoordsA && hasCoordsB) return 1;
      return 0;
    }
  });

  // Filter out current user from the general list
  const otherPlayers = sortedFreePlayers.filter((p) => p.user_id !== user?.id);
  const canFilterByDistance = Boolean(userLocation);
  const visibleMatches = partidosAbiertos;
  const isResolvingLocation = Boolean(user?.id) && !locationResolved;
  const matchDistanceProgressPercent = (
    ((maxMatchDistanceKm - MIN_MATCH_DISTANCE_KM) / (MAX_MATCH_DISTANCE_KM - MIN_MATCH_DISTANCE_KM)) * 100
  );

  if (loading || isResolvingLocation) {
    return (
      <div className="min-h-[100dvh] w-screen flex items-center justify-center px-4">
        <PageLoadingState
          title="CARGANDO PARTIDOS"
          description={isResolvingLocation
            ? 'Estamos resolviendo tu ubicación y buscando partidos disponibles.'
            : 'Estamos buscando partidos y jugadores disponibles cerca tuyo.'}
          skeletonCards={2}
        />
      </div>
    );
  }

  return (
    <>
      <style>{`
        .quiero-jugar-distance-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          min-height: 42px;
          margin: 0;
          padding: 10px 0;
          background: transparent;
          touch-action: pan-x;
          -webkit-tap-highlight-color: transparent;
        }
        .quiero-jugar-distance-slider:focus {
          outline: none;
        }
        .quiero-jugar-distance-slider::-webkit-slider-runnable-track {
          height: 12px;
          border-radius: 999px;
          background:
            linear-gradient(
              to right,
              #6a43ff 0%,
              #7c5cff var(--match-distance-progress, 100%),
              rgba(255, 255, 255, 0.96) var(--match-distance-progress, 100%),
              rgba(255, 255, 255, 0.96) 100%
            );
          box-shadow: inset 0 0 0 2px rgba(111, 125, 255, 0.28);
        }
        .quiero-jugar-distance-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          margin-top: -6px;
          border-radius: 999px;
          border: 3px solid #efe9ff;
          background: radial-gradient(circle at 30% 30%, #a48dff 0%, #6a43ff 58%, #5132d5 100%);
          box-shadow:
            0 0 0 6px rgba(106, 67, 255, 0.16),
            0 6px 16px rgba(0, 0, 0, 0.28);
          transition: transform 120ms ease-out, box-shadow 120ms ease-out;
        }
        .quiero-jugar-distance-slider:active::-webkit-slider-thumb {
          transform: scale(1.08);
          box-shadow:
            0 0 0 8px rgba(106, 67, 255, 0.2),
            0 8px 18px rgba(0, 0, 0, 0.32);
        }
        .quiero-jugar-distance-slider::-moz-range-track {
          height: 12px;
          border: none;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: inset 0 0 0 2px rgba(111, 125, 255, 0.28);
        }
        .quiero-jugar-distance-slider::-moz-range-progress {
          height: 12px;
          border-radius: 999px;
          background: linear-gradient(to right, #6a43ff 0%, #7c5cff 100%);
        }
        .quiero-jugar-distance-slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border: 3px solid #efe9ff;
          border-radius: 999px;
          background: radial-gradient(circle at 30% 30%, #a48dff 0%, #6a43ff 58%, #5132d5 100%);
          box-shadow:
            0 0 0 6px rgba(106, 67, 255, 0.16),
            0 6px 16px rgba(0, 0, 0, 0.28);
          transition: transform 120ms ease-out, box-shadow 120ms ease-out;
        }
        .quiero-jugar-distance-slider:active::-moz-range-thumb {
          transform: scale(1.08);
          box-shadow:
            0 0 0 8px rgba(106, 67, 255, 0.2),
            0 8px 18px rgba(0, 0, 0, 0.32);
        }
        .quiero-jugar-distance-slider:disabled::-webkit-slider-thumb,
        .quiero-jugar-distance-slider:disabled::-moz-range-thumb {
          box-shadow: none;
        }
        @media (max-width: 640px) {
          .quiero-jugar-distance-slider {
            min-height: 48px;
            padding: 12px 0;
          }
          .quiero-jugar-distance-slider::-webkit-slider-runnable-track,
          .quiero-jugar-distance-slider::-moz-range-track,
          .quiero-jugar-distance-slider::-moz-range-progress {
            height: 14px;
          }
          .quiero-jugar-distance-slider::-webkit-slider-thumb,
          .quiero-jugar-distance-slider::-moz-range-thumb {
            width: 28px;
            height: 28px;
          }
          .quiero-jugar-distance-slider::-webkit-slider-thumb {
            margin-top: -7px;
          }
        }
      `}</style>

      <PageTitle title="QUIERO JUGAR" onBack={onVolver}>QUIERO JUGAR</PageTitle>

      <div className={containerClass} style={{ paddingTop: `${secondaryTabsTop}px` }}>

        {/* Secondary tabs (contextual filter) */}
        <div
          className={`w-full relative z-10 transition-[transform,opacity] duration-200 ease-out will-change-transform ${activeTab === 'matches' ? 'mb-0' : 'mb-8'}`}
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
                className={`relative flex-1 min-w-0 border px-0 py-0 font-bebas text-[0.95rem] uppercase tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${activeTab === 'matches'
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
                PARTIDOS
              </button>
              <button
                className={`relative flex-1 min-w-0 border border-l-0 px-0 py-0 font-bebas text-[0.95rem] uppercase tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${activeTab === 'players'
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
                JUGADORES
              </button>
            </div>
          </div>
        </div>

        {activeTab === 'matches' ? (
          // Matches Tab
          (() => {
            if (openMatchesBaseCount === 0) {
              return (
                <EmptyStateCard
                  icon={CalendarX2}
                  title="Sin partidos abiertos"
                  titleClassName="font-oswald text-[clamp(18px,5.6vw,22px)] font-semibold leading-tight text-white whitespace-nowrap"
                  description="Cuando se publique un partido con cupos disponibles, te va a aparecer acá."
                  actionLabel="Crear partido"
                  onAction={() => navigate('/nuevo-partido')}
                />
              );
            }

            return (
              <>
                {matchesError ? (
                  <div className="w-full max-w-[500px] mt-2 mb-4 border border-[rgba(177,72,72,0.45)] bg-[rgba(73,20,20,0.4)] px-4 py-4 shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
                    <div className="font-oswald text-sm font-semibold text-red-100">
                      No pudimos actualizar el listado de partidos.
                    </div>
                    <p className="mt-1 text-[12px] font-oswald text-red-100/80">
                      {matchesError}
                    </p>
                    <button
                      className="mt-3 inline-flex min-h-[40px] items-center justify-center border border-[rgba(255,255,255,0.18)] bg-[rgba(20,31,70,0.82)] px-3 py-2 font-bebas text-sm tracking-[0.01em] text-white/92 transition-all hover:bg-[rgba(30,45,94,0.95)]"
                      onClick={() => {
                        setLoading(true);
                        fetchPartidosAbiertos();
                      }}
                    >
                      Reintentar
                    </button>
                  </div>
                ) : null}

                <div className="w-full max-w-[500px] mt-2 mb-4 border border-[rgba(88,107,170,0.46)] bg-[#1e293b]/92 px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="font-bebas text-[0.9rem] uppercase tracking-[0.06em] text-white/85">
                      Distancia maxima de partidos
                    </span>
                    <span className="font-oswald text-sm font-semibold text-[#9ed3ff]">
                      {maxMatchDistanceKm} km
                    </span>
                  </div>

                  <input
                    data-allow-horizontal-scroll="true"
                    type="range"
                    min={MIN_MATCH_DISTANCE_KM}
                    max={MAX_MATCH_DISTANCE_KM}
                    step={1}
                    disabled={!canFilterByDistance}
                    value={maxMatchDistanceKm}
                    onInput={handleMatchDistanceChange}
                    onChange={handleMatchDistanceChange}
                    className={`${MATCH_DISTANCE_SLIDER_CLASS} ${canFilterByDistance ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'}`}
                    style={{
                      '--match-distance-progress': `${matchDistanceProgressPercent}%`,
                    }}
                    aria-label="Distancia maxima de partidos"
                  />

                  <p className="mt-2 text-[11px] font-oswald text-white/55">
                    {canFilterByDistance
                      ? 'Con ubicacion activa mostramos solo partidos dentro del radio y con coordenadas persistidas.'
                      : 'Sin ubicacion disponible no filtramos por distancia y mostramos todos los partidos abiertos.'}
                  </p>
                  {!canFilterByDistance ? (
                    <p className="mt-1 text-[11px] font-oswald text-white/40">
                      Activá la ubicacion del navegador o completá tu ubicacion en Perfil para usar este filtro.
                    </p>
                  ) : null}
                </div>

                {visibleMatches.length === 0 ? (
                  <div className="w-full max-w-[500px] border border-[rgba(88,107,170,0.46)] bg-[#1e293b]/92 p-6 text-center">
                    <p className="text-white font-oswald text-base">
                      {canFilterByDistance
                        ? `No hay partidos elegibles dentro de ${maxMatchDistanceKm} km.`
                        : 'No hay partidos abiertos elegibles para mostrar en este momento.'}
                    </p>
                    <p className="text-white/60 font-oswald text-sm mt-1">
                      {canFilterByDistance
                        ? 'Proba aumentar la distancia maxima para ver mas opciones.'
                        : 'Cuando tengamos ubicacion disponible, el filtro por distancia se va a activar automaticamente.'}
                    </p>
                  </div>
                ) : (
                  <>
                    {visibleMatches.map((partido) => {
                      const cupoMaximo = Number(partido.cupo_jugadores || 20);
                      const jugadores = Array.isArray(partido.jugadores) ? partido.jugadores : [];
                      const jugadoresCount = jugadores.length;
                      const flaggedSubstitutes = jugadores.filter((j) => Boolean(j?.is_substitute)).length;
                      const overflowSubstitutes = Math.max(0, jugadoresCount - cupoMaximo);
                      const substitutesCount = Math.min(MAX_SUBSTITUTE_SLOTS, Math.max(flaggedSubstitutes, overflowSubstitutes));
                      const titularesCount = Math.max(0, jugadoresCount - substitutesCount);
                      const titularesDisplayCount = Math.min(titularesCount, cupoMaximo);
                      const isComplete = titularesDisplayCount >= cupoMaximo;
                      const isOwnerMatch = user?.id && String(partido?.creado_por || '') === String(user.id);
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
                            <div className="shrink-0 flex items-center justify-end gap-2 flex-wrap">
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

                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <span className="font-oswald text-[11px] font-semibold px-2.5 py-1.5 rounded-none shrink-0 whitespace-nowrap bg-[#0f2f23] border-2 border-[#22c55e] text-[#dcfce7]">{partido.modalidad || 'F5'}</span>
                            <span className="font-oswald text-[11px] font-semibold px-2.5 py-1.5 rounded-none shrink-0 whitespace-nowrap bg-[#213448] border-2 border-[#2dd4bf] text-[#ccfbf1]">{partido.tipo_partido || 'Mixto'}</span>
                            {isOwnerMatch ? (
                              <span className="font-oswald px-2 py-1 rounded-none text-[10px] font-semibold shrink-0 whitespace-nowrap border border-[#8e7dff] bg-[rgba(106,67,255,0.16)] text-[#ddd7ff] uppercase tracking-[0.04em]">
                                Tu partido
                              </span>
                            ) : null}
                          </div>

                          <div className="font-oswald text-sm font-medium text-white/90 flex items-center gap-2 min-w-0">
                            <MapPin size={16} className="shrink-0 text-white/85" />
                            <span className="truncate whitespace-nowrap" title={locationLabel}>{locationLabel}</span>
                          </div>
                          {Number.isFinite(roundedDistanceKm) ? (
                            <div className="mt-1 text-[12px] font-oswald flex items-center gap-1.5 text-[#9ed3ff]">
                              <MapPin size={12} />
                              {`A ${roundedDistanceKm} km`}
                            </div>
                          ) : null}

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


            {otherPlayers.length === 0 ? (
              <EmptyStateCard
                icon={Users}
                title="No hay jugadores disponibles"
                titleClassName="font-oswald text-[clamp(18px,5.6vw,22px)] font-semibold leading-tight text-white"
                description="Por el momento no hay jugadores disponibles. Cuando se habiliten van a aparecer en esta ventana. Podés habilitarte como disponible tocando tu foto de perfil en la Home."
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
                      distanceKm={userLocation && hasValidCoordinates(player.latitud, player.longitud)
                        ? (distanceInMeters(
                          userLocation.lat,
                          userLocation.lng,
                          toCoordinateNumber(player.latitud),
                          toCoordinateNumber(player.longitud),
                        ) || 0) / 1000
                        : null}
                      onClick={(e) => {
                        const rect = e?.currentTarget?.getBoundingClientRect?.();
                        setActionAnchorPoint({
                          x: rect ? (rect.left + rect.width / 2) : window.innerWidth / 2,
                          y: rect ? (rect.top + rect.height / 2) : window.innerHeight / 2,
                        });
                        setActionPlayer(player);
                      }}
                      detailBadges={<PlayerBadges playerId={player.user_id || player.uuid || player.id} />}
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
