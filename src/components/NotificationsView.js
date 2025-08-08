import React, { useEffect, useState } from 'react';
import { useNotifications } from '../context/NotificationContext';
import { useSurveys } from '../hooks/useSurveys';
import { useAmigos } from '../hooks/useAmigos';
import { useAuth } from './AuthProvider';

import { toast } from 'react-toastify';
import './NotificationsView.css';

const NotificationsView = () => {
  const { user } = useAuth();
  const { 
    notifications, 
    markAsRead, 
    markAllAsRead, 
    fetchNotifications, 
  } = useNotifications();
  

  const { acceptFriendRequest, rejectFriendRequest } = useAmigos(user?.id);

  const [processingRequests, setProcessingRequests] = useState(new Set());

  useEffect(() => {
    console.log('[NOTIFICATIONS_VIEW] Component mounted, fetching notifications');
    fetchNotifications();
  }, [fetchNotifications]);

  // Log notifications when they change
  useEffect(() => {
    console.log('[NOTIFICATIONS_VIEW] Notifications updated:', notifications.length, 'total');
    const friendRequests = notifications.filter((n) => n.type === 'friend_request');
    console.log('[NOTIFICATIONS_VIEW] Friend requests:', friendRequests.length, friendRequests);
  }, [notifications]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const handleNotificationClick = async (notification) => {
    console.log('[NOTIFICATION_CLICK] Clicked notification:', notification);
    console.log('[NOTIFICATION_CLICK] Notification data:', notification.data);
    
    if (!notification.read) {
      markAsRead(notification.id);
    }
    
    // Handle different notification types
    switch (notification.type) {
      case 'friend_request':
        // Don't navigate, let user handle with action buttons
        break;
      case 'friend_accepted':
        // Navigate to friends tab
        window.location.href = '/amigos';
        break;
      case 'match_invite':
        // Navigate to match or handle match invite
        if (notification.data?.matchCode) {
          console.log('[NOTIFICATION_CLICK] Navigating to match invite:', notification.data.matchCode);
          window.location.href = `/?codigo=${notification.data.matchCode}`;
        } else {
          console.log('[NOTIFICATION_CLICK] No matchCode found in match_invite notification');
        }
        break;
      case 'call_to_vote':
        // Navigate to voting page for the match
        console.log('[NOTIFICATION_CLICK] Processing call_to_vote notification');
        if (notification.data?.matchCode) {
          console.log('[NOTIFICATION_CLICK] Navigating to voting page:', notification.data.matchCode);
          window.location.href = `/?codigo=${notification.data.matchCode}`;
        } else {
          console.log('[NOTIFICATION_CLICK] No matchCode found in call_to_vote notification');
          console.log('[NOTIFICATION_CLICK] Available data keys:', Object.keys(notification.data || {}));
        }
        break;
      case 'post_match_survey': {
        // Navegar directamente a la página de encuesta
        if (notification.data?.partido_id) {
          window.location.href = `/encuesta/${notification.data.partido_id}`;
        } else if (notification.data?.matchId) {
          window.location.href = `/encuesta/${notification.data.matchId}`;
        }
        break;
      }
      default:
        console.log('[NOTIFICATION_CLICK] Unknown notification type:', notification.type);
        break;
    }
  };

  const handleAcceptFriend = async (notification) => {
    const requestId = notification.data?.requestId;
    if (!requestId) return;
    
    setProcessingRequests((prev) => new Set([...prev, requestId]));
    
    try {
      const result = await acceptFriendRequest(requestId);
      if (result.success) {
        toast.success('Solicitud de amistad aceptada');
        markAsRead(notification.id);
        fetchNotifications();
      } else {
        toast.error(result.message || 'Error al aceptar solicitud');
      }
    } catch (error) {
      toast.error('Error al aceptar solicitud');
    } finally {
      setProcessingRequests((prev) => {
        const newSet = new Set(prev);
        newSet.delete(requestId);
        return newSet;
      });
    }
  };

  const handleRejectFriend = async (notification) => {
    const requestId = notification.data?.requestId;
    if (!requestId) return;
    
    setProcessingRequests((prev) => new Set([...prev, requestId]));
    
    try {
      const result = await rejectFriendRequest(requestId);
      if (result.success) {
        toast.success('Solicitud de amistad rechazada');
        markAsRead(notification.id);
        fetchNotifications();
      } else {
        toast.error(result.message || 'Error al rechazar solicitud');
      }
    } catch (error) {
      toast.error('Error al rechazar solicitud');
    } finally {
      setProcessingRequests((prev) => {
        const newSet = new Set(prev);
        newSet.delete(requestId);
        return newSet;
      });
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'friend_request':
        return '👥';
      case 'friend_accepted':
        return '✅';
      case 'friend_rejected':
        return '❌';
      case 'match_invite':
        return '⚽';
      case 'match_update':
        return '🔄';
      case 'post_match_survey':
        return '📋';
      case 'call_to_vote':
        return '⭐';
      default:
        return '📣';
    }
  };

  return (
    <div className="notifications-container">
      <div className="notifications-header">
        <h2>Notificaciones</h2>
        {notifications.length > 0 && (
          <button 
            className="mark-all-read-btn"
            onClick={markAllAsRead}
          >
            Marcar todo como leído
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="no-notifications">
          <p>No tienes notificaciones</p>
        </div>
      ) : (
        <div className="notifications-list">
          {notifications.map((notification) => (
            <div 
              key={notification.id} 
              className={`notification-item ${!notification.read ? 'unread' : ''} ${notification.type === 'friend_request' ? 'friend-request' : ''}`}
              onClick={() => {
                console.log('[NOTIFICATION_CLICK] Notification clicked, type:', notification.type);
                if (notification.type !== 'friend_request') {
                  handleNotificationClick(notification);
                }
              }}
            >
              <div className="notification-icon">
                {getNotificationIcon(notification.type)}
              </div>
              <div className="notification-content">
                <div className="notification-title">{notification.title}</div>
                <div className="notification-message">{notification.message}</div>
                <div className="notification-time">{formatDate(notification.created_at)}</div>
                
                {/* Friend request action buttons */}
                {notification.type === 'friend_request' && !notification.read && (
                  <div className="friend-request-actions">
                    <button 
                      className="accept-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAcceptFriend(notification);
                      }}
                      disabled={processingRequests.has(notification.data?.requestId)}
                    >
                      {processingRequests.has(notification.data?.requestId) ? 'Aceptando...' : 'Aceptar'}
                    </button>
                    <button 
                      className="reject-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRejectFriend(notification);
                      }}
                      disabled={processingRequests.has(notification.data?.requestId)}
                    >
                      {processingRequests.has(notification.data?.requestId) ? 'Rechazando...' : 'Rechazar'}
                    </button>
                  </div>
                )}
              </div>
              {!notification.read && <div className="unread-indicator"></div>}
            </div>
          ))}
        </div>
      )}
      

    </div>
  );
};

export default NotificationsView;