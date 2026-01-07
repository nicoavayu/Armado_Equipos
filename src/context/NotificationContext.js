import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import { handleError } from '../lib/errorHandler';
import { useInterval } from '../hooks/useInterval';
import { logger } from '../lib/logger';

const NotificationContext = createContext();

/**
 * Hook to access notification context
 * Provides notifications state, unread counts, and notification management functions
 * @returns {Object} Notification context value
 */
export const useNotifications = () => useContext(NotificationContext);

/**
 * Notification provider component
 * Manages real-time notifications, unread counts, and notification state
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState({
    friends: 0,
    matches: 0,
    total: 0,
  });
  const [currentUserId, setCurrentUserId] = useState(null);
  const { setIntervalSafe } = useInterval();
  // Umbral para ignorar eventos realtime con created_at <= al último clear
  const ignoreBeforeRef = useRef(null);

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
        setCurrentUserId(user.id);
      } else {
        logger.log('[NOTIFICATIONS] No authenticated user found');
      }
    };
    
    getCurrentUser();
  }, []);

  // Fetch notifications from Supabase
  useEffect(() => {
    if (!currentUserId) return;

    logger.log('[NOTIFICATIONS] Setting up for user:', currentUserId);
    
    // Initial fetch of notifications
    fetchNotifications();

    // Lightweight refresh system
    const REFRESH_MS = 15000;
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

    // Subscribe to real-time notifications
    logger.log('[NOTIFICATIONS] Setting up realtime subscription for user:', currentUserId);
    const subscription = supabase
      .channel(`notifications-${currentUserId}`)
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`, // CLAVE: Solo notificaciones para este usuario
        }, 
        (payload) => {
          logger.log('[NOTIFICATIONS] Realtime event received:', {
            eventType: payload.eventType,
            table: payload.table,
            userId: currentUserId,
            hasNewData: !!payload.new
          });
          
          if (payload.new) {
            logger.log('[NOTIFICATIONS] Processing new notification...');
            handleNewNotification(payload.new);
          } else {
            logger.error('[NOTIFICATIONS] No new data in payload');
          }
        },
      )
      .subscribe((status) => {
        logger.log('[NOTIFICATIONS] Subscription status:', {
          status,
          channel: `notifications-${currentUserId}`,
          timestamp: new Date().toISOString()
        });
        
        if (status === 'SUBSCRIBED') {
          logger.log('[NOTIFICATIONS] ✅ Successfully subscribed to realtime notifications');
        } else if (status === 'CHANNEL_ERROR') {
          logger.error('[NOTIFICATIONS] ❌ Channel error - realtime not working');
        } else if (status === 'TIMED_OUT') {
          logger.error('[NOTIFICATIONS] ❌ Subscription timed out');
        }
      });

    return () => {
      logger.log('[NOTIFICATIONS] Cleaning up subscription and refresh listeners');
      
      // Clean up refresh mechanisms
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      
      supabase.removeChannel(subscription);
    };
  }, [currentUserId]);

  // Fetch all notifications for the current user
  const fetchNotifications = useCallback(async () => {
    if (!currentUserId) {
      logger.log('[NOTIFICATIONS] fetchNotifications: No currentUserId, skipping');
      return;
    }

    logger.log('[NOTIFICATIONS] Fetching notifications for user:', currentUserId);
    try {
      // Only fetch notifications from the last 5 days to keep the UI light
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const cutoffISO = fiveDaysAgo.toISOString();

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUserId)
        .gte('created_at', cutoffISO)
        .order('created_at', { ascending: false });

      if (error) throw error;

      logger.log('[NOTIFICATIONS] Fetched notifications:', {
        total: data?.length || 0,
        unread: data?.filter((n) => !n.read).length || 0,
      });

      // Deduplicate notifications by partido (match) preferring survey_start
      const dedupedData = dedupeNotificationsForDisplay(data);

      setNotifications(dedupedData);
      updateUnreadCount(dedupedData);
    } catch (error) {
      handleError(error, { showToast: false });
    }
  }, [currentUserId]);

  // Deduplicate notifications per user+partido, preferring survey-related types
  const dedupeNotificationsForDisplay = (notifs = []) => {
    const preferredOrder = ['survey_start', 'post_match_survey', 'survey_reminder', 'call_to_vote'];
    const keepMap = new Map(); // key -> notification for partido-linked
    const othersMap = new Map(); // key -> notification for non-partido notifications (group by type+title+message)

    for (const n of notifs) {
      const pid = n.partido_id ?? (n.data?.match_id ?? n.data?.matchId ?? null);
      if (pid === null || pid === undefined) {
        // group generic notifications by type+title+message to avoid duplicate cards
        const compKey = `${n.type}::${(n.title||'').trim()}::${(n.message||'').trim()}`;
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

      const key = `${n.user_id}::${String(pid)}`;
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
    const surveyTypes = new Set(['survey_start', 'post_match_survey', 'survey_reminder']);
    const surveyPartidoIds = new Set();
    for (const n of Array.from(keepMap.values())) {
      if (surveyTypes.has(n.type)) {
        const pid = n.partido_id ?? (n.data?.match_id ?? n.data?.matchId ?? null);
        if (pid !== null && pid !== undefined) surveyPartidoIds.add(String(pid));
      }
    }
    for (const n of Array.from(othersMap.values())) {
      if (surveyTypes.has(n.type)) {
        const pid = n.partido_id ?? (n.data?.match_id ?? n.data?.matchId ?? null);
        if (pid !== null && pid !== undefined) surveyPartidoIds.add(String(pid));
      }
    }

    // Build result: non-partido grouped notifications first, then deduped partido notifications
    const nonPartido = Array.from(othersMap.values())
      .filter((n) => {
        // If this non-partido notification references a partido that already has a survey,
        // and this notification is a lower-priority type (call_to_vote), suppress it.
        const pid = n.partido_id ?? (n.data?.match_id ?? n.data?.matchId ?? null);
        if (pid !== null && pid !== undefined && surveyPartidoIds.has(String(pid)) && n.type === 'call_to_vote') {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const deduped = Array.from(keepMap.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return [...nonPartido, ...deduped];
  };

  // Handle new notification
  const handleNewNotification = (notification) => {
    logger.log('[NOTIFICATIONS] New realtime notification:', {
      id: notification.id,
      type: notification.type,
      isForCurrentUser: notification.user_id === currentUserId
    });
    
    // Verificar que la notificación es para el usuario actual
    if (notification.user_id !== currentUserId) {
      logger.warn('[NOTIFICATIONS] Notification not for current user, ignoring');
      return;
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

        if (isOnEncuestaPath || isOnPartidoPath || isOnPartidoGeneric || isOnQueryCodigo) {
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
        toast.info(`👥 Nueva solicitud de amistad de ${notification.data?.senderName || 'alguien'}`, toastOptions);
        break;
      case 'friend_accepted':
        toast.success(`✅ ${notification.title}: ${notification.message}`, toastOptions);
        break;
      case 'friend_rejected':
        toast.warning(`❌ ${notification.title}: ${notification.message}`, toastOptions);
        break;
      case 'match_invite':
        toast.info(`⚽ ${notification.title}: ${notification.message}`, toastOptions);
        break;
      case 'call_to_vote':
        toast.info(`⭐ ${notification.title}: ${notification.message}`, toastOptions);
        break;
      case 'survey_start':
      case 'post_match_survey':
        toast.info(`📋 ${notification.title}: ${notification.message}`, toastOptions);
        break;
      case 'survey_results_ready':
        toast.success(`🏆 ${notification.title}: ${notification.message}`, toastOptions);
        break;
      case 'admin_transfer':
        toast.success(`👑 ${notification.title}: ${notification.message}`, toastOptions);
        // Auto-refresh if forceRefresh is true
        if (notification.data?.forceRefresh) {
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
        break;
      default:
        toast.info(`📣 ${notification.title}: ${notification.message}`, toastOptions);
        break;
    }
  };

  // Update unread count
  const updateUnreadCount = (notifs) => {
    const unread = notifs.filter((n) => !n.read);
    const friendRequests = unread.filter((n) => n.type === 'friend_request').length;
    const matchInvites = unread.filter((n) => n.type === 'match_invite').length;
    const callToVote = unread.filter((n) => n.type === 'call_to_vote').length;
    const surveyStarts = unread.filter((n) => n.type === 'survey_start').length;
    const postMatchSurveys = unread.filter((n) => n.type === 'post_match_survey').length;
    const surveyResults = unread.filter((n) => n.type === 'survey_results_ready').length;
    
    setUnreadCount({
      friends: friendRequests,
      matches: matchInvites + callToVote + surveyStarts + postMatchSurveys + surveyResults,
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
      handleError(error, { showToast: false, onError: () => {} });
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
    setUnreadCount({ friends: 0, matches: 0, total: 0 });
  };

  // Create a new notification (for testing or manual creation)
  const createNotification = async (type, title, message, data = {}) => {
    if (!currentUserId) return;

    // --- CANONICAL MODE CHECK: prevent client creation of survey notifications when DB is canonical ---
    const SURVEY_FANOUT_MODE = process.env.NEXT_PUBLIC_SURVEY_FANOUT_MODE || "db";
    if (SURVEY_FANOUT_MODE === "db" && (type === "survey_start" || type === "post_match_survey")) return;

    try {
      const now = new Date().toISOString();
      const notification = {
        user_id: currentUserId,
        type,
        title,
        message,
        data,
        read: false,
        created_at: now,
        send_at: now,
      };

      const { data: newNotification, error } = await supabase
        .from('notifications')
        .insert([notification])
        .select()
        .single();

      if (error) throw error;

      return newNotification;
    } catch (error) {
      logger.error('Error creating notification:', error);
      return null;
    }
  };

  const value = useMemo(() => ({
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    markTypeAsRead,
    createNotification,
    fetchNotifications,
    clearAllNotifications,
  }), [notifications, unreadCount, markAsRead, markAllAsRead, markTypeAsRead, createNotification, fetchNotifications, clearAllNotifications]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationContext;