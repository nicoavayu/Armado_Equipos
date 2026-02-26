import { parseLocalDateTime } from './dateLocal';
import { resolveMatchInviteRoute } from './matchInviteRoute';
import { quoteMatchName, resolveNotificationTeamName, resolveTeamInviteActorName } from './notificationText';
import { getSurveyRemainingLabel, resolveSurveyDeadlineAt } from './surveyNotificationCopy';

const ACTIVITY_MAX_ITEMS = 5;
const INSIGHT_TTL_MS = 24 * 60 * 60 * 1000;

const RELEVANT_TYPES = new Set([
  'survey_start',
  'post_match_survey',
  'call_to_vote',
  'survey_results_ready',
  'awards_ready',
  'match_join_request',
  'match_join_approved',
  'match_invite',
  'team_invite',
  'challenge_accepted',
  'team_match_created',
  'match_update',
  'match_today',
  'falta_jugadores',
  'friend_request',
  'friend_accepted',
]);

const FEED_TEMPLATE_TYPES = new Set([
  'survey_start',
  'call_to_vote',
  'awards_ready',
  'match_join_request',
  'match_join_approved',
  'match_invite',
  'team_invite',
  'challenge_accepted',
  'team_match_created',
  'match_player_joined',
  'match_player_left',
  'friend_request',
  'friend_accepted',
]);

const PRIORITY = {
  survey_start: 10,
  call_to_vote: 10,
  awards_ready: 12,
  match_join_request: 14,
  match_today: 16,
  falta_jugadores: 18,
  team_invite: 22,
  match_complete: 22,
  match_join_approved: 24,
  match_invite: 24,
  match_player_joined: 26,
  match_player_left: 27,
  friend_request: 28,
  friend_accepted: 30,
  challenge_accepted: 18,
  team_match_created: 18,
  match_tomorrow: 34,
  insight_weekly_matches: 40,
};

const severityForType = (type) => {
  if (['match_today', 'falta_jugadores', 'call_to_vote', 'survey_start'].includes(type)) return 'urgent';
  if (['match_join_request', 'match_invite', 'team_invite', 'match_player_joined', 'match_player_left', 'friend_request', 'match_tomorrow', 'challenge_accepted', 'team_match_created'].includes(type)) return 'warning';
  if (['awards_ready', 'match_complete', 'match_join_approved', 'friend_accepted'].includes(type)) return 'success';
  return 'neutral';
};

const resolveMatchUpdateTemplateType = (message = '') => {
  const msg = String(message || '').toLowerCase();
  if (!msg) return null;

  if (
    msg.includes(' se unio')
    || msg.includes(' se unió')
    || msg.includes(' se sumo')
    || msg.includes(' se sumó')
    || msg.includes(' agregado')
    || msg.includes(' agrego')
    || msg.includes(' agregó')
  ) {
    return 'match_player_joined';
  }

  if (
    msg.includes(' se bajo')
    || msg.includes(' se bajó')
    || msg.includes(' salio')
    || msg.includes(' salió')
    || msg.includes(' fue removido')
    || msg.includes(' abandon')
    || msg.includes(' baja')
  ) {
    return 'match_player_left';
  }

  return null;
};

const normalizeType = (type, message = '') => {
  if (type === 'survey_start' || type === 'post_match_survey') return 'survey_start';
  if (type === 'survey_results_ready' || type === 'awards_ready') return 'awards_ready';
  if (type === 'match_update') return resolveMatchUpdateTemplateType(message);
  return type;
};

export const resolveNotificationMatchId = (notification) => (
  notification?.data?.team_match_id
  ?? notification?.data?.teamMatchId
  ?? notification?.partido_id
  ?? notification?.data?.match_id
  ?? notification?.data?.matchId
  ?? notification?.data?.partido_id
  ?? notification?.data?.partidoId
  ?? notification?.match_ref
  ?? null
);

const formatMatchDate = (match) => {
  if (!match?.fecha) return '';
  const dt = parseLocalDateTime(match.fecha, match.hora);
  if (!dt) return '';
  return dt.toLocaleString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
};

const getMatchDisplayName = (match, fallback = 'Partido') => (
  match?.nombre
  || match?.titulo
  || match?.name
  || match?.sede
  || fallback
);

const normalizeTeamLabel = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalized = raw.toLowerCase();
  const genericTeamLabels = new Set([
    'equipo a',
    'equipo b',
    'tu equipo',
    'equipo rival',
    'el equipo rival',
    'rival',
  ]);

  if (genericTeamLabels.has(normalized)) return '';
  return raw;
};

const extractChallengeTeamsFromMessage = (message = '') => {
  const raw = String(message || '').trim();
  if (!raw) return { teamA: '', teamB: '' };

  // Example: "El desafio entre napoli y maturana fue aceptado."
  const betweenMatch = raw.match(/entre\s+(.+?)\s+y\s+(.+?)\s+fue\s+aceptado/i);
  if (betweenMatch) {
    return {
      teamA: normalizeTeamLabel(betweenMatch[1]),
      teamB: normalizeTeamLabel(betweenMatch[2]),
    };
  }

  // Example: "Confirmaste napoli para enfrentar a maturana."
  const versusMatch = raw.match(/confirmaste\s+(.+?)\s+para enfrentar a\s+(.+?)(?:\.|$)/i);
  if (versusMatch) {
    return {
      teamA: normalizeTeamLabel(versusMatch[1]),
      teamB: normalizeTeamLabel(versusMatch[2]),
    };
  }

  return { teamA: '', teamB: '' };
};

const resolveChallengeTeamNames = (notification) => {
  const data = notification?.data || {};
  const teamAFromData = normalizeTeamLabel(
    data?.team_a_name
    || data?.challenger_team_name
    || data?.home_team_name
    || '',
  );
  const teamBFromData = normalizeTeamLabel(
    data?.team_b_name
    || data?.accepted_team_name
    || data?.away_team_name
    || '',
  );

  if (teamAFromData && teamBFromData) {
    return { teamA: teamAFromData, teamB: teamBFromData };
  }

  const fromMessage = extractChallengeTeamsFromMessage(notification?.message || '');
  return {
    teamA: teamAFromData || fromMessage.teamA || '',
    teamB: teamBFromData || fromMessage.teamB || '',
  };
};

const routeForMatch = ({ matchId, matchCode, currentUserId, match }) => {
  if (!matchId) return null;
  if (match?.source_type === 'team_match') return `/quiero-jugar/equipos/partidos/${matchId}`;
  if (matchCode) return `/votar-equipos?codigo=${encodeURIComponent(matchCode)}`;
  if (match?.creado_por && currentUserId && String(match.creado_por) === String(currentUserId)) {
    return `/admin/${matchId}`;
  }
  return `/partido-publico/${matchId}`;
};

const INSIGHT_STORAGE_KEY = 'activity_insight_weekly_matches_v1';
const stripEmojis = (text = '') => String(text).replace(/[\p{Extended_Pictographic}\u2600-\u27BF]/gu, '').trim();

const normalizeSpaces = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const compactText = (value = '', maxChars = 42, fallback = '') => {
  const normalized = normalizeSpaces(stripEmojis(value));
  if (!normalized) return fallback;
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
};

const compactMatchName = (value, fallback = 'Partido') => compactText(value, 34, fallback);
const hasUsableMatchName = (value) => {
  const normalized = normalizeSpaces(String(value || '')).toLowerCase();
  return Boolean(normalized) && normalized !== 'partido';
};
const getQuotedMatchLabel = (matchName) => (
  hasUsableMatchName(matchName)
    ? quoteMatchName(matchName, 'este partido')
    : null
);

const resolveFriendActorName = (notification) => {
  const data = notification?.data || {};
  const fromData = [
    data?.from_name,
    data?.sender_name,
    data?.requester_name,
    data?.player_name,
    data?.nombre,
  ].find(Boolean);
  if (fromData) return compactText(fromData, 30, '');

  const rawTitle = normalizeSpaces(stripEmojis(notification?.title || ''));
  const rawMessage = normalizeSpaces(stripEmojis(notification?.message || ''));
  const titleMatch = rawTitle.match(/^(.+?)\s+te/i);
  if (titleMatch?.[1]) return compactText(titleMatch[1], 30, '');
  const messageMatch = rawMessage.match(/^(.+?)\s+te/i);
  if (messageMatch?.[1]) return compactText(messageMatch[1], 30, '');
  return '';
};

const normalizeMatchPlayerMessage = (rawMessage = '') => {
  const cleaned = stripEmojis(rawMessage);
  if (!cleaned) return '';

  // Common format in logs/notifications: "<partido>: <jugador> se unió al partido ..."
  const prefixed = cleaned.match(/^[^:]+:\s*(.+)$/);
  if (prefixed?.[1]) {
    return prefixed[1].trim();
  }

  return cleaned;
};

const resolvePlayerNameFromMatchUpdate = (notification) => {
  const data = notification?.data || {};
  const fromData = [
    data?.player_name,
    data?.playerName,
    data?.jugador_nombre,
    data?.usuario_nombre,
    data?.display_name,
  ].find(Boolean);

  if (fromData) return compactText(fromData, 30, '');

  const normalized = normalizeMatchPlayerMessage(notification?.message || '');
  if (!normalized) return '';

  const directNameMatch = normalized.match(/^(.+?)\s+se\s+(?:unio|unió|sumo|sumó|agrego|agregó|bajo|bajó|retiro|retiró|fue)/i);
  if (directNameMatch?.[1]) return compactText(directNameMatch[1], 30, '');

  const inverseNameMatch = normalized.match(/^se\s+(?:unio|unió|sumo|sumó|agrego|agregó|bajo|bajó)\s+(.+?)(?:\s+al partido|$)/i);
  if (inverseNameMatch?.[1]) return compactText(inverseNameMatch[1], 30, '');

  return '';
};

const buildWeeklyInsightItem = async ({ currentUserId, supabaseClient }) => {
  if (!currentUserId || !supabaseClient || typeof window === 'undefined') return null;

  const now = Date.now();
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(INSIGHT_STORAGE_KEY) || 'null');
  } catch (_) {
    stored = null;
  }

  const monday = new Date();
  const day = monday.getDay();
  const diff = day === 0 ? 6 : day - 1;
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  const weekStart = monday.toISOString().split('T')[0];

  try {
    const { data: jugadoresRows, error: jugadoresError } = await supabaseClient
      .from('jugadores')
      .select('partido_id')
      .eq('usuario_id', currentUserId);
    if (jugadoresError) throw jugadoresError;

    const partidoIds = [...new Set((jugadoresRows || []).map((r) => Number(r.partido_id)).filter(Boolean))];
    if (!partidoIds.length) return null;

    const { data: partidosRows, error: partidosError } = await supabaseClient
      .from('partidos')
      .select('id,estado,fecha')
      .in('id', partidoIds)
      .in('estado', ['finalizado', 'completed'])
      .gte('fecha', weekStart);
    if (partidosError) throw partidosError;

    const weeklyCount = (partidosRows || []).length;
    if (weeklyCount <= 0) return null;

    const hasValidStored = stored && stored.expiresAt && new Date(stored.expiresAt).getTime() > now;
    const shouldRefresh = !hasValidStored || Number(stored.weeklyCount || 0) !== weeklyCount;
    const payload = shouldRefresh
      ? {
        weeklyCount,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(now + INSIGHT_TTL_MS).toISOString(),
      }
      : stored;

    if (shouldRefresh) {
      try { localStorage.setItem(INSIGHT_STORAGE_KEY, JSON.stringify(payload)); } catch (_) { /* ignore */ }
    }

    if (!payload?.expiresAt || new Date(payload.expiresAt).getTime() <= now) return null;

    return {
      id: 'activity-insight-weekly-matches',
      type: 'insight_weekly_matches',
      title: `Jugaste ${payload.weeklyCount} partido${payload.weeklyCount > 1 ? 's' : ''} esta semana`,
      subtitle: 'Resumen semanal de actividad',
      createdAt: payload.createdAt,
      icon: 'Activity',
      route: '/stats',
      count: 1,
      priority: PRIORITY.insight_weekly_matches,
      severity: severityForType('insight_weekly_matches'),
    };
  } catch (error) {
    console.error('[ACTIVITY_FEED] weekly insight failed:', error);
    return null;
  }
};

const toActivityFromNotification = (group, match, currentUserId) => {
  const { notification, count, type } = group;
  if (!FEED_TEMPLATE_TYPES.has(type)) return null;

  const partidoId = resolveNotificationMatchId(notification);
  const teamMatchId = notification?.data?.team_match_id || notification?.data?.teamMatchId || null;
  const numericMatchId = Number(partidoId);
  const resolvedPartidoId = Number.isFinite(numericMatchId) && numericMatchId > 0 ? numericMatchId : undefined;
  const notificationMatchName = notification?.data?.match_name || notification?.data?.partido_nombre || null;
  const matchName = compactMatchName(getMatchDisplayName(match, notificationMatchName || 'Partido'), 'Partido');
  const quotedMatchName = getQuotedMatchLabel(matchName);
  const dateLabel = formatMatchDate(match);
  const createdAt = notification?.created_at || new Date().toISOString();
  const fallbackSubtitle = dateLabel || matchName;
  const matchRoute = routeForMatch({ matchId: resolvedPartidoId || partidoId, currentUserId, match });

  const base = {
    id: `activity-${type}-${partidoId ?? notification?.id}`,
    type,
    partidoId: resolvedPartidoId,
    createdAt,
    count,
    route: null,
    icon: 'Bell',
    title: '',
    subtitle: fallbackSubtitle,
    priority: PRIORITY[type] ?? 99,
    severity: severityForType(type),
  };

  if (type === 'survey_start') {
    const surveySubtitle = getSurveyRemainingLabel(resolveSurveyDeadlineAt(notification));
    const surveyTitle = quotedMatchName
      ? `Encuesta disponible para ${quotedMatchName}`
      : 'Encuesta disponible';
    return {
      ...base,
      icon: 'ClipboardList',
      title: surveyTitle,
      subtitle: compactText(surveySubtitle || matchName, 46, 'Completá tu encuesta'),
      route: partidoId ? `/encuesta/${partidoId}` : '/notifications',
    };
  }

  if (type === 'call_to_vote') {
    const votingTitle = quotedMatchName
      ? `Votación abierta para ${quotedMatchName}`
      : 'Votación abierta';
    return {
      ...base,
      icon: 'Vote',
      title: votingTitle,
      subtitle: fallbackSubtitle,
      route: notification?.data?.matchCode
        ? `/votar-equipos?codigo=${encodeURIComponent(notification.data.matchCode)}`
        : (partidoId ? `/votar-equipos?partidoId=${partidoId}` : '/notifications'),
    };
  }

  if (type === 'awards_ready') {
    const awardsTitle = quotedMatchName
      ? `Premiación lista para ${quotedMatchName}`
      : 'Premiación lista';
    return {
      ...base,
      icon: 'Trophy',
      title: awardsTitle,
      subtitle: fallbackSubtitle,
      route: partidoId ? `/resultados-encuesta/${partidoId}?showAwards=1` : '/notifications',
    };
  }

  if (type === 'match_join_request') {
    const requestTitle = quotedMatchName
      ? `Solicitud pendiente para ${quotedMatchName}`
      : 'Solicitud pendiente';
    return {
      ...base,
      icon: 'UserPlus',
      title: requestTitle,
      subtitle: fallbackSubtitle,
      route: partidoId ? `/admin/${partidoId}?tab=solicitudes` : '/notifications',
    };
  }

  if (type === 'match_join_approved') {
    const approvedTitle = quotedMatchName
      ? `Solicitud aprobada para ${quotedMatchName}`
      : 'Solicitud aprobada';
    return {
      ...base,
      icon: 'CheckCircle',
      title: approvedTitle,
      subtitle: fallbackSubtitle,
      route: matchRoute || '/notifications',
    };
  }

  if (type === 'match_invite') {
    const inviteRoute = resolveMatchInviteRoute(notification);
    const inviteTitle = quotedMatchName
      ? `Invitación a ${quotedMatchName}`
      : 'Invitación a partido';
    return {
      ...base,
      icon: 'CalendarClock',
      title: inviteTitle,
      subtitle: fallbackSubtitle,
      route: inviteRoute || '/notifications',
    };
  }

  if (type === 'team_invite') {
    const actorName = compactText(resolveTeamInviteActorName(notification), 30, '');
    const teamName = compactText(resolveNotificationTeamName(notification, 'Equipo'), 24, 'Equipo');
    return {
      ...base,
      icon: 'Users',
      title: `Invitación al equipo ${quoteMatchName(teamName, 'Equipo')}`,
      subtitle: actorName || 'Tenés una invitación pendiente',
      route: '/quiero-jugar',
    };
  }

  if (type === 'match_player_joined' || type === 'match_player_left') {
    const playerName = resolvePlayerNameFromMatchUpdate(notification);
    const notificationLink = notification?.data?.link || null;
    const joinedTitle = quotedMatchName
      ? `Se sumó un jugador a ${quotedMatchName}`
      : 'Se sumó un jugador';
    const leftTitle = quotedMatchName
      ? `Se bajó un jugador de ${quotedMatchName}`
      : 'Se bajó un jugador';
    return {
      ...base,
      icon: 'Users',
      title: type === 'match_player_joined'
        ? joinedTitle
        : leftTitle,
      subtitle: playerName || fallbackSubtitle,
      route: notificationLink || matchRoute || '/notifications',
    };
  }

  if (type === 'challenge_accepted' || type === 'team_match_created') {
    const { teamA, teamB } = resolveChallengeTeamNames(notification);
    const compactTeamA = compactText(teamA, 20, '');
    const compactTeamB = compactText(teamB, 20, '');
    const teamsLabel = compactTeamA && compactTeamB ? `${compactTeamA} vs ${compactTeamB}` : '';

    return {
      ...base,
      icon: 'CalendarClock',
      title: 'Desafío aceptado',
      subtitle: teamsLabel || fallbackSubtitle,
      route: teamMatchId ? `/quiero-jugar/equipos/partidos/${teamMatchId}` : (matchRoute || '/quiero-jugar'),
    };
  }

  if (type === 'friend_request') {
    const actorName = resolveFriendActorName(notification);
    return {
      ...base,
      icon: 'UserPlus',
      title: 'Nueva solicitud de amistad',
      subtitle: actorName || 'Abrí Amigos para responder',
      route: '/amigos',
    };
  }

  if (type === 'friend_accepted') {
    const actorName = resolveFriendActorName(notification);
    return {
      ...base,
      icon: 'CheckCircle',
      title: 'Solicitud de amistad aceptada',
      subtitle: actorName || 'Ya pueden jugar juntos',
      route: '/amigos',
    };
  }

  return null;
};

const buildActiveMatchItems = (activeMatches = [], currentUserId) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return activeMatches.reduce((acc, match) => {
    if (match?.source_type === 'team_match') return acc;
    const matchDate = parseLocalDateTime(match?.fecha, match?.hora);
    if (!matchDate) return acc;

    const startOfMatch = new Date(matchDate.getFullYear(), matchDate.getMonth(), matchDate.getDate());
    const dayDiff = Math.round((startOfMatch.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
    const isToday = dayDiff === 0;
    const isTomorrow = dayDiff === 1;
    if (!isToday && !isTomorrow) return acc;

    const name = compactMatchName(getMatchDisplayName(match, 'Partido'), 'Partido');
    const dateLabel = formatMatchDate(match);
    const route = routeForMatch({ matchId: match.id, currentUserId, match });
    const playerCount = Number(match?.jugadores?.[0]?.count || 0);
    const capacity = Number(match?.cupo_jugadores || 10);
    const missing = Math.max(capacity - playerCount, 0);

    acc.push({
      id: `activity-${isToday ? 'match_today' : 'match_tomorrow'}-${match.id}`,
      type: isToday ? 'match_today' : 'match_tomorrow',
      partidoId: Number(match.id),
      title: isToday ? 'Partido de hoy' : 'Partido de mañana',
      subtitle: dateLabel || name,
      createdAt: matchDate.toISOString(),
      icon: 'CalendarClock',
      route,
      count: 1,
      priority: isToday ? PRIORITY.match_today : PRIORITY.match_tomorrow,
      severity: severityForType(isToday ? 'match_today' : 'match_tomorrow'),
    });

    if (missing > 0) {
      acc.push({
        id: `activity-falta_jugadores-${match.id}`,
        type: 'falta_jugadores',
        partidoId: Number(match.id),
        title: `Faltan ${missing} jugador${missing > 1 ? 'es' : ''}`,
        subtitle: `${playerCount}/${capacity} confirmados`,
        createdAt: matchDate.toISOString(),
        icon: 'AlertTriangle',
        route,
        count: 1,
        priority: PRIORITY.falta_jugadores,
        severity: severityForType('falta_jugadores'),
      });
    } else {
      acc.push({
        id: `activity-match_complete-${match.id}`,
        type: 'match_complete',
        partidoId: Number(match.id),
        title: `${name} completo`,
        subtitle: `${playerCount}/${capacity} confirmados`,
        createdAt: matchDate.toISOString(),
        icon: 'Users',
        route,
        count: 1,
        priority: PRIORITY.match_complete,
        severity: severityForType('match_complete'),
      });
    }

    return acc;
  }, []);
};

const shouldIncludeNotification = (notification, normalizedType) => {
  if (!notification) return false;
  const ts = notification?.created_at ? new Date(notification.created_at).getTime() : 0;
  if (!ts) return false;

  const ageMs = Date.now() - ts;
  const isSurveyLike = normalizedType === 'survey_start' || normalizedType === 'call_to_vote' || normalizedType === 'awards_ready';

  if (isSurveyLike) {
    // For survey/premios, keep the feed actionable: show only unread and recent.
    if (notification.read) return false;
    return ageMs <= 24 * 60 * 60 * 1000;
  }

  if (normalizedType === 'match_join_request') {
    // Join requests are operationally important for admins.
    // Keep unread requests visible for longer so they don't disappear from "Actividad reciente".
    if (!notification.read) return ageMs <= 7 * 24 * 60 * 60 * 1000;
    return ageMs <= 72 * 60 * 60 * 1000;
  }

  if (normalizedType === 'team_invite') {
    // Team invites are user-actionable and should remain visible longer while pending.
    if (!notification.read) return ageMs <= 7 * 24 * 60 * 60 * 1000;
    return ageMs <= 72 * 60 * 60 * 1000;
  }

  // For other activity types, allow read rows too but only for a short window
  // so the card doesn't stay empty and still stays current.
  return ageMs <= 48 * 60 * 60 * 1000;
};

const groupNotifications = (notifications = []) => {
  const groups = new Map();
  for (const notification of notifications) {
    if (!RELEVANT_TYPES.has(notification?.type)) continue;

    const type = normalizeType(notification.type, notification.message);
    if (!type || !FEED_TEMPLATE_TYPES.has(type)) continue;
    if (!shouldIncludeNotification(notification, type)) continue;

    const createdAtTs = notification?.created_at ? new Date(notification.created_at).getTime() : 0;
    const matchId = resolveNotificationMatchId(notification);
    const groupKey = `${type}::${matchId ?? 'none'}`;
    const current = groups.get(groupKey);
    if (!current) {
      groups.set(groupKey, {
        type,
        matchId: matchId ? Number(matchId) : null,
        notification,
        count: 1,
      });
      continue;
    }
    const currentTs = current.notification?.created_at ? new Date(current.notification.created_at).getTime() : 0;
    if (createdAtTs >= currentTs) current.notification = notification;
    current.count += 1;
  }
  return [...groups.values()];
};

const fetchMissingMatches = async ({ groups, activeMatchMap, supabaseClient }) => {
  const missingIds = [...new Set(groups
    .map((g) => g.matchId)
    .filter((id) => id && !activeMatchMap.has(Number(id))))];
  if (missingIds.length === 0 || !supabaseClient) return new Map();

  try {
    const { data, error } = await supabaseClient
      .from('partidos')
      .select('id,nombre,fecha,hora,sede,creado_por,cupo_jugadores,estado')
      .in('id', missingIds);
    if (error) throw error;

    const map = new Map();
    (data || []).forEach((match) => map.set(Number(match.id), match));
    return map;
  } catch (error) {
    console.error('[ACTIVITY_FEED] match enrichment failed:', error);
    return new Map();
  }
};

const fetchCompletedActionsByMatch = async ({ groups, currentUserId, supabaseClient }) => {
  const empty = { votedMatchIds: new Set(), surveyedMatchIds: new Set() };
  if (!currentUserId || !supabaseClient) return empty;

  const actionableGroups = (groups || []).filter(
    (g) => g?.matchId && (g.type === 'call_to_vote' || g.type === 'survey_start'),
  );
  if (actionableGroups.length === 0) return empty;

  const matchIds = [...new Set(actionableGroups.map((g) => Number(g.matchId)).filter(Boolean))];
  if (!matchIds.length) return empty;

  const votedMatchIds = new Set();
  const surveyedMatchIds = new Set();

  try {
    const { data: votesRows, error: votesError } = await supabaseClient
      .from('votos')
      .select('partido_id')
      .eq('votante_id', currentUserId)
      .in('partido_id', matchIds);
    if (votesError) throw votesError;
    (votesRows || []).forEach((row) => {
      const pid = Number(row?.partido_id);
      if (pid) votedMatchIds.add(pid);
    });
  } catch (error) {
    console.error('[ACTIVITY_FEED] failed to resolve completed votes:', error);
  }

  try {
    const { data: playerRows, error: playerError } = await supabaseClient
      .from('jugadores')
      .select('id,partido_id')
      .eq('usuario_id', currentUserId)
      .in('partido_id', matchIds);
    if (playerError) throw playerError;

    const playerIds = (playerRows || []).map((row) => Number(row?.id)).filter(Boolean);
    if (playerIds.length > 0) {
      const { data: surveyRows, error: surveyError } = await supabaseClient
        .from('post_match_surveys')
        .select('partido_id,votante_id')
        .in('partido_id', matchIds)
        .in('votante_id', playerIds);
      if (surveyError) throw surveyError;
      (surveyRows || []).forEach((row) => {
        const pid = Number(row?.partido_id);
        if (pid) surveyedMatchIds.add(pid);
      });
    }
  } catch (error) {
    console.error('[ACTIVITY_FEED] failed to resolve completed surveys:', error);
  }

  return { votedMatchIds, surveyedMatchIds };
};

export const buildActivityFeed = async (notifications = [], options = {}) => {
  const { activeMatches = [], currentUserId = null, supabaseClient = null } = options;
  const activeMatchMap = new Map(
    (activeMatches || [])
      .map((match) => [Number(match.id), match])
      .filter(([id]) => Number.isFinite(id) && id > 0),
  );

  const activeMatchItems = buildActiveMatchItems(activeMatches, currentUserId);
  const groups = groupNotifications(notifications);
  const completedActions = await fetchCompletedActionsByMatch({ groups, currentUserId, supabaseClient });
  const pendingGroups = groups.filter((group) => {
    const pid = Number(group?.matchId || 0);
    if (!pid) return true;
    if (group.type === 'call_to_vote' && completedActions.votedMatchIds.has(pid)) return false;
    if (group.type === 'survey_start' && completedActions.surveyedMatchIds.has(pid)) return false;
    return true;
  });
  const fetchedMatchMap = await fetchMissingMatches({ groups: pendingGroups, activeMatchMap, supabaseClient });

  const notificationItems = pendingGroups
    .map((group) => {
      const match = group.matchId ? (activeMatchMap.get(Number(group.matchId)) || fetchedMatchMap.get(Number(group.matchId))) : null;
      return toActivityFromNotification(group, match, currentUserId);
    })
    .filter(Boolean)
    .filter((item) => Boolean(item.route));

  const weeklyInsight = await buildWeeklyInsightItem({ currentUserId, supabaseClient });

  const merged = [...activeMatchItems, ...notificationItems, ...(weeklyInsight ? [weeklyInsight] : [])];
  merged.sort((a, b) => {
    const byPriority = (a.priority ?? 99) - (b.priority ?? 99);
    if (byPriority !== 0) return byPriority;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const seen = new Set();
  const deduped = [];
  let lastType = null;
  for (const item of merged) {
    const key = `${item.type}::${item.partidoId ?? item.route}`;
    if (seen.has(key)) continue;
    if (lastType === item.type) continue;
    seen.add(key);
    deduped.push(item);
    lastType = item.type;
    if (deduped.length >= ACTIVITY_MAX_ITEMS) break;
  }

  return deduped.map(({ priority, ...rest }) => rest);
};
