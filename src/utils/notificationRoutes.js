import { resolveMatchInviteRoute } from './matchInviteRoute';
import { isSurveyDisabledForChallengeNotification } from './surveyChallengePolicy';

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

const ADMIN_AWARE_MATCH_NOTIFICATION_TYPES = new Set([
  'match_update',
  'match_player_joined',
  'match_player_left',
]);

export const CHALLENGE_RESULT_NOTIFICATION_TYPES = new Set([
  'challenge_result_survey',
  'challenge_result_pending',
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
      || extractNotificationMatchIdFromRoute(notification)
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
    || extractNotificationMatchIdFromRoute(notification)
    || null
  );
};

const isSafeInternalPath = (path) => {
  const raw = String(path || '').trim();
  if (!raw) return false;
  return raw.startsWith('/') && !raw.startsWith('//');
};

const AUTO_MATCH_NOTIFICATION_TYPES = new Set([
  'auto_match_gestating',
  'auto_match_almost_full',
  'auto_match_ready',
  'auto_match_organizing',
  'auto_match_created',
  'auto_match_cancelled',
  'auto_match_invite_expired',
  'auto_match_substitute_invite',
  'auto_match_substitute_joined',
  'auto_match_vacancy_reopened',
  'auto_match_waitlisted',
  'auto_match_starter_invite',
  'auto_match_promoted',
]);

// Tipos que abren el PARTIDO real (no la gestación): partido creado, promoción
// de suplente a titular y los avisos al organizador sobre el partido ya
// materializado. El destinatario ya forma parte del plantel (o lo será).
const AUTO_MATCH_MATCH_ROUTED_TYPES = new Set([
  'auto_match_created',
  'auto_match_substitute_joined',
  'auto_match_vacancy_reopened',
  'auto_match_promoted',
]);

// Invitación a un partido YA creado (vacante de titular o de suplente): abre la
// vista de invitación asociada al partido, nunca el detalle de la gestación
// (que ya se cerró). El proposal_id viaja solo para resolver la RPC de acepción.
const AUTO_MATCH_INVITE_ROUTED_TYPES = new Set([
  'auto_match_substitute_invite',
  'auto_match_starter_invite',
]);

export const isAutoMatchNotificationType = (notificationOrType = {}) => (
  AUTO_MATCH_NOTIFICATION_TYPES.has(normalizeNotificationType(notificationOrType))
);

// Gestación automática:
//  - "partido creado" / promoción / avisos del partido => partido real.
//  - invitación a un partido creado (suplente o titular) => vista de invitación
//    asociada al partido (?invite=), NO el detalle de la gestación.
//  - lista de espera => pantalla general (el usuario ya no es miembro).
//  - resto de las transiciones vivas => detalle de la gestación por proposal_id.
export const buildAutoMatchNotificationRoute = (notification = {}) => {
  const data = notification?.data || {};
  const type = normalizeNotificationType(notification);
  const matchId = data?.match_id || data?.matchId || data?.partido_id || notification?.partido_id || null;
  const link = String(data?.route || data?.link || '').trim();
  const safeLink = link && isSafeInternalPath(link) ? link : null;
  const proposalId = data?.proposal_id ?? data?.proposalId ?? null;
  const hasProposal = proposalId !== null && proposalId !== undefined && /^\d+$/.test(String(proposalId).trim());

  const isMatchRouted = AUTO_MATCH_MATCH_ROUTED_TYPES.has(type);
  if (isMatchRouted && matchId !== null && matchId !== undefined && /^\d+$/.test(String(matchId).trim())) {
    return `/partido-publico/${String(matchId).trim()}`;
  }
  if (isMatchRouted) return safeLink || '/quiero-jugar?auto=1';

  if (AUTO_MATCH_INVITE_ROUTED_TYPES.has(type)) {
    if (hasProposal) return `/quiero-jugar?auto=1&invite=${String(proposalId).trim()}`;
    return safeLink || '/quiero-jugar?auto=1';
  }

  // Lista de espera: el usuario quedó fuera del plantel, no se lo lleva a un
  // detalle de gestación cerrada.
  if (type === 'auto_match_waitlisted') return safeLink || '/quiero-jugar?auto=1';

  if (hasProposal) {
    return `/quiero-jugar?auto=1&proposal=${String(proposalId).trim()}`;
  }
  return safeLink || '/quiero-jugar?auto=1';
};

const extractMatchIdFromPath = (rawPath) => {
  const path = String(rawPath || '').trim();
  if (!path) return null;
  const match = path.match(/\/(?:admin|partido-publico|partido|encuesta|resultados-encuesta|votar-equipos|pagos)\/(\d+)/i);
  if (match?.[1]) return match[1];

  const queryMatch = path.match(/[?&](?:partidoId|partido_id|matchId|match_id)=(\d+)(?:&|$)/i);
  return queryMatch?.[1] || null;
};

function extractNotificationMatchIdFromRoute(notification = {}) {
  const data = notification?.data || {};
  const candidates = [
    data?.resultsUrl,
    data?.results_url,
    data?.action_url,
    data?.actionUrl,
    data?.link,
    data?.route,
    data?.url,
    data?.deep_link,
    data?.deepLink,
    notification?.action_url,
    notification?.actionUrl,
    notification?.deep_link,
    notification?.deepLink,
  ];

  for (const candidate of candidates) {
    if (!isSafeInternalPath(candidate)) continue;
    const matchId = extractMatchIdFromPath(candidate);
    if (matchId) return matchId;
  }

  return null;
}

export const isAdminAwareMatchNotificationType = (notificationOrType = {}) => (
  ADMIN_AWARE_MATCH_NOTIFICATION_TYPES.has(normalizeNotificationType(notificationOrType))
);

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

export const resolveAdminAwareNotificationRoute = async ({
  notification = {},
  fallbackRoute = null,
  supabaseClient = null,
  userId = null,
} = {}) => {
  const safeFallbackRoute = isSafeInternalPath(fallbackRoute) ? String(fallbackRoute).trim() : null;
  if (!isAdminAwareMatchNotificationType(notification)) {
    return safeFallbackRoute;
  }

  const resolvedMatchId = extractNotificationMatchId(notification) || extractMatchIdFromPath(safeFallbackRoute);
  return resolveAdminAwareMatchRoute({
    notification,
    matchId: resolvedMatchId,
    supabaseClient,
    userId,
  });
};

export const isTeamChallengeNotification = (notification = {}) => {
  const type = String(notification?.type || '').trim().toLowerCase();
  const data = notification?.data || {};
  const source = String(data?.source || '').trim().toLowerCase();
  const title = String(notification?.title || '').trim().toLowerCase();

  if (
    type === 'challenge_accepted'
    || type === 'team_match_created'
    || type === 'challenge_squad_open'
    || type === 'team_challenge_received'
    || type === 'team_challenge_accepted'
    || type === 'team_challenge_rejected'
    || CHALLENGE_RESULT_NOTIFICATION_TYPES.has(type)
  ) return true;
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
  const type = String(notification?.type || '').trim().toLowerCase();
  const action = String(notification?.data?.action || '').trim().toLowerCase();
  const teamMatchId = extractTeamMatchId(notification);
  if (teamMatchId !== null && teamMatchId !== undefined && String(teamMatchId).trim() !== '') {
    const route = `/desafios/equipos/partidos/${teamMatchId}`;
    if (type === 'challenge_result_conflict' || action === 'open_challenge_resolve_modal') {
      return `${route}?action=open_challenge_resolve_modal`;
    }
    if (CHALLENGE_RESULT_NOTIFICATION_TYPES.has(type) || action === 'open_challenge_result_modal') {
      return `${route}?action=open_challenge_result_modal`;
    }
    return route;
  }
  return '/desafios';
};

export const buildTeamInviteRoute = () => '/desafios?tab=mis-equipos';

export const buildNotificationFallbackRoute = (notification = {}, idMapper = (value) => value) => {
  const data = notification?.data || {};
  const type = String(notification?.type || '').trim().toLowerCase();
  const teamId = data?.team_id || data?.teamId || null;

  if (isSurveyDisabledForChallengeNotification(notification)) {
    return '/notifications';
  }

  if (isAutoMatchNotificationType(notification)) {
    return buildAutoMatchNotificationRoute(notification);
  }

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

  if (type === 'payment_reminder' || type === 'payment_reported') {
    const safeLink = isSafeInternalPath(data?.link) ? String(data.link).trim() : null;
    if (safeLink) return safeLink;
    const matchId = extractNotificationMatchId(notification);
    if (matchId !== null && matchId !== undefined && String(matchId).trim() !== '') {
      return `/pagos/${idMapper(matchId)}`;
    }
    return '/notifications';
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
    return buildTeamInviteRoute();
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
