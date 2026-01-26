import React, { useState } from 'react';
import { PlayerCardTrigger } from '../ProfileComponents';
import LoadingSpinner from '../LoadingSpinner';
import { MoreVertical, LogOut } from 'lucide-react';

/**
 * Players list section component
 * @param {Object} props - Component props
 */
const PlayersSection = ({
  isAdmin,
  jugadores,
  partidoActual,
  duplicatesDetected,
  votantesConNombres,
  transferirAdmin,
  user,
  eliminarJugador,
  isClosing,
  // Guest view props
  isPlayerInMatch,
  aceptarInvitacion,
  rechazarInvitacion,
  invitationLoading,
  setShowInviteModal,
  currentPlayerInMatch,
  // Menu & confirmation props
  actionsMenuOpen,
  setActionsMenuOpen,
  confirmConfig,
  setConfirmConfig,
  processingAction,
  handleAbandon,
}) => {
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const menuOpen = isAdmin ? (actionsMenuOpen !== undefined ? actionsMenuOpen : localMenuOpen) : false;
  const setMenuOpen = isAdmin && setActionsMenuOpen ? setActionsMenuOpen : setLocalMenuOpen;
  const renderPlayerCard = (j) => {
    const hasVoted = votantesConNombres.some((v) => v.nombre === j.nombre);

    return (
      <PlayerCardTrigger
        key={j.uuid}
        profile={j}
        partidoActual={partidoActual}
        onMakeAdmin={transferirAdmin}
      >
        <div
          className={`flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg p-2 transition-all min-h-[36px] w-full max-w-[660px] mx-auto hover:bg-slate-800 hover:border-slate-700 ${hasVoted ? 'border-2 border-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.25)]' : ''}`}
        >
          {j.foto_url || j.avatar_url ? (
            <img
              src={j.foto_url || j.avatar_url}
              alt={j.nombre}
              className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-sm shrink-0 text-white/70">👤</div>
          )}

          <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 break-words leading-tight">
            {j.nombre}
          </span>

          {/* Corona para admin */}
          {partidoActual?.creado_por === j.usuario_id && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" fill="#FFD700" style={{ flexShrink: 0 }}>
              <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
            </svg>
          )}

          {/* Botón eliminar - Solo admin puede eliminar otros */}
          {isAdmin && j.usuario_id !== user?.id ? (
            <button
              className="w-6 h-6 bg-fifa-danger/70 text-white/80 border-0 rounded-full font-bebas text-xl font-bold cursor-pointer transition-all flex items-center justify-center shrink-0 hover:bg-fifa-danger hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={(e) => {
                e.stopPropagation();
                const isOwnPlayer = j.usuario_id === user?.id;
                const confirmMessage = isOwnPlayer
                  ? '¿Estás seguro de que quieres salir del partido?'
                  : `¿Eliminar a ${j.nombre} del partido?`;
                if (window.confirm(confirmMessage)) {
                  eliminarJugador(j.uuid);
                }
              }}
              type="button"
              aria-label={j.usuario_id === user?.id ? 'Salir del partido' : 'Eliminar jugador'}
              disabled={isClosing}
              title={j.usuario_id === user?.id ? 'Salir del partido' : 'Eliminar jugador'}
            >
              ×
            </button>
          ) : null}
        </div>
      </PlayerCardTrigger>
    );
  };

  // Guest view (non-admin) OR user with pending invitation
  if (!isAdmin || (!isPlayerInMatch && jugadores.length > 0)) {
    return (
      <div style={{ position: 'fixed', top: isPlayerInMatch ? '70px' : '70px', left: '0', right: '0', zIndex: 10, marginBottom: '8px' }}>
        {/* Botones de invitado (solo si no está en el partido) */}
        {!isPlayerInMatch && (
          <div className="bg-white/10 border-2 border-white/20 rounded-xl p-3 w-[90vw] max-w-[90vw] mx-auto box-border mb-0 mt-2">
            <div className="flex flex-row gap-2 w-full">
              <button
                className="flex-1 font-bebas text-[15px] px-4 border-none rounded-[10px] cursor-pointer transition-all text-white h-11 min-h-[44px] flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed bg-[#128BE9] hover:bg-[#0f7acc]"
                onClick={aceptarInvitacion}
                disabled={invitationLoading || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                style={{
                  flex: 1,
                  fontSize: '13px',
                  padding: '10px 4px',
                  opacity: (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) ? 0.5 : 1,
                }}
              >
                {invitationLoading ? <LoadingSpinner size="small" /> : 'SUMARME AL PARTIDO'}
              </button>
              <button
                className="flex-1 font-bebas text-[15px] px-4 border-none rounded-[10px] cursor-pointer transition-all text-white h-11 min-h-[44px] flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed bg-fifa-danger hover:bg-red-700"
                onClick={rechazarInvitacion}
                disabled={invitationLoading}
                style={{
                  flex: 1,
                  fontSize: '13px',
                  padding: '10px 4px',
                  background: 'rgb(222 28 73)',
                  borderColor: 'rgb(222 28 73)',
                }}
              >
                {invitationLoading ? <LoadingSpinner size="small" /> : 'RECHAZAR INVITACIÓN'}
              </button>
            </div>
          </div>
        )}

        {/* Lista de jugadores para no-admin */}
        <div className="admin-players-section" style={{ marginTop: isPlayerInMatch ? '52px' : '12px' }}>
          <div className="admin-players-title">
            JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
          </div>
          {jugadores.length === 0 ? (
            <div className="admin-players-empty">
              <LoadingSpinner size="medium" />
            </div>
          ) : (
            <div className="admin-players-grid">
              {jugadores.map(renderPlayerCard)}
            </div>
          )}
        </div>

        {/* Botones para jugador ya en el partido (no-admin) */}
        {isPlayerInMatch && (
          <div className="w-[90vw] max-w-[90vw] box-border mx-auto mt-2">
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="flex-1 font-bebas text-[15px] px-4 border border-red-400/30 rounded-xl cursor-pointer transition-all text-white h-11 min-h-[44px] flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed bg-red-500/80 hover:brightness-110 active:scale-95 uppercase shadow-[0_8px_32px_rgba(244,68,68,0.3)]"
                onClick={() => {
                  if (window.confirm('¿Estás seguro de que quieres abandonar el partido?')) {
                    eliminarJugador(currentPlayerInMatch?.uuid || user.id, false);
                  }
                }}
              >
                ABANDONAR PARTIDO
              </button>
              <button
                className="flex-1 font-bebas text-[15px] px-4 border border-white/20 rounded-xl cursor-pointer transition-all text-white h-11 min-h-[44px] flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed bg-primary hover:brightness-110 active:scale-95 uppercase shadow-[0_8px_32px_rgba(129,120,229,0.3)]"
                onClick={() => setShowInviteModal(true)}
              >
                INVITAR AMIGOS
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Admin view
  return (
    <div className="bg-white/10 border-2 border-white/20 rounded-xl p-3 min-h-[120px] w-[90vw] max-w-[90vw] mx-auto mt-0 box-border">
      <div className="flex items-start justify-between gap-3 mb-3 mt-2">
        <div className="font-bebas text-xl text-white tracking-wide uppercase">
          JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
          {duplicatesDetected > 0 && isAdmin && (
            <span style={{
              color: '#ff6b35',
              fontSize: '12px',
              marginLeft: '10px',
              background: 'rgba(255, 107, 53, 0.1)',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid rgba(255, 107, 53, 0.3)',
            }}>
              ⚠️ {duplicatesDetected} duplicado{duplicatesDetected > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {isAdmin && isPlayerInMatch && (
          <div className="relative">
            <button
              className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white/90 transition-colors"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Más acciones"
              type="button"
              title="Acciones de administración"
            >
              <MoreVertical size={20} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1.5 w-48 rounded-lg border border-slate-700 bg-slate-900 shadow-lg z-20">
                <div className="py-1">
                  <button
                    className="w-full px-3 py-2 flex items-center gap-2 text-left text-slate-200 hover:bg-slate-800 transition-colors text-sm"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmConfig({ open: true, type: 'abandon' });
                    }}
                    type="button"
                  >
                    <LogOut size={14} />
                    <span>Abandonar partido</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {jugadores.length === 0 ? (
        <div className="text-center text-white/60 font-oswald text-base p-5 italic">
          <LoadingSpinner size="medium" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 w-full max-w-[720px] mx-auto justify-items-center box-border">
          {jugadores.map(renderPlayerCard)}
        </div>
      )}
    </div>
  );
};

export default PlayersSection;