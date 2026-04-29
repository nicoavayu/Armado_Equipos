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

export const isSurveyDisabledForChallengeNotification = (notification = {}) => {
  if (!isSurveyRelatedNotificationType(notification)) return false;

  const data = notification?.data || {};
  const source = normalizeToken(data?.source || notification?.source);
  const originType = normalizeToken(data?.origin_type || data?.originType || notification?.origin_type);
  const matchName = normalizeToken(
    data?.match_name
    || data?.partido_nombre
    || notification?.match_name
    || notification?.title
    || notification?.message,
  );

  return source === 'team_challenge'
    || originType === 'challenge'
    || Boolean(data?.team_match_id || data?.teamMatchId)
    || Boolean(data?.challenge_id || data?.challengeId)
    || /^desaf[ií]o\s*:/.test(matchName)
    || matchName.includes('desafio:')
    || matchName.includes('desafío:');
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
