import logger from '../utils/logger';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, BarChart3, Bell, CalendarClock, CalendarDays, Check, CheckCircle, ChevronRight, ClipboardList, History, Trophy, UserPlus, Users, Vote } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { useInterval } from '../hooks/useInterval';
import { supabase, updateProfile, addFreePlayer, removeFreePlayer } from '../supabase';
import { listMyTeamMatches } from '../services/db/teamChallenges';
import { parseLocalDateTime } from '../utils/dateLocal';
import { buildActivityFeed } from '../utils/activityFeed';
import { AWARDS_READY_NOTIFICATION_TYPES, isAwardsReadyStatus } from '../utils/awardsReadiness';
import { openNotification } from '../utils/notificationRouter';
import { notifyBlockingError } from '../utils/notifyBlockingError';
import ProximosPartidos from './ProximosPartidos';
import NotificationsBell from './NotificationsBell';
import HomeWelcomeCard from './HomeWelcomeCard';
import QuickAccessRail from './QuickAccessRail';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';
import { prefetchRoute } from '../utils/routePrefetch';

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

const AWARDS_RING_WINDOW_MS = 24 * 60 * 60 * 1000;
const HOME_ACTIVE_MATCHES_REFRESH_MS = 60000;
const HOME_SNAPSHOT_STORAGE_PREFIX = 'home:snapshot:v1:';
export const RECENT_ACTIVITY_DISMISSED_STORAGE_PREFIX = 'arma2_recent_activity_dismissed_';
const ACTIVITY_SWIPE_INTENT_PX = 12;
const ACTIVITY_VERTICAL_INTENT_PX = 10;
const ACTIVITY_EXIT_ANIMATION_MS = 230;
const ACTIVITY_SETTLE_ANIMATION_MS = 210;
const ACTIVITY_DISMISS_FALLBACK_WIDTH = 320;
const normalizeNotificationType = (notificationType) => String(notificationType || '').trim().toLowerCase();
export const isAwardsRingNotificationType = (notificationType) => (
  AWARDS_READY_NOTIFICATION_TYPES.has(normalizeNotificationType(notificationType))
);
export const isDirectAwardsRingNotificationType = (notificationType) => (
  normalizeNotificationType(notificationType) === 'award_won'
);

const resolveNotificationMatchId = (notification) => (
  notification?.partido_id
  ?? notification?.data?.match_id
  ?? notification?.data?.matchId
  ?? notification?.match_ref
  ?? null
);

export const getDirectAwardsRingMatchIds = (notifications = []) => Array.from(new Set(
  (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => isDirectAwardsRingNotificationType(notification?.type))
    .map((notification) => resolveNotificationMatchId(notification))
    .filter((matchId) => matchId !== null && matchId !== undefined)
    .map((matchId) => String(matchId).trim())
    .filter(Boolean),
));

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

const isAwardsReadyAndVisible = (row) => isAwardsReadyStatus(row);

const getHomeSnapshotStorageKey = (userId) => `${HOME_SNAPSHOT_STORAGE_PREFIX}${String(userId || '').trim()}`;
export const getRecentActivityDismissedStorageKey = (userId) => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return null;
  return `${RECENT_ACTIVITY_DISMISSED_STORAGE_PREFIX}${normalizedUserId}`;
};

const normalizeActivityDismissId = (id) => String(id || '').trim();

const readRecentActivityDismissedIds = (userId) => {
  if (typeof window === 'undefined') return new Set();

  const storageKey = getRecentActivityDismissedStorageKey(userId);
  if (!storageKey) return new Set();

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(normalizeActivityDismissId).filter(Boolean));
  } catch {
    return new Set();
  }
};

const writeRecentActivityDismissedIds = (userId, dismissedIds) => {
  if (typeof window === 'undefined') return;

  const storageKey = getRecentActivityDismissedStorageKey(userId);
  if (!storageKey) return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(
      Array.from(dismissedIds || []).map(normalizeActivityDismissId).filter(Boolean),
    ));
  } catch {
    // Ignore quota/private mode failures.
  }
};

const filterDismissedActivityItems = (items = [], dismissedIds = new Set()) => (
  (Array.isArray(items) ? items : []).filter((item) => !dismissedIds.has(normalizeActivityDismissId(item?.id)))
);

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

const extractWinnerIds = (row) => {
  const awards = row?.awards || {};
  const mvpWinnerId = row?.mvp ?? awards?.mvp?.player_id ?? null;
  const gloveWinnerId = row?.golden_glove ?? awards?.best_gk?.player_id ?? null;
  const dirtyWinnerId = row?.dirty_player
    ?? (Array.isArray(row?.red_cards) ? row.red_cards[0] : null)
    ?? awards?.red_card?.player_id
    ?? null;

  return [mvpWinnerId, gloveWinnerId, dirtyWinnerId]
    .filter((id) => id !== null && id !== undefined && String(id).trim() !== '');
};

const hasRenderableWinnerInRoster = (row, roster = []) => {
  const winnerIds = extractWinnerIds(row);
  if (winnerIds.length === 0 || !Array.isArray(roster) || roster.length === 0) return false;

  return winnerIds.some((winnerId) => {
    const winnerStr = String(winnerId);
    const winnerStrLower = winnerStr.toLowerCase();

    return roster.some((player) => {
      const uuid = player?.uuid != null ? String(player.uuid) : '';
      const usuarioId = player?.usuario_id != null ? String(player.usuario_id) : '';
      const numericId = player?.id != null ? String(player.id) : '';

      return (
        uuid === winnerStr
        || usuarioId === winnerStr
        || numericId === winnerStr
        || (uuid && winnerStr && uuid.toLowerCase() === winnerStrLower)
      );
    });
  });
};

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const getDismissThreshold = (width) => Math.min(
  (width > 0 ? width : ACTIVITY_DISMISS_FALLBACK_WIDTH) * 0.45,
  140,
);

const SwipeDismissActivityItem = ({
  item,
  index,
  isLast,
  icon: Icon,
  iconColorClass,
  subtitleText,
  canNavigate,
  onDismiss,
  onNavigate,
  onPrefetch,
}) => {
  const rowRef = useRef(null);
  const animationFrameRef = useRef(null);
  const timeoutRef = useRef(null);
  const gestureRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [measuredHeight, setMeasuredHeight] = useState(null);

  const clearMotionTimers = useCallback(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearMotionTimers, [clearMotionTimers]);

  const resetSuppressedClickSoon = useCallback(() => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const finishReturn = useCallback(() => {
    const reducedMotion = prefersReducedMotion();
    setPhase('settling');
    setDragX(0);

    if (reducedMotion) {
      setPhase('idle');
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setPhase('idle');
    }, ACTIVITY_SETTLE_ANIMATION_MS);
  }, []);

  const finishDismiss = useCallback((direction, currentX = 0) => {
    const width = rowRef.current?.getBoundingClientRect?.().width || ACTIVITY_DISMISS_FALLBACK_WIDTH;
    const height = rowRef.current?.getBoundingClientRect?.().height || rowRef.current?.offsetHeight || 0;
    const reducedMotion = prefersReducedMotion();
    const exitX = direction * (width + 48);

    clearMotionTimers();
    suppressClickRef.current = true;
    setMeasuredHeight(height);
    setPhase('pre-dismiss');
    setDragX(currentX);

    const complete = () => {
      timeoutRef.current = null;
      onDismiss(item.id);
    };

    if (reducedMotion) {
      setPhase('dismissing');
      setDragX(exitX);
      complete();
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      setPhase('dismissing');
      setDragX(exitX);
      timeoutRef.current = window.setTimeout(complete, ACTIVITY_EXIT_ANIMATION_MS);
    });
  }, [clearMotionTimers, item.id, onDismiss]);

  const handlePointerDown = useCallback((event) => {
    if (event.button != null && event.button !== 0) return;
    if (phase === 'dismissing' || phase === 'pre-dismiss') return;

    clearMotionTimers();

    const width = rowRef.current?.getBoundingClientRect?.().width || ACTIVITY_DISMISS_FALLBACK_WIDTH;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastAt: event.timeStamp || Date.now(),
      width,
      horizontal: false,
      vertical: false,
      moved: false,
    };
    setMeasuredHeight(null);
    setPhase('idle');
    setDragX(0);
  }, [clearMotionTimers, phase]);

  const handlePointerMove = useCallback((event) => {
    const gesture = gestureRef.current;
    if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (gesture.vertical) return;

    if (!gesture.horizontal) {
      if (absY > ACTIVITY_VERTICAL_INTENT_PX && absY > absX * 1.15) {
        gesture.vertical = true;
        gesture.moved = true;
        suppressClickRef.current = true;
        return;
      }

      if (absX < ACTIVITY_SWIPE_INTENT_PX || absX < absY * 1.35) {
        return;
      }

      gesture.horizontal = true;
      gesture.moved = true;
      suppressClickRef.current = true;
      setPhase('dragging');
    }

    const dampedX = Math.max(Math.min(dx, gesture.width * 0.95), -gesture.width * 0.95);
    gesture.lastX = event.clientX;
    gesture.lastAt = event.timeStamp || Date.now();
    setDragX(dampedX);
  }, []);

  const handlePointerEnd = useCallback((event) => {
    const gesture = gestureRef.current;
    if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;

    const dx = event.clientX - gesture.startX;
    const elapsedMs = Math.max((event.timeStamp || Date.now()) - gesture.lastAt, 1);
    const tailVelocity = (event.clientX - gesture.lastX) / elapsedMs;
    const threshold = getDismissThreshold(gesture.width);
    const direction = dx === 0 ? 1 : Math.sign(dx);
    const conservativeFlick = Math.abs(dx) >= threshold * 0.85 && Math.abs(tailVelocity) > 0.9;

    if (gesture.horizontal && (Math.abs(dx) >= threshold || conservativeFlick)) {
      finishDismiss(direction, dragX || dx);
    } else {
      if (gesture.horizontal || gesture.moved || Math.abs(dx) > 4) {
        suppressClickRef.current = true;
        finishReturn();
      }
      resetSuppressedClickSoon();
    }

    gestureRef.current = null;
  }, [dragX, finishDismiss, finishReturn, resetSuppressedClickSoon]);

  const handlePointerCancel = useCallback(() => {
    const gesture = gestureRef.current;
    if (gesture?.horizontal) {
      suppressClickRef.current = true;
      finishReturn();
    }
    if (gesture?.moved) {
      suppressClickRef.current = true;
      resetSuppressedClickSoon();
    }
    gestureRef.current = null;
  }, [finishReturn, resetSuppressedClickSoon]);

  const handleClick = useCallback((event) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      return;
    }
    if (!canNavigate) return;
    onNavigate(item);
  }, [canNavigate, item, onNavigate]);

  const absDrag = Math.abs(dragX);
  const threshold = getDismissThreshold(rowRef.current?.getBoundingClientRect?.().width || ACTIVITY_DISMISS_FALLBACK_WIDTH);
  const dragProgress = Math.min(absDrag / threshold, 1);
  const rotation = phase === 'dragging' ? Math.max(Math.min(dragX / 90, 1.2), -1.2) : 0;
  const rowStyle = {
    height: phase === 'pre-dismiss'
      ? (measuredHeight ? `${measuredHeight}px` : undefined)
      : (phase === 'dismissing' ? 0 : undefined),
    opacity: phase === 'dismissing' ? 0 : 1,
    overflow: phase === 'pre-dismiss' || phase === 'dismissing' ? 'hidden' : undefined,
    transition: prefersReducedMotion()
      ? 'none'
      : 'height 230ms cubic-bezier(0.22, 1, 0.36, 1), opacity 190ms ease, margin 230ms cubic-bezier(0.22, 1, 0.36, 1)',
  };
  const cardStyle = {
    transform: `translate3d(${dragX}px, 0, 0) rotate(${rotation}deg)`,
    opacity: phase === 'dismissing' ? 0 : 1 - (dragProgress * 0.14),
    transition: phase === 'dragging' || phase === 'idle'
      ? 'none'
      : (prefersReducedMotion() ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 190ms ease'),
    touchAction: 'pan-y',
    willChange: phase === 'idle' ? undefined : 'transform, opacity',
  };

  return (
    <div
      ref={rowRef}
      style={rowStyle}
      data-testid={`recent-activity-row-${item.id}`}
      data-swipe-phase={phase}
    >
      <button
        type="button"
        aria-disabled={!canNavigate}
        tabIndex={canNavigate ? 0 : -1}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        onMouseEnter={() => {
          if (canNavigate) onPrefetch(item.route);
        }}
        onTouchStart={() => {
          if (canNavigate) onPrefetch(item.route);
        }}
        onFocus={() => {
          if (canNavigate) onPrefetch(item.route);
        }}
        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
          index % 2 === 1 ? 'bg-white/[0.025]' : 'bg-transparent'
        } ${
          canNavigate
            ? 'hover:bg-white/[0.06] active:bg-white/[0.09]'
            : 'opacity-85 cursor-default'
        }`}
        style={cardStyle}
        data-testid={`recent-activity-item-${item.id}`}
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

      {!isLast && (
        <div className="h-px bg-white/[0.06] mx-4" />
      )}
    </div>
  );
};

const FifaHomeContent = ({ _onCreateMatch, _onViewHistory, _onViewInvitations, _onViewActivePlayers }) => {
  const { user, profile, refreshProfile } = useAuth();
  const notificationsCtx = useNotifications() || {};
  const unreadCount = notificationsCtx.unreadCount || { friends: 0, matches: 0, total: 0 };
  const notifications = notificationsCtx.notifications || [];
  const navigate = useNavigate();
  const location = useLocation();
  const { setIntervalSafe, clearIntervalSafe } = useInterval();
  const [activeMatches, setActiveMatches] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityItems, setActivityItems] = useState([]);
  const [dismissedActivityIds, setDismissedActivityIds] = useState(() => readRecentActivityDismissedIds(user?.id));
  const [showProximosPartidos, setShowProximosPartidos] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [awardsReadyVisibleMatchIds, setAwardsReadyVisibleMatchIds] = useState([]);
  const [awardsRingLoading, setAwardsRingLoading] = useState(false);
  const statusDropdownRef = useRef(null);
  const statusDropdownMenuRef = useRef(null);
  const activityLoadedRef = useRef(false);
  const activeMatchesRefreshInFlightRef = useRef(false);
  const activeMatchesSignatureRef = useRef(buildActiveMatchesSignature([]));

  const awardsCandidateNotifs = useMemo(() => {
    const nowTs = Date.now();
    return (notifications || [])
      .filter((n) => isAwardsRingNotificationType(n?.type))
      .filter((n) => {
        const createdTs = n?.created_at ? new Date(n.created_at).getTime() : 0;
        return createdTs > 0 && (nowTs - createdTs) <= AWARDS_RING_WINDOW_MS;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [notifications]);
  const directAwardsRingMatchIds = useMemo(
    () => getDirectAwardsRingMatchIds(awardsCandidateNotifs),
    [awardsCandidateNotifs],
  );
  const awardsValidationMatchIds = useMemo(() => Array.from(new Set(
    awardsCandidateNotifs
      .filter((notification) => !isDirectAwardsRingNotificationType(notification?.type))
      .map((notification) => resolveNotificationMatchId(notification))
      .filter((matchId) => matchId !== null && matchId !== undefined)
      .map((matchId) => String(matchId).trim())
      .filter(Boolean),
  )), [awardsCandidateNotifs]);
  const awardsCandidateMatchIdsKey = [
    directAwardsRingMatchIds.join(','),
    awardsValidationMatchIds.join(','),
  ].join('::');
  const awardsStoryNotifs = useMemo(() => {
    const awardsReadyVisibleMatchIdSet = new Set((awardsReadyVisibleMatchIds || []).map((id) => String(id)));
    return awardsCandidateNotifs.filter((notif) => {
      const matchId = resolveNotificationMatchId(notif);
      if (!matchId) return false;
      return awardsReadyVisibleMatchIdSet.has(String(matchId));
    });
  }, [awardsCandidateNotifs, awardsReadyVisibleMatchIds]);
  const hasAwardsStoryPending = awardsStoryNotifs.some((n) => !n.read);
  const hasAwardsStoryViewed = !hasAwardsStoryPending && awardsStoryNotifs.some((n) => n.read);
  const awardsReadyAndVisible = awardsStoryNotifs.length > 0;
  const shouldShowAwardsRing = !awardsRingLoading && awardsReadyAndVisible;

  const openAwardsStoryFromNotification = async (notif) => {
    const matchId = resolveNotificationMatchId(notif);
    if (!matchId) return false;
    const resultsUrl = notif?.data?.resultsUrl || `/resultados-encuesta/${matchId}`;
    await openNotification({
      ...notif,
      type: notif?.type || 'awards_ready',
      partido_id: notif?.partido_id || matchId,
      data: {
        ...(notif?.data || {}),
        resultsUrl,
        match_id: notif?.data?.match_id || String(matchId),
      },
    }, navigate, {
      supabaseClient: supabase,
      onActionBlocked: (blocked) => {
        if (blocked?.message) {
          notifyBlockingError(blocked.message, { title: blocked.title });
        }
      },
      onResultsUnavailable: (notice) => {
        if (notice?.message) {
          notifyBlockingError(notice.message, { title: notice.title });
        }
      },
    });
    return true;
  };

  const handleAvatarClick = async (e) => {
    e.stopPropagation();
    if (shouldShowAwardsRing) {
      const latestPending = awardsStoryNotifs.find((n) => !n.read);
      const latestViewed = awardsStoryNotifs.find((n) => n.read);
      if (latestPending && await openAwardsStoryFromNotification(latestPending)) return;
      if (latestViewed && await openAwardsStoryFromNotification(latestViewed)) return;
    }
    toggleStatusDropdown(e);
  };

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

  useEffect(() => {
    if (!location?.state?.openProximosPartidos) return;
    setShowProximosPartidos(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    activityLoadedRef.current = false;
    activeMatchesSignatureRef.current = buildActiveMatchesSignature([]);

    if (!user?.id) {
      setActiveMatches([]);
      setActivityItems([]);
      setDismissedActivityIds(new Set());
      setActivityLoading(false);
      return;
    }

    const dismissedIds = readRecentActivityDismissedIds(user.id);
    setDismissedActivityIds(dismissedIds);

    const snapshot = readHomeSnapshot(user.id);
    if (!snapshot) {
      setActiveMatches([]);
      setActivityItems([]);
      setActivityLoading(true);
      return;
    }

    activeMatchesSignatureRef.current = buildActiveMatchesSignature(snapshot.activeMatches);
    setActiveMatches(snapshot.activeMatches);
    setActivityItems(filterDismissedActivityItems(snapshot.activityItems, dismissedIds));
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

  useEffect(() => {
    let cancelled = false;

    const validateAwardsRing = async () => {
      if (!user?.id) {
        setAwardsReadyVisibleMatchIds([]);
        setAwardsRingLoading(false);
        return;
      }

      const trustedMatchIds = directAwardsRingMatchIds;
      const candidateMatchIds = awardsValidationMatchIds;

      if (trustedMatchIds.length === 0 && candidateMatchIds.length === 0) {
        setAwardsReadyVisibleMatchIds([]);
        setAwardsRingLoading(false);
        return;
      }

      const normalizedNumericIds = candidateMatchIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));

      if (normalizedNumericIds.length === 0) {
        setAwardsReadyVisibleMatchIds(trustedMatchIds);
        setAwardsRingLoading(false);
        return;
      }

      setAwardsRingLoading(true);
      setAwardsReadyVisibleMatchIds([]);

      try {
        const { data: surveyResultsRows, error: surveyResultsError } = await supabase
          .from('survey_results')
          .select('*')
          .in('partido_id', normalizedNumericIds);

        if (surveyResultsError) throw surveyResultsError;

        const { data: rosterRows, error: rosterError } = await supabase
          .from('jugadores')
          .select('partido_id, id, uuid, usuario_id')
          .in('partido_id', normalizedNumericIds);

        if (rosterError) throw rosterError;

        const rosterByMatchId = new Map();
        (rosterRows || []).forEach((player) => {
          const key = String(player?.partido_id ?? '');
          if (!key) return;
          const list = rosterByMatchId.get(key) || [];
          list.push(player);
          rosterByMatchId.set(key, list);
        });

        const readyMatchIds = (surveyResultsRows || [])
          .filter((row) => isAwardsReadyAndVisible(row))
          .filter((row) => hasRenderableWinnerInRoster(row, rosterByMatchId.get(String(row.partido_id)) || []))
          .map((row) => String(row.partido_id));

        if (!cancelled) {
          setAwardsReadyVisibleMatchIds(Array.from(new Set([
            ...trustedMatchIds,
            ...readyMatchIds,
          ])));
        }
      } catch (error) {
        logger.warn('[AWARDS_RING] Could not validate awards visibility:', error);
        if (!cancelled) {
          setAwardsReadyVisibleMatchIds(trustedMatchIds);
        }
      } finally {
        if (!cancelled) {
          setAwardsRingLoading(false);
        }
      }
    };

    validateAwardsRing();

    return () => {
      cancelled = true;
    };
  }, [user?.id, awardsCandidateMatchIdsKey]);

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
    },
    {
      enabled: Boolean(user?.id),
    },
  );

  const getInitial = () => {
    if (profile?.avatar_url) return null;
    return profile?.nombre?.charAt(0) || user?.email?.charAt(0) || '?';
  };

  const userName = profile?.nombre || user?.email?.split('@')[0] || 'Usuario';
  const truncatedName = userName.length > 15 ? `${userName.substring(0, 15)}...` : userName;
  const isAvailable = profile?.acepta_invitaciones !== false;

  const toggleStatusDropdown = (e) => {
    e.stopPropagation();
    setShowStatusDropdown(!showStatusDropdown);
  };

  const handleNotificationsClick = () => {
    navigate('/notifications');
    setShowStatusDropdown(false);
  };

  const updateAvailabilityStatus = async (status) => {
    if (!user) return;

    try {
      if ((profile?.acepta_invitaciones !== false) === status) {
        setShowStatusDropdown(false);
        return;
      }

      await updateProfile(user.id, { acepta_invitaciones: status });

      if (status) {
        try {
          await addFreePlayer();
        } catch (syncError) {
          const message = String(syncError?.message || '');
          if (!/ya est[aá]s anotado como disponible/i.test(message)) {
            throw syncError;
          }
        }
      } else {
        await removeFreePlayer();
      }

      await refreshProfile();
      setShowStatusDropdown(false);
    } catch (error) {
      logger.error('Error updating availability status:', error);
    }
  };

  useEffect(() => {
    if (!showStatusDropdown) return undefined;

    const handlePointerDownOutside = (event) => {
      const target = event.target;
      const clickedTrigger = statusDropdownRef.current?.contains(target);
      const clickedMenu = statusDropdownMenuRef.current?.contains(target);

      if (clickedTrigger || clickedMenu) return;
      setShowStatusDropdown(false);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setShowStatusDropdown(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('touchstart', handlePointerDownOutside, { passive: true });
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('touchstart', handlePointerDownOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showStatusDropdown]);

  useEffect(() => {
    let cancelled = false;

    const loadActivity = async () => {
      if (!user?.id) {
        if (!cancelled) {
          setActivityItems([]);
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
        setActivityItems(filterDismissedActivityItems(items, dismissedActivityIds));
        activityLoadedRef.current = true;
        setActivityLoading(false);
      }
    };

    loadActivity();

    return () => {
      cancelled = true;
    };
  }, [activeMatches, dismissedActivityIds, notifications, user?.id]);

  const handleDismissActivityItem = useCallback((itemId) => {
    const normalizedItemId = normalizeActivityDismissId(itemId);
    if (!normalizedItemId || !user?.id) return;

    setDismissedActivityIds((current) => {
      const next = new Set(current);
      next.add(normalizedItemId);
      writeRecentActivityDismissedIds(user.id, next);
      return next;
    });
    setActivityItems((current) => filterDismissedActivityItems(current, new Set([normalizedItemId])));
  }, [user?.id]);

  // Mostrar ProximosPartidos si está activo
  if (showProximosPartidos) {
    return (
      <ProximosPartidos
        onClose={() => setShowProximosPartidos(false)}
      />
    );
  }

  // Quick-access rail items — same 4 destinations/behaviours as the old 2x2 grid.
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
  ];

  return (
    <div className="w-full bg-transparent shadow-none flex-1 flex flex-col min-h-0 overflow-hidden">
      <HomeWelcomeCard />

      {/* Header elements - Avatar and Notifications */}
      {user && (
        <div className="relative left-1/2 right-1/2 ml-[-50vw] mr-[-50vw] w-screen mb-3 px-4 py-3 bg-[#120e28]/92 border-y border-[rgba(148,134,255,0.14)] rounded-none ui-flat shadow-[0_10px_28px_rgba(5,3,16,0.4)] after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-[linear-gradient(90deg,transparent_8%,rgba(139,92,255,0.5)_42%,rgba(236,0,125,0.35)_66%,transparent_92%)]">
          <div className="w-full max-w-[920px] mx-auto flex items-center justify-between">
            <div className="flex flex-row items-center justify-center cursor-pointer relative z-[10000]" ref={statusDropdownRef}>
            <div className="relative mr-4" onClick={handleAvatarClick}>
              {/* "Historias" ring: pending = violet->blue gradient, viewed = muted gray. */}
              <div
                className={[
                  'rounded-full',
                  shouldShowAwardsRing ? 'p-[2px]' : 'p-0',
                  hasAwardsStoryPending
                    ? 'bg-gradient-to-r from-[#ff2f5b] via-[#ff5f3a] to-[#ff9800] shadow-[0_0_0_2px_rgba(255,255,255,0.10),0_0_16px_rgba(255,111,53,0.30)]'
                    : shouldShowAwardsRing && hasAwardsStoryViewed
                      ? 'bg-white/25'
                      : 'bg-transparent',
                ].join(' ')}
              >
                <div className="w-10 h-10 rounded-full overflow-hidden bg-[#1d1740] ring-1 ring-[rgba(148,134,255,0.4)] flex items-center justify-center text-white font-bold text-base">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div>
                      {getInitial()}
                    </div>
                  )}
                </div>
              </div>
              <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#120e28] ${isAvailable ? 'bg-[#4CAF50]' : 'bg-[#F44336]'}`}></div>
            </div>

            <div className="flex flex-col" onClick={toggleStatusDropdown}>
              <div className="text-[10px] font-sans font-bold uppercase tracking-[0.16em] text-[#b0a0ff]/80 leading-none">Hola</div>
              <div className="flex items-center gap-2 mt-1">
                <div className="text-white font-oswald text-lg font-bold leading-tight tracking-[0.01em]">{truncatedName}</div>
              </div>
            </div>

            {showStatusDropdown && createPortal(
              <div
                ref={statusDropdownMenuRef}
                className="fixed top-20 left-4 rounded-2xl w-[300px] z-[2147483647] overflow-hidden border border-[rgba(148,134,255,0.3)] bg-[radial-gradient(280px_140px_at_18%_-20%,rgba(139,92,255,0.22),transparent_70%),linear-gradient(168deg,rgba(38,30,80,0.98),rgba(16,12,33,0.99))] shadow-[0_24px_64px_rgba(5,3,16,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] origin-top-left animate-[dropdownSlideIn_0.26s_cubic-bezier(0.16,1,0.3,1)]"
              >
                <div className="relative px-4 pt-3.5 pb-3 border-b border-white/[0.07]">
                  <div className="font-sans font-bold text-[#b0a0ff]/85 uppercase tracking-[0.16em] text-[10.5px]">Tu estado</div>
                  <div className="font-oswald text-white text-[17px] font-bold leading-tight mt-0.5">Disponibilidad</div>
                  <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent_6%,rgba(139,92,255,0.55)_40%,rgba(236,0,125,0.35)_68%,transparent_94%)]" />
                </div>
                <div className="p-2.5 space-y-2">
                  {[
                    {
                      value: true,
                      label: 'Disponible',
                      detail: 'Te mostramos como jugador activo y te avisamos de partidos cerca.',
                      dotClass: 'bg-[#4ade80] shadow-[0_0_8px_rgba(74,222,128,0.7)]',
                    },
                    {
                      value: false,
                      label: 'No disponible',
                      detail: 'Pausamos tu visibilidad y dejamos de enviarte avisos de partidos cercanos.',
                      dotClass: 'bg-[#f87171] shadow-[0_0_8px_rgba(248,113,113,0.6)]',
                    },
                  ].map((option, optionIndex) => {
                    const isActive = isAvailable === option.value;
                    return (
                      <button
                        key={option.label}
                        className={`group/opt w-full text-left flex items-start gap-3 px-3.5 py-3 rounded-xl cursor-pointer transition-[background-color,border-color,box-shadow,transform] duration-200 text-white/95 border active:scale-[0.985] animate-[dropdownItemIn_0.3s_cubic-bezier(0.16,1,0.3,1)_both] ${
                          isActive
                            ? 'bg-[linear-gradient(135deg,#7d52ff_0%,#6a43ff_60%,#5832e6_100%)] border-[#8d6bff] shadow-[0_6px_18px_rgba(106,67,255,0.38),inset_0_1px_0_rgba(255,255,255,0.22)]'
                            : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07] hover:border-white/20'
                        }`}
                        style={{ animationDelay: `${40 + optionIndex * 45}ms` }}
                        onClick={() => updateAvailabilityStatus(option.value)}
                        type="button"
                      >
                        <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${option.dotClass}`} />
                        <span className="min-w-0 flex-1 block">
                          <span className="font-oswald text-base leading-none block">{option.label}</span>
                          <span className={`font-sans text-[12px] leading-[1.35] mt-1 block ${isActive ? 'text-white/85' : 'text-white/55'}`}>
                            {option.detail}
                          </span>
                        </span>
                        <span
                          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                            isActive
                              ? 'bg-white/25 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                              : 'bg-transparent text-transparent border border-white/15'
                          }`}
                        >
                          <Check size={12} strokeWidth={3} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body,
            )}
            <style>{`
              @keyframes dropdownSlideIn {
                from { opacity: 0; transform: translateY(-12px) scale(0.92); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
              @keyframes dropdownItemIn {
                from { opacity: 0; transform: translateY(-6px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>
            </div>

            <div className="flex items-center justify-end">
              <NotificationsBell
                unreadCount={unreadCount}
                onClick={handleNotificationsClick}
              />
            </div>
          </div>
        </div>
      )}

      <h3 className="section-title" style={{ marginBottom: 14 }}>Accesos rápidos</h3>

      <QuickAccessRail items={quickAccessItems} />

      {/* Recent Activity */}
      {/* Top spacing comes from the grid's mb-7; flex items don't collapse margins */}
      <section className="mb-2 flex-1 flex flex-col min-h-0">
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
            ) : activityItems.length > 0 ? (
              <div
                className="home-activity-scroll min-h-0 flex-1 overflow-y-auto custom-scrollbar pb-7"
                data-home-activity-scroll="true"
              >
                {activityItems.map((item, index) => {
                  const Icon = activityIconMap[item.icon] || Bell;
                  const iconColorClass = severityIconClass[item.severity] || severityIconClass.neutral;
                  const subtitleParts = [item.subtitle];
                  if (item.count > 1) subtitleParts.push(`x${item.count}`);
                  const subtitleText = subtitleParts.filter(Boolean).join(' · ');
                  const canNavigate = Boolean(item.route);

                  return (
                    <SwipeDismissActivityItem
                      key={item.id}
                      item={item}
                      index={index}
                      isLast={index >= activityItems.length - 1}
                      icon={Icon}
                      iconColorClass={iconColorClass}
                      subtitleText={subtitleText}
                      canNavigate={canNavigate}
                      onDismiss={handleDismissActivityItem}
                      onNavigate={handleActivityItemClick}
                      onPrefetch={prefetchRoute}
                    />
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
          {!activityLoading && activityItems.length > 0 && (
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
