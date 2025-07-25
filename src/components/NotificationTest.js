import React from 'react';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from './AuthProvider';

const NotificationTest = () => {
  const { user } = useAuth();
  const { createNotification, notifications, unreadCount } = useNotifications();

  const testFriendRequest = async () => {
    if (!user) {
      alert('No hay usuario autenticado');
      return;
    }

    try {
      await createNotification(
        'friend_request',
        'Test: Nueva solicitud de amistad',
        'Usuario de prueba te ha enviado una solicitud de amistad',
        { 
          requestId: 'test-123', 
          senderId: 'test-sender',
          senderName: 'Usuario Test'
        }
      );
      console.log('Test notification created');
    } catch (error) {
      console.error('Error creating test notification:', error);
    }
  };

  return (
    <div style={{ 
      position: 'fixed', 
      top: '10px', 
      right: '10px', 
      background: 'white', 
      padding: '10px', 
      border: '1px solid #ccc',
      borderRadius: '5px',
      zIndex: 9999
    }}>
      <h4>Notification Test</h4>
      <p>User: {user?.id || 'No user'}</p>
      <p>Total notifications: {notifications.length}</p>
      <p>Unread: {unreadCount.total}</p>
      <p>Friend requests: {unreadCount.friends}</p>
      <button onClick={testFriendRequest}>
        Test Friend Request
      </button>
    </div>
  );
};

export default NotificationTest;