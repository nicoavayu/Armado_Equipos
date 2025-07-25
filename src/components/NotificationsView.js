import React, { useEffect, useState } from 'react';
import { useNotifications } from '../context/NotificationContext';
import { useSurveys } from '../hooks/useSurveys';
import { useAmigos } from '../hooks/useAmigos';
import { useAuth } from './AuthProvider';
import PostMatchSurvey from './PostMatchSurvey';
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
  
  const { pendingSurveys, openSurvey, closeSurvey, handleSurveySubmit } = useSurveys();
  const { acceptFriendRequest, rejectFriendRequest } = useAmigos(user?.id);
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [currentSurvey, setCurrentSurvey] = useState(null);
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
          window.location.href = `/?codigo=${notification.data.matchCode}`;
        }
        break;
      case 'call_to_vote':
        // Navigate to voting page for the match
        if (notification.data?.matchCode) {
          window.location.href = `/?codigo=${notification.data.matchCode}`;
        }
        break;
      case 'post_match_survey': {
        // Find the corresponding survey in pendingSurveys
        const survey = pendingSurveys.find((s) => s.notification.id === notification.id);
        if (survey) {
          setCurrentSurvey(survey);
          setShowSurveyModal(true);
        } else if (notification.data?.matchId) {
          // Si no encontramos la encuesta en pendingSurveys, intentamos abrir la página de encuesta directamente
          window.location.href = `/encuesta/${notification.data.matchId}`;
        }
        break;
      }
      default:
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
              onClick={() => notification.type !== 'friend_request' ? handleNotificationClick(notification) : null}
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
      
      {/* Post-match survey modal */}
      {showSurveyModal && currentSurvey && (
        <PostMatchSurvey
          partido={currentSurvey.partido}
          onClose={() => setShowSurveyModal(false)}
          onSubmit={() => {
            handleSurveySubmit();
            setShowSurveyModal(false);
            fetchNotifications();
          }}
        />
      )}
    </div>
  );
};

export default NotificationsView;