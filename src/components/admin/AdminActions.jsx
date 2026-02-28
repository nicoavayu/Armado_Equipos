import React, { useEffect, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import WhatsappIcon from '../WhatsappIcon';

const INVITE_ACCEPT_BUTTON_VIOLET = '#644dff';
const INVITE_ACCEPT_BUTTON_VIOLET_DARK = '#4836bb';

/**
 * Admin action buttons component (add player, invite friends, toggle settings)
 * @param {Object} props - Component props
 */
const AdminActions = ({
  isAdmin,
  pendingInvitation,
  nuevoNombre,
  setNuevoNombre,
  loading,
  isClosing,
  partidoActual,
  jugadores,
  agregarJugador,
  setShowInviteModal,
  user,
  inputRef,
  onShareClick,
}) => {
  const [isManualOpen, setIsManualOpen] = useState(Boolean(String(nuevoNombre || '').trim()));
  const starterCapacity = Number(partidoActual?.cupo_jugadores || 0);
  const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 4 : 0;
  const playersCount = Array.isArray(jugadores) ? jugadores.length : 0;
  const isRosterFull = maxRosterSlots > 0 && playersCount >= maxRosterSlots;

  useEffect(() => {
    if (String(nuevoNombre || '').trim()) {
      setIsManualOpen(true);
    }
  }, [nuevoNombre]);

  if (!isAdmin) return null;

  return (
    <>
      <style>{`
        .invite-cta-btn {
          appearance: none;
          cursor: pointer;
          width: 100%;
          max-width: none;
          min-width: 0;
          height: 48px;
          padding-inline: 14px;
          display: flex;
          flex: 1 1 0;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          font-size: 0.94rem;
          font-weight: 700;
          letter-spacing: 0.045em;
          color: var(--btn-text, #fff);
          background: var(--btn);
          border: 1.5px solid var(--btn-dark);
          border-radius: 0;
          box-shadow: var(--btn-shadow, none);
          transform: skew(-6deg);
          transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
          backface-visibility: hidden;
          white-space: nowrap;
        }
        .invite-cta-btn > span {
          transform: skew(6deg);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .invite-cta-btn:hover:not(:disabled) {
          filter: brightness(1.08);
        }
        .invite-cta-btn:active:not(:disabled) {
          transform: skew(-6deg);
          opacity: 0.92;
        }
        .invite-cta-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
      `}</style>
      {/* Add player section */}
      {!pendingInvitation && (
        <div className="w-full max-w-full mx-auto box-border mb-0 mt-0">
          <div className="flex flex-col gap-2.5 w-full max-w-full box-border m-0 p-0">
            <div className="flex items-center gap-2 w-full">
              <button
                className="invite-cta-btn flex-[1.15]"
                style={{ '--btn': INVITE_ACCEPT_BUTTON_VIOLET, '--btn-dark': INVITE_ACCEPT_BUTTON_VIOLET_DARK, '--btn-text': '#ffffff' }}
                type="button"
                onClick={() => {
                  setShowInviteModal(true);
                }}
                disabled={!partidoActual?.id || isRosterFull}
                aria-label="Invitar amigos al partido"
              >
                <span>Invitar amigos</span>
              </button>

              <button
                className="invite-cta-btn flex-1"
                style={{ '--btn': 'rgba(23, 35, 74, 0.72)', '--btn-dark': 'rgba(88, 107, 170, 0.46)', '--btn-text': 'rgba(242, 246, 255, 0.9)', '--btn-shadow': '0 6px 16px rgba(0,0,0,0.25)' }}
                type="button"
                onClick={() => {
                  setIsManualOpen((prev) => {
                    const next = !prev;
                    if (next) {
                      window.setTimeout(() => inputRef?.current?.focus(), 0);
                    }
                    return next;
                  });
                }}
                disabled={isRosterFull}
                aria-expanded={isManualOpen}
                aria-label={isManualOpen ? 'Ocultar agregar manual' : 'Mostrar agregar manual'}
              >
                <span>Agregar manual</span>
              </button>
            </div>

            {typeof onShareClick === 'function' && (
              <div className="w-full flex items-center justify-end">
                <button
                  className="h-8 px-2.5 inline-flex items-center gap-1.5 text-white/65 border border-white/20 bg-transparent hover:text-white/85 hover:border-white/30 transition-colors text-[11px] font-oswald"
                  type="button"
                  onClick={() => onShareClick?.()}
                  aria-label="Compartir link por WhatsApp"
                  title="Compartir link por WhatsApp"
                >
                  <WhatsappIcon size={12} />
                  <span>Compartir link</span>
                </button>
              </div>
            )}

            {/* Manual input row */}
            <div className={`overflow-hidden transition-all duration-250 ${isManualOpen ? 'max-h-[70px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`}>
              <div className="flex gap-2 items-center w-full pt-0.5">
                <input
                  className="flex-1 h-11 min-h-[44px] max-h-[44px] text-[16px] rounded-[10px] m-0 bg-slate-800 border border-slate-700 text-white px-3 box-border font-oswald font-medium focus:border-[#128BE9] focus:ring-1 focus:ring-[#128BE9]/20 focus:outline-none placeholder:text-white/30 placeholder:text-sm"
                  type="text"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  placeholder="Agregar jugador manualmente"
                  disabled={loading || isRosterFull}
                  ref={inputRef}
                  maxLength={40}
                  required
                  aria-label="Nombre del nuevo jugador"
                  onFocus={() => setIsManualOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (nuevoNombre?.trim()) agregarJugador(e);
                    }
                  }}
                />
                <button
                  className="invite-cta-btn shrink-0 !w-auto px-4"
                  style={{ '--btn': 'rgba(23, 35, 74, 0.72)', '--btn-dark': 'rgba(88, 107, 170, 0.46)', '--btn-text': 'rgba(242, 246, 255, 0.9)', '--btn-shadow': '0 6px 16px rgba(0,0,0,0.25)' }}
                  type="button"
                  onClick={agregarJugador}
                  disabled={!nuevoNombre?.trim() || loading || isClosing || isRosterFull}
                >
                  <span>{loading ? <LoadingSpinner size="small" /> : 'Agregar'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


    </>
  );
};

export default AdminActions;
