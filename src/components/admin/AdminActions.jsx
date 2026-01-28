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
  const [showManual, setShowManual] = useState(false);

  if (!isAdmin) return null;

  return (
    <>
      {/* Add player section */}
      {!pendingInvitation && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 w-[90vw] max-w-[90vw] mx-auto box-border mb-0 mt-0">
          <div className="flex flex-col gap-3 w-full max-w-full box-border m-0 p-0">
            <button
              className="w-full h-12 min-h-[48px] text-[16px] rounded-[12px] bg-primary text-white font-bebas font-bold tracking-widest cursor-pointer transition-all flex items-center justify-center px-4 hover:brightness-110 shadow-[0_8px_32px_rgba(129,120,229,0.3)] active:scale-95 disabled:opacity-40"
              type="button"
              onClick={() => {
                console.log('Opening invite modal with:', { userId: user?.id, matchId: partidoActual?.id });
                setShowInviteModal(true);
              }}
              disabled={!partidoActual?.id || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
              aria-label="Invitar amigos al partido"
            >
              INVITAR AMIGOS
            </button>

            <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-800">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-oswald text-white/90 bg-slate-800 hover:bg-slate-700"
                type="button"
                onClick={() => setShowManual((v) => !v)}
                aria-expanded={showManual}
              >
                <span className="font-semibold">Agregar manualmente</span>
                <span className="text-white/60">{showManual ? 'Ocultar' : 'Mostrar'}</span>
              </button>
              {showManual && (
                <div className="p-3 flex flex-col gap-2 bg-slate-900">
                  <input
                    className="w-full h-11 min-h-[44px] max-h-[44px] text-[16px] rounded-[10px] m-0 bg-slate-900 border border-slate-700 text-white px-3 box-border font-oswald font-medium focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none placeholder:text-white/40 placeholder:text-sm"
                    type="text"
                    value={nuevoNombre}
                    onChange={(e) => setNuevoNombre(e.target.value)}
                    placeholder="Nombre del jugador"
                    disabled={loading || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                    ref={inputRef}
                    maxLength={40}
                    required
                    aria-label="Nombre del nuevo jugador"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        agregarJugador(e);
                      }
                    }}
                  />
                  <button
                    className="h-9 min-h-[36px] text-[14px] rounded-lg border border-slate-600 text-white/70 font-bebas font-bold tracking-wider cursor-pointer transition-all flex items-center justify-center px-3 hover:border-slate-500 hover:text-white/80 active:scale-95 disabled:opacity-30 bg-transparent"
                    type="button"
                    onClick={agregarJugador}
                    disabled={loading || isClosing || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                  >
                    {loading ? <LoadingSpinner size="small" /> : 'AGREGAR'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}


    </>
  );
};

export default AdminActions;