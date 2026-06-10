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
      <div className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between min-h-[64px] w-screen px-4 pt-4 bg-[#120e28]/90 backdrop-blur-2xl border-b border-[rgba(148,134,255,0.14)] shadow-[0_10px_28px_rgba(5,3,16,0.45)]">
        <div className="flex items-center justify-center transform -translate-y-[5px] relative cursor-pointer pointer-events-auto">
          <div className="text-white font-oswald text-sm ml-px font-semibold tracking-[0.08em] uppercase opacity-90">Team Balancer</div>
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
    <div className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between min-h-[64px] w-screen px-4 pt-4 bg-[#120e28]/90 backdrop-blur-2xl border-b border-[rgba(148,134,255,0.14)] shadow-[0_10px_28px_rgba(5,3,16,0.45)]">
      {/* Left side - Avatar with status, greeting, name and status text */}
      <div className="flex flex-row items-center justify-center pointer-events-auto cursor-pointer transform -translate-y-[5px] relative" ref={statusDropdownRef}>
        <div className="relative ml-0.5 mr-3" onClick={toggleStatusDropdown}>
          <div className="rounded-full p-[2px] bg-[linear-gradient(140deg,rgba(139,92,255,0.7),rgba(106,67,255,0.2))]">
            <div className="w-9 h-9 rounded-full overflow-hidden bg-[#1d1740] flex items-center justify-center text-white font-bold text-sm">
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
          </div>
          <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#120e28] ${isAvailable ? 'bg-green-500' : 'bg-red-500'}`}></div>
        </div>

        <div className="flex flex-col" onClick={toggleStatusDropdown}>
          <div className="text-[10px] font-sans font-bold uppercase tracking-[0.14em] text-[#b0a0ff]/80 leading-none">Hola</div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="text-white font-oswald text-base font-bold tracking-[0.01em] leading-tight">{truncatedName}</div>
            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold leading-tight ${isAvailable ? 'border-green-400/30 bg-green-400/10 text-green-300' : 'border-red-400/30 bg-red-400/10 text-red-300'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isAvailable ? 'bg-green-400' : 'bg-red-400'}`} />
              {statusText}
            </span>
          </div>
        </div>

        {/* Status dropdown */}
        {showStatusDropdown && (
          <div className="absolute top-[56px] left-0 bg-[#141029]/97 border border-[rgba(148,134,255,0.25)] rounded-2xl w-[200px] z-[1000] overflow-hidden shadow-elev-3 backdrop-blur-xl">
            <div className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#b0a0ff]/85 border-b border-white/[0.08] font-sans">
              Estado
            </div>
            <div className="p-1.5 space-y-1">
              <div
                className={`flex items-center px-3 py-2.5 text-sm rounded-xl cursor-pointer transition-colors text-white border ${isAvailable ? 'bg-[#6a43ff]/25 border-[rgba(148,134,255,0.4)]' : 'border-transparent hover:bg-white/[0.07]'}`}
                onClick={() => updateAvailabilityStatus(true)}
              >
                <div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-green-400"></div>
                <span>Disponible</span>
              </div>
              <div
                className={`flex items-center px-3 py-2.5 text-sm rounded-xl cursor-pointer transition-colors text-white border ${!isAvailable ? 'bg-[#6a43ff]/25 border-[rgba(148,134,255,0.4)]' : 'border-transparent hover:bg-white/[0.07]'}`}
                onClick={() => updateAvailabilityStatus(false)}
              >
                <div className="w-2.5 h-2.5 rounded-full mr-2.5 bg-red-400"></div>
                <span>No disponible</span>
              </div>
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
