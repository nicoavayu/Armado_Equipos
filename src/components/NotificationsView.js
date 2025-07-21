import React, { useEffect, useState } from 'react';
import { useNotifications } from '../context/NotificationContext';
import { useSurveys } from '../hooks/useSurveys';
import PostMatchSurvey from './PostMatchSurvey';
import './NotificationsView.css';

const NotificationsView = () => {
  const { 
    notifications, 
    markAsRead, 
    markAllAsRead, 
    fetchNotifications 
  } = useNotifications();
  
  const { pendingSurveys, openSurvey, closeSurvey, handleSurveySubmit } = useSurveys();
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [currentSurvey, setCurrentSurvey] = useState(null);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

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
        // Navigate to friends tab or handle friend request
        break;
      case 'match_invite':
        // Navigate to match or handle match invite
        break;
      case 'post_match_survey':
        // Find the corresponding survey in pendingSurveys
        const survey = pendingSurveys.find(s => s.notification.id === notification.id);
        if (survey) {
          setCurrentSurvey(survey);
          setShowSurveyModal(true);
        }
        break;
      default:
        break;
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'friend_request':
        return '👥';
      case 'match_invite':
        return '⚽';
      case 'friend_accepted':
        return '✅';
      case 'match_update':
        return '🔄';
      case 'post_match_survey':
        return '📋';
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
          {notifications.map(notification => (
            <div 
              key={notification.id} 
              className={`notification-item ${!notification.read ? 'unread' : ''}`}
              onClick={() => handleNotificationClick(notification)}
            >
              <div className="notification-icon">
                {getNotificationIcon(notification.type)}
              </div>
              <div className="notification-content">
                <div className="notification-title">{notification.title}</div>
                <div className="notification-message">{notification.message}</div>
                <div className="notification-time">{formatDate(notification.created_at)}</div>
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