import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import AvatarFallback from './AvatarFallback';

const MAX_GOALKEEPERS = 2;

const getPlayerKey = (player) => (
  String(player?.uuid || player?.id || player?.usuario_id || '').trim()
);

export default function GoalkeeperSelectModal({
  isOpen,
  players = [],
  onDismiss,
  onConfirm,
  isProcessing = false,
}) {
  const [visible, setVisible] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [showLimitHint, setShowLimitHint] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    setSelectedKeys([]);
    setShowLimitHint(false);
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        if (isProcessing) return;
        e.preventDefault();
        onDismiss && onDismiss();
      }
    };
    document.addEventListener('keydown', keyHandler, true);
    return () => document.removeEventListener('keydown', keyHandler, true);
  }, [isOpen, isProcessing, onDismiss]);

  if (!isOpen) {
    return null;
  }

  const togglePlayer = (player) => {
    const key = getPlayerKey(player);
    if (!key) return;

    setSelectedKeys((prev) => {
      if (prev.includes(key)) {
        setShowLimitHint(false);
        return prev.filter((k) => k !== key);
      }
      if (prev.length >= MAX_GOALKEEPERS) {
        setShowLimitHint(true);
        return prev;
      }
      setShowLimitHint(false);
      return [...prev, key];
    });
  };

  const handleOverlayClick = (e) => {
    if (isProcessing) return;
    e.preventDefault();
    e.stopPropagation();
    onDismiss && onDismiss();
  };

  const handleConfirm = (keys) => {
    if (isProcessing) return;
    const selectedPlayers = (players || []).filter((p) => keys.includes(getPlayerKey(p)));
    onConfirm && onConfirm(selectedPlayers);
  };

  const modalContent = (
    <div
      data-modal-root="true"
      className={`
        fixed inset-0 bg-black/80 z-[20000] flex items-center justify-center p-4
        transition-opacity duration-200 backdrop-blur-md
        ${visible ? 'opacity-100' : 'opacity-0'}
      `}
      style={{ pointerEvents: 'auto' }}
      onMouseDown={handleOverlayClick}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gk-modal-title"
      aria-describedby="gk-modal-message"
    >
      <div
        className={`
          w-full max-w-[500px] bg-white/5 backdrop-blur-2xl rounded-[var(--radius-standard)] p-6 shadow-[0_32px_64px_rgba(0,0,0,0.5)]
          border border-white/10 text-white transition-all duration-180 ease-[cubic-bezier(.2,.9,.3,1)]
          flex flex-col max-h-[min(80vh,640px)]
          ${visible ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0'}
        `}
        style={{ pointerEvents: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div id="gk-modal-title" className="text-2xl leading-none font-oswald font-semibold tracking-[0.01em] mb-2 text-white">
          ¿Hay arqueros fijos?
        </div>
        <div id="gk-modal-message" className="text-sm leading-relaxed text-white/70 mb-4 font-oswald">
          Seleccioná hasta 2 jugadores que van a atajar este partido.
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-0.5 mb-2">
          {(players || []).map((player) => {
            const key = getPlayerKey(player);
            const isSelected = selectedKeys.includes(key);
            return (
              <button
                key={key || player?.nombre}
                type="button"
                data-preserve-button-case="true"
                onClick={() => togglePlayer(player)}
                aria-pressed={isSelected}
                className={`w-full flex items-center gap-2.5 h-12 px-2.5 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                  isSelected
                    ? 'bg-[rgba(106,67,255,0.22)] border-[rgba(148,134,255,0.75)] shadow-[0_0_10px_rgba(106,67,255,0.3)]'
                    : 'bg-[rgba(23,35,74,0.55)] border-[rgba(148,134,255,0.22)] hover:bg-white/[0.06]'
                }`}
              >
                {player?.foto_url || player?.avatar_url ? (
                  <img
                    src={player.foto_url || player.avatar_url}
                    alt={player.nombre}
                    className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                  />
                ) : (
                  <AvatarFallback name={player?.nombre} size="w-8 h-8" />
                )}
                <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 truncate">
                  {player?.nombre}
                </span>
                {isSelected && (
                  <span className="shrink-0 font-bebas text-[10px] font-bold tracking-[0.08em] leading-none text-[#FDB022] px-1.5 py-[3px] rounded-[5px] border border-[#FDB022]/55 bg-[#FDB022]/10 shadow-[0_0_6px_rgba(253,176,34,0.25)]">
                    ARQ
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          className={`text-[12px] font-oswald text-amber-300/90 text-center leading-snug mb-3 transition-opacity duration-150 ${
            showLimitHint ? 'opacity-100' : 'opacity-0'
          }`}
          role="status"
          aria-hidden={!showLimitHint}
        >
          Máximo 2 arqueros fijos.
        </div>

        <div className="flex gap-3 justify-center">
          <button
            type="button"
            data-preserve-button-case="true"
            className="a2-press inline-flex h-[52px] min-w-[128px] items-center justify-center px-6 rounded-[var(--radius-standard)] text-center text-[16px] font-semibold tracking-[0.01em] font-oswald whitespace-nowrap cursor-pointer border bg-[rgba(23,35,74,0.72)] border-[rgba(148,134,255,0.2)] text-white hover:brightness-110 active:opacity-95 disabled:opacity-50 disabled:cursor-default transition-all"
            onClick={() => handleConfirm([])}
            disabled={isProcessing}
          >
            No hay
          </button>
          <button
            type="button"
            data-preserve-button-case="true"
            className="a2-press inline-flex h-[52px] min-w-[132px] items-center justify-center px-6 rounded-[var(--radius-standard)] text-center text-[16px] font-semibold tracking-[0.01em] font-oswald whitespace-nowrap cursor-pointer border text-white hover:brightness-110 active:opacity-95 disabled:opacity-50 disabled:cursor-default transition-all bg-[linear-gradient(132deg,#291686_0%,#3f24ba_48%,#5638e6_100%)] border-[rgba(132,112,255,0.58)] shadow-[0_0_14px_rgba(86,56,230,0.22)]"
            onClick={() => handleConfirm(selectedKeys)}
            disabled={isProcessing}
          >
            {isProcessing ? 'Procesando…' : 'Continuar'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
}
