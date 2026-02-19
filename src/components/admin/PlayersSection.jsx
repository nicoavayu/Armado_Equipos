import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { PlayerCardTrigger } from '../ProfileComponents';
import LoadingSpinner from '../LoadingSpinner';
import ConfirmModal from '../ConfirmModal';
import { MoreVertical, LogOut } from 'lucide-react';
import WhatsappIcon from '../WhatsappIcon';
import { notifyBlockingError } from 'utils/notifyBlockingError';

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
          Usá 'Invitar amigos', 'Agregar manualmente' o compartí el link para sumar jugadores.
        </div>
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
  onShareClick,
  onShareRosterUpdate,
  unirseAlPartido,
}) => {
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState(null);
  const [isRemovingPlayer, setIsRemovingPlayer] = useState(false);
  const [isTitularesOpen, setIsTitularesOpen] = useState(true);
  const [isSuplentesOpen, setIsSuplentesOpen] = useState(true);
  const [isSharingUpdate, setIsSharingUpdate] = useState(false);
  const [shareUpdateHint, setShareUpdateHint] = useState('');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuButtonRef = useRef(null);
  const adminMenuButtonRef = useRef(null);
  const shareHintTimeoutRef = useRef(null);

  const menuOpen = isAdmin ? (actionsMenuOpen !== undefined ? actionsMenuOpen : localMenuOpen) : false;
  const setMenuOpen = isAdmin && setActionsMenuOpen ? setActionsMenuOpen : setLocalMenuOpen;
  const capacity = Number(partidoActual?.cupo_jugadores || 0);
  const maxRosterSlots = capacity > 0 ? capacity + 2 : 0;
  const titularPlayers = jugadores.filter((j) => !j?.is_substitute);
  const substitutePlayers = jugadores.filter((j) => !!j?.is_substitute);
  const remainingTitularSlots = capacity > 0 ? Math.max(0, capacity - titularPlayers.length) : null;
  const isMatchFull = maxRosterSlots > 0 && jugadores.length >= maxRosterSlots;
  const canShareInviteLink = isAdmin && typeof onShareClick === 'function' && !isMatchFull;
  const hasJoinCode = Boolean(String(partidoActual?.codigo || '').trim());
  const canShareRosterUpdate =
    isAdmin &&
    typeof onShareRosterUpdate === 'function' &&
    Boolean(partidoActual?.id) &&
    hasJoinCode &&
    capacity > 0;

  useEffect(() => () => {
    if (shareHintTimeoutRef.current) {
      window.clearTimeout(shareHintTimeoutRef.current);
    }
  }, []);

  const getSafeMenuPosition = (rect) => {
    const menuWidth = 192; // w-48
    const margin = 12;
    const rawLeft = rect.right - menuWidth;
    const safeLeft = Math.min(
      Math.max(margin, rawLeft),
      Math.max(margin, window.innerWidth - menuWidth - margin),
    );
    const safeTop = Math.min(rect.bottom + 8, Math.max(margin, window.innerHeight - 160));
    return { top: safeTop, left: safeLeft };
  };

  const handleConfirmRemovePlayer = async () => {
    if (!playerToRemove?.id) return;
    setIsRemovingPlayer(true);
    try {
      await eliminarJugador(playerToRemove.id, true);
      console.info(`${playerToRemove.nombre || 'Jugador'} fue expulsado del partido`);
      setPlayerToRemove(null);
    } catch (error) {
      notifyBlockingError(error?.message || 'No se pudo expulsar al jugador');
    } finally {
      setIsRemovingPlayer(false);
    }
  };

  const showShareHint = (message) => {
    setShareUpdateHint(message);
    if (shareHintTimeoutRef.current) {
      window.clearTimeout(shareHintTimeoutRef.current);
    }
    shareHintTimeoutRef.current = window.setTimeout(() => {
      setShareUpdateHint('');
    }, 1500);
  };

  const handleShareRosterUpdateClick = async () => {
    if (!canShareRosterUpdate || isSharingUpdate) return;
    setIsSharingUpdate(true);
    try {
      const shared = await onShareRosterUpdate?.();
      if (shared) {
        showShareHint('Compartido ✓');
      }
    } catch (error) {
      console.error('Error sharing roster update:', error);
    } finally {
      setIsSharingUpdate(false);
    }
  };
  const renderPlayerCard = (j) => {
    const hasVoted = votantesConNombres.some((v) => {
      if (!v.nombre || !j.nombre) return false;
      return v.nombre.toLowerCase().trim() === j.nombre.toLowerCase().trim();
    }) || (votantes && (votantes.includes(j.uuid) || votantes.includes(j.usuario_id)));

    return (
      <PlayerCardTrigger
        key={j.uuid || j.id || `${j.nombre}-${j.usuario_id || 'manual'}`}
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

  const showSubstituteSection = substitutePlayers.length > 0 || (capacity > 0 && titularPlayers.length >= capacity);
  const isTitularesComplete = capacity > 0 && titularPlayers.length >= capacity;
  const jugadoresCompleteBadge = isTitularesComplete ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-emerald-300/35 bg-emerald-500/15 text-emerald-200 text-[10px] font-oswald font-semibold tracking-wide uppercase ml-2">
      Completo
    </span>
  ) : null;

  const renderRosterSections = () => (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-white/15 bg-black/15 p-2.5">
        <div
          className="flex items-center justify-between px-1 mb-2"
          onClick={() => setIsTitularesOpen((prev) => !prev)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsTitularesOpen((prev) => !prev);
            }
          }}
          aria-expanded={isTitularesOpen}
          aria-label="Toggle titulares"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bebas text-sm tracking-wide text-white/90 uppercase">Titulares</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-oswald text-white/65">
              {titularPlayers.length}/{partidoActual.cupo_jugadores || 'Sin límite'}
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-white/65 transition-transform duration-300"
              style={{ transform: isTitularesOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}
              aria-hidden="true"
            >
              <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <div
          className="overflow-hidden transition-all duration-300"
          style={{
            maxHeight: isTitularesOpen ? '1200px' : '0px',
            opacity: isTitularesOpen ? 1 : 0,
            transition: 'max-height 300ms ease, opacity 300ms ease',
          }}
        >
          {titularPlayers.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-[720px] mx-auto justify-items-center box-border">
              {titularPlayers.map(renderPlayerCard)}
            </div>
          ) : (
            <div className="text-center text-[12px] text-white/55 font-oswald py-2">Todavía no hay titulares.</div>
          )}
        </div>
      </div>

      {showSubstituteSection && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5">
          <div
            className="flex items-center justify-between px-1 mb-2"
            onClick={() => setIsSuplentesOpen((prev) => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsSuplentesOpen((prev) => !prev);
              }
            }}
            aria-expanded={isSuplentesOpen}
            aria-label="Toggle suplentes"
          >
            <span className="font-bebas text-sm tracking-wide text-amber-100 uppercase">Suplentes</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-oswald text-amber-200/85">{substitutePlayers.length}/2</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-amber-200/85 transition-transform duration-300"
                style={{ transform: isSuplentesOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}
                aria-hidden="true"
              >
                <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <div
            className="overflow-hidden transition-all duration-300"
            style={{
              maxHeight: isSuplentesOpen ? '1200px' : '0px',
              opacity: isSuplentesOpen ? 1 : 0,
              transition: 'max-height 300ms ease, opacity 300ms ease',
            }}
          >
            {substitutePlayers.length > 0 ? (
              <div className="grid grid-cols-2 gap-2.5 w-full max-w-[720px] mx-auto justify-items-center box-border">
                {substitutePlayers.map(renderPlayerCard)}
              </div>
            ) : null}
          </div>
          <div className="mt-2 text-center text-[11px] text-amber-100/85 font-oswald tracking-wide leading-snug">
            Si se libera un cupo titular, los suplentes pasan automáticamente a la nómina.
          </div>
        </div>
      )}
    </div>
  );

  // Guest view (non-admin) OR user with pending invitation
  if (!isAdmin || (!isPlayerInMatch && jugadores.length > 0)) {
    return (
      <>
        <div className="w-full flex flex-col pb-32">
        {/* Lista de jugadores para no-admin */}
        <div className="w-full max-w-full mx-auto mt-2 bg-white/10 border-2 border-white/20 rounded-xl p-3 box-border min-h-[120px] min-w-0">
          <div className="flex items-start justify-between gap-3 mb-3 mt-1 px-1">
            <div className="font-bebas text-xl text-white tracking-wide">
              Jugadores ({titularPlayers.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
              {jugadoresCompleteBadge}
            </div>
            {isPlayerInMatch && (
              <div className="relative">
                <button
                  ref={menuButtonRef}
                  className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white/90 transition-colors"
                  onClick={() => {
                    if (menuButtonRef.current) {
                      const rect = menuButtonRef.current.getBoundingClientRect();
                      setMenuPosition(getSafeMenuPosition(rect));
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
                      className="fixed w-48 rounded-xl border border-slate-700 bg-slate-900 shadow-lg z-[9999] overflow-hidden transition-all duration-200 ease-out"
                      style={{
                        top: `${menuPosition.top}px`,
                        left: `${menuPosition.left}px`,
                        opacity: localMenuOpen ? 1 : 0,
                        transform: localMenuOpen ? 'scale(1)' : 'scale(0.95)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="w-full px-3 py-2 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800 transition-colors text-sm font-medium"
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
              {isAdmin && !isPlayerInMatch && (
                <button
                  className="w-full max-w-xs h-14 rounded-xl bg-emerald-600 text-white font-oswald text-[18px] font-semibold tracking-[0.01em] shadow-[0_4px_14px_rgba(16,185,129,0.3)] hover:brightness-110 active:scale-95 transition-all mb-2"
                  type="button"
                  onClick={() => unirseAlPartido && unirseAlPartido()}
                >
                  Me sumo (jugar)
                </button>
              )}
              <button
                className="w-full max-w-xs h-14 rounded-xl bg-[#128BE9] text-white font-oswald text-[18px] font-semibold tracking-[0.01em] shadow-[0_4px_14px_rgba(18,139,233,0.3)] hover:brightness-110 active:scale-95 transition-all"
                type="button"
                onClick={() => setShowInviteModal(true)}
              >
                Invitar amigos
              </button>
              <button
                className="w-full max-w-xs h-14 rounded-xl bg-slate-800 text-white font-oswald text-[18px] font-semibold tracking-[0.01em] border border-white/20 hover:bg-slate-700 active:scale-95 transition-all"
                type="button"
                onClick={() => {
                  // Focus the manual input field
                  document.querySelector('input[placeholder="Agregar jugador manualmente"]')?.focus();
                }}
              >
                Agregar manualmente
              </button>
              {/* Botón compartir link solo si existe handler */}
              {canShareInviteLink && (
                <button
                  className="mt-4 text-xs text-white/70 bg-white/10 px-3 py-2 rounded-lg border border-white/20 hover:bg-white/15 transition-all"
                  type="button"
                  onClick={() => onShareClick?.()}
                >
                  Compartir link
                </button>
              )}
            </div>
          ) : (
            renderRosterSections()
          )}
        </div>

        {/* Botones de acción - Static flow instead of fixed, closer to list */}
        <div className="w-full px-4 mt-6 relative z-10 text-center">
          {/* Texto de estado si faltan jugadores */}
          {(!partidoActual.cupo_jugadores || (remainingTitularSlots !== null && remainingTitularSlots > 0)) && (
            <div className="mb-4 text-white/60 font-oswald text-sm">
              {capacity
                ? `Falta${remainingTitularSlots > 1 ? 'n' : ''} ${remainingTitularSlots} titular${remainingTitularSlots > 1 ? 'es' : ''}`
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
                      className="flex-[1.5] font-oswald text-[18px] h-12 rounded-xl cursor-pointer transition-all text-white flex items-center justify-center font-semibold tracking-[0.01em] disabled:opacity-50 disabled:cursor-not-allowed bg-[#128BE9] hover:bg-[#0f7acc] hover:shadow-[0_0_20px_rgba(18,139,233,0.4)] active:scale-95 shadow-[0_4px_10px_rgba(0,0,0,0.3)]"
                      onClick={aceptarInvitacion}
                      disabled={invitationLoading || isMatchFull}
                    >
                      {invitationLoading ? <LoadingSpinner size="small" /> : 'Aceptar'}
                    </button>
                    <button
                      className="flex-1 font-oswald text-[18px] h-12 rounded-xl cursor-pointer transition-all text-white/70 flex items-center justify-center font-semibold tracking-[0.01em] disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border border-white/20 hover:bg-white/10 hover:text-white active:scale-95"
                      onClick={rechazarInvitacion}
                      disabled={invitationLoading}
                    >
                      Rechazar
                    </button>
                  </>
                )
              ) : (
                // Botones para jugador ya en el partido (guest view) - SOLO INVITAR
                <div className="flex flex-col w-full">
                  <button
                    className={`w-full font-oswald text-[18px] h-14 rounded-xl cursor-pointer transition-all text-white flex items-center justify-center font-semibold tracking-[0.01em] bg-[#128BE9] shadow-[0_4px_14px_rgba(18,139,233,0.3)]
                      ${isMatchFull
                        ? 'opacity-40 grayscale cursor-not-allowed shadow-none'
                        : 'hover:brightness-110 active:scale-95'
                      }`}
                    onClick={() => {
                      if (isMatchFull) return;
                      setShowInviteModal(true);
                    }}
                    disabled={isMatchFull}
                  >
                    Invitar amigos
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>

        <ConfirmModal
          isOpen={!!playerToRemove}
          title="Expulsar jugador"
          message={`¿Seguro que querés expulsar a ${playerToRemove?.nombre || 'este jugador'}?`}
          onConfirm={handleConfirmRemovePlayer}
          onCancel={() => {
            if (isRemovingPlayer) return;
            setPlayerToRemove(null);
          }}
          confirmText="EXPULSAR"
          cancelText="CANCELAR"
          isDeleting={isRemovingPlayer}
          danger
        />
      </>
    );
  }

  // Admin view
  return (
    <>
      <div className="bg-white/10 border-2 border-white/20 rounded-xl p-3 min-h-[120px] w-full max-w-full mx-auto mt-0 box-border min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2 mt-2">
        <div className="font-bebas text-xl text-white tracking-wide">
          Jugadores ({titularPlayers.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
          {jugadoresCompleteBadge}
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-8 inline-flex items-center gap-1.5 rounded-full border border-[#4caf50]/45 bg-[#4caf50]/15 px-2.5 text-[11px] font-oswald tracking-wide text-[#d9ffe0] transition-colors hover:bg-[#4caf50]/25 disabled:opacity-45 disabled:cursor-not-allowed"
            onClick={handleShareRosterUpdateClick}
            disabled={!canShareRosterUpdate || isSharingUpdate}
            title={canShareRosterUpdate ? 'Compartir update por WhatsApp' : 'No disponible'}
            aria-label="Compartir update por WhatsApp"
          >
            <WhatsappIcon size={12} style={{ opacity: 0.95 }} />
            <span>{isSharingUpdate ? 'Compartiendo...' : 'Compartir update'}</span>
          </button>

          {isAdmin && isPlayerInMatch && (
            <div className="relative">
              <button
                ref={adminMenuButtonRef}
                className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-white/90 transition-colors"
                onClick={() => {
                  if (adminMenuButtonRef.current) {
                    const rect = adminMenuButtonRef.current.getBoundingClientRect();
                    setMenuPosition(getSafeMenuPosition(rect));
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
                    className="fixed w-48 rounded-xl border border-slate-700 bg-slate-900 shadow-lg z-[9999] transition-all duration-200 ease-out"
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
                        className="w-full px-3 py-2 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800 transition-colors text-sm font-medium"
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
      </div>
      {shareUpdateHint && (
        <div className="mb-2 px-1 text-[11px] text-[#d9ffe0] font-oswald tracking-wide">
          {shareUpdateHint}
        </div>
      )}
      {jugadores.length === 0 ? (
        <EmptyPlayersState view={isAdmin ? 'admin' : 'guest'} onShareClick={onShareClick} />
      ) : (
        renderRosterSections()
      )}
      </div>
      {isAdmin && canShareInviteLink && (
        <div className="w-full max-w-full mx-auto mt-2 text-center">
          <p className="text-[11px] text-white/60 font-oswald leading-relaxed">
            Ingresá jugadores manualmente o compartí el link del partido.
          </p>
          <button
            type="button"
            className="mt-1 text-[11px] uppercase tracking-wider text-[#7bc6ff] hover:text-[#a9ddff] transition-colors disabled:opacity-40"
            onClick={() => onShareClick?.()}
            disabled={typeof onShareClick !== 'function'}
          >
            Compartir link por WhatsApp
          </button>
        </div>
      )}
      <ConfirmModal
        isOpen={!!playerToRemove}
        title="Expulsar jugador"
        message={`¿Seguro que querés expulsar a ${playerToRemove?.nombre || 'este jugador'}?`}
        onConfirm={handleConfirmRemovePlayer}
        onCancel={() => {
          if (isRemovingPlayer) return;
          setPlayerToRemove(null);
        }}
        confirmText="EXPULSAR"
        cancelText="CANCELAR"
        isDeleting={isRemovingPlayer}
        danger
      />
    </>
  );
};

export default PlayersSection;
