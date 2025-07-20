import React, { useState } from 'react';
import { useNotifications } from '../context/NotificationContext';
import { supabase } from '../supabase';

/**
 * Example component demonstrating how to use the notification system
 */
const NotificationExample = () => {
  const [loading, setLoading] = useState(false);
  const { createNotification, unreadCount } = useNotifications();
  const [currentUserId, setCurrentUserId] = useState(null);

  // Get current user ID
  const getCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
      return user.id;
    }
    return null;
  };

  // Create a test friend request notification
  const createTestFriendRequest = async () => {
    setLoading(true);
    const userId = currentUserId || await getCurrentUser();
    
    if (!userId) {
      alert('You must be logged in to create notifications');
      setLoading(false);
      return;
    }
    
    try {
      await createNotification(
        'friend_request',
        'Nueva solicitud de amistad',
        'Juan Pérez te ha enviado una solicitud de amistad',
        { requestId: 'test-request-id', senderId: 'test-sender-id' }
      );
      
      alert('Test friend request notification created!');
    } catch (error) {
      console.error('Error creating test notification:', error);
      alert('Error creating notification');
    } finally {
      setLoading(false);
    }
  };

  // Create a test match invitation notification
  const createTestMatchInvite = async () => {
    setLoading(true);
    const userId = currentUserId || await getCurrentUser();
    
    if (!userId) {
      alert('You must be logged in to create notifications');
      setLoading(false);
      return;
    }
    
    try {
      await createNotification(
        'match_invite',
        'Invitación a partido',
        'María González te ha invitado a un partido',
        { 
          matchId: 'test-match-id',
          matchCode: 'ABC123',
          matchDate: '2023-12-15',
          matchTime: '18:00',
          matchVenue: 'Estadio Central'
        }
      );
      
      alert('Test match invitation notification created!');
    } catch (error) {
      console.error('Error creating test notification:', error);
      alert('Error creating notification');
    } finally {
      setLoading(false);
    }
  };

  // Create a test match update notification
  const createTestMatchUpdate = async () => {
    setLoading(true);
    const userId = currentUserId || await getCurrentUser();
    
    if (!userId) {
      alert('You must be logged in to create notifications');
      setLoading(false);
      return;
    }
    
    try {
      await createNotification(
        'match_update',
        'Actualización de partido',
        'Los equipos han sido creados para tu partido',
        { 
          matchId: 'test-match-id',
          matchCode: 'ABC123',
          updateType: 'teams_created'
        }
      );
      
      alert('Test match update notification created!');
    } catch (error) {
      console.error('Error creating test notification:', error);
      alert('Error creating notification');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', color: 'white' }}>
      <h2>Notification System Test</h2>
      <p>Current unread notifications: {unreadCount.total}</p>
      <p>Friend requests: {unreadCount.friends}</p>
      <p>Match notifications: {unreadCount.matches}</p>
      
      <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
        <button 
          onClick={createTestFriendRequest}
          disabled={loading}
          style={{
            padding: '10px 15px',
            background: 'rgba(255, 255, 255, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '4px',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          Create Friend Request
        </button>
        
        <button 
          onClick={createTestMatchInvite}
          disabled={loading}
          style={{
            padding: '10px 15px',
            background: 'rgba(255, 255, 255, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '4px',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          Create Match Invite
        </button>
        
        <button 
          onClick={createTestMatchUpdate}
          disabled={loading}
          style={{
            padding: '10px 15px',
            background: 'rgba(255, 255, 255, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '4px',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          Create Match Update
        </button>
      </div>
      
      <p style={{ marginTop: '20px', fontSize: '14px', opacity: 0.7 }}>
        Note: These are test notifications. In a real app, notifications would be created automatically
        when events occur, such as receiving a friend request or being invited to a match.
      </p>
    </div>
  );
};

export default NotificationExample;