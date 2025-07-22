import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabase';

const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState({
    friends: 0,
    matches: 0,
    total: 0
  });
  const [currentUserId, setCurrentUserId] = useState(null);

  // Get current user on mount
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    };
    
    getCurrentUser();
  }, []);

  // Fetch notifications from Supabase
  useEffect(() => {
    if (!currentUserId) return;

    // Initial fetch of notifications
    fetchNotifications();

    // Subscribe to real-time notifications
    const subscription = supabase
      .channel('notifications-channel')
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`
        }, 
        (payload) => {
          handleNewNotification(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [currentUserId]);

  // Fetch all notifications for the current user
  const fetchNotifications = async () => {
    if (!currentUserId) return;

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setNotifications(data || []);
      updateUnreadCount(data || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  // Handle new notification
  const handleNewNotification = (notification) => {
    setNotifications(prev => [notification, ...prev]);
    updateUnreadCount([notification, ...notifications]);
  };

  // Update unread count
  const updateUnreadCount = (notifs) => {
    const unread = notifs.filter(n => !n.read);
    const friendRequests = unread.filter(n => n.type === 'friend_request').length;
    const matchInvites = unread.filter(n => n.type === 'match_invite').length;
    const callToVote = unread.filter(n => n.type === 'call_to_vote').length;
    const postMatchSurveys = unread.filter(n => n.type === 'post_match_survey').length;
    
    setUnreadCount({
      friends: friendRequests,
      matches: matchInvites + callToVote + postMatchSurveys, // Agrupamos todas las notificaciones relacionadas con partidos
      total: unread.length
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
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
      
      // Update unread count
      const updatedNotifications = notifications.map(n => 
        n.id === notificationId ? { ...n, read: true } : n
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
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
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
      setNotifications(prev => 
        prev.map(n => n.type === type ? { ...n, read: true } : n)
      );
      
      // Update unread count
      const updatedNotifications = notifications.map(n => 
        n.type === type ? { ...n, read: true } : n
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
        created_at: new Date().toISOString()
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
    fetchNotifications
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};