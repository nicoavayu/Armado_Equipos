import { supabase } from '../supabase';
import { logger } from '../lib/logger';
import { getResultsUrl } from './routes';
import { resolveMatchInviteRoute } from './matchInviteRoute';

// const encuestaUrl = (matchId) => `/encuesta/${matchId}`;

export async function openNotification(n, navigate) {
  try {
    const type = n?.type;
    const matchId = n?.data?.matchId || n?.data?.partido_id || n?.partido_id;
    const teamMatchId = n?.data?.team_match_id || n?.data?.teamMatchId || null;

    // Prefer explicit deep_link fields if present
    const deepLink = n?.deep_link || n?.deepLink || n?.data?.deep_link || n?.data?.deepLink || (matchId ? `/partidos/${matchId}/encuesta` : null);

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

    if (type === 'challenge_accepted' || type === 'team_match_created') {
      if (teamMatchId) {
        navigate(`/quiero-jugar/equipos/partidos/${teamMatchId}`);
      } else {
        navigate('/quiero-jugar');
      }
      return;
    }

    if (!matchId) return;

    // Survey notifications should deep-link to the survey UI (not admin panel)
    if (type === 'survey' || type === 'survey_reminder') {
      console.debug('[openNotification] navigating to survey deep_link', { deepLink });
      if (deepLink) {
        navigate(deepLink);
      } else {
        // fallback to path using matchId
        navigate(`/partidos/${matchId}/encuesta`);
      }
      return;
    }

    if (type === 'survey_results_ready' || type === 'awards_ready') {
      // Prefer explicit resultsUrl
      const base = n?.data?.resultsUrl || getResultsUrl(Number(matchId)) || n?.data?.link || `/encuesta/${matchId}`;
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
      const base = n?.data?.resultsUrl || getResultsUrl(Number(matchId)) || n?.data?.link || `/resultados-encuesta/${matchId}`;
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

    if (type === 'match_invite') {
      const inviteRoute = resolveMatchInviteRoute(n);
      if (inviteRoute) {
        navigate(inviteRoute);
      } else {
        navigate(`/partido-publico/${matchId}`);
      }
      return;
    }

    if (type === 'team_invite') {
      navigate('/quiero-jugar');
      return;
    }

    // default: home
    navigate('/');
  } catch (e) {
    logger.error('openNotification failed', e);
  }
}
