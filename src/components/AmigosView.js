import React, { useEffect, useState } from 'react';
import { useAmigos } from '../hooks/useAmigos';
import { PlayerCardTrigger } from './ProfileComponents';
import MiniFriendCard from './MiniFriendCard';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import { useNotifications } from '../context/NotificationContext';
import './AmigosView.css';

const AmigosView = () => {
  console.log('[AMIGOS_VIEW] === RENDER START ===');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const { markTypeAsRead } = useNotifications();
  
  const { 
    amigos, 
    loading: loadingAmigos, 
    error, 
    getAmigos, 
    getPendingRequests,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
  } = useAmigos(currentUserId);
  
  // LOG ESTADO ACTUAL
  console.log('[AMIGOS_VIEW] Current state:', {
    currentUserId,
    amigosCount: amigos?.length || 0,
    amigosArray: amigos,
    loadingAmigos,
    error,
    pendingRequestsCount: pendingRequests?.length || 0,
  });

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
  }, [currentUserId]); // Removed function dependencies to prevent infinite loop

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

  // Handle removing a friend
  const handleRemoveFriend = async (friend) => {
    if (!confirm(`¿Estás seguro de que quieres eliminar a ${friend.profile?.nombre} de tus amigos?`)) {
      return;
    }
    
    console.log('[AMIGOS] Removing friend:', friend.id);
    const result = await removeFriend(friend.id);
    
    if (result.success) {
      toast.success('Amigo eliminado');
      await getAmigos();
    } else {
      toast.error(result.message || 'Error al eliminar amigo');
    }
  };
  
  // Search users function
  const searchUsers = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    
    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, email, avatar_url')
        .or(`nombre.ilike.%${query}%,email.ilike.%${query}%`)
        .neq('id', currentUserId)
        .limit(10);
        
      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching users:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };



  // Solo mostrar loading en la carga inicial
  if (loading && !currentUserId) {
    console.log('[AMIGOS_VIEW] Showing loading spinner - initial load');
    return <LoadingSpinner size="large" />;
  }

  if (error) {
    return <div className="amigos-error">Error: {error}</div>;
  }

  return (
    <div className="amigos-container">
      <div className="amigos-header">
        <div style={{ position: 'relative', marginBottom: '24px' }}>
          <button 
            onClick={() => window.history.back()}
            style={{
              position: 'absolute',
              top: '-2px',
              left: '-130px',
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '12px',
              transition: 'background 0.2s',
              minWidth: '40px',
              minHeight: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
            onMouseEnter={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.15)'}
            onMouseLeave={(e) => e.target.style.background = 'none'}
          >
            ◀
          </button>
          <div className="match-name" style={{ paddingLeft: '0px' }}>AMIGOS</div>
        </div>
      </div>
      
      {/* Search section */}
      <div className="amigos-search-section">
        <input
          type="text"
          placeholder="Buscar usuarios por nombre o email..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (e.target.value.trim()) {
              searchUsers(e.target.value.trim());
            } else {
              setSearchResults([]);
            }
          }}
          className="amigos-search-input"
        />
        
        {/* Search results */}
        {searchQuery && (
          <div className="amigos-search-results">
            {searchLoading ? (
              <div className="search-loading">
                <LoadingSpinner size="small" />
                <span>Buscando...</span>
              </div>
            ) : searchResults.length > 0 ? (
              searchResults.map((user) => (
                <SearchUserItem
                  key={user.id}
                  user={user}
                  currentUserId={currentUserId}
                  onRequestSent={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                />
              ))
            ) : (
              <div className="search-no-results">
                No se encontraron usuarios
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Pending requests section */}
      {pendingRequests.length > 0 && (
        <div className="amigos-pending-section">
          <h3 className="amigos-section-title">Solicitudes Pendientes</h3>
          <div className="amigos-pending-list">
            {pendingRequests.map((request) => (
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
      {(() => {
        console.log('[AMIGOS_VIEW] Rendering friends section:', {
          amigosLength: amigos?.length || 0,
          amigosIsArray: Array.isArray(amigos),
          firstAmigo: amigos?.[0],
        });
        
        // VERIFICACIÓN ADICIONAL: Asegurar que amigos es array y tiene elementos
        const hasAmigos = Array.isArray(amigos) && amigos.length > 0;
        console.log('[AMIGOS_VIEW] hasAmigos check:', { hasAmigos, amigosLength: amigos?.length, amigosType: typeof amigos });
        
        return hasAmigos ? (
          <div className="amigos-section">
            <h3 className="amigos-section-title">Mis Amigos ({amigos.length})</h3>
            <div className="amigos-chips-list">
              {amigos.map((amigo, index) => {
                console.log(`[AMIGOS_VIEW] Rendering friend ${index}:`, {
                  amigoId: amigo.id,
                  profileId: amigo.profile?.id,
                  profileName: amigo.profile?.nombre,
                  profileUuid: amigo.profile?.uuid,
                });
                
                return (
                  <MiniFriendCard
                    key={amigo.profile?.uuid || amigo.profile?.id || amigo.id}
                    friend={amigo}
                    onRemove={handleRemoveFriend}
                    currentUserId={currentUserId}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="amigos-empty">
            <p>No tienes amigos agregados todavía.</p>
            <p>Busca jugadores y envíales solicitudes de amistad.</p>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
              DEBUG: amigos.length = {amigos?.length || 0}, loading = {loadingAmigos.toString()}
            </div>
          </div>
        );
      })()}
      

    </div>
  );
};

// Component for search result items
const SearchUserItem = ({ user, currentUserId, onRequestSent }) => {
  const [loading, setLoading] = useState(false);
  const [relationshipStatus, setRelationshipStatus] = useState(null);
  const { sendFriendRequest, getRelationshipStatus } = useAmigos(currentUserId);
  
  useEffect(() => {
    const checkRelationship = async () => {
      const status = await getRelationshipStatus(user.id);
      setRelationshipStatus(status);
    };
    
    if (user.id && currentUserId) {
      checkRelationship();
    }
  }, [user.id, currentUserId, getRelationshipStatus]);
  
  const handleSendRequest = async () => {
    setLoading(true);
    try {
      const result = await sendFriendRequest(user.id);
      if (result.success) {
        toast.success('Solicitud enviada');
        onRequestSent();
      } else {
        toast.error(result.message || 'Error al enviar solicitud');
      }
    } catch (error) {
      toast.error('Error al enviar solicitud');
    } finally {
      setLoading(false);
    }
  };
  
  const getButtonText = () => {
    if (loading) return 'Enviando...';
    if (!relationshipStatus) return 'Enviar solicitud';
    if (relationshipStatus.status === 'pending') return 'Solicitud enviada';
    if (relationshipStatus.status === 'accepted') return 'Ya son amigos';
    if (relationshipStatus.status === 'rejected') return 'Reenviar solicitud';
    return 'Enviar solicitud';
  };
  
  const isButtonDisabled = () => {
    return loading || (relationshipStatus && ['pending', 'accepted'].includes(relationshipStatus.status));
  };
  
  return (
    <div className="search-user-item">
      <PlayerCardTrigger profile={user}>
        <div className="search-user-info">
          <img 
            src={user.avatar_url || '/profile.svg'} 
            alt={user.nombre} 
            className="search-user-avatar"
            onError={(e) => { e.target.src = '/profile.svg'; }}
          />
          <div className="search-user-details">
            <div className="search-user-name">{user.nombre}</div>
            <div className="search-user-email">{user.email}</div>
          </div>
        </div>
      </PlayerCardTrigger>
      
      <button
        className={`search-user-btn ${isButtonDisabled() ? 'disabled' : ''}`}
        onClick={handleSendRequest}
        disabled={isButtonDisabled()}
      >
        {getButtonText()}
      </button>
    </div>
  );
};

export default AmigosView;