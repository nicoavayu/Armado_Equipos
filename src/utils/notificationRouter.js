import { supabase } from '../supabase';
import { logger } from '../lib/logger';
import { getResultsUrl } from './routes';

const encuestaUrl = (matchId) => `/encuesta/${matchId}`;

export async function openNotification(n, navigate) {
  try {
    const type = n?.type;
    const matchId = n?.data?.matchId || n?.data?.partido_id || n?.partido_id;
    if (!type || !matchId) return;

    // Mark as read before navigation
    supabase.from('notifications').update({ read: true, status: 'sent' }).eq('id', n.id).then(()=>{}).catch(()=>{});

    if (type === 'survey_reminder') {
      navigate(encuestaUrl(Number(matchId)));
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