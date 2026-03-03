import { notifyBlockingError } from 'utils/notifyBlockingError';
// src/components/ProfileCardModal.js
import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';
import ProfileCard from './ProfileCard';
import { useAmigos } from '../hooks/useAmigos';
import { supabase } from '../supabase';
import { Phone, PhoneOff } from 'lucide-react';
// import './ProfileCardModal.css'; // REMOVED

/**
 * Validate if a string is a valid UUID format
 * UUIDs have format: 8-4-4-4-12 hex characters
 */
const isValidUUID = (value) => {
  if (!value || typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
};

const resolveProfileUserId = (profile) => (
  profile?.usuario_id
  || profile?.user_id
  || profile?.uuid
  || profile?.id
  || null
);

const resolveRegisteredUserId = (profile) => {
  const candidates = [profile?.usuario_id, profile?.user_id, profile?.uuid, profile?.id];
  return candidates.find((value) => isValidUUID(value)) || null;
};

const PROFILE_ACTION_BUTTON_BASE = 'w-full min-w-0 h-[44px] px-2.5 rounded-none border font-bebas text-[13px] tracking-[0.01em] leading-tight cursor-pointer transition-all inline-flex items-center justify-center text-center disabled:opacity-60 disabled:cursor-not-allowed';
const PROFILE_ACTION_BUTTON_PRIMARY = 'bg-[#6a43ff] border-[#7d5aff] text-white shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:bg-[#7550ff] active:opacity-95';
const PROFILE_ACTION_BUTTON_INFO = 'bg-[rgba(15,64,98,0.45)] border-[rgba(65,179,255,0.55)] text-[#d3efff] hover:bg-[rgba(15,72,112,0.62)] hover:text-white active:opacity-95';
const PROFILE_ACTION_BUTTON_WARNING = 'bg-[rgba(94,73,28,0.45)] border-[rgba(236,201,104,0.55)] text-[#ffe7a8] hover:bg-[rgba(116,89,33,0.62)] hover:text-white active:opacity-95';

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
  const profileUserId = resolveProfileUserId(profile);
  const registeredUserId = resolveRegisteredUserId(profile);
  const [resolvedProfile, setResolvedProfile] = useState(profile);
  const [hasPersistedUserProfile, setHasPersistedUserProfile] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [relationshipStatus, setRelationshipStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [playerPhone, setPlayerPhone] = useState(null);
  const [showAdminConfirm, setShowAdminConfirm] = useState(false);

  const {
    getRelationshipStatus,
    sendFriendRequest,
    removeFriend,
  } = useAmigos(currentUserId);

  useEffect(() => {
    setResolvedProfile(profile);
    setHasPersistedUserProfile(false);
    setRelationshipStatus(null);
  }, [profile]);

  useEffect(() => {
    let isCancelled = false;

    const fetchLatestProfile = async () => {
      if (!isOpen) return;

      if (!registeredUserId) {
        if (!isCancelled) setHasPersistedUserProfile(false);
        return;
      }

      const { data: latestProfile, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', registeredUserId)
        .maybeSingle();

      if (error) {
        console.warn('[PROFILE_MODAL] Could not refresh latest profile from usuarios:', error);
        if (!isCancelled) setHasPersistedUserProfile(false);
        return;
      }

      if (!latestProfile || isCancelled) {
        if (!isCancelled) setHasPersistedUserProfile(false);
        return;
      }

      if (!isCancelled) setHasPersistedUserProfile(true);

      setResolvedProfile((prev) => {
        const baseProfile = prev || profile || {};
        return {
          ...baseProfile,
          ...latestProfile,
          id: latestProfile.id || baseProfile.id,
          usuario_id: baseProfile.usuario_id || latestProfile.id,
          user_id: baseProfile.user_id || latestProfile.id,
          uuid: baseProfile.uuid || latestProfile.id,
        };
      });
    };

    fetchLatestProfile();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, registeredUserId, profile]);

  const modalProfile = resolvedProfile || profile;

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
      console.log('[PROFILE_MODAL] Checking relationship status', { currentUserId, profileUserId, profileId: profile?.id });

      if (!currentUserId || !registeredUserId || currentUserId === registeredUserId) {
        console.log('[PROFILE_MODAL] Skipping check - missing or same user');
        return;
      }

      console.log('[PROFILE_MODAL] Getting relationship status between', { from: currentUserId, to: registeredUserId });
      setIsLoading(true);
      const status = await getRelationshipStatus(registeredUserId);
      console.log('[PROFILE_MODAL] Relationship status result:', status);
      setRelationshipStatus(status);
      setIsLoading(false);
    };

    if (isOpen && profile && currentUserId && hasPersistedUserProfile) {
      checkRelationship();
    }
  }, [isOpen, currentUserId, registeredUserId, hasPersistedUserProfile, profile]);

  // Handle friend request actions
  const handleAddFriend = async () => {
    if (!currentUserId || !registeredUserId || isLoading) {
      console.log('[PROFILE_MODAL] Cannot send friend request - missing data', { currentUserId, registeredUserId, isLoading });
      return;
    }

    console.log('[PROFILE_MODAL] Sending friend request from', currentUserId, 'to', registeredUserId);
    setIsLoading(true);
    const result = await sendFriendRequest(registeredUserId);

    if (result.success) {
      setRelationshipStatus({ id: result.data.id, status: 'pending' });
      console.info('Solicitud de amistad enviada');
    } else {
      notifyBlockingError(result.message || 'Error al enviar solicitud');
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
    const adminTargetId = profile?.id || profile?.usuario_id || registeredUserId;
    console.log('[MAKE_ADMIN] Opening confirmation modal', { playerId: adminTargetId, playerName: profile?.nombre });
    setShowAdminConfirm(true);
  };

  // Handle admin confirmation
  const handleConfirmAdmin = async () => {
    const adminTargetId = profile?.id || profile?.usuario_id || registeredUserId;
    if (!adminTargetId || !partidoActual?.id || !onMakeAdmin) {
      console.error('[MAKE_ADMIN] Missing required data', { profileId: adminTargetId, partidoId: partidoActual?.id, hasOnMakeAdmin: !!onMakeAdmin });
      notifyBlockingError('Error: datos incompletos');
      setShowAdminConfirm(false);
      return;
    }

    console.log('[MAKE_ADMIN] Confirming admin transfer for', { playerId: adminTargetId, playerName: profile?.nombre });
    setIsAdminLoading(true);

    try {
      await onMakeAdmin(adminTargetId);
      console.log('[MAKE_ADMIN] Admin transfer completed successfully');
      console.info('Admin asignado correctamente');
      setShowAdminConfirm(false);
      // NO cerrar el modal, mantenerlo abierto para que vea los cambios
    } catch (error) {
      console.error('[MAKE_ADMIN] Error during admin transfer:', error);
      notifyBlockingError('Error al asignar admin: ' + (error.message || 'intenta de nuevo'));
    } finally {
      setIsAdminLoading(false);
    }
  };

  // Handle contact player action
  const handleContactPlayer = async () => {
    console.log('[CONTACT] Starting contact player action', { profileId: registeredUserId, currentUserId });

    if (!registeredUserId || !currentUserId) {
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
      notifyBlockingError('Solo los admins pueden ver información de contacto');
      return;
    }

    try {
      const userId = registeredUserId;
      console.log('[CONTACT] Fetching phone for user:', { userId, profileId: profile?.id, usuarioId: profile?.usuario_id });

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
      notifyBlockingError('Error al obtener información de contacto');
    }
  };

  // Render make admin button
  const renderMakeAdminButton = () => {
    // Don't show if no partido or viewing own profile
    if (!partidoActual || !onMakeAdmin || !hasPersistedUserProfile || currentUserId === registeredUserId) {
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
    const isProfileUserAdmin = registeredUserId && (
      partidoActual?.creado_por === registeredUserId ||
      (partidoActual?.admins && partidoActual.admins.includes(registeredUserId))
    );

    // Don't show if profile user is already admin
    if (isProfileUserAdmin) {
      return null;
    }

    // Don't show if profile user doesn't have an account
    return (
      <button
        className={`${PROFILE_ACTION_BUTTON_BASE} ${PROFILE_ACTION_BUTTON_WARNING}`}
        onClick={handleMakeAdmin}
        disabled={isAdminLoading}
      >
        <span>{isAdminLoading ? 'Procesando...' : 'Hacer admin'}</span>
      </button>
    );
  };

  // Render contact player button
  const renderContactButton = () => {
    // Don't show if viewing own profile or no profile ID
    if (!hasPersistedUserProfile || currentUserId === registeredUserId) {
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
        className={`${PROFILE_ACTION_BUTTON_BASE} ${PROFILE_ACTION_BUTTON_INFO}`}
        onClick={handleContactPlayer}
      >
        <span>Contactar</span>
      </button>
    );
  };

  // Render friend action button based on relationship status
  const renderFriendActionButton = () => {
    // Check if it's the current user
    if (currentUserId === registeredUserId) {
      return null;
    }

    // Unregistered players can open the card, but have no social/admin/contact actions
    if (!hasPersistedUserProfile) {
      return null;
    }

    // If we don't have a profileUserId, don't render
    if (!registeredUserId) {
      return null;
    }

    if (!relationshipStatus) {
      return (
        <button
          className={`${PROFILE_ACTION_BUTTON_BASE} ${PROFILE_ACTION_BUTTON_PRIMARY} ${isLoading ? 'opacity-60 cursor-not-allowed hover:bg-[#6a43ff]' : ''}`}
          onClick={handleAddFriend}
          disabled={isLoading}
        >
          <span>{isLoading ? 'Enviando...' : 'Solicitar amistad'}</span>
        </button>
      );
    }

    if (relationshipStatus.status === 'pending') {
      return (
        <button className={`${PROFILE_ACTION_BUTTON_BASE} bg-[rgba(106,67,255,0.18)] border-[rgba(125,90,255,0.55)] text-[#cfc2ff] cursor-not-allowed`} disabled>
          <span>Solicitud Pendiente</span>
        </button>
      );
    }

    if (relationshipStatus.status === 'accepted') {
      return (
        <button className={`${PROFILE_ACTION_BUTTON_BASE} bg-[rgba(22,90,46,0.45)] border-[rgba(34,197,94,0.58)] text-[#dcfce7] cursor-not-allowed`} disabled>
          <span>✓ Amigos</span>
        </button>
      );
    }

    if (relationshipStatus.status === 'rejected') {
      return (
        <button
          className={`${PROFILE_ACTION_BUTTON_BASE} ${PROFILE_ACTION_BUTTON_PRIMARY} ${isLoading ? 'opacity-60 cursor-not-allowed hover:bg-[#6a43ff]' : ''}`}
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
      console.log('[PROFILE_MODAL] Modal opened for profile:', modalProfile?.id);
    } else {
      console.log('[PROFILE_MODAL] Modal closed');
    }
  }, [isOpen, modalProfile?.id]);

  const actionButtons = isOpen && hasPersistedUserProfile
    ? [renderFriendActionButton(), renderContactButton(), renderMakeAdminButton()].filter(Boolean)
    : [];
  const hasAwards = [
    Number(modalProfile?.mvp_badges ?? modalProfile?.mvps ?? 0),
    Number(modalProfile?.gk_badges ?? modalProfile?.guantes_dorados ?? 0),
    Number(modalProfile?.red_badges ?? modalProfile?.tarjetas_rojas ?? 0),
  ].some((count) => count > 0);
  const modalCardLayoutOverrides = hasAwards
    ? { leftAwardsShiftRight: '42px' }
    : null;
  const actionColsClass = actionButtons.length === 1
    ? 'grid-cols-1'
    : actionButtons.length === 2
      ? 'grid-cols-2'
      : 'grid-cols-3';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="w-[calc(100vw-1.5rem)] max-w-[360px] max-h-[calc(100vh-1.5rem)]"
      classNameContent="p-3 sm:p-4 overflow-x-hidden"
      closeOnBackdrop={true}
      closeOnEscape={true}
      title=""
      showCloseButton={true}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex justify-center items-center">
          <ProfileCard
            profile={modalProfile}
            isVisible={true}
            enableTilt={true}
            currentUserId={currentUserId}
            awardsLayout="space-left"
            cardMaxWidth={300}
            layoutOverrides={modalCardLayoutOverrides}
          />
        </div>
        {actionButtons.length > 0 && (
          <div className={`grid ${actionColsClass} gap-2 w-full max-w-[380px]`}>
            {actionButtons.map((button, index) => (
              <React.Fragment key={`profile-action-${index}`}>{button}</React.Fragment>
            ))}
          </div>
        )}

        {/* Contact Info Modal */}
        {showContactInfo && (
          <div data-modal-root="true" className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000]" onClick={() => setShowContactInfo(false)}>
            <div className="bg-[#1a1a1a] rounded-xl p-6 max-w-[400px] w-[90%] border-2 border-[#333] shadow-[0_8px_32px_rgba(0,0,0,0.5)] sm:p-5 sm:w-[95%]" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-white m-0 text-lg font-semibold sm:text-base">Contactar a {modalProfile?.nombre}</h3>
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
                    <div className="text-[#2196F3]"><Phone size={30} /></div>
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
                    <div className="text-[#FF9800] opacity-80"><PhoneOff size={30} /></div>
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

        <ConfirmModal
          isOpen={showAdminConfirm}
          title="Confirmar cambio de rol"
          message="Este jugador pasará a ser administrador del partido. ¿Confirmás?"
          confirmText="Confirmar"
          cancelText="Cancelar"
          isDeleting={isAdminLoading}
          onConfirm={handleConfirmAdmin}
          onCancel={() => {
            if (isAdminLoading) return;
            setShowAdminConfirm(false);
          }}
        />
      </div>
    </Modal>
  );
};

export default ProfileCardModal;
