import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { updateProfile } from '../supabase';
import './GlobalHeader.css';

const GlobalHeader = ({ onProfileClick }) => {
  const { user, profile, refreshProfile } = useAuth();
  const { unreadCount, notifications } = useNotifications();
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState(false);
  const statusDropdownRef = useRef(null);
  const notificationsDropdownRef = useRef(null);
  
  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target)) {
        setShowStatusDropdown(false);
      }
      if (notificationsDropdownRef.current && !notificationsDropdownRef.current.contains(event.target)) {
        setShowNotificationsDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  if (!user) return null;
  
  // Get user initial or placeholder
  const getInitial = () => {
    if (profile?.avatar_url) return null;
    return profile?.nombre?.charAt(0) || user?.email?.charAt(0) || '?';
  };
  
  const userName = profile?.nombre || user?.email?.split('@')[0] || 'Usuario';
  const truncatedName = userName.length > 15 ? `${userName.substring(0, 15)}...` : userName;
  const isAvailable = profile?.acepta_invitaciones !== false;
  
  const toggleStatusDropdown = (e) => {
    e.stopPropagation();
    setShowStatusDropdown(!showStatusDropdown);
    setShowNotificationsDropdown(false);
  };
  
  const toggleNotificationsDropdown = (e) => {
    e.stopPropagation();
    setShowNotificationsDropdown(!showNotificationsDropdown);
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
            <div className="global-greeting">Hello,</div>
            <div className="global-username">{truncatedName}</div>
          </div>
          <div className={`global-status-text ${isAvailable ? 'available' : 'unavailable'}`}>
            {isAvailable ? 'Available' : 'Unavailable'}
          </div>
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
      <div className="global-header-right" ref={notificationsDropdownRef}>
        <div className="global-notifications" onClick={toggleNotificationsDropdown}>
          <div className="global-notifications-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width={24} height={24}>
              <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
            </svg>
          </div>
          {unreadCount?.total > 0 && (
            <div className="global-notification-badge">{unreadCount.total}</div>
          )}
        </div>
        
        {/* Notifications dropdown */}
        {showNotificationsDropdown && (
          <div className="global-notifications-dropdown">
            <div className="global-notifications-header">
              <span>Notifications</span>
              <span className="global-notifications-close" onClick={() => setShowNotificationsDropdown(false)}>×</span>
            </div>
            {notifications && notifications.length > 0 ? (
              notifications.slice(0, 5).map((notification, index) => (
                <div key={index} className="global-notification-item">
                  {notification.message || notification.content || 'New notification'}
                </div>
              ))
            ) : (
              <div className="global-notification-empty">No notifications</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalHeader;