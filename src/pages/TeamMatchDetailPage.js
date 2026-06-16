import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Flag, MoreVertical, Shield, Users } from 'lucide-react';
import { useAuth } from '../components/AuthProvider';
import PageTitle from '../components/PageTitle';
import PageTransition from '../components/PageTransition';
import Button from '../components/Button';
import Modal from '../components/Modal';
import ChatButton from '../components/ChatButton';
import MatchInfoSection from '../components/MatchInfoSection';
import ProfileCardModal from '../components/ProfileCardModal';
import LocationAutocomplete from '../features/equipos/components/LocationAutocomplete';
import {
  TEAM_FORMAT_OPTIONS,
  TEAM_MODE_OPTIONS,
  resolveChallengeSquadLimits,
} from '../features/equipos/config';
import { getTeamBadgeStyle } from '../features/equipos/utils/teamColors';
import {
  getViewerChallengeTeam,
  resolveChallengeSquadViewState,
} from '../features/equipos/utils/challengeViewer';
import { buildChallengeHeadToHeadView } from '../features/equipos/utils/challengeHeadToHead';
import {
  canResolveChallengeResult,
  canTeamReportChallengeResult,
  challengeHasAcceptedRival,
  getChallengeResultOutcomeLabel,
  isChallengeResultActionState,
  isChallengeResultConflict,
  isChallengeResultConfirmed,
  isChallengeResultLoaded,
  resultStatusToOutcome,
} from '../features/equipos/utils/challengeResult';
import ReportChallengeResultModal from '../features/equipos/components/ReportChallengeResultModal';
import ResolveChallengeResultModal from '../features/equipos/components/ResolveChallengeResultModal';
import ChallengeResultCtaCard from '../features/equipos/components/ChallengeResultCtaCard';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import {
  getChallengeHeadToHeadStats,
  reportChallengeResult,
  resolveChallengeResult,
  getTeamMatchById,
  listChallengeTeamSquad,
  setChallengeAvailability,
  setChallengeSquadStatus,
  listTeamMatchMembers,
  upsertChallengeTeamSelection,
  updateTeamMatchDetails,
} from '../services/db/teamChallenges';
import { notifyBlockingError } from '../utils/notifyBlockingError';
import { useSmartBackNavigation } from '../hooks/useSmartBackNavigation';
import { useRefreshOnVisibility } from '../hooks/useRefreshOnVisibility';
import { useInterval } from '../hooks/useInterval';

const DETAIL_CARD_RADIUS_CLASS = 'rounded-[18px]';
const TEAM_MATCH_LIVE_REFRESH_INTERVAL_MS = 5000;
const EMPTY_CHALLENGE_HEAD_TO_HEAD = Object.freeze({
  totalEncounters: 0,
  totalMatchesPlayed: 0,
  lastEncounterAt: null,
  lastResultAt: null,
  lastWinnerTeamId: null,
  lastResultStatus: null,
  winsTeamA: 0,
  winsTeamB: 0,
  draws: 0,
});

const toDateTimeLocalValue = (isoDate) => {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const formatLocalDateAndTime = (value) => {
  if (!value) return { fecha: null, hora: null };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { fecha: null, hora: null };
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return {
    fecha: `${year}-${month}-${day}`,
    hora: `${hour}:${minute}`,
  };
};

const statusLabelByValue = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  played: 'Jugado',
  cancelled: 'Cancelado',
};

const getOriginBadgeClass = (originType) => {
  if (String(originType || '').toLowerCase() === 'challenge') {
    return 'bg-[#2b1d52]/75 border-[#c084fc]/35 text-[#ead9ff]';
  }
  return 'bg-[#15344f]/65 border-[#22d3ee]/30 text-[#dff3ff]';
};

const getStatusBadgeClass = (statusValue) => {
  const status = String(statusValue || '').trim().toLowerCase();
  if (status === 'confirmed') return 'text-[#D6F8E2] border-[#5AD17B]/35 bg-[#2F9E44]/18';
  if (status === 'pending') return 'text-[#FDE68A] border-[#FBBF24]/35 bg-[#B45309]/18';
  if (status === 'played') return 'text-[#D4EBFF] border-[#9ED3FF]/35 bg-[#128BE9]/16';
  if (status === 'cancelled') return 'text-[#E2E8F0] border-[#94A3B8]/35 bg-[#475569]/22';
  return 'text-white/85 border-white/20 bg-white/[0.08]';
};

const SQUAD_STATUS_LABEL_BY_VALUE = {
  not_open: 'No abierta',
  open: 'Abierta',
  closed: 'Cerrada',
  finalized: 'Finalizada',
};

const getSquadStatusBadgeClass = (statusValue) => {
  const normalized = String(statusValue || '').trim().toLowerCase();
  if (normalized === 'open') return 'text-[#D6F8E2] border-[#5AD17B]/45 bg-[#2F9E44]/24';
  if (normalized === 'closed') return 'text-[#FDE68A] border-[#FBBF24]/45 bg-[#B45309]/24';
  if (normalized === 'finalized') return 'text-[#D4EBFF] border-[#9ED3FF]/45 bg-[#128BE9]/22';
  return 'text-white/85 border-white/25 bg-white/10';
};

const getPersonalChallengeCurrentStateLabel = (row) => {
  const selection = String(row?.selection_status || '').trim().toLowerCase();
  const availability = String(row?.availability_status || '').trim().toLowerCase();
  if (selection === 'starter' && row?.approved_by_captain) return 'Titular';
  if (selection === 'substitute' && row?.approved_by_captain) return 'Suplente';
  if (selection === 'not_selected' && row?.approved_by_captain) return 'Afuera';
  if (availability === 'available') return 'Disponible';
  if (availability === 'unavailable') return 'No disponible';
  return 'Pendiente';
};

const getAvailabilityStatusLabel = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'available') return 'Disponible';
  if (normalized === 'unavailable') return 'No disponible';
  return 'Pendiente';
};

// Sin glow por fila: la lista del plantel se repite por jugador y las sombras
// repetidas pesan en el render mobile.
const getAvailabilityIndicatorClass = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'available') return 'bg-[#22c55e]';
  if (normalized === 'unavailable') return 'bg-[#ef4444]';
  return 'bg-[#fbbf24]';
};

const normalizeIdentityToken = (value) => String(value || '').trim();

const getPlayerName = (member) => String(member?.jugador?.nombre || 'Jugador').trim();

const getPlayerAvatar = (member) => (
  member?.photo_url
  || member?.profile_avatar_url
  || member?.jugador?.avatar_url
  || null
);

const isCancelledTeamMatchStatus = (statusValue) => {
  const normalized = String(statusValue || '').trim().toLowerCase();
  return normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancelado';
};

const modalActionButtonBaseClass = '!w-full !h-auto !min-h-[44px] !px-4 !py-2.5 !rounded-xl !font-bebas !text-base !tracking-[0.01em] !normal-case sm:!text-[13px] sm:!px-3 sm:!py-2 sm:!min-h-[36px]';
const modalActionPrimaryClass = `${modalActionButtonBaseClass} !border !border-[#8f7bff] !bg-[linear-gradient(135deg,#7d5aff_0%,#5b3cff_58%,#ec007d_145%)] !text-white !shadow-[0_0_16px_rgba(139,92,255,0.26)] hover:!brightness-110`;
const modalActionSecondaryClass = `${modalActionButtonBaseClass} !border !border-[rgba(148,134,255,0.28)] !bg-white/[0.05] !text-white/92 hover:!bg-[rgba(30,45,94,0.95)]`;
const squadActionButtonBaseClass = 'min-h-[44px] px-4 py-2.5 rounded-xl border font-bebas text-base tracking-[0.01em] transition-all inline-flex items-center justify-center text-center cursor-pointer sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';
const squadActionPrimaryClass = `${squadActionButtonBaseClass} border-white/20 bg-cta-gradient text-white shadow-cta hover:brightness-105 active:scale-[0.985] disabled:opacity-45 disabled:shadow-none disabled:cursor-not-allowed`;
const squadActionSecondaryClass = `${squadActionButtonBaseClass} border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/92 hover:bg-white/[0.1] active:opacity-95 disabled:opacity-55 disabled:cursor-not-allowed`;
const participationActionPrimaryClass = `${squadActionButtonBaseClass} border-white/20 bg-cta-gradient text-white shadow-cta hover:brightness-105 active:scale-[0.985] disabled:opacity-45 disabled:shadow-none disabled:cursor-not-allowed`;
const participationActionSecondaryClass = `${squadActionButtonBaseClass} border-[rgba(148,134,255,0.24)] bg-white/[0.04] text-white/90 hover:bg-white/[0.08] hover:border-[rgba(148,134,255,0.4)] active:scale-[0.985] disabled:opacity-45 disabled:cursor-not-allowed`;

const getPlayerProfile = (member) => {
  const userId = member?.user_id || member?.jugador?.usuario_id || null;
  const fallbackId = member?.jugador?.id || member?.jugador_id || null;

  return {
    id: userId || fallbackId,
    usuario_id: userId,
    user_id: userId,
    nombre: getPlayerName(member),
    avatar_url: getPlayerAvatar(member),
    ranking: member?.jugador?.score ?? null,
  };
};

const getInitials = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'J';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
};

const formatHeadToHeadDate = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
};

const MATCHUP_AVATAR_VISIBLE_LIMIT = 4;

const MatchupTeamSide = ({
  team,
  fallbackName,
  members,
  accent,
  onOpenProfile,
  onOpenRoster,
}) => {
  const visibleMembers = (members || []).slice(0, MATCHUP_AVATAR_VISIBLE_LIMIT);
  const overflowCount = Math.max(0, (members || []).length - visibleMembers.length);
  const totalMembers = (members || []).length;
  const statusLabel = totalMembers > 0 ? `${totalMembers} jugadores` : 'Sin jugadores';
  const teamName = team?.name || fallbackName;
  const badgeStyle = getTeamBadgeStyle(team);
  const teamNameLength = String(teamName || '').trim().length;
  const teamNameSizeClass = teamNameLength >= 18
    ? 'text-[12px] sm:text-[14px] tracking-[0.01em]'
    : teamNameLength >= 12
      ? 'text-[14px] sm:text-[16px] tracking-[0.012em]'
      : 'text-[17px] sm:text-[19px] tracking-[0.015em]';
  const crestBorderClass = accent === 'violet'
    ? 'border-[#7d5aff]/55'
    : 'border-[#8aa6ff]/45';

  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div className={`h-14 w-14 sm:h-16 sm:w-16 rounded-[16px] overflow-hidden border bg-[#151034] flex items-center justify-center shrink-0 ${crestBorderClass}`}>
        {team?.crest_url ? (
          <img src={team.crest_url} alt={teamName} className="h-full w-full object-cover" />
        ) : (
          <Shield size={24} className="text-white/70" />
        )}
      </div>
      <div className={`mt-2 w-full min-w-0 px-0.5 text-center text-white font-oswald font-semibold leading-tight whitespace-nowrap overflow-hidden text-ellipsis ${teamNameSizeClass}`}>
        {teamName}
      </div>
      <button
        type="button"
        onClick={onOpenRoster}
        className="mt-1.5 inline-flex items-center rounded-[12px] border px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] font-oswald transition-colors hover:bg-white/15"
        style={badgeStyle}
        aria-label={`Ver plantilla de ${teamName}`}
        title="Ver plantilla completa"
      >
        {statusLabel}
      </button>

      <div className="mt-2.5 flex items-center justify-center gap-1 flex-nowrap overflow-hidden min-h-[28px]">
        {visibleMembers.length > 0 ? visibleMembers.map((member) => {
          const name = getPlayerName(member);
          const avatar = getPlayerAvatar(member);
          return (
            <button
              key={`${member?.id || member?.jugador_id || name}`}
              type="button"
              onClick={() => onOpenProfile(getPlayerProfile(member))}
              className="h-7 w-7 rounded-full border border-[rgba(168,152,255,0.35)] bg-[#151034]/85 overflow-hidden flex items-center justify-center text-[9px] font-semibold text-white/90 shrink-0"
              title={name}
              aria-label={`Ver perfil de ${name}`}
            >
              {avatar ? (
                <img src={avatar} alt={name} className="h-full w-full object-cover" />
              ) : (
                <span>{getInitials(name)}</span>
              )}
            </button>
          );
        }) : (
          <span className="text-[11px] text-white/55 font-oswald">Sin jugadores</span>
        )}

        {overflowCount > 0 ? (
          <button
            type="button"
            onClick={onOpenRoster}
            className="h-7 w-7 rounded-full border border-[rgba(168,152,255,0.35)] bg-[#151034]/85 text-[10px] text-white/85 font-oswald shrink-0 flex items-center justify-center"
            aria-label={`Ver ${overflowCount} jugadores mas`}
            title="Ver plantilla completa"
          >
            +{overflowCount}
          </button>
        ) : null}
      </div>
    </div>
  );
};

const MatchupHeroCard = ({
  teamA,
  teamB,
  membersA,
  membersB,
  onOpenProfile,
  onOpenRosterA,
  onOpenRosterB,
  className = '',
}) => (
  <div
    className={`relative overflow-hidden ${DETAIL_CARD_RADIUS_CLASS} border border-[rgba(148,134,255,0.26)] bg-[radial-gradient(circle_at_10%_0%,rgba(124,58,237,0.22),transparent_55%),radial-gradient(circle_at_92%_100%,rgba(236,0,125,0.08),transparent_55%),linear-gradient(180deg,#1c1545_0%,#0d0a26_100%)] px-3 py-4 sm:px-5 sm:py-5 min-w-0 shadow-[0_16px_28px_rgba(5,3,18,0.45)] ${className}`}
  >
    <div className="relative grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-3">
      <MatchupTeamSide
        team={teamA}
        fallbackName="Equipo A"
        members={membersA}
        accent="violet"
        onOpenProfile={onOpenProfile}
        onOpenRoster={onOpenRosterA}
      />

      <div className="flex flex-col items-center justify-center self-stretch px-0.5">
        <span className="w-px flex-1 bg-gradient-to-b from-transparent via-[rgba(148,134,255,0.35)] to-[rgba(148,134,255,0.12)]" />
        <span className="my-1.5 flex h-9 w-9 rotate-45 items-center justify-center rounded-[10px] border border-[rgba(202,182,255,0.4)] bg-[linear-gradient(150deg,#6a43ff_0%,#3a2480_55%,#221a4d_100%)] shadow-[0_6px_16px_rgba(8,5,24,0.5)]">
          <span className="-rotate-45 font-bebas text-[15px] leading-none tracking-[0.05em] text-white">VS</span>
        </span>
        <span className="w-px flex-1 bg-gradient-to-t from-transparent via-[rgba(236,0,125,0.25)] to-[rgba(236,0,125,0.08)]" />
      </div>

      <MatchupTeamSide
        team={teamB}
        fallbackName="Equipo B"
        members={membersB}
        accent="blue"
        onOpenProfile={onOpenProfile}
        onOpenRoster={onOpenRosterB}
      />
    </div>
  </div>
);

const TeamMatchDetailPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const goBackSmart = useSmartBackNavigation({
    fallback: '/desafios',
  });
  const { matchId } = useParams();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [match, setMatch] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [teamMembersByTeamId, setTeamMembersByTeamId] = useState({});
  const [challengeSquadByTeamId, setChallengeSquadByTeamId] = useState({});
  const [challengeSquadMeta, setChallengeSquadMeta] = useState(null);
  const [challengeSquadLoading, setChallengeSquadLoading] = useState(false);
  const [challengeSquadSaving, setChallengeSquadSaving] = useState(false);
  const [inlineNotice, setInlineNotice] = useState({ type: '', message: '' });
  const [rosterTeamId, setRosterTeamId] = useState(null);
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [actionsMenuPosition, setActionsMenuPosition] = useState({ top: 0, left: 0 });
  const [challengeHeadToHead, setChallengeHeadToHead] = useState(EMPTY_CHALLENGE_HEAD_TO_HEAD);
  const [challengeHeadToHeadLoading, setChallengeHeadToHeadLoading] = useState(false);
  const [showChallengeHeadToHead, setShowChallengeHeadToHead] = useState(false);
  const [headToHeadReloadKey, setHeadToHeadReloadKey] = useState(0);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [resultModalSubmitting, setResultModalSubmitting] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveModalSubmitting, setResolveModalSubmitting] = useState(false);
  const [isSquadRosterViewOpen, setIsSquadRosterViewOpen] = useState(false);
  const [ambiguousTeamDecision, setAmbiguousTeamDecision] = useState(null);
  const [ambiguousTeamModalOpen, setAmbiguousTeamModalOpen] = useState(false);
  const { setIntervalSafe, clearIntervalSafe } = useInterval();
  const actionsMenuButtonRef = useRef(null);
  const cancelledRedirectRef = useRef(false);
  const challengeSquadLoadKeyRef = useRef('');
  const hasVisibleChallengeSquadRef = useRef(false);

  useEffect(() => {
    if (!inlineNotice?.message) return undefined;
    const autoHideMs = inlineNotice?.type === 'warning' ? 4200 : 3200;
    const timer = setTimeout(() => {
      setInlineNotice({ type: '', message: '' });
    }, autoHideMs);
    return () => clearTimeout(timer);
  }, [inlineNotice?.message, inlineNotice?.type]);

  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [canchaCostInput, setCanchaCostInput] = useState('');
  const [formatInput, setFormatInput] = useState('');
  const [generoInput, setGeneroInput] = useState('');

  const syncFormWithMatch = useCallback((nextMatch) => {
    setScheduledAtInput(toDateTimeLocalValue(nextMatch?.scheduled_at));
    setLocationInput(nextMatch?.location || nextMatch?.location_name || '');
    setCanchaCostInput(
      nextMatch?.cancha_cost == null || Number.isNaN(Number(nextMatch?.cancha_cost))
        ? ''
        : String(nextMatch.cancha_cost),
    );
    setFormatInput(nextMatch?.format ? String(nextMatch.format) : '');
    setGeneroInput(nextMatch?.mode || '');
  }, []);

  const loadMembersForMatch = useCallback(async (matchRow) => {
    const teamIds = [matchRow?.team_a_id, matchRow?.team_b_id]
      .filter(Boolean)
      .map((value) => String(value));
    if (teamIds.length === 0) {
      setTeamMembersByTeamId({});
      return;
    }

    const membersByTeamId = await listTeamMatchMembers({
      matchId: matchRow?.id || null,
      teamIds,
    });

    setTeamMembersByTeamId(membersByTeamId || {});
  }, []);

  const loadChallengeSquadForMatch = useCallback(async (matchRow, { silent = false } = {}) => {
    const challengeId = matchRow?.challenge_id || null;
    const teamIds = [matchRow?.team_a_id, matchRow?.team_b_id].filter(Boolean);
    const loadKey = challengeId ? `${challengeId}:${teamIds.map((value) => String(value)).join(',')}` : '';

    if (!challengeId || teamIds.length === 0) {
      challengeSquadLoadKeyRef.current = '';
      hasVisibleChallengeSquadRef.current = false;
      setChallengeSquadByTeamId({});
      setChallengeSquadMeta(null);
      return;
    }

    if (challengeSquadLoadKeyRef.current !== loadKey) {
      challengeSquadLoadKeyRef.current = loadKey;
      hasVisibleChallengeSquadRef.current = false;
    }

    try {
      if (!silent && !hasVisibleChallengeSquadRef.current) {
        setChallengeSquadLoading(true);
      }
      const result = await listChallengeTeamSquad({
        challengeId,
        teamIds,
        ensurePrepared: true,
      });
      setChallengeSquadByTeamId(result?.byTeamId || {});
      setChallengeSquadMeta(result?.challenge || null);
      hasVisibleChallengeSquadRef.current = true;
    } catch (error) {
      if (!silent) {
        hasVisibleChallengeSquadRef.current = false;
        setChallengeSquadByTeamId({});
        setChallengeSquadMeta(null);
        notifyBlockingError(error.message || 'No se pudo cargar la convocatoria del desafío');
      } else {
        console.warn('[TEAM MATCH DETAIL] refresh silencioso de convocatoria fallido', error);
      }
    } finally {
      setChallengeSquadLoading(false);
    }
  }, []);

  const refreshMatchView = useCallback(async ({
    withLoading = false,
    silent = false,
    syncForm = true,
  } = {}) => {
    if (!matchId) return;

    try {
      if (withLoading) setLoading(true);
      const matchRow = await getTeamMatchById(matchId);
      setMatch(matchRow);
      if (syncForm) {
        syncFormWithMatch(matchRow);
      }
      await loadMembersForMatch(matchRow);
      await loadChallengeSquadForMatch(matchRow, { silent });
    } catch (error) {
      if (!silent) {
        notifyBlockingError(error.message || 'No se pudo cargar el partido');
      } else {
        console.warn('[TEAM MATCH DETAIL] refresh silencioso del partido fallido', error);
      }
    } finally {
      if (withLoading) setLoading(false);
    }
  }, [loadChallengeSquadForMatch, loadMembersForMatch, matchId, syncFormWithMatch]);

  useEffect(() => {
    refreshMatchView({
      withLoading: true,
      silent: false,
      syncForm: true,
    });
  }, [refreshMatchView]);

  useRefreshOnVisibility(
    () => {
      if (loading || saving || challengeSquadSaving) return;
      refreshMatchView({
        withLoading: false,
        silent: true,
        syncForm: !editModalOpen,
      });
    },
    {
      enabled: Boolean(matchId),
    },
  );

  useEffect(() => {
    clearIntervalSafe();

    if (!matchId) return undefined;

    setIntervalSafe(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (loading || saving || challengeSquadSaving) return;
      refreshMatchView({
        withLoading: false,
        silent: true,
        syncForm: !editModalOpen,
      });
    }, TEAM_MATCH_LIVE_REFRESH_INTERVAL_MS);

    return () => clearIntervalSafe();
  }, [
    challengeSquadSaving,
    clearIntervalSafe,
    editModalOpen,
    loading,
    matchId,
    refreshMatchView,
    saving,
    setIntervalSafe,
  ]);

  const isChallengeMatch = useMemo(
    () => String(match?.type || match?.origin_type || '').toLowerCase() === 'challenge' || Boolean(match?.challenge_id),
    [match?.challenge_id, match?.origin_type, match?.type],
  );
  const isCancelledMatch = useMemo(
    () => isCancelledTeamMatchStatus(match?.status),
    [match?.status],
  );
  const isPastScheduledTeamMatch = useMemo(() => {
    const scheduledAtMs = match?.scheduled_at ? new Date(match.scheduled_at).getTime() : NaN;
    return Number.isFinite(scheduledAtMs) && scheduledAtMs <= Date.now();
  }, [match?.scheduled_at]);
  const hasChallengeAcceptedRival = useMemo(
    () => isChallengeMatch && challengeHasAcceptedRival(match),
    [isChallengeMatch, match],
  );
  const isUnavailablePastChallengeMatch = isChallengeMatch
    && isPastScheduledTeamMatch
    && !hasChallengeAcceptedRival;

  useEffect(() => {
    if (loading || !match || !isCancelledMatch || cancelledRedirectRef.current) return;
    cancelledRedirectRef.current = true;
    notifyBlockingError('Este partido fue cancelado y ya no está disponible.');
    navigate('/desafios', { replace: true });
  }, [isCancelledMatch, loading, match, navigate]);

  useEffect(() => {
    if (loading || !match || !isUnavailablePastChallengeMatch || cancelledRedirectRef.current) return;
    cancelledRedirectRef.current = true;
    notifyBlockingError('Este desafío ya pasó y ya no está disponible.');
    navigate('/desafios', { replace: true });
  }, [isUnavailablePastChallengeMatch, loading, match, navigate]);

  useEffect(() => {
    let ignore = false;

    const loadChallengeHeadToHead = async () => {
      const teamAId = match?.team_a_id;
      const teamBId = match?.team_b_id;
      if (!isChallengeMatch || !teamAId || !teamBId) {
        setShowChallengeHeadToHead(false);
        setChallengeHeadToHeadLoading(false);
        setChallengeHeadToHead(EMPTY_CHALLENGE_HEAD_TO_HEAD);
        return;
      }

      setShowChallengeHeadToHead(true);
      setChallengeHeadToHeadLoading(true);

      try {
        const stats = await getChallengeHeadToHeadStats({
          teamAId,
          teamBId,
          excludeMatchId: match?.id || null,
        });
        if (ignore) return;
        setChallengeHeadToHead({
          ...EMPTY_CHALLENGE_HEAD_TO_HEAD,
          ...(stats || {}),
        });
      } catch (_error) {
        if (ignore) return;
        setShowChallengeHeadToHead(false);
        setChallengeHeadToHead(EMPTY_CHALLENGE_HEAD_TO_HEAD);
      } finally {
        if (!ignore) {
          setChallengeHeadToHeadLoading(false);
        }
      }
    };

    loadChallengeHeadToHead();
    return () => {
      ignore = true;
    };
  }, [isChallengeMatch, match?.id, match?.team_a_id, match?.team_b_id, headToHeadReloadKey]);

  // El creador del desafío puede venir embebido en el match
  // (match.challenge.created_by_user_id) o, si ese embed llega sin el dato,
  // en el challenge que la pantalla ya carga aparte para la convocatoria
  // (challengeSquadMeta). Tomamos el primero disponible para que el creador no
  // pierda el acceso de edición cuando falta el embed.
  const challengeCreatorUserId = useMemo(
    () => (
      match?.challenge?.created_by_user_id
      || challengeSquadMeta?.created_by_user_id
      || null
    ),
    [match?.challenge?.created_by_user_id, challengeSquadMeta?.created_by_user_id],
  );

  const canEditMatchInfo = useMemo(() => {
    const userIdToken = String(user?.id || '').trim();
    if (!isChallengeMatch || !userIdToken) return false;

    if (challengeCreatorUserId && userIdToken === String(challengeCreatorUserId).trim()) {
      return true;
    }

    const userManagesTeam = (teamId, team) => {
      const teamIdToken = String(teamId || '').trim();
      if (!teamIdToken) return false;
      if (String(team?.owner_user_id || '').trim() === userIdToken) return true;

      const members = teamMembersByTeamId?.[teamIdToken] || [];
      const currentMember = members.find((member) => (
        String(member?.user_id || member?.jugador?.usuario_id || '').trim() === userIdToken
      )) || null;
      if (!currentMember) return false;
      if (Boolean(currentMember?.is_captain)) return true;

      const permissionsRole = String(currentMember?.permissions_role || '').trim().toLowerCase();
      return permissionsRole === 'admin' || permissionsRole === 'owner';
    };

    return userManagesTeam(match?.team_a_id, match?.team_a)
      || userManagesTeam(match?.team_b_id, match?.team_b);
  }, [
    challengeCreatorUserId,
    isChallengeMatch,
    match?.team_a,
    match?.team_a_id,
    match?.team_b,
    match?.team_b_id,
    teamMembersByTeamId,
    user?.id,
  ]);
  // El creador/admin del desafío puede editar el partido mientras no haya
  // resultado cargado ni conflicto. El horario ya pasado no bloquea la edición;
  // reprogramar fecha/hora/sede aunque el rival ya haya aceptado y la hora
  // original haya pasado.
  const hasChallengeResultLoaded = isChallengeResultLoaded(match?.result_status) || isChallengeResultConflict(match);
  const canShowEditAction = canEditMatchInfo
    && !isCancelledMatch
    && !hasChallengeResultLoaded;

  const teamMemberByPlayerByTeamId = useMemo(() => {
    const byTeamId = {};

    Object.entries(teamMembersByTeamId || {}).forEach(([teamId, members]) => {
      const byPlayerId = {};
      (members || []).forEach((member) => {
        const playerId = String(member?.jugador_id || member?.jugador?.id || '').trim();
        if (!playerId) return;
        if (!byPlayerId[playerId]) byPlayerId[playerId] = member;
      });
      byTeamId[teamId] = byPlayerId;
    });

    return byTeamId;
  }, [teamMembersByTeamId]);

  const challengeSquadStatus = useMemo(() => {
    if (!isChallengeMatch) return 'not_open';
    const statusFromChallenge = challengeSquadMeta?.squad_status || match?.challenge?.squad_status || null;
    if (statusFromChallenge) return String(statusFromChallenge).trim().toLowerCase();

    const challengeStatus = String(challengeSquadMeta?.status || match?.challenge?.status || '').trim().toLowerCase();
    if (challengeStatus === 'accepted' || challengeStatus === 'confirmed') return 'open';
    if (challengeStatus === 'completed' || challengeStatus === 'canceled') return 'finalized';
    return 'not_open';
  }, [
    challengeSquadMeta?.squad_status,
    challengeSquadMeta?.status,
    isChallengeMatch,
    match?.challenge?.squad_status,
    match?.challenge?.status,
  ]);

  const challengeSquadLimits = useMemo(() => {
    const defaults = resolveChallengeSquadLimits(
      challengeSquadMeta?.match_format || match?.format || match?.challenge?.match_format || 5,
    );
    return {
      starters: Number(challengeSquadMeta?.max_starters_per_team || match?.challenge?.max_starters_per_team || defaults.starters) || defaults.starters,
      substitutes: Number(challengeSquadMeta?.max_substitutes_per_team || match?.challenge?.max_substitutes_per_team || defaults.substitutes) || defaults.substitutes,
      selected: Number(challengeSquadMeta?.max_selected_per_team || match?.challenge?.max_selected_per_team || defaults.selected) || defaults.selected,
    };
  }, [
    challengeSquadMeta?.match_format,
    challengeSquadMeta?.max_starters_per_team,
    challengeSquadMeta?.max_substitutes_per_team,
    challengeSquadMeta?.max_selected_per_team,
    match?.challenge?.match_format,
    match?.challenge?.max_starters_per_team,
    match?.challenge?.max_substitutes_per_team,
    match?.challenge?.max_selected_per_team,
    match?.format,
  ]);

  const challengeSquadCountersByTeamId = useMemo(() => {
    const counters = {};
    Object.entries(challengeSquadByTeamId || {}).forEach(([teamId, rows]) => {
      const starters = (rows || []).filter((row) => row?.approved_by_captain && row?.selection_status === 'starter').length;
      const substitutes = (rows || []).filter((row) => row?.approved_by_captain && row?.selection_status === 'substitute').length;
      counters[teamId] = {
        starters,
        substitutes,
        selected: starters + substitutes,
      };
    });
    return counters;
  }, [challengeSquadByTeamId]);

  const challengeSquadDisplayByTeamId = useMemo(() => {
    const byTeamId = {};

    Object.entries(challengeSquadByTeamId || {}).forEach(([teamId, rows]) => {
      byTeamId[teamId] = (rows || []).map((row) => {
        const playerId = String(row?.player_id || '').trim();
        const memberMeta = playerId ? teamMemberByPlayerByTeamId?.[teamId]?.[playerId] : null;
        const jugador = row?.jugador || {};
        return {
          id: `squad-${row?.id || `${teamId}-${playerId}`}`,
          team_id: row?.team_id || teamId,
          jugador_id: row?.player_id || null,
          user_id: memberMeta?.user_id || jugador?.usuario_id || null,
          permissions_role: memberMeta?.permissions_role || 'member',
          role: memberMeta?.role || 'player',
          is_captain: Boolean(memberMeta?.is_captain),
          shirt_number: memberMeta?.shirt_number ?? null,
          photo_url: memberMeta?.photo_url || null,
          availability_status: row?.availability_status || 'pending',
          selection_status: row?.selection_status || 'not_selected',
          approved_by_captain: Boolean(row?.approved_by_captain),
          jugador: {
            id: row?.player_id || null,
            usuario_id: jugador?.usuario_id || null,
            nombre: jugador?.nombre || memberMeta?.jugador?.nombre || 'Jugador',
            avatar_url: memberMeta?.photo_url || jugador?.avatar_url || memberMeta?.jugador?.avatar_url || null,
            score: jugador?.score ?? memberMeta?.jugador?.score ?? null,
            uuid: jugador?.uuid || null,
          },
          squad_row_id: row?.id || null,
        };
      });
    });

    return byTeamId;
  }, [challengeSquadByTeamId, teamMemberByPlayerByTeamId]);

  const viewerChallengeTeam = useMemo(() => getViewerChallengeTeam({
    match,
    userId: user?.id || null,
    teamMembersByTeamId,
    challengeSquadDisplayByTeamId,
  }), [challengeSquadDisplayByTeamId, match, teamMembersByTeamId, user?.id]);

  const isAmbiguousChallengeViewer = Boolean(viewerChallengeTeam?.isAmbiguous);
  const ambiguousFallbackTeamId = useMemo(() => {
    if (!isAmbiguousChallengeViewer) return null;
    const acceptedTeamId = String(match?.challenge?.accepted_team_id || '').trim();
    const teamAId = String(match?.team_a_id || '').trim();
    const teamBId = String(match?.team_b_id || '').trim();
    if (acceptedTeamId && (acceptedTeamId === teamAId || acceptedTeamId === teamBId)) return acceptedTeamId;
    return teamAId || teamBId || null;
  }, [
    isAmbiguousChallengeViewer,
    match?.challenge?.accepted_team_id,
    match?.team_a_id,
    match?.team_b_id,
  ]);

  const ambiguousFallbackTeam = useMemo(() => {
    if (!ambiguousFallbackTeamId) return null;
    if (String(match?.team_a_id || '') === ambiguousFallbackTeamId) return match?.team_a || null;
    if (String(match?.team_b_id || '') === ambiguousFallbackTeamId) return match?.team_b || null;
    return null;
  }, [
    ambiguousFallbackTeamId,
    match?.team_a,
    match?.team_a_id,
    match?.team_b,
    match?.team_b_id,
  ]);

  const myChallengeTeamId = useMemo(
    () => {
      const directTeamId = String(viewerChallengeTeam?.myTeamId || '').trim();
      if (directTeamId) return directTeamId;
      if (isAmbiguousChallengeViewer && ambiguousTeamDecision === 'accepted') {
        return String(ambiguousFallbackTeamId || '').trim() || null;
      }
      return null;
    },
    [
      ambiguousFallbackTeamId,
      ambiguousTeamDecision,
      isAmbiguousChallengeViewer,
      viewerChallengeTeam?.myTeamId,
    ],
  );

  const currentUserTeamId = useMemo(() => (
    myChallengeTeamId
    || (match?.team_a_id ? String(match.team_a_id) : null)
  ), [match?.team_a_id, myChallengeTeamId]);

  const myChallengeTeam = useMemo(() => {
    if (!myChallengeTeamId) return null;
    if (String(match?.team_a_id || '') === myChallengeTeamId) return match?.team_a || null;
    if (String(match?.team_b_id || '') === myChallengeTeamId) return match?.team_b || null;
    if (String(ambiguousFallbackTeamId || '') === myChallengeTeamId) return ambiguousFallbackTeam;
    return viewerChallengeTeam?.myTeam || null;
  }, [
    ambiguousFallbackTeam,
    ambiguousFallbackTeamId,
    match?.team_a,
    match?.team_a_id,
    match?.team_b,
    match?.team_b_id,
    myChallengeTeamId,
    viewerChallengeTeam?.myTeam,
  ]);
  const ambiguousFallbackTeamName = useMemo(
    () => String(ambiguousFallbackTeam?.name || 'tu equipo').trim() || 'tu equipo',
    [ambiguousFallbackTeam?.name],
  );

  const teamCardsMembersByTeamId = useMemo(() => {
    if (!isChallengeMatch) return teamMembersByTeamId;

    const base = { ...teamMembersByTeamId };
    const teamAId = String(match?.team_a_id || '').trim();
    const teamBId = String(match?.team_b_id || '').trim();
    const challengeTeamIds = [teamAId, teamBId].filter(Boolean);

    challengeTeamIds.forEach((teamId) => {
      const approvedRows = (challengeSquadDisplayByTeamId?.[teamId] || []).filter((row) => (
        row?.approved_by_captain
        && ['starter', 'substitute'].includes(String(row?.selection_status || '').toLowerCase())
      ));
      if (approvedRows.length > 0) {
        base[teamId] = approvedRows;
      }
    });

    // Defensive view-level dedupe for corrupted historical data:
    // a user should never appear selected for both teams in the same challenge.
    if (teamAId && teamBId) {
      const seenUsers = new Set();
      const normalizeRowUser = (row) => normalizeIdentityToken(
        row?.user_id
        || row?.jugador?.usuario_id
        || null,
      );
      const rowsA = (base[teamAId] || []).filter((row) => {
        const userToken = normalizeRowUser(row);
        if (!userToken) return true;
        if (seenUsers.has(userToken)) return false;
        seenUsers.add(userToken);
        return true;
      });
      const rowsB = (base[teamBId] || []).filter((row) => {
        const userToken = normalizeRowUser(row);
        if (!userToken) return true;
        if (seenUsers.has(userToken)) return false;
        seenUsers.add(userToken);
        return true;
      });
      base[teamAId] = rowsA;
      base[teamBId] = rowsB;
    }

    return base;
  }, [challengeSquadDisplayByTeamId, isChallengeMatch, match?.team_a_id, match?.team_b_id, teamMembersByTeamId]);

  const canManageTeamSquad = useCallback((teamId) => {
    const teamIdToken = String(teamId || '').trim();
    const userIdToken = String(user?.id || '').trim();
    if (!teamIdToken || !userIdToken) return false;

    const team = String(match?.team_a_id || '') === teamIdToken
      ? match?.team_a
      : (String(match?.team_b_id || '') === teamIdToken ? match?.team_b : null);

    if (String(team?.owner_user_id || '').trim() === userIdToken) return true;

    const members = teamMembersByTeamId?.[teamIdToken] || [];
    const currentMember = members.find((member) => String(member?.user_id || member?.jugador?.usuario_id || '').trim() === userIdToken) || null;
    if (!currentMember) return false;
    if (Boolean(currentMember?.is_captain)) return true;

    const permissionsRole = String(currentMember?.permissions_role || '').trim().toLowerCase();
    return permissionsRole === 'admin' || permissionsRole === 'owner';
  }, [
    match?.team_a,
    match?.team_a_id,
    match?.team_b,
    match?.team_b_id,
    teamMembersByTeamId,
    user?.id,
  ]);

  const challengeSquadEditable = useMemo(() => (
    challengeSquadStatus === 'open'
    && !isPastScheduledTeamMatch
    && match?.status !== 'played'
    && match?.status !== 'cancelled'
  ), [challengeSquadStatus, isPastScheduledTeamMatch, match?.status]);

  const currentUserSquadRowByTeamId = useMemo(() => {
    const byTeamId = {};
    const userToken = normalizeIdentityToken(user?.id);
    if (!userToken) return byTeamId;

    Object.entries(challengeSquadDisplayByTeamId || {}).forEach(([teamId, rows]) => {
      const row = (rows || []).find((entry) => (
        normalizeIdentityToken(entry?.user_id || entry?.jugador?.usuario_id) === userToken
      ));
      if (row) byTeamId[teamId] = row;
    });
    return byTeamId;
  }, [challengeSquadDisplayByTeamId, user?.id]);

  const currentUserSquadRow = useMemo(
    () => (myChallengeTeamId ? (currentUserSquadRowByTeamId?.[myChallengeTeamId] || null) : null),
    [currentUserSquadRowByTeamId, myChallengeTeamId],
  );

  const myChallengeSquadRows = useMemo(
    () => (myChallengeTeamId ? (challengeSquadDisplayByTeamId?.[myChallengeTeamId] || []) : []),
    [challengeSquadDisplayByTeamId, myChallengeTeamId],
  );

  const myChallengeSquadCounters = useMemo(
    () => (myChallengeTeamId ? (challengeSquadCountersByTeamId?.[myChallengeTeamId] || { starters: 0, substitutes: 0, selected: 0 }) : { starters: 0, substitutes: 0, selected: 0 }),
    [challengeSquadCountersByTeamId, myChallengeTeamId],
  );

  const canManageMyChallengeSquad = useMemo(
    () => (myChallengeTeamId ? canManageTeamSquad(myChallengeTeamId) : false),
    [canManageTeamSquad, myChallengeTeamId],
  );

  const availabilityStatusCurrent = String(currentUserSquadRow?.availability_status || '').trim().toLowerCase();
  const hasAvailabilityResponse = availabilityStatusCurrent === 'available' || availabilityStatusCurrent === 'unavailable';

  const challengeSquadViewState = useMemo(() => resolveChallengeSquadViewState({
    isChallengeMatch,
    viewerChallengeTeam,
    myChallengeTeamId,
    canManageMyChallengeSquad,
  }), [
    canManageMyChallengeSquad,
    isChallengeMatch,
    myChallengeTeamId,
    viewerChallengeTeam,
  ]);

  const canRenderAmbiguousTeamAfterConfirm = Boolean(
    isChallengeMatch
    && isAmbiguousChallengeViewer
    && ambiguousTeamDecision === 'accepted'
    && myChallengeTeamId,
  );
  const shouldRenderAmbiguousChallengeEntry = Boolean(
    isChallengeMatch
    && isAmbiguousChallengeViewer
    && ambiguousTeamDecision !== 'accepted',
  );
  const canRenderPrivateChallengeSquad = Boolean(
    canRenderAmbiguousTeamAfterConfirm || challengeSquadViewState?.showOperationalModule,
  );
  const showMySquadManagement = Boolean(canRenderPrivateChallengeSquad && canManageMyChallengeSquad);
  const shouldRenderInlineNotice = Boolean(
    inlineNotice?.message
    && String(inlineNotice?.type || '').trim().toLowerCase() !== 'success',
  );
  const personalChallengeCurrentStateLabel = useMemo(
    () => getPersonalChallengeCurrentStateLabel(currentUserSquadRow),
    [currentUserSquadRow],
  );

  useEffect(() => {
    setAmbiguousTeamDecision(null);
    setAmbiguousTeamModalOpen(false);
  }, [match?.challenge_id, user?.id]);

  useEffect(() => {
    setIsSquadRosterViewOpen(false);
  }, [match?.challenge_id, myChallengeTeamId]);

  const showChallengeInlineNotice = useCallback((type, message) => {
    if (!message) return;
    setInlineNotice({ type, message });
  }, []);

  const handleChangeAvailability = useCallback(async (availabilityStatus) => {
    if (!match?.challenge_id || !canRenderPrivateChallengeSquad) return;
    if (!currentUserSquadRow?.jugador_id) {
      showChallengeInlineNotice('warning', 'No encontramos tu jugador dentro de este desafío.');
      return;
    }
    if (!challengeSquadEditable) {
      showChallengeInlineNotice('warning', 'La convocatoria está cerrada y no admite cambios.');
      return;
    }

    const normalizedAvailability = String(availabilityStatus || '').trim().toLowerCase();
    if (String(currentUserSquadRow?.availability_status || '').trim().toLowerCase() === normalizedAvailability) {
      return;
    }

    try {
      setChallengeSquadSaving(true);
      await setChallengeAvailability({
        challengeId: match.challenge_id,
        availabilityStatus: normalizedAvailability,
        teamId: myChallengeTeamId,
        playerId: currentUserSquadRow?.jugador_id || null,
      });
      await loadChallengeSquadForMatch(match);
      showChallengeInlineNotice(
        'success',
        normalizedAvailability === 'available'
          ? 'Listo, quedaste como disponible.'
          : 'Listo, quedaste como no disponible.',
      );
    } catch (error) {
      showChallengeInlineNotice('warning', error?.message || 'No se pudo actualizar tu disponibilidad.');
    } finally {
      setChallengeSquadSaving(false);
    }
  }, [
    canRenderPrivateChallengeSquad,
    challengeSquadEditable,
    currentUserSquadRow?.availability_status,
    currentUserSquadRow?.jugador_id,
    loadChallengeSquadForMatch,
    match,
    myChallengeTeamId,
    showChallengeInlineNotice,
  ]);

  const handleChangeSelection = useCallback(async ({
    teamId,
    playerId,
    selectionStatus,
    row,
  }) => {
    if (!match?.challenge_id || !teamId || !playerId || !canRenderPrivateChallengeSquad) return;
    if (!canManageMyChallengeSquad) {
      showChallengeInlineNotice('warning', 'Solo el capitán puede armar el plantel.');
      return;
    }
    if (String(teamId) !== String(myChallengeTeamId)) {
      showChallengeInlineNotice('warning', 'Solo podés gestionar el plantel de tu equipo.');
      return;
    }
    if (!challengeSquadEditable) {
      showChallengeInlineNotice('warning', 'La convocatoria está cerrada y no admite cambios.');
      return;
    }

    const normalizedSelection = String(selectionStatus || '').trim().toLowerCase();
    if (!['starter', 'substitute', 'not_selected'].includes(normalizedSelection)) {
      showChallengeInlineNotice('warning', 'Acción inválida para la convocatoria.');
      return;
    }

    const targetRow = row || (myChallengeSquadRows || []).find(
      (entry) => String(entry?.jugador_id || '') === String(playerId),
    );
    if (!targetRow?.jugador_id) {
      showChallengeInlineNotice('warning', 'No pudimos encontrar ese jugador en tu convocatoria.');
      return;
    }

    const currentSelection = String(targetRow?.selection_status || '').trim().toLowerCase();
    const currentApproved = Boolean(targetRow?.approved_by_captain);
    const currentAvailability = String(targetRow?.availability_status || '').trim().toLowerCase();
    const currentIsSelected = currentApproved && (currentSelection === 'starter' || currentSelection === 'substitute');

    if (normalizedSelection === currentSelection && (normalizedSelection === 'not_selected' || currentApproved)) {
      return;
    }

    if ((normalizedSelection === 'starter' || normalizedSelection === 'substitute') && currentAvailability !== 'available') {
      showChallengeInlineNotice('warning', 'Primero debe marcarse como disponible.');
      return;
    }

    const targetUserToken = normalizeIdentityToken(
      targetRow?.user_id
      || targetRow?.jugador?.usuario_id
      || null,
    );
    if (targetUserToken && (normalizedSelection === 'starter' || normalizedSelection === 'substitute')) {
      const hasUserSelectedOnRival = Object.entries(challengeSquadDisplayByTeamId || {}).some(([otherTeamId, rows]) => {
        if (String(otherTeamId || '') === String(teamId || '')) return false;
        return (rows || []).some((entry) => (
          normalizeIdentityToken(entry?.user_id || entry?.jugador?.usuario_id) === targetUserToken
          && Boolean(entry?.approved_by_captain)
          && ['starter', 'substitute'].includes(String(entry?.selection_status || '').trim().toLowerCase())
        ));
      });
      if (hasUserSelectedOnRival) {
        showChallengeInlineNotice('warning', 'Ese usuario ya fue convocado por el otro equipo en este desafío.');
        return;
      }
    }

    const nextStarters = myChallengeSquadCounters?.starters || 0;
    const nextSubstitutes = myChallengeSquadCounters?.substitutes || 0;
    const nextSelected = myChallengeSquadCounters?.selected || 0;

    if (normalizedSelection === 'starter' && currentSelection !== 'starter' && nextStarters >= challengeSquadLimits.starters) {
      showChallengeInlineNotice('warning', `Ya alcanzaste el máximo de titulares (${challengeSquadLimits.starters}).`);
      return;
    }

    if (normalizedSelection === 'substitute' && currentSelection !== 'substitute' && nextSubstitutes >= challengeSquadLimits.substitutes) {
      showChallengeInlineNotice('warning', `Ya alcanzaste el máximo de suplentes (${challengeSquadLimits.substitutes}).`);
      return;
    }

    if (
      (normalizedSelection === 'starter' || normalizedSelection === 'substitute')
      && !currentIsSelected
      && nextSelected >= challengeSquadLimits.selected
    ) {
      showChallengeInlineNotice('warning', `Ya alcanzaste el máximo de convocados (${challengeSquadLimits.selected}).`);
      return;
    }

    try {
      setChallengeSquadSaving(true);
      await upsertChallengeTeamSelection({
        challengeId: match.challenge_id,
        teamId,
        playerId,
        selectionStatus: normalizedSelection,
        approvedByCaptain: normalizedSelection !== 'not_selected',
      });
      await loadChallengeSquadForMatch(match);
      showChallengeInlineNotice('success', 'Plantel actualizado.');
    } catch (error) {
      showChallengeInlineNotice('warning', error?.message || 'No se pudo actualizar la convocatoria.');
    } finally {
      setChallengeSquadSaving(false);
    }
  }, [
    canManageMyChallengeSquad,
    canRenderPrivateChallengeSquad,
    challengeSquadDisplayByTeamId,
    challengeSquadEditable,
    challengeSquadLimits.selected,
    challengeSquadLimits.starters,
    challengeSquadLimits.substitutes,
    loadChallengeSquadForMatch,
    match,
    myChallengeSquadCounters?.selected,
    myChallengeSquadCounters?.starters,
    myChallengeSquadCounters?.substitutes,
    myChallengeSquadRows,
    myChallengeTeamId,
    showChallengeInlineNotice,
  ]);

  const handleSetChallengeSquadStatus = useCallback(async (nextStatus) => {
    if (!match?.challenge_id || !canRenderPrivateChallengeSquad) return false;
    if (!canManageMyChallengeSquad) {
      showChallengeInlineNotice('warning', 'Solo el capitán puede cambiar el estado del plantel.');
      return false;
    }
    const normalizedNextStatus = String(nextStatus || '').trim().toLowerCase();
    if (!['open', 'closed'].includes(normalizedNextStatus)) {
      showChallengeInlineNotice('warning', 'Estado de convocatoria inválido.');
      return false;
    }
    if (normalizedNextStatus === challengeSquadStatus) return true;

    try {
      setChallengeSquadSaving(true);
      const updatedChallenge = await setChallengeSquadStatus({
        challengeId: match.challenge_id,
        squadStatus: normalizedNextStatus,
      });
      setChallengeSquadMeta(updatedChallenge || null);
      await loadChallengeSquadForMatch(match);
      showChallengeInlineNotice(
        'success',
        normalizedNextStatus === 'closed'
          ? 'Plantel cerrado para este desafío.'
          : 'Convocatoria reabierta.',
      );
      return true;
    } catch (error) {
      showChallengeInlineNotice('warning', error?.message || 'No se pudo actualizar el estado de la convocatoria.');
      return false;
    } finally {
      setChallengeSquadSaving(false);
    }
  }, [
    canManageMyChallengeSquad,
    canRenderPrivateChallengeSquad,
    challengeSquadStatus,
    loadChallengeSquadForMatch,
    match,
    showChallengeInlineNotice,
  ]);

  const handleConfirmSquadAndBack = useCallback(async () => {
    const success = await handleSetChallengeSquadStatus('closed');
    if (success) {
      setIsSquadRosterViewOpen(false);
    }
  }, [handleSetChallengeSquadStatus]);

  const challengeHeadToHeadView = useMemo(() => {
    if (!match) return null;

    const view = buildChallengeHeadToHeadView({
      stats: challengeHeadToHead || EMPTY_CHALLENGE_HEAD_TO_HEAD,
      teamAId: match?.team_a_id,
      teamBId: match?.team_b_id,
      currentUserTeamId,
      teamAName: match?.team_a?.name,
      teamBName: match?.team_b?.name,
    });

    return {
      ...view,
      lastResultDateText: formatHeadToHeadDate(view.lastResultAt),
    };
  }, [challengeHeadToHead, currentUserTeamId, match]);

  const challengeStatusValue = useMemo(
    () => String(match?.challenge?.status || '').trim().toLowerCase(),
    [match?.challenge?.status],
  );

  // team_a is always the challenger team, team_b the accepted (rival) team.
  const perspectiveIsChallenger = useMemo(() => {
    const teamAId = String(match?.team_a_id || '').trim();
    return Boolean(currentUserTeamId) && String(currentUserTeamId).trim() === teamAId;
  }, [currentUserTeamId, match?.team_a_id]);

  const canReportChallengeResult = Boolean(
    isChallengeMatch
    && hasChallengeAcceptedRival
    && canManageMyChallengeSquad
    && myChallengeTeamId
    && !isAmbiguousChallengeViewer
    && canTeamReportChallengeResult(match, myChallengeTeamId)
    && isChallengeResultActionState({
      challengeStatus: challengeStatusValue,
      matchStatus: match?.status,
      scheduledAt: match?.scheduled_at,
    }),
  );

  const resultConflict = isChallengeResultConflict(match);
  const resultConfirmed = isChallengeResultConfirmed(match);
  const hasLoadedResultStatus = isChallengeResultLoaded(match?.result_status);
  const resultAlreadyLoaded = resultConfirmed || (hasLoadedResultStatus && !canReportChallengeResult);

  // Conflicts are resolved ONLY by the challenge creator.
  const canResolveResult = isChallengeMatch
    && canResolveChallengeResult(match, {
      userId: user?.id,
      challengeCreatorUserId: challengeCreatorUserId,
    });

  const resultInitialOutcome = useMemo(() => {
    if (!match?.result_status || resultConflict) return null;
    return resultStatusToOutcome(match.result_status, { perspectiveIsChallenger });
  }, [match?.result_status, perspectiveIsChallenger, resultConflict]);

  const resultOutcomeLabel = useMemo(() => (
    getChallengeResultOutcomeLabel(match?.result_status, { perspectiveIsChallenger })
  ), [match?.result_status, perspectiveIsChallenger]);

  const challengeResultRivalName = useMemo(() => {
    if (perspectiveIsChallenger) return match?.team_b?.name || 'el rival';
    return match?.team_a?.name || 'el rival';
  }, [match?.team_a?.name, match?.team_b?.name, perspectiveIsChallenger]);

  const showChallengeResultCard = Boolean(
    isChallengeMatch
    && hasChallengeAcceptedRival
    && (
      (myChallengeTeamId && (canReportChallengeResult || resultAlreadyLoaded || resultConflict))
      || canResolveResult
    ),
  );

  const resultModalChallenge = useMemo(() => {
    if (!match?.challenge_id) return null;
    return {
      id: match.challenge_id,
      challenger_team: match?.team_a || null,
      accepted_team: match?.team_b || null,
    };
  }, [match?.challenge_id, match?.team_a, match?.team_b]);

  const handleSubmitChallengeResult = useCallback(async ({ challengeId, resultStatus }) => {
    if (!challengeId || !resultStatus) return;
    try {
      setResultModalSubmitting(true);
      await reportChallengeResult({ challengeId, resultStatus });
      setResultModalOpen(false);
      await refreshMatchView({ withLoading: false, silent: false });
      setHeadToHeadReloadKey((value) => value + 1);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo guardar la respuesta del desafío');
    } finally {
      setResultModalSubmitting(false);
    }
  }, [refreshMatchView]);

  const handleResolveChallengeResult = useCallback(async ({ challengeId, resultStatus }) => {
    if (!challengeId || !resultStatus) return;
    try {
      setResolveModalSubmitting(true);
      await resolveChallengeResult({ challengeId, resultStatus });
      setResolveModalOpen(false);
      await refreshMatchView({ withLoading: false, silent: false });
      setHeadToHeadReloadKey((value) => value + 1);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo resolver el resultado del desafío');
    } finally {
      setResolveModalSubmitting(false);
    }
  }, [refreshMatchView]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    if (params.get('action') !== 'open_challenge_result_modal') return;
    if (!canReportChallengeResult || resultAlreadyLoaded || !resultModalChallenge) return;
    setResultModalOpen(true);
  }, [
    canReportChallengeResult,
    location.search,
    resultAlreadyLoaded,
    resultModalChallenge,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    if (params.get('action') !== 'open_challenge_resolve_modal') return;
    if (!canResolveResult || !resultModalChallenge) return;
    setResolveModalOpen(true);
  }, [
    canResolveResult,
    location.search,
    resultModalChallenge,
  ]);

  const getSafeMenuPosition = useCallback((rect) => {
    const menuWidth = 192; // w-48
    const menuHeight = 56;
    const margin = 8;
    const rawLeft = rect.right - menuWidth;
    const safeLeft = Math.min(
      Math.max(margin, rawLeft),
      Math.max(margin, window.innerWidth - menuWidth - margin),
    );
    const rawTop = rect.bottom + 8;
    const safeTop = Math.min(
      rawTop,
      Math.max(margin, window.innerHeight - menuHeight - margin),
    );
    return { top: safeTop, left: safeLeft };
  }, []);

  useEffect(() => {
    if (!actionsMenuOpen) return undefined;
    const handleResize = () => {
      if (!actionsMenuButtonRef.current) return;
      const rect = actionsMenuButtonRef.current.getBoundingClientRect();
      setActionsMenuPosition(getSafeMenuPosition(rect));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [actionsMenuOpen, getSafeMenuPosition]);

  const headerInfoPartido = useMemo(() => {
    const { fecha, hora } = formatLocalDateAndTime(match?.scheduled_at);
    return normalizePartidoForHeader({
      fecha: fecha || 'A definir',
      hora: hora || 'A definir',
      modalidad: match?.format ? `F${match.format}` : 'A definir',
      tipo_partido: match?.mode || 'A definir',
      // Dejar null cuando no hay sede para que MatchInfoSection aplique el mismo
      // fallback ("A definir") que el partido común/amistoso, en lugar de recortar
      // "A definir" a su primera palabra ("A").
      sede: match?.location || match?.location_name || null,
      precio: match?.cancha_cost == null ? 'A definir' : match.cancha_cost,
      valor_cancha: match?.cancha_cost == null ? 'A definir' : match.cancha_cost,
    });
  }, [match?.cancha_cost, match?.format, match?.location, match?.location_name, match?.mode, match?.scheduled_at]);

  const rosterTeam = useMemo(() => {
    if (!rosterTeamId || !match) return null;
    if (match?.team_a_id === rosterTeamId) return match?.team_a || null;
    if (match?.team_b_id === rosterTeamId) return match?.team_b || null;
    return null;
  }, [match, rosterTeamId]);

  const rosterMembers = useMemo(
    () => (rosterTeamId ? (teamMembersByTeamId[rosterTeamId] || []) : []),
    [teamMembersByTeamId, rosterTeamId],
  );

  const handleSave = async (event) => {
    event.preventDefault();
    if (!match?.id) return;
    if (!canEditMatchInfo) {
      notifyBlockingError('No autorizado');
      return;
    }
    if (isCancelledMatch || hasChallengeResultLoaded) {
      notifyBlockingError('No se puede editar un partido con resultado cargado');
      return;
    }

    const parsedCanchaCost = canchaCostInput.trim() === '' ? null : Number(canchaCostInput);
    if (parsedCanchaCost != null && (!Number.isFinite(parsedCanchaCost) || parsedCanchaCost < 0)) {
      notifyBlockingError('El costo de cancha debe ser un numero valido');
      return;
    }

    const parsedFormat = Number(formatInput);
    if (!Number.isFinite(parsedFormat) || !TEAM_FORMAT_OPTIONS.includes(parsedFormat)) {
      notifyBlockingError('Selecciona un formato valido (F5, F6, F7, F8, F9 o F11)');
      return;
    }

    try {
      setSaving(true);
      const updated = await updateTeamMatchDetails({
        matchId: match.id,
        scheduledAt: scheduledAtInput ? new Date(scheduledAtInput).toISOString() : null,
        location: locationInput.trim() || null,
        canchaCost: parsedCanchaCost,
        mode: generoInput.trim() || null,
        format: parsedFormat,
      });

      let nextMatch = updated;
      try {
        const hydrated = await getTeamMatchById(updated?.id || match.id);
        if (hydrated?.id) {
          nextMatch = hydrated;
        }
      } catch {
        // Keep updated payload when hydration fails.
      }

      setMatch(nextMatch);
      syncFormWithMatch(nextMatch);
      await loadMembersForMatch(nextMatch);
      await loadChallengeSquadForMatch(nextMatch);
      setEditModalOpen(false);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo actualizar el partido');
    } finally {
      setSaving(false);
    }
  };

  // El kebab de edición vive en la barra fija superior (junto al chat), no como
  // primer hijo del contenido: en dispositivos con notch/safe-area ese primer
  // hijo queda detras del header fijo (PageTransition crea el contenedor del
  // `fixed`), por eso antes "no se veía" aunque los tests pasaran (safe-top=0).
  const headerEditAction = canShowEditAction ? (
    <>
      <button
        ref={actionsMenuButtonRef}
        type="button"
        aria-label="Mas acciones"
        title="Mas acciones"
        className="kebab-menu-btn"
        onClick={() => {
          if (actionsMenuButtonRef.current) {
            const rect = actionsMenuButtonRef.current.getBoundingClientRect();
            setActionsMenuPosition(getSafeMenuPosition(rect));
          }
          setActionsMenuOpen((prev) => !prev);
        }}
      >
        <MoreVertical size={15} />
      </button>
      {actionsMenuOpen && ReactDOM.createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998] bg-transparent"
            onClick={() => setActionsMenuOpen(false)}
          />
          <div
            className="fixed z-[9999] w-48 rounded-none border border-slate-700 bg-slate-900 shadow-lg"
            style={{
              top: `${actionsMenuPosition.top}px`,
              left: `${actionsMenuPosition.left}px`,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="py-1">
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800"
                onClick={() => {
                  setActionsMenuOpen(false);
                  setEditModalOpen(true);
                }}
              >
                Editar partido
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  ) : null;

  return (
    <PageTransition>
      <PageTitle
        title="Detalle partido"
        onBack={() => goBackSmart({
          onBeforeBack: () => {
            if (!isChatOpen) return false;
            setIsChatOpen(false);
            return true;
          },
        })}
        showChatButton
        onChatClick={() => setIsChatOpen(true)}
        unreadCount={chatUnreadCount}
        rightActions={headerEditAction}
      >
        Detalle partido
      </PageTitle>

      {/* El header fijo mide 72px (44px de contenido + 14px de padding vertical) y no
          se desplaza con --safe-top, mientras que MainLayout sí lo suma al contenido:
          el padding se calcula para que el contenido quede debajo del header fijo.
          Se deja ~16px de aire extra (88px en vez de 72px) para que los iconos del
          Match Info Header no queden pegados/cortados contra la barra fija; con sólo
          4px de margen cualquier variación de safe-area o de alto del header los
          recortaba en iPhone y Android.
          El Match Info Header (MatchInfoSection) ya no va aquí arriba: se renderiza
          dentro del bloque del partido, debajo de los chips y pegado arriba de la
          card VS, igual que en el partido común/amistoso. */}
      <div className="w-full pb-8 pt-[max(20px,calc(88px-var(--safe-top,0px)))]">
        <div className="mx-auto w-full max-w-[560px] space-y-3 px-4">
          {/* Cuando loading/no-match son el único contenido, son el primer hijo del
              bloque. El header fijo (PageTitle) queda contenido por el transform de
              PageTransition (translate-x-0), así que se posiciona a partir de
              --safe-top y su borde inferior cae en safe-top+72px. El padding del
              bloque resta --safe-top, por lo que ese primer hijo quedaba tapado por
              el header. Se compensa con mt=--safe-top para que estas cajas
              transitorias se vean completas (el layout cargado no se toca). */}
          {loading ? (
            <div className="mt-[var(--safe-top,0px)] rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
              Cargando partido...
            </div>
          ) : null}

          {!loading && !match ? (
            <div className="mt-[var(--safe-top,0px)] rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
              No encontramos este partido o no tenes acceso.
            </div>
          ) : null}

          {!loading && match && !isCancelledMatch && !isUnavailablePastChallengeMatch ? (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[10px] leading-none font-oswald uppercase tracking-[0.08em] ${getOriginBadgeClass(match?.origin_type)}`}>
                      <Flag size={10} /> {match?.origin_type === 'challenge' ? 'Desafio' : 'Amistoso'}
                    </span>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-[3px] text-[10px] leading-none font-oswald uppercase tracking-[0.08em] ${getStatusBadgeClass(match?.status)}`}>
                      {statusLabelByValue[match?.status] || match?.status || 'Pendiente'}
                    </span>
                  </div>
                  {/* El kebab de edición se renderiza en la barra fija superior
                      (PageTitle rightActions), no aquí: ver headerEditAction. */}
                </div>

                {/* Match Info Header: mismo componente que el partido común/amistoso,
                    debajo de los chips y pegado arriba de la card VS. */}
                <MatchInfoSection
                  partido={headerInfoPartido}
                  topOffsetClassName="mt-0"
                />

                <MatchupHeroCard
                  teamA={match?.team_a}
                  teamB={match?.team_b}
                  membersA={teamCardsMembersByTeamId[match?.team_a_id] || []}
                  membersB={teamCardsMembersByTeamId[match?.team_b_id] || []}
                  onOpenProfile={setSelectedPlayerProfile}
                  onOpenRosterA={() => setRosterTeamId(match?.team_a_id)}
                  onOpenRosterB={() => setRosterTeamId(match?.team_b_id)}
                  className="mx-auto w-full max-w-[520px]"
                />

                {isChallengeMatch && shouldRenderAmbiguousChallengeEntry ? (
                  <div className={`${DETAIL_CARD_RADIUS_CLASS} border border-[rgba(148,134,255,0.18)] bg-[rgba(124,98,255,0.05)] p-2.5 space-y-3`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-white font-oswald text-[15px] truncate">
                          Convocatoria · {ambiguousFallbackTeamName}
                        </span>
                        <span className="mt-1 block text-[11px] text-white/60 font-oswald">
                          Desafío compartido · gestionás solo tu equipo
                        </span>
                      </div>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-[3px] text-[10px] leading-none font-oswald uppercase tracking-[0.08em] shrink-0 ${getSquadStatusBadgeClass(challengeSquadStatus)}`}>
                        {SQUAD_STATUS_LABEL_BY_VALUE[challengeSquadStatus] || 'No abierta'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAmbiguousTeamModalOpen(true)}
                      className={`w-full ${squadActionPrimaryClass}`}
                    >
                      Gestionar convocatoria
                    </button>
                  </div>
                ) : null}

                {isChallengeMatch && canRenderPrivateChallengeSquad ? (
                  <div className={`${DETAIL_CARD_RADIUS_CLASS} border border-[rgba(148,134,255,0.18)] bg-[rgba(124,98,255,0.05)] p-2.5 space-y-3`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-oswald text-[15px] truncate">
                            Convocatoria · {myChallengeTeam?.name || 'Mi equipo'}
                          </span>
                        </div>
                        <span className="mt-1 block text-[11px] text-white/60 font-oswald">
                          Desafío compartido · gestionás solo tu equipo
                        </span>
                      </div>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-[3px] text-[10px] leading-none font-oswald uppercase tracking-[0.08em] shrink-0 ${getSquadStatusBadgeClass(challengeSquadStatus)}`}>
                        {SQUAD_STATUS_LABEL_BY_VALUE[challengeSquadStatus] || 'No abierta'}
                      </span>
                    </div>

                    {shouldRenderInlineNotice ? (
                      <p className="text-[12px] font-oswald text-[#D4EBFF]/85">
                        {inlineNotice.message}
                      </p>
                    ) : null}

                    {challengeSquadLoading ? (
                      <p className="text-sm text-white/65 font-oswald">Cargando convocatoria...</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-[12px] border border-[rgba(148,134,255,0.14)] bg-white/[0.02] p-2.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[16px] text-white font-oswald">¿Jugás este partido?</span>
                          </div>
                          <div className="mt-1.5 flex items-stretch gap-2">
                            <button
                              type="button"
                              onClick={() => handleChangeAvailability('available')}
                              disabled={challengeSquadSaving || !challengeSquadEditable}
                              className={`flex-1 ${availabilityStatusCurrent === 'available' ? participationActionPrimaryClass : participationActionSecondaryClass}`}
                            >
                              Estoy
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeAvailability('unavailable')}
                              disabled={challengeSquadSaving || !challengeSquadEditable}
                              className={`flex-1 ${availabilityStatusCurrent === 'unavailable' ? participationActionPrimaryClass : participationActionSecondaryClass}`}
                            >
                              No puedo
                            </button>
                          </div>
                          <p className="text-[12px] text-white/75 font-oswald">
                            Estado actual: <span className="text-white">{personalChallengeCurrentStateLabel}</span>
                          </p>
                          {!challengeSquadEditable ? (
                            <p className="text-[11px] text-white/55 font-oswald">
                              Convocatoria cerrada: solo lectura.
                            </p>
                          ) : null}
                          {!isSquadRosterViewOpen ? (
                            <>
                              <div className="h-px bg-white/10" />
                              <button
                                type="button"
                                onClick={() => setIsSquadRosterViewOpen(true)}
                                disabled={!hasAvailabilityResponse}
                                className={`w-full ${participationActionPrimaryClass}`}
                              >
                                Mi plantel
                              </button>
                              {!hasAvailabilityResponse ? (
                                <p className="text-[11px] text-white/60 font-oswald">
                                  Confirmá si jugás para abrir Mi plantel.
                                </p>
                              ) : null}
                            </>
                          ) : null}
                        </div>

                        {isSquadRosterViewOpen ? (
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                              <div className="flex min-w-0 items-center gap-2">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-0.5 rounded-[10px] border border-[rgba(148,134,255,0.3)] bg-white/[0.06] py-1.5 pl-1.5 pr-2.5 text-[11px] leading-none font-oswald uppercase tracking-[0.06em] text-white/85 transition-colors hover:bg-white/[0.12] hover:border-[rgba(148,134,255,0.5)] active:scale-[0.97]"
                                  onClick={() => setIsSquadRosterViewOpen(false)}
                                >
                                  <ChevronLeft size={13} className="shrink-0" />
                                  Volver
                                </button>
                                <span className="text-white font-oswald font-semibold text-[14px] uppercase tracking-[0.08em]">Mi plantel</span>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-full border border-[#7d5aff]/35 bg-[#6a43ff]/12 px-2.5 py-1 text-[10px] leading-none font-oswald uppercase tracking-[0.05em] text-white/75">
                                  Titulares
                                  <span className="font-semibold text-white">{myChallengeSquadCounters.starters}/{challengeSquadLimits.starters}</span>
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full border border-[#8aa6ff]/30 bg-[#3b5bff]/12 px-2.5 py-1 text-[10px] leading-none font-oswald uppercase tracking-[0.05em] text-white/75">
                                  Suplentes
                                  <span className="font-semibold text-white">{myChallengeSquadCounters.substitutes}/{challengeSquadLimits.substitutes}</span>
                                </span>
                              </div>
                            </div>

                            {!showMySquadManagement ? (
                              <p className="text-[11px] text-white/65 font-oswald">
                                El capitán de tu equipo define titulares y suplentes.
                              </p>
                            ) : null}

                            <div className="rounded-[12px] border border-[rgba(148,134,255,0.14)] bg-white/[0.03] px-2 py-1">
                              {myChallengeSquadRows.length === 0 ? (
                                <p className="py-1.5 text-[12px] text-white/60 font-oswald">
                                  Todavía no hay jugadores en el plantel.
                                </p>
                              ) : (
                                <div className="divide-y divide-white/[0.07]">
                                  {myChallengeSquadRows.map((entry) => {
                                    const availabilityStatus = String(entry?.availability_status || '').trim().toLowerCase();
                                    const availabilityLabel = getAvailabilityStatusLabel(availabilityStatus);
                                    const selectionStatus = String(entry?.selection_status || '').toLowerCase();
                                    const isStarter = selectionStatus === 'starter' && Boolean(entry?.approved_by_captain);
                                    const isSubstitute = selectionStatus === 'substitute' && Boolean(entry?.approved_by_captain);
                                    const isOut = !isStarter && !isSubstitute;
                                    const canAssignPlayer = availabilityStatus === 'available';

                                    return (
                                      <div
                                        key={entry?.id || `${myChallengeTeamId}-${entry?.jugador_id}`}
                                        className="flex items-center gap-2 py-1.5"
                                      >
                                        <div className="relative shrink-0">
                                          <div className="h-8 w-8 rounded-full border border-[rgba(168,152,255,0.3)] bg-[#151034]/85 overflow-hidden flex items-center justify-center text-[9px] font-semibold text-white/90">
                                            {getPlayerAvatar(entry) ? (
                                              <img src={getPlayerAvatar(entry)} alt={getPlayerName(entry)} className="h-full w-full object-cover" />
                                            ) : (
                                              <span>{getInitials(getPlayerName(entry))}</span>
                                            )}
                                          </div>
                                          <span
                                            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-[#0a1130] ${getAvailabilityIndicatorClass(availabilityStatus)}`}
                                            title={availabilityLabel}
                                          />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <span className="block truncate text-white font-oswald text-[12px] leading-tight">{getPlayerName(entry)}</span>
                                          <span className="block text-[10px] leading-tight text-white/50 font-oswald">{availabilityLabel}</span>
                                        </div>
                                        <div className="inline-flex shrink-0 items-stretch rounded-full border border-[rgba(148,134,255,0.22)] bg-[#100c2e]/90 p-[3px]">
                                          {[{
                                            key: 'starter',
                                            label: 'Titular',
                                            active: isStarter,
                                            activeClass: 'bg-[linear-gradient(135deg,#7c4dff,#5b2fe0)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]',
                                          }, {
                                            key: 'substitute',
                                            label: 'Suplente',
                                            active: isSubstitute,
                                            activeClass: 'bg-[#3d56e0] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]',
                                          }, {
                                            key: 'not_selected',
                                            label: 'Afuera',
                                            active: isOut,
                                            activeClass: 'bg-[#352a63] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
                                          }].map((action) => (
                                            <button
                                              key={`${entry?.id || entry?.jugador_id}-${action.key}`}
                                              type="button"
                                              className={`min-h-[30px] rounded-full px-2 text-[10px] font-oswald uppercase tracking-[0.03em] leading-none transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${action.active
                                                ? action.activeClass
                                                : 'text-white/55 hover:text-white/90'
                                                }`}
                                              onClick={() => handleChangeSelection({
                                                teamId: myChallengeTeamId,
                                                playerId: entry?.jugador_id,
                                                selectionStatus: action.key,
                                                row: entry,
                                              })}
                                              disabled={challengeSquadSaving || !challengeSquadEditable || !showMySquadManagement || !canAssignPlayer}
                                            >
                                              {action.label}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {showMySquadManagement ? (
                              <div className="pt-1 space-y-2">
                                {challengeSquadStatus === 'open' ? (
                                  <button
                                    type="button"
                                    onClick={handleConfirmSquadAndBack}
                                    disabled={challengeSquadSaving || !challengeSquadEditable}
                                    className={`w-full ${squadActionPrimaryClass}`}
                                  >
                                    Confirmar plantel
                                  </button>
                                ) : null}
                                {challengeSquadStatus === 'closed' ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSetChallengeSquadStatus('open')}
                                    disabled={challengeSquadSaving}
                                    className={`w-full ${squadActionSecondaryClass}`}
                                  >
                                    Reabrir plantel
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {isChallengeMatch && showChallengeHeadToHead ? (
                <div className={`mt-2 min-h-16 ${DETAIL_CARD_RADIUS_CLASS} border border-[rgba(148,134,255,0.18)] bg-[rgba(124,98,255,0.05)] px-[14px] py-[10px]`}>
                  {challengeHeadToHeadLoading ? (
                    <div className="grid h-16 grid-cols-4 gap-2">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={`challenge-history-skeleton-${index}`} className="min-w-0 flex flex-col items-center justify-center gap-1">
                          <div className="h-2.5 w-[75%] rounded bg-white/12" />
                          <div className="h-4 w-[62%] rounded bg-white/18" />
                        </div>
                      ))}
                    </div>
                  ) : challengeHeadToHeadView?.hasPlayedHistory ? (
                    <div className="grid h-16 grid-cols-4 gap-2">
                      <div className="min-w-0 flex flex-col items-center justify-center text-center leading-none">
                        <div className="w-full truncate text-[10px] sm:text-[11px] uppercase tracking-[0.06em] text-white/65">
                          ULTIMA VEZ
                        </div>
                        <div className="mt-1 w-full truncate text-[14px] sm:text-[16px] font-oswald font-semibold text-white">
                          {challengeHeadToHeadView.lastResultDateText}
                        </div>
                      </div>
                      <div className="min-w-0 flex flex-col items-center justify-center text-center leading-none">
                        <div className="w-full truncate text-[10px] sm:text-[11px] uppercase tracking-[0.06em] text-white/65">
                          JUGADOS
                        </div>
                        <div className="mt-1 w-full truncate text-[14px] sm:text-[16px] font-oswald font-semibold text-white">
                          {challengeHeadToHeadView.playedCount}
                        </div>
                      </div>
                      <div className="min-w-0 flex flex-col items-center justify-center text-center leading-none">
                        <div className="w-full truncate text-[10px] sm:text-[11px] uppercase tracking-[0.06em] text-white/65">
                          ULTIMO GANADOR
                        </div>
                        <div className="mt-1 w-full truncate text-[14px] sm:text-[16px] font-oswald font-semibold text-white">
                          {challengeHeadToHeadView.lastWinnerText}
                        </div>
                      </div>
                      <div className="min-w-0 flex flex-col items-center justify-center text-center leading-none">
                        <div className="w-full truncate text-[10px] sm:text-[11px] uppercase tracking-[0.06em] text-white/65">
                          HISTORIAL
                        </div>
                        <div className="mt-1 w-full truncate text-[14px] sm:text-[16px] font-oswald font-semibold text-white">
                          {challengeHeadToHeadView.historialValue}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-16 items-center justify-center text-center text-[14px] font-oswald font-medium text-white/85">
                      {challengeHeadToHeadView?.emptyStateText || 'Primera vez que se enfrentan'}
                    </div>
                  )}
                </div>
              ) : null}

              {showChallengeResultCard ? (
                <ChallengeResultCtaCard
                  rivalName={challengeResultRivalName}
                  resultLabel={resultAlreadyLoaded ? resultOutcomeLabel : null}
                  resultConflict={resultConflict}
                  canResolve={canResolveResult}
                  onResolve={() => {
                    if (!canResolveResult) return;
                    setResolveModalOpen(true);
                  }}
                  onLoad={() => {
                    if (resultAlreadyLoaded || resultConflict || !canReportChallengeResult) return;
                    setResultModalOpen(true);
                  }}
                />
              ) : null}

            </>
          ) : null}

          {!loading && match && isCancelledMatch ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
              Este partido fue cancelado y ya no está disponible.
            </div>
          ) : null}

          {!loading && match && !isCancelledMatch && isUnavailablePastChallengeMatch ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
              Este desafío ya pasó y ya no está disponible.
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        isOpen={ambiguousTeamModalOpen}
        onClose={() => {
          setAmbiguousTeamModalOpen(false);
        }}
        title="Confirmar participación"
        className="w-full max-w-[460px]"
        classNameContent="p-4 sm:p-5"
        footer={(
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => {
                setAmbiguousTeamModalOpen(false);
              }}
              variant="secondary"
              className={modalActionSecondaryClass}
              data-preserve-button-case="true"
            >
              Ahora no
            </Button>
            <Button
              type="button"
              onClick={() => {
                setAmbiguousTeamDecision('accepted');
                setAmbiguousTeamModalOpen(false);
              }}
              className={modalActionPrimaryClass}
              data-preserve-button-case="true"
            >
              Continuar
            </Button>
          </div>
        )}
      >
        <div className="space-y-2">
          <p className="text-sm text-white/90 font-oswald">
            Formás parte del otro equipo. ¿Estás seguro que querés continuar?
          </p>
          <p className="text-[12px] text-white/70 font-oswald">
            Si continuás, vas a gestionar la convocatoria de <span className="text-white">{ambiguousFallbackTeamName}</span>.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Editar datos del partido"
        className="w-full max-w-[560px]"
        classNameContent="p-4 sm:p-5"
        footer={(
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => setEditModalOpen(false)}
              variant="secondary"
              className={modalActionSecondaryClass}
              disabled={saving}
              data-preserve-button-case="true"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="team-match-edit-form"
              className={modalActionPrimaryClass}
              loading={saving}
              loadingText="Guardando..."
              disabled={saving}
              data-preserve-button-case="true"
            >
              Guardar
            </Button>
          </div>
        )}
      >
        <form id="team-match-edit-form" className="space-y-3" onSubmit={handleSave}>
          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Fecha y hora</span>
            <input
              type="datetime-local"
              value={scheduledAtInput}
              onChange={(event) => setScheduledAtInput(event.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
            />
          </label>

          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Formato</span>
            <select
              value={formatInput}
              onChange={(event) => setFormatInput(event.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
            >
              {TEAM_FORMAT_OPTIONS.map((value) => (
                <option key={value} value={String(value)}>
                  F{value}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Genero</span>
            <select
              value={generoInput}
              onChange={(event) => setGeneroInput(event.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
            >
              <option value="">Sin definir</option>
              {TEAM_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Ubicacion</span>
            <LocationAutocomplete
              value={locationInput}
              onChange={setLocationInput}
              placeholder="Cancha o direccion"
              inputClassName="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
            />
          </label>

          <label className="block">
            <span className="text-xs text-white/80 uppercase tracking-wide">Costo cancha</span>
            <input
              type="number"
              min={0}
              step="100"
              value={canchaCostInput}
              onChange={(event) => setCanchaCostInput(event.target.value)}
              placeholder="Ej: 12000"
              className="mt-1 w-full rounded-xl bg-slate-900/80 border border-white/20 px-3 py-2 text-white"
            />
          </label>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(rosterTeamId)}
        onClose={() => setRosterTeamId(null)}
        title={`Plantilla ${rosterTeam?.name || ''}`.trim() || 'Plantilla'}
        className="w-full max-w-[420px]"
        classNameContent="p-4"
      >
        {rosterMembers.length === 0 ? (
          <p className="text-sm text-white/65 font-oswald">Este equipo no tiene jugadores cargados.</p>
        ) : (
          <div className="space-y-2 max-h-[56vh] overflow-y-auto pr-1">
            {rosterMembers.map((member) => {
              const name = getPlayerName(member);
              const avatar = getPlayerAvatar(member);
              const profile = getPlayerProfile(member);

              return (
                <button
                  key={`roster-${member?.id || member?.jugador_id || name}`}
                  type="button"
                  onClick={() => {
                    setRosterTeamId(null);
                    setSelectedPlayerProfile(profile);
                  }}
                  className="w-full flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                >
                  <div className="h-9 w-9 rounded-full border border-white/25 bg-slate-900/70 overflow-hidden flex items-center justify-center text-[11px] font-semibold text-white/90 shrink-0">
                    {avatar ? (
                      <img src={avatar} alt={name} className="h-full w-full object-cover" />
                    ) : (
                      <span>{getInitials(name)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-oswald truncate">{name}</p>
                    {member?.is_captain ? (
                      <p className="text-[11px] text-white/65 font-oswald">Capitan</p>
                    ) : null}
                  </div>
                  <Users size={15} className="text-white/40" />
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      <ChatButton
        partidoId={!isCancelledMatch && !isUnavailablePastChallengeMatch ? (match?.id || null) : null}
        isOpen={isChatOpen}
        onOpenChange={setIsChatOpen}
        onUnreadCountChange={setChatUnreadCount}
        hideTrigger
      />

      <ProfileCardModal
        isOpen={Boolean(selectedPlayerProfile)}
        onClose={() => setSelectedPlayerProfile(null)}
        profile={selectedPlayerProfile}
      />

      <ReportChallengeResultModal
        isOpen={resultModalOpen}
        challenge={resultModalChallenge}
        perspectiveIsChallenger={perspectiveIsChallenger}
        initialOutcome={resultInitialOutcome}
        isSubmitting={resultModalSubmitting}
        onClose={() => setResultModalOpen(false)}
        onSubmit={handleSubmitChallengeResult}
      />

      <ResolveChallengeResultModal
        isOpen={resolveModalOpen}
        challenge={resultModalChallenge}
        teamAName={match?.team_a?.name || null}
        teamBName={match?.team_b?.name || null}
        isSubmitting={resolveModalSubmitting}
        onClose={() => setResolveModalOpen(false)}
        onSubmit={handleResolveChallengeResult}
      />
    </PageTransition>
  );
};

export default TeamMatchDetailPage;
