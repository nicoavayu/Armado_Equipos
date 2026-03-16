import { resolveMatchInviteRoute } from './matchInviteRoute';

const SURVEY_FORM_NOTIFICATION_TYPES = new Set([
  'survey',
  'survey_start',
  'post_match_survey',
  'survey_reminder',
  'survey_reminder_12h',
]);

const SURVEY_RELATED_NOTIFICATION_TYPES = new Set([
  ...SURVEY_FORM_NOTIFICATION_TYPES,
  'survey_results_ready',
  'awards_ready',
  'award_won',
  'survey_finished',
]);

const normalizeNotificationType = (notificationOrType = {}) => {
  if (typeof notificationOrType === 'string') {
    return String(notificationOrType || '').trim().toLowerCase();
  }

  return String(notificationOrType?.type || '').trim().toLowerCase();
};

export const isSurveyFormNotificationType = (notificationOrType = {}) => (
  SURVEY_FORM_NOTIFICATION_TYPES.has(normalizeNotificationType(notificationOrType))
);

export const isSurveyRelatedNotificationType = (notificationOrType = {}) => (
  SURVEY_RELATED_NOTIFICATION_TYPES.has(normalizeNotificationType(notificationOrType))
);

export const extractNotificationMatchId = (notification = {}) => {
  const data = notification?.data || {};

  if (isSurveyRelatedNotificationType(notification)) {
    return (
      notification?.partido_id
      || data?.partido_id
      || data?.partidoId
      || data?.match_id
      || data?.matchId
      || notification?.match_id
      || notification?.match_ref
      || notification?.target_params?.partido_id
      || null
    );
  }

  return (
    data?.team_match_id
    || data?.teamMatchId
    || data?.match_id
    || data?.matchId
    || data?.partido_id
    || data?.partidoId
    || notification?.partido_id
    || notification?.match_id
    || notification?.match_ref
    || notification?.target_params?.partido_id
    || null
  );
};

const isSafeInternalPath = (path) => {
  const raw = String(path || '').trim();
  if (!raw) return false;
  return raw.startsWith('/') && !raw.startsWith('//');
};

export const resolveAdminAwareMatchRoute = async ({
  notification = {},
  matchId = null,
  supabaseClient = null,
  userId = null,
} = {}) => {
  const data = notification?.data || {};
  const normalizedMatchId = String(matchId ?? extractNotificationMatchId(notification) ?? '').trim();
  const normalizedUserId = String(userId || '').trim();

  const adminLinkCandidate = data?.admin_link || data?.adminLink || null;
  if (isSafeInternalPath(adminLinkCandidate)) {
    return String(adminLinkCandidate).trim();
  }

  const linkCandidate = data?.link || notification?.deep_link || notification?.deepLink || null;
  const safeLink = isSafeInternalPath(linkCandidate) ? String(linkCandidate).trim() : null;

  if (!normalizedMatchId) {
    return safeLink;
  }

  const adminRoute = `/admin/${normalizedMatchId}`;
  const publicRoute = `/partido-publico/${normalizedMatchId}`;

  if (!supabaseClient || !normalizedUserId) {
    return safeLink || publicRoute;
  }

  try {
    const { data: matchRow, error } = await supabaseClient
      .from('partidos')
      .select('creado_por')
      .eq('id', normalizedMatchId)
      .maybeSingle();

    if (!error && String(matchRow?.creado_por || '').trim() === normalizedUserId) {
      return adminRoute;
    }
  } catch (_error) {
    // Best-effort lookup: fall through to default routes.
  }

  return safeLink || publicRoute;
};

export const isTeamChallengeNotification = (notification = {}) => {
  const type = String(notification?.type || '').trim().toLowerCase();
  const data = notification?.data || {};
  const source = String(data?.source || '').trim().toLowerCase();
  const title = String(notification?.title || '').trim().toLowerCase();

  if (type === 'challenge_accepted' || type === 'team_match_created' || type === 'challenge_squad_open') return true;
  if (source === 'team_challenge') return true;
  if (data?.team_match_id || data?.teamMatchId || data?.challenge_id || data?.challengeId) return true;
  if (type === 'match_update' && title.includes('desafio aceptado')) return true;

  return false;
};

export const extractTeamMatchId = (notification = {}) => {
  const data = notification?.data || {};
  const explicitTeamMatchId = data?.team_match_id || data?.teamMatchId || null;
  if (explicitTeamMatchId !== null && explicitTeamMatchId !== undefined && String(explicitTeamMatchId).trim() !== '') {
    return explicitTeamMatchId;
  }

  const deepLink = data?.deep_link || data?.deepLink || data?.link || notification?.deep_link || notification?.deepLink || '';
  const linkMatch = String(deepLink).match(/\/desafios\/equipos\/partidos\/([^/?#]+)/i);
  if (linkMatch?.[1]) return linkMatch[1];

  return null;
};

export const buildTeamChallengeRoute = (notification = {}) => {
  const teamMatchId = extractTeamMatchId(notification);
  if (teamMatchId !== null && teamMatchId !== undefined && String(teamMatchId).trim() !== '') {
    return `/desafios/equipos/partidos/${teamMatchId}`;
  }
  return '/desafios';
};

export const buildNotificationFallbackRoute = (notification = {}, idMapper = (value) => value) => {
  const data = notification?.data || {};
  const type = String(notification?.type || '').trim().toLowerCase();
  const teamId = data?.team_id || data?.teamId || null;

  if (isSurveyFormNotificationType(type)) {
    const matchId = extractNotificationMatchId(notification);
    if (matchId === null || matchId === undefined || String(matchId).trim() === '') {
      return '/notifications';
    }
    return `/encuesta/${idMapper(matchId)}`;
  }

  if (isTeamChallengeNotification(notification)) {
    return buildTeamChallengeRoute(notification);
  }

  if (type === 'match_invite') {
    const inviteRoute = resolveMatchInviteRoute(notification);
    if (inviteRoute) return inviteRoute;
  }

  if (type === 'call_to_vote' || type === 'pre_match_vote') {
    const matchCode = String(data?.matchCode || data?.match_code || '').trim();
    if (matchCode) {
      return `/votar-equipos?codigo=${encodeURIComponent(matchCode)}`;
    }

    const matchId = extractNotificationMatchId(notification);
    if (matchId !== null && matchId !== undefined && String(matchId).trim() !== '') {
      return `/votar-equipos?partidoId=${idMapper(matchId)}`;
    }

    return '/notifications';
  }

  if (type === 'friend_request') {
    return '/amigos?tab=discover';
  }

  if (type === 'friend_accepted' || type === 'friend_rejected') {
    return '/amigos';
  }

  if (type === 'team_invite') {
    return '/desafios?tab=mis-equipos';
  }

  if (type === 'team_captain_transfer' && teamId) {
    return `/desafios/equipos/${teamId}`;
  }

  if (type === 'team_captain_transfer' || type === 'challenge_accepted' || type === 'team_match_created' || type === 'challenge_squad_open') {
    return '/desafios';
  }

  const matchId = extractNotificationMatchId(notification);
  if (matchId === null || matchId === undefined || matchId === '') {
    return '/quiero-jugar';
  }
  return `/partido-publico/${idMapper(matchId)}`;
};

export const resolveTeamChallengeRouteFromMatchId = async ({
  supabaseClient,
  matchId,
} = {}) => {
  const normalizedMatchId = String(matchId ?? '').trim();
  if (!supabaseClient || !normalizedMatchId) return null;

  try {
    const { data, error } = await supabaseClient
      .from('team_matches')
      .select('id')
      .eq('partido_id', normalizedMatchId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) return null;

    const teamMatchId = data?.[0]?.id || null;
    if (!teamMatchId) return null;
    return `/desafios/equipos/partidos/${teamMatchId}`;
  } catch (_error) {
    return null;
  }
};
