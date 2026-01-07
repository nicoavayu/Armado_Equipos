import React, { useState } from 'react';
import { PlayerCardTrigger } from './ProfileComponents';
import InviteFriendModal from './InviteFriendModal';
import './MiniFriendCard.css';

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
    <div className="mini-friend-card">
      <PlayerCardTrigger profile={profile}>
        <div className="mini-friend-info">
          <div className="mini-avatar">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name}
                onError={(e) => {
                  e.target.style.display = 'none';
                  const initials = document.createElement('div');
                  initials.className = 'avatar-initials';
                  initials.textContent = getInitials(name);
                  initials.style.backgroundColor = getBackgroundColor(name);
                  e.target.parentNode.appendChild(initials);
                }}
              />
            ) : (
              <div 
                className="avatar-initials"
                style={{ backgroundColor: getBackgroundColor(name) }}
              >
                {getInitials(name)}
              </div>
            )}
          </div>
          <span className="mini-friend-name">
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
      
      <div className="mini-friend-menu">
        <button 
          className="menu-trigger"
          onClick={() => setShowMenu(!showMenu)}
        >
          ⋮
        </button>
        
        {showMenu && (
          <div className="menu-dropdown">
            <PlayerCardTrigger profile={profile}>
              <button className="menu-item">Ver perfil</button>
            </PlayerCardTrigger>
            <button 
              className="menu-item"
              onClick={() => {
                setShowInviteModal(true);
                setShowMenu(false);
              }}
            >
              Invitar a partido
            </button>
            <button 
              className="menu-item danger"
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
          className="menu-overlay"
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