import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom'; // [TEAM_BALANCER_INVITE_ACCESS_FIX] Para navegación
import { supabase } from '../supabase';
import { useAuth } from './AuthProvider';
import LoadingSpinner from './LoadingSpinner';
import './NotificationsModal.css';

const NotificationsModal = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate(); // [TEAM_BALANCER_INVITE_ACCESS_FIX] Hook de navegación
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const notificationsData = data || [];
      console.log('[NOTIFICATIONS_MODAL] All notifications loaded:', notificationsData);
      notificationsData.forEach((n, i) => {
        console.log(`[NOTIFICATIONS_MODAL] Notification ${i}:`, {
          id: n.id,
          type: n.type,
          title: n.title,
          data: n.data,
          hasMatchCode: !!n.data?.matchCode,
        });
      });
      setNotifications(notificationsData);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen]);

  useEffect(() => {
    console.log('[NOTIFICATIONS_MODAL] Modal state changed:', { isOpen, userId: user?.id });
    if (isOpen && user?.id) {
      console.log('[NOTIFICATIONS_MODAL] Fetching notifications...');
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications, user?.id]);

  const markAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      if (error) throw error;
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
      );
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };
  
  // [TEAM_BALANCER_INVITE_ACCESS_FIX] Manejar click en notificaciones de invitación
  const handleNotificationClick = async (notification) => {
    console.log('[NOTIFICATION_CLICK] Clicked notification:', notification);
    console.log('[NOTIFICATION_CLICK] Notification data:', notification.data);
    
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    
    // Si es invitación a partido, redirigir al AdminPanel
    if (notification.type === 'match_invite' && notification.data?.matchId) {
      console.log('[NOTIFICATION_CLICK] Match invite clicked, matchId:', notification.data.matchId);
      onClose(); // Cerrar modal
      
      // Redirigir usando el código del partido
      try {
        const { data: partido, error } = await supabase
          .from('partidos')
          .select('codigo')
          .eq('id', notification.data.matchId)
          .single();
          
        console.log('[NOTIFICATION_CLICK] Match query result:', { partido, error });
          
        if (error) throw error;
        
        if (partido?.codigo) {
          console.log('[NOTIFICATION_CLICK] Navigating to admin panel for match:', notification.data.matchId);
          // Navegar directamente al AdminPanel usando el ID del partido
          navigate(`/admin/${notification.data.matchId}`);
        }
      } catch (error) {
        console.error('[NOTIFICATION_CLICK] Error redirecting to match:', error);
      }
    }
    
    // Si es llamada a votar, redirigir a la voting view
    if (notification.type === 'call_to_vote') {
      console.log('[NOTIFICATION_CLICK] Call to vote clicked');
      onClose(); // Cerrar modal
      
      if (notification.data?.matchCode) {
        console.log('[NOTIFICATION_CLICK] Navigating to voting view with code:', notification.data.matchCode);
        navigate(`/?codigo=${notification.data.matchCode}`);
      } else {
        console.log('[NOTIFICATION_CLICK] No matchCode found in call_to_vote notification');
        console.log('[NOTIFICATION_CLICK] Available data keys:', Object.keys(notification.data || {}));
      }
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'match_invite': return '⚽';
      case 'call_to_vote': return '⭐';
      case 'friend_request': return '👤';
      case 'friend_accepted': return '✅';
      case 'match_update': return '📅';
      case 'match_cancelled': return '❌';
      default: return '🔔';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  };

  if (!isOpen) {
    console.log('[NOTIFICATIONS_MODAL] Modal is closed, not rendering');
    return null;
  }
  
  console.log('[NOTIFICATIONS_MODAL] Rendering modal with', notifications.length, 'notifications');

  const modalContent = (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-container" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle"></div>
        <div className="sheet-header">
          <h3>Notificaciones</h3>
          <button className="sheet-close" onClick={onClose}>×</button>
        </div>
        <div className="sheet-body">
          {loading ? (
            <div className="loading-state">
              <LoadingSpinner size="medium" />
              <p>Cargando notificaciones...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="sin-notificaciones">
              <div className="empty-icon">🔔</div>
              <p>No tienes notificaciones</p>
              <span>Te avisaremos cuando tengas algo nuevo</span>
            </div>
          ) : (
            <div className="notifications-list">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`notification-item${!notification.read ? ' unread' : ''} ${(notification.type === 'match_invite' || notification.type === 'call_to_vote') ? 'clickable' : ''}`}
                  onClick={() => handleNotificationClick(notification)}
                  style={{ cursor: (notification.type === 'match_invite' || notification.type === 'call_to_vote') ? 'pointer' : 'default' }}
                >
                  <div className="notification-icon">{getNotificationIcon(notification.type)}</div>
                  <div className="notification-content">
                    <div className="notification-title">{notification.title}</div>
                    <div className="notification-message">{notification.message}</div>
                    <div className="notification-time">{formatDate(notification.created_at)}</div>
                  </div>
                  {!notification.read && <div className="notification-dot"></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default NotificationsModal;