import { supabase } from '../supabase';
import { logger } from '../lib/logger';
import { getResultsUrl } from './routes';
import { resolveMatchInviteRoute } from './matchInviteRoute';
import { isSurveyNotificationClosed } from './surveyNotificationCopy';
import {
  buildTeamChallengeRoute,
  extractNotificationMatchId,
  isTeamChallengeNotification,
  resolveTeamChallengeRouteFromMatchId,
} from './notificationRoutes';

const normalizeSurveyLink = (rawLink, matchId) => {
  const fallback = matchId ? `/encuesta/${matchId}` : null;
  if (!rawLink) return fallback;

  const link = String(rawLink || '').trim();
  if (!link) return fallback;

  // Legacy routes used /partidos/:id/encuesta; app route is /encuesta/:id.
  const normalized = link.replace(
    /^\/partidos\/([^/]+)\/encuesta(\?.*)?$/i,
    '/encuesta/$1$2',
  );

  return normalized || fallback;
};

const SURVEY_NOTIFICATION_TYPES = new Set([
  'survey',
  'survey_start',
  'post_match_survey',
  'survey_reminder',
  'survey_reminder_12h',
]);

const RESULTS_NOTIFICATION_TYPES = new Set([
  'survey_results',
  'survey_results_ready',
  'awards_ready',
  'award_won',
]);

export async function openNotification(n, navigate) {
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

    if (SURVEY_NOTIFICATION_TYPES.has(type)) {
      if (matchId && isSurveyNotificationClosed(n)) {
        console.debug('[openNotification] survey closed, skip navigation', { matchId, notificationId: n?.id });
        return;
      }

      const surveyLink = normalizeSurveyLink(deepLink, matchId);
      console.debug('[openNotification] navigating to survey link', { surveyLink });
      if (surveyLink) navigate(surveyLink);
      return;
    }

    if (!matchId) return;

    if (RESULTS_NOTIFICATION_TYPES.has(type)) {
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
      navigate('/desafios');
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
