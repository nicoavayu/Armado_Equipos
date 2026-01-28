import React, { useEffect, useState } from 'react';
import { useAmigos } from '../hooks/useAmigos';
import { PlayerCardTrigger } from './ProfileComponents';
import MiniFriendCard from './MiniFriendCard';
import ConfirmModal from './ConfirmModal';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import LoadingSpinner from './LoadingSpinner';
import { useNotifications } from '../context/NotificationContext';

const AmigosView = () => {
  console.log('[AMIGOS_VIEW] === RENDER START ===');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const { markTypeAsRead } = useNotifications();

  // Estado centralizado para el modal de confirmación de eliminación
  const [friendToDelete, setFriendToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
        console.log('[AMIGOS] Current user found:', encodeURIComponent(user.id || ''));
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
  }, [currentUserId]);

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
    // friend.id es el relationship ID (de tabla amigos)
    // friend.profile es el objeto usuario con todos los datos
    console.log('[AMIGOS] Removing friend:', {
      relationshipId: friend.id,
      friendName: friend.profile?.nombre,
      friendUserId: friend.profile?.id,
    });

    if (!friend.id) {
      console.error('[AMIGOS] No relationship ID found:', friend);
      toast.error('Error: No se pudo identificar la relación');
      setFriendToDelete(null); // Cerrar modal
      return;
    }

    try {
      setIsDeleting(true);
      console.log('[AMIGOS] Calling removeFriend with relationship ID:', friend.id);
      const result = await removeFriend(friend.id);

      if (result.success) {
        toast.success('Amigo eliminado');
        // Pequeño delay para asegurar que la DB se actualice antes de refrescar
        await new Promise((resolve) => setTimeout(resolve, 300));
        console.log('[AMIGOS] Refreshing friends list after deletion');
        await getAmigos();
      } else {
        console.error('[AMIGOS] Error removing friend:', result.message);
        toast.error(result.message || 'Error al eliminar amigo');
      }
    } catch (error) {
      console.error('[AMIGOS] Exception in handleRemoveFriend:', error);
      toast.error('Error al eliminar amigo');
    } finally {
      // Cerrar el modal SIEMPRE después de intentar eliminar
      setFriendToDelete(null);
      setIsDeleting(false);
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
  if (loading || loadingAmigos) {
    console.log('[AMIGOS_VIEW] Showing loading spinner - initial load');
    return <LoadingSpinner size="large" />;
  }

  if (error) {
    return <div className="text-center p-5 bg-red-500/10 rounded-lg text-red-600 mt-5">Error: {error}</div>;
  }

  return (
    <div className="p-5 w-full m-0 pt-[10px] box-border sm:p-[10px] md:max-w-7xl md:mx-auto">
      {/* Search section */}
      <div className="flex justify-center w-full my-[10px] mb-[12px] relative box-border z-10 max-w-[98vw] sm:max-w-[99vw]">
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
          className="w-[95%] max-w-none p-[16px_20px] text-[20px] border border-white/20 rounded-2xl bg-white/5 text-white font-oswald box-border placeholder-white/30 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 backdrop-blur-md sm:text-[17px] sm:p-[14px_10px]"
        />

        {/* Search results */}
        {searchQuery && (
          <div className="w-full max-w-[700px] mx-auto rounded-xl absolute left-1/2 -translate-x-1/2 top-full bg-black/90 border border-white/20 max-h-[300px] overflow-y-auto z-[1000] mt-1 sm:max-w-[98vw]">
            {searchLoading ? (
              <div className="flex items-center gap-2 p-4 text-white/70 text-sm">
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
              <div className="p-4 text-center text-white/60 text-sm">
                No se encontraron usuarios
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pending requests section */}
      {pendingRequests.length > 0 && (
        <div className="flex flex-col items-center mb-5 md:mb-8 w-full max-w-4xl mx-auto">
          <h3 className="text-xl font-semibold my-[20px] mb-[15px] text-white">Solicitudes Pendientes</h3>
          <div className="flex flex-col gap-2.5 w-full">
            {pendingRequests.map((request) => (
              <div key={request.profile?.uuid || request.profile?.id || request.id} className="flex items-center gap-3 p-4 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 mb-3 w-full box-border min-h-[64px] transition-all duration-300 shadow-xl hover:shadow-2xl hover:border-white/20 hover:bg-white/15 sm:p-3">
                <PlayerCardTrigger profile={request.profile}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <img
                      src={request.profile?.avatar_url || '/profile.svg'}
                      alt={request.profile?.nombre || 'Usuario'}
                      className="w-11 h-11 rounded-full object-cover bg-white/20 border-2 border-white/30 shrink-0 sm:w-10 sm:h-10"
                      onError={(e) => {
                        console.log('[AMIGOS] Error loading avatar image, using fallback');
                        e.target.src = '/profile.svg';
                      }}
                    />
                    <span className="text-lg font-bold text-white font-oswald uppercase whitespace-nowrap overflow-hidden text-ellipsis mb-1 sm:text-base">
                      {request.profile?.nombre || 'Usuario'}
                    </span>
                  </div>
                </PlayerCardTrigger>
                <div className="flex gap-2 shrink-0">
                  <button
                    className="px-4 py-2 border-none rounded-md font-semibold cursor-pointer transition-all duration-200 font-bebas uppercase tracking-wider text-sm min-w-[70px] bg-[#4CAF50] text-white hover:bg-[#3d8b40] hover:-translate-y-[1px] sm:px-3 sm:py-1.5 sm:text-[13px] sm:min-w-[60px]"
                    onClick={() => handleAcceptRequest(request.id)}
                  >
                    Aceptar
                  </button>
                  <button
                    className="px-4 py-2 border-none rounded-md font-semibold cursor-pointer transition-all duration-200 font-bebas uppercase tracking-wider text-sm min-w-[70px] bg-[#DE1C49] text-white hover:bg-[#c41841] hover:-translate-y-[1px] sm:px-3 sm:py-1.5 sm:text-[13px] sm:min-w-[60px]"
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
        const hasAmigos = Array.isArray(amigos) && amigos.length > 0;

        return hasAmigos ? (
          <div className="flex flex-col items-center mb-[350px] w-full max-w-4xl mx-auto relative z-0">
            <h3 className="text-xl font-semibold my-[20px] mb-[15px] text-white">Mis Amigos ({amigos.length})</h3>
            <div className="flex flex-col gap-2 mt-[15px] w-full max-w-none overflow-visible sm:gap-1.5">
              {amigos.map((amigo) => (
                <MiniFriendCard
                  key={amigo.profile?.uuid || amigo.profile?.id || amigo.id}
                  friend={amigo}
                  onRemove={handleRemoveFriend}
                  onRequestRemoveClick={(friend) => setFriendToDelete(friend)}
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center p-10 bg-black/5 rounded-lg mt-5">
            <p className="m-2.5 text-base text-white">No tienes amigos agregados todavía.</p>
            <p className="m-2.5 text-base text-white">Busca jugadores y envíales solicitudes de amistad.</p>
          </div>
        );
      })()}

      {/* Modal centralizado de confirmación de eliminación */}
      <ConfirmModal
        isOpen={!!friendToDelete}
        onCancel={() => setFriendToDelete(null)}
        onConfirm={async () => {
          if (friendToDelete) {
            await handleRemoveFriend(friendToDelete);
          }
        }}
        title="Eliminar amigo"
        message={`¿Estás seguro que deseas eliminar a ${friendToDelete?.profile?.nombre || 'este jugador'} de tu lista de amigos?`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        isDeleting={isDeleting}
      />
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
    if (!relationshipStatus) return 'Solicitar';
    if (relationshipStatus.status === 'pending') return 'Solicitud enviada';
    if (relationshipStatus.status === 'accepted') return 'Ya son amigos';
    if (relationshipStatus.status === 'rejected') return 'Reenviar';
    return 'Solicitar';
  };

  const isButtonDisabled = () => {
    return loading || (relationshipStatus && ['pending', 'accepted'].includes(relationshipStatus.status));
  };

  return (
    <div className="flex items-center justify-between p-3 border-b border-white/10 transition-colors hover:bg-white/5 last:border-b-0">
      <PlayerCardTrigger profile={user}>
        <div className="flex items-center gap-3 flex-1 cursor-pointer">
          <img
            src={user.avatar_url || '/profile.svg'}
            alt={user.nombre}
            className="w-10 h-10 rounded-full object-cover"
            onError={(e) => { e.target.src = '/profile.svg'; }}
          />
          <div className="flex-1">
            <div className="font-semibold text-white text-sm">{user.nombre}</div>
            <div className="text-xs text-white/60 mt-0.5">{user.email}</div>
          </div>
        </div>
      </PlayerCardTrigger>

      <button
        className={`
          px-4 py-1.5 bg-[#2196F3] text-white border-none rounded text-xs font-medium cursor-pointer transition-all hover:bg-[#1976D2] whitespace-nowrap
          ${isButtonDisabled() ? 'bg-white/20 text-white/50 cursor-not-allowed hover:bg-white/20' : ''}
        `}
        onClick={handleSendRequest}
        disabled={isButtonDisabled()}
      >
        {getButtonText()}
      </button>
    </div>
  );
};

export default AmigosView;