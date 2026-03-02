import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { PlayerCardTrigger } from './ProfileComponents';
import InviteToMatchModal from './InviteToMatchModal';
import PlayerMiniCard from './PlayerMiniCard';

const MiniFriendCard = ({ friend, onRequestRemoveClick, currentUserId }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const buttonRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const profile = friend.profile;
  const name = profile?.nombre || 'Usuario';

  // Debug logs
  console.log('[MINI_FRIEND_CARD] Render state:', { showMenu, showInviteModal, name });

  const getSafeMenuPosition = (rect) => {
    const menuWidth = 192; // w-48
    const menuHeight = 108;
    const margin = 12;
    const rawLeft = rect.right - menuWidth;
    const safeLeft = Math.min(
      Math.max(margin, rawLeft),
      Math.max(margin, window.innerWidth - menuWidth - margin),
    );
    const safeTop = Math.min(
      rect.bottom + 8,
      Math.max(margin, window.innerHeight - menuHeight - margin),
    );

    return { top: safeTop, left: safeLeft };
  };

  return (
    <div className="relative overflow-visible">
      <PlayerCardTrigger profile={profile}>
        <PlayerMiniCard
          profile={profile}
          variant="friend"
          onClick={() => {}}
          rightSlot={(
            <div className="relative z-0">
              <button
                ref={buttonRef}
                className="kebab-menu-btn relative z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (buttonRef.current) {
                    const rect = buttonRef.current.getBoundingClientRect();
                    setMenuPosition(getSafeMenuPosition(rect));
                  }
                  setShowMenu(!showMenu);
                }}
                type="button"
                aria-label={`Opciones de ${name}`}
              >
                <MoreVertical size={16} />
              </button>
            </div>
          )}
        />
      </PlayerCardTrigger>

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
            className="fixed z-[9999] w-48 rounded-none border border-[rgba(88,107,170,0.62)] bg-[rgba(7,19,48,0.98)] shadow-lg overflow-hidden"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              pointerEvents: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              <button
                className="w-full px-3 py-2 text-left text-sm font-medium text-slate-100 transition-colors hover:bg-[rgba(19,38,88,0.95)]"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowInviteModal(true);
                  setShowMenu(false);
                }}
              >
                Invitar a partido
              </button>
              <button
                className="w-full px-3 py-2 text-left text-sm font-medium text-red-200 transition-colors hover:bg-[rgba(19,38,88,0.95)]"
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
          </div>
        </>,
        document.body,
      )}

      <InviteToMatchModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        friend={friend}
        currentUserId={currentUserId}
      />
    </div>
  );
};
export default MiniFriendCard;
