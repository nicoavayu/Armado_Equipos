import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toBigIntId } from '../utils';
import { useNotifications } from '../context/NotificationContext';
import { useSurveys } from '../hooks/useSurveys';
import { useAmigos } from '../hooks/useAmigos';
import { useAuth } from './AuthProvider';

import { toast } from 'react-toastify';
import './NotificationsView.css';

const NotificationsView = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
  
  // Refetch notifications when returning to this view
  useEffect(() => {
    const handleFocus = () => {
      fetchNotifications();
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
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
    
    const data = notification.data || {};
    const route = data.target_route || data.action?.route;
    const id = data.target_params?.partido_id;
    
    if (route === 'voting_view' && id && data.matchCode) {
      navigate(`/?codigo=${data.matchCode}`);
      return;
    }
    
    // Priority 1: Check for matchUrl
    if (data.matchUrl) {
      navigate(data.matchUrl);
      return;
    }
    
    // Priority 2: Check for resultsUrl
    if (data.resultsUrl) {
      navigate(data.resultsUrl);
      return;
    }
    
    // Priority 3: Use /partido/:id if matchId exists
    if (data.matchId) {
      navigate(`/partido/${toBigIntId(data.matchId)}`);
      return;
    }
    
    // Fallback: Handle specific notification types
    switch (notification.type) {
      case 'friend_request':
        // Don't navigate, let user handle with action buttons
        break;
      case 'friend_accepted':
        navigate('/amigos');
        break;
      case 'match_invite':
        if (data.matchCode) {
          navigate(`/?codigo=${data.matchCode}`);
        }
        break;
      case 'call_to_vote':
        if (data.matchCode) {
          navigate(`/?codigo=${data.matchCode}`);
        }
        break;
      case 'pre_match_vote':
        const id = notification?.target_params?.partido_id;
        if (id) {
          navigate(`/voting/${id}`);
        } else if (data.matchCode) {
          navigate(`/?codigo=${data.matchCode}`);
        }
        break;
      case 'post_match_survey':
        if (data.partido_id) {
          navigate(`/encuesta/${toBigIntId(data.partido_id)}`);
        }
        break;
      case 'survey_reminder':
        console.log('[NOTIFICATION_CLICK] Survey reminder - matchId:', data.matchId);
        if (data.matchId) {
          const url = `/encuesta/${toBigIntId(data.matchId)}`;
          console.log('[NOTIFICATION_CLICK] Navigating to:', url);
          navigate(url);
        } else {
          console.log('[NOTIFICATION_CLICK] No matchId found in survey_reminder notification');
        }
        break;
      case 'survey_results':
      case 'survey_results_ready':
        // Priorizar resultsUrl si existe (incluye ?showAwards=1)
        if (data.resultsUrl) {
          navigate(data.resultsUrl);
        } else if (data.partido_id) {
          navigate(`/resultados-encuesta/${toBigIntId(data.partido_id)}?showAwards=1`);
        }
        break;
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
      case 'survey_reminder':
        return '📋';
      case 'call_to_vote':
        return '⭐';
      case 'survey_results_ready':
        return '🏆';
      default:
        return '📣';
    }
  };

  return (
    <div className="notifications-view">
      <div className="notifications-container">
      {notifications.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔔</div>
          <p>No tienes notificaciones</p>
          <span>Aquí aparecerán tus notificaciones cuando las recibas</span>
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
    </div>
  );
};

export default NotificationsView;