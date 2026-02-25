import { parseLocalDateTime } from './dateLocal';
import { resolveMatchInviteRoute } from './matchInviteRoute';
import { getSurveyRemainingLabel, resolveSurveyDeadlineAt } from './surveyNotificationCopy';

const ACTIVITY_MAX_ITEMS = 5;
const MATCH_META_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
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
  'challenge_accepted',
  'team_match_created',
  'match_update',
  'match_today',
  'falta_jugadores',
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
  match_complete: 22,
  match_join_approved: 24,
  match_invite: 24,
  match_player_update: 26,
  friend_request: 28,
  friend_accepted: 30,
  challenge_accepted: 18,
  team_match_created: 18,
  match_tomorrow: 34,
  insight_weekly_matches: 40,
};

const severityForType = (type) => {
  if (['match_today', 'falta_jugadores', 'call_to_vote', 'survey_start'].includes(type)) return 'urgent';
  if (['match_join_request', 'match_invite', 'match_player_update', 'friend_request', 'match_tomorrow', 'challenge_accepted', 'team_match_created'].includes(type)) return 'warning';
  if (['awards_ready', 'match_complete', 'match_join_approved', 'friend_accepted'].includes(type)) return 'success';
  return 'neutral';
};

const normalizeType = (type, message = '') => {
  const msg = String(message || '').toLowerCase();
  if (type === 'survey_start' || type === 'post_match_survey') return 'survey_start';
  if (type === 'survey_results_ready' || type === 'awards_ready') return 'awards_ready';
  if (type === 'match_update') {
    if (msg.includes('sum') || msg.includes('agreg')) return 'match_player_update';
    if (msg.includes('baj') || msg.includes('sali') || msg.includes('fue removido')) return 'match_player_update';
    return 'match_player_update';
  }
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

const quoteMatchName = (value, fallback = 'Partido') => {
  const raw = String(value || fallback).trim().replace(/^"+|"+$/g, '');
  return `"${raw || fallback}"`;
};

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
  const partidoId = resolveNotificationMatchId(notification);
  const teamMatchId = notification?.data?.team_match_id || notification?.data?.teamMatchId || null;
  const numericMatchId = Number(partidoId);
  const resolvedPartidoId = Number.isFinite(numericMatchId) && numericMatchId > 0 ? numericMatchId : undefined;
  const dateLabel = formatMatchDate(match);
  const notificationMatchName = notification?.data?.match_name || notification?.data?.partido_nombre || null;
  const matchName = getMatchDisplayName(match, notificationMatchName || 'este partido');
  const quotedMatchName = quoteMatchName(matchName, 'este partido');
  const createdAt = notification?.created_at || new Date().toISOString();
  const fallbackSubtitle = dateLabel || 'Actividad reciente';
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
    return {
      ...base,
      icon: 'ClipboardList',
      title: `Completá la encuesta para ${quotedMatchName}`,
      subtitle: surveySubtitle || dateLabel || 'Completá tu encuesta del partido',
      route: partidoId ? `/encuesta/${partidoId}` : '/notifications',
    };
  }
  if (type === 'call_to_vote') {
    return {
      ...base,
      icon: 'Vote',
      title: `Votá y armá equipos para ${quotedMatchName}`,
      subtitle: dateLabel || 'Entrá para votar jugadores',
      route: notification?.data?.matchCode
        ? `/votar-equipos?codigo=${encodeURIComponent(notification.data.matchCode)}`
        : (partidoId ? `/votar-equipos?partidoId=${partidoId}` : '/notifications'),
    };
  }
  if (type === 'awards_ready') {
    return {
      ...base,
      icon: 'Trophy',
      title: `Premiación lista en ${quotedMatchName}`,
      subtitle: dateLabel || 'Ya podés ver los premios',
      route: partidoId ? `/resultados-encuesta/${partidoId}?showAwards=1` : '/notifications',
    };
  }
  if (type === 'match_join_request') {
    return {
      ...base,
      icon: 'UserPlus',
      title: `Solicitud pendiente en ${quotedMatchName}`,
      subtitle: dateLabel || 'Tenés un jugador esperando aprobación',
      route: partidoId ? `/admin/${partidoId}?tab=solicitudes` : '/notifications',
    };
  }
  if (type === 'match_join_approved') {
    return {
      ...base,
      icon: 'CheckCircle',
      title: `Solicitud aprobada en ${quotedMatchName}`,
      subtitle: dateLabel || 'Ya podés entrar al partido',
      route: matchRoute || '/notifications',
    };
  }
  if (type === 'match_invite') {
    const inviteRoute = resolveMatchInviteRoute(notification);
    return {
      ...base,
      icon: 'CalendarClock',
      title: `Recibiste una invitación a ${quotedMatchName}`,
      subtitle: dateLabel || 'Entrá para aceptar o rechazar la invitación',
      route: inviteRoute || '/notifications',
    };
  }
  if (type === 'match_player_update') {
    const playerFirstMessage = normalizeMatchPlayerMessage(notification?.message || 'Hubo un cambio de jugadores');
    const notificationLink = notification?.data?.link || null;
    return {
      ...base,
      icon: 'Users',
      title: playerFirstMessage || `Cambio de jugadores en ${quotedMatchName}`,
      subtitle: dateLabel || 'Revisá el estado del partido',
      route: notificationLink || matchRoute || '/notifications',
    };
  }
  if (type === 'challenge_accepted' || type === 'team_match_created') {
    const { teamA, teamB } = resolveChallengeTeamNames(notification);
    const hasBothTeams = Boolean(teamA && teamB);
    const title = hasBothTeams
      ? `Desafio aceptado: ${quoteMatchName(`${teamA} vs ${teamB}`, 'desafio')}`
      : 'Desafio aceptado';
    return {
      ...base,
      icon: 'CalendarClock',
      title,
      subtitle: dateLabel || '',
      route: teamMatchId ? `/quiero-jugar/equipos/partidos/${teamMatchId}` : '/quiero-jugar',
    };
  }
  if (type === 'friend_request') {
    return {
      ...base,
      icon: 'UserPlus',
      title: stripEmojis(notification?.title || 'Nueva solicitud de amistad'),
      subtitle: stripEmojis(notification?.message || fallbackSubtitle),
      route: '/amigos',
    };
  }
  if (type === 'friend_accepted') {
    return {
      ...base,
      icon: 'CheckCircle',
      title: stripEmojis(notification?.title || 'Solicitud de amistad aceptada'),
      subtitle: stripEmojis(notification?.message || fallbackSubtitle),
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

    const name = getMatchDisplayName(match, 'tu partido');
    const quotedName = quoteMatchName(name, 'tu partido');
    const dateLabel = formatMatchDate(match);
    const route = routeForMatch({ matchId: match.id, currentUserId, match });
    const playerCount = Number(match?.jugadores?.[0]?.count || 0);
    const capacity = Number(match?.cupo_jugadores || 10);
    const missing = Math.max(capacity - playerCount, 0);

    acc.push({
      id: `activity-${isToday ? 'match_today' : 'match_tomorrow'}-${match.id}`,
      type: isToday ? 'match_today' : 'match_tomorrow',
      partidoId: Number(match.id),
      title: `${isToday ? 'Hoy' : 'Mañana'} jugás ${quotedName}`,
      subtitle: dateLabel || 'Revisá los detalles del partido',
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
        title: `Faltan ${missing} jugador${missing > 1 ? 'es' : ''} para ${quotedName}`,
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
        title: `${quotedName}: partido completo`,
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

  // For other activity types, allow read rows too but only for a short window
  // so the card doesn't stay empty and still stays current.
  return ageMs <= 48 * 60 * 60 * 1000;
};

const groupNotifications = (notifications = []) => {
  const groups = new Map();
  for (const notification of notifications) {
    if (!RELEVANT_TYPES.has(notification?.type)) continue;

    const type = normalizeType(notification.type, notification.message);
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
