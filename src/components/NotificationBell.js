import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { applyMatchNameQuotes, resolveNotificationMatchName } from '../utils/notificationText';
import './NotificationBell.css';

const NotificationBell = () => {
  const [showDropdown, setShowDropdown] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notifications, markAsRead } = useNotifications();

  const unreadCount = (notifications || []).filter((n) => !n.read).length;

  const handleNotificationClick = async (notification) => {
    try {
      await markAsRead(notification.id);
      if (notification.type === 'post_match_survey') {
        navigate(`/partido/${notification.data?.partido_id}/encuesta`);
      }
      setShowDropdown(false);
    } catch (error) {
      console.error('Error handling notification click:', error);
    }
  };

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-gray-600 hover:text-gray-900"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-[#128BE9] text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border z-50">
          <div className="p-3 border-b">
            <h3 className="font-semibold">Notificaciones</h3>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {(!notifications || notifications.length === 0) ? (
              <div className="p-4 text-gray-500 text-center">No hay notificaciones</div>
            ) : (
              notifications.map((notification) => {
                const matchName = resolveNotificationMatchName(notification, '');
                const title = applyMatchNameQuotes(notification.title || '', matchName);
                const message = applyMatchNameQuotes(notification.message || '', matchName);
                return (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${!notification.read ? 'bg-blue-50' : ''}`}
                  >
                    <div className="font-medium">{title}</div>
                    <div className="text-sm text-gray-600">{message}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(notification.created_at).toLocaleString()}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
