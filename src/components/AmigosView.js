import React, { useEffect, useState } from 'react';
import { useAmigos } from '../hooks/useAmigos';
import ProfileCard from './ProfileCard';
import { PlayerCardTrigger } from './ProfileComponents';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import { useNotifications } from '../context/NotificationContext';
import './AmigosView.css';

const AmigosView = () => {
  console.log('[AMIGOS] Render AmigosView sin subtítulo');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const { markTypeAsRead } = useNotifications();
  
  const { 
    amigos, 
    loading: loadingAmigos, 
    error, 
    getAmigos, 
    getPendingRequests,
    acceptFriendRequest,
    rejectFriendRequest
  } = useAmigos(currentUserId);

  // Get current user ID on mount
  useEffect(() => {
    const getCurrentUser = async () => {
      console.log('[AMIGOS] Getting current user');
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error) {
        console.error('[AMIGOS] Error getting current user:', error);
        return;
      }
      
      if (user) {
        console.log('[AMIGOS] Current user found:', user.id);
        setCurrentUserId(user.id);
      } else {
        console.log('[AMIGOS] No authenticated user found');
      }
    };
    
    getCurrentUser();
  }, []);

  // Load friends and pending requests when currentUserId changes
  useEffect(() => {
    if (currentUserId) {
      const loadData = async () => {
        console.log('[AMIGOS] Loading friends and pending requests for user:', currentUserId);
        setLoading(true);
        
        console.log('[AMIGOS] Fetching friends');
        await getAmigos();
        
        console.log('[AMIGOS] Fetching pending requests');
        const requests = await getPendingRequests();
        console.log('[AMIGOS] Pending requests received:', requests?.length || 0);
        setPendingRequests(requests);
        
        // Mark friend request notifications as read when viewing this screen
        await markTypeAsRead('friend_request');
        
        setLoading(false);
      };
      
      loadData();
    }
  }, [currentUserId, getAmigos, getPendingRequests, markTypeAsRead]);

  // Handle accepting a friend request
  const handleAcceptRequest = async (requestId) => {
    console.log('[AMIGOS] Accepting friend request:', requestId);
    const result = await acceptFriendRequest(requestId);
    console.log('[AMIGOS] Accept friend request result:', result);
    
    if (result.success) {
      toast.success('Solicitud de amistad aceptada');
      // Refresh pending requests and friends list
      console.log('[AMIGOS] Refreshing pending requests after accept');
      const requests = await getPendingRequests();
      setPendingRequests(requests);
      
      console.log('[AMIGOS] Refreshing friends list after accept');
      await getAmigos();
    } else {
      console.error('[AMIGOS] Error accepting friend request:', result.message);
      toast.error(result.message || 'Error al aceptar solicitud');
    }
  };

  // Handle rejecting a friend request
  const handleRejectRequest = async (requestId) => {
    console.log('[AMIGOS] Rejecting friend request:', requestId);
    const result = await rejectFriendRequest(requestId);
    console.log('[AMIGOS] Reject friend request result:', result);
    
    if (result.success) {
      toast.success('Solicitud de amistad rechazada');
      // Refresh pending requests
      console.log('[AMIGOS] Refreshing pending requests after reject');
      const requests = await getPendingRequests();
      setPendingRequests(requests);
    } else {
      console.error('[AMIGOS] Error rejecting friend request:', result.message);
      toast.error(result.message || 'Error al rechazar solicitud');
    }
  };

  if (loading || loadingAmigos) {
    return <LoadingSpinner size="large" />;
  }

  if (error) {
    return <div className="amigos-error">Error: {error}</div>;
  }

  return (
    <div className="amigos-container">
      <div className="match-name">AMIGOS</div>
      
      {/* Pending requests section */}
      {pendingRequests.length > 0 && (
        <div className="amigos-pending-section">
          <h3 className="amigos-section-title">Solicitudes Pendientes</h3>
          <div className="amigos-pending-list">
            {pendingRequests.map(request => (
              <div key={request.profile?.uuid || request.profile?.id || request.id} className="amigos-pending-item">
                <PlayerCardTrigger profile={request.profile}>
                  <div className="amigos-pending-info">
                    <img 
                      src={request.profile?.avatar_url || '/profile.svg'} 
                      alt={request.profile?.nombre || 'Usuario'} 
                      className="amigos-pending-avatar" 
                      onError={(e) => {
                        console.log('[AMIGOS] Error loading avatar image, using fallback');
                        e.target.src = '/profile.svg';
                      }}
                    />
                    <span className="amigos-pending-name">{request.profile?.nombre || 'Usuario'}</span>
                  </div>
                </PlayerCardTrigger>
                <div className="amigos-pending-actions">
                  <button 
                    className="amigos-btn accept" 
                    onClick={() => handleAcceptRequest(request.id)}
                  >
                    Aceptar
                  </button>
                  <button 
                    className="amigos-btn reject" 
                    onClick={() => handleRejectRequest(request.id)}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Friends list section */}
      {amigos.length > 0 ? (
        <div className="amigos-list">
          {amigos.map(amigo => (
            <div key={amigo.profile?.uuid || amigo.profile?.id || amigo.id} className="amigos-card-container">
              <PlayerCardTrigger profile={amigo.profile}>
                <ProfileCard 
                  profile={amigo.profile} 
                  isVisible={true} 
                  enableTilt={true}
                  currentUserId={currentUserId}
                  showFriendActions={true}
                />
              </PlayerCardTrigger>
            </div>
          ))}
        </div>
      ) : (
        <div className="amigos-empty">
          <p>No tienes amigos agregados todavía.</p>
          <p>Busca jugadores y envíales solicitudes de amistad.</p>
        </div>
      )}
    </div>
  );
};

export default AmigosView;