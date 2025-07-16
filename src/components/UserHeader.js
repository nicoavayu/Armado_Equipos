import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../supabase';

const UserHeader = ({ user, profile, onProfileUpdate }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setShowDropdown(false);
  };

  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || 
    `https://api.dicebear.com/7.x/initials/svg?seed=${user?.email}`;

  return (
    <>
      <div className="user-header">
        <div className="user-avatar-container" ref={dropdownRef}>
          <img
            src={avatarUrl}
            alt="Profile"
            className="user-avatar"
            onClick={() => setShowDropdown(!showDropdown)}
          />
          {showDropdown && (
            <div className="user-dropdown">
              <div className="dropdown-item" onClick={() => {
                setShowDropdown(false);
                // Profile functionality moved to ProfileIcon in Home
              }}>
                <span>👤</span>
                My Profile
              </div>
              <div className="dropdown-divider"></div>
              <div className="dropdown-item logout" onClick={handleSignOut}>
                <span>🚪</span>
                Sign Out
              </div>
            </div>
          )}
        </div>
      </div>


    </>
  );
};

export default UserHeader;