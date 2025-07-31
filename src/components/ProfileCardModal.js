import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import ProfileCard from './ProfileCard';
import { useAmigos } from '../hooks/useAmigos';
import { supabase } from '../supabase';
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
      if (window.showToast) {
        window.showToast('Solicitud de amistad enviada', 'success');
      }
    } else {
      if (window.showToast) {
        window.showToast(result.message || 'Error al enviar solicitud', 'error');
      }
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
        </div>
      </div>
    </Modal>
  );
};

export default ProfileCardModal;