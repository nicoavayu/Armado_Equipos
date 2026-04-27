import { supabase } from '../supabase';
import { logger } from '../lib/logger';
import { getResultsUrl } from './routes';
import { resolveMatchInviteRoute } from './matchInviteRoute';
import { isSurveyNotificationClosed } from './surveyNotificationCopy';
import { resolveSurveyAccess } from './surveyAccess';
import { parseLocalDateTime } from './dateLocal';
import { isSurveyReminderActionRequired } from './surveyReminderEligibility';
import { normalizeAwardsStatus } from './awardsReadiness';
import {
  buildTeamChallengeRoute,
  extractNotificationMatchId,
  isSurveyFormNotificationType,
  isTeamChallengeNotification,
  resolveTeamChallengeRouteFromMatchId,
} from './notificationRoutes';

const isSafeInternalPath = (path) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
const isSurveyPath = (path) => /^\/encuesta\/[^/?#]+(?:\?.*)?$/i.test(path);
const isLegacySurveyPath = (path) => /^\/partidos\/([^/]+)\/encuesta(\?.*)?$/i.test(path);

const normalizeSurveyLink = (rawLink, matchId) => {
  const fallback = matchId ? `/encuesta/${matchId}` : null;
  if (!rawLink) return fallback;

  const link = String(rawLink || '').trim();
  if (!link) return fallback;
  if (!isSafeInternalPath(link)) return fallback;
  if (isSurveyPath(link)) return link;

  // Legacy routes used /partidos/:id/encuesta; app route is /encuesta/:id.
  if (isLegacySurveyPath(link)) {
    const normalized = link.replace(
      /^\/partidos\/([^/]+)\/encuesta(\?.*)?$/i,
      '/encuesta/$1$2',
    );
    return normalized || fallback;
  }

  return fallback;
};

export const resolveSurveyNotificationRoute = (notification = {}) => {
  const matchId = extractNotificationMatchId(notification);
  const deepLink = notification?.deep_link
    || notification?.deepLink
    || notification?.data?.deep_link
    || notification?.data?.deepLink
    || notification?.data?.link
    || null;

  return normalizeSurveyLink(deepLink, matchId);
};

const RESULTS_NOTIFICATION_TYPES = new Set([
  'survey_results',
  'survey_results_ready',
]);

const AWARDS_NOTIFICATION_TYPES = new Set([
  'awards_ready',
  'award_won',
]);

const SURVEY_REMINDER_NOTIFICATION_TYPES = new Set([
  'survey_reminder',
  'survey_reminder_12h',
]);

const CONSULTABLE_NOTIFICATION_TYPES = new Set([
  ...RESULTS_NOTIFICATION_TYPES,
  ...AWARDS_NOTIFICATION_TYPES,
  'survey_finished',
]);

const MATCH_OPERATIONAL_NOTIFICATION_TYPES = new Set([
  'call_to_vote',
  'pre_match_vote',
  'match_invite',
  'match_join_request',
  'match_join_approved',
  'match_update',
  'match_player_joined',
  'match_player_left',
  'match_today',
  'match_tomorrow',
  'falta_jugadores',
]);

const CLOSED_MATCH_STATUS_TOKENS = new Set([
  'finalizado',
  'finished',
  'cancelado',
  'cancelled',
  'canceled',
  'deleted',
  'eliminado',
  'suspendido',
  'suspended',
]);

const CLOSED_RESULT_STATUS_TOKENS = new Set([
  'finished',
  'draw',
  'not_played',
  'cancelled',
  'cancelado',
  'no_jugado',
  'walkover',
  'forfeit',
]);

const OPERATIONAL_ACTION_EXPIRY_GRACE_MS = 6 * 60 * 60 * 1000;
const LIFECYCLE_CACHE_TTL_MS = 60 * 1000;

const lifecycleCacheByMatchId = new Map();

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const REMINDER_TYPE_TOKENS = new Set([
  '1h_before_deadline',
  '12h_before_deadline',
]);

const isClosedSurveyResultsNotificationType = (type) => (
  RESULTS_NOTIFICATION_TYPES.has(type) || type === 'survey_finished'
);

const toMillis = (value) => {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const parseIsoDateTimeCandidate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseLocalDateTimeCandidate = (dateValue, timeValue) => {
  const parsed = parseLocalDateTime(dateValue, timeValue);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const extractMatchIdFromPath = (rawPath) => {
  const path = String(rawPath || '').trim();
  if (!path) return null;
  const match = path.match(/\/(?:admin|partido-publico|partido|encuesta|resultados-encuesta|votar-equipos)\/(\d+)/i);
  return match?.[1] || null;
};

const extractLifecycleMatchId = (notification = {}) => {
  const data = notification?.data || {};
  const candidate = (
    notification?.partido_id
    || data?.partido_id
    || data?.partidoId
    || data?.match_id
    || data?.matchId
    || notification?.match_id
    || notification?.match_ref
    || notification?.target_params?.partido_id
    || extractMatchIdFromPath(data?.link || data?.resultsUrl || notification?.deep_link || notification?.deepLink || null)
    || null
  );
  if (candidate === null || candidate === undefined) return null;
  const normalized = String(candidate).trim();
  if (!/^\d+$/.test(normalized)) return null;
  return normalized;
};

const resolveOperationalReferenceStartAt = (notification = {}, partidoRow = null) => {
  const rowLocal = parseLocalDateTimeCandidate(partidoRow?.fecha || null, partidoRow?.hora || null);
  if (rowLocal) return rowLocal;

  const data = notification?.data || {};
  const localFromNotification = parseLocalDateTimeCandidate(
    data?.fecha || data?.match_date || data?.partido_fecha || null,
    data?.hora || data?.match_time || data?.partido_hora || null,
  );
  if (localFromNotification) return localFromNotification;

  const isoCandidate = (
    partidoRow?.scheduled_at
    || partidoRow?.start_at
    || data?.scheduled_at
    || data?.match_start_at
    || data?.match_starts_at
    || data?.starts_at
    || data?.start_at
    || null
  );
  return parseIsoDateTimeCandidate(isoCandidate);
};

export const isSurveyReminderLikeNotification = (notification = {}) => {
  const type = normalizeToken(notification?.type);
  if (SURVEY_REMINDER_NOTIFICATION_TYPES.has(type)) return true;

  const data = notification?.data || {};
  const reminderTypeToken = normalizeToken(data?.reminder_type || data?.reminderType);
  if (REMINDER_TYPE_TOKENS.has(reminderTypeToken)) return true;

  const title = normalizeToken(notification?.title);
  const message = normalizeToken(notification?.message);
  const hasReminderCopy = (
    title.includes('recordatorio')
    || message.includes('recordatorio')
  ) && (
    title.includes('encuesta')
    || message.includes('encuesta')
  );
  if (!hasReminderCopy) return false;

  const deepLink = notification?.deep_link
    || notification?.deepLink
    || data?.deep_link
    || data?.deepLink
    || data?.link
    || null;
  const normalizedLink = normalizeSurveyLink(deepLink, extractNotificationMatchId(notification));
  return Boolean(normalizedLink);
};

export const shouldTreatNotificationAsSurveyForm = (notification = {}) => (
  isSurveyFormNotificationType(notification) || isSurveyReminderLikeNotification(notification)
);

const getCachedLifecycleRow = (matchId, nowMs) => {
  const cacheEntry = lifecycleCacheByMatchId.get(matchId);
  if (!cacheEntry) return undefined;
  if ((nowMs - cacheEntry.at) > LIFECYCLE_CACHE_TTL_MS) {
    lifecycleCacheByMatchId.delete(matchId);
    return undefined;
  }
  return cacheEntry.row || null;
};

const setCachedLifecycleRow = (matchId, row, nowMs) => {
  lifecycleCacheByMatchId.set(matchId, {
    row: row || null,
    at: nowMs,
  });
};

const fetchMatchLifecycleRow = async ({ supabaseClient, matchId, nowMs }) => {
  if (!supabaseClient || !matchId) return null;
  const cached = getCachedLifecycleRow(matchId, nowMs);
  if (cached !== undefined) return cached;

  try {
    const { data, error } = await supabaseClient
      .from('partidos')
      .select('id, fecha, hora, estado, survey_status, survey_closes_at, result_status, awards_status, finished_at')
      .eq('id', matchId)
      .maybeSingle();
    if (error) return null;
    setCachedLifecycleRow(matchId, data || null, nowMs);
    return data || null;
  } catch (_error) {
    return null;
  }
};

export const isMatchOperationalNotificationType = (notificationOrType = {}) => {
  const type = normalizeToken(
    typeof notificationOrType === 'string'
      ? notificationOrType
      : notificationOrType?.type,
  );
  return MATCH_OPERATIONAL_NOTIFICATION_TYPES.has(type);
};

export const resolveNotificationActionability = async ({
  notification = {},
  supabaseClient = supabase,
  nowMs = Date.now(),
} = {}) => {
  const type = normalizeToken(notification?.type);
  const reminderLike = isSurveyReminderLikeNotification(notification);
  const matchId = extractLifecycleMatchId(notification);
  const partidoRow = matchId
    ? await fetchMatchLifecycleRow({
      supabaseClient,
      matchId,
      nowMs,
    })
    : null;

  if (!type) {
    return {
      isActionable: true,
      reason: 'missing_type',
      message: '',
      matchId,
    };
  }

  if (reminderLike) {
    const reminderActionRequired = isSurveyReminderActionRequired({
      surveyStatus: partidoRow?.survey_status || notification?.data?.survey_status || notification?.data?.surveyStatus,
      resultStatus: partidoRow?.result_status || notification?.data?.result_status,
      matchStatus: partidoRow?.estado || notification?.data?.estado,
      surveyClosesAt: partidoRow?.survey_closes_at || notification?.data?.survey_deadline_at || notification?.data?.survey_closes_at,
      nowMs,
    });

    if (!reminderActionRequired) {
      return {
        isActionable: false,
        reason: 'survey_reminder_stale',
        message: 'Esta encuesta ya cerró y esta notificación de recordatorio ya no tiene acciones disponibles.',
        matchId,
      };
    }
  }

  if (isClosedSurveyResultsNotificationType(type)) {
    const awardsStatus = normalizeAwardsStatus(
      partidoRow?.awards_status
      || notification?.data?.awards_status
      || notification?.data?.awardsStatus,
    );

    if (awardsStatus === 'not_eligible') {
      return {
        isActionable: false,
        reason: 'survey_results_not_eligible',
        message: 'Esta encuesta cerró sin premios por falta de votos y esta notificación ya no tiene una vista disponible.',
        matchId,
      };
    }
  }

  if (CONSULTABLE_NOTIFICATION_TYPES.has(type)) {
    return {
      isActionable: true,
      reason: 'consultable_notification',
      message: '',
      matchId,
    };
  }

  if (!MATCH_OPERATIONAL_NOTIFICATION_TYPES.has(type)) {
    return {
      isActionable: true,
      reason: 'non_operational_notification',
      message: '',
      matchId,
    };
  }

  if (!matchId) {
    return {
      isActionable: true,
      reason: 'missing_match_id',
      message: '',
      matchId: null,
    };
  }

  const normalizedEstado = normalizeToken(partidoRow?.estado || notification?.data?.estado);
  if (CLOSED_MATCH_STATUS_TOKENS.has(normalizedEstado)) {
    return {
      isActionable: false,
      reason: 'match_finished',
      message: 'Este partido ya terminó y esta notificación ya no tiene acciones disponibles.',
      matchId,
    };
  }

  const normalizedResultStatus = normalizeToken(partidoRow?.result_status || notification?.data?.result_status);
  if (CLOSED_RESULT_STATUS_TOKENS.has(normalizedResultStatus)) {
    return {
      isActionable: false,
      reason: 'match_result_closed',
      message: 'Este partido ya terminó y esta notificación ya no tiene acciones disponibles.',
      matchId,
    };
  }

  const finishedAtMs = toMillis(partidoRow?.finished_at || notification?.data?.finished_at);
  if (finishedAtMs !== null && finishedAtMs <= nowMs) {
    return {
      isActionable: false,
      reason: 'match_finished_at',
      message: 'Este partido ya terminó y esta notificación ya no tiene acciones disponibles.',
      matchId,
    };
  }

  const referenceStartAt = resolveOperationalReferenceStartAt(notification, partidoRow);
  const referenceStartMs = toMillis(referenceStartAt);
  if (referenceStartMs !== null && nowMs >= (referenceStartMs + OPERATIONAL_ACTION_EXPIRY_GRACE_MS)) {
    return {
      isActionable: false,
      reason: 'operational_window_expired',
      message: 'Esta notificación ya no tiene acciones disponibles.',
      matchId,
    };
  }

  return {
    isActionable: true,
    reason: 'ok',
    message: '',
    matchId,
  };
};

export const stripShowAwardsParam = (rawPath) => {
  const path = String(rawPath || '').trim();
  if (!path) return path;

  // Use a dummy origin to parse internal routes safely.
  const parsed = new URL(path, 'https://local.app');
  parsed.searchParams.delete('showAwards');

  const search = parsed.searchParams.toString();
  return `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash || ''}`;
};

export const resolveSurveyNotificationNavigation = async ({
  notification = {},
  supabaseClient = supabase,
  userId = '',
} = {}) => {
  if (!shouldTreatNotificationAsSurveyForm(notification)) {
    return {
      canNavigate: false,
      route: null,
      reason: 'not_survey_notification',
      message: '',
    };
  }

  const matchId = extractNotificationMatchId(notification);
  if (!matchId) {
    return {
      canNavigate: false,
      route: null,
      reason: 'missing_match_id',
      message: 'No encontramos la encuesta de esta notificación.',
    };
  }

  const nowMs = Date.now();
  const partidoRow = await fetchMatchLifecycleRow({
    supabaseClient,
    matchId: String(matchId),
    nowMs,
  });

  const reminderLike = isSurveyReminderLikeNotification(notification);
  if (reminderLike) {
    const reminderActionRequired = isSurveyReminderActionRequired({
      surveyStatus: partidoRow?.survey_status || notification?.data?.survey_status || notification?.data?.surveyStatus,
      resultStatus: partidoRow?.result_status || notification?.data?.result_status,
      matchStatus: partidoRow?.estado || notification?.data?.estado,
      surveyClosesAt: partidoRow?.survey_closes_at || notification?.data?.survey_deadline_at || notification?.data?.survey_closes_at,
      nowMs,
    });

    if (!reminderActionRequired) {
      return {
        canNavigate: false,
        route: null,
        reason: 'survey_closed',
        message: 'Esta encuesta ya cerró y esta notificación de recordatorio ya no tiene acciones disponibles.',
      };
    }
  }

  if (isSurveyNotificationClosed(notification)) {
    return {
      canNavigate: false,
      route: null,
      reason: 'survey_closed',
      message: 'Esta encuesta ya cerró y no acepta más respuestas.',
    };
  }

  const normalizedUserId = String(userId || '').trim();
  if (supabaseClient && normalizedUserId) {
    const access = await resolveSurveyAccess({
      supabaseClient,
      matchId,
      userId: normalizedUserId,
    });

    if (!access.allowed) {
      return {
        canNavigate: false,
        route: null,
        reason: access.reason,
        message: access.message,
      };
    }
  }

  const route = resolveSurveyNotificationRoute(notification) || `/encuesta/${matchId}`;
  if (!route) {
    return {
      canNavigate: false,
      route: null,
      reason: 'missing_route',
      message: 'No encontramos la encuesta de esta notificación.',
    };
  }

  return {
    canNavigate: true,
    route,
    reason: 'ok',
    message: '',
  };
};

export async function openNotification(n, navigate, options = {}) {
  try {
    const type = n?.type;
    const matchId = extractNotificationMatchId(n);

    // Prefer explicit deep links and fallback to the canonical survey route.
    const deepLink = n?.deep_link
      || n?.deepLink
      || n?.data?.deep_link
      || n?.data?.deepLink
      || n?.data?.link
      || null;

    logger.log('[openNotification] opening notification', { id: n?.id, type, matchId, deepLink });

    if (!type) return;

    // Mark as read before navigation (best-effort)
    (async () => {
      try {
        await supabase.from('notifications').update({ read: true, status: 'sent' }).eq('id', n.id);
      } catch (err) {
        // ignore errors for best-effort marking
      }
    })();

    if (isTeamChallengeNotification(n)) {
      navigate(buildTeamChallengeRoute(n));
      return;
    }

    if (shouldTreatNotificationAsSurveyForm(n)) {
      const surveyNavigation = await resolveSurveyNotificationNavigation({
        notification: n,
        supabaseClient: options?.supabaseClient || supabase,
        userId: options?.userId || '',
      });

      if (!surveyNavigation.canNavigate) {
        logger.log('[openNotification] survey navigation blocked', {
          matchId,
          notificationId: n?.id,
          reason: surveyNavigation.reason,
        });
        return;
      }

      logger.log('[openNotification] navigating to survey link', { surveyLink: surveyNavigation.route });
      if (surveyNavigation.route) navigate(surveyNavigation.route);
      return;
    }

    const actionability = await resolveNotificationActionability({
      notification: n,
      supabaseClient: options?.supabaseClient || supabase,
    });
    if (!actionability.isActionable) {
      options?.onActionBlocked?.(actionability);
      return;
    }

    if (!matchId) return;

    if (RESULTS_NOTIFICATION_TYPES.has(type)) {
      const base = n?.data?.resultsUrl || n?.data?.link || getResultsUrl(Number(matchId)) || `/resultados-encuesta/${matchId}`;
      navigate(stripShowAwardsParam(base));
      return;
    }

    if (AWARDS_NOTIFICATION_TYPES.has(type)) {
      // Prefer explicit resultsUrl
      const base = n?.data?.resultsUrl || n?.data?.link || getResultsUrl(Number(matchId)) || `/resultados-encuesta/${matchId}`;
      // Ensure showAwards=1 is in query so legacy pages open awards section
      const url = base.includes('?') ? `${base}&showAwards=1` : `${base}?showAwards=1`;
      // Pass navigation state to force awards computation on the destination
      navigate(url, {
        state: {
          fromNotification: true,
          forceAwards: true,
          matchName: n?.data?.match_name || n?.data?.partido_nombre || null,
        },
      });
      return;
    }

    if (type === 'survey_finished') {
      const base = n?.data?.resultsUrl || n?.data?.link || getResultsUrl(Number(matchId)) || `/resultados-encuesta/${matchId}`;
      navigate(base);
      return;
    }

    if (type === 'match_join_request') {
      if (deepLink) {
        navigate(deepLink);
      } else {
        navigate(`/admin/${matchId}?tab=solicitudes`);
      }
      return;
    }

    if (type === 'match_join_approved') {
      if (deepLink) {
        navigate(deepLink);
      } else {
        navigate(`/partido-publico/${matchId}`);
      }
      return;
    }

    if (type === 'match_kicked') {
      // Informative only.
      return;
    }

    if (type === 'match_cancelled') {
      // Informative only.
      return;
    }

    if (type === 'match_invite') {
      const inviteStatus = String(n?.data?.status || 'pending').trim().toLowerCase();
      if (inviteStatus !== 'pending' || n?.read === true) {
        return;
      }

      const challengeRouteFromMatchId = await resolveTeamChallengeRouteFromMatchId({
        supabaseClient: supabase,
        matchId,
      });
      if (challengeRouteFromMatchId) {
        navigate(challengeRouteFromMatchId);
        return;
      }

      const inviteRoute = resolveMatchInviteRoute(n);
      if (inviteRoute) {
        navigate(inviteRoute);
      } else {
        navigate(`/partido-publico/${matchId}`);
      }
      return;
    }

    if (type === 'team_invite') {
      navigate('/desafios?tab=mis-equipos');
      return;
    }

    if (type === 'team_captain_transfer') {
      const teamId = n?.data?.team_id || n?.data?.teamId || null;
      if (teamId) {
        navigate(`/desafios/equipos/${teamId}`);
      } else {
        navigate('/desafios');
      }
      return;
    }

    // default: home
    navigate('/');
  } catch (e) {
    logger.error('openNotification failed', e);
  }
}
