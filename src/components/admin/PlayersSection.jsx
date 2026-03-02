import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { PlayerCardTrigger } from '../ProfileComponents';
import LoadingSpinner from '../LoadingSpinner';
import ConfirmModal from '../ConfirmModal';
import { MoreVertical, LogOut, Share2 } from 'lucide-react';
import { notifyBlockingError } from 'utils/notifyBlockingError';

const INVITE_ACCEPT_BUTTON_VIOLET = '#644dff';
const INVITE_ACCEPT_BUTTON_VIOLET_DARK = '#4836bb';
const SLOT_SKEW_X = 0;
const HEADER_ICON_COLOR = '#29aaff';
const HEADER_ICON_GLOW = 'drop-shadow(0 0 4px rgba(41, 170, 255, 0.78))';
const PLACEHOLDER_NUMBER_STYLE = {
  color: 'transparent',
  WebkitTextStroke: '2px rgba(104, 154, 255, 0.5)',
  textShadow: '-0.6px -0.6px 0 rgba(255,255,255,0.11), 0.8px 0.8px 0 rgba(0,0,0,0.34)',
  opacity: 0.56,
  fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontWeight: 700,
  letterSpacing: '0.02em',
  lineHeight: 1,
};

// Helper function to get initials from name
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const resolveSlotsFromMatchType = (match = {}) => {
  const explicitCapacity = Number(match?.cupo_jugadores || match?.cupo || 0);
  if (Number.isFinite(explicitCapacity) && explicitCapacity > 0) {
    return explicitCapacity;
  }

  const token = String(match?.tipo_partido || match?.modalidad || '').trim().toUpperCase();
  const normalized = token.replace(/\s+/g, '');
  const matchByNumber = normalized.match(/F(\d+)/i);
  if (matchByNumber) {
    const playersPerTeam = Number(matchByNumber[1]);
    if (Number.isFinite(playersPerTeam) && playersPerTeam > 0) {
      return playersPerTeam * 2;
    }
  }

  const fallbackByType = {
    F5: 10,
    F6: 12,
    F7: 14,
    F8: 16,
    F11: 22,
  };

  return fallbackByType[normalized] || 10;
};

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
  unirseAlPartido,
}) => {
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState(null);
  const [isRemovingPlayer, setIsRemovingPlayer] = useState(false);
  const [isTitularesOpen, setIsTitularesOpen] = useState(true);
  const [isSuplentesOpen, setIsSuplentesOpen] = useState(true);
  const [animateCompletionTick, setAnimateCompletionTick] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuButtonRef = useRef(null);
  const adminMenuButtonRef = useRef(null);

  const menuOpen = isAdmin ? (actionsMenuOpen !== undefined ? actionsMenuOpen : localMenuOpen) : false;
  const setMenuOpen = isAdmin && setActionsMenuOpen ? setActionsMenuOpen : setLocalMenuOpen;
  const capacity = Number(partidoActual?.cupo_jugadores || 0);
  const maxRosterSlots = capacity > 0 ? capacity + 4 : 0;
  const titularPlayers = jugadores.filter((j) => !j?.is_substitute);
  const substitutePlayers = jugadores.filter((j) => !!j?.is_substitute);
  const isTitularesComplete = capacity > 0 && titularPlayers.length >= capacity;
  const showSubstituteSection = substitutePlayers.length > 0 || isTitularesComplete;
  const remainingTitularSlots = capacity > 0 ? Math.max(0, capacity - titularPlayers.length) : null;
  const isMatchFull = maxRosterSlots > 0 && jugadores.length >= maxRosterSlots;
  const canShareInviteLink = isAdmin && typeof onShareClick === 'function' && !isMatchFull;
  const completionAnimTimeoutRef = useRef(null);
  const previousCompleteRef = useRef(isTitularesComplete);
  const showInviteStylePostJoin = !isAdmin && isPlayerInMatch;
  const inviteRequiredSlots = resolveSlotsFromMatchType(partidoActual);
  const inviteDisplayCount = jugadores?.length ?? 0;
  const inviteConfirmedCount = Math.min(inviteDisplayCount, inviteRequiredSlots);
  const inviteProgressPct = inviteRequiredSlots > 0
    ? Math.max(0, Math.min((inviteConfirmedCount / inviteRequiredSlots) * 100, 100))
    : 0;
  const inviteSlotItems = Array.from({ length: inviteRequiredSlots }, (_, idx) => jugadores?.[idx] || null);
  const missingSlotsCount = Math.max(0, inviteRequiredSlots - inviteConfirmedCount);
  const inviteButtonPalette = {
    '--btn': INVITE_ACCEPT_BUTTON_VIOLET,
    '--btn-dark': INVITE_ACCEPT_BUTTON_VIOLET_DARK,
    '--btn-text': '#ffffff',
  };
  const invitePlayersBlockStyle = {
    background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)',
    paddingTop: '16px',
    paddingBottom: '24px',
  };
  const inviteSoftCardWrapperStyle = {
    backgroundColor: '#07163b',
    border: '1px solid rgba(41, 170, 255, 0.9)',
    boxShadow: '0 0 10px rgba(41, 170, 255, 0.24)',
    transform: `skewX(-${SLOT_SKEW_X}deg)`,
    backfaceVisibility: 'hidden',
  };
  const inviteSoftPlaceholderWrapperStyle = {
    background: 'rgba(255,255,255,0.015)',
    border: '1px dashed rgba(255,255,255,0.055)',
    boxShadow: 'none',
    transform: `skewX(-${SLOT_SKEW_X}deg)`,
  };
  const inviteSkewCounterStyle = {
    transform: `skewX(${SLOT_SKEW_X}deg)`,
  };
  const headerActionIconButtonClass = 'h-8 w-8 inline-flex items-center justify-center bg-transparent border-0 p-0 text-[#29aaff]/80 hover:text-[#29aaff] transition-colors disabled:opacity-45 disabled:cursor-not-allowed';
  const kebabMenuButtonClass = 'h-8 w-8 inline-flex items-center justify-center bg-transparent border-0 p-0 text-[#29aaff]/80 hover:text-[#29aaff] transition-colors disabled:opacity-45 disabled:cursor-not-allowed';

  useEffect(() => () => {
    if (completionAnimTimeoutRef.current) {
      window.clearTimeout(completionAnimTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const wasComplete = previousCompleteRef.current;
    previousCompleteRef.current = isTitularesComplete;

    if (!isTitularesComplete) {
      setAnimateCompletionTick(false);
      return;
    }

    if (!wasComplete && isTitularesComplete) {
      setAnimateCompletionTick(true);
      if (completionAnimTimeoutRef.current) {
        window.clearTimeout(completionAnimTimeoutRef.current);
      }
      completionAnimTimeoutRef.current = window.setTimeout(() => {
        setAnimateCompletionTick(false);
      }, 850);
    }
  }, [isTitularesComplete]);

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

  const renderGuestActionsMenu = () => {
    if (!isPlayerInMatch) return null;

    return (
      <div className="relative">
        <button
          ref={menuButtonRef}
          className={kebabMenuButtonClass}
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
          <MoreVertical size={15} />
        </button>
        {localMenuOpen && ReactDOM.createPortal(
          <>
            <div
              className="fixed inset-0 z-[9998] bg-transparent"
              onClick={() => setLocalMenuOpen(false)}
            />
            <div
              className="fixed w-48 border bg-slate-900/98 shadow-lg z-[9999] overflow-hidden transition-all duration-200 ease-out"
              style={{
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                opacity: localMenuOpen ? 1 : 0,
                transform: localMenuOpen ? `skewX(-${SLOT_SKEW_X}deg) scale(1)` : `skewX(-${SLOT_SKEW_X}deg) scale(0.95)`,
                borderColor: 'rgba(88, 107, 170, 0.46)',
                borderRadius: 0,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ transform: `skewX(${SLOT_SKEW_X}deg)` }}>
                <button
                  className="w-full h-[46px] px-3 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800 transition-colors text-sm font-medium"
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
            </div>
          </>,
          document.body,
        )}
      </div>
    );
  };

  const renderInviteStyleRoster = (headerActions = null) => (
    <div className="w-full box-border" style={invitePlayersBlockStyle}>
      <div className="px-1 mb-6">
        <div className="flex items-center justify-between gap-2">
          <div className="font-oswald text-xl font-semibold text-white tracking-[0.01em]">
            Jugadores ({inviteConfirmedCount}/{inviteRequiredSlots})
          </div>
          {headerActions ? <div className="flex items-center gap-1.5 shrink-0">{headerActions}</div> : null}
        </div>
        <div className="mt-2 h-[6px] w-full overflow-hidden rounded-[6px] bg-white/[0.08]">
          <div
            className="h-full rounded-[6px] transition-all duration-200"
            style={{ width: `${inviteProgressPct}%`, backgroundColor: INVITE_ACCEPT_BUTTON_VIOLET, filter: 'saturate(1.05)' }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 w-full max-w-[720px] mx-auto justify-items-center box-border px-1">
        {(() => {
          let slotNumber = missingSlotsCount;
          return inviteSlotItems.map((player, idx) => {
            if (!player) {
              const visibleNumber = slotNumber > 0 ? slotNumber : Math.max(1, inviteRequiredSlots - idx);
              slotNumber = Math.max(0, slotNumber - 1);
              return (
                <div
                  key={`slot-empty-${idx}`}
                  className="rounded-none h-12 w-full overflow-hidden"
                  style={inviteSoftPlaceholderWrapperStyle}
                  aria-hidden="true"
                >
                  <div
                    className="h-full w-full p-2 flex items-center justify-center"
                    style={inviteSkewCounterStyle}
                  >
                    <span className="select-none pointer-events-none text-[28px]" style={PLACEHOLDER_NUMBER_STYLE}>
                      {visibleNumber}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <PlayerCardTrigger key={player.uuid || player.id || `slot-player-${idx}`} profile={player} partidoActual={partidoActual}>
                <div
                  className="PlayerCard PlayerCard--soft relative rounded-none h-12 w-full overflow-visible transition-all cursor-pointer hover:brightness-105"
                  style={inviteSoftCardWrapperStyle}
                >
                  <div
                    className="h-full w-full p-2 flex items-center gap-1.5"
                    style={inviteSkewCounterStyle}
                  >
                    {player.foto_url || player.avatar_url ? (
                      <img
                        src={player.foto_url || player.avatar_url}
                        alt={player.nombre}
                        className="w-8 h-8 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-white">
                        {getInitials(player.nombre)}
                      </div>
                    )}
                    <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 truncate leading-tight">
                      {player.nombre || 'Jugador'}
                    </span>
                    {partidoActual?.creado_por === player.usuario_id && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#FFD700" style={{ flexShrink: 0 }}>
                        <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
                      </svg>
                    )}
                  </div>
                </div>
              </PlayerCardTrigger>
            );
          });
        })()}
      </div>
    </div>
  );

  const renderPlayerCard = (j) => {
    const hasVoted = votantesConNombres.some((v) => {
      if (!v.nombre || !j.nombre) return false;
      return v.nombre.toLowerCase().trim() === j.nombre.toLowerCase().trim();
    }) || (votantes && (votantes.includes(j.uuid) || votantes.includes(j.usuario_id)));
    const cardStyle = {
      backgroundColor: '#07163b',
      border: hasVoted ? '1px solid rgba(78, 196, 255, 0.94)' : '1px solid rgba(41, 170, 255, 0.9)',
      boxShadow: hasVoted ? '0 0 11px rgba(41, 170, 255, 0.3)' : '0 0 9px rgba(41, 170, 255, 0.24)',
      transform: `skewX(-${SLOT_SKEW_X}deg)`,
      backfaceVisibility: 'hidden',
    };

    return (
      <PlayerCardTrigger
        key={j.uuid || j.id || `${j.nombre}-${j.usuario_id || 'manual'}`}
        profile={j}
        partidoActual={partidoActual}
        onMakeAdmin={transferirAdmin}
      >
        <div
          className="relative rounded-none h-12 w-full max-w-[660px] mx-auto overflow-visible transition-all cursor-pointer hover:brightness-105"
          style={cardStyle}
        >
          <div
            className="h-full w-full p-2 flex items-center gap-1.5"
            style={inviteSkewCounterStyle}
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

            <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 truncate leading-tight">
              {j.nombre}
            </span>

            {partidoActual?.creado_por === j.usuario_id && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#FFD700" style={{ flexShrink: 0 }}>
                <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
              </svg>
            )}

            {isAdmin && j.usuario_id !== user?.id ? (
              <button
                className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer transition-colors inline-flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={(e) => {
                  e.stopPropagation();
                  setPlayerToRemove({ id: j.id, nombre: j.nombre, isOwnPlayer: false });
                }}
                type="button"
                aria-label="Eliminar jugador"
                disabled={isClosing}
                title="Eliminar jugador"
              >
                <span
                  className="leading-none text-[15px]"
                  style={{ color: HEADER_ICON_COLOR, filter: HEADER_ICON_GLOW }}
                >
                  ×
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </PlayerCardTrigger >
    );
  };

  const jugadoresCompleteBadge = isTitularesComplete ? (
    <span className="ml-2 inline-flex items-center" title="Titulares completos" aria-label="Titulares completos">
      <span className={`relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-300/70 bg-emerald-500/20 ${animateCompletionTick ? 'shadow-[0_0_0_6px_rgba(74,222,128,0.15)]' : ''}`}>
        {animateCompletionTick && (
          <span className="absolute inset-0 rounded-full bg-emerald-300/35 animate-ping" />
        )}
        <svg
          viewBox="0 0 20 20"
          className={`relative z-[1] h-3.5 w-3.5 text-emerald-100 ${animateCompletionTick ? 'scale-110' : ''}`}
          style={{ transition: 'transform 220ms ease-out' }}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M4.8 10.1L8.2 13.4L15.2 6.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  ) : null;

  const renderRosterSections = () => (
    <div className="flex flex-col gap-3">
      <div className="border border-white/15 bg-white/[0.04] p-2.5">
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
            <div className="grid grid-cols-2 gap-4 w-full max-w-[720px] mx-auto justify-items-center box-border">
              {titularPlayers.map(renderPlayerCard)}
            </div>
          ) : (
            <div className="text-center text-[12px] text-white/55 font-oswald py-2">Todavía no hay titulares.</div>
          )}
        </div>
      </div>

      {showSubstituteSection && (
        <div className="border border-amber-400/30 bg-amber-500/10 p-2.5">
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
              <span className="text-[11px] font-oswald text-amber-200/85">{substitutePlayers.length}/4</span>
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
              <div className="grid grid-cols-2 gap-4 w-full max-w-[720px] mx-auto justify-items-center box-border">
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

  const renderAdminRoster = () => (
    <div className="relative w-full max-w-full mx-auto box-border min-w-0">
      <div className="w-full box-border" style={invitePlayersBlockStyle}>
        <div className="px-1 mb-6">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-oswald text-xl font-semibold text-white tracking-[0.01em]">
              Jugadores
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                className={headerActionIconButtonClass}
                onClick={() => onShareClick?.()}
                disabled={!canShareInviteLink}
                title="Compartir invitación"
                aria-label="Compartir invitación"
              >
                <Share2 size={14} style={{ color: HEADER_ICON_COLOR, filter: HEADER_ICON_GLOW }} />
              </button>

              {isAdmin && isPlayerInMatch && (
                <button
                  type="button"
                  ref={adminMenuButtonRef}
                  className={kebabMenuButtonClass}
                  onClick={() => {
                    if (adminMenuButtonRef.current) {
                      const rect = adminMenuButtonRef.current.getBoundingClientRect();
                      setMenuPosition(getSafeMenuPosition(rect));
                    }
                    setMenuOpen(!menuOpen);
                  }}
                  aria-label="Más acciones"
                  title="Acciones de administración"
                >
                  <MoreVertical size={15} style={{ color: HEADER_ICON_COLOR, filter: HEADER_ICON_GLOW }} />
                </button>
              )}

              {isAdmin && isPlayerInMatch && menuOpen && ReactDOM.createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9998] bg-transparent"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    className="fixed w-48 border bg-slate-900/98 shadow-lg z-[9999] overflow-hidden transition-all duration-200 ease-out"
                    style={{
                      top: `${menuPosition.top}px`,
                      left: `${menuPosition.left}px`,
                      opacity: menuOpen ? 1 : 0,
                      transform: menuOpen ? `skewX(-${SLOT_SKEW_X}deg) scale(1)` : `skewX(-${SLOT_SKEW_X}deg) scale(0.95)`,
                      borderColor: 'rgba(88, 107, 170, 0.46)',
                      borderRadius: 0,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ transform: `skewX(${SLOT_SKEW_X}deg)` }}>
                      <button
                        className="w-full h-[46px] px-3 flex items-center gap-2 text-left text-slate-100 hover:bg-slate-800 transition-colors text-sm font-medium"
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
          </div>
          <div className="mt-2 h-[6px] w-full overflow-hidden rounded-[6px] bg-white/[0.08]">
            <div
              className="h-full rounded-[6px] transition-all duration-200"
              style={{ width: `${inviteProgressPct}%`, backgroundColor: INVITE_ACCEPT_BUTTON_VIOLET, filter: 'saturate(1.05)' }}
            />
          </div>
          {duplicatesDetected > 0 && (
            <div className="mt-2 text-[11px] text-[#ffb08d] font-oswald">
              {duplicatesDetected} duplicado{duplicatesDetected > 1 ? 's' : ''} detectado{duplicatesDetected > 1 ? 's' : ''}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 w-full max-w-[720px] mx-auto justify-items-center box-border px-1">
          {(() => {
            let slotNumber = missingSlotsCount;
            return inviteSlotItems.map((player, idx) => {
              if (!player) {
                const visibleNumber = slotNumber > 0 ? slotNumber : Math.max(1, inviteRequiredSlots - idx);
                slotNumber = Math.max(0, slotNumber - 1);
                return (
                  <div
                    key={`admin-slot-empty-${idx}`}
                    className="rounded-none h-12 w-full overflow-hidden"
                    style={inviteSoftPlaceholderWrapperStyle}
                    aria-hidden="true"
                  >
                    <div
                      className="h-full w-full p-2 flex items-center justify-center"
                      style={inviteSkewCounterStyle}
                    >
                      <span className="select-none pointer-events-none text-[28px]" style={PLACEHOLDER_NUMBER_STYLE}>
                        {visibleNumber}
                      </span>
                    </div>
                  </div>
                );
              }

              return renderPlayerCard(player);
            });
          })()}
        </div>
      </div>
    </div>
  );

  // Guest view (non-admin) OR user with pending invitation
  if (!isAdmin || (!isPlayerInMatch && jugadores.length > 0)) {
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
            gap: 1rem;
            font-size: 0.94rem;
            font-weight: 700;
            letter-spacing: 0.045em;
            color: var(--btn-text, #fff);
            background: var(--btn);
            border: 1.5px solid var(--btn-dark);
            border-radius: 0;
            box-shadow: var(--btn-shadow, none);
            transform: none;
            transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
            backface-visibility: hidden;
            white-space: nowrap;
          }
          .invite-cta-btn > span {
            transform: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .invite-cta-btn:hover:not(:disabled) {
            filter: brightness(1.08);
          }
          .invite-cta-btn:active:not(:disabled) {
            transform: none;
            opacity: 0.92;
          }
          .invite-cta-btn:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }
        `}</style>
        <div className="w-full flex flex-col pb-32">
          {showInviteStylePostJoin ? (
            <div className="relative w-full max-w-full mx-auto mt-2 box-border min-h-[120px] min-w-0">
              {renderInviteStyleRoster(renderGuestActionsMenu())}
            </div>
          ) : (
            <div className="w-full max-w-full mx-auto mt-2 bg-white/10 border-2 border-white/20 rounded-xl p-3 box-border min-h-[120px] min-w-0">
              <div className="flex items-start justify-between gap-3 mb-3 mt-1 px-1">
                <div className="font-bebas text-xl text-white tracking-wide">
                  Jugadores ({titularPlayers.length}/{partidoActual.cupo_jugadores || 'Sin límite'})
                  {jugadoresCompleteBadge}
                </div>
                {renderGuestActionsMenu()}
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
                      document.querySelector('input[placeholder="Agregar jugador manualmente"]')?.focus();
                    }}
                  >
                    Agregar manualmente
                  </button>
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
          )}

          <div className={`w-full relative z-10 text-center ${showInviteStylePostJoin ? 'px-2 mt-5' : 'px-4 mt-6'}`}>
            {!showInviteStylePostJoin && (!partidoActual.cupo_jugadores || (remainingTitularSlots !== null && remainingTitularSlots > 0)) && (
              <div className="mb-4 text-white/60 font-oswald text-sm">
                {capacity
                  ? `Falta${remainingTitularSlots > 1 ? 'n' : ''} ${remainingTitularSlots} titular${remainingTitularSlots > 1 ? 'es' : ''}`
                  : 'Cupos disponibles'}
              </div>
            )}

            {showInviteStylePostJoin ? (
              <div className="w-full max-w-[250px] mx-auto px-2 sm:px-0">
                <button
                  className="invite-cta-btn"
                  style={inviteButtonPalette}
                  onClick={() => setShowInviteModal(true)}
                  disabled={isMatchFull}
                >
                  <span>{isMatchFull ? 'Partido completo' : 'Invitar amigos'}</span>
                </button>
              </div>
            ) : (
              <div className="w-full max-w-[500px] mx-auto bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                <div className="flex gap-3">
                  {invitationStatus && invitationStatus !== 'pending' ? (
                    <div className="w-full flex flex-col items-center justify-center py-2 text-white/60">
                      <span className="font-bebas text-xl mb-1 opacity-80">
                        {invitationStatus === 'declined' ? 'INVITACIÓN RECHAZADA' : 'INVITACIÓN NO VÁLIDA'}
                      </span>
                      <span className="text-sm font-light opacity-60">
                        {invitationStatus === 'declined' ? 'Ya rechazaste esta invitación.' : 'Esta invitación ha expirado o ya fue respondida.'}
                      </span>
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>
            )}
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
      {renderAdminRoster()}
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
