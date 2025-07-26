import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { updateProfile } from '../supabase';
import NotificationsBell from './NotificationsBell';
import NotificationsModal from './NotificationsModal';
import './GlobalHeader.css';

const GlobalHeader = ({ onProfileClick }) => {
  const { user, profile, refreshProfile } = useAuth();
  const { unreadCount } = useNotifications();
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const statusDropdownRef = useRef(null);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
        setShowStatusDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  // Si no hay usuario, mostrar solo el título
  if (!user) {
    return (
      <div className="global-header">
        <div className="global-header-left">
          <div className="global-greeting">Team Balancer</div>
        </div>
      </div>
    );
  }
  
  // Get user initial or placeholder
  const getInitial = () => {
    if (profile?.avatar_url) return null;
    return profile?.nombre?.charAt(0) || user?.email?.charAt(0) || '?';
  };
  
  const userName = profile?.nombre || user?.email?.split('@')[0] || 'Usuario';
  const truncatedName = userName.length > 15 ? `${userName.substring(0, 15)}...` : userName;
  const isAvailable = profile?.acepta_invitaciones !== false;

  // Traducción de estado
  const statusText = isAvailable ? 'Disponible' : 'Ocupado';
  
  const toggleStatusDropdown = (e) => {
    e.stopPropagation();
    setShowStatusDropdown(!showStatusDropdown);
  };
  
  const handleNotificationsClick = () => {
    setShowNotificationsModal(true);
    setShowStatusDropdown(false);
  };
  
  const updateAvailabilityStatus = async (status) => {
    if (!user) return;
    
    try {
      await updateProfile(user.id, { acepta_invitaciones: status });
      await refreshProfile();
      setShowStatusDropdown(false);
    } catch (error) {
      console.error('Error updating availability status:', error);
    }
  };
  
  return (
    <div className="global-header">
      {/* Left side - Avatar with status, greeting, name and status text */}
      <div className="global-header-left" ref={statusDropdownRef}>
        <div className="global-avatar-container" onClick={toggleStatusDropdown}>
          <div className="global-avatar">
            {profile?.avatar_url ? (
              <img 
                src={profile.avatar_url} 
                alt="Profile" 
              />
            ) : (
              <div>
                {getInitial()}
              </div>
            )}
          </div>
          <div className={`global-status-led ${isAvailable ? 'available' : 'unavailable'}`}></div>
        </div>
        
        <div className="global-user-info" onClick={toggleStatusDropdown}>
          <div className="global-greeting-name">
            <div className="global-greeting">Hola,</div>
            <div className="global-username">{truncatedName}</div>
          </div>
          <div className={`global-status-text ${isAvailable ? 'available' : 'unavailable'}`}>{statusText}</div>
        </div>
        
        {/* Status dropdown */}
        {showStatusDropdown && (
          <div className="global-status-dropdown">
            <div className="global-status-dropdown-header">
              Status
            </div>
            <div 
              className={`global-status-option ${isAvailable ? 'active' : ''}`}
              onClick={() => updateAvailabilityStatus(true)}
            >
              <div className="global-status-dot available"></div>
              <span>Available</span>
            </div>
            <div 
              className={`global-status-option ${!isAvailable ? 'active' : ''}`}
              onClick={() => updateAvailabilityStatus(false)}
            >
              <div className="global-status-dot unavailable"></div>
              <span>Unavailable</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Right side - Notifications */}
      <div className="global-header-right">
        <NotificationsBell 
          unreadCount={unreadCount} 
          onClick={handleNotificationsClick} 
        />
      </div>
      
      {/* Notifications Modal */}
      <NotificationsModal 
        isOpen={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
      />
    </div>
  );
};

export default GlobalHeader;