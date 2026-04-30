export const SURVEY_CHALLENGE_DISABLED_TITLE = 'Encuesta no disponible';
export const SURVEY_CHALLENGE_DISABLED_MESSAGE = 'Las encuestas están disponibles solo para partidos amistosos.';
export const SURVEY_CHALLENGE_DISABLED_REASON = 'surveys_disabled_for_challenges';

export const SURVEY_RELATED_NOTIFICATION_TYPES = new Set([
  'survey',
  'survey_start',
  'post_match_survey',
  'survey_reminder',
  'survey_reminder_12h',
  'survey_results',
  'survey_results_ready',
  'awards_ready',
  'award_won',
  'survey_finished',
]);

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

export const isChallengeLikeTeamMatchRow = (teamMatchRow = null) => {
  const originType = normalizeToken(teamMatchRow?.origin_type);
  return Boolean(teamMatchRow?.id) || originType === 'challenge' || Boolean(teamMatchRow?.challenge_id);
};

export const isSurveyRelatedNotificationType = (notificationOrType = {}) => {
  const type = typeof notificationOrType === 'string'
    ? normalizeToken(notificationOrType)
    : normalizeToken(notificationOrType?.type);
  return SURVEY_RELATED_NOTIFICATION_TYPES.has(type);
};

const collectNotificationUrlCandidates = (notification = {}) => {
  const data = notification?.data || {};
  return [
    data?.action_url,
    data?.actionUrl,
    data?.resultsUrl,
    data?.results_url,
    data?.route,
    data?.url,
    data?.link,
    data?.deep_link,
    data?.deepLink,
    notification?.action_url,
    notification?.actionUrl,
    notification?.resultsUrl,
    notification?.results_url,
    notification?.route,
    notification?.url,
    notification?.link,
    notification?.deep_link,
    notification?.deepLink,
  ];
};

const extractNumericMatchIdFromSurveyUrl = (rawUrl) => {
  const url = String(rawUrl || '').trim();
  if (!url) return null;

  const pathMatch = url.match(/\/(?:encuesta|resultados-encuesta)\/(\d+)(?:[/?#]|$)/i);
  if (pathMatch?.[1]) return pathMatch[1];

  const queryMatch = url.match(/[?&](?:partidoId|partido_id|matchId|match_id)=(\d+)(?:&|$)/i);
  return queryMatch?.[1] || null;
};

export const extractSurveyNotificationPartidoIdForChallengeLookup = (notification = {}) => {
  if (!isSurveyRelatedNotificationType(notification)) return null;

  const data = notification?.data || {};
  const directCandidate = (
    notification?.partido_id
    ?? data?.partido_id
    ?? data?.partidoId
    ?? data?.match_id
    ?? data?.matchId
    ?? notification?.match_id
    ?? notification?.match_ref
    ?? null
  );
  const normalizedDirect = String(directCandidate ?? '').trim();
  if (/^\d+$/.test(normalizedDirect)) return normalizedDirect;

  for (const candidate of collectNotificationUrlCandidates(notification)) {
    const idFromUrl = extractNumericMatchIdFromSurveyUrl(candidate);
    if (idFromUrl) return idFromUrl;
  }

  return null;
};

export const isSurveyDisabledForChallengeNotification = (notification = {}) => {
  if (!isSurveyRelatedNotificationType(notification)) return false;

  const data = notification?.data || {};
  const source = normalizeToken(data?.source || notification?.source);
  const originType = normalizeToken(data?.origin_type || data?.originType || notification?.origin_type);
  const matchName = normalizeToken(
    data?.match_name
    || data?.partido_nombre
    || data?.title
    || data?.message
    || data?.body
    || notification?.match_name
    || notification?.title
    || notification?.message
    || notification?.body,
  );
  const urlText = normalizeToken(collectNotificationUrlCandidates(notification).filter(Boolean).join(' '));

  return source === 'team_challenge'
    || source === 'team_match'
    || originType === 'challenge'
    || originType === 'team_match'
    || Boolean(data?.team_match_id || data?.teamMatchId)
    || Boolean(data?.challenge_id || data?.challengeId)
    || /^desaf[ií]o\s*:/.test(matchName)
    || matchName.includes('desafio:')
    || matchName.includes('desafío:')
    || urlText.includes('/desafios/')
    || urlText.includes('team_match_id=');
};

export const filterSurveyChallengeNotificationsForDisplay = async (
  notifications = [],
  { supabaseClient } = {},
) => {
  const rows = Array.isArray(notifications) ? notifications : [];
  if (rows.length === 0) return rows;

  const partidoIdsToCheck = new Set();
  rows.forEach((notification) => {
    if (!isSurveyRelatedNotificationType(notification)) return;
    if (isSurveyDisabledForChallengeNotification(notification)) return;

    const partidoId = extractSurveyNotificationPartidoIdForChallengeLookup(notification);
    if (partidoId) partidoIdsToCheck.add(String(partidoId));
  });

  const challengePartidoIds = new Set();
  const ids = [...partidoIdsToCheck];

  if (supabaseClient && ids.length > 0) {
    try {
      const { data, error } = await supabaseClient
        .from('team_matches')
        .select('id, partido_id, origin_type, challenge_id')
        .in('partido_id', ids);
      if (error) throw error;

      (data || []).forEach((row) => {
        if (!isChallengeLikeTeamMatchRow(row)) return;
        const partidoId = String(row?.partido_id ?? '').trim();
        if (partidoId) challengePartidoIds.add(partidoId);
      });
    } catch (_error) {
      // If the bridge lookup fails, keep the direct metadata/title/url filter and avoid hiding friendly surveys.
    }
  }

  return rows.filter((notification) => {
    if (!isSurveyRelatedNotificationType(notification)) return true;
    if (isSurveyDisabledForChallengeNotification(notification)) return false;

    const partidoId = extractSurveyNotificationPartidoIdForChallengeLookup(notification);
    return !partidoId || !challengePartidoIds.has(String(partidoId));
  });
};

export const fetchChallengeTeamMatchForPartido = async ({
  supabaseClient,
  partidoId,
} = {}) => {
  const normalizedPartidoId = String(partidoId ?? '').trim();
  if (!supabaseClient || !normalizedPartidoId) return null;

  try {
    const { data, error } = await supabaseClient
      .from('team_matches')
      .select('id, partido_id, origin_type, challenge_id')
      .eq('partido_id', normalizedPartidoId)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch (_error) {
    return null;
  }
};

export const isSurveyDisabledForChallengePartido = async ({
  supabaseClient,
  partidoId,
} = {}) => {
  const teamMatchRow = await fetchChallengeTeamMatchForPartido({
    supabaseClient,
    partidoId,
  });
  return isChallengeLikeTeamMatchRow(teamMatchRow);
};

export const buildSurveyChallengeDisabledNotice = (extra = {}) => ({
  isActionable: false,
  canNavigate: false,
  reason: SURVEY_CHALLENGE_DISABLED_REASON,
  title: SURVEY_CHALLENGE_DISABLED_TITLE,
  message: SURVEY_CHALLENGE_DISABLED_MESSAGE,
  ...extra,
});
