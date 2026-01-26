// src/components/ProfileCardModal.js
import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import ProfileCard from './ProfileCard';
import { useAmigos } from '../hooks/useAmigos';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
// import './ProfileCardModal.css'; // REMOVED

/**
 * Reusable modal component for displaying a player's ProfileCard
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {function} props.onClose - Function to close the modal
 * @param {Object} props.profile - Player profile data
 * @param {Object} [props.partidoActual] - Current match data
 * @param {function} [props.onMakeAdmin] - Function to make player admin
 */
const ProfileCardModal = ({ isOpen, onClose, profile, partidoActual, onMakeAdmin }) => {
  const [currentUserId, setCurrentUserId] = useState(null);
  const [relationshipStatus, setRelationshipStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [playerPhone, setPlayerPhone] = useState(null);

  const {
    getRelationshipStatus,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
  } = useAmigos(currentUserId);

  // Get current user ID on mount
  useEffect(() => {
    const getCurrentUser = async () => {
      console.log('[PROFILE_MODAL] Getting current user');
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error) {
        console.error('[PROFILE_MODAL] Error getting current user:', error);
        return;
      }

      if (user) {
        console.log('[PROFILE_MODAL] Current user found:', user.id);
        setCurrentUserId(user.id);
      } else {
        console.log('[PROFILE_MODAL] No authenticated user found');
      }
    };

    getCurrentUser();
  }, []);

  // Check relationship status when modal opens
  useEffect(() => {
    const checkRelationship = async () => {
      console.log('[PROFILE_MODAL] Checking relationship status', { currentUserId, profileId: profile?.id });

      if (!currentUserId || !profile?.id || currentUserId === profile.id) {
        return;
      }

      console.log('[PROFILE_MODAL] Getting relationship status between', currentUserId, 'and', profile.id);
      setIsLoading(true);
      const status = await getRelationshipStatus(profile.id);
      console.log('[PROFILE_MODAL] Relationship status result:', status);
      setRelationshipStatus(status);
      setIsLoading(false);
    };

    if (isOpen && profile && currentUserId) {
      checkRelationship();
    }
  }, [isOpen, currentUserId, profile?.id]);

  // Handle friend request actions
  const handleAddFriend = async () => {
    if (!currentUserId || !profile?.id || isLoading) return;

    console.log('[PROFILE_MODAL] Sending friend request from', currentUserId, 'to', profile.id);
    setIsLoading(true);
    const result = await sendFriendRequest(profile.id);

    if (result.success) {
      setRelationshipStatus({ id: result.data.id, status: 'pending' });
      toast.success('Solicitud de amistad enviada');
    } else {
      toast.error(result.message || 'Error al enviar solicitud');
    }
    setIsLoading(false);
  };

  const handleRemoveFriend = async () => {
    if (!relationshipStatus?.id || isLoading) return;

    setIsLoading(true);
    const result = await removeFriend(relationshipStatus.id);

    if (result.success) {
      setRelationshipStatus(null);
    }
    setIsLoading(false);
  };

  // Handle make admin action
  const handleMakeAdmin = async () => {
    if (!profile?.id || !partidoActual?.id) return;

    if (window.confirm(`¿Hacer admin a ${profile.nombre}?`)) {
      setIsAdminLoading(true);

      if (onMakeAdmin) {
        await onMakeAdmin(profile.id);
      }

      setIsAdminLoading(false);
      onClose();
    }
  };

  // Handle contact player action
  const handleContactPlayer = async () => {
    console.log('[CONTACT] Starting contact player action', { profileId: profile?.id, currentUserId });

    if (!profile?.id || !currentUserId) {
      console.log('[CONTACT] Missing profile ID or current user ID');
      return;
    }

    // Check if current user is admin
    const isCurrentUserAdmin = currentUserId && (
      partidoActual?.creado_por === currentUserId ||
      (partidoActual?.admins && partidoActual.admins.includes(currentUserId))
    );

    console.log('[CONTACT] Admin check', { isCurrentUserAdmin, partidoCreador: partidoActual?.creado_por, currentUserId });

    if (!isCurrentUserAdmin) {
      console.log('[CONTACT] User is not admin');
      toast.error('Solo los admins pueden ver información de contacto');
      return;
    }

    try {
      // Use usuario_id if available, fallback to id
      const userId = profile.usuario_id || profile.id;
      console.log('[CONTACT] Fetching phone for user:', { userId, profileId: profile.id, usuarioId: profile.usuario_id });

      const { data: userData, error } = await supabase
        .from('usuarios')
        .select('telefono')
        .eq('id', userId)
        .single();

      console.log('[CONTACT] Query result:', { userData, error });

      if (error) throw error;

      const phone = userData?.telefono || null;
      console.log('[CONTACT] Setting phone:', phone);

      setPlayerPhone(phone);
      setShowContactInfo(true);
    } catch (error) {
      console.error('[CONTACT] Error fetching contact info:', error);
      toast.error('Error al obtener información de contacto');
    }
  };

  // Render make admin button
  const renderMakeAdminButton = () => {
    // Don't show if no partido or viewing own profile
    if (!partidoActual || currentUserId === profile?.id) {
      return null;
    }

    // Check if current user is admin
    const isCurrentUserAdmin = currentUserId && (
      partidoActual?.creado_por === currentUserId ||
      (partidoActual?.admins && partidoActual.admins.includes(currentUserId))
    );

    // Don't show if current user is not admin
    if (!isCurrentUserAdmin) {
      return null;
    }

    // Check if profile user is already admin
    const isProfileUserAdmin = profile?.id && (
      partidoActual?.creado_por === profile.id ||
      (partidoActual?.admins && partidoActual.admins.includes(profile.id))
    );

    // Don't show if profile user is already admin
    if (isProfileUserAdmin) {
      return null;
    }

    // Don't show if profile user doesn't have an account
    if (!profile?.id) {
      return null;
    }

    return (
      <button
        className={`bg-[#B8860B] border-none rounded-[3px] py-1.5 px-2.5 text-[10px] font-bold text-white cursor-pointer transition-all flex items-center justify-center gap-0.5 min-w-[70px] min-h-[28px] whitespace-nowrap relative flex-1 hover:bg-[#DAA520] hover:-translate-y-px md:py-2.5 md:px-5 md:text-sm sm:py-2 sm:px-4 sm:text-xs ${isAdminLoading ? 'opacity-50 cursor-not-allowed hover:transform-none' : ''}`}
        onClick={handleMakeAdmin}
        disabled={isAdminLoading}
      >
        <span>{isAdminLoading ? 'Procesando...' : 'Hacer Admin'}</span>
      </button>
    );
  };

  // Render contact player button
  const renderContactButton = () => {
    // Don't show if viewing own profile or no profile ID
    if (currentUserId === profile?.id || !profile?.id) {
      return null;
    }

    // Check if current user is admin
    const isCurrentUserAdmin = currentUserId && (
      partidoActual?.creado_por === currentUserId ||
      (partidoActual?.admins && partidoActual.admins.includes(currentUserId))
    );

    // Only show for admins
    if (!isCurrentUserAdmin) {
      return null;
    }

    return (
      <button
        className="bg-[#2196F3] border-none rounded-[3px] py-1.5 px-2.5 text-[10px] font-semibold text-white cursor-pointer transition-all flex items-center justify-center gap-0.5 min-w-[70px] min-h-[28px] whitespace-nowrap relative flex-1 hover:bg-[#1976D2] hover:-translate-y-px md:py-2.5 md:px-5 md:text-sm sm:py-2 sm:px-4 sm:text-xs"
        onClick={handleContactPlayer}
      >
        <span>Contactar Jugador</span>
      </button>
    );
  };

  // Render friend action button based on relationship status
  const renderFriendActionButton = () => {
    if (currentUserId === profile?.id || !profile?.id) return null;

    if (!relationshipStatus) {
      return (
        <button
          className={`bg-[#4CAF50] border-none rounded-[3px] py-1.5 px-2.5 text-[10px] font-semibold text-white cursor-pointer transition-all flex items-center justify-center gap-0.5 min-w-[70px] min-h-[28px] whitespace-nowrap relative flex-1 hover:bg-[#45a049] hover:-translate-y-px md:py-2.5 md:px-5 md:text-sm sm:py-2 sm:px-4 sm:text-xs ${isLoading ? 'opacity-50 cursor-not-allowed hover:transform-none' : ''}`}
          onClick={handleAddFriend}
          disabled={isLoading}
        >
          <span>{isLoading ? 'Enviando...' : 'Solicitar amistad'}</span>
        </button>
      );
    }

    if (relationshipStatus.status === 'pending') {
      return (
        <button className="bg-[#FFC107] border-none rounded-[3px] py-1.5 px-2.5 text-[10px] font-semibold text-black cursor-default flex items-center justify-center gap-0.5 min-w-[70px] min-h-[28px] whitespace-nowrap relative flex-1 md:py-2.5 md:px-5 md:text-sm sm:py-2 sm:px-4 sm:text-xs" disabled>
          <span>Solicitud Pendiente</span>
        </button>
      );
    }

    if (relationshipStatus.status === 'accepted') {
      return (
        <button
          className={`bg-[#f44336] border-none rounded-[3px] py-1.5 px-2.5 text-[10px] font-semibold text-white cursor-pointer transition-all flex items-center justify-center gap-0.5 min-w-[70px] min-h-[28px] whitespace-nowrap relative flex-1 hover:bg-[#d32f2f] hover:-translate-y-px md:py-2.5 md:px-5 md:text-sm sm:py-2 sm:px-4 sm:text-xs ${isLoading ? 'opacity-50 cursor-not-allowed hover:transform-none' : ''}`}
          onClick={handleRemoveFriend}
          disabled={isLoading}
        >
          <span>Eliminar Amigo</span>
        </button>
      );
    }

    if (relationshipStatus.status === 'rejected') {
      return (
        <button
          className={`bg-[#4CAF50] border-none rounded-[3px] py-1.5 px-2.5 text-[10px] font-semibold text-white cursor-pointer transition-all flex items-center justify-center gap-0.5 min-w-[70px] min-h-[28px] whitespace-nowrap relative flex-1 hover:bg-[#45a049] hover:-translate-y-px md:py-2.5 md:px-5 md:text-sm sm:py-2 sm:px-4 sm:text-xs ${isLoading ? 'opacity-50 cursor-not-allowed hover:transform-none' : ''}`}
          onClick={handleAddFriend}
          disabled={isLoading}
        >
          <span>{isLoading ? 'Enviando...' : 'Solicitar amistad'}</span>
        </button>
      );
    }

    return null;
  };



  // Log modal open/close events
  useEffect(() => {
    if (isOpen) {
      console.log('[PROFILE_MODAL] Modal opened for profile:', profile?.id);
    } else {
      console.log('[PROFILE_MODAL] Modal closed');
    }
  }, [isOpen, profile?.id]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="w-auto max-w-[400px]"
      closeOnBackdrop={true}
      closeOnEscape={true}
      title=""
    >
      <div className="flex flex-col items-center gap-6">
        <div className="flex justify-center items-center">
          <ProfileCard
            profile={profile}
            isVisible={true}
            enableTilt={true}
            currentUserId={currentUserId}
          />
        </div>
        <div className="flex justify-center gap-2 w-full max-w-[350px]">
          {renderFriendActionButton()}
          {renderMakeAdminButton()}
          {renderContactButton()}
        </div>

        {/* Contact Info Modal */}
        {showContactInfo && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000]" onClick={() => setShowContactInfo(false)}>
            <div className="bg-[#1a1a1a] rounded-xl p-6 max-w-[400px] w-[90%] border-2 border-[#333] shadow-[0_8px_32px_rgba(0,0,0,0.5)] sm:p-5 sm:w-[95%]" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-white m-0 text-lg font-semibold sm:text-base">📞 Contactar a {profile?.nombre}</h3>
                <button
                  className="bg-transparent border-none text-white text-2xl cursor-pointer p-0 w-[30px] h-[30px] flex items-center justify-center rounded-full transition-colors hover:bg-white/10"
                  onClick={() => setShowContactInfo(false)}
                >
                  ×
                </button>
              </div>
              <div className="text-white py-2">
                {playerPhone ? (
                  <div className="flex items-center gap-4 p-5 bg-[#2196F3]/10 rounded-xl border border-[#2196F3]/20">
                    <div className="text-[32px] drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">📞</div>
                    <div className="flex-1">
                      <div className="text-xs text-white/70 uppercase tracking-wider mb-1">Teléfono</div>
                      <span className="text-[#2196F3] text-lg font-semibold block hover:text-[#42A5F5]">
                        {playerPhone}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <a href={`https://wa.me/${playerPhone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="bg-[#4CAF50] text-white py-2.5 px-4 rounded-lg font-semibold text-sm transition-all shadow-[0_2px_8px_rgba(76,175,80,0.3)] hover:bg-[#45a049] hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(76,175,80,0.4)] hover:text-white no-underline">
                        WhatsApp
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4 p-5 bg-[#FF9800]/10 rounded-xl border border-[#FF9800]/20">
                    <div className="text-[32px] opacity-70 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">📵</div>
                    <div className="flex-1">
                      <div className="text-[#FF9800] font-semibold text-base mb-1">Sin teléfono</div>
                      <div className="text-white/60 text-sm leading-[1.4]">Este jugador no ha registrado su número</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ProfileCardModal;