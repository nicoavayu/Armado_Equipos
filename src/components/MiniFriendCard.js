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
                className="bg-none border-none text-[#d7e6ff] text-base cursor-pointer p-[4px_6px] rounded flex items-center justify-center transition-all duration-200 hover:bg-white/10 hover:text-white relative z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (buttonRef.current) {
                    const rect = buttonRef.current.getBoundingClientRect();
                    setMenuPosition({
                      top: rect.bottom + 8,
                      left: rect.left - 140 + rect.width,
                    });
                  }
                  setShowMenu(!showMenu);
                }}
                type="button"
                aria-label={`Opciones de ${name}`}
              >
                <MoreVertical size={18} />
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
            className="fixed bg-slate-900 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.3)] z-[9999] min-w-[160px] overflow-hidden max-[768px]:min-w-[180px] border border-slate-800"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              pointerEvents: 'auto',
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
