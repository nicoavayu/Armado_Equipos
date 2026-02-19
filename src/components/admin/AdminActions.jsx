import React, { useEffect, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';

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
      {/* Add player section */}
      {!pendingInvitation && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 w-full max-w-full mx-auto box-border mb-0 mt-0">
          <div className="flex flex-col gap-2.5 w-full max-w-full box-border m-0 p-0">
            <div className="flex items-center gap-2 w-full">
              <button
                className="flex-[1.15] h-11 min-h-[44px] text-[16px] rounded-[10px] bg-[#128BE9] text-white font-oswald font-semibold tracking-[0.01em] cursor-pointer transition-all flex items-center justify-center px-3 hover:brightness-110 shadow-[0_4px_14px_rgba(18,139,233,0.3)] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                type="button"
                onClick={() => {
                  setShowInviteModal(true);
                }}
                disabled={!partidoActual?.id || isRosterFull}
                aria-label="Invitar amigos al partido"
              >
                Invitar amigos
              </button>

              <button
                className="flex-1 h-11 min-h-[44px] text-[16px] rounded-[10px] border border-[#128BE9]/35 bg-[#128BE9]/12 text-[#9fd7ff] font-oswald font-semibold tracking-[0.01em] cursor-pointer transition-all flex items-center justify-center px-3 hover:bg-[#128BE9]/22 hover:border-[#128BE9]/55 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
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
                {isManualOpen ? 'Ocultar manual' : 'Agregar manual'}
              </button>
            </div>

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
                  className="shrink-0 h-11 min-h-[44px] px-4 text-[16px] rounded-[10px] border border-[#128BE9]/30 bg-[#128BE9]/10 text-[#128BE9] font-oswald font-semibold tracking-[0.01em] cursor-pointer transition-all flex items-center justify-center hover:bg-[#128BE9]/20 hover:border-[#128BE9]/50 active:scale-95 disabled:opacity-30"
                  type="button"
                  onClick={agregarJugador}
                  disabled={!nuevoNombre?.trim() || loading || isClosing || isRosterFull}
                >
                  {loading ? <LoadingSpinner size="small" /> : 'Agregar'}
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
