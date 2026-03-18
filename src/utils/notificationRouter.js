import { supabase } from '../supabase';
import { logger } from '../lib/logger';
import { getResultsUrl } from './routes';
import { resolveMatchInviteRoute } from './matchInviteRoute';
import { isSurveyNotificationClosed } from './surveyNotificationCopy';
import { resolveSurveyAccess } from './surveyAccess';
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
  if (!isSurveyFormNotificationType(notification)) {
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

    console.debug('[openNotification] opening notification', { id: n?.id, type, matchId, deepLink });

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

    if (isSurveyFormNotificationType(type)) {
      const surveyNavigation = await resolveSurveyNotificationNavigation({
        notification: n,
        supabaseClient: options?.supabaseClient || supabase,
        userId: options?.userId || '',
      });

      if (!surveyNavigation.canNavigate) {
        console.debug('[openNotification] survey navigation blocked', {
          matchId,
          notificationId: n?.id,
          reason: surveyNavigation.reason,
        });
        return;
      }

      console.debug('[openNotification] navigating to survey link', { surveyLink: surveyNavigation.route });
      if (surveyNavigation.route) navigate(surveyNavigation.route);
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
