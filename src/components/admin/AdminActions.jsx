import React, { useState } from 'react';
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
  if (!isAdmin) return null;

  const starterCapacity = Number(partidoActual?.cupo_jugadores || 0);
  const maxRosterSlots = starterCapacity > 0 ? starterCapacity + 2 : 0;
  const playersCount = Array.isArray(jugadores) ? jugadores.length : 0;
  const isRosterFull = maxRosterSlots > 0 && playersCount >= maxRosterSlots;

  return (
    <>
      {/* Add player section */}
      {!pendingInvitation && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 w-full max-w-full mx-auto box-border mb-0 mt-0">
          <div className="flex flex-col gap-3 w-full max-w-full box-border m-0 p-0">
            <button
              className="w-full h-12 min-h-[48px] text-[18px] rounded-[12px] bg-[#128BE9] text-white font-oswald font-semibold tracking-[0.01em] cursor-pointer transition-all flex items-center justify-center px-4 hover:brightness-110 shadow-[0_4px_14px_rgba(18,139,233,0.3)] active:scale-95 disabled:opacity-40"
              type="button"
              onClick={() => {
                setShowInviteModal(true);
              }}
              disabled={!partidoActual?.id || isRosterFull}
              aria-label="Invitar amigos al partido"
            >
              Invitar amigos
            </button>

            {/* Inline manual addition row */}
            <div className="flex gap-2 items-center w-full">
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
      )}


    </>
  );
};

export default AdminActions;
