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
import { TEAM_FORMAT_OPTIONS, TEAM_MODE_OPTIONS } from '../features/equipos/config';
import { getTeamBadgeStyle, getTeamGradientStyle } from '../features/equipos/utils/teamColors';
import normalizePartidoForHeader from '../utils/normalizePartidoForHeader';
import {
  getChallengeHeadToHeadStats,
  getTeamMatchById,
  listTeamMatchMembers,
  updateTeamMatchDetails,
} from '../services/db/teamChallenges';
import { notifyBlockingError } from '../utils/notifyBlockingError';

const AVATAR_VISIBLE_LIMIT = 6;
const EMPTY_CHALLENGE_HEAD_TO_HEAD = Object.freeze({
  totalMatchesScheduled: 0,
  lastMatchScheduledAt: null,
  lastWinnerTeamId: null,
  winsTeamA: 0,
  winsTeamB: 0,
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

const getPlayerName = (member) => String(member?.jugador?.nombre || 'Jugador').trim();

const getPlayerAvatar = (member) => (
  member?.photo_url
  || member?.profile_avatar_url
  || member?.jugador?.avatar_url
  || null
);

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
      className="relative overflow-hidden rounded-[28px] border p-4 sm:p-5 min-h-[224px] min-w-0"
      style={team ? getTeamGradientStyle(team) : undefined}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.16),transparent_56%)]" />

      <div className="relative flex h-full flex-col">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-2xl overflow-hidden border border-white/20 bg-black/30 flex items-center justify-center shrink-0">
            {team?.crest_url ? (
              <img src={team.crest_url} alt={teamName} className="h-full w-full object-cover" />
            ) : (
              <Shield size={26} className="text-white/70" />
            )}
          </div>
          <div className="mt-3 text-white font-oswald text-[21px] sm:text-[24px] leading-tight font-semibold truncate max-w-full">{teamName}</div>
          <button
            type="button"
            onClick={onOpenRoster}
            className="mt-3 inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] uppercase tracking-[0.12em] font-oswald transition-colors hover:bg-white/15"
            style={badgeStyle}
            aria-label={`Ver plantilla de ${teamName}`}
            title="Ver plantilla completa"
          >
            {statusLabel}
          </button>
        </div>

        <div className="mt-4 border-t border-white/10" />

        <div className="mt-3 flex items-center justify-center gap-2 flex-wrap min-h-[32px]">
          {visibleMembers.length > 0 ? visibleMembers.map((member) => {
            const name = getPlayerName(member);
            const avatar = getPlayerAvatar(member);
            return (
              <button
                key={`${member?.id || member?.jugador_id || name}`}
                type="button"
                onClick={() => onOpenProfile(getPlayerProfile(member))}
                className="h-9 w-9 rounded-full border border-white/30 bg-slate-900/70 overflow-hidden flex items-center justify-center text-[10px] font-semibold text-white/90 shrink-0"
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
              className="h-9 min-w-[36px] px-2 rounded-full border border-white/30 bg-slate-900/70 text-[11px] text-white/85 font-oswald shrink-0"
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
  const [rosterTeamId, setRosterTeamId] = useState(null);
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [actionsMenuPosition, setActionsMenuPosition] = useState({ top: 0, left: 0 });
  const [challengeHeadToHead, setChallengeHeadToHead] = useState(EMPTY_CHALLENGE_HEAD_TO_HEAD);
  const [challengeHeadToHeadLoading, setChallengeHeadToHeadLoading] = useState(false);
  const [showChallengeHeadToHead, setShowChallengeHeadToHead] = useState(false);
  const actionsMenuButtonRef = useRef(null);

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

  const loadData = useCallback(async () => {
    if (!matchId) return;

    try {
      setLoading(true);
      const matchRow = await getTeamMatchById(matchId);
      setMatch(matchRow);
      syncFormWithMatch(matchRow);
      await loadMembersForMatch(matchRow);
    } catch (error) {
      notifyBlockingError(error.message || 'No se pudo cargar el partido');
    } finally {
      setLoading(false);
    }
  }, [loadMembersForMatch, matchId, syncFormWithMatch]);

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

  const currentUserTeamId = useMemo(() => {
    const teamAId = match?.team_a_id ? String(match.team_a_id) : null;
    const teamBId = match?.team_b_id ? String(match.team_b_id) : null;
    const userId = user?.id ? String(user.id) : null;
    if (!teamAId || !teamBId) return null;
    if (!userId) return teamAId;

    const membersA = teamMembersByTeamId[teamAId] || [];
    const membersB = teamMembersByTeamId[teamBId] || [];
    const inA = membersA.some((member) => String(member?.user_id || member?.jugador?.usuario_id || '') === userId);
    const inB = membersB.some((member) => String(member?.user_id || member?.jugador?.usuario_id || '') === userId);
    if (inA && !inB) return teamAId;
    if (inB && !inA) return teamBId;

    if (String(match?.team_a?.owner_user_id || '') === userId) return teamAId;
    if (String(match?.team_b?.owner_user_id || '') === userId) return teamBId;

    return teamAId;
  }, [
    match?.team_a?.owner_user_id,
    match?.team_a_id,
    match?.team_b?.owner_user_id,
    match?.team_b_id,
    teamMembersByTeamId,
    user?.id,
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
    [rosterTeamId, teamMembersByTeamId],
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
              <div className="rounded-2xl border border-white/15 bg-[#1e293b]/65 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-oswald uppercase tracking-wide ${getOriginBadgeClass(match?.origin_type)}`}>
                      <Flag size={12} /> {match?.origin_type === 'challenge' ? 'Desafio' : 'Amistoso'}
                    </span>
                    <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-[11px] font-oswald uppercase tracking-wide ${getStatusBadgeClass(match?.status)}`}>
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
                            className="fixed z-[9999] w-48 rounded-xl border border-slate-700 bg-slate-900 shadow-lg"
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

                <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-3 sm:items-center">
                  <TeamCardLocked
                    team={match?.team_a}
                    fallbackName="Equipo A"
                    members={teamMembersByTeamId[match?.team_a_id] || []}
                    onOpenProfile={setSelectedPlayerProfile}
                    onOpenRoster={() => setRosterTeamId(match?.team_a_id)}
                  />
                  <div className="flex items-center justify-center gap-2 text-white/75 text-sm sm:text-base font-oswald font-semibold tracking-[0.12em]">
                    <span className="h-2 w-2 rounded-full bg-[#7c3aed]/80" />
                    <span>VS</span>
                    <span className="h-2 w-2 rounded-full bg-[#38bdf8]/80" />
                  </div>
                  <TeamCardLocked
                    team={match?.team_b}
                    fallbackName="Equipo B"
                    members={teamMembersByTeamId[match?.team_b_id] || []}
                    onOpenProfile={setSelectedPlayerProfile}
                    onOpenRoster={() => setRosterTeamId(match?.team_b_id)}
                  />
                </div>
              </div>

              {isChallengeMatch && showChallengeHeadToHead ? (
                <div className="mt-2 h-16 rounded-2xl border border-white/10 bg-white/[0.04] px-[14px] py-[10px]">
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
              className="h-11 rounded-xl text-[16px] font-oswald font-semibold tracking-[0.01em] !normal-case"
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="team-match-edit-form"
              className="h-11 rounded-xl text-[16px] font-oswald font-semibold tracking-[0.01em] !normal-case"
              loading={saving}
              loadingText="Guardando..."
              disabled={saving}
            >
              Guardar cambios
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
