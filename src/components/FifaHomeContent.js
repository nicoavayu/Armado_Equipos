import logger from '../utils/logger';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, BarChart3, Bell, CalendarClock, CalendarDays, CheckCircle, ChevronRight, ClipboardList, History, Trophy, UserPlus, Users, Vote } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { useInterval } from '../hooks/useInterval';
import { supabase } from '../supabase';
import { listMyTeamMatches } from '../services/db/teamChallenges';
import { parseLocalDateTime } from '../utils/dateLocal';
import { buildActivityFeed } from '../utils/activityFeed';
import {
  getNextHomeAction,
  resolvePaymentsNextStepAction,
  validateNextHomeAction,
} from '../utils/homeNextStep';
import { openNotification } from '../utils/notificationRouter';
import { notifyBlockingError } from '../utils/notifyBlockingError';
import ProximosPartidos from './ProximosPartidos';
import HomeWelcomeCard from './HomeWelcomeCard';
import HomeNextStepCard from './HomeNextStepCard';
import QuickAccessRail from './QuickAccessRail';
import SwipeDismissibleActivityItem from './SwipeDismissibleActivityItem';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';
import { prefetchRoute } from '../utils/routePrefetch';
import {
  dismissRecentActivityItem,
  filterDismissedRecentActivityItems,
  getRecentActivityItemKey,
} from '../utils/recentActivityDismissals';
import { useAwardsStory } from './global-header/AwardsStoryContext';

export {
  getDirectAwardsRingMatchIds,
  isAwardsRingNotificationType,
} from './global-header/AwardsStoryContext';

// Line-style soccer ball icon for the "Partido nuevo" quick-access hero card.
const SoccerBallIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6.6l3.6 2.6-1.4 4.2H9.8L8.4 9.2 12 6.6z" />
    <path d="M12 6.6V3.1M15.6 9.2L19 8M14.2 13.4l2.5 3.2M9.8 13.4l-2.5 3.2M8.4 9.2L5 8" />
  </svg>
);

const activityIconMap = {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle,
  ClipboardList,
  Trophy,
  UserPlus,
  Users,
  Vote,
};

const severityIconClass = {
  urgent: 'text-[#ff5a5f]',
  warning: 'text-[#f5c451]',
  success: 'text-[#5ad17b]',
  neutral: 'text-white/80',
};

const HOME_ACTIVE_MATCHES_REFRESH_MS = 60000;
const HOME_SNAPSHOT_STORAGE_PREFIX = 'home:snapshot:v1:';
const RECENT_ACTIVITY_DISMISS_EXIT_MS = 240;

const normalizeStatusToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const isCancelledTeamMatchStatus = (statusValue) => {
  const normalized = normalizeStatusToken(statusValue);
  return normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancelado';
};

const isCancelledChallengeStatus = (statusValue) => {
  const normalized = normalizeStatusToken(statusValue);
  return normalized === 'canceled' || normalized === 'cancelled' || normalized === 'cancelado';
};

const getHomeSnapshotStorageKey = (userId) => `${HOME_SNAPSHOT_STORAGE_PREFIX}${String(userId || '').trim()}`;

const buildActiveMatchesSignature = (matches = []) => JSON.stringify(
  (Array.isArray(matches) ? matches : []).map((match) => ({
    id: match?.id ?? null,
    partido_id: match?.partido_id ?? null,
    source_type: match?.source_type ?? null,
    status: match?.status ?? null,
    team_match_status: match?.team_match_status ?? null,
    fecha: match?.fecha ?? null,
    hora: match?.hora ?? null,
    scheduled_at: match?.scheduled_at ?? null,
  })),
);

const readHomeSnapshot = (userId) => {
  if (typeof window === 'undefined') return null;

  const storageKey = getHomeSnapshotStorageKey(userId);
  if (!storageKey.trim()) return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      activeMatches: Array.isArray(parsed.activeMatches) ? parsed.activeMatches : [],
      activityItems: Array.isArray(parsed.activityItems) ? parsed.activityItems : [],
    };
  } catch {
    return null;
  }
};

const writeHomeSnapshot = (userId, snapshot) => {
  if (typeof window === 'undefined') return;

  const storageKey = getHomeSnapshotStorageKey(userId);
  if (!storageKey.trim()) return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify({
      activeMatches: Array.isArray(snapshot?.activeMatches) ? snapshot.activeMatches : [],
      activityItems: Array.isArray(snapshot?.activityItems) ? snapshot.activityItems : [],
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Ignore quota/private mode failures.
  }
};

const FifaHomeContent = ({ _onCreateMatch, _onViewHistory, _onViewInvitations, _onViewActivePlayers }) => {
  const { user } = useAuth();
  const notificationsCtx = useNotifications() || {};
  const notifications = notificationsCtx.notifications || [];
  const navigate = useNavigate();
  const location = useLocation();
  const { setIntervalSafe, clearIntervalSafe } = useInterval();
  const [activeMatches, setActiveMatches] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityItems, setActivityItems] = useState([]);
  const [activityHasFreshValidation, setActivityHasFreshValidation] = useState(false);
  const [activityRefreshNonce, setActivityRefreshNonce] = useState(0);
  const [dismissingActivityKeys, setDismissingActivityKeys] = useState(() => new Set());
  const [showProximosPartidos, setShowProximosPartidos] = useState(false);
  const {
    awardsReadyVisibleMatchIds,
    loading: awardsRingLoading,
  } = useAwardsStory();
  const [paymentsNextStepAction, setPaymentsNextStepAction] = useState(null);
  const activityLoadedRef = useRef(false);
  const nextStepValidationInFlightRef = useRef(false);
  const activeMatchesRefreshInFlightRef = useRef(false);
  const activeMatchesSignatureRef = useRef(buildActiveMatchesSignature([]));
  const activityDismissTimeoutsRef = useRef(new Map());

  const handleActivityItemClick = async (item) => {
    if (!item?.route) return;

    if (item.type === 'survey_results_ready' && item.partidoId) {
      await openNotification({
        type: 'survey_results_ready',
        partido_id: item.partidoId,
        data: {
          resultsUrl: item.route,
          match_id: item.partidoId,
          match_name: item.matchName || null,
        },
      }, navigate, {
        supabaseClient: supabase,
        onResultsUnavailable: (notice) => {
          if (notice?.message) {
            notifyBlockingError(notice.message, { title: notice.title });
          }
        },
      });
      return;
    }

    navigate(item.route);
  };

  // "Tu próximo paso": one truly valid pending action, or nothing.
  const nextStepAction = useMemo(() => getNextHomeAction({
    activityItems: activityHasFreshValidation ? activityItems : [],
    validatedResultsMatchIds: awardsReadyVisibleMatchIds,
    resultsValidationLoading: awardsRingLoading,
    paymentAction: paymentsNextStepAction,
  }), [
    activityHasFreshValidation,
    activityItems,
    awardsReadyVisibleMatchIds,
    awardsRingLoading,
    paymentsNextStepAction,
  ]);

  // The next-step card is the richer version of the activity item it was
  // promoted from, so that exact row is hidden in Recent Activity (other
  // events of the same match still show).
  const visibleActivityItems = useMemo(() => {
    if (!nextStepAction?.sourceActivityId) return activityItems;
    return activityItems.filter((item) => item?.id !== nextStepAction.sourceActivityId);
  }, [activityItems, nextStepAction]);

  const handleNextStepClick = async (action) => {
    if (!action?.route || nextStepValidationInFlightRef.current) return;

    nextStepValidationInFlightRef.current = true;
    const isCurrent = await validateNextHomeAction({
      action,
      supabaseClient: supabase,
      userId: user?.id,
    });
    nextStepValidationInFlightRef.current = false;

    if (!isCurrent) {
      setActivityItems((currentItems) => (
        action?.sourceActivityId
          ? currentItems.filter((item) => item?.id !== action.sourceActivityId)
          : currentItems
      ));
      setActivityHasFreshValidation(false);
      setActivityRefreshNonce((current) => current + 1);
      fetchActiveMatches();
      return;
    }

    // Results CTAs go through the notification router so the "results
    // unavailable" guard applies even if state changed after validation.
    if (action.isResultsAction && action.partidoId) {
      await openNotification({
        type: 'survey_results_ready',
        partido_id: action.partidoId,
        data: {
          resultsUrl: action.route,
          match_id: String(action.partidoId),
          match_name: action.matchName || null,
        },
      }, navigate, {
        supabaseClient: supabase,
        onResultsUnavailable: (notice) => {
          if (notice?.message) {
            notifyBlockingError(notice.message, { title: notice.title });
          }
        },
      });
      return;
    }

    navigate(action.route);
  };

  useEffect(() => {
    let cancelled = false;

    const loadPaymentsNextStep = async () => {
      if (!user?.id) {
        if (!cancelled) setPaymentsNextStepAction(null);
        return;
      }

      try {
        const action = await resolvePaymentsNextStepAction({
          supabaseClient: supabase,
          userId: user.id,
          notifications,
        });
        if (!cancelled) setPaymentsNextStepAction(action);
      } catch (error) {
        logger.warn('[HOME] payments next-step lookup failed:', error);
        if (!cancelled) setPaymentsNextStepAction(null);
      }
    };

    loadPaymentsNextStep();

    return () => {
      cancelled = true;
    };
  }, [notifications, user?.id]);

  const handleDismissActivityItem = useCallback((itemKey) => {
    const normalizedItemKey = String(itemKey || '').trim();
    if (!normalizedItemKey) return;

    dismissRecentActivityItem(user?.id, normalizedItemKey);
    setDismissingActivityKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      nextKeys.add(normalizedItemKey);
      return nextKeys;
    });

    const existingTimeout = activityDismissTimeoutsRef.current.get(normalizedItemKey);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    const timeoutId = window.setTimeout(() => {
      setActivityItems((currentItems) => (
        filterDismissedRecentActivityItems(currentItems, user?.id)
          .filter((item) => getRecentActivityItemKey(item) !== normalizedItemKey)
      ));
      setDismissingActivityKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.delete(normalizedItemKey);
        return nextKeys;
      });
      activityDismissTimeoutsRef.current.delete(normalizedItemKey);
    }, RECENT_ACTIVITY_DISMISS_EXIT_MS);

    activityDismissTimeoutsRef.current.set(normalizedItemKey, timeoutId);
  }, [user?.id]);

  useEffect(() => () => {
    activityDismissTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    activityDismissTimeoutsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!location?.state?.openProximosPartidos) return;
    setShowProximosPartidos(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    activityLoadedRef.current = false;
    setActivityHasFreshValidation(false);
    activeMatchesSignatureRef.current = buildActiveMatchesSignature([]);

    if (!user?.id) {
      setActiveMatches([]);
      setActivityItems([]);
      setDismissingActivityKeys(new Set());
      setActivityLoading(false);
      return;
    }

    setDismissingActivityKeys(new Set());

    const snapshot = readHomeSnapshot(user.id);
    if (!snapshot) {
      setActiveMatches([]);
      setActivityItems([]);
      setActivityLoading(true);
      return;
    }

    activeMatchesSignatureRef.current = buildActiveMatchesSignature(snapshot.activeMatches);
    setActiveMatches(snapshot.activeMatches);
    setActivityItems(filterDismissedRecentActivityItems(snapshot.activityItems, user.id));
    activityLoadedRef.current = true;
    setActivityLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !activityLoadedRef.current) return;

    writeHomeSnapshot(user.id, {
      activeMatches,
      activityItems,
    });
  }, [activeMatches, activityItems, user?.id]);

  const fetchActiveMatches = useCallback(async () => {
    if (!user) {
      activeMatchesSignatureRef.current = buildActiveMatchesSignature([]);
      setActiveMatches([]);
      return;
    }

    if (activeMatchesRefreshInFlightRef.current) {
      return;
    }

    activeMatchesRefreshInFlightRef.current = true;

    try {
      const [
        jugadoresResponse,
        partidosComoAdminResponse,
        clearedMatchesResponse,
        teamMatches,
      ] = await Promise.all([
        supabase
          .from('jugadores')
          .select('id, partido_id')
          .eq('usuario_id', user.id),
        supabase
          .from('partidos')
          .select('id')
          .eq('creado_por', user.id),
        supabase
          .from('cleared_matches')
          .select('partido_id')
          .eq('user_id', user.id),
        listMyTeamMatches(user.id, {
          statuses: ['pending', 'confirmed'],
        }),
      ]);

      if (jugadoresResponse.error) throw jugadoresResponse.error;
      if (partidosComoAdminResponse.error) throw partidosComoAdminResponse.error;

      const jugadoresData = jugadoresResponse.data || [];
      const partidosComoJugador = jugadoresData.map((jugador) => jugador.partido_id);
      const partidosAdminIds = (partidosComoAdminResponse.data || []).map((partido) => partido.id);
      const todosLosPartidosIds = Array.from(new Set([...partidosComoJugador, ...partidosAdminIds]))
        .filter((id) => id != null);

      let clearedMatchIds = new Set();
      try {
        if (clearedMatchesResponse.error) {
          const key = `cleared_matches_${user.id}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          clearedMatchIds = new Set(existing.map((v) => String(v)));
        } else {
          clearedMatchIds = new Set(((clearedMatchesResponse.data || []).map((row) => String(row.partido_id)) || []));
        }
      } catch (error) {
        const key = `cleared_matches_${user.id}`;
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        clearedMatchIds = new Set(existing.map((v) => String(v)));
      }

      let completedSurveys = new Set();
      try {
        if (jugadoresData.length > 0) {
          const jugadorIds = jugadoresData.map((jugador) => jugador.id).filter(Boolean);
          const { data: surveysData } = await supabase
            .from('post_match_surveys')
            .select('partido_id')
            .in('votante_id', jugadorIds);
          completedSurveys = new Set((surveysData?.map((s) => String(s.partido_id)) || []));
        }
      } catch (error) {
        logger.error('Error fetching completed surveys:', error);
      }

      let partidosData = [];
      if (todosLosPartidosIds.length > 0) {
        const legacyMatchesResponse = await supabase
          .from('partidos')
          .select('*, jugadores(count)')
          .in('id', todosLosPartidosIds)
          .order('fecha', { ascending: true })
          .order('hora', { ascending: true });

        if (legacyMatchesResponse.error) throw legacyMatchesResponse.error;
        partidosData = legacyMatchesResponse.data || [];
      }

      const now = new Date();
      const partidosFiltrados = partidosData?.filter((partido) => {
        const estado = String(partido?.estado || '').toLowerCase();
        if (['cancelado', 'cancelled', 'deleted'].includes(estado) || partido?.deleted_at) {
          return false;
        }

        const partidoIdStr = String(partido.id);
        if (clearedMatchIds.has(partidoIdStr) || completedSurveys.has(partidoIdStr)) {
          return false;
        }

        if (!partido.fecha || !partido.hora) return true;

        try {
          const partidoDateTime = parseLocalDateTime(partido.fecha, partido.hora);
          if (!partidoDateTime) return true;
          return now < partidoDateTime;
        } catch {
          return true;
        }
      }) || [];

      let cancelledBridgePartidoIds = new Set();
      const partidosIdsForBridgeLookup = partidosFiltrados
        .map((partido) => Number(partido?.id || 0))
        .filter((partidoId, idx, arr) => Number.isFinite(partidoId) && partidoId > 0 && arr.indexOf(partidoId) === idx);

      if (partidosIdsForBridgeLookup.length > 0) {
        try {
          const { data: bridgeRows, error: bridgeError } = await supabase
            .from('team_matches')
            .select('partido_id, status, challenge_id')
            .in('partido_id', partidosIdsForBridgeLookup);

          if (bridgeError) throw bridgeError;

          let cancelledChallengeIds = new Set();
          const challengeIds = Array.from(
            new Set(
              (bridgeRows || [])
                .map((row) => String(row?.challenge_id || '').trim())
                .filter(Boolean),
            ),
          );

          if (challengeIds.length > 0) {
            const { data: challengeStatusRows, error: challengeStatusError } = await supabase
              .from('challenges')
              .select('id, status')
              .in('id', challengeIds);
            if (challengeStatusError) throw challengeStatusError;
            cancelledChallengeIds = new Set(
              (challengeStatusRows || [])
                .filter((row) => isCancelledChallengeStatus(row?.status))
                .map((row) => String(row?.id || '').trim())
                .filter(Boolean),
            );
          }

          cancelledBridgePartidoIds = new Set(
            (bridgeRows || [])
              .filter((row) => (
                isCancelledTeamMatchStatus(row?.status)
                || cancelledChallengeIds.has(String(row?.challenge_id || '').trim())
              ))
              .map((row) => String(row?.partido_id || ''))
              .filter(Boolean),
          );
        } catch (bridgeLookupError) {
          logger.warn('[HOME] team_matches cancellation bridge lookup failed:', bridgeLookupError);
        }
      }

      const partidosFiltradosActivos = partidosFiltrados.filter(
        (partido) => !cancelledBridgePartidoIds.has(String(partido?.id || '')),
      );


      const teamMatchesEnriquecidos = (teamMatches || []).map((match) => {
        if (isCancelledTeamMatchStatus(match?.status)) {
          return null;
        }

        const scheduledDate = match?.scheduled_at ? new Date(match.scheduled_at) : null;
        if (scheduledDate && !Number.isNaN(scheduledDate.getTime()) && now >= scheduledDate) {
          return null;
        }
        const year = scheduledDate ? scheduledDate.getFullYear() : null;
        const month = scheduledDate ? String(scheduledDate.getMonth() + 1).padStart(2, '0') : null;
        const day = scheduledDate ? String(scheduledDate.getDate()).padStart(2, '0') : null;
        const hour = scheduledDate ? String(scheduledDate.getHours()).padStart(2, '0') : null;
        const minute = scheduledDate ? String(scheduledDate.getMinutes()).padStart(2, '0') : null;
        const linkedPartidoId = Number(match?.partido_id);
        const hasLinkedPartidoId = Number.isFinite(linkedPartidoId) && linkedPartidoId > 0;
        const linkedPartidoKey = hasLinkedPartidoId ? String(linkedPartidoId) : null;

        if (linkedPartidoKey && (clearedMatchIds.has(linkedPartidoKey) || completedSurveys.has(linkedPartidoKey))) {
          return null;
        }

        return {
          id: match?.id,
          partido_id: hasLinkedPartidoId ? linkedPartidoId : null,
          source_type: 'team_match',
          fecha: year ? `${year}-${month}-${day}` : null,
          hora: hour ? `${hour}:${minute}` : null,
          scheduled_at: match?.scheduled_at || null,
        };
      }).filter(Boolean);

      const linkedPartidoIds = new Set(
        teamMatchesEnriquecidos
          .map((match) => String(match?.partido_id || ''))
          .filter(Boolean),
      );

      const partidosFiltradosActivosSinDuplicados = partidosFiltradosActivos.filter(
        (partido) => !linkedPartidoIds.has(String(partido?.id || '')),
      );

      const mergedMatches = [...partidosFiltradosActivosSinDuplicados, ...teamMatchesEnriquecidos];
      const visibleMatches = mergedMatches.filter((partido) => {
        if (partido?.source_type === 'team_match') {
          const status = String(partido?.team_match_status || '').toLowerCase();
          if (isCancelledTeamMatchStatus(status) || status === 'played') return false;
          const scheduledAt = partido?.scheduled_at ? new Date(partido.scheduled_at) : null;
          if (scheduledAt && !Number.isNaN(scheduledAt.getTime())) {
            return new Date() < scheduledAt;
          }
          if (!partido?.fecha || !partido?.hora) return true;
          const parsed = parseLocalDateTime(partido.fecha, partido.hora);
          if (!parsed) return true;
          return new Date() < parsed;
        }

        if (!partido?.fecha || !partido?.hora) return true;
        const parsed = parseLocalDateTime(partido.fecha, partido.hora);
        if (!parsed) return true;
        return new Date() < parsed;
      });

      const nextSignature = buildActiveMatchesSignature(visibleMatches);
      if (activeMatchesSignatureRef.current !== nextSignature) {
        activeMatchesSignatureRef.current = nextSignature;
        setActiveMatches(visibleMatches);
      }
    } catch (error) {
      logger.error('Error fetching active matches:', error);
    } finally {
      activeMatchesRefreshInFlightRef.current = false;
    }
  }, [user]);

  useEffect(() => {
    clearIntervalSafe();

    if (!user?.id) {
      setActiveMatches([]);
      return undefined;
    }

    fetchActiveMatches();

    setIntervalSafe(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchActiveMatches();
    }, HOME_ACTIVE_MATCHES_REFRESH_MS);

    return () => clearIntervalSafe();
  }, [clearIntervalSafe, fetchActiveMatches, setIntervalSafe, user?.id]);

  useRefreshOnVisibility(
    () => {
      fetchActiveMatches();
      setActivityHasFreshValidation(false);
      setActivityRefreshNonce((current) => current + 1);
    },
    {
      enabled: Boolean(user?.id),
    },
  );

  useEffect(() => {
    let cancelled = false;

    const loadActivity = async () => {
      if (!user?.id) {
        if (!cancelled) {
          setActivityItems([]);
          setActivityHasFreshValidation(false);
          setActivityLoading(false);
        }
        return;
      }

      if (!activityLoadedRef.current) {
        setActivityLoading(true);
      }
      const items = await buildActivityFeed(notifications || [], {
        activeMatches,
        currentUserId: user.id,
        supabaseClient: supabase,
      });

      if (!cancelled) {
        setActivityItems(filterDismissedRecentActivityItems(items, user.id));
        setActivityHasFreshValidation(true);
        activityLoadedRef.current = true;
        setActivityLoading(false);
      }
    };

    loadActivity();

    return () => {
      cancelled = true;
    };
  }, [activeMatches, activityRefreshNonce, notifications, user?.id]);

  // Mostrar ProximosPartidos si está activo
  if (showProximosPartidos) {
    return (
      <ProximosPartidos
        onClose={() => setShowProximosPartidos(false)}
      />
    );
  }

  // Quick-access rail items — the old 2x2 grid destinations + partido automático.
  const quickAccessItems = [
    {
      key: 'nuevo-partido',
      to: '/nuevo-partido',
      prefetch: '/nuevo-partido',
      icon: <SoccerBallIcon />,
      title: 'Partido nuevo',
      subtitle: 'Armá y compartí',
      showPlus: true,
    },
    {
      key: 'mis-partidos',
      onClick: () => user && setShowProximosPartidos(true),
      icon: <CalendarDays />,
      title: 'Mis partidos',
      subtitle: 'Agenda y estado',
      badge: activeMatches?.length || 0,
    },
    {
      key: 'frecuentes',
      to: '/frecuentes',
      prefetch: '/frecuentes',
      icon: <History />,
      title: 'Frecuentes',
      subtitle: 'Tus plantillas',
    },
    {
      key: 'estadisticas',
      to: '/stats',
      prefetch: '/stats',
      icon: <BarChart3 />,
      title: 'Estadísticas',
      subtitle: 'Tu rendimiento',
    },
    {
      key: 'partido-automatico',
      to: '/quiero-jugar?auto=1',
      prefetch: '/quiero-jugar',
      icon: <CalendarClock />,
      title: 'Partido automático',
      subtitle: 'Decidí cuando jugar',
    },
  ];

  return (
    <div className="w-full bg-transparent shadow-none flex-1 flex flex-col min-h-0 overflow-hidden">
      <HomeWelcomeCard />

      <QuickAccessRail items={quickAccessItems} />

      {/* Next-action card — only when a real, valid pending action exists */}
      <HomeNextStepCard
        action={nextStepAction}
        onOpen={handleNextStepClick}
        onPrefetch={(action) => {
          if (action?.route) prefetchRoute(action.route);
        }}
      />

      {/* Recent Activity */}
      {/* Top spacing comes from the grid's mb-7; flex items don't collapse margins */}
      <section className="mb-2 flex-auto flex flex-col min-h-0">
        <h3 className="section-title" style={{ marginBottom: 20 }}>Actividad reciente</h3>

        <div className="surface-card rounded-card overflow-hidden flex-1 flex flex-col min-h-0 relative">
          {/* min-h-0 is required here: on short iPhones the panel must shrink to
              the remaining viewport instead of pushing/clipping the dashboard. */}
          <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
            {activityLoading ? (
              <div className="min-h-0 flex-1 overflow-hidden px-4 py-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`activity-skeleton-${index}`} className="py-3">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-white/[0.1] animate-pulse" />
                      <div className="min-w-0 flex-1 pt-1">
                        <div className="h-3.5 w-[82%] rounded-full bg-white/[0.13] animate-pulse" />
                        <div className="h-3 mt-2 w-[52%] rounded-full bg-white/[0.08] animate-pulse" />
                      </div>
                    </div>
                    {index < 3 && <div className="mt-3 h-px bg-white/[0.06]" />}
                  </div>
                ))}
              </div>
            ) : visibleActivityItems.length > 0 ? (
              <div
                className="home-activity-scroll min-h-0 flex-1 overflow-y-auto custom-scrollbar pb-7"
                data-home-activity-scroll="true"
              >
                {visibleActivityItems.map((item, index) => {
                  const itemKey = getRecentActivityItemKey(item);
                  const Icon = activityIconMap[item.icon] || Bell;
                  const iconColorClass = severityIconClass[item.severity] || severityIconClass.neutral;
                  const subtitleParts = [item.subtitle];
                  if (item.count > 1) subtitleParts.push(`x${item.count}`);
                  const subtitleText = subtitleParts.filter(Boolean).join(' · ');
                  const canNavigate = Boolean(item.route);

                  return (
                    <SwipeDismissibleActivityItem
                      key={itemKey}
                      itemKey={itemKey}
                      isDismissing={dismissingActivityKeys.has(itemKey)}
                      onDismiss={handleDismissActivityItem}
                    >
                      <button
                        type="button"
                        aria-disabled={!canNavigate}
                        onClick={() => {
                          if (!canNavigate) return;
                          handleActivityItemClick(item);
                        }}
                        onMouseEnter={() => {
                          if (canNavigate) prefetchRoute(item.route);
                        }}
                        onTouchStart={() => {
                          if (canNavigate) prefetchRoute(item.route);
                        }}
                        onFocus={() => {
                          if (canNavigate) prefetchRoute(item.route);
                        }}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                          index % 2 === 1 ? 'bg-white/[0.025]' : 'bg-transparent'
                        } ${
                          canNavigate
                            ? 'hover:bg-white/[0.06] active:bg-white/[0.09]'
                            : 'opacity-85 cursor-default'
                        }`}
                      >
                        <span className={`mt-1 inline-flex w-6 shrink-0 items-center justify-center ${iconColorClass}`}>
                          <Icon size={19} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div
                            className="text-white/92 text-[13.5px] leading-[1.25rem] font-medium"
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {item.title}
                          </div>
                          <div className="text-white/50 text-[11.5px] leading-4 mt-0.5 whitespace-pre-line break-words">
                            {subtitleText}
                          </div>
                        </div>

                        {canNavigate && (
                          <div className="pt-2 shrink-0 text-white/30">
                            <ChevronRight size={14} />
                          </div>
                        )}
                      </button>

                      {index < visibleActivityItems.length - 1 && (
                        <div className="h-px bg-white/[0.06] mx-4" />
                      )}
                    </SwipeDismissibleActivityItem>
                  );
                })}
              </div>
            ) : (
              <div className="min-h-0 flex-1 flex flex-col items-center justify-center text-center px-5">
                <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(140deg,rgba(139,92,255,0.3),rgba(106,67,255,0.08))] border border-[rgba(148,134,255,0.35)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                  <Bell size={24} className="text-[#cfc4ff]" />
                </div>
                <div className="font-oswald text-[19px] leading-tight tracking-[0.01em] text-white font-bold">
                  Sin notificaciones
                </div>
                <div className="font-sans text-[13px] text-white/55 mt-1.5 max-w-[300px] leading-relaxed">
                  Cuando haya actividad nueva en tus partidos, te va a aparecer acá.
                </div>
              </div>
            )}
          </div>
          {/* Fade sutil al pie: sugiere que el panel scrollea sin parecer una cajita web */}
          {!activityLoading && visibleActivityItems.length > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-7 rounded-b-card bg-[linear-gradient(to_top,rgba(16,12,33,0.96),rgba(16,12,33,0.5)_45%,transparent)] z-[1]"
            />
          )}
        </div>
      </section>


    </div>
  );
};

export default FifaHomeContent;
