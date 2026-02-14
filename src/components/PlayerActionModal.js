import React from 'react';
import { User, UserPlus, CheckCircle2, Clock3, Trophy, X, Star } from 'lucide-react';

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

const getFriendButtonConfig = (status, isSubmitting) => {
  if (isSubmitting) {
    return {
      label: 'Enviando...',
      icon: <Clock3 size={16} />,
      disabled: true,
      className: 'bg-white/5 border border-white/10 text-white/60 cursor-not-allowed',
    };
  }

  if (status === 'accepted') {
    return {
      label: 'Ya son amigos',
      icon: <CheckCircle2 size={14} />,
      disabled: true,
      className: 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 cursor-not-allowed',
    };
  }

  if (status === 'pending') {
    return {
      label: 'Solicitud pendiente',
      icon: <Clock3 size={16} />,
      disabled: true,
      className: 'bg-[#8178e5]/15 border border-[#8178e5]/40 text-[#b9b2ff] cursor-not-allowed',
    };
  }

  return {
    label: 'Agregar',
    icon: <UserPlus size={16} />,
    disabled: false,
    className: 'bg-white/5 border border-white/10 text-white hover:bg-white/10 active:scale-95',
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
  anchorPoint = null,
}) => {
  if (!isOpen || !player) return null;

  const rating = typeof player.rating === 'number'
    ? player.rating
    : (typeof player.ranking === 'number' ? player.ranking : 5.0);
  const position = getPos(player.posicion || player.rol_favorito || 'DEF');
  const positionColor = getPosColor(position);
  const friendBtn = getFriendButtonConfig(friendStatus, isSubmittingFriend);
  const modalWidth = 340;
  const modalHeight = 420;
  const viewportPadding = 16;
  const clampedX = anchorPoint
    ? Math.min(
      Math.max(anchorPoint.x, (modalWidth / 2) + viewportPadding),
      window.innerWidth - (modalWidth / 2) - viewportPadding,
    )
    : null;
  const clampedY = anchorPoint
    ? Math.min(
      Math.max(anchorPoint.y, (modalHeight / 2) + viewportPadding),
      window.innerHeight - (modalHeight / 2) - viewportPadding,
    )
    : null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-auto p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-[340px] bg-[#1e293b] border border-white/20 p-6 rounded-2xl shadow-2xl transition-transform duration-200 ease-out scale-100"
        style={anchorPoint
          ? {
            position: 'fixed',
            left: `${clampedX}px`,
            top: `${clampedY}px`,
            transform: 'translate(-50%, -50%)',
          }
          : {
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
            className="w-full bg-[#128BE9] text-white py-4 rounded-xl font-oswald text-[18px] font-semibold tracking-[0.01em] hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg"
            type="button"
          >
            <Trophy size={18} />
            Invitar a un partido
          </button>

          <div className="grid grid-cols-2 gap-3 mt-1">
            <button
              onClick={() => {
                onViewProfile?.(player);
                onClose();
              }}
              className="bg-white/5 border border-white/10 text-white py-3 rounded-xl font-oswald text-[16px] font-semibold tracking-[0.01em] hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center gap-2"
              type="button"
            >
              <User size={16} />
              Ver perfil
            </button>
            <button
              onClick={() => {
                if (!friendBtn.disabled) onAddFriend?.(player);
              }}
              className={`py-3 px-2 rounded-xl font-oswald font-semibold text-[16px] tracking-[0.01em] leading-none transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-center ${friendBtn.className}`}
              type="button"
              disabled={friendBtn.disabled}
            >
              {friendBtn.icon}
              {friendBtn.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerActionModal;
