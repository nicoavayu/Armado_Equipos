const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const CLOSED_SURVEY_STATUS_TOKENS = new Set([
  'closed',
  'cerrada',
]);

const CLOSED_RESULT_STATUS_TOKENS = new Set([
  'finished',
  'draw',
  'not_played',
  'cancelled',
  'cancelado',
  'no_jugado',
]);

const NON_ACTIONABLE_MATCH_STATUS_TOKENS = new Set([
  'cancelado',
  'cancelled',
  'canceled',
  'deleted',
  'eliminado',
  'suspendido',
  'suspended',
]);

const toMillis = (value) => {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

export const isSurveyReminderActionRequired = ({
  surveyStatus = null,
  resultStatus = null,
  matchStatus = null,
  surveyClosesAt = null,
  nowMs = Date.now(),
} = {}) => {
  const normalizedSurveyStatus = normalizeToken(surveyStatus);
  if (CLOSED_SURVEY_STATUS_TOKENS.has(normalizedSurveyStatus)) return false;

  const normalizedResultStatus = normalizeToken(resultStatus);
  if (CLOSED_RESULT_STATUS_TOKENS.has(normalizedResultStatus)) return false;

  const normalizedMatchStatus = normalizeToken(matchStatus);
  if (NON_ACTIONABLE_MATCH_STATUS_TOKENS.has(normalizedMatchStatus)) return false;

  const surveyClosesAtMs = toMillis(surveyClosesAt);
  if (surveyClosesAtMs !== null && surveyClosesAtMs <= nowMs) return false;

  return true;
};
