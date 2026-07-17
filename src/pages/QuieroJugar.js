import logger from '../utils/logger';
import React, { useState, useEffect, useMemo, useRef, useDeferredValue, useCallback, Suspense, lazy } from 'react';
import { friendlyError } from '../utils/friendlyError';
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
import { Calendar, Clock, MapPin, MapPinOff, Star, ListOrdered, Users, CalendarX2, List, Map as MapIcon } from 'lucide-react';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { hasValidCoordinates, toCoordinateNumber } from '../utils/matchLocation';
import {
  countOperationallyOpenMatches,
  fetchOpenMatchesForQuieroJugar,
} from '../services/db/openMatches';
import {
  distanceInMeters,
  getCurrentPosition,
  getLocalhostDevelopmentLocation,
  isPermissionDeniedError,
  shouldRefresh,
} from '../services/locationService';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';
import { useSupabaseRealtime } from '../hooks/useSupabaseRealtime';
import { useOnboardingOptional } from '../features/onboarding/OnboardingContext';

import DistanceSlider from '../components/jugar/DistanceSlider';

// Lazy so the MapLibre engine + tiles only load when the user opens the Mapa view.
const MatchesMapView = lazy(() => import('../components/jugar/MatchesMapView'));

const containerClass = 'flex flex-col items-center w-full pb-6 px-4 box-border font-oswald';

const PARTIDOS_VIEW_STORAGE_KEY = 'quiero-jugar-partidos-view';

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
  const onboarding = useOnboardingOptional();
  const markOnboardingAction = onboarding?.markChecklistAction;
  const [partidosAbiertos, setPartidosAbiertos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [freePlayers, setFreePlayers] = useState([]);
  const [sortBy, setSortBy] = useState('distance');
  const [userLocation, setUserLocation] = useState(null);
  const [locationResolved, setLocationResolved] = useState(false);
  const [locationStatus, setLocationStatus] = useState('idle');
  const [openMatchesBaseCount, setOpenMatchesBaseCount] = useState(0);
  const [matchesError, setMatchesError] = useState('');
  const [maxMatchDistanceKm, setMaxMatchDistanceKm] = useState(() => {
    // A missing/empty stored value must fall back to DEFAULT (Number(null) === 0
    // is finite and would otherwise clamp to the 1 km minimum on first load).
    const rawSaved = sessionStorage.getItem(MATCH_DISTANCE_STORAGE_KEY);
    const saved = rawSaved == null || rawSaved === '' ? NaN : Number(rawSaved);
    return clampMatchDistanceKm(saved);
  });
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = sessionStorage.getItem('quiero-jugar-tab');
    return savedTab === 'players' || savedTab === 'matches' ? savedTab : 'matches';
  });
  // Internal PARTIDOS sub-view. Lista is the default; the choice persists per session.
  const [partidosView, setPartidosView] = useState(() => (
    sessionStorage.getItem(PARTIDOS_VIEW_STORAGE_KEY) === 'mapa' ? 'mapa' : 'lista'
  ));
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

  const handleMatchDistanceChange = (nextKm) => {
    setMaxMatchDistanceKm(clampMatchDistanceKm(Number(nextKm)));
  };

  const selectPartidosView = (nextView) => {
    setPartidosView(nextView);
    sessionStorage.setItem(PARTIDOS_VIEW_STORAGE_KEY, nextView);
    // Entering the map: scroll the page to the top so the map gets full
    // protagonism and its computed height measures from a stable offset.
    if (nextView === 'mapa' && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
  };

  // Shared navigation for both Lista cards and the Mapa bottom sheet — no
  // duplicated join logic: owner → /admin/:id, otherwise → /partido-publico/:id.
  const handleOpenMatch = useCallback((match, meta = {}) => {
    if (!match?.id) return;
    const owner = meta.isOwner ?? Boolean(user?.id && String(match?.creado_por || '') === String(user.id));
    if (!owner) markOnboardingAction?.('reviewedMatch');
    navigate(owner ? `/admin/${match.id}` : `/partido-publico/${match.id}`);
  }, [markOnboardingAction, navigate, user?.id]);

  useEffect(() => {
    markOnboardingAction?.('openedPlay');
  }, [markOnboardingAction]);

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

  const getPersistedUserLocation = useCallback(async () => {
    if (!user?.id) return null;

    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('latitud, longitud, location_updated_at')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (hasValidCoordinates(data?.latitud, data?.longitud)) {
        return {
          lat: toCoordinateNumber(data.latitud),
          lng: toCoordinateNumber(data.longitud),
          updated_at: data?.location_updated_at || null,
          source: 'profile',
        };
      }
    } catch (_error) {
    }

    const devLocation = getLocalhostDevelopmentLocation();
    if (devLocation) {
      return {
        lat: devLocation.lat,
        lng: devLocation.lng,
        updated_at: devLocation.timestamp || null,
        source: devLocation.source || 'dev',
      };
    }

    return null;
  }, [user?.id]);

  const persistUserLocation = useCallback(async (currentPosition, previousLocation = null) => {
    if (!user?.id || !hasValidCoordinates(currentPosition?.lat, currentPosition?.lng)) return;

    const shouldPersist = !previousLocation || shouldRefresh({
      lastLocation: previousLocation,
      nextPosition: currentPosition,
    });

    if (!shouldPersist) return;

    const { error } = await supabase
      .from('usuarios')
      .update({
        latitud: currentPosition.lat,
        longitud: currentPosition.lng,
        location_accuracy_m: currentPosition.accuracy_m || null,
        location_updated_at: currentPosition.timestamp || new Date().toISOString(),
      })
      .eq('id', user.id);

    if (error) {
      logger.warn('[QUIERO_JUGAR_LOCATION] persist failed', error);
    }
  }, [user?.id]);

  const getUserLocation = useCallback(async () => {
    let persistedLocation = null;

    setLocationStatus((current) => (current === 'ready' || current === 'profile' ? current : 'loading'));

    persistedLocation = await getPersistedUserLocation();

    if (persistedLocation) {
      setUserLocation({
        lat: persistedLocation.lat,
        lng: persistedLocation.lng,
      });
      setLocationStatus('profile');
      setLocationResolved(true);
    } else {
      setUserLocation(null);
    }

    try {
      const currentPosition = await getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 600000,
      });
      const lat = toCoordinateNumber(currentPosition?.lat);
      const lng = toCoordinateNumber(currentPosition?.lng);

      if (hasValidCoordinates(lat, lng)) {
        const resolvedPosition = {
          ...currentPosition,
          lat,
          lng,
        };

        setUserLocation({ lat, lng });
        setLocationStatus('ready');
        setLocationResolved(true);
        persistUserLocation(resolvedPosition, persistedLocation).catch(() => {});
        return;
      }
    } catch (error) {
      if (!persistedLocation) {
        setLocationStatus(isPermissionDeniedError(error) ? 'denied' : 'unavailable');
        setLocationResolved(true);
        setUserLocation(null);
      }
      return;
    }

    if (!persistedLocation) {
      setLocationStatus('unavailable');
      setLocationResolved(true);
      setUserLocation(null);
    }
  }, [getPersistedUserLocation, persistUserLocation]);

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
      notifyBlockingError(friendlyError(error, 'No se pudieron cargar los partidos. Intentá de nuevo.'));
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
      handleError(error, { showToast: false, onError: () => logger.error(error) });
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setPartidosAbiertos([]);
      setOpenMatchesBaseCount(0);
      setMatchesError('');
      setLocationResolved(false);
      setLocationStatus('idle');
      setLoading(false);
      return;
    }
    fetchPartidosAbiertos();
  }, [fetchPartidosAbiertos, user?.id, userLocation?.lat, userLocation?.lng, deferredMaxMatchDistanceKm]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setLocationResolved(false);
    setLocationStatus('loading');
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
  const shouldShowLocationHelp = !canFilterByDistance && (locationStatus === 'denied' || locationStatus === 'unavailable');

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
          className={`w-full relative z-10 transition-[transform,opacity] duration-200 ease-out will-change-transform ${activeTab === 'matches' ? 'mb-0' : 'mb-8'}`}
          style={{
            transform: showSecondaryTabs
              ? 'translateX(0)'
              : `translateX(${secondaryTabsDirection === 'left' ? '-18px' : '18px'})`,
            opacity: showSecondaryTabs ? 1 : 0.01,
          }}
        >
          <div className="flex h-[44px] w-full max-w-[500px] mx-auto gap-1 p-1 overflow-hidden rounded-full border border-[rgba(148,134,255,0.22)] bg-[rgba(20,16,41,0.85)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_16px_rgba(5,3,16,0.35)]">
            <button
              className={`relative flex-1 min-w-0 rounded-full px-0 py-0 font-sans font-semibold text-[12.5px] uppercase tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${activeTab === 'matches'
                ? 'z-[2] bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]'
                : 'z-[1] bg-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.06]'
                }`}
              onClick={() => {
                setActiveTab('matches');
                sessionStorage.setItem('quiero-jugar-tab', 'matches');
              }}
            >
              PARTIDOS
            </button>
            <button
              className={`relative flex-1 min-w-0 rounded-full px-0 py-0 font-sans font-semibold text-[12.5px] uppercase tracking-[0.04em] transition-[background-color,border-color,color] duration-150 ${activeTab === 'players'
                ? 'z-[2] bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]'
                : 'z-[1] bg-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.06]'
                }`}
              onClick={() => {
                setActiveTab('players');
                sessionStorage.setItem('quiero-jugar-tab', 'players');
              }}
            >
              JUGADORES
            </button>
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
                  <div className="w-full max-w-[500px] mt-2 mb-4 rounded-card border border-[rgba(244,63,94,0.4)] bg-[rgba(73,20,20,0.4)] px-4 py-4 shadow-elev-1">
                    <div className="font-oswald text-sm font-semibold text-red-100">
                      No pudimos actualizar el listado de partidos.
                    </div>
                    <p className="mt-1 text-[12px] font-sans text-red-100/80">
                      {matchesError}
                    </p>
                    <button
                      className="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-full border border-[rgba(148,134,255,0.28)] bg-white/[0.05] px-4 py-2 font-sans font-semibold text-sm tracking-[0.01em] text-white/92 transition-all hover:bg-white/[0.1]"
                      onClick={() => {
                        setLoading(true);
                        fetchPartidosAbiertos();
                      }}
                    >
                      Reintentar
                    </button>
                  </div>
                ) : null}

                {shouldShowLocationHelp ? (
                  <EmptyStateCard
                    icon={MapPinOff}
                    title="Activá tu ubicación"
                    description="Para ver partidos cerca tuyo activá la ubicación desde tu perfil o desde Ajustes del teléfono. Mientras tanto te mostramos todos los partidos abiertos."
                    actionLabel="Ir a perfil"
                    onAction={() => navigate('/profile')}
                    className="mt-2 mb-4"
                    titleClassName="font-oswald text-[clamp(18px,5.6vw,22px)] font-semibold leading-tight text-white"
                  />
                ) : null}

                {/* Compact premium distance filter — label + value pill on one
                    row, precise pointer-driven slider below. No explanatory
                    paragraph (keeps the map tall): the location-help empty state
                    above already covers the "no location" case. */}
                <div className="w-full max-w-[500px] mt-1.5 mb-2.5 rounded-card surface-card px-3.5 py-2">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="font-sans font-bold text-[11px] uppercase tracking-[0.14em] text-[#b0a0ff]/85">
                      Distancia
                    </span>
                    <span className="font-sans text-[13px] font-bold text-white inline-flex items-center rounded-full border border-[rgba(148,134,255,0.3)] bg-[rgba(106,67,255,0.16)] px-2.5 py-0.5 leading-none">
                      {maxMatchDistanceKm} km
                    </span>
                  </div>

                  <DistanceSlider
                    min={MIN_MATCH_DISTANCE_KM}
                    max={MAX_MATCH_DISTANCE_KM}
                    step={1}
                    value={maxMatchDistanceKm}
                    disabled={!canFilterByDistance}
                    onChange={handleMatchDistanceChange}
                    ariaLabel="Distancia máxima de partidos"
                    valueText={`${maxMatchDistanceKm} km`}
                  />
                </div>

                {/* Lista / Mapa sub-view toggle — PARTIDOS only. Lista is the default. */}
                <div className="w-full max-w-[500px] mb-3 flex h-[40px] gap-1 p-1 overflow-hidden rounded-full border border-[rgba(148,134,255,0.22)] bg-[rgba(20,16,41,0.85)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <button
                    type="button"
                    aria-pressed={partidosView === 'lista'}
                    className={`flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-full font-sans text-[12px] font-bold uppercase tracking-[0.04em] transition-[background-color,color] duration-150 ${partidosView === 'lista'
                      ? 'bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4)]'
                      : 'bg-transparent text-white/55 hover:text-white/85 hover:bg-white/[0.06]'
                      }`}
                    onClick={() => selectPartidosView('lista')}
                  >
                    <List size={14} /> Lista
                  </button>
                  <button
                    type="button"
                    aria-pressed={partidosView === 'mapa'}
                    className={`flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-full font-sans text-[12px] font-bold uppercase tracking-[0.04em] transition-[background-color,color] duration-150 ${partidosView === 'mapa'
                      ? 'bg-cta-gradient text-white shadow-[0_4px_14px_rgba(106,67,255,0.4)]'
                      : 'bg-transparent text-white/55 hover:text-white/85 hover:bg-white/[0.06]'
                      }`}
                    onClick={() => selectPartidosView('mapa')}
                  >
                    <MapIcon size={14} /> Mapa
                  </button>
                </div>

                {partidosView === 'lista' ? (
                  visibleMatches.length === 0 ? (
                  <div className="w-full max-w-[500px] rounded-card surface-card p-6 text-center">
                    <p className="text-white font-oswald font-bold text-base">
                      {canFilterByDistance
                        ? `No hay partidos elegibles dentro de ${maxMatchDistanceKm} km.`
                        : 'No hay partidos abiertos elegibles para mostrar en este momento.'}
                    </p>
                    <p className="text-white/55 font-sans text-sm mt-1.5 leading-relaxed">
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
                          className="relative w-full max-w-[500px] overflow-hidden rounded-card bg-[radial-gradient(360px_180px_at_12%_-30%,rgba(139,92,255,0.18),transparent_70%),linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))] border border-[rgba(148,134,255,0.16)] p-3.5 pl-4 mb-2.5 shadow-elev-2 transition-all duration-200 hover:brightness-[1.05] hover:border-[rgba(148,134,255,0.42)] before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[linear-gradient(180deg,#8b5cff,rgba(139,92,255,0.08))]"
                        >
                          <div className="flex justify-between items-start mb-2 gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="inline-flex items-center gap-1.5 font-oswald text-[14px] font-bold text-white capitalize min-w-0">
                                <Calendar size={14} className="text-[#cfc4ff] shrink-0" />
                                <span className="truncate">{formattedDate}</span>
                                <span className="text-white/40">•</span>
                                <Clock size={14} className="text-[#cfc4ff] shrink-0" />
                                <span>{partido.hora} hs</span>
                              </div>
                            </div>
                            <div className="shrink-0 flex items-center justify-end gap-2 flex-wrap">
                              {isComplete ? (
                                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap border border-[#22c55e]/50 bg-[#22c55e]/12 text-[#86efac]">
                                  {titularesDisplayCount}/{cupoMaximo}
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap border border-white/[0.12] bg-[#0c0a1d]/80 text-white/70">
                                  {titularesDisplayCount}/{cupoMaximo}
                                </span>
                              )}
                              {substitutesCount > 0 && (
                                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap border border-amber-400/35 bg-amber-500/10 text-amber-300">
                                  {substitutesCount}/{MAX_SUBSTITUTE_SLOTS}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                            <span className="font-sans text-[11px] font-bold px-2.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap border-[#22c55e]/45 bg-[#22c55e]/10 text-[#86efac]">{partido.modalidad || 'F5'}</span>
                            <span className="font-sans text-[11px] font-bold px-2.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap border-[#2dd4bf]/45 bg-[#2dd4bf]/10 text-[#99f6e4]">{partido.tipo_partido || 'Mixto'}</span>
                            {isOwnerMatch ? (
                              <span className="font-sans px-2.5 py-[3px] rounded-full text-[10px] font-bold shrink-0 whitespace-nowrap border border-[#8e7dff]/60 bg-[rgba(106,67,255,0.16)] text-[#ddd7ff] uppercase tracking-[0.04em]">
                                Tu partido
                              </span>
                            ) : null}
                          </div>

                          <div className="font-sans text-[12.5px] font-medium text-white/65 flex items-center gap-1.5 min-w-0">
                            <MapPin size={14} className="shrink-0 text-[#cfc4ff]" />
                            <span className="truncate whitespace-nowrap" title={locationLabel}>{locationLabel}</span>
                          </div>
                          {Number.isFinite(roundedDistanceKm) ? (
                            <div className="mt-1 text-[12px] font-sans font-semibold flex items-center gap-1.5 text-[#b0a0ff]">
                              <MapPin size={12} />
                              {`A ${roundedDistanceKm} km`}
                            </div>
                          ) : null}

                          <div className="flex gap-2 mt-3">
                            <button
                              className="flex-1 font-bebas font-semibold text-base px-4 py-2 border border-white/15 rounded-2xl cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-cta-gradient shadow-cta hover:brightness-110"
                              onClick={() => handleOpenMatch(partido, { isOwner: isOwnerMatch })}
                            >
                              Ver partido
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                  )
                ) : (
                  <Suspense
                    fallback={(
                      <div className="w-full max-w-[520px] h-[62vh] min-h-[360px] rounded-card surface-card flex items-center justify-center">
                        <p className="font-oswald text-base font-bold text-white/70">Cargando mapa…</p>
                      </div>
                    )}
                  >
                    <MatchesMapView
                      matches={visibleMatches}
                      userLocation={userLocation}
                      currentUserId={user?.id}
                      onSelectMatch={handleOpenMatch}
                    />
                  </Suspense>
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
                <div className="flex gap-1.5 mb-4 w-full max-w-[500px]">
                  <button
                    className={`flex-1 py-2 rounded-full text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'distance'
                      ? 'bg-[rgba(106,67,255,0.25)] text-white border-[rgba(148,134,255,0.5)] shadow-[0_0_12px_rgba(106,67,255,0.2)]'
                      : 'bg-white/[0.03] text-white/45 border-[rgba(148,134,255,0.14)] hover:bg-white/[0.06] hover:text-white/70'
                      }`}
                    onClick={() => setSortBy('distance')}
                  >
                    <span className="flex items-center gap-1.5 justify-center"><MapPin size={12} /> Distancia</span>
                  </button>
                  <button
                    className={`flex-1 py-2 rounded-full text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'rating'
                      ? 'bg-[rgba(106,67,255,0.25)] text-white border-[rgba(148,134,255,0.5)] shadow-[0_0_12px_rgba(106,67,255,0.2)]'
                      : 'bg-white/[0.03] text-white/45 border-[rgba(148,134,255,0.14)] hover:bg-white/[0.06] hover:text-white/70'
                      }`}
                    onClick={() => setSortBy('rating')}
                  >
                    <span className="flex items-center gap-1.5 justify-center"><Star size={12} /> Rating</span>
                  </button>
                  <button
                    className={`flex-1 py-2 rounded-full text-[11px] font-bold tracking-wide cursor-pointer transition-all duration-300 uppercase border ${sortBy === 'position'
                      ? 'bg-[rgba(106,67,255,0.25)] text-white border-[rgba(148,134,255,0.5)] shadow-[0_0_12px_rgba(106,67,255,0.2)]'
                      : 'bg-white/[0.03] text-white/45 border-[rgba(148,134,255,0.14)] hover:bg-white/[0.06] hover:text-white/70'
                      }`}
                    onClick={() => setSortBy('position')}
                  >
                    <span className="flex items-center gap-1.5 justify-center"><ListOrdered size={12} /> Posición</span>
                  </button>
                </div>

                <div className="w-full max-w-[500px] flex flex-col gap-2">
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
                        markOnboardingAction?.('reviewedPlayer');
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
