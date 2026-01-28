import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { PlayerCardTrigger } from './ProfileComponents';
import InviteFriendModal from './InviteFriendModal';

// Helper functions para posición
const getPos = (p) => {
  const map = { 'ARQ': 'ARQ', 'DEF': 'DEF', 'MED': 'MED', 'DEL': 'DEL', 'arquero': 'ARQ', 'defensor': 'DEF', 'mediocampista': 'MED', 'delantero': 'DEL' };
  return map[p] || 'DEF';
};

const getPosColor = (p) => {
  const map = { 'ARQ': '#FDB022', 'DEF': '#FF6B9D', 'MED': '#06C270', 'DEL': '#FF3B3B' };
  return map[p] || '#8178e5';
};

// SVG Star component
const StarSVG = ({ size = 16, color = '#FFD700' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const MiniFriendCard = ({ friend, onRemove, onRequestRemoveClick, currentUserId, distanceKm }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const buttonRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

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
  const rating = (typeof profile?.ranking === 'number' ? profile.ranking : (typeof profile?.calificacion === 'number' ? profile.calificacion : null));
  const ratingStr = rating != null ? rating.toFixed(1) : null;
  const distanceStr = typeof distanceKm === 'number' && isFinite(distanceKm) ? `${distanceKm.toFixed(1)} km` : null;
  const posicion = getPos(profile?.posicion || profile?.rol_favorito || 'DEF');
  const posColor = getPosColor(posicion);

  // Debug logs
  console.log('[MINI_FRIEND_CARD] Render state:', { showMenu, showInviteModal, name });

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
          </span>
          
          {/* Stats row: Rating + Position + Distance */}
          <div style={{ fontSize: '12px', fontWeight: 500, color: '#666', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Rating with SVG star */}
            {ratingStr && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <StarSVG size={14} color="#FFD700" />
                <span>{ratingStr}</span>
              </div>
            )}
            
            {/* Position badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: posColor,
                color: 'white',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                minWidth: '28px',
                textAlign: 'center'
              }}
            >
              {posicion}
            </div>
            
            {/* Distance */}
            {distanceStr && (
              <span>📍 {distanceStr}</span>
            )}
          </div>
        </div>
      </PlayerCardTrigger>

      <div className="relative z-0">
        <button
          ref={buttonRef}
          className="bg-none border-none text-[#666] text-base cursor-pointer p-[4px_6px] rounded flex items-center justify-center transition-all duration-200 hover:bg-black/10 hover:text-[#333] relative z-10"
          onClick={(e) => {
            e.stopPropagation();
            if (buttonRef.current) {
              const rect = buttonRef.current.getBoundingClientRect();
              setMenuPosition({
                top: rect.bottom + 8,
                left: rect.left - 140 + rect.width
              });
            }
            setShowMenu(!showMenu);
          }}
        >
          ⋮
        </button>
      </div>

      {showMenu && ReactDOM.createPortal(
        <>
          {/* Overlay primero (z-index menor) */}
          <div
            className="fixed inset-0 z-[9998] bg-transparent"
            style={{ pointerEvents: 'auto' }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('[MINI_FRIEND_CARD] Menu overlay clicked');
              setShowMenu(false);
            }}
          />
          {/* Menú después (z-index mayor) */}
          <div
            className="fixed bg-slate-900 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.3)] z-[9999] min-w-[160px] overflow-hidden max-[768px]:min-w-[180px] border border-slate-800"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              pointerEvents: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="block w-full p-[12px_16px] bg-none border-none text-left text-sm text-[#2196F3] cursor-pointer transition-colors hover:bg-slate-800 font-medium max-[768px]:p-[14px_16px] max-[768px]:text-[15px]"
              onClick={(e) => {
                e.stopPropagation();
                setShowInviteModal(true);
                setShowMenu(false);
              }}
            >
              Invitar a partido
            </button>
            <div className="h-[1px] bg-slate-700" />
            <button
              className="block w-full p-[12px_16px] bg-none border-none text-left text-sm text-[#DE1C49] cursor-pointer transition-colors hover:bg-slate-800 font-medium max-[768px]:p-[14px_16px] max-[768px]:text-[15px]"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                // Delegarle a AmigosView para abrir el modal centralizado
                onRequestRemoveClick?.(friend);
              }}
            >
              Eliminar amigo
            </button>
          </div>
        </>,
        document.body
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