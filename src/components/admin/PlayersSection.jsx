import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { PlayerCardTrigger } from '../ProfileComponents';
import LoadingSpinner from '../LoadingSpinner';
import ConfirmModal from '../ConfirmModal';
import { toast } from 'react-toastify';
import { MoreVertical, LogOut, Share2 } from 'lucide-react';
import { supabase } from '../../supabase';

// Helper function to get initials from name
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Empty state component for players list
 * @param {Object} props - Component props
 * @param {string} props.view - 'admin' or 'guest'
 * @param {Function} props.onShareClick - Optional callback for share action (admin only)
 */
const EmptyPlayersState = ({ view = 'guest', onShareClick }) => {
  if (view === 'admin') {
    return (
      <div className="text-center p-5">
        <div className="text-white/60 font-oswald text-base mb-2">
          Todavía no hay jugadores.
        </div>
        <div className="text-white/40 font-oswald text-sm leading-relaxed mb-4">
          Tocá <span className="text-white/60">+ Agregar jugador</span> (arriba) o compartí el link.
        </div>
        {onShareClick && (
          <button
            onClick={onShareClick}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-white/70 hover:text-white text-xs font-oswald font-semibold transition-all"
            type="button"
            title="Compartir enlace del partido"
          >
            <Share2 size={12} />
            Compartir link
          </button>
        )}
      </div>
    );
  }

  // Guest view - simple message
  return (
    <div className="text-center text-white/60 font-oswald text-base p-5 italic">
      Agregá jugadores para empezar el partido.
    </div>
  );
};

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
  votantes,
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
  confirmConfig: _confirmConfig,
  setConfirmConfig,
  processingAction: _processingAction,
  handleAbandon: _handleAbandon,
  invitationStatus,
  onInviteFriends,
  onAddManual,
}) => {
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuButtonRef = useRef(null);
  const adminMenuButtonRef = useRef(null);

  const menuOpen = isAdmin ? (actionsMenuOpen !== undefined ? actionsMenuOpen : localMenuOpen) : false;
  const setMenuOpen = isAdmin && setActionsMenuOpen ? setActionsMenuOpen : setLocalMenuOpen;
  const renderPlayerCard = (j) => {
    const hasVoted = votantesConNombres.some((v) => {
      if (!v.nombre || !j.nombre) return false;
      return v.nombre.toLowerCase().trim() === j.nombre.toLowerCase().trim();
    }) || (votantes && (votantes.includes(j.uuid) || votantes.includes(j.usuario_id)));

    return (
      <PlayerCardTrigger
        key={j.uuid}
        profile={j}
        partidoActual={partidoActual}
        onMakeAdmin={transferirAdmin}
      >
        <div
          className={`flex items-center gap-1.5 bg-slate-900 border rounded-lg p-2 transition-all min-h-[36px] w-full max-w-[660px] mx-auto hover:bg-slate-800 ${hasVoted ? 'border-emerald-500 hover:border-emerald-400 border-[1.5px]' : 'border-slate-800 hover:border-slate-700'}`}
        >
          {j.foto_url || j.avatar_url ? (
            <img
              src={j.foto_url || j.avatar_url}
              alt={j.nombre}
              className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-white">
              {getInitials(j.nombre)}
            </div>
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
                setPlayerToRemove({ id: j.id, nombre: j.nombre, isOwnPlayer: false });
              }}
              type="button"
              aria-label="Eliminar jugador"
              disabled={isClosing}
              title="Eliminar jugador"
            >
              ×
            </button>
          ) : null}
        </div>
      </PlayerCardTrigger >
    );
  };

  // Guest view (non-admin) OR user with pending invitation
  if (!isAdmin || (!isPlayerInMatch && jugadores.length > 0)) {
    return (
      <div className="w-full flex flex-col pb-32">
        {/* Lista de jugadores para no-admin */}
        <div className="w-[90vw] max-w-[90vw] mx-auto mt-2 bg-white/10 border-2 border-white/20 rounded-xl p-3 box-border min-h-[120px]">
          <div className="flex items-start justify-between gap-3 mb-3 mt-1 px-1">
            <div className="font-bebas text-xl text-white tracking-wide uppercase">
              JUGADORES ({jugadores.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
            </div>
            {isPlayerInMatch && (
              <div className="relative">
                <button
                  ref={menuButtonRef}
                  className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white/90 transition-colors"
                  onClick={() => {
                    if (menuButtonRef.current) {
                      const rect = menuButtonRef.current.getBoundingClientRect();
                      setMenuPosition({
                        top: rect.bottom + 8,
                        left: rect.left - 140 + rect.width,
                      });
                    }
                    setLocalMenuOpen(!localMenuOpen);
                  }}
                  aria-label="Opciones"
                  type="button"
                >
                  <MoreVertical size={20} />
                </button>
                {localMenuOpen && ReactDOM.createPortal(
                  <>
                    {/* Overlay transparente primero (z-index menor) */}
                    <div
                      className="fixed inset-0 z-[9998] bg-transparent"
                      onClick={() => setLocalMenuOpen(false)}
                    />
                    {/* Menú después (z-index mayor) con animación */}
                    <div
                      className="fixed w-48 rounded-lg border border-slate-700 bg-slate-900 shadow-xl z-[9999] overflow-hidden transition-all duration-200 ease-out"
                      style={{
                        top: `${menuPosition.top}px`,
                        left: `${menuPosition.left}px`,
                        opacity: localMenuOpen ? 1 : 0,
                        transform: localMenuOpen ? 'scale(1)' : 'scale(0.95)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="w-full px-4 py-3 flex items-center gap-3 text-left text-[#DE1C49] hover:bg-white/5 transition-colors font-medium text-[15px]"
                        onClick={() => {
                          setLocalMenuOpen(false);
                          setConfirmConfig({ open: true, type: 'abandon' });
                        }}
                        type="button"
                      >
                        <LogOut size={16} />
                        <span>Abandonar partido</span>
                      </button>
                    </div>
                  </>,
                  document.body,
                )}
              </div>
            )}
          </div>
          {jugadores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4 w-full">
              <button
                className="w-full max-w-xs h-14 rounded-xl bg-primary text-white font-bebas text-xl tracking-widest shadow-lg hover:brightness-110 active:scale-95 transition-all"
                type="button"
                onClick={() => setShowInviteModal(true)}
              >
                INVITAR AMIGOS
              </button>
              <button
                className="w-full max-w-xs h-14 rounded-xl bg-slate-800 text-white font-bebas text-xl tracking-widest border border-white/20 hover:bg-slate-700 active:scale-95 transition-all"
                type="button"
                onClick={() => {
                  // Simula el toggle "Mostrar" de AdminActions.jsx
                  const evt = new KeyboardEvent('keydown', { key: 'Enter' });
                  document.querySelector('input[placeholder="Nombre del jugador"]')?.focus();
                  document.querySelector('input[placeholder="Nombre del jugador"]')?.dispatchEvent(evt);
                }}
              >
                AGREGAR MANUALMENTE
              </button>
              {/* Botón compartir link solo si existe handler */}
              {typeof onShareClick === 'function' && (
                <button
                  className="mt-4 text-xs text-white/70 bg-white/10 px-3 py-2 rounded-lg border border-white/20 hover:bg-white/15 transition-all"
                  type="button"
                  onClick={onShareClick}
                >
                  Compartir link
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-[720px] mx-auto justify-items-center box-border">
              {jugadores.map(renderPlayerCard)}
            </div>
          )}
        </div>

        {/* Botones de acción - Static flow instead of fixed, closer to list */}
        <div className="w-full px-4 mt-6 relative z-10 text-center">
          {/* Texto de estado si faltan jugadores */}
          {(!partidoActual.cupo_jugadores || jugadores.length < partidoActual.cupo_jugadores) && (
            <div className="mb-4 text-white/60 font-oswald text-sm">
              {partidoActual.cupo_jugadores
                ? `Falta${partidoActual.cupo_jugadores - jugadores.length > 1 ? 'n' : ''} ${partidoActual.cupo_jugadores - jugadores.length} jugador${partidoActual.cupo_jugadores - jugadores.length > 1 ? 'es' : ''}`
                : 'Cupos disponibles'}
            </div>
          )}

          <div className="w-full max-w-[500px] mx-auto bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <div className="flex gap-3">
              {!isPlayerInMatch ? (
                // Guest View: Check if invitation is valid
                invitationStatus && invitationStatus !== 'pending' ? (
                  <div className="w-full flex flex-col items-center justify-center py-2 text-white/60">
                    <span className="font-bebas text-xl mb-1 opacity-80">
                      {invitationStatus === 'declined' ? 'INVITACIÓN RECHAZADA' : 'INVITACIÓN NO VÁLIDA'}
                    </span>
                    <span className="text-sm font-light opacity-60">
                      {invitationStatus === 'declined' ? 'Ya rechazaste esta invitación.' : 'Esta invitación ha expirado o ya fue respondida.'}
                    </span>
                  </div>
                ) : (
                  // Valid Pending Invitation
                  <>
                    <button
                      className="flex-[1.4] font-bebas text-[20px] h-14 rounded-xl cursor-pointer transition-all text-white flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed bg-[#128BE9] hover:bg-[#0f7acc] hover:shadow-[0_0_20px_rgba(18,139,233,0.4)] active:scale-95 shadow-[0_4px_10px_rgba(0,0,0,0.3)]"
                      onClick={aceptarInvitacion}
                      disabled={invitationLoading || (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)}
                    >
                      {invitationLoading ? <LoadingSpinner size="small" /> : 'ACEPTAR INVITACIÓN'}
                    </button>
                    <button
                      className="flex-1 font-bebas text-[18px] h-14 rounded-xl cursor-pointer transition-all text-white/80 flex items-center justify-center font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed bg-slate-800 hover:bg-slate-700 border border-white/10 active:scale-95 hover:text-white"
                      onClick={rechazarInvitacion}
                      disabled={invitationLoading}
                    >
                      NO PUEDO
                    </button>
                  </>
                )
              ) : (
                // Botones para jugador ya en el partido (guest view) - SOLO INVITAR
                <div className="flex flex-col w-full">
                  <button
                    className={`w-full font-bebas text-[18px] h-14 rounded-xl cursor-pointer transition-all text-white flex items-center justify-center font-bold tracking-wide bg-primary shadow-[0_4px_14px_rgba(129,120,229,0.3)]
                      ${(partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores)
                        ? 'opacity-40 grayscale cursor-not-allowed shadow-none'
                        : 'hover:brightness-110 active:scale-95'
                      }`}
                    onClick={() => {
                      if (partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) return;
                      setShowInviteModal(true);
                    }}
                    disabled={partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores}
                  >
                    INVITAR AMIGOS
                  </button>
                  {(partidoActual.cupo_jugadores && jugadores.length >= partidoActual.cupo_jugadores) && (
                    <div className="text-center text-white/40 font-oswald text-[12px] mt-1.5 uppercase tracking-wide">
                      Cupo completo ({jugadores.length}/{partidoActual.cupo_jugadores})
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
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
              ref={adminMenuButtonRef}
              className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white/90 transition-colors"
              onClick={() => {
                if (adminMenuButtonRef.current) {
                  const rect = adminMenuButtonRef.current.getBoundingClientRect();
                  setMenuPosition({
                    top: rect.bottom + 8,
                    left: rect.left - 140 + rect.width,
                  });
                }
                setMenuOpen(!menuOpen);
              }}
              aria-label="Más acciones"
              type="button"
              title="Acciones de administración"
            >
              <MoreVertical size={20} />
            </button>
            {menuOpen && ReactDOM.createPortal(
              <>
                {/* Overlay transparente primero (z-index menor) */}
                <div
                  className="fixed inset-0 z-[9998] bg-transparent"
                  onClick={() => setMenuOpen(false)}
                />
                {/* Menú después (z-index mayor) con animación */}
                <div
                  className="fixed w-48 rounded-lg border border-slate-700 bg-slate-900 shadow-lg z-[9999] transition-all duration-200 ease-out"
                  style={{
                    top: `${menuPosition.top}px`,
                    left: `${menuPosition.left}px`,
                    opacity: menuOpen ? 1 : 0,
                    transform: menuOpen ? 'scale(1)' : 'scale(0.95)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="py-1">
                    <button
                      className="w-full px-3 py-2 flex items-center gap-2 text-left text-[#DE1C49] hover:bg-slate-800 transition-colors text-sm font-medium"
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
              </>,
              document.body,
            )}
          </div>
        )}
      </div>
      {jugadores.length === 0 ? (
        <div className="w-full flex flex-col items-center justify-center py-10 px-6">
          <p className="text-sm text-white/70 text-center leading-relaxed max-w-[420px]">
            Usá ‘Invitar amigos’ o ‘Agregar manualmente’ arriba para sumar jugadores.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 w-full max-w-[720px] mx-auto justify-items-center box-border">
          {jugadores.map(renderPlayerCard)}
        </div>
      )}

      <ConfirmModal
        isOpen={playerToRemove !== null}
        title="Eliminar jugador"
        message={`¿Eliminar a ${playerToRemove?.nombre} del partido?`}
        onConfirm={() => {
          if (playerToRemove) {
            eliminarJugador(playerToRemove.id);
            setPlayerToRemove(null);
          }
        }}
        onCancel={() => setPlayerToRemove(null)}
        confirmText="Eliminar"
        cancelText="Cancelar"
        isDeleting={isClosing}
      />
    </div>
  );
};

export default PlayersSection;