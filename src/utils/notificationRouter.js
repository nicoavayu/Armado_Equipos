import { supabase } from '../supabase';
import { logger } from '../lib/logger';
import { SURVEY_MIN_VOTERS_FOR_AWARDS } from '../config/surveyConfig';
import { getResultsUrl } from './routes';
import { resolveMatchInviteRoute } from './matchInviteRoute';
import { isSurveyNotificationClosed } from './surveyNotificationCopy';
import { resolveSurveyAccess } from './surveyAccess';
import { parseLocalDateTime } from './dateLocal';
import { isSurveyReminderActionRequired } from './surveyReminderEligibility';
import { awardsNotificationWindowMs } from './notificationRetentionPolicy';
import {
  AWARDS_STATUS_ERROR,
  AWARDS_STATUS_NOT_ELIGIBLE,
  hasAnyAwardData,
  normalizeAwardsStatus,
} from './awardsReadiness';
import {
  buildTeamChallengeRoute,
  CHALLENGE_RESULT_NOTIFICATION_TYPES,
  extractNotificationMatchId,
  extractTeamMatchId,
  isSurveyFormNotificationType,
  isTeamChallengeNotification,
  resolveTeamChallengeRouteFromMatchId,
} from './notificationRoutes';
import {
  SURVEY_CHALLENGE_DISABLED_MESSAGE,
  SURVEY_CHALLENGE_DISABLED_REASON,
  SURVEY_CHALLENGE_DISABLED_TITLE,
  buildSurveyChallengeDisabledNotice,
  fetchChallengeTeamMatchForPartido,
  isChallengeLikeTeamMatchRow,
  isSurveyDisabledForChallengeNotification,
  isSurveyRelatedNotificationType,
} from './surveyChallengePolicy';

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
  'equipos_formados',
  'teams_formed',
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

const NO_AWARDS_RESULT_STATUS_TOKENS = new Set([
  'not_played',
  'cancelled',
  'cancelado',
  'no_jugado',
  'walkover',
  'forfeit',
]);

const CLOSED_TEAM_MATCH_STATUS_TOKENS = new Set([
  'played',
  'cancelled',
  'canceled',
  'cancelado',
]);

const OPERATIONAL_ACTION_EXPIRY_GRACE_MS = 6 * 60 * 60 * 1000;
const LIFECYCLE_CACHE_TTL_MS = 60 * 1000;

const lifecycleCacheByMatchId = new Map();

const readNotificationDebugFlag = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem('arma2:debug:notifications') === '1';
  } catch (_error) {
    return false;
  }
};

const readNotificationPlatform = (platformOverride = '') => {
  if (platformOverride) return platformOverride;
  if (typeof window === 'undefined') return 'unknown';
  try {
    return window.Capacitor?.getPlatform?.() || 'web';
  } catch (_error) {
    return 'web';
  }
};

const isNotificationRouteDebugEnabled = () => (
  process.env.NODE_ENV !== 'production' || readNotificationDebugFlag()
);

const readCurrentRoute = () => {
  if (typeof window === 'undefined') return '';
  try {
    return `${window.location?.pathname || ''}${window.location?.search || ''}${window.location?.hash || ''}`;
  } catch (_error) {
    return '';
  }
};

export const debugNotificationEvent = (tag, payload = {}) => {
  if (!isNotificationRouteDebugEnabled()) return;
  const label = String(tag || '').startsWith('[') ? String(tag) : `[${tag}]`;
  console.debug(label, {
    ...payload,
    platform: readNotificationPlatform(payload?.platform),
    current_route: payload?.current_route || readCurrentRoute(),
    timestamp: new Date().toISOString(),
  });
};

export const debugNotificationRoute = (eventName, payload = {}) => {
  debugNotificationEvent('NOTIFICATION_ROUTE', {
    event: eventName,
    ...payload,
  });
};

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const REMINDER_TYPE_TOKENS = new Set([
  '1h_before_deadline',
  '12h_before_deadline',
]);

const toMillis = (value) => {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const resolveAwardsNotificationReferenceMs = (notification = {}, partidoRow = null) => (
  toMillis(notification?.send_at)
  ?? toMillis(notification?.created_at)
  ?? toMillis(partidoRow?.finished_at)
  ?? toMillis(partidoRow?.survey_closes_at)
  ?? null
);

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
  if (match?.[1]) return match[1];

  const queryMatch = path.match(/[?&](?:partidoId|partido_id|matchId|match_id)=(\d+)(?:&|$)/i);
  return queryMatch?.[1] || null;
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
    || extractMatchIdFromPath(
      data?.resultsUrl
      || data?.results_url
      || data?.action_url
      || data?.actionUrl
      || data?.link
      || data?.route
      || data?.url
      || data?.deep_link
      || data?.deepLink
      || notification?.action_url
      || notification?.actionUrl
      || notification?.deep_link
      || notification?.deepLink
      || null,
    )
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

const shouldOpenAsTeamChallenge = (notification = {}) => (
  isTeamChallengeNotification(notification)
  && !shouldTreatNotificationAsSurveyForm(notification)
  && !CONSULTABLE_NOTIFICATION_TYPES.has(normalizeToken(notification?.type))
);

const isChallengeResultNotificationType = (notificationOrType = {}) => {
  const type = normalizeToken(
    typeof notificationOrType === 'string'
      ? notificationOrType
      : notificationOrType?.type,
  );
  return CHALLENGE_RESULT_NOTIFICATION_TYPES.has(type);
};

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
      .select('id, fecha, hora, estado, survey_status, survey_closes_at, survey_expected_voters, result_status, awards_status, finished_at')
      .eq('id', matchId)
      .maybeSingle();
    if (error) return null;
    setCachedLifecycleRow(matchId, data || null, nowMs);
    return data || null;
  } catch (_error) {
    return null;
  }
};

const fetchSurveyResultsRow = async ({ supabaseClient, matchId }) => {
  if (!supabaseClient || !matchId) return null;

  try {
    const { data, error } = await supabaseClient
      .from('survey_results')
      .select('*')
      .eq('partido_id', matchId)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch (_error) {
    return null;
  }
};

const buildAwardsUnavailableNotice = ({ partidoRow = null, surveyResultsRow = null } = {}) => {
  const normalizedAwardsStatus = normalizeAwardsStatus(
    surveyResultsRow?.awards_status ?? partidoRow?.awards_status,
  );
  const normalizedResultStatus = normalizeToken(
    surveyResultsRow?.result_status ?? partidoRow?.result_status,
  );
  const expectedVoters = Number(partidoRow?.survey_expected_voters);

  if (NO_AWARDS_RESULT_STATUS_TOKENS.has(normalizedResultStatus)) {
    return {
      title: 'Premiación no disponible',
      message: 'Este partido figura como no jugado, por eso no hay premiación final.',
    };
  }

  if (normalizedAwardsStatus === AWARDS_STATUS_NOT_ELIGIBLE) {
    if (
      Number.isFinite(expectedVoters)
      && expectedVoters >= 0
      && expectedVoters < Number(SURVEY_MIN_VOTERS_FOR_AWARDS)
    ) {
      return {
        title: 'Premiación no disponible',
        message: 'No hubo suficientes votos para calcular la premiación final de este partido.',
      };
    }

    return {
      title: 'Premiación no disponible',
      message: 'No corresponde mostrar una premiación final para este partido.',
    };
  }

  if (normalizedAwardsStatus === AWARDS_STATUS_ERROR) {
    return {
      title: 'Premiación no disponible',
      message: 'No pudimos resolver la premiación final de este partido.',
    };
  }

  return {
    title: 'Premiación no disponible',
    message: 'La premiación final no está disponible para este partido.',
  };
};

const resolveSurveyChallengeDisabledNotice = async ({
  notification = {},
  matchId = null,
  supabaseClient = supabase,
} = {}) => {
  if (!isSurveyRelatedNotificationType(notification)) return null;

  if (isSurveyDisabledForChallengeNotification(notification)) {
    return buildSurveyChallengeDisabledNotice({
      matchId: matchId || extractNotificationMatchId(notification) || null,
      teamMatchId: extractTeamMatchId(notification) || null,
      source: 'notification_metadata',
    });
  }

  const normalizedMatchId = String(matchId ?? extractNotificationMatchId(notification) ?? '').trim();
  if (!normalizedMatchId) return null;

  const teamMatchRow = await fetchChallengeTeamMatchForPartido({
    supabaseClient,
    partidoId: normalizedMatchId,
  });
  if (!isChallengeLikeTeamMatchRow(teamMatchRow)) return null;

  return buildSurveyChallengeDisabledNotice({
    matchId: normalizedMatchId,
    teamMatchId: teamMatchRow?.id || null,
    source: 'team_matches_lookup',
  });
};

export const resolveResultsNotificationEntry = async ({
  notification = {},
  supabaseClient = supabase,
  nowMs = Date.now(),
} = {}) => {
  const matchId = extractLifecycleMatchId(notification);
  const awardsTarget = buildAwardsResultsNavigationTarget(notification, matchId);

  if (!matchId) {
    return {
      kind: 'modal',
      ...buildAwardsUnavailableNotice(),
      route: null,
      state: null,
      matchId: null,
    };
  }

  const challengeDisabled = await resolveSurveyChallengeDisabledNotice({
    notification,
    matchId,
    supabaseClient,
  });
  if (challengeDisabled) {
    return {
      kind: 'modal',
      title: SURVEY_CHALLENGE_DISABLED_TITLE,
      message: SURVEY_CHALLENGE_DISABLED_MESSAGE,
      route: null,
      state: null,
      matchId,
      reason: SURVEY_CHALLENGE_DISABLED_REASON,
    };
  }

  const [partidoRow, surveyResultsRow] = await Promise.all([
    fetchMatchLifecycleRow({
      supabaseClient,
      matchId,
      nowMs,
    }),
    fetchSurveyResultsRow({
      supabaseClient,
      matchId,
    }),
  ]);

  const hasRenderableAwardsStory = hasAnyAwardData(surveyResultsRow);
  if (hasRenderableAwardsStory && awardsTarget.route) {
    return {
      kind: 'navigate',
      route: awardsTarget.route,
      state: awardsTarget.state,
      matchId,
    };
  }

  return {
    kind: 'modal',
    ...buildAwardsUnavailableNotice({
      partidoRow,
      surveyResultsRow,
    }),
    route: null,
    state: null,
    matchId,
  };
};

const fetchTeamMatchLifecycleRow = async ({ supabaseClient, teamMatchId }) => {
  if (!supabaseClient || !teamMatchId) return null;

  try {
    let response = await supabaseClient
      .from('team_matches')
      .select('id, status, scheduled_at, partido_id, result_status, result_confirmed, result_conflict')
      .eq('id', teamMatchId)
      .maybeSingle();
    if (response.error) {
      response = await supabaseClient
        .from('team_matches')
        .select('id, status, scheduled_at, partido_id, result_status')
        .eq('id', teamMatchId)
        .maybeSingle();
    }
    if (response.error) return null;
    return response.data || null;
  } catch (_error) {
    return null;
  }
};

const resolveTeamChallengeNotificationActionability = async ({
  notification = {},
  supabaseClient = supabase,
  nowMs = Date.now(),
} = {}) => {
  const teamMatchId = extractTeamMatchId(notification);
  if (!teamMatchId) {
    return {
      isActionable: true,
      reason: 'missing_team_match_id',
      message: '',
      teamMatchId: null,
    };
  }

  const teamMatchRow = await fetchTeamMatchLifecycleRow({
    supabaseClient,
    teamMatchId,
  });
  if (!teamMatchRow) {
    return {
      isActionable: true,
      reason: 'team_match_not_found',
      message: '',
      teamMatchId,
    };
  }

  const normalizedTeamMatchStatus = normalizeToken(teamMatchRow?.status);

  if (normalizeToken(notification?.type) === 'challenge_result_conflict') {
    if (teamMatchRow?.result_conflict) {
      return {
        isActionable: true,
        reason: 'challenge_result_conflict_pending',
        message: '',
        teamMatchId,
      };
    }
    return {
      isActionable: false,
      reason: 'challenge_result_conflict_resolved',
      message: 'Este resultado ya fue resuelto.',
      teamMatchId,
    };
  }

  if (isChallengeResultNotificationType(notification)) {
    const normalizedResultStatus = normalizeToken(teamMatchRow?.result_status);
    const resultConfirmed = Object.prototype.hasOwnProperty.call(teamMatchRow || {}, 'result_confirmed')
      ? teamMatchRow?.result_confirmed === true
      : ['team_a_win', 'team_b_win', 'draw'].includes(normalizedResultStatus);
    if (teamMatchRow?.result_conflict || resultConfirmed) {
      return {
        isActionable: false,
        reason: teamMatchRow?.result_conflict ? 'challenge_result_conflict' : 'challenge_result_already_reported',
        message: teamMatchRow?.result_conflict
          ? 'Este resultado quedo en conflicto.'
          : 'Este resultado ya fue respondido.',
        teamMatchId,
      };
    }

    if (['cancelled', 'canceled', 'cancelado'].includes(normalizedTeamMatchStatus)) {
      return {
        isActionable: false,
        reason: 'team_match_cancelled',
        message: 'Este desafío fue cancelado.',
        teamMatchId,
      };
    }

    return {
      isActionable: true,
      reason: 'challenge_result_pending',
      message: '',
      teamMatchId,
    };
  }

  if (CLOSED_TEAM_MATCH_STATUS_TOKENS.has(normalizedTeamMatchStatus)) {
    return {
      isActionable: false,
      reason: 'team_match_closed',
      message: 'Este desafío ya no tiene acciones disponibles desde esta notificación.',
      teamMatchId,
    };
  }

  const scheduledAtMs = toMillis(teamMatchRow?.scheduled_at);
  if (scheduledAtMs !== null && scheduledAtMs <= nowMs) {
    return {
      isActionable: false,
      reason: 'team_match_past',
      message: 'Este desafío ya pasó y esta notificación ya no tiene acciones disponibles.',
      teamMatchId,
    };
  }

  const linkedMatchId = teamMatchRow?.partido_id ? String(teamMatchRow.partido_id).trim() : '';
  if (!linkedMatchId) {
    return {
      isActionable: true,
      reason: 'ok',
      message: '',
      teamMatchId,
    };
  }

  const partidoRow = await fetchMatchLifecycleRow({
    supabaseClient,
    matchId: linkedMatchId,
    nowMs,
  });
  if (!partidoRow) {
    return {
      isActionable: true,
      reason: 'ok',
      message: '',
      teamMatchId,
    };
  }

  const normalizedEstado = normalizeToken(partidoRow?.estado);
  if (CLOSED_MATCH_STATUS_TOKENS.has(normalizedEstado)) {
    return {
      isActionable: false,
      reason: 'linked_partido_closed',
      message: 'Este desafío ya terminó y esta notificación ya no tiene acciones disponibles.',
      teamMatchId,
    };
  }

  const normalizedResultStatus = normalizeToken(partidoRow?.result_status);
  if (CLOSED_RESULT_STATUS_TOKENS.has(normalizedResultStatus)) {
    return {
      isActionable: false,
      reason: 'linked_partido_result_closed',
      message: 'Este desafío ya terminó y esta notificación ya no tiene acciones disponibles.',
      teamMatchId,
    };
  }

  const finishedAtMs = toMillis(partidoRow?.finished_at);
  if (finishedAtMs !== null && finishedAtMs <= nowMs) {
    return {
      isActionable: false,
      reason: 'linked_partido_finished_at',
      message: 'Este desafío ya terminó y esta notificación ya no tiene acciones disponibles.',
      teamMatchId,
    };
  }

  return {
    isActionable: true,
    reason: 'ok',
    message: '',
    teamMatchId,
  };
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

  const challengeDisabled = await resolveSurveyChallengeDisabledNotice({
    notification,
    matchId,
    supabaseClient,
  });
  if (challengeDisabled) {
    return {
      isActionable: false,
      reason: challengeDisabled.reason,
      message: challengeDisabled.message,
      title: challengeDisabled.title,
      matchId,
      teamMatchId: challengeDisabled.teamMatchId || null,
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

  if (AWARDS_NOTIFICATION_TYPES.has(type)) {
    const referenceMs = resolveAwardsNotificationReferenceMs(notification, partidoRow);
    if (referenceMs === null || (nowMs - referenceMs) > awardsNotificationWindowMs) {
      return {
        isActionable: false,
        reason: 'awards_notification_expired',
        message: 'Estos premios ya no están disponibles desde esta notificación.',
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

export const withShowAwardsParam = (rawPath) => {
  const path = String(rawPath || '').trim();
  if (!path) return path;

  const parsed = new URL(path, 'https://local.app');
  parsed.searchParams.set('showAwards', '1');

  const search = parsed.searchParams.toString();
  return `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash || ''}`;
};

export const buildAwardsResultsNavigationTarget = (notification = {}, fallbackMatchId = null) => {
  const matchId = String(fallbackMatchId ?? extractNotificationMatchId(notification) ?? '').trim();
  const base = notification?.data?.resultsUrl
    || notification?.data?.results_url
    || notification?.data?.action_url
    || notification?.data?.actionUrl
    || notification?.data?.link
    || (matchId ? getResultsUrl(Number(matchId)) : null)
    || (matchId ? `/resultados-encuesta/${matchId}` : null);

  return {
    route: withShowAwardsParam(base),
    state: {
      forceAwards: true,
      fromNotification: true,
      matchName: notification?.data?.match_name || notification?.data?.partido_nombre || null,
    },
  };
};

export const buildResultsNavigationTarget = (notification = {}, fallbackMatchId = null) => {
  const matchId = String(fallbackMatchId ?? extractNotificationMatchId(notification) ?? '').trim();
  const base = notification?.data?.resultsUrl
    || notification?.data?.results_url
    || notification?.data?.action_url
    || notification?.data?.actionUrl
    || notification?.data?.link
    || (matchId ? getResultsUrl(Number(matchId)) : null)
    || (matchId ? `/resultados-encuesta/${matchId}` : null);

  return {
    route: stripShowAwardsParam(base),
    state: {
      fromNotification: true,
      matchName: notification?.data?.match_name || notification?.data?.partido_nombre || null,
    },
  };
};

const isCanonicalSurveyClosed = ({ partidoRow = null, nowMs = Date.now() } = {}) => {
  const normalizedSurveyStatus = normalizeToken(partidoRow?.survey_status);
  const normalizedResultStatus = normalizeToken(partidoRow?.result_status);
  const surveyClosesAtMs = toMillis(partidoRow?.survey_closes_at);

  if (normalizedSurveyStatus === 'closed') return true;
  if (CLOSED_RESULT_STATUS_TOKENS.has(normalizedResultStatus)) return true;
  if (surveyClosesAtMs !== null && surveyClosesAtMs <= nowMs) return true;
  return false;
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

  const challengeDisabled = await resolveSurveyChallengeDisabledNotice({
    notification,
    matchId,
    supabaseClient,
  });
  if (challengeDisabled) {
    return {
      canNavigate: false,
      route: null,
      reason: challengeDisabled.reason,
      title: challengeDisabled.title,
      message: challengeDisabled.message,
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

  if (partidoRow && isCanonicalSurveyClosed({ partidoRow, nowMs })) {
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

  if (!partidoRow && !normalizedUserId && isSurveyNotificationClosed(notification)) {
    return {
      canNavigate: false,
      route: null,
      reason: 'survey_closed',
      message: 'Esta encuesta ya cerró y no acepta más respuestas.',
    };
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
    const notificationId = String(n?.id ?? '').trim() || null;
    const matchId = extractNotificationMatchId(n);
    const lifecycleMatchId = extractLifecycleMatchId(n);
    const resolvedMatchId = matchId || lifecycleMatchId;
    const data = n?.data || {};

    // Prefer explicit deep links and fallback to the canonical survey route.
    const deepLink = n?.deep_link
      || n?.deepLink
      || n?.action_url
      || n?.actionUrl
      || n?.data?.resultsUrl
      || n?.data?.results_url
      || n?.data?.action_url
      || n?.data?.actionUrl
      || n?.data?.deep_link
      || n?.data?.deepLink
      || n?.data?.link
      || null;

    const baseDebugPayload = {
      notification_id: notificationId,
      notification_type: type,
      type,
      match_id: resolvedMatchId || null,
      extracted_match_id: matchId || null,
      lifecycle_match_id: lifecycleMatchId || null,
      partido_id: n?.partido_id || data?.partido_id || data?.partidoId || null,
      team_match_id: data?.team_match_id || data?.teamMatchId || null,
      survey_id: n?.survey_id || data?.survey_id || data?.surveyId || null,
      action_url: n?.action_url || n?.actionUrl || data?.action_url || data?.actionUrl || null,
      actionUrl: n?.actionUrl || data?.actionUrl || null,
      resultsUrl: data?.resultsUrl || null,
      results_url: data?.results_url || null,
      route: data?.route || null,
      url: data?.url || null,
      link: data?.link || null,
      deep_link: deepLink,
      platform: options?.platform,
    };

    const navigateWithDebug = (route, navOptions = undefined, context = {}) => {
      debugNotificationEvent('NOTIFICATION_ROUTE_RESOLVED', {
        ...baseDebugPayload,
        ...context,
        final_route: route || null,
        navigate_options: navOptions || null,
      });
      debugNotificationEvent('NOTIFICATION_NAVIGATE_START', {
        ...baseDebugPayload,
        ...context,
        final_route: route || null,
        navigate_options: navOptions || null,
      });
      try {
        if (navOptions === undefined) {
          navigate(route);
        } else {
          navigate(route, navOptions);
        }
        debugNotificationEvent('NOTIFICATION_NAVIGATE_DONE', {
          ...baseDebugPayload,
          ...context,
          final_route: route || null,
        });
      } catch (error) {
        debugNotificationEvent('NOTIFICATION_NAVIGATE_ERROR', {
          ...baseDebugPayload,
          ...context,
          final_route: route || null,
          error: error?.message || String(error || ''),
        });
        throw error;
      }
    };

    debugNotificationRoute('open', {
      ...baseDebugPayload,
      raw_notification: n || null,
    });

    if (!type) return;

    // Mark as read before navigation (best-effort)
    if (notificationId) {
      debugNotificationEvent('NOTIFICATION_MARK_READ_START', {
        ...baseDebugPayload,
        source: 'openNotification',
      });
      debugNotificationRoute('mark_read_attempt', {
        notification_id: notificationId,
        type,
        match_id: resolvedMatchId || null,
        source: 'openNotification',
        platform: options?.platform,
      });
      (async () => {
        try {
          const markReadClient = options?.supabaseClient || supabase;
          await markReadClient.from('notifications').update({ read: true, status: 'sent' }).eq('id', notificationId);
          debugNotificationEvent('NOTIFICATION_MARK_READ_DONE', {
            ...baseDebugPayload,
            source: 'openNotification',
          });
          debugNotificationRoute('mark_read_done', {
            notification_id: notificationId,
            type,
            match_id: resolvedMatchId || null,
            source: 'openNotification',
            platform: options?.platform,
          });
        } catch (err) {
          debugNotificationEvent('NOTIFICATION_MARK_READ_ERROR', {
            ...baseDebugPayload,
            source: 'openNotification',
            error: err?.message || String(err || ''),
          });
          debugNotificationRoute('mark_read_failed', {
            notification_id: notificationId,
            type,
            match_id: resolvedMatchId || null,
            source: 'openNotification',
            error: err?.message || String(err || ''),
            platform: options?.platform,
          });
        }
      })();
    } else {
      debugNotificationEvent('NOTIFICATION_MARK_READ_SKIP', {
        ...baseDebugPayload,
        source: 'openNotification',
        reason: 'missing_notification_id',
      });
      debugNotificationRoute('mark_read_skipped_missing_id', {
        notification_id: null,
        type,
        match_id: resolvedMatchId || null,
        source: 'openNotification',
        platform: options?.platform,
      });
    }

    const challengeDisabled = await resolveSurveyChallengeDisabledNotice({
      notification: n,
      matchId: resolvedMatchId,
      supabaseClient: options?.supabaseClient || supabase,
    });
    if (challengeDisabled) {
      debugNotificationRoute('survey_challenge_disabled', {
        ...baseDebugPayload,
        reason: challengeDisabled.reason,
        message: challengeDisabled.message,
        team_match_id: challengeDisabled.teamMatchId || baseDebugPayload.team_match_id || null,
      });
      options?.onActionBlocked?.(challengeDisabled);
      return;
    }

    if (shouldOpenAsTeamChallenge(n)) {
      const teamChallengeActionability = await resolveTeamChallengeNotificationActionability({
        notification: n,
        supabaseClient: options?.supabaseClient || supabase,
        nowMs: Date.now(),
      });
      if (!teamChallengeActionability.isActionable) {
        options?.onActionBlocked?.(teamChallengeActionability);
        return;
      }

      navigateWithDebug(buildTeamChallengeRoute(n), undefined, {
        route_source: 'team_challenge',
      });
      return;
    }

    if (shouldTreatNotificationAsSurveyForm(n)) {
      const surveyNavigation = await resolveSurveyNotificationNavigation({
        notification: n,
        supabaseClient: options?.supabaseClient || supabase,
        userId: options?.userId || '',
      });

      if (!surveyNavigation.canNavigate) {
        debugNotificationRoute('survey_navigation_blocked', {
          match_id: resolvedMatchId || null,
          notificationId,
          reason: surveyNavigation.reason,
          platform: options?.platform,
        });
        return;
      }

      debugNotificationRoute('navigate', {
        notification_id: notificationId,
        type,
        match_id: resolvedMatchId || null,
        route: surveyNavigation.route,
        platform: options?.platform,
      });
      if (surveyNavigation.route) {
        navigateWithDebug(surveyNavigation.route, undefined, {
          route_source: 'survey_form',
        });
      }
      return;
    }

    const actionability = await resolveNotificationActionability({
      notification: n,
      supabaseClient: options?.supabaseClient || supabase,
    });
    if (!actionability.isActionable) {
      debugNotificationRoute('blocked', {
        notification_id: notificationId,
        type,
        match_id: resolvedMatchId || null,
        reason: actionability.reason,
        message: actionability.message || '',
        platform: options?.platform,
      });
      options?.onActionBlocked?.(actionability);
      return;
    }

    if (!resolvedMatchId) {
      debugNotificationRoute('abort_missing_match_id', {
        notification_id: notificationId,
        type,
        survey_id: n?.survey_id || n?.data?.survey_id || n?.data?.surveyId || null,
        action_url: n?.action_url || n?.actionUrl || n?.data?.action_url || n?.data?.actionUrl || null,
        results_url: n?.data?.resultsUrl || n?.data?.results_url || null,
        link: n?.data?.link || null,
        deep_link: deepLink,
        platform: options?.platform,
      });
      return;
    }

    if (RESULTS_NOTIFICATION_TYPES.has(type)) {
      const resolvedEntry = await resolveResultsNotificationEntry({
        notification: n,
        supabaseClient: options?.supabaseClient || supabase,
      });
      if (resolvedEntry.kind === 'modal') {
        debugNotificationRoute('results_unavailable', {
          notification_id: notificationId,
          type,
          match_id: resolvedMatchId,
          title: resolvedEntry.title,
          message: resolvedEntry.message,
          platform: options?.platform,
        });
        options?.onResultsUnavailable?.(resolvedEntry);
        return;
      }
      if (resolvedEntry.route) {
        debugNotificationRoute('navigate', {
          notification_id: notificationId,
          type,
          match_id: resolvedMatchId,
          route: resolvedEntry.route,
          force_awards: Boolean(resolvedEntry.state?.forceAwards),
          platform: options?.platform,
        });
        navigateWithDebug(resolvedEntry.route, { state: resolvedEntry.state }, {
          route_source: 'results_notification',
          force_awards: Boolean(resolvedEntry.state?.forceAwards),
        });
      }
      return;
    }

    if (AWARDS_NOTIFICATION_TYPES.has(type)) {
      const target = buildAwardsResultsNavigationTarget(n, resolvedMatchId);
      if (target.route) {
        debugNotificationRoute('navigate', {
          notification_id: notificationId,
          type,
          match_id: resolvedMatchId,
          route: target.route,
          force_awards: Boolean(target.state?.forceAwards),
          platform: options?.platform,
        });
        navigateWithDebug(target.route, { state: target.state }, {
          route_source: 'awards_notification',
          force_awards: Boolean(target.state?.forceAwards),
        });
      }
      return;
    }

    if (type === 'survey_finished') {
      const resolvedEntry = await resolveResultsNotificationEntry({
        notification: n,
        supabaseClient: options?.supabaseClient || supabase,
      });
      if (resolvedEntry.kind === 'modal') {
        debugNotificationRoute('results_unavailable', {
          notification_id: notificationId,
          type,
          match_id: resolvedMatchId,
          title: resolvedEntry.title,
          message: resolvedEntry.message,
          platform: options?.platform,
        });
        options?.onResultsUnavailable?.(resolvedEntry);
        return;
      }
      if (resolvedEntry.route) {
        debugNotificationRoute('navigate', {
          notification_id: notificationId,
          type,
          match_id: resolvedMatchId,
          route: resolvedEntry.route,
          force_awards: Boolean(resolvedEntry.state?.forceAwards),
          platform: options?.platform,
        });
        navigateWithDebug(resolvedEntry.route, { state: resolvedEntry.state }, {
          route_source: 'survey_finished',
          force_awards: Boolean(resolvedEntry.state?.forceAwards),
        });
      }
      return;
    }

    if (type === 'match_join_request') {
      if (deepLink) {
        navigateWithDebug(deepLink, undefined, {
          route_source: 'match_join_request_deep_link',
        });
      } else {
        navigateWithDebug(`/admin/${resolvedMatchId}?tab=solicitudes`, undefined, {
          route_source: 'match_join_request_fallback',
        });
      }
      return;
    }

    if (type === 'match_join_approved') {
      if (deepLink) {
        navigateWithDebug(deepLink, undefined, {
          route_source: 'match_join_approved_deep_link',
        });
      } else {
        navigateWithDebug(`/partido-publico/${resolvedMatchId}`, undefined, {
          route_source: 'match_join_approved_fallback',
        });
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
        supabaseClient: options?.supabaseClient || supabase,
        matchId: resolvedMatchId,
      });
      if (challengeRouteFromMatchId) {
        navigateWithDebug(challengeRouteFromMatchId, undefined, {
          route_source: 'match_invite_challenge_lookup',
        });
        return;
      }

      const inviteRoute = resolveMatchInviteRoute(n);
      if (inviteRoute) {
        navigateWithDebug(inviteRoute, undefined, {
          route_source: 'match_invite',
        });
      } else {
        navigateWithDebug(`/partido-publico/${resolvedMatchId}`, undefined, {
          route_source: 'match_invite_fallback',
        });
      }
      return;
    }

    if (type === 'team_invite') {
      navigateWithDebug('/desafios?tab=mis-equipos', undefined, {
        route_source: 'team_invite',
      });
      return;
    }

    if (type === 'team_captain_transfer') {
      const teamId = n?.data?.team_id || n?.data?.teamId || null;
      if (teamId) {
        navigateWithDebug(`/desafios/equipos/${teamId}`, undefined, {
          route_source: 'team_captain_transfer',
        });
      } else {
        navigateWithDebug('/desafios', undefined, {
          route_source: 'team_captain_transfer_fallback',
        });
      }
      return;
    }

    // default: home
    navigateWithDebug('/', undefined, {
      route_source: 'default_fallback',
    });
  } catch (e) {
    debugNotificationEvent('NOTIFICATION_NAVIGATE_ERROR', {
      notification_id: String(n?.id ?? '').trim() || null,
      type: n?.type,
      raw_notification: n || null,
      error: e?.message || String(e || ''),
      platform: options?.platform,
    });
    logger.error('openNotification failed', e);
  }
}
