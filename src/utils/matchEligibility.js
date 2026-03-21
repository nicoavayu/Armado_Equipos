import { MATCH_TIMEZONE_AR, parseDateTimeInTimeZone } from './dateLocal';

const OPEN_MATCH_STATES = new Set(['active', 'activo']);
const CANCELLED_MATCH_STATES = new Set(['cancelado', 'cancelled', 'canceled', 'deleted']);
const FINISHED_MATCH_STATES = new Set(['finalizado', 'finished', 'completed', 'closed']);
const CLOSED_RESULT_STATUSES = new Set(['finished', 'draw', 'not_played']);
const CANCELLED_RESULT_STATUSES = new Set(['not_played']);
const CHALLENGE_PREFIX = /^desafio\s*:/;

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const normalizeLooseText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const hasFiniteCoordinates = (coords) => (
  Boolean(coords)
  && Number.isFinite(Number(coords?.lat))
  && Number.isFinite(Number(coords?.lng))
);

export const normalizeMatchStateToken = normalizeToken;

export const resolveMatchStartAt = (matchRow, timeZone = MATCH_TIMEZONE_AR) => {
  const parsed = parseDateTimeInTimeZone(matchRow?.fecha, matchRow?.hora, timeZone);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export const buildMatchLifecycleAudit = ({
  matchRow,
  now = new Date(),
  timeZone = MATCH_TIMEZONE_AR,
}) => {
  const normalizedEstado = normalizeToken(matchRow?.estado);
  const normalizedSurveyStatus = normalizeToken(matchRow?.survey_status);
  const normalizedResultStatus = normalizeToken(matchRow?.result_status);
  const deleted = Boolean(matchRow?.deleted_at);
  const cancelled = deleted
    || CANCELLED_MATCH_STATES.has(normalizedEstado)
    || CANCELLED_RESULT_STATUSES.has(normalizedResultStatus);
  const finished = FINISHED_MATCH_STATES.has(normalizedEstado)
    || CLOSED_RESULT_STATUSES.has(normalizedResultStatus)
    || Boolean(matchRow?.finished_at);
  const surveyClosed = normalizedSurveyStatus === 'closed';
  const openState = OPEN_MATCH_STATES.has(normalizedEstado);
  const startDateTime = resolveMatchStartAt(matchRow, timeZone);
  const invalidStartDateTime = !startDateTime;
  const expired = startDateTime ? now.getTime() >= startDateTime.getTime() : false;

  const exclusionReasons = [];
  if (matchRow?.__lifecycleLookupMissing) exclusionReasons.push('missing_lifecycle_row');
  if (cancelled) exclusionReasons.push('match_cancelled');
  else if (!openState) exclusionReasons.push('state_not_open');
  if (!cancelled && finished) exclusionReasons.push('match_finished');
  if (!cancelled && surveyClosed) exclusionReasons.push('survey_closed');
  if (invalidStartDateTime) exclusionReasons.push('invalid_start_datetime');
  else if (expired) exclusionReasons.push('match_expired');

  return {
    matchRow,
    partidoId: Number(matchRow?.id || 0) || null,
    estado: matchRow?.estado ?? null,
    normalizedEstado,
    surveyStatus: matchRow?.survey_status ?? null,
    normalizedSurveyStatus,
    resultStatus: matchRow?.result_status ?? null,
    normalizedResultStatus,
    deleted,
    cancelled,
    finished,
    surveyClosed,
    openState,
    startDateTime,
    startDateTimeIso: startDateTime ? startDateTime.toISOString() : null,
    invalidStartDateTime,
    expired,
    lifecycleEligible: exclusionReasons.length === 0,
    exclusionReasons,
  };
};

export const isMatchOperationallyOpen = (matchRow, options = {}) => (
  buildMatchLifecycleAudit({ matchRow, ...options }).lifecycleEligible
);

export const buildQuieroJugarMatchAudit = ({
  matchRow,
  userLocation = null,
  matchCoordinates = null,
  distanceKm = null,
  maxDistanceKm = null,
  now = new Date(),
  hideChallengeMatches = true,
}) => {
  const lifecycleAudit = buildMatchLifecycleAudit({ matchRow, now });
  const exclusionReasons = [...lifecycleAudit.exclusionReasons];
  const challengeMatch = CHALLENGE_PREFIX.test(
    normalizeLooseText(matchRow?.nombre || matchRow?.titulo || matchRow?.name || ''),
  );
  const needsPlayers = matchRow?.falta_jugadores === true;
  const userHasLocation = hasFiniteCoordinates(userLocation);
  const matchHasCoordinates = hasFiniteCoordinates(matchCoordinates);
  const roundedDistanceKm = Number.isFinite(distanceKm) ? Number(distanceKm) : null;
  const withinDistance = (
    userHasLocation
    && Number.isFinite(roundedDistanceKm)
    && Number.isFinite(Number(maxDistanceKm))
  )
    ? roundedDistanceKm <= Number(maxDistanceKm)
    : null;

  if (!needsPlayers) exclusionReasons.push('no_open_slots');
  if (hideChallengeMatches && challengeMatch) exclusionReasons.push('challenge_match_hidden');

  const baseEligible = exclusionReasons.length === 0;

  if (baseEligible && userHasLocation && !matchHasCoordinates) {
    exclusionReasons.push('match_distance_unresolvable');
  }

  if (baseEligible && userHasLocation && matchHasCoordinates && withinDistance === false) {
    exclusionReasons.push('outside_distance_limit');
  }

  return {
    ...lifecycleAudit,
    userHasLocation,
    matchHasCoordinates,
    distanceKm: roundedDistanceKm,
    withinDistance,
    maxDistanceKm: Number.isFinite(Number(maxDistanceKm)) ? Number(maxDistanceKm) : null,
    needsPlayers,
    challengeMatch,
    baseEligible,
    includedInList: exclusionReasons.length === 0,
    exclusionReasons,
  };
};
