import { supabase } from '../supabase';
import { logger } from '../lib/logger';
import { getResultsUrl } from './routes';

const encuestaUrl = (matchId) => `/encuesta/${matchId}`;

export async function openNotification(n, navigate) {
  try {
    const type = n?.type;
    const matchId = n?.data?.matchId || n?.data?.partido_id || n?.partido_id;

    // Prefer explicit deep_link fields if present
    const deepLink = n?.deep_link || n?.deepLink || n?.data?.deep_link || n?.data?.deepLink || (matchId ? `/partidos/${matchId}/encuesta` : null);

    console.debug('[openNotification] opening notification', { id: n?.id, type, matchId, deepLink });

    if (!type || !matchId) return;

    // Mark as read before navigation (best-effort)
    (async () => {
      try {
        await supabase.from('notifications').update({ read: true, status: 'sent' }).eq('id', n.id);
      } catch (err) {
        // ignore errors for best-effort marking
      }
    })();

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

    if (type === 'survey_results_ready') {
      const base = n?.data?.resultsUrl || getResultsUrl(Number(matchId));
      const url = base.includes('?') ? `${base}&showAwards=1` : `${base}?showAwards=1`;
      navigate(url);
      return;
    }

    // default: home
    navigate('/');
  } catch (e) {
    logger.error('openNotification failed', e);
  }
}