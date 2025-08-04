import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';

const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState({
    friends: 0,
    matches: 0,
    total: 0,
  });
  const [currentUserId, setCurrentUserId] = useState(null);

  // Get current user on mount
  useEffect(() => {
    const getCurrentUser = async () => {
      console.log('[NOTIFICATIONS] Getting current user...');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) {
        console.error('[NOTIFICATIONS] Error getting current user:', error);
        return;
      }
      if (user) {
        console.log('[NOTIFICATIONS] Current user found:', user.id);
        setCurrentUserId(user.id);
      } else {
        console.log('[NOTIFICATIONS] No authenticated user found');
      }
    };
    
    getCurrentUser();
  }, []);

  // Fetch notifications from Supabase
  useEffect(() => {
    if (!currentUserId) return;

    console.log('[NOTIFICATIONS] Setting up for user:', currentUserId);
    
    // Initial fetch of notifications
    fetchNotifications();

    // Polling disabled to prevent ERR_INSUFFICIENT_RESOURCES
    // const interval = setInterval(() => {
    //   console.log('[NOTIFICATIONS] Polling for new notifications...');
    //   fetchNotifications();
    // }, 5000);

    // Subscribe to real-time notifications
    console.log('[NOTIFICATIONS] Setting up realtime subscription for user:', currentUserId);
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
          console.log('[NOTIFICATIONS] === REALTIME EVENT RECEIVED ===');
          console.log('[NOTIFICATIONS] Event type:', payload.eventType);
          console.log('[NOTIFICATIONS] Table:', payload.table);
          console.log('[NOTIFICATIONS] New data:', payload.new);
          console.log('[NOTIFICATIONS] Filter matched for user:', currentUserId);
          console.log('[NOTIFICATIONS] Payload full:', payload);
          
          if (payload.new) {
            console.log('[NOTIFICATIONS] Calling handleNewNotification...');
            handleNewNotification(payload.new);
          } else {
            console.error('[NOTIFICATIONS] No new data in payload');
          }
        },
      )
      .subscribe((status) => {
        console.log('[NOTIFICATIONS] === SUBSCRIPTION STATUS ===');
        console.log('[NOTIFICATIONS] Status:', status);
        console.log('[NOTIFICATIONS] Channel:', `notifications-${currentUserId}`);
        console.log('[NOTIFICATIONS] Timestamp:', new Date().toISOString());
        
        if (status === 'SUBSCRIBED') {
          console.log('[NOTIFICATIONS] ✅ Successfully subscribed to realtime notifications');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[NOTIFICATIONS] ❌ Channel error - realtime not working');
        } else if (status === 'TIMED_OUT') {
          console.error('[NOTIFICATIONS] ❌ Subscription timed out');
        }
      });

    return () => {
      console.log('[NOTIFICATIONS] Cleaning up subscription');
      // clearInterval(interval);
      supabase.removeChannel(subscription);
    };
  }, [currentUserId]);

  // Fetch all notifications for the current user
  const fetchNotifications = async () => {
    if (!currentUserId) {
      console.log('[NOTIFICATIONS] fetchNotifications: No currentUserId, skipping');
      return;
    }

    console.log('[NOTIFICATIONS] Fetching notifications for user:', currentUserId);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUserId) // CLAVE: user_id === currentUserId (destinatario)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[NOTIFICATIONS] Error fetching notifications:', error);
        throw error;
      }

      console.log('[NOTIFICATIONS] Fetched notifications:', {
        total: data?.length || 0,
        byType: data?.reduce((acc, n) => {
          acc[n.type] = (acc[n.type] || 0) + 1;
          return acc;
        }, {}) || {},
        matchInvites: data?.filter((n) => n.type === 'match_invite').length || 0,
        friendRequests: data?.filter((n) => n.type === 'friend_request').length || 0,
        unread: data?.filter((n) => !n.read).length || 0,
      });

      setNotifications(data || []);
      updateUnreadCount(data || []);
    } catch (error) {
      console.error('[NOTIFICATIONS] Error fetching notifications:', error);
    }
  };

  // Handle new notification
  const handleNewNotification = (notification) => {
    console.log('[NOTIFICATIONS] === NEW REALTIME NOTIFICATION ===');
    console.log('[NOTIFICATIONS] Notification data:', {
      id: notification.id,
      user_id: notification.user_id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      read: notification.read,
      created_at: notification.created_at,
    });
    console.log('[NOTIFICATIONS] Current user ID:', currentUserId);
    console.log('[NOTIFICATIONS] Notification is for current user:', notification.user_id === currentUserId);
    
    // Verificar que la notificación es para el usuario actual
    if (notification.user_id !== currentUserId) {
      console.warn('[NOTIFICATIONS] Notification not for current user, ignoring');
      return;
    }
    
    setNotifications((prev) => {
      console.log('[NOTIFICATIONS] Current notifications before update:', prev.length);
      // Evitar duplicados
      const exists = prev.find((n) => n.id === notification.id);
      if (exists) {
        console.log('[NOTIFICATIONS] Notification already exists, skipping');
        return prev;
      }
      
      const updated = [notification, ...prev];
      console.log('[NOTIFICATIONS] Updated notifications count:', updated.length);
      console.log('[NOTIFICATIONS] New notification added to state');
      updateUnreadCount(updated);
      return updated;
    });
    
    // Show toast notification for real-time updates
    showNotificationToast(notification);
    console.log('[NOTIFICATIONS] Notification processed successfully');
  };

  // Show toast notification based on type
  const showNotificationToast = (notification) => {
    console.log('[NOTIFICATIONS] Showing toast for:', notification.type, notification.message);
    
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
    
    setUnreadCount({
      friends: friendRequests,
      matches: matchInvites + callToVote + postMatchSurveys,
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
      console.error('Error marking notification as read:', error);
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
      console.error('Error marking all notifications as read:', error);
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
      console.error(`Error marking ${type} notifications as read:`, error);
    }
  };

  // Create a new notification (for testing or manual creation)
  const createNotification = async (type, title, message, data = {}) => {
    if (!currentUserId) return;

    try {
      const notification = {
        user_id: currentUserId,
        type,
        title,
        message,
        data,
        read: false,
        created_at: new Date().toISOString(),
      };

      const { data: newNotification, error } = await supabase
        .from('notifications')
        .insert([notification])
        .select()
        .single();

      if (error) throw error;

      return newNotification;
    } catch (error) {
      console.error('Error creating notification:', error);
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
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};