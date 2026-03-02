import React from 'react';
import ReactDOM from 'react-dom';
import { User, X, Star } from 'lucide-react';

const POS_MAP = {
  ARQ: 'ARQ',
  DEF: 'DEF',
  MED: 'MED',
  DEL: 'DEL',
  arquero: 'ARQ',
  defensor: 'DEF',
  mediocampista: 'MED',
  delantero: 'DEL',
};
const POS_COLOR_MAP = {
  ARQ: '#FDB022',
  DEF: '#FF6B9D',
  MED: '#06C270',
  DEL: '#FF3B3B',
};

const getPos = (p) => POS_MAP[p] || 'DEF';
const getPosColor = (p) => POS_COLOR_MAP[p] || '#8178e5';

const ACTION_BTN_BASE_CLASS = 'w-full min-w-0 h-[46px] px-4 rounded-none border font-bebas text-[15px] tracking-[0.01em] leading-tight transition-all inline-flex items-center justify-center text-center';
const ACTION_BTN_COMPACT_CLASS = 'px-2 text-[14px] whitespace-normal break-words';
const ACTION_BTN_PRIMARY_CLASS = 'bg-[#6a43ff] border-[#7d5aff] text-white shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:bg-[#7550ff] active:opacity-95';
const ACTION_BTN_SECONDARY_CLASS = 'bg-[rgba(20,31,70,0.82)] border-[rgba(98,117,184,0.58)] text-white/92 hover:bg-[rgba(30,45,94,0.95)] hover:text-white active:opacity-95';

const getFriendButtonConfig = (status, isSubmitting) => {
  if (isSubmitting) {
    return {
      label: 'Enviando...',
      disabled: true,
      className: 'bg-[rgba(20,31,70,0.72)] border-[rgba(98,117,184,0.5)] text-white/60 cursor-not-allowed opacity-70',
    };
  }

  if (status === 'accepted') {
    return {
      label: 'Ya son amigos',
      disabled: true,
      className: 'bg-[rgba(22,90,46,0.45)] border-[rgba(34,197,94,0.58)] text-[#dcfce7] cursor-not-allowed',
    };
  }

  if (status === 'pending') {
    return {
      label: 'Solicitud pendiente',
      disabled: true,
      className: 'bg-[rgba(106,67,255,0.18)] border-[rgba(125,90,255,0.55)] text-[#cfc2ff] cursor-not-allowed',
    };
  }

  return {
    label: 'Solicitar amistad',
    disabled: false,
    className: ACTION_BTN_PRIMARY_CLASS,
  };
};

const PlayerActionModal = ({
  isOpen,
  onClose,
  player,
  onInvite,
  onViewProfile,
  onAddFriend,
  friendStatus = null,
  isSubmittingFriend = false,
}) => {
  if (!isOpen || !player) return null;

  const rating = typeof player.rating === 'number'
    ? player.rating
    : (typeof player.ranking === 'number' ? player.ranking : 5.0);
  const position = getPos(player.posicion || player.rol_favorito || 'DEF');
  const positionColor = getPosColor(position);
  const friendBtn = getFriendButtonConfig(friendStatus, isSubmittingFriend);

  const modalContent = (
    <div data-modal-root="true" className="fixed inset-0 z-[9999] pointer-events-auto p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-[340px] bg-[#1e293b] border border-white/20 p-6 rounded-2xl shadow-2xl transition-transform duration-200 ease-out scale-100"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
          type="button"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center text-center gap-3 mb-6">
          <div className="w-20 h-20 rounded-full border-2 border-white/20 overflow-hidden bg-slate-800 flex items-center justify-center shrink-0 shadow-lg">
            {player.avatar_url ? (
              <img src={player.avatar_url} alt={player.nombre} className="w-full h-full object-cover" />
            ) : (
              <User size={40} className="text-white/50" />
            )}
          </div>
          <div>
            <h3 className="text-white font-oswald font-semibold text-3xl tracking-[0.01em] leading-none mb-1">{player.nombre}</h3>
            <div className="flex items-center justify-center gap-2 text-white/60 text-sm font-oswald uppercase tracking-wider">
              <span
                className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold text-white"
                style={{ backgroundColor: positionColor }}
              >
                {position}
              </span>
              <span>•</span>
              <span className="text-[#FFD700] inline-flex items-center gap-1 font-bold">
                <Star size={14} fill="currentColor" /> {rating.toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 font-oswald text-sm">
          <button
            onClick={() => {
              onInvite?.(player);
              onClose();
            }}
            className={`${ACTION_BTN_BASE_CLASS} ${ACTION_BTN_PRIMARY_CLASS} h-[48px] whitespace-nowrap`}
            type="button"
            data-preserve-button-case="true"
          >
            Invitar a un partido
          </button>

          <div className="grid grid-cols-2 gap-3 mt-1">
            <button
              onClick={() => {
                onViewProfile?.(player);
                onClose();
              }}
              className={`${ACTION_BTN_BASE_CLASS} ${ACTION_BTN_COMPACT_CLASS} ${ACTION_BTN_SECONDARY_CLASS}`}
              type="button"
              data-preserve-button-case="true"
            >
              Ver perfil
            </button>
            <button
              onClick={() => {
                if (!friendBtn.disabled) onAddFriend?.(player);
              }}
              className={`${ACTION_BTN_BASE_CLASS} ${ACTION_BTN_COMPACT_CLASS} ${friendBtn.className}`}
              type="button"
              disabled={friendBtn.disabled}
              data-preserve-button-case="true"
            >
              {friendBtn.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default PlayerActionModal;
