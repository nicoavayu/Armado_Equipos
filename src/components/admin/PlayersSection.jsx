import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { PlayerCardTrigger } from '../ProfileComponents';
import LoadingSpinner from '../LoadingSpinner';
import ConfirmModal from '../ConfirmModal';
import { MoreVertical, LogOut, Share2, UserPlus } from 'lucide-react';
import { notifyBlockingError } from 'utils/notifyBlockingError';
import { buildMatchCalendarIcs, shareOrDownloadCalendarIcs } from '../../utils/calendarInvite';
import { supabase } from '../../supabase';
import {
  buildPlayerRefToKeyMap,
  normalizeIdentityRef,
  resolvePlayerKey,
  toPlayerKeysFromRefs,
} from '../../services/surveyTeamsService';

const INVITE_ACCEPT_BUTTON_VIOLET = '#644dff';
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
const SUBSTITUTES_PROGRESS_COLOR = '#cda24b';
const SUBSTITUTES_PLACEHOLDER_NUMBER_STYLE = {
  ...PLACEHOLDER_NUMBER_STYLE,
  WebkitTextStroke: '2px rgba(232, 188, 88, 0.52)',
  textShadow: '-0.6px -0.6px 0 rgba(255,255,255,0.09), 0.8px 0.8px 0 rgba(54,35,0,0.45)',
  opacity: 0.58,
};
const SUBSTITUTES_SLOT_PLACEHOLDER_STYLE = {
  background: 'rgba(184, 141, 42, 0.08)',
  border: '1px dashed rgba(239, 194, 92, 0.36)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
};
const SUBSTITUTES_CARD_STYLE = {
  backgroundColor: '#271f08',
  border: '1px solid rgba(237, 196, 101, 0.58)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
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

const TEAM_REF_CANDIDATE_FIELDS = [
  'ref',
  'persist_ref',
  'player_ref',
  'playerRef',
  'playerKey',
  'key',
  'usuario_id',
  'user_id',
  'uuid',
  'auth_id',
  'player_id',
  'jugador_id',
  'id',
  'value',
];

const TEAM_REF_LABEL_FIELDS = ['nombre', 'name', 'label'];

const TEAM_BALANCE_SCALE = [
  { maxDiff: 0, label: 'MATCH PERFECTO', color: '#10B981' },
  { maxDiff: 2, label: 'MUY PAREJO', color: '#10B981' },
  { maxDiff: 5, label: 'PAREJO', color: '#84CC16' },
  { maxDiff: 8, label: 'DESBALANCEADO', color: '#F59E0B' },
  { maxDiff: Number.POSITIVE_INFINITY, label: 'MUY DESBALANCEADO', color: '#EF4444' },
];

const createEmptyGuestTeamsState = () => ({
  isAvailable: false,
  hasConfirmedFlag: false,
  teamAName: 'Equipo A',
  teamBName: 'Equipo B',
  teamAPlayers: [],
  teamBPlayers: [],
  teamAScore: 0,
  teamBScore: 0,
  balanceDiff: 0,
  balanceLabel: 'MUY PAREJO',
  balanceColor: '#10B981',
});

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTeamsPayload = (value) => {
  const raw = typeof value === 'string' ? (() => {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  })() : value;

  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object' && Array.isArray(raw.teams)) return raw.teams.filter(Boolean);
  return [];
};

const normalizeTeamToken = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const pickOrderedTeamsFromPayload = (teamsPayload = []) => {
  const teams = Array.isArray(teamsPayload) ? teamsPayload.filter(Boolean) : [];
  if (teams.length === 0) return [null, null];

  const findByToken = (candidates = []) => teams.find((team) => candidates.includes(normalizeTeamToken(team?.id)));
  const teamA = findByToken(['equipoa', 'teama', 'a']) || teams[0] || null;
  const teamB = findByToken(['equipob', 'teamb', 'b']) || teams.find((team) => team !== teamA) || teams[1] || null;
  return [teamA, teamB];
};

const resolveTeamPlayerRefsFromPayload = (teamPayload) => {
  if (!teamPayload || typeof teamPayload !== 'object') return [];
  return ['players', 'jugadores', 'members']
    .map((field) => (Array.isArray(teamPayload?.[field]) ? teamPayload[field] : []))
    .find((refs) => refs.length > 0) || [];
};

const getTeamRefCandidates = (ref) => {
  if (ref === null || ref === undefined) return [];
  if (typeof ref === 'string' || typeof ref === 'number' || typeof ref === 'boolean') {
    return [String(ref).trim()].filter(Boolean);
  }
  if (typeof ref !== 'object') return [];

  return TEAM_REF_CANDIDATE_FIELDS
    .map((field) => String(ref?.[field] || '').trim())
    .filter(Boolean);
};

const getTeamRefLabel = (ref) => {
  if (!ref || typeof ref !== 'object') return '';
  return TEAM_REF_LABEL_FIELDS
    .map((field) => String(ref?.[field] || '').trim())
    .find(Boolean) || '';
};

const normalizeTeamRefs = (value) => (
  (Array.isArray(value) ? value : [])
    .map((ref) => getTeamRefCandidates(ref)[0] || '')
    .filter(Boolean)
);

const buildFallbackPlayersFromRefs = ({ rawRefs = [], normalizedRefs = [] }) => {
  const seen = new Set();
  return (Array.isArray(rawRefs) ? rawRefs : [])
    .map((rawRef, index) => {
      const label = getTeamRefLabel(rawRef) || String(normalizedRefs[index] || '').trim();
      if (!label) return null;
      const dedupeKey = normalizeIdentityRef(label);
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      return {
        id: `guest-team-ref-${index}-${dedupeKey || index}`,
        nombre: label,
      };
    })
    .filter(Boolean);
};

const mapTeamRefsToPlayers = ({ refs = [], rawRefs = [], refToKeyMap, keyToPlayerMap }) => {
  const keys = toPlayerKeysFromRefs({ refs, refToKeyMap });
  const resolvedPlayers = keys
    .map((key) => keyToPlayerMap.get(String(key).trim()))
    .filter(Boolean);

  if (resolvedPlayers.length > 0) {
    return resolvedPlayers;
  }

  return buildFallbackPlayersFromRefs({ rawRefs, normalizedRefs: refs });
};

const computeTeamScore = ({ explicitScore, players = [] }) => {
  const fromPayload = toFiniteNumber(explicitScore);
  if (fromPayload !== null) return fromPayload;

  const sum = (Array.isArray(players) ? players : []).reduce((acc, player) => {
    const candidate = toFiniteNumber(player?.score ?? player?.promedio ?? player?.rating);
    return acc + (candidate ?? 0);
  }, 0);
  return Number(sum.toFixed(1));
};

const resolveBalanceMeta = (diffValue) => {
  const diff = Number.isFinite(Number(diffValue)) ? Number(diffValue) : 0;
  return TEAM_BALANCE_SCALE.find((entry) => diff <= entry.maxDiff) || TEAM_BALANCE_SCALE[TEAM_BALANCE_SCALE.length - 1];
};

const GuestTeamsReadOnlyModal = ({
  isOpen,
  onClose,
  teamAName,
  teamBName,
  teamAPlayers,
  teamBPlayers,
  teamAScore,
  teamBScore,
  balanceDiff,
  balanceLabel,
  balanceColor,
}) => {
  if (!isOpen) return null;

  const renderTeamPlayerRow = (player, teamToken, index) => {
    const avatarUrl = player?.foto_url || player?.avatar_url || '';
    const key = `${teamToken}-${resolvePlayerKey(player) || player?.usuario_id || player?.id || player?.nombre || index}`;
    return (
      <div
        key={key}
        className="flex items-center gap-2 bg-[#07163b] border border-[rgba(41,170,255,0.86)] rounded-[6px] px-2.5 py-2 min-h-[44px]"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={player?.nombre || 'Jugador'}
            className="w-7 h-7 rounded-full object-cover border border-slate-700 bg-slate-800 shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-white">
            {getInitials(player?.nombre || 'Jugador')}
          </div>
        )}
        <span className="font-oswald text-[22px] leading-none text-white truncate">{player?.nombre || 'Jugador'}</span>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[10050] bg-black/70 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[760px] rounded-[8px] border border-white/20 bg-[#181d48] shadow-[0_20px_60px_rgba(0,0,0,0.55)] p-4 sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#1b214e] border border-white/10 rounded-[6px] p-3">
            <div className="font-bebas text-[36px] leading-none text-white uppercase tracking-[0.04em] text-center mb-2">{teamAName}</div>
            <div className="flex flex-col gap-1.5">
              {teamAPlayers.length > 0 ? teamAPlayers.map((player, index) => renderTeamPlayerRow(player, 'team-a', index)) : (
                <div className="text-white/55 text-sm font-oswald text-center py-2">Sin jugadores</div>
              )}
            </div>
            <div className="relative text-center w-full box-border mt-2 h-[74px] overflow-hidden rounded-[6px] border border-[#19d7b6cc] bg-[#07163b]">
              <div className="w-full h-full flex flex-col items-center justify-center px-2">
                <div className="text-white/75 text-[11px] font-oswald uppercase tracking-wide mb-0.5">PUNTAJE</div>
                <div className="text-white font-bebas text-[48px] leading-none font-bold">{Number(teamAScore || 0).toFixed(1)}</div>
              </div>
            </div>
          </div>

          <div className="bg-[#1b214e] border border-white/10 rounded-[6px] p-3">
            <div className="font-bebas text-[36px] leading-none text-white uppercase tracking-[0.04em] text-center mb-2">{teamBName}</div>
            <div className="flex flex-col gap-1.5">
              {teamBPlayers.length > 0 ? teamBPlayers.map((player, index) => renderTeamPlayerRow(player, 'team-b', index)) : (
                <div className="text-white/55 text-sm font-oswald text-center py-2">Sin jugadores</div>
              )}
            </div>
            <div className="relative text-center w-full box-border mt-2 h-[74px] overflow-hidden rounded-[6px] border border-[#19d7b6cc] bg-[#07163b]">
              <div className="w-full h-full flex flex-col items-center justify-center px-2">
                <div className="text-white/75 text-[11px] font-oswald uppercase tracking-wide mb-0.5">PUNTAJE</div>
                <div className="text-white font-bebas text-[48px] leading-none font-bold">{Number(teamBScore || 0).toFixed(1)}</div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="w-full border px-4 py-3 mt-3 rounded-[6px]"
          style={{
            borderColor: `${balanceColor}cc`,
            background: 'linear-gradient(180deg, rgba(7,22,59,0.96) 0%, rgba(9,20,58,0.88) 100%)',
            boxShadow: '0 0 10px rgba(41, 170, 255, 0.16)',
          }}
        >
          <div className="text-center">
            <div className="font-bebas text-base text-white/90 tracking-wider mb-0.5">BALANCE DEL PARTIDO</div>
            <div className="font-bebas text-2xl text-white font-bold mb-0.5">DIF: {Number(balanceDiff || 0).toFixed(1)}</div>
            <div className="font-oswald text-xs font-semibold tracking-wide" style={{ color: balanceColor }}>{balanceLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
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
  pendingInvitation,
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
  onShareClick,
  onShareRosterUpdate,
  unirseAlPartido,
}) => {
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState(null);
  const [isRemovingPlayer, setIsRemovingPlayer] = useState(false);
  const [isTitularesOpen, setIsTitularesOpen] = useState(true);
  const [isSuplentesOpen, setIsSuplentesOpen] = useState(true);
  const [isTitularesView, setIsTitularesView] = useState(true);
  const [animateCompletionTick, setAnimateCompletionTick] = useState(false);
  const [joinSuccessModalOpen, setJoinSuccessModalOpen] = useState(false);
  const [guestTeamsModalOpen, setGuestTeamsModalOpen] = useState(false);
  const [guestConfirmedTeams, setGuestConfirmedTeams] = useState(createEmptyGuestTeamsState);
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
  const canShareRosterUpdate = isAdmin && typeof onShareRosterUpdate === 'function';
  const completionAnimTimeoutRef = useRef(null);
  const previousCompleteRef = useRef(isTitularesComplete);
  const showInviteStylePostJoin = !isAdmin && isPlayerInMatch;
  const showInviteStyleRoster = !isAdmin;
  const showViewTeamsButton = showInviteStylePostJoin
    && Boolean(guestConfirmedTeams.isAvailable || guestConfirmedTeams.hasConfirmedFlag);
  const hasActivePendingInvite = pendingInvitation && invitationStatus === 'pending';
  const inviteRequiredSlots = resolveSlotsFromMatchType(partidoActual);
  const inviteDisplayCount = jugadores?.length ?? 0;
  const inviteConfirmedCount = Math.min(inviteDisplayCount, inviteRequiredSlots);
  const inviteProgressPct = inviteRequiredSlots > 0
    ? Math.max(0, Math.min((inviteConfirmedCount / inviteRequiredSlots) * 100, 100))
    : 0;
  const inviteSlotItems = Array.from({ length: inviteRequiredSlots }, (_, idx) => jugadores?.[idx] || null);
  const missingSlotsCount = Math.max(0, inviteRequiredSlots - inviteConfirmedCount);
  const visibleSubstitutePlayers = substitutePlayers.slice(0, 4);
  const substituteOverflowCount = Math.max(0, substitutePlayers.length - visibleSubstitutePlayers.length);
  const substituteSlotItems = Array.from({ length: 4 }, (_, idx) => visibleSubstitutePlayers[idx] || null);
  const substituteProgressPct = Math.max(0, Math.min((Math.min(substitutePlayers.length, 4) / 4) * 100, 100));
  const activeRosterProgressPct = isTitularesView ? inviteProgressPct : substituteProgressPct;
  const activeRosterProgressColor = isTitularesView ? INVITE_ACCEPT_BUTTON_VIOLET : SUBSTITUTES_PROGRESS_COLOR;
  const rosterViewportRows = Math.max(1, Math.ceil(inviteRequiredSlots / 2));
  const rosterViewportMinHeight = (rosterViewportRows * 48) + (Math.max(0, rosterViewportRows - 1) * 16);
  const matchPrimaryButtonClass = 'w-full font-bebas text-base px-4 py-2.5 border border-[#7d5aff] rounded-[5px] cursor-pointer transition-all text-white min-h-[44px] flex items-center justify-center text-center bg-[#6a43ff] shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:bg-[#7550ff] disabled:opacity-60 disabled:cursor-not-allowed';
  const matchSecondaryButtonClass = 'w-full font-bebas text-base px-4 py-2.5 border border-[rgba(88,107,170,0.46)] rounded-[5px] cursor-pointer transition-all text-[rgba(242,246,255,0.9)] min-h-[44px] flex items-center justify-center text-center bg-[rgba(23,35,74,0.72)] hover:bg-[rgba(31,45,91,0.82)] disabled:opacity-60 disabled:cursor-not-allowed';
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
  const kebabMenuButtonClass = 'kebab-menu-btn';

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

  useEffect(() => {
    let isCancelled = false;

    const clearGuestTeams = () => {
      if (isCancelled) return;
      setGuestConfirmedTeams(createEmptyGuestTeamsState());
      setGuestTeamsModalOpen(false);
    };

    const loadGuestConfirmedTeams = async () => {
      if (isAdmin || !showInviteStylePostJoin || !partidoActual?.id || !Array.isArray(jugadores) || jugadores.length === 0) {
        clearGuestTeams();
        return;
      }

      try {
        let sourceMatch = partidoActual || {};
        const matchIdNumber = Number(partidoActual?.id);
        const matchIdFilter = Number.isFinite(matchIdNumber) ? matchIdNumber : partidoActual?.id;
        let confirmationRow = null;

        let persistedTeamsPayload = normalizeTeamsPayload(sourceMatch?.equipos_json ?? sourceMatch?.equipos);
        let [teamPayloadA, teamPayloadB] = pickOrderedTeamsFromPayload(persistedTeamsPayload);
        let payloadARefs = resolveTeamPlayerRefsFromPayload(teamPayloadA);
        let payloadBRefs = resolveTeamPlayerRefsFromPayload(teamPayloadB);
        let teamARawRefs = payloadARefs;
        let teamBRawRefs = payloadBRefs;
        let teamARefs = normalizeTeamRefs(teamARawRefs);
        let teamBRefs = normalizeTeamRefs(teamBRawRefs);
        let teamAName = String(teamPayloadA?.name || 'Equipo A').trim() || 'Equipo A';
        let teamBName = String(teamPayloadB?.name || 'Equipo B').trim() || 'Equipo B';
        let teamAScoreFromPayload = toFiniteNumber(teamPayloadA?.score);
        let teamBScoreFromPayload = toFiniteNumber(teamPayloadB?.score);

        if (teamARefs.length === 0 || teamBRefs.length === 0) {
          teamARawRefs = Array.isArray(sourceMatch?.survey_team_a) ? sourceMatch.survey_team_a : [];
          teamBRawRefs = Array.isArray(sourceMatch?.survey_team_b) ? sourceMatch.survey_team_b : [];
          teamARefs = normalizeTeamRefs(teamARawRefs);
          teamBRefs = normalizeTeamRefs(teamBRawRefs);
        }

        if (teamARefs.length === 0 || teamBRefs.length === 0) {
          teamARawRefs = Array.isArray(sourceMatch?.final_team_a) ? sourceMatch.final_team_a : [];
          teamBRawRefs = Array.isArray(sourceMatch?.final_team_b) ? sourceMatch.final_team_b : [];
          teamARefs = normalizeTeamRefs(teamARawRefs);
          teamBRefs = normalizeTeamRefs(teamBRawRefs);
        }

        if (teamARefs.length === 0 || teamBRefs.length === 0 || persistedTeamsPayload.length === 0) {
          const { data: latestConfirmation, error: confirmationError } = await supabase
            .from('partido_team_confirmations')
            .select('team_a, team_b, teams_json')
            .eq('partido_id', matchIdFilter)
            .order('confirmed_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!confirmationError && latestConfirmation) {
            confirmationRow = latestConfirmation;
          }
        }

        if (isCancelled) return;

        if (confirmationRow) {
          const confirmationPayload = normalizeTeamsPayload(confirmationRow?.teams_json);
          if ((persistedTeamsPayload.length === 0 || teamARefs.length === 0 || teamBRefs.length === 0) && confirmationPayload.length > 0) {
            persistedTeamsPayload = confirmationPayload;
            [teamPayloadA, teamPayloadB] = pickOrderedTeamsFromPayload(persistedTeamsPayload);
            payloadARefs = resolveTeamPlayerRefsFromPayload(teamPayloadA);
            payloadBRefs = resolveTeamPlayerRefsFromPayload(teamPayloadB);
            teamARawRefs = payloadARefs;
            teamBRawRefs = payloadBRefs;
            teamARefs = normalizeTeamRefs(teamARawRefs);
            teamBRefs = normalizeTeamRefs(teamBRawRefs);
            teamAName = String(teamPayloadA?.name || teamAName || 'Equipo A').trim() || 'Equipo A';
            teamBName = String(teamPayloadB?.name || teamBName || 'Equipo B').trim() || 'Equipo B';
            teamAScoreFromPayload = toFiniteNumber(teamPayloadA?.score) ?? teamAScoreFromPayload;
            teamBScoreFromPayload = toFiniteNumber(teamPayloadB?.score) ?? teamBScoreFromPayload;
          }

          if (teamARefs.length === 0 || teamBRefs.length === 0) {
            teamARawRefs = Array.isArray(confirmationRow?.team_a) ? confirmationRow.team_a : [];
            teamBRawRefs = Array.isArray(confirmationRow?.team_b) ? confirmationRow.team_b : [];
            teamARefs = normalizeTeamRefs(teamARawRefs);
            teamBRefs = normalizeTeamRefs(teamBRawRefs);
          }
        }

        const hasPersistedTeams = teamARefs.length > 0 && teamBRefs.length > 0;
        const hasConfirmedFlag = Boolean(
          sourceMatch?.teams_confirmed
          ?? sourceMatch?.teams_locked
          ?? confirmationRow,
        );
        const shouldExposeGuestTeams = hasConfirmedFlag || hasPersistedTeams || persistedTeamsPayload.length > 0;

        if (!shouldExposeGuestTeams) {
          clearGuestTeams();
          return;
        }

        const refToKeyMap = buildPlayerRefToKeyMap(jugadores);
        const keyToPlayerMap = new Map(
          jugadores.map((player) => [String(resolvePlayerKey(player) || '').trim(), player]).filter(([key]) => key),
        );
        const teamAPlayers = mapTeamRefsToPlayers({
          refs: teamARefs,
          rawRefs: teamARawRefs,
          refToKeyMap,
          keyToPlayerMap,
        });
        const teamBPlayers = mapTeamRefsToPlayers({
          refs: teamBRefs,
          rawRefs: teamBRawRefs,
          refToKeyMap,
          keyToPlayerMap,
        });
        const hasDisplayableTeams = teamAPlayers.length > 0 && teamBPlayers.length > 0;

        if (!hasDisplayableTeams) {
          setGuestConfirmedTeams({
            isAvailable: false,
            hasConfirmedFlag,
            teamAName,
            teamBName,
            teamAPlayers,
            teamBPlayers,
            teamAScore: 0,
            teamBScore: 0,
            balanceDiff: 0,
            balanceLabel: 'MUY PAREJO',
            balanceColor: '#10B981',
          });
          return;
        }

        const teamAScore = computeTeamScore({ explicitScore: teamAScoreFromPayload, players: teamAPlayers });
        const teamBScore = computeTeamScore({ explicitScore: teamBScoreFromPayload, players: teamBPlayers });
        const balanceDiff = Number(Math.abs(teamAScore - teamBScore).toFixed(1));
        const balanceMeta = resolveBalanceMeta(balanceDiff);

        setGuestConfirmedTeams({
          isAvailable: true,
          hasConfirmedFlag,
          teamAName,
          teamBName,
          teamAPlayers,
          teamBPlayers,
          teamAScore,
          teamBScore,
          balanceDiff,
          balanceLabel: balanceMeta.label,
          balanceColor: balanceMeta.color,
        });
      } catch (_error) {
        clearGuestTeams();
      }
    };

    loadGuestConfirmedTeams();

    return () => {
      isCancelled = true;
    };
  }, [isAdmin, showInviteStylePostJoin, partidoActual, jugadores]);

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
      const removed = await eliminarJugador(playerToRemove.id, true);
      if (!removed) {
        setPlayerToRemove(null);
        return;
      }
      console.info(`${playerToRemove.nombre || 'Jugador'} fue expulsado del partido`);
      setPlayerToRemove(null);
    } catch (error) {
      notifyBlockingError(error?.message || 'No se pudo expulsar al jugador');
    } finally {
      setIsRemovingPlayer(false);
    }
  };

  const handleAcceptInvitation = async () => {
    const joined = await aceptarInvitacion?.();
    if (joined) {
      setJoinSuccessModalOpen(true);
    }
  };

  const handleAddToCalendar = async () => {
    try {
      const { content, fileName } = buildMatchCalendarIcs(partidoActual);
      await shareOrDownloadCalendarIcs({
        content,
        fileName,
        title: 'Agregar al calendario',
      });
    } catch (error) {
      console.error('[CALENDAR_ICS] Error creating calendar file', error);
      notifyBlockingError('No se pudo agregar el partido al calendario');
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
              className="fixed w-48 border shadow-lg z-[9999] overflow-hidden transition-all duration-200 ease-out backdrop-blur-sm"
              style={{
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                opacity: localMenuOpen ? 1 : 0,
                transform: localMenuOpen ? `skewX(-${SLOT_SKEW_X}deg) scale(1)` : `skewX(-${SLOT_SKEW_X}deg) scale(0.95)`,
                borderColor: 'rgba(88, 107, 170, 0.46)',
                borderRadius: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.98)',
                boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ transform: `skewX(${SLOT_SKEW_X}deg)` }}>
                <div className="py-1 bg-transparent">
                  <button
                    className="w-full h-[46px] px-3 flex items-center gap-2 text-left text-slate-100 bg-transparent hover:bg-slate-800/90 transition-colors text-sm font-medium"
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
                data-prevent-profile-open="true"
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

  const renderSubstituteCard = (player, queuePosition) => {
    const isCreator = partidoActual?.creado_por === player.usuario_id;
    const playerKey = player.uuid || player.id || `${player.nombre}-${player.usuario_id || queuePosition || 'manual'}`;
    return (
      <PlayerCardTrigger
        key={`substitute-${playerKey}`}
        profile={player}
        partidoActual={partidoActual}
        onMakeAdmin={transferirAdmin}
      >
        <div
          className="relative rounded-none h-12 w-full max-w-[660px] mx-auto overflow-visible transition-all cursor-pointer hover:brightness-105"
          style={{
            ...SUBSTITUTES_CARD_STYLE,
            transform: `skewX(-${SLOT_SKEW_X}deg)`,
            backfaceVisibility: 'hidden',
          }}
        >
          <div
            className="absolute top-1 z-[2] min-w-[20px] h-[18px] px-1 rounded-[3px] inline-flex items-center justify-center text-[11px] font-bold leading-none"
            style={{
              right: isCreator ? '32px' : '6px',
              color: '#f4deaa',
              background: 'rgba(116, 84, 19, 0.46)',
              border: '1px solid rgba(239, 194, 92, 0.58)',
              fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
              letterSpacing: '0.01em',
            }}
            aria-label={`Posición en cola ${queuePosition}`}
            title={`Posición en cola ${queuePosition}`}
          >
            {queuePosition}
          </div>

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
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 border border-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-white">
                {getInitials(player.nombre)}
              </div>
            )}
            <span className="flex-1 font-oswald text-sm font-semibold text-white tracking-wide min-w-0 truncate leading-tight">
              {player.nombre || 'Jugador'}
            </span>

            {isCreator && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#FFD700" style={{ flexShrink: 0 }}>
                <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z" />
              </svg>
            )}

            {isAdmin && player.usuario_id !== user?.id ? (
              <button
                className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer transition-colors inline-flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={(e) => {
                  e.stopPropagation();
                  setPlayerToRemove({ id: player.id, nombre: player.nombre, isOwnPlayer: false });
                }}
                data-prevent-profile-open="true"
                type="button"
                aria-label="Eliminar jugador"
                disabled={isClosing}
                title="Eliminar jugador"
              >
                <span
                  className="leading-none text-[15px]"
                  style={{ color: '#f4cf7e' }}
                >
                  ×
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </PlayerCardTrigger>
    );
  };

  const renderAdminTitularesGrid = () => (
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
  );

  const renderAdminSubstitutesGrid = () => (
    <motion.div
      layout
      className="grid grid-cols-2 gap-4 w-full max-w-[720px] mx-auto justify-items-center box-border px-1"
      transition={{ layout: { duration: 0.22, ease: 'easeOut' } }}
    >
      <AnimatePresence initial={false}>
        {substituteSlotItems.map((player, idx) => {
          if (!player) {
            return (
              <motion.div
                key={`admin-substitute-empty-${idx}`}
                layout
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="rounded-none h-12 w-full overflow-hidden"
                style={{
                  ...SUBSTITUTES_SLOT_PLACEHOLDER_STYLE,
                  transform: `skewX(-${SLOT_SKEW_X}deg)`,
                }}
                aria-hidden="true"
              >
                <div
                  className="h-full w-full p-2 flex items-center justify-center"
                  style={inviteSkewCounterStyle}
                >
                  <span className="select-none pointer-events-none text-[28px]" style={SUBSTITUTES_PLACEHOLDER_NUMBER_STYLE}>
                    {idx + 1}
                  </span>
                </div>
              </motion.div>
            );
          }

          const playerKey = player.uuid || player.id || `${player.nombre}-${player.usuario_id || idx}`;
          return (
            <motion.div
              key={`admin-substitute-player-${playerKey}`}
              layout
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full"
            >
              {renderSubstituteCard(player, idx + 1)}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );

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
            <div className="font-oswald text-xl font-semibold tracking-[0.01em] flex items-center">
              <button
                type="button"
                onClick={() => setIsTitularesView(true)}
                className="bg-transparent border-0 p-0 m-0 text-left transition-colors duration-150"
                style={{ color: isTitularesView ? '#ffffff' : 'rgba(255,255,255,0.55)' }}
                aria-pressed={isTitularesView}
              >
                Titulares
              </button>
              <span className="mx-2 text-white/35 select-none pointer-events-none">|</span>
              <button
                type="button"
                onClick={() => setIsTitularesView(false)}
                className="bg-transparent border-0 p-0 m-0 text-left transition-colors duration-150 inline-flex items-center gap-1.5"
                style={{ color: isTitularesView ? 'rgba(255,255,255,0.55)' : 'rgba(252, 230, 178, 0.95)' }}
                aria-pressed={!isTitularesView}
              >
                <span>Suplentes</span>
                {substituteOverflowCount > 0 && (
                  <span
                    className="inline-flex items-center justify-center px-1.5 h-[16px] rounded-[3px] text-[10px] leading-none font-bold"
                    style={{
                      color: '#f4d89a',
                      background: 'rgba(121, 88, 20, 0.36)',
                      border: '1px solid rgba(239, 194, 92, 0.45)',
                    }}
                    aria-label={`${substituteOverflowCount} suplentes extra`}
                  >
                    +{substituteOverflowCount}
                  </span>
                )}
              </button>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                className={headerActionIconButtonClass}
                onClick={() => onShareRosterUpdate?.()}
                disabled={!canShareRosterUpdate}
                title="Compartir update por WhatsApp"
                aria-label="Compartir update por WhatsApp"
              >
                <Share2 size={14} style={{ color: HEADER_ICON_COLOR, filter: HEADER_ICON_GLOW }} />
              </button>

              {isAdmin && (
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

              {isAdmin && menuOpen && ReactDOM.createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9998] bg-transparent"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    className="fixed w-48 border shadow-lg z-[9999] overflow-hidden transition-all duration-200 ease-out backdrop-blur-sm"
                    style={{
                      top: `${menuPosition.top}px`,
                      left: `${menuPosition.left}px`,
                      opacity: menuOpen ? 1 : 0,
                      transform: menuOpen ? `skewX(-${SLOT_SKEW_X}deg) scale(1)` : `skewX(-${SLOT_SKEW_X}deg) scale(0.95)`,
                      borderColor: 'rgba(88, 107, 170, 0.46)',
                      borderRadius: 0,
                      backgroundColor: 'rgba(15, 23, 42, 0.98)',
                      boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ transform: `skewX(${SLOT_SKEW_X}deg)` }}>
                      <div className="py-1 bg-transparent">
                        {isPlayerInMatch ? (
                          <button
                            className="w-full h-[46px] px-3 flex items-center gap-2 text-left text-slate-100 bg-transparent hover:bg-slate-800/90 transition-colors text-sm font-medium"
                            onClick={() => {
                              setMenuOpen(false);
                              setConfirmConfig({ open: true, type: 'abandon' });
                            }}
                            type="button"
                          >
                            <LogOut size={14} />
                            <span>Abandonar partido</span>
                          </button>
                        ) : (
                          <button
                            className="w-full h-[46px] px-3 flex items-center gap-2 text-left text-slate-100 bg-transparent hover:bg-slate-800/90 transition-colors text-sm font-medium disabled:opacity-45 disabled:cursor-not-allowed"
                            onClick={() => {
                              setMenuOpen(false);
                              unirseAlPartido?.();
                            }}
                            type="button"
                            disabled={typeof unirseAlPartido !== 'function' || isMatchFull}
                          >
                            <UserPlus size={14} />
                            <span>Sumarme al partido</span>
                          </button>
                        )}
                      </div>
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
              style={{ width: `${activeRosterProgressPct}%`, backgroundColor: activeRosterProgressColor, filter: 'saturate(1.05)' }}
            />
          </div>
          {duplicatesDetected > 0 && (
            <div className="mt-2 text-[11px] text-[#ffb08d] font-oswald">
              {duplicatesDetected} duplicado{duplicatesDetected > 1 ? 's' : ''} detectado{duplicatesDetected > 1 ? 's' : ''}
            </div>
          )}
        </div>

        <div style={{ minHeight: `${rosterViewportMinHeight}px` }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={isTitularesView ? 'admin-roster-titulares' : 'admin-roster-suplentes'}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {isTitularesView ? renderAdminTitularesGrid() : renderAdminSubstitutesGrid()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );

  // Guest view (non-admin)
  if (!isAdmin) {
    return (
      <>
        <div className="w-full flex flex-col pb-32">
          {showInviteStyleRoster ? (
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

          <div className={`w-full relative z-10 text-center ${showInviteStyleRoster ? 'px-2 mt-5' : 'px-4 mt-6'}`}>
            {!showInviteStyleRoster && (!partidoActual.cupo_jugadores || (remainingTitularSlots !== null && remainingTitularSlots > 0)) && (
              <div className="mb-4 text-white/60 font-oswald text-sm">
                {capacity
                  ? `Falta${remainingTitularSlots > 1 ? 'n' : ''} ${remainingTitularSlots} titular${remainingTitularSlots > 1 ? 'es' : ''}`
                  : 'Cupos disponibles'}
              </div>
            )}

            {showInviteStylePostJoin ? (
              <div className="w-full max-w-[340px] mx-auto px-2 sm:px-0 flex flex-col gap-2">
                <div className="w-full border-t border-white/15 mb-1" aria-hidden="true" />
                {showViewTeamsButton && (
                  <button
                    className={matchPrimaryButtonClass}
                    onClick={() => setGuestTeamsModalOpen(true)}
                  >
                    <span>Ver equipos</span>
                  </button>
                )}
                <button
                  className={showViewTeamsButton ? matchSecondaryButtonClass : matchPrimaryButtonClass}
                  onClick={handleAddToCalendar}
                >
                  <span>Agregar al calendario</span>
                </button>
              </div>
            ) : (
              <div className="w-full max-w-[500px] mx-auto">
                <div className="flex gap-3">
                  {!hasActivePendingInvite ? (
                    <div className="w-full flex flex-col items-center justify-center py-2 text-white/60">
                      <span className="font-bebas text-xl mb-1 opacity-80">
                        {invitationStatus === 'declined'
                          ? 'INVITACIÓN RECHAZADA'
                          : invitationStatus === 'kicked'
                            ? 'INVITACIÓN CANCELADA'
                            : 'INVITACIÓN NO VÁLIDA'}
                      </span>
                      <span className="text-sm font-light opacity-60">
                        {invitationStatus === 'declined'
                          ? 'Ya rechazaste esta invitación.'
                          : invitationStatus === 'kicked'
                            ? 'Fuiste removido del partido por el admin.'
                            : 'Esta invitación ha expirado o ya fue respondida.'}
                      </span>
                    </div>
                  ) : (
                    <>
                      <button
                        className={matchPrimaryButtonClass}
                        onClick={handleAcceptInvitation}
                        disabled={invitationLoading || isMatchFull}
                      >
                        {invitationLoading ? <LoadingSpinner size="small" /> : 'Aceptar'}
                      </button>
                      <button
                        className={matchSecondaryButtonClass}
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
        <ConfirmModal
          isOpen={joinSuccessModalOpen}
          title="Te has unido!"
          message="Podes acceder desde Mis partidos."
          confirmText="Aceptar"
          singleButton={true}
          onConfirm={() => setJoinSuccessModalOpen(false)}
          onCancel={() => setJoinSuccessModalOpen(false)}
        />
        <GuestTeamsReadOnlyModal
          isOpen={guestTeamsModalOpen}
          onClose={() => setGuestTeamsModalOpen(false)}
          teamAName={guestConfirmedTeams.teamAName}
          teamBName={guestConfirmedTeams.teamBName}
          teamAPlayers={guestConfirmedTeams.teamAPlayers}
          teamBPlayers={guestConfirmedTeams.teamBPlayers}
          teamAScore={guestConfirmedTeams.teamAScore}
          teamBScore={guestConfirmedTeams.teamBScore}
          balanceDiff={guestConfirmedTeams.balanceDiff}
          balanceLabel={guestConfirmedTeams.balanceLabel}
          balanceColor={guestConfirmedTeams.balanceColor}
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
