import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { Flag, MoreVertical, Shield, Users } from 'lucide-react';
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
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import {
  getChallengeHeadToHeadStats,
  getTeamMatchById,
  listChallengeTeamSquad,
  setChallengeAvailability,
  setChallengeSquadStatus,
  listTeamMatchMembers,
  upsertChallengeTeamSelection,
  updateTeamMatchDetails,
} from '../services/db/teamChallenges';
import { notifyBlockingError } from '../utils/notifyBlockingError';

const AVATAR_VISIBLE_LIMIT = 6;
const DETAIL_CARD_RADIUS_CLASS = 'rounded-[18px]';
const EMPTY_CHALLENGE_HEAD_TO_HEAD = Object.freeze({
  totalMatchesScheduled: 0,
  lastMatchScheduledAt: null,
  lastWinnerTeamId: null,
  winsTeamA: 0,
  winsTeamB: 0,
});

const SQUAD_FILTER_TABS = [
  { key: 'available', label: 'Disponibles' },
  { key: 'starter', label: 'Titulares' },
  { key: 'substitute', label: 'Suplentes' },
  { key: 'out', label: 'Afuera' },
];

const SQUAD_EMPTY_MESSAGE_BY_TAB = {
  available: 'Todavía no hay disponibles.',
  starter: 'No hay titulares definidos.',
  substitute: 'No hay suplentes definidos.',
  out: 'No hay jugadores en afuera.',
};

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
    return 'bg-[#2b1d52] border-2 border-[#c084fc] text-[#f3e8ff]';
  }
  return 'bg-[#15344f] border-2 border-[#22d3ee] text-[#e0f2fe]';
};

const getStatusBadgeClass = (statusValue) => {
  const status = String(statusValue || '').trim().toLowerCase();
  if (status === 'confirmed') return 'text-[#D6F8E2] border-[#5AD17B]/45 bg-[#2F9E44]/24';
  if (status === 'pending') return 'text-[#FDE68A] border-[#FBBF24]/45 bg-[#B45309]/24';
  if (status === 'played') return 'text-[#D4EBFF] border-[#9ED3FF]/45 bg-[#128BE9]/22';
  if (status === 'cancelled') return 'text-[#E2E8F0] border-[#94A3B8]/45 bg-[#475569]/28';
  return 'text-white/85 border-white/25 bg-white/10';
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

const getAvailabilityLabel = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'available') return 'Disponible';
  if (normalized === 'unavailable') return 'No disponible';
  return 'Pendiente';
};

const getAvailabilityBadgeClass = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'available') return 'text-[#D6F8E2] border-[#5AD17B]/45 bg-[#2F9E44]/24';
  if (normalized === 'unavailable') return 'text-[#FDE68A] border-[#FBBF24]/45 bg-[#B45309]/24';
  return 'text-[#D4EBFF] border-[#9ED3FF]/45 bg-[#128BE9]/22';
};

const getInlineNoticeClass = (type) => {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'success') return 'border-[#5AD17B]/45 bg-[#2F9E44]/24 text-[#D6F8E2]';
  if (normalized === 'warning') return 'border-[#FBBF24]/45 bg-[#B45309]/24 text-[#FDE68A]';
  if (normalized === 'error') return 'border-[#FCA5A5]/45 bg-[#7F1D1D]/35 text-[#FECACA]';
  return 'border-[#9ED3FF]/45 bg-[#128BE9]/22 text-[#D4EBFF]';
};

const getSelectionBadgeClass = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'starter') return 'text-[#D6F8E2] border-[#5AD17B]/45 bg-[#2F9E44]/24';
  if (normalized === 'substitute') return 'text-[#D4EBFF] border-[#9ED3FF]/45 bg-[#128BE9]/22';
  return 'text-[#F8D5FF] border-[#D8B4FE]/45 bg-[#6D28D9]/22';
};

const getPersonalChallengeStatusLabel = (row) => {
  const selection = String(row?.selection_status || '').trim().toLowerCase();
  if (selection === 'starter') return 'Titular';
  if (selection === 'substitute') return 'Suplente';
  if (selection === 'not_selected' && row?.approved_by_captain) return 'Afuera';

  const availability = String(row?.availability_status || '').trim().toLowerCase();
  if (availability === 'available') return 'Disponible';
  if (availability === 'unavailable') return 'No disponible';
  return 'Pendiente';
};

const normalizeIdentityToken = (value) => String(value || '').trim();

const getPlayerName = (member) => String(member?.jugador?.nombre || 'Jugador').trim();

const getPlayerAvatar = (member) => (
  member?.photo_url
  || member?.profile_avatar_url
  || member?.jugador?.avatar_url
  || null
);

const modalActionButtonBaseClass = '!w-full !h-auto !min-h-[44px] !px-4 !py-2.5 !rounded-none !font-bebas !text-base !tracking-[0.01em] !normal-case sm:!text-[13px] sm:!px-3 sm:!py-2 sm:!min-h-[36px]';
const modalActionPrimaryClass = `${modalActionButtonBaseClass} !border !border-[#7d5aff] !bg-[#6a43ff] !text-white !shadow-[0_0_14px_rgba(106,67,255,0.3)] hover:!bg-[#7550ff]`;
const modalActionSecondaryClass = `${modalActionButtonBaseClass} !border !border-[rgba(98,117,184,0.58)] !bg-[rgba(20,31,70,0.82)] !text-white/92 hover:!bg-[rgba(30,45,94,0.95)]`;

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

const TeamCardLocked = ({
  team,
  fallbackName,
  members,
  onOpenProfile,
  onOpenRoster,
}) => {
  const visibleMembers = (members || []).slice(0, AVATAR_VISIBLE_LIMIT);
  const overflowCount = Math.max(0, (members || []).length - visibleMembers.length);
  const totalMembers = (members || []).length;
  const statusLabel = totalMembers > 0 ? `${totalMembers} jugadores` : 'Sin jugadores';
  const teamName = team?.name || fallbackName;
  const badgeStyle = getTeamBadgeStyle(team);

  return (
    <div
      className={`relative overflow-hidden ${DETAIL_CARD_RADIUS_CLASS} border border-[rgba(41,170,255,0.4)] bg-[radial-gradient(circle_at_50%_0%,rgba(39,105,255,0.12),rgba(7,22,59,0.95)_48%),linear-gradient(180deg,#081338_0%,#060f2d_100%)] px-4 py-4 sm:px-5 sm:py-5 min-h-[238px] min-w-0 shadow-[0_16px_28px_rgba(3,8,28,0.45)]`}
    >
      <div className="relative flex h-full flex-col">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-[18px] overflow-hidden border border-[#1c4ea8] bg-[#0e1b47] flex items-center justify-center shrink-0">
            {team?.crest_url ? (
              <img src={team.crest_url} alt={teamName} className="h-full w-full object-cover" />
            ) : (
              <Shield size={26} className="text-white/70" />
            )}
          </div>
          <div className="mt-3 w-full text-white font-oswald text-[21px] sm:text-[24px] leading-tight font-semibold whitespace-normal break-words">{teamName}</div>
          <button
            type="button"
            onClick={onOpenRoster}
            className="mt-3 inline-flex items-center rounded-[14px] border px-3 py-1.5 text-[12px] uppercase tracking-[0.12em] font-oswald transition-colors hover:bg-white/15"
            style={badgeStyle}
            aria-label={`Ver plantilla de ${teamName}`}
            title="Ver plantilla completa"
          >
            {statusLabel}
          </button>
        </div>

        <div className="mt-4 h-px bg-[rgba(88,107,170,0.34)]" />

        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap min-h-[38px]">
          {visibleMembers.length > 0 ? visibleMembers.map((member) => {
            const name = getPlayerName(member);
            const avatar = getPlayerAvatar(member);
            return (
              <button
                key={`${member?.id || member?.jugador_id || name}`}
                type="button"
                onClick={() => onOpenProfile(getPlayerProfile(member))}
                className="h-10 w-10 rounded-full border border-white/30 bg-slate-900/70 overflow-hidden flex items-center justify-center text-[10px] font-semibold text-white/90 shrink-0"
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
            <span className="text-[12px] text-white/55 font-oswald">Sin jugadores</span>
          )}

          {overflowCount > 0 ? (
            <button
              type="button"
              onClick={onOpenRoster}
              className="h-10 min-w-[40px] px-2 rounded-full border border-white/30 bg-slate-900/70 text-[11px] text-white/85 font-oswald shrink-0"
              aria-label={`Ver ${overflowCount} jugadores mas`}
              title="Ver plantilla completa"
            >
              +{overflowCount}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const TeamMatchDetailPage = () => {
  const navigate = useNavigate();
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
  const [squadFilterTab, setSquadFilterTab] = useState('available');
  const actionsMenuButtonRef = useRef(null);

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

  const loadChallengeSquadForMatch = useCallback(async (matchRow) => {
    const challengeId = matchRow?.challenge_id || null;
    const teamIds = [matchRow?.team_a_id, matchRow?.team_b_id].filter(Boolean);

    if (!challengeId || teamIds.length === 0) {
      setChallengeSquadByTeamId({});
      setChallengeSquadMeta(null);
      return;
    }

    try {
      setChallengeSquadLoading(true);
      const result = await listChallengeTeamSquad({
        challengeId,
        teamIds,
        ensurePrepared: true,
      });
      setChallengeSquadByTeamId(result?.byTeamId || {});
      setChallengeSquadMeta(result?.challenge || null);
    } catch (error) {
      setChallengeSquadByTeamId({});
      setChallengeSquadMeta(null);
      notifyBlockingError(error.message || 'No se pudo cargar la convocatoria del desafío');
    } finally {
      setChallengeSquadLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!matchId) return;

    try {
      setLoading(true);
      const matchRow = await getTeamMatchById(matchId);
      setMatch(matchRow);
      syncFormWithMatch(matchRow);
      await loadMembersForMatch(matchRow);
      await loadChallengeSquadForMatch(matchRow);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el partido');
    } finally {
      setLoading(false);
    }
  }, [loadChallengeSquadForMatch, loadMembersForMatch, matchId, syncFormWithMatch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isChallengeMatch = useMemo(
    () => String(match?.type || match?.origin_type || '').toLowerCase() === 'challenge' || Boolean(match?.challenge_id),
    [match?.challenge_id, match?.origin_type, match?.type],
  );

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
        const stats = await getChallengeHeadToHeadStats({ teamAId, teamBId });
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
  }, [isChallengeMatch, match?.team_a_id, match?.team_b_id]);

  const challengeCreatorUserId = useMemo(
    () => match?.challenge?.created_by_user_id || null,
    [match?.challenge?.created_by_user_id],
  );

  const canEditMatchInfo = useMemo(
    () => (
      isChallengeMatch
      && Boolean(user?.id)
      && Boolean(challengeCreatorUserId)
      && String(user.id) === String(challengeCreatorUserId)
    ),
    [challengeCreatorUserId, isChallengeMatch, user?.id],
  );
  const canShowEditAction = canEditMatchInfo && match?.status !== 'cancelled' && match?.status !== 'played';

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

  const currentUserTeamId = useMemo(() => (
    viewerChallengeTeam?.myTeamId
    || (match?.team_a_id ? String(match.team_a_id) : null)
  ), [match?.team_a_id, viewerChallengeTeam?.myTeamId]);

  const myChallengeTeamId = useMemo(
    () => String(viewerChallengeTeam?.myTeamId || '').trim() || null,
    [viewerChallengeTeam?.myTeamId],
  );

  const myChallengeTeam = useMemo(() => {
    if (!myChallengeTeamId) return null;
    if (String(match?.team_a_id || '') === myChallengeTeamId) return match?.team_a || null;
    if (String(match?.team_b_id || '') === myChallengeTeamId) return match?.team_b || null;
    return viewerChallengeTeam?.myTeam || null;
  }, [match?.team_a, match?.team_a_id, match?.team_b, match?.team_b_id, myChallengeTeamId, viewerChallengeTeam?.myTeam]);

  const teamCardsMembersByTeamId = useMemo(() => {
    if (!isChallengeMatch) return teamMembersByTeamId;

    const base = { ...teamMembersByTeamId };
    if (!myChallengeTeamId) return base;

    const myApprovedRows = (challengeSquadDisplayByTeamId?.[myChallengeTeamId] || []).filter((row) => (
      row?.approved_by_captain
      && ['starter', 'substitute'].includes(String(row?.selection_status || '').toLowerCase())
    ));

    if (myApprovedRows.length > 0) {
      base[myChallengeTeamId] = myApprovedRows;
    }
    return base;
  }, [challengeSquadDisplayByTeamId, isChallengeMatch, myChallengeTeamId, teamMembersByTeamId]);

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
    challengeSquadStatus === 'open' && match?.status !== 'played' && match?.status !== 'cancelled'
  ), [challengeSquadStatus, match?.status]);

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

  const challengeSquadRowsByTab = useMemo(() => {
    const rows = myChallengeSquadRows || [];
    return {
      available: rows.filter((row) => String(row?.availability_status || '').trim().toLowerCase() === 'available'),
      starter: rows.filter((row) => (
        Boolean(row?.approved_by_captain) && String(row?.selection_status || '').trim().toLowerCase() === 'starter'
      )),
      substitute: rows.filter((row) => (
        Boolean(row?.approved_by_captain) && String(row?.selection_status || '').trim().toLowerCase() === 'substitute'
      )),
      out: rows.filter((row) => {
        const selection = String(row?.selection_status || '').trim().toLowerCase();
        return selection === 'not_selected' || !row?.approved_by_captain;
      }),
    };
  }, [myChallengeSquadRows]);

  const squadFilterTabOptions = useMemo(() => (
    SQUAD_FILTER_TABS.map((tab) => ({
      ...tab,
      count: (challengeSquadRowsByTab?.[tab.key] || []).length,
    }))
  ), [challengeSquadRowsByTab]);

  const visibleMySquadRows = useMemo(
    () => challengeSquadRowsByTab?.[squadFilterTab] || [],
    [challengeSquadRowsByTab, squadFilterTab],
  );

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

  const canRenderPrivateChallengeSquad = Boolean(challengeSquadViewState?.showOperationalModule);
  const showAmbiguousChallengeNotice = Boolean(challengeSquadViewState?.showAmbiguousNotice);
  const showMySquadManagement = Boolean(challengeSquadViewState?.showMySquadManagement);

  useEffect(() => {
    setSquadFilterTab('available');
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
      showChallengeInlineNotice('warning', 'Solo el capitán/admin puede armar el plantel.');
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
    if (!match?.challenge_id || !canRenderPrivateChallengeSquad) return;
    if (!canManageMyChallengeSquad) {
      showChallengeInlineNotice('warning', 'Solo el capitán/admin puede cambiar el estado del plantel.');
      return;
    }
    const normalizedNextStatus = String(nextStatus || '').trim().toLowerCase();
    if (!['open', 'closed'].includes(normalizedNextStatus)) {
      showChallengeInlineNotice('warning', 'Estado de convocatoria inválido.');
      return;
    }
    if (normalizedNextStatus === challengeSquadStatus) return;

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
    } catch (error) {
      showChallengeInlineNotice('warning', error?.message || 'No se pudo actualizar el estado de la convocatoria.');
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

  const challengeHeadToHeadView = useMemo(() => {
    if (!match) return null;

    const stats = challengeHeadToHead || EMPTY_CHALLENGE_HEAD_TO_HEAD;
    const teamAId = String(match?.team_a_id || '');
    const teamBId = String(match?.team_b_id || '');
    const totalMatchesScheduled = Number(stats.totalMatchesScheduled || 0);
    const hasScheduledHistory = totalMatchesScheduled > 0;
    const winsTeamA = Number(stats.winsTeamA || 0);
    const winsTeamB = Number(stats.winsTeamB || 0);

    const winnerTeamId = String(stats.lastWinnerTeamId || '');
    const isWinnerTeamA = winnerTeamId && winnerTeamId === teamAId;
    const isWinnerTeamB = winnerTeamId && winnerTeamId === teamBId;
    const lastWinnerName = isWinnerTeamA
      ? String(match?.team_a?.name || '').trim()
      : isWinnerTeamB
        ? String(match?.team_b?.name || '').trim()
        : '';

    const perspectiveIsTeamB = Boolean(currentUserTeamId && currentUserTeamId === teamBId);
    const wins = perspectiveIsTeamB ? winsTeamB : winsTeamA;
    const losses = perspectiveIsTeamB ? winsTeamA : winsTeamB;
    const historialValue = `${wins}V - ${losses}D`;

    return {
      hasScheduledHistory,
      totalMatchesScheduled,
      lastMatchDateText: formatHeadToHeadDate(stats.lastMatchScheduledAt),
      lastWinnerText: lastWinnerName || '—',
      historialValue,
    };
  }, [challengeHeadToHead, currentUserTeamId, match]);

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
      sede: match?.location || match?.location_name || 'A definir',
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

  return (
    <PageTransition>
      <PageTitle
        title="Detalle partido"
        onBack={() => navigate(-1)}
        showChatButton
        onChatClick={() => setIsChatOpen(true)}
        unreadCount={chatUnreadCount}
      >
        Detalle partido
      </PageTitle>

      <div className="w-full pb-8 pt-[96px]">
        <div className="w-full overflow-visible">
          <MatchInfoSection
            partido={headerInfoPartido}
            topOffsetClassName="mt-0"
          />
        </div>

        <div className="mx-auto mt-3 w-full max-w-[560px] space-y-3 px-4">
          {loading ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
              Cargando partido...
            </div>
          ) : null}

          {!loading && !match ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-center text-white/70">
              No encontramos este partido o no tenes acceso.
            </div>
          ) : null}

          {!loading && match ? (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-none border px-2 py-1 text-[11px] font-oswald uppercase tracking-wide ${getOriginBadgeClass(match?.origin_type)}`}>
                      <Flag size={12} /> {match?.origin_type === 'challenge' ? 'Desafio' : 'Amistoso'}
                    </span>
                    <span className={`inline-flex items-center rounded-none border px-2 py-1 text-[11px] font-oswald uppercase tracking-wide ${getStatusBadgeClass(match?.status)}`}>
                      {statusLabelByValue[match?.status] || match?.status || 'Pendiente'}
                    </span>
                  </div>

                  {canShowEditAction ? (
                    <div className="relative shrink-0">
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
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  <TeamCardLocked
                    team={match?.team_a}
                    fallbackName="Equipo A"
                    members={teamCardsMembersByTeamId[match?.team_a_id] || []}
                    onOpenProfile={setSelectedPlayerProfile}
                    onOpenRoster={() => setRosterTeamId(match?.team_a_id)}
                  />
                  <div className="flex items-center justify-center gap-2 text-white/70 text-[13px] font-oswald font-medium tracking-[0.08em]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#7c3aed]/85" />
                    <span>VS</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-[#38bdf8]/85" />
                  </div>
                  <TeamCardLocked
                    team={match?.team_b}
                    fallbackName="Equipo B"
                    members={teamCardsMembersByTeamId[match?.team_b_id] || []}
                    onOpenProfile={setSelectedPlayerProfile}
                    onOpenRoster={() => setRosterTeamId(match?.team_b_id)}
                  />
                </div>

                {isChallengeMatch && showAmbiguousChallengeNotice ? (
                  <div className={`${DETAIL_CARD_RADIUS_CLASS} border border-amber-300/35 bg-amber-500/10 p-3`}>
                    <p className="text-sm font-oswald text-amber-100">
                      No pudimos determinar tu equipo para este desafío.
                    </p>
                    <p className="mt-1 text-[12px] font-oswald text-amber-50/90">
                      Revisá tu pertenencia a equipos antes de gestionar la convocatoria.
                    </p>
                  </div>
                ) : null}

                {isChallengeMatch && canRenderPrivateChallengeSquad ? (
                  <div className={`${DETAIL_CARD_RADIUS_CLASS} border border-white/10 bg-white/[0.04] p-3 space-y-2.5`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-white font-oswald text-base">
                            Convocatoria de {myChallengeTeam?.name || 'Mi equipo'}
                          </span>
                          <span className={`inline-flex items-center rounded-none border px-2 py-1 text-[11px] font-oswald uppercase tracking-wide ${getSquadStatusBadgeClass(challengeSquadStatus)}`}>
                            {SQUAD_STATUS_LABEL_BY_VALUE[challengeSquadStatus] || 'No abierta'}
                          </span>
                        </div>
                        <span className="text-[11px] text-white/60 font-oswald">
                          Desafío compartido, gestión privada de tu equipo.
                        </span>
                      </div>

                      {showMySquadManagement ? (
                        <div className="flex items-center gap-1.5">
                          {challengeSquadStatus === 'open' ? (
                            <button
                              type="button"
                              className="rounded-none border border-[#FBBF24]/45 bg-[#B45309]/24 px-2 py-1 text-[11px] font-oswald uppercase tracking-wide text-[#FDE68A] disabled:opacity-60"
                              onClick={() => handleSetChallengeSquadStatus('closed')}
                              disabled={challengeSquadSaving || !challengeSquadEditable}
                            >
                              Cerrar
                            </button>
                          ) : null}
                          {challengeSquadStatus === 'closed' ? (
                            <button
                              type="button"
                              className="rounded-none border border-[#5AD17B]/45 bg-[#2F9E44]/24 px-2 py-1 text-[11px] font-oswald uppercase tracking-wide text-[#D6F8E2] disabled:opacity-60"
                              onClick={() => handleSetChallengeSquadStatus('open')}
                              disabled={challengeSquadSaving}
                            >
                              Reabrir
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {inlineNotice?.message ? (
                      <div className={`rounded-none border px-3 py-2 text-[12px] font-oswald leading-relaxed ${getInlineNoticeClass(inlineNotice?.type)}`}>
                        <div className="flex items-start justify-between gap-2">
                          <span>{inlineNotice.message}</span>
                          <button
                            type="button"
                            className="text-current/80 hover:text-current text-[10px] uppercase tracking-wide"
                            onClick={() => setInlineNotice({ type: '', message: '' })}
                          >
                            Cerrar
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {challengeSquadLoading ? (
                      <p className="text-sm text-white/65 font-oswald">Cargando convocatoria...</p>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="rounded-none border border-white/10 bg-white/[0.03] p-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[12px] uppercase tracking-[0.08em] text-white/65 font-oswald">Mi disponibilidad</span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`inline-flex items-center rounded-none border px-2 py-1 text-[10px] font-oswald uppercase tracking-wide ${getAvailabilityBadgeClass(currentUserSquadRow?.availability_status)}`}>
                                {getAvailabilityLabel(currentUserSquadRow?.availability_status)}
                              </span>
                              <span className={`inline-flex items-center rounded-none border px-2 py-1 text-[10px] font-oswald uppercase tracking-wide ${getSelectionBadgeClass(currentUserSquadRow?.selection_status)}`}>
                                {getPersonalChallengeStatusLabel(currentUserSquadRow)}
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              className={`rounded-none border px-2.5 py-1 text-[11px] font-oswald uppercase tracking-wide disabled:opacity-60 ${String(currentUserSquadRow?.availability_status || '').toLowerCase() === 'available'
                                ? 'border-[#5AD17B]/45 bg-[#2F9E44]/24 text-[#D6F8E2]'
                                : 'border-white/25 bg-white/5 text-white/80'
                                }`}
                              onClick={() => handleChangeAvailability('available')}
                              disabled={challengeSquadSaving || !challengeSquadEditable}
                            >
                              Disponible
                            </button>
                            <button
                              type="button"
                              className={`rounded-none border px-2.5 py-1 text-[11px] font-oswald uppercase tracking-wide disabled:opacity-60 ${String(currentUserSquadRow?.availability_status || '').toLowerCase() === 'unavailable'
                                ? 'border-[#FBBF24]/45 bg-[#B45309]/24 text-[#FDE68A]'
                                : 'border-white/25 bg-white/5 text-white/80'
                                }`}
                              onClick={() => handleChangeAvailability('unavailable')}
                              disabled={challengeSquadSaving || !challengeSquadEditable}
                            >
                              No disponible
                            </button>
                          </div>
                          {!challengeSquadEditable ? (
                            <p className="mt-2 text-[11px] text-white/55 font-oswald">
                              Convocatoria cerrada: solo lectura.
                            </p>
                          ) : null}
                        </div>

                        {showMySquadManagement ? (
                          <div className="rounded-none border border-white/10 bg-black/15 p-2.5 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-white font-oswald text-[14px] uppercase tracking-[0.04em]">Mi plantel</span>
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="rounded-none border border-white/25 px-2 py-1 text-white/85">T {myChallengeSquadCounters.starters}/{challengeSquadLimits.starters}</span>
                                <span className="rounded-none border border-white/25 px-2 py-1 text-white/85">S {myChallengeSquadCounters.substitutes}/{challengeSquadLimits.substitutes}</span>
                                <span className="rounded-none border border-white/25 px-2 py-1 text-white/85">C {myChallengeSquadCounters.selected}/{challengeSquadLimits.selected}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                              {squadFilterTabOptions.map((tab) => {
                                const isActive = squadFilterTab === tab.key;
                                return (
                                  <button
                                    key={`squad-tab-${tab.key}`}
                                    type="button"
                                    className={`whitespace-nowrap rounded-none border px-2 py-1 text-[10px] font-oswald uppercase tracking-wide transition-colors ${isActive
                                      ? 'border-[#7d5aff] bg-[#6a43ff]/35 text-white'
                                      : 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10'
                                      }`}
                                    onClick={() => setSquadFilterTab(tab.key)}
                                  >
                                    {tab.label} ({tab.count})
                                  </button>
                                );
                              })}
                            </div>

                            {visibleMySquadRows.length === 0 ? (
                              <p className="text-[12px] text-white/60 font-oswald">
                                {SQUAD_EMPTY_MESSAGE_BY_TAB[squadFilterTab] || 'Sin jugadores en esta sección.'}
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {visibleMySquadRows.map((entry) => {
                                  const availabilityStatus = String(entry?.availability_status || '').toLowerCase();
                                  const selectionStatus = String(entry?.selection_status || '').toLowerCase();
                                  const isStarter = selectionStatus === 'starter' && Boolean(entry?.approved_by_captain);
                                  const isSubstitute = selectionStatus === 'substitute' && Boolean(entry?.approved_by_captain);
                                  const isOut = !isStarter && !isSubstitute;

                                  return (
                                    <div
                                      key={entry?.id || `${myChallengeTeamId}-${entry?.jugador_id}`}
                                      className="rounded-none border border-white/10 bg-white/[0.03] px-2 py-1.5"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <div className="h-7 w-7 rounded-full border border-white/25 bg-slate-900/70 overflow-hidden flex items-center justify-center text-[9px] font-semibold text-white/90 shrink-0">
                                            {getPlayerAvatar(entry) ? (
                                              <img src={getPlayerAvatar(entry)} alt={getPlayerName(entry)} className="h-full w-full object-cover" />
                                            ) : (
                                              <span>{getInitials(getPlayerName(entry))}</span>
                                            )}
                                          </div>
                                          <span className="text-white font-oswald text-[13px] truncate">{getPlayerName(entry)}</span>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-end gap-1">
                                          <span className={`inline-flex items-center rounded-none border px-1.5 py-0.5 text-[9px] font-oswald uppercase tracking-wide ${getAvailabilityBadgeClass(availabilityStatus)}`}>
                                            {getAvailabilityLabel(availabilityStatus)}
                                          </span>
                                          <span className={`inline-flex items-center rounded-none border px-1.5 py-0.5 text-[9px] font-oswald uppercase tracking-wide ${getSelectionBadgeClass(selectionStatus)}`}>
                                            {isStarter ? 'Titular' : isSubstitute ? 'Suplente' : 'Afuera'}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="mt-1.5 flex items-center gap-1">
                                        {[{
                                          key: 'starter',
                                          label: 'Titular',
                                          active: isStarter,
                                        }, {
                                          key: 'substitute',
                                          label: 'Suplente',
                                          active: isSubstitute,
                                        }, {
                                          key: 'not_selected',
                                          label: 'Afuera',
                                          active: isOut,
                                        }].map((action) => (
                                          <button
                                            key={`${entry?.id || entry?.jugador_id}-${action.key}`}
                                            type="button"
                                            className={`flex-1 rounded-none border px-1.5 py-1 text-[9px] font-oswald uppercase tracking-wide disabled:opacity-60 ${action.active
                                              ? 'border-[#7d5aff] bg-[#6a43ff]/35 text-white'
                                              : 'border-white/25 bg-white/5 text-white/80'
                                              }`}
                                            onClick={() => handleChangeSelection({
                                              teamId: myChallengeTeamId,
                                              playerId: entry?.jugador_id,
                                              selectionStatus: action.key,
                                              row: entry,
                                            })}
                                            disabled={challengeSquadSaving || !challengeSquadEditable}
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
                        ) : (
                          <div className="rounded-none border border-white/10 bg-white/[0.02] p-2.5">
                            <p className="text-[12px] text-white/70 font-oswald">
                              El capitán/admin de {myChallengeTeam?.name || 'tu equipo'} va a definir titulares y suplentes.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {isChallengeMatch && showChallengeHeadToHead ? (
                <div className={`mt-2 h-16 ${DETAIL_CARD_RADIUS_CLASS} border border-white/10 bg-white/[0.04] px-[14px] py-[10px]`}>
                  {challengeHeadToHeadLoading ? (
                    <div className="grid h-full grid-cols-4 gap-2">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={`challenge-history-skeleton-${index}`} className="min-w-0 flex flex-col items-center justify-center gap-1">
                          <div className="h-2.5 w-[75%] rounded bg-white/12" />
                          <div className="h-4 w-[62%] rounded bg-white/18" />
                        </div>
                      ))}
                    </div>
                  ) : challengeHeadToHeadView?.hasScheduledHistory ? (
                    <div className="grid h-full grid-cols-4 gap-2">
                      <div className="min-w-0 flex flex-col items-center justify-center text-center leading-none">
                        <div className="w-full truncate text-[10px] sm:text-[11px] uppercase tracking-[0.06em] text-white/65">
                          ULTIMA VEZ
                        </div>
                        <div className="mt-1 w-full truncate text-[14px] sm:text-[16px] font-oswald font-semibold text-white">
                          {challengeHeadToHeadView.lastMatchDateText}
                        </div>
                      </div>
                      <div className="min-w-0 flex flex-col items-center justify-center text-center leading-none">
                        <div className="w-full truncate text-[10px] sm:text-[11px] uppercase tracking-[0.06em] text-white/65">
                          PARTIDOS
                        </div>
                        <div className="mt-1 w-full truncate text-[14px] sm:text-[16px] font-oswald font-semibold text-white">
                          {challengeHeadToHeadView.totalMatchesScheduled}
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
                    <div className="flex h-full items-center justify-center text-center text-[14px] font-oswald font-medium text-white/85">
                      Primera vez que se enfrentan
                    </div>
                  )}
                </div>
              ) : null}

            </>
          ) : null}
        </div>
      </div>

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
        partidoId={match?.id || null}
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
    </PageTransition>
  );
};

export default TeamMatchDetailPage;
