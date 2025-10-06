import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
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
  const fetchNotifications = async () => {
    if (!currentUserId) {
      logger.log('[NOTIFICATIONS] fetchNotifications: No currentUserId, skipping');
      return;
    }

    logger.log('[NOTIFICATIONS] Fetching notifications for user:', currentUserId);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      logger.log('[NOTIFICATIONS] Fetched notifications:', {
        total: data?.length || 0,
        unread: data?.filter((n) => !n.read).length || 0,
      });

      setNotifications(data || []);
      updateUnreadCount(data || []);
    } catch (error) {
      handleError(error, { showToast: false });
    }
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
    
    setNotifications((prev) => {
      logger.log('[NOTIFICATIONS] Current notifications count:', prev.length);
      // Evitar duplicados
      const exists = prev.find((n) => n.id === notification.id);
      if (exists) {
        logger.log('[NOTIFICATIONS] Notification already exists, skipping');
        return prev;
      }
      
      const updated = [notification, ...prev];
      logger.log('[NOTIFICATIONS] Updated notifications count:', updated.length);
      updateUnreadCount(updated);
      return updated;
    });
    
    // Show toast notification for real-time updates
    showNotificationToast(notification);
    logger.log('[NOTIFICATIONS] Notification processed successfully');
  };

  // Show toast notification based on type
  const showNotificationToast = (notification) => {
    logger.log('[NOTIFICATIONS] Showing toast for:', notification.type);
    
    const toastOptions = {
      position: 'top-right',
      autoClose: 5000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
    };

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
    const postMatchSurveys = unread.filter((n) => n.type === 'post_match_survey').length;
    const surveyResults = unread.filter((n) => n.type === 'survey_results_ready').length;
    
    setUnreadCount({
      friends: friendRequests,
      matches: matchInvites + callToVote + postMatchSurveys + surveyResults,
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
      handleError(error, { showToast: false });
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

  const value = {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    markTypeAsRead,
    createNotification,
    fetchNotifications,
    clearAllNotifications,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};