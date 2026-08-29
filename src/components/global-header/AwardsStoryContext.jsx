import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthProvider';
import { useNotifications } from '../../context/NotificationContext';
import { supabase } from '../../supabase';
import { AWARDS_READY_NOTIFICATION_TYPES, isAwardsReadyStatus } from '../../utils/awardsReadiness';
import { notifyBlockingError } from '../../utils/notifyBlockingError';

const AWARDS_RING_WINDOW_MS = 24 * 60 * 60 * 1000;
const normalizeNotificationType = (value) => String(value || '').trim().toLowerCase();

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

const extractWinnerIds = (row) => {
  const awards = row?.awards || {};
  return [
    row?.mvp ?? awards?.mvp?.player_id ?? null,
    row?.golden_glove ?? awards?.best_gk?.player_id ?? null,
    row?.dirty_player
      ?? (Array.isArray(row?.red_cards) ? row.red_cards[0] : null)
      ?? awards?.red_card?.player_id
      ?? null,
  ].filter((id) => id !== null && id !== undefined && String(id).trim() !== '');
};

const hasRenderableWinnerInRoster = (row, roster = []) => {
  const winnerIds = extractWinnerIds(row);
  if (winnerIds.length === 0 || !Array.isArray(roster) || roster.length === 0) return false;
  return winnerIds.some((winnerId) => roster.some((player) => (
    [player?.uuid, player?.usuario_id, player?.id]
      .filter((value) => value !== null && value !== undefined)
      .some((value) => String(value).toLowerCase() === String(winnerId).toLowerCase())
  )));
};

const EMPTY_AWARDS_STORY = Object.freeze({
  awardsReadyVisibleMatchIds: [],
  loading: false,
  hasStory: false,
  hasPendingStory: false,
  hasViewedStory: false,
  openLatestStory: async () => false,
});

const AwardsStoryContext = createContext(EMPTY_AWARDS_STORY);

export function AwardsStoryProvider({ children }) {
  const { user } = useAuth();
  const notificationsContext = useNotifications() || {};
  const notifications = notificationsContext.notifications || [];
  const navigate = useNavigate();
  const [awardsReadyVisibleMatchIds, setAwardsReadyVisibleMatchIds] = useState([]);
  const [loading, setLoading] = useState(false);

  const candidates = useMemo(() => {
    const now = Date.now();
    return notifications
      .filter((notification) => isAwardsRingNotificationType(notification?.type))
      .filter((notification) => {
        const createdAt = notification?.created_at
          ? new Date(notification.created_at).getTime()
          : 0;
        return createdAt > 0 && now - createdAt <= AWARDS_RING_WINDOW_MS;
      })
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  }, [notifications]);

  const directMatchIds = useMemo(() => getDirectAwardsRingMatchIds(candidates), [candidates]);
  const validationMatchIds = useMemo(() => Array.from(new Set(
    candidates
      .filter((notification) => !isDirectAwardsRingNotificationType(notification?.type))
      .map(resolveNotificationMatchId)
      .filter((matchId) => matchId !== null && matchId !== undefined)
      .map((matchId) => String(matchId).trim())
      .filter(Boolean),
  )), [candidates]);
  const validationKey = `${directMatchIds.join(',')}::${validationMatchIds.join(',')}`;

  useEffect(() => {
    let cancelled = false;
    const validate = async () => {
      if (!user?.id || (directMatchIds.length === 0 && validationMatchIds.length === 0)) {
        setAwardsReadyVisibleMatchIds([]);
        setLoading(false);
        return;
      }

      const numericIds = Array.from(new Set([...directMatchIds, ...validationMatchIds]))
        .map(Number)
        .filter((id) => Number.isFinite(id));
      if (numericIds.length === 0) {
        setAwardsReadyVisibleMatchIds(directMatchIds);
        setLoading(false);
        return;
      }

      setLoading(true);
      setAwardsReadyVisibleMatchIds([]);
      try {
        const [{ data: results, error: resultsError }, { data: roster, error: rosterError }] = await Promise.all([
          supabase.from('survey_results').select('*').in('partido_id', numericIds),
          supabase.from('jugadores').select('partido_id, id, uuid, usuario_id').in('partido_id', numericIds),
        ]);
        if (resultsError) throw resultsError;
        if (rosterError) throw rosterError;

        const rosterByMatch = new Map();
        (roster || []).forEach((player) => {
          const key = String(player?.partido_id ?? '');
          if (!key) return;
          rosterByMatch.set(key, [...(rosterByMatch.get(key) || []), player]);
        });
        const readyIds = (results || [])
          .filter((row) => isAwardsReadyStatus(row) && row?.results_ready === true)
          .filter((row) => hasRenderableWinnerInRoster(row, rosterByMatch.get(String(row.partido_id)) || []))
          .map((row) => String(row.partido_id));
        if (!cancelled) setAwardsReadyVisibleMatchIds(Array.from(new Set(readyIds)));
      } catch {
        if (!cancelled) setAwardsReadyVisibleMatchIds(directMatchIds);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    validate();
    return () => { cancelled = true; };
  // validationKey intentionally captures the normalized notification identity set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, validationKey]);

  const visibleStories = useMemo(() => {
    const readyIds = new Set(awardsReadyVisibleMatchIds.map(String));
    return candidates.filter((notification) => readyIds.has(String(resolveNotificationMatchId(notification))));
  }, [awardsReadyVisibleMatchIds, candidates]);
  const hasPendingStory = visibleStories.some((notification) => !notification.read);
  const hasViewedStory = !hasPendingStory && visibleStories.some((notification) => notification.read);

  const openLatestStory = useCallback(async () => {
    const notification = visibleStories.find((item) => !item.read) || visibleStories[0];
    const matchId = resolveNotificationMatchId(notification);
    if (!notification || !matchId) return false;
    // Load the notification router only when the user explicitly opens a story.
    // Besides reducing shell startup coupling, this keeps Torneos free from
    // personal-notification side effects while its provider remains unmounted.
    const { openNotification } = await import('../../utils/notificationRouter');
    await openNotification({
      ...notification,
      type: notification.type || 'awards_ready',
      partido_id: notification.partido_id || matchId,
      data: {
        ...(notification.data || {}),
        resultsUrl: notification.data?.resultsUrl || `/resultados-encuesta/${matchId}`,
        match_id: notification.data?.match_id || String(matchId),
      },
    }, navigate, {
      supabaseClient: supabase,
      onActionBlocked: (notice) => notice?.message && notifyBlockingError(notice.message, { title: notice.title }),
      onResultsUnavailable: (notice) => notice?.message && notifyBlockingError(notice.message, { title: notice.title }),
    });
    return true;
  }, [navigate, visibleStories]);

  const value = useMemo(() => ({
    awardsReadyVisibleMatchIds,
    loading,
    hasStory: !loading && visibleStories.length > 0,
    hasPendingStory,
    hasViewedStory,
    openLatestStory,
  }), [
    awardsReadyVisibleMatchIds,
    hasPendingStory,
    hasViewedStory,
    loading,
    openLatestStory,
    visibleStories.length,
  ]);

  return <AwardsStoryContext.Provider value={value}>{children}</AwardsStoryContext.Provider>;
}

export function useAwardsStory() {
  return useContext(AwardsStoryContext);
}
