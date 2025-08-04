import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import ProfileCard from './ProfileCard';
import { useAmigos } from '../hooks/useAmigos';
import { supabase } from '../supabase';
import { toast } from 'react-toastify';
import './ProfileCardModal.css';

/**
 * Reusable modal component for displaying a player's ProfileCard
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {function} props.onClose - Function to close the modal
 * @param {Object} props.profile - Player profile data
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
        className={`pcm-friend-btn make-admin ${isAdminLoading ? 'disabled' : ''}`}
        onClick={handleMakeAdmin}
        disabled={isAdminLoading}
        style={{ background: '#FFD700', color: '#fff' }}
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
        className="pcm-friend-btn contact"
        onClick={handleContactPlayer}
        style={{ background: '#2196F3', color: '#fff' }}
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
          className={`pcm-friend-btn add ${isLoading ? 'disabled' : ''}`}
          onClick={handleAddFriend}
          disabled={isLoading}
        >
          <span>{isLoading ? 'Enviando...' : 'Solicitar amistad'}</span>
        </button>
      );
    }
    
    if (relationshipStatus.status === 'pending') {
      return (
        <button className="pcm-friend-btn pending" disabled>
          <span>Solicitud Pendiente</span>
        </button>
      );
    }
    
    if (relationshipStatus.status === 'accepted') {
      return (
        <button 
          className={`pcm-friend-btn remove ${isLoading ? 'disabled' : ''}`}
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
          className={`pcm-friend-btn add ${isLoading ? 'disabled' : ''}`}
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
      className="profile-card-modal"
      closeOnBackdrop={true}
      closeOnEscape={true}
    >
      <div className="pcm-content">
        <div className="pcm-card-container">
          <ProfileCard 
            profile={profile} 
            isVisible={true} 
            enableTilt={true}
            currentUserId={currentUserId}
            showFriendActions={false}
          />
        </div>
        <div className="pcm-actions">
          {renderFriendActionButton()}
          {renderMakeAdminButton()}
          {renderContactButton()}
        </div>
        
        {/* Contact Info Modal */}
        {showContactInfo && (
          <div className="contact-info-overlay" onClick={() => setShowContactInfo(false)}>
            <div className="contact-info-modal" onClick={(e) => e.stopPropagation()}>
              <div className="contact-info-header">
                <h3>📞 Contactar a {profile?.nombre}</h3>
                <button 
                  className="contact-info-close"
                  onClick={() => setShowContactInfo(false)}
                >
                  ×
                </button>
              </div>
              <div className="contact-info-content">
                {playerPhone ? (
                  <div className="contact-item-enhanced">
                    <div className="phone-icon">📞</div>
                    <div className="phone-details">
                      <div className="phone-label">Teléfono</div>
                      <span className="phone-number">
                        {playerPhone}
                      </span>
                    </div>
                    <div className="call-action">
                      <a href={`https://wa.me/${playerPhone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="call-btn">
                        WhatsApp
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="no-contact-info">
                    <div className="no-contact-icon">📵</div>
                    <div className="no-contact-text">
                      <div className="no-contact-title">Sin teléfono</div>
                      <div className="no-contact-subtitle">Este jugador no ha registrado su número</div>
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