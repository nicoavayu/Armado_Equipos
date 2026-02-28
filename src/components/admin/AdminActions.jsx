import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
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
        .admin-primary-btn {
          appearance: none;
          cursor: pointer;
          width: 100%;
          height: 46px;
          padding: 0 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.95rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          color: #fff;
          background: ${INVITE_ACCEPT_BUTTON_VIOLET};
          border: 1.5px solid ${INVITE_ACCEPT_BUTTON_VIOLET_DARK};
          border-radius: 10px;
          transition: filter 120ms ease, opacity 120ms ease;
          white-space: nowrap;
        }
        .admin-primary-btn:hover:not(:disabled) {
          filter: brightness(1.08);
        }
        .admin-primary-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .admin-action-skew {
          appearance: none;
          cursor: pointer;
          width: 100%;
          height: 46px;
          border: 1.5px solid rgba(120, 90, 255, 0.34);
          background: rgba(17, 25, 54, 0.68);
          color: rgba(255, 255, 255, 0.78);
          border-radius: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transform: skew(-5deg);
          transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
        }
        .admin-action-skew > span {
          transform: skew(5deg);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .admin-action-skew:hover:not(:disabled),
        .admin-action-skew.is-active {
          background: rgba(30, 41, 83, 0.86);
          border-color: rgba(120, 90, 255, 0.52);
          color: #fff;
        }
        .admin-action-skew:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .admin-manual-submit {
          appearance: none;
          cursor: pointer;
          height: 44px;
          min-width: 92px;
          padding: 0 16px;
          border: 1.5px solid rgba(120, 90, 255, 0.36);
          background: rgba(23, 35, 74, 0.72);
          color: rgba(242, 246, 255, 0.9);
          border-radius: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transform: skew(-5deg);
          transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
        }
        .admin-manual-submit > span {
          transform: skew(5deg);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .admin-manual-submit:hover:not(:disabled) {
          background: rgba(31, 47, 96, 0.9);
          border-color: rgba(120, 90, 255, 0.54);
        }
        .admin-manual-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
      {/* Add player section */}
      {!pendingInvitation && (
        <div className="w-full max-w-full mx-auto box-border mb-0 mt-0">
          <div className="flex flex-col gap-2.5 w-full max-w-full box-border m-0 p-0">
            <button
              className="admin-primary-btn font-oswald"
              type="button"
              onClick={() => {
                setShowInviteModal(true);
              }}
              disabled={!partidoActual?.id || isRosterFull}
              aria-label="Invitar amigos al partido"
            >
              Invitar amigos
            </button>

            <div className="grid grid-cols-2 gap-2 w-full">
              <button
                className="admin-action-skew"
                type="button"
                onClick={() => {
                  onShareClick?.();
                }}
                disabled={typeof onShareClick !== 'function' || isRosterFull}
                aria-label="Compartir por WhatsApp"
                title="Compartir por WhatsApp"
              >
                <span>
                  <WhatsappIcon size={22} />
                </span>
              </button>

              <button
                className={`admin-action-skew ${isManualOpen ? 'is-active' : ''}`}
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
                title={isManualOpen ? 'Ocultar agregar manual' : 'Agregar manual'}
              >
                <span>
                  <Search size={22} strokeWidth={2.1} />
                </span>
              </button>
            </div>

            {/* Manual input row */}
            <div className={`overflow-hidden transition-all duration-250 ${isManualOpen ? 'max-h-[70px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`}>
              <div className="flex gap-2 items-center w-full pt-0.5">
                <input
                  className="flex-1 h-11 min-h-[44px] max-h-[44px] text-[16px] rounded-[10px] m-0 bg-slate-800/90 border border-slate-600 text-white px-3 box-border font-oswald font-medium focus:border-[#644dff] focus:ring-1 focus:ring-[#644dff]/25 focus:outline-none placeholder:text-white/30 placeholder:text-sm"
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
