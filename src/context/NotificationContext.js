import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabase';
import { handleError } from '../lib/errorHandler';
import { useInterval } from '../hooks/useInterval';
import { logger } from '../lib/logger';
import { subscribeToNotifications } from '../services/realtimeService';
import { getSurveyReminderMessage, getSurveyResultsReadyMessage, getSurveyStartMessage } from '../utils/surveyNotificationCopy';
import { applyMatchNameQuotes, quoteMatchName, resolveNotificationMatchName } from '../utils/notificationText';

const NotificationContext = createContext();
const DEBUG_NOTIFICATIONS = process.env.NODE_ENV !== 'production';

/**
 * Hook to access notification context
 * Provides notifications state, unread counts, and notification management functions
 * @returns {Object} Notification context value
 */
export const useNotifications = () => useContext(NotificationContext);
// Rebuild trace

/**
 * Notification provider component
 * Manages real-time notifications, unread counts, and notification state
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  // Notifications that are scheduled for the future (send_at > now)
  const [scheduledNotifications, setScheduledNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState({
    friends: 0,
    matches: 0,
    total: 0,
  });
  const [currentUserId, setCurrentUserId] = useState(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [lastFetchCount, setLastFetchCount] = useState(null);
  const [lastRealtimeAt, setLastRealtimeAt] = useState(null);
  const [lastRealtimePayloadType, setLastRealtimePayloadType] = useState(null);
  const { setIntervalSafe } = useInterval();
  const resolveNotificationMatchId = useCallback((notification) => {
    if (!notification) return null;
    const data = notification.data || {};
    const candidate = (
      notification.partido_id
      ?? notification.match_ref
      ?? data.partido_id
      ?? data.partidoId
      ?? data.match_id
      ?? data.matchId
      ?? data.match_ref
      ?? null
    );

    if (candidate !== null && candidate !== undefined && String(candidate).trim() !== '') {
      return String(candidate);
    }

    const link = data.link || data.resultsUrl || '';
    const match = String(link).match(/\/(?:encuesta|resultados-encuesta)\/(\d+)/);
    return match?.[1] || null;
  }, []);
  // Umbral para ignorar eventos realtime con created_at <= al último clear
  const ignoreBeforeRef = useRef(null);

  useEffect(() => {
    if (DEBUG_NOTIFICATIONS) {
      console.log('[NOTIFICATIONS] NotificationProvider mounted');
    }
  }, []);

  // Get current user on mount
  useEffect(() => {
    const getCurrentUser = async () => {
      logger.log('[NOTIFICATIONS] Getting current user...');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) {
        logger.error('[NOTIFICATIONS] Error getting current user:', error);
        return;
      }
      if (user) {
        logger.log('[NOTIFICATIONS] Current user found:', user.id);
        console.log('[NOTIFICATIONS] Current user id (supabase.auth.getUser):', user.id);
        setCurrentUserId(user.id);
      } else {
        logger.log('[NOTIFICATIONS] No authenticated user found');
      }
    };

    getCurrentUser();
  }, []);

  // Listen for auth state changes and keep currentUserId in sync
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (DEBUG_NOTIFICATIONS) {
        console.log('[NOTIFICATIONS] onAuthStateChange', _event, session?.user?.id || null);
      }
      setCurrentUserId(session?.user?.id || null);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // Fetch notifications from Supabase
  useEffect(() => {
    if (!currentUserId) return;

    logger.log('[NOTIFICATIONS] Setting up for user:', currentUserId);
    console.log('[NOTIFICATIONS] Setting up NotificationContext for user:', currentUserId);

    // Initial fetch of notifications
    fetchNotifications();

    // Lightweight refresh system (Fallback)
    const REFRESH_MS = 300000; // 5 minutes
    let lastRefresh = 0;
    let refreshRunning = false;

    const refresh = async () => {
      if (refreshRunning) return; // Anti-overlap guard
      const now = Date.now();
      if (now - lastRefresh < 5000) return; // Debounce: 5s minimum between refreshes
      lastRefresh = now;
      refreshRunning = true;
      try {
        await fetchNotifications();
      } catch (e) {
        logger.warn('[NOTIFICATIONS] Refresh failed:', e);
      } finally {
        refreshRunning = false;
      }
    };

    const onFocus = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    // Set up refresh mechanisms
    setIntervalSafe(refresh, REFRESH_MS);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Subscribe to real-time notifications via Service
    const unsubscribe = subscribeToNotifications(currentUserId, (payload) => {
      console.debug('[RT] Notifications payload:', payload);

      if (payload.new) {
        setLastRealtimeAt(new Date().toISOString());
        setLastRealtimePayloadType(payload.new.type || null);
        handleNewNotification(payload.new);
      } else if (payload.eventType === 'UPDATE') {
        // Handle updates (e.g. read status changed elsewhere)
        // Ideally we update the specific item in state
        console.log('[NOTIFICATIONS] Update received:', payload.new);
        setNotifications((prev) =>
          prev.map((n) => (n.id === payload.new.id ? { ...n, ...payload.new } : n)),
        );
      }
    });

    return () => {
      logger.log('[NOTIFICATIONS] Cleaning up subscription and refresh listeners');

      // Clean up refresh mechanisms
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      unsubscribe();
    };
  }, [currentUserId, resolveNotificationMatchId]);

  // Fetch all notifications for the current user
  const fetchNotifications = useCallback(async () => {
    if (!currentUserId) {
      logger.log('[NOTIFICATIONS] fetchNotifications: No currentUserId, skipping');
      return;
    }

    logger.log('[NOTIFICATIONS] Fetching notifications for user:', currentUserId);
    if (DEBUG_NOTIFICATIONS) {
      console.log('[NOTIFICATIONS] fetchNotifications START for user:', currentUserId);
    }
    try {
      // Only fetch notifications from the last 5 days to keep the UI light
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const cutoffISO = fiveDaysAgo.toISOString();
      if (DEBUG_NOTIFICATIONS) {
        console.log('[NOTIFICATIONS] fetch cutoffISO:', cutoffISO);
      }

      let data;
      try {
        const res = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', currentUserId)
          .gte('created_at', cutoffISO)
          .order('send_at', { ascending: false });
        data = res.data;
        if (res.error) {
          if (DEBUG_NOTIFICATIONS) {
            console.log('[NOTIFICATIONS] fetch error from supabase:', res.error?.message, res.error?.details || null);
          }
          throw res.error;
        }
      } catch (selectErr) {
        if (DEBUG_NOTIFICATIONS) {
          console.log('[NOTIFICATIONS] Exception during supabase select:', selectErr);
        }
        throw selectErr;
      }

      setLastFetchAt(new Date().toISOString());
      setLastFetchCount((data && data.length) || 0);
      if (DEBUG_NOTIFICATIONS) {
        console.log('[NOTIFICATIONS] fetchNotifications RESULT count:', (data && data.length) || 0);
      }
      if (!data || data.length === 0) {
        if (DEBUG_NOTIFICATIONS) {
          console.log('[NOTIFICATIONS] fetchNotifications empty result for user:', currentUserId, 'cutoffISO:', cutoffISO);
        }
      }

      logger.log('[NOTIFICATIONS] Fetched notifications (total):', data?.length || 0);

      // Split visible vs scheduled based on send_at
      const now = Date.now();
      const visibleRaw = [];
      const scheduledRaw = [];
      for (const n of data) {
        try {
          const sendAt = n.send_at ? new Date(n.send_at).getTime() : null;
          if (!sendAt || sendAt <= now) visibleRaw.push(n);
          else scheduledRaw.push(n);
        } catch (e) {
          // If parsing fails, treat as visible to avoid hiding notifications
          visibleRaw.push(n);
        }
      }

      logger.log('[NOTIFICATIONS] Visible fetched:', visibleRaw.length, 'Scheduled fetched:', scheduledRaw.length);

      // Deduplicate only the visible notifications for display
      const dedupedVisible = dedupeNotificationsForDisplay(visibleRaw);

      setNotifications(dedupedVisible);
      setScheduledNotifications(scheduledRaw);
      updateUnreadCount(dedupedVisible);
    } catch (error) {
      if (DEBUG_NOTIFICATIONS) {
        console.log('[NOTIFICATIONS] fetchNotifications CATCH error:', error);
      }
      handleError(error, { showToast: false, onError: () => { } });
    }
  }, [currentUserId]);

  // Deduplicate notifications per user+partido, preferring survey-related types
  const dedupeNotificationsForDisplay = (notifs = []) => {
    // Ensure awards_ready is considered a survey-related notification and gets proper priority
    const preferredOrder = [
      'survey_finished',
      'survey_results_ready',
      'awards_ready',
      'survey_start',
      'post_match_survey',
      'survey_reminder',
      'call_to_vote',
    ];
    const keepMap = new Map(); // key -> notification for partido-linked
    const othersMap = new Map(); // key -> notification for non-partido notifications (group by type+title+message)

    for (const n of notifs) {
      const pid = resolveNotificationMatchId(n);
      if (pid === null || pid === undefined) {
        // group generic notifications by type+title+message to avoid duplicate cards
        const compKey = `${n.type}::${(n.title || '').trim()}::${(n.message || '').trim()}`;
        const existingOther = othersMap.get(compKey);
        if (!existingOther) {
          othersMap.set(compKey, n);
          continue;
        }
        // keep the newest
        if (new Date(n.created_at) > new Date(existingOther.created_at)) {
          othersMap.set(compKey, n);
        }
        continue;
      }

      const surveyGroup = (
        n.type === 'survey_start' || n.type === 'post_match_survey'
          ? 'survey_open'
          : n.type === 'survey_reminder'
            ? 'survey_reminder'
            : String(n.type || 'default')
      );
      const key = `${n.user_id}::${String(pid)}::${surveyGroup}`;
      const existing = keepMap.get(key);
      if (!existing) {
        keepMap.set(key, n);
        continue;
      }

      const eIdx = preferredOrder.indexOf(existing.type);
      const nIdx = preferredOrder.indexOf(n.type);

      if (nIdx === -1 && eIdx === -1) {
        // neither in preferred list => keep newest
        if (new Date(n.created_at) > new Date(existing.created_at)) {
          keepMap.set(key, n);
        }
      } else if (nIdx === -1) {
        // existing has priority - do nothing
      } else if (eIdx === -1) {
        // new has priority
        keepMap.set(key, n);
      } else {
        // both have priority positions, smaller index = higher priority
        if (nIdx < eIdx) {
          keepMap.set(key, n);
        } else if (nIdx === eIdx) {
          // same priority type => newest
          if (new Date(n.created_at) > new Date(existing.created_at)) {
            keepMap.set(key, n);
          }
        }
      }
    }

    // If there's a survey-related notification for a partido, we should suppress lower-priority
    // notifications (like 'call_to_vote') that reference the same partido even if they were stored
    // as non-partido grouped notifications. Build a set of partido ids that have survey notifications.
    const surveyTypes = new Set(['survey_start', 'post_match_survey', 'survey_reminder', 'survey_results_ready', 'awards_ready', 'survey_finished']);
    const surveyPartidoIds = new Set();
    for (const n of Array.from(keepMap.values())) {
      if (surveyTypes.has(n.type)) {
      const pid = resolveNotificationMatchId(n);
      if (pid !== null && pid !== undefined) surveyPartidoIds.add(String(pid));
      }
    }
    for (const n of Array.from(othersMap.values())) {
      if (surveyTypes.has(n.type)) {
      const pid = resolveNotificationMatchId(n);
      if (pid !== null && pid !== undefined) surveyPartidoIds.add(String(pid));
      }
    }

    // Build result: non-partido grouped notifications first, then deduped partido notifications
    const nonPartido = Array.from(othersMap.values())
      .filter((n) => {
        // If this non-partido notification references a partido that already has a survey,
        // and this notification is a lower-priority type (call_to_vote), suppress it.
        const pid = resolveNotificationMatchId(n);
        if (pid !== null && pid !== undefined && surveyPartidoIds.has(String(pid)) && n.type === 'call_to_vote') {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.send_at || b.created_at).getTime() - new Date(a.send_at || a.created_at).getTime());
    const deduped = Array.from(keepMap.values()).sort((a, b) => new Date(b.send_at || b.created_at).getTime() - new Date(a.send_at || a.created_at).getTime());
    // Merge and sort globally by send_at (or created_at) so updated rows keep expected order
    const merged = [...nonPartido, ...deduped];
    merged.sort((a, b) => new Date(b.send_at || b.created_at).getTime() - new Date(a.send_at || a.created_at).getTime());
    return merged;
  };

  // Handle new notification
  const handleNewNotification = (notification) => {
    logger.log('[NOTIFICATIONS] New realtime notification:', {
      id: notification.id,
      type: notification.type,
      isForCurrentUser: notification.user_id === currentUserId,
    });

    // Verificar que la notificación es para el usuario actual
    if (notification.user_id !== currentUserId) {
      logger.warn('[NOTIFICATIONS] Notification not for current user, ignoring');
      return;
    }

    // If notification is scheduled for the future, keep it in scheduledNotifications and don't show it yet
    try {
      if (notification.send_at) {
        const sendAt = new Date(notification.send_at).getTime();
        if (!Number.isNaN(sendAt) && sendAt > Date.now()) {
          logger.log('[NOTIFICATIONS] Received scheduled notification, queuing for later:', notification.id, notification.type, notification.send_at);
          setScheduledNotifications((prev) => {
            if (prev.find((n) => n.id === notification.id)) return prev;
            return [notification, ...prev];
          });
          // Don't add to visible list or show toast yet
          return;
        }
      }
    } catch (e) {
      logger.warn('[NOTIFICATIONS] Error parsing send_at for new notification, proceeding to show it:', e);
    }

    // Ignorar eventos antiguos (realtime que llegó tarde) si son <= último clear
    try {
      if (ignoreBeforeRef.current) {
        const createdAt = new Date(notification.created_at).getTime();
        const ignoreBefore = new Date(ignoreBeforeRef.current).getTime();
        if (!Number.isNaN(createdAt) && !Number.isNaN(ignoreBefore) && createdAt <= ignoreBefore) {
          logger.log('[NOTIFICATIONS] Ignoring old notification');
          return;
        }
      }
    } catch (e) {
      logger.warn('[NOTIFICATIONS] Error comparing timestamps:', e);
    }

    // If the user is currently on the survey page for the same partido, or viewing the partido page,
    // don't insert the realtime notification. This prevents the survey UI from being reset by realtime inserts.
    try {
      const notifPid = notification.partido_id ?? (notification.data?.match_id ?? notification.data?.matchId ?? null);
      if (notifPid && typeof window !== 'undefined' && window.location && window.location.pathname) {
        const path = window.location.pathname;
        const search = window.location.search || '';

        // Common patterns used in the app:
        // - /encuesta/:id
        // - /partido/:id (survey might be embedded there)
        // - query ?codigo= (matchCode)

        const isOnEncuestaPath = path.includes('/encuesta') && path.includes(String(notifPid));
        const isOnPartidoPath = path.includes(`/partido/${String(notifPid)}`) || path.includes(`/partido/${String(notifPid)}/`);
        const isOnPartidoGeneric = path.includes('/partido/') && path.includes(String(notifPid));

        // also check query string for matchCode if provided in notification
        const matchCode = notification.data?.matchCode ?? notification.data?.match_code ?? null;
        const isOnQueryCodigo = matchCode && search.includes(`codigo=${matchCode}`);

        if (
          (isOnEncuestaPath || isOnPartidoPath || isOnPartidoGeneric || isOnQueryCodigo) &&
          notification.type !== 'awards_ready'
        ) {
          logger.log('[NOTIFICATIONS] Suppressing realtime notification while user is on survey/partido page for partido:', notifPid);
          return;
        }
      }
    } catch (e) {
      logger.warn('[NOTIFICATIONS] Error while checking current path for survey suppression:', e);
    }

    // Insert and dedupe using the same logic as fetch (to avoid duplicate cards)
    setNotifications((prev) => {
      logger.log('[NOTIFICATIONS] Current notifications count:', prev.length);
      // Evitar duplicados por id
      if (prev.find((n) => n.id === notification.id)) {
        logger.log('[NOTIFICATIONS] Notification already exists, skipping');
        return prev;
      }

      const updated = [notification, ...prev];

      try {
        const deduped = dedupeNotificationsForDisplay(updated);
        logger.log('[NOTIFICATIONS] Updated notifications count after dedupe:', deduped.length);
        updateUnreadCount(deduped);
        return deduped;
      } catch (e) {
        logger.error('[NOTIFICATIONS] Error during dedupe, falling back to raw list:', e);
        updateUnreadCount(updated);
        return updated;
      }
    });

    // Show toast notification for real-time updates
    showNotificationToast(notification);
    logger.log('[NOTIFICATIONS] Notification processed successfully');
  };

  // Show toast notification based on type
  const showNotificationToast = (notification) => {
    logger.log('[NOTIFICATIONS] Showing toast for:', notification.type);
    const matchName = resolveNotificationMatchName(notification, '');
    const toastTitle = applyMatchNameQuotes(notification?.title || 'Notificación', matchName);
    const toastMessage = applyMatchNameQuotes(notification?.message || '', matchName);

    /** @type {any} */
    const toastOptions = ({
      position: 'top-right',
      autoClose: 5000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
    });

    switch (notification.type) {
      case 'friend_request':
        console.info(`Nueva solicitud de amistad de ${notification.data?.senderName || 'alguien'}`, toastOptions);
        break;
      case 'match_invite':
        console.info(`${toastTitle}: ${toastMessage}`, toastOptions);
        break;
      case 'call_to_vote':
        console.info(`${toastTitle}: ${toastMessage}`, toastOptions);
        break;
      case 'survey_start':
      case 'post_match_survey': {
        const surveyMessage = getSurveyStartMessage({
          source: notification,
          matchName: quoteMatchName(resolveNotificationMatchName(notification, 'este partido'), 'este partido'),
        });
        console.info(`${notification.title || '¡Encuesta lista!'}: ${surveyMessage}`, toastOptions);
        break;
      }
      case 'survey_reminder': {
        const reminderMessage = getSurveyReminderMessage({
          source: notification,
          matchName: quoteMatchName(resolveNotificationMatchName(notification, 'este partido'), 'este partido'),
        });
        console.info(`Recordatorio de encuesta: ${reminderMessage}`, toastOptions);
        break;
      }
      case 'survey_results_ready':
        console.info(`Resultados de encuesta listos: ${getSurveyResultsReadyMessage({ matchName: quoteMatchName(resolveNotificationMatchName(notification, 'este partido'), 'este partido') })}`, toastOptions);
        break;
      case 'admin_transfer':
        console.info(`${toastTitle}: ${toastMessage}`, toastOptions);
        // Auto-refresh if forceRefresh is true
        if (notification.data?.forceRefresh) {
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
        break;
      default:
        // Keep less intrusive defaults; notification center remains source of truth.
        break;
    }
  };

  // Update unread count
  const updateUnreadCount = (notifs) => {
    const unread = notifs.filter((n) => !n.read);
    const friendRequests = unread.filter((n) => n.type === 'friend_request').length;
    const matchInvites = unread.filter((n) => n.type === 'match_invite').length;
    const matchJoinRequests = unread.filter((n) => n.type === 'match_join_request').length;
    const matchJoinApproved = unread.filter((n) => n.type === 'match_join_approved').length;
    const callToVote = unread.filter((n) => n.type === 'call_to_vote').length;
    const surveyStarts = unread.filter((n) => n.type === 'survey_start').length;
    const postMatchSurveys = unread.filter((n) => n.type === 'post_match_survey').length;
    const surveyResults = unread.filter((n) => n.type === 'survey_results_ready').length;
    const awardsReady = unread.filter((n) => n.type === 'awards_ready').length;
    const awardWon = unread.filter((n) => n.type === 'award_won').length;
    const surveyFinished = unread.filter((n) => n.type === 'survey_finished').length;
    const noShowPenalty = unread.filter((n) => n.type === 'no_show_penalty_applied').length;
    const noShowRecovery = unread.filter((n) => n.type === 'no_show_recovery_applied').length;

    setUnreadCount({
      friends: friendRequests,
      matches: matchInvites + matchJoinRequests + matchJoinApproved + callToVote + surveyStarts + postMatchSurveys + surveyResults + awardsReady + awardWon + surveyFinished + noShowPenalty + noShowRecovery,
      total: unread.length,
    });
  };

  // Mark notification as read
  const markAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      if (error) throw error;

      // Update local state
      setNotifications((prev) =>
        prev.map((n) => n.id === notificationId ? { ...n, read: true } : n),
      );

      // Update unread count
      const updatedNotifications = notifications.map((n) =>
        n.id === notificationId ? { ...n, read: true } : n,
      );
      updateUnreadCount(updatedNotifications);
    } catch (error) {
      handleError(error, { showToast: false, onError: () => { } });
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', currentUserId)
        .eq('read', false);

      if (error) throw error;

      // Update local state
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount({ friends: 0, matches: 0, total: 0 });
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
    }
  };

  // Mark notifications of a specific type as read
  const markTypeAsRead = async (type) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', currentUserId)
        .eq('type', type)
        .eq('read', false);

      if (error) throw error;

      // Update local state
      setNotifications((prev) =>
        prev.map((n) => n.type === type ? { ...n, read: true } : n),
      );

      // Update unread count
      const updatedNotifications = notifications.map((n) =>
        n.type === type ? { ...n, read: true } : n,
      );
      updateUnreadCount(updatedNotifications);
    } catch (error) {
      logger.error(`Error marking ${type} notifications as read:`, error);
    }
  };

  // Clear all notifications (local state update)
  const clearAllNotifications = () => {
    // Registrar el instante de limpieza para ignorar eventos realtime antiguos
    ignoreBeforeRef.current = new Date().toISOString();
    setNotifications([]);
    setScheduledNotifications([]);
    setUnreadCount({ friends: 0, matches: 0, total: 0 });
  };

  // Create a new notification (for testing or manual creation)
  const createNotification = async (type, title, message, data = {}, partidoId = null) => {
    if (!currentUserId) return { ok: false, error: { message: 'no_current_user' } };

    // --- CANONICAL MODE CHECK: prevent client creation of survey notifications when DB is canonical ---
    const SURVEY_FANOUT_MODE = process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE || 'db';
    if (SURVEY_FANOUT_MODE === 'db' && (type === 'survey_start' || type === 'post_match_survey')) {
      return { ok: false, error: { message: 'blocked_by_survey_fanout_mode' } };
    }

    try {
      const now = new Date().toISOString();
      const pidFromArg = partidoId != null ? Number(partidoId) : null;
      const pidFromData = data?.matchId ?? data?.match_id ?? data?.partido_id ?? data?.match_id_text ?? null;
      const pidNumber = pidFromArg != null ? (Number.isFinite(Number(pidFromArg)) ? Number(pidFromArg) : null) : (pidFromData != null ? (Number.isFinite(Number(pidFromData)) ? Number(pidFromData) : null) : null);

      // If this is a survey_start or post_match_survey we require a partido_id to avoid creating null-match rows
      if ((type === 'survey_start' || type === 'post_match_survey') && pidNumber == null) {
        console.error('[NOTIFICATIONS] Attempt to create survey_start/post_match_survey without partido_id. Aborting insert.', { type, data, partidoId });
        return { ok: false, error: { message: 'missing_partido_id_for_survey_notification' } };
      }

      const notification = {
        user_id: currentUserId,
        type,
        title,
        message,
        partido_id: pidNumber != null ? pidNumber : null,
        data: { ...data },
        send_at: data?.send_at ?? null,
        read: false,
        created_at: now,
      };

      console.log('[NOTIFICATIONS] createNotification called - currentUserId:', currentUserId);
      console.log('[NOTIFICATIONS] createNotification payload:', notification);

      // Log session user for extra diagnostics
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        console.log('[NOTIFICATIONS] session user:', sessionData?.session?.user?.id || null);
      } catch (sessErr) {
        console.log('[NOTIFICATIONS] getSession error:', sessErr);
      }

      // Attempt insert
      const res = await supabase
        .from('notifications')
        .insert([notification])
        .select()
        .single();

      if (res.error) {
        const errCode = String(res.error?.code || res.error?.message || '');
        console.log('[NOTIFICATIONS] createNotification insert error:', res.error);

        // If unique constraint violation (duplicate), perform an update for the existing row
        if (errCode === '23505') {
          try {
            const upd = await supabase
              .from('notifications')
              .update({ title, message, data: { ...data }, read: false, created_at: now, send_at: notification.send_at })
              .eq('user_id', currentUserId)
              .eq('partido_id', partidoId != null ? partidoId : null)
              .eq('type', type)
              .select()
              .single();

            if (upd.error) {
              console.log('[NOTIFICATIONS] createNotification update-after-duplicate error:', upd.error);
              return { ok: false, error: { code: upd.error.code, message: upd.error.message, details: upd.error.details, hint: upd.error.hint } };
            }

            const updatedRow = upd.data;
            try { await fetchNotifications(); } catch (e) { console.log('[NOTIFICATIONS] fetchNotifications after update failed:', e); }
            // Update local notifications array immediately to reflect the updated row (force re-render even if id unchanged)
            try {
              setNotifications((prev) => {
                const next = prev.map((n) => (n.id === updatedRow.id ? { ...n, ...updatedRow } : n));
                return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
              });
            } catch (stateErr) {
              console.log('[NOTIFICATIONS] Error updating local notifications after duplicate update:', stateErr);
            }
            return { ok: true, mode: 'updated', row: updatedRow };
          } catch (updateException) {
            console.log('[NOTIFICATIONS] exception during update-after-duplicate:', updateException);
            return { ok: false, error: { message: String(updateException) } };
          }
        }

        // Non-duplicate insert error: return structured error
        const errObj = {
          code: res.error?.code || null,
          message: res.error?.message || null,
          details: res.error?.details || null,
          hint: res.error?.hint || null,
        };
        console.log('[NOTIFICATIONS] createNotification insert failed with error:', errObj);
        return { ok: false, error: errObj };
      }

      // Successful insert
      const newNotification = res.data;

      // After successful insert, force a fetch to update UI
      try {
        await fetchNotifications();
      } catch (e) {
        console.log('[NOTIFICATIONS] fetchNotifications after createNotification failed:', e);
      }
      console.log('[NOTIFICATIONS] lastFetchCount after createNotification:', lastFetchCount);

      return { ok: true, mode: 'inserted', row: newNotification };
    } catch (error) {
      const errObj = {
        code: error?.code || null,
        message: error?.message || String(error),
        details: error?.details || null,
        hint: error?.hint || null,
      };
      console.log('[NOTIFICATIONS] createNotification unexpected error:', errObj);
      return { ok: false, error: errObj };
    }
  };

  const value = useMemo(() => ({
    notifications,
    scheduledNotifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    markTypeAsRead,
    createNotification,
    fetchNotifications,
    clearAllNotifications,
    // Debug fields
    currentUserId,
    subscriptionStatus,
    lastFetchAt,
    lastFetchCount,
    lastRealtimeAt,
    lastRealtimePayloadType,
  }), [notifications, scheduledNotifications, unreadCount, markAsRead, markAllAsRead, markTypeAsRead, createNotification, fetchNotifications, clearAllNotifications, currentUserId, subscriptionStatus, lastFetchAt, lastFetchCount, lastRealtimeAt, lastRealtimePayloadType]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationContext;
