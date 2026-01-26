import React, { useState } from 'react';
import { PlayerCardTrigger } from './ProfileComponents';
import InviteFriendModal from './InviteFriendModal';

const MiniFriendCard = ({ friend, onRemove, currentUserId, distanceKm }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const getInitials = (name) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getBackgroundColor = (name) => {
    if (!name) return '#ccc';
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const profile = friend.profile;
  const avatarUrl = profile?.avatar_url || profile?.foto_url;
  const name = profile?.nombre || 'Usuario';
  const rating = (typeof profile?.ranking === 'number' ? profile.ranking : (typeof profile?.rating === 'number' ? profile.rating : null));
  const ratingStr = rating != null ? rating.toFixed(1) : null;
  const distanceStr = typeof distanceKm === 'number' && isFinite(distanceKm) ? `${distanceKm.toFixed(1)} km` : null;

  return (
    <div className="relative flex items-center gap-2 p-[8px_12px] bg-white/90 rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-all duration-200 cursor-pointer overflow-visible hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] max-[768px]:p-[10px_14px] max-[480px]:rounded-2xl">
      <PlayerCardTrigger profile={profile}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-[#eee] shrink-0 max-[480px]:w-9 max-[480px]:h-9">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                  const initials = document.createElement('div');
                  initials.className = 'w-full h-full flex items-center justify-center text-white text-xs font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)] max-[480px]:text-[13px]';
                  initials.textContent = getInitials(name);
                  initials.style.backgroundColor = getBackgroundColor(name);
                  e.target.parentNode.appendChild(initials);
                }}
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-white text-xs font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)] max-[480px]:text-[13px]"
                style={{ backgroundColor: getBackgroundColor(name) }}
              >
                {getInitials(name)}
              </div>
            )}
          </div>
          <span className="text-sm font-medium text-[#333] whitespace-nowrap overflow-hidden text-ellipsis max-[768px]:text-[15px]">
            {name}
            {(ratingStr || distanceStr) && (
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#666', marginLeft: 8 }}>
                {ratingStr ? `⭐ ${ratingStr}` : ''}
                {ratingStr && distanceStr ? ' · ' : ''}
                {distanceStr ? `📍 ${distanceStr}` : ''}
              </span>
            )}
          </span>
        </div>
      </PlayerCardTrigger>

      <div className="relative">
        <button
          className="bg-none border-none text-[#666] text-base cursor-pointer p-[4px_6px] rounded flex items-center justify-center transition-all duration-200 hover:bg-black/10 hover:text-[#333]"
          onClick={() => setShowMenu(!showMenu)}
        >
          ⋮
        </button>

        {showMenu && (
          <div className="absolute top-full right-0 bg-white rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.15)] z-[999999] min-w-[140px] overflow-hidden mt-1 max-[768px]:min-w-[160px]">
            <PlayerCardTrigger profile={profile}>
              <button className="block w-full p-[10px_16px] bg-none border-none text-left text-sm text-[#333] cursor-pointer transition-colors hover:bg-black/5 max-[768px]:p-[12px_16px] max-[768px]:text-[15px]">Ver perfil</button>
            </PlayerCardTrigger>
            <button
              className="block w-full p-[10px_16px] bg-none border-none text-left text-sm text-[#333] cursor-pointer transition-colors hover:bg-black/5 max-[768px]:p-[12px_16px] max-[768px]:text-[15px]"
              onClick={() => {
                setShowInviteModal(true);
                setShowMenu(false);
              }}
            >
              Invitar a partido
            </button>
            <button
              className="block w-full p-[10px_16px] bg-none border-none text-left text-sm text-[#f44336] cursor-pointer transition-colors hover:bg-[#f44336]/10 max-[768px]:p-[12px_16px] max-[768px]:text-[15px]"
              onClick={() => {
                onRemove?.(friend);
                setShowMenu(false);
              }}
            >
              Eliminar amigo
            </button>
          </div>
        )}
      </div>

      {showMenu && (
        <div
          className="fixed inset-0 z-[999998]"
          onClick={() => setShowMenu(false)}
        />
      )}

      <InviteFriendModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        friend={friend}
        currentUserId={currentUserId}
      />
    </div>
  );
};

export default MiniFriendCard;