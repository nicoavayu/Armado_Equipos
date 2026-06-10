import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useNotifications } from '../context/NotificationContext';
import { updateProfile } from '../supabase';
import NotificationsBell from './NotificationsBell';
import NotificationsModal from './NotificationsModal';

const GlobalHeader = ({ _onProfileClick }) => {
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
      <div className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between min-h-[64px] w-screen px-3 pt-4 bg-[#181334]/85 backdrop-blur-xl border-b border-white/[0.08] shadow-[0_6px_20px_rgba(6,4,18,0.35)]">
        <div className="flex items-center justify-center transform -translate-y-[5px] relative cursor-pointer pointer-events-auto">
          <div className="text-white font-oswald text-sm ml-px opacity-90 shadow-sm text-shadow-sm">Team Balancer</div>
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
    <div className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between min-h-[64px] w-screen px-3 pt-4 bg-[#181334]/85 backdrop-blur-xl border-b border-white/[0.08] shadow-[0_6px_20px_rgba(6,4,18,0.35)] md:px-4">
      {/* Left side - Avatar with status, greeting, name and status text */}
      <div className="flex flex-row items-center justify-center pointer-events-auto cursor-pointer transform -translate-y-[5px] relative" ref={statusDropdownRef}>
        <div className="relative ml-1.5 mr-3" onClick={toggleStatusDropdown}>
          <div className="w-9 h-9 rounded-full overflow-hidden bg-white/10 ring-1 ring-white/20 flex items-center justify-center text-white font-bold text-sm">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            ) : (
              <div>
                {getInitial()}
              </div>
            )}
          </div>
          <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white/80 ${isAvailable ? 'bg-green-500' : 'bg-red-500'}`}></div>
        </div>

        <div className="flex flex-col" onClick={toggleStatusDropdown}>
          <div className="flex items-baseline">
            <div className="text-white/70 font-oswald text-[13px] mr-1.5 shadow-sm text-shadow-sm">Hola,</div>
            <div className="text-white font-oswald text-base font-semibold tracking-[0.01em] shadow-sm text-shadow-sm">{truncatedName}</div>
          </div>
          <div className={`font-oswald text-[11px] mt-0.5 shadow-sm text-shadow-sm ${isAvailable ? 'text-green-400' : 'text-red-400'}`}>{statusText}</div>
        </div>

        {/* Status dropdown */}
        {showStatusDropdown && (
          <div className="absolute top-[56px] left-0 bg-[#1c1640]/97 border border-white/10 rounded-xl w-[180px] z-[1000] overflow-hidden shadow-elev-3 backdrop-blur-xl">
            <div className="px-4 py-2.5 text-[13px] font-semibold text-white/85 border-b border-white/10 font-oswald">
              Status
            </div>
            <div
              className={`flex items-center px-4 py-2.5 text-sm cursor-pointer transition-colors text-white hover:bg-white/[0.07] ${isAvailable ? 'bg-[#6a43ff]/25' : ''}`}
              onClick={() => updateAvailabilityStatus(true)}
            >
              <div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-green-400"></div>
              <span>Available</span>
            </div>
            <div
              className={`flex items-center px-4 py-2.5 text-sm cursor-pointer transition-colors text-white hover:bg-white/[0.07] ${!isAvailable ? 'bg-[#6a43ff]/25' : ''}`}
              onClick={() => updateAvailabilityStatus(false)}
            >
              <div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-red-400"></div>
              <span>Unavailable</span>
            </div>
          </div>
        )}
      </div>

      {/* Right side - Notifications */}
      <div className="flex items-center justify-end pointer-events-auto relative">
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
