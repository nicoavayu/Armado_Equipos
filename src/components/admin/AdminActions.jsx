import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, UserPlus } from 'lucide-react';
import LoadingSpinner from '../LoadingSpinner';
import WhatsappIcon from '../WhatsappIcon';

const INVITE_ACCEPT_BUTTON_VIOLET = '#6a43ff';
const INVITE_ACCEPT_BUTTON_VIOLET_DARK = '#4e2fd3';

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
  const iconAccent = '#29aaff';
  const iconGlowFilter = 'none';
  const [isManualOpen, setIsManualOpen] = useState(Boolean(String(nuevoNombre || '').trim()));
  const [showQuickActionsMenu, setShowQuickActionsMenu] = useState(false);
  const quickActionsMenuRef = useRef(null);
  const starterCapacity = Number(partidoActual?.cupo_jugadores || 0);
  const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 4 : 0;
  const playersCount = Array.isArray(jugadores) ? jugadores.length : 0;
  const isRosterFull = maxRosterSlots > 0 && playersCount >= maxRosterSlots;
  const canShareInvite = typeof onShareClick === 'function' && !isRosterFull;
  const canAddManual = !isRosterFull;
  const canOpenQuickActions = canShareInvite || canAddManual;

  useEffect(() => {
    if (String(nuevoNombre || '').trim()) {
      setIsManualOpen(true);
    }
  }, [nuevoNombre]);

  useEffect(() => {
    if (!showQuickActionsMenu) return undefined;

    const handlePointerDown = (event) => {
      if (quickActionsMenuRef.current?.contains(event.target)) return;
      setShowQuickActionsMenu(false);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setShowQuickActionsMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showQuickActionsMenu]);

  if (!isAdmin) return null;

  return (
    <>
      <style>{`
        .admin-primary-btn {
          appearance: none;
          cursor: pointer;
          flex: 1 1 auto;
          min-width: 0;
          height: 44px;
          padding: 0 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.95rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: #fff;
          background: ${INVITE_ACCEPT_BUTTON_VIOLET};
          border: 1.5px solid ${INVITE_ACCEPT_BUTTON_VIOLET_DARK};
          border-radius: var(--radius-standard, 5px);
          transform: none;
          transition: filter 120ms ease, opacity 120ms ease;
          white-space: nowrap;
          backface-visibility: hidden;
        }
        .admin-primary-btn > span {
          transform: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .admin-primary-btn:hover:not(:disabled) {
          filter: brightness(1.06);
        }
        .admin-primary-btn:disabled {
          opacity: 0.52;
          cursor: not-allowed;
        }

        .admin-action-skew {
          appearance: none;
          cursor: pointer;
          width: 52px;
          min-width: 0;
          height: 44px;
          border: 1.5px solid rgba(106, 67, 255, 0.46);
          background: rgba(17, 25, 54, 0.68);
          color: rgba(255, 255, 255, 0.78);
          border-radius: var(--radius-standard, 5px);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transform: none;
          transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
        }
        .admin-action-skew > span {
          transform: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .admin-action-skew:hover:not(:disabled),
        .admin-action-skew.is-active {
          background: rgba(106, 67, 255, 0.22);
          border-color: rgba(106, 67, 255, 0.76);
          color: #fff;
        }
        .admin-action-skew:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .admin-quick-actions-wrap {
          position: relative;
          flex: 0 0 auto;
        }

        .admin-manual-submit {
          appearance: none;
          cursor: pointer;
          height: 44px;
          min-width: 92px;
          padding: 0 16px;
          border: 1.5px solid ${INVITE_ACCEPT_BUTTON_VIOLET_DARK};
          background: ${INVITE_ACCEPT_BUTTON_VIOLET};
          color: #fff;
          border-radius: var(--radius-standard, 5px);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transform: none;
          transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
        }
        .admin-manual-submit > span {
          transform: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .admin-manual-submit:hover:not(:disabled) {
          filter: brightness(1.06);
        }
        .admin-manual-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .admin-invite-actions-row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
          padding-inline: 4px;
          box-sizing: border-box;
        }

        .admin-quick-actions-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: min(248px, calc(100vw - 48px));
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1.5px solid rgba(106, 67, 255, 0.46);
          border-radius: var(--radius-standard, 5px);
          background: rgba(17, 25, 54, 0.98);
          box-shadow: 0 16px 32px rgba(0, 0, 0, 0.34);
          z-index: 20;
        }

        .admin-quick-actions-item {
          appearance: none;
          width: 100%;
          min-height: 46px;
          padding: 11px 14px;
          border: none;
          border-bottom: 1px solid rgba(106, 126, 202, 0.18);
          background: transparent;
          color: rgba(255, 255, 255, 0.92);
          text-align: left;
          font-size: 0.95rem;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
        }

        .admin-quick-actions-item:last-child {
          border-bottom: none;
        }

        .admin-quick-actions-item:hover:not(:disabled) {
          background: rgba(106, 67, 255, 0.16);
          color: #fff;
        }

        .admin-quick-actions-item:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
      {/* Add player section */}
      {!pendingInvitation && (
        <div className="w-full max-w-full mx-auto box-border mb-0 mt-0">
          <div className="flex flex-col gap-2.5 w-full max-w-full box-border m-0 p-0 overflow-visible">
            <div className="admin-invite-actions-row">
              <button
                className="admin-primary-btn font-oswald"
                type="button"
                onClick={() => {
                  setShowInviteModal(true);
                }}
                disabled={!partidoActual?.id || isRosterFull}
                aria-label="Invitar jugadores al partido"
              >
                <span>Invitar al partido</span>
              </button>

              <div className="admin-quick-actions-wrap" ref={quickActionsMenuRef}>
                <button
                  className={`admin-action-skew ${showQuickActionsMenu || isManualOpen ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => {
                    if (!canOpenQuickActions) return;
                    setShowQuickActionsMenu((prev) => !prev);
                  }}
                  disabled={!canOpenQuickActions}
                  aria-expanded={showQuickActionsMenu}
                  aria-haspopup="menu"
                  aria-label="Más opciones para invitar jugadores"
                  title="Más opciones para invitar jugadores"
                >
                  <span>
                    <UserPlus size={20} strokeWidth={2.05} style={{ color: iconAccent, filter: iconGlowFilter }} />
                  </span>
                </button>

                {showQuickActionsMenu ? (
                  <div className="admin-quick-actions-menu" role="menu" aria-label="Opciones para invitar jugadores">
                    <button
                      className="admin-quick-actions-item font-oswald"
                      type="button"
                      onClick={() => {
                        setShowQuickActionsMenu(false);
                        onShareClick?.();
                      }}
                      disabled={!canShareInvite}
                      role="menuitem"
                    >
                      <span className="inline-flex items-center gap-2">
                        <WhatsappIcon size={14} color="#25D366" />
                        <span>Invitar por WhatsApp</span>
                      </span>
                    </button>

                  <button
                    className="admin-quick-actions-item font-oswald"
                    type="button"
                    onClick={() => {
                      setShowQuickActionsMenu(false);
                      setIsManualOpen((prev) => {
                        if (!prev) {
                          window.setTimeout(() => inputRef?.current?.focus(), 0);
                        }
                        return true;
                      });
                    }}
                    disabled={!canAddManual}
                    role="menuitem"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Keyboard size={15} strokeWidth={2.05} style={{ color: iconAccent, filter: iconGlowFilter }} />
                      <span>Agregar manualmente</span>
                    </span>
                  </button>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Manual input row */}
            <div className={`overflow-hidden transition-all duration-250 ${isManualOpen ? 'max-h-[76px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`}>
              <div className="flex gap-2 items-center w-full pt-0.5">
                <input
                  className="flex-1 h-11 min-h-[44px] max-h-[44px] text-[16px] rounded-[5px] m-0 bg-slate-800/90 border border-slate-600 text-white px-3 box-border font-oswald font-medium focus:border-[#644dff] focus:ring-1 focus:ring-[#644dff]/25 focus:outline-none placeholder:text-white/30 placeholder:text-sm"
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
                  className="admin-manual-submit shrink-0"
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
