import {
  SURVEY_FINALIZE_DELAY_MS,
  SURVEY_START_DELAY_MS,
} from '../config/surveyConfig';
import { MATCH_TIMEZONE_AR, parseDateTimeInTimeZone } from './dateLocal';

const DEFAULT_ALIGNMENT_TOLERANCE_MS = 60 * 1000;

const toDateOrNull = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toIsoOrNull = (value) => {
  const parsed = toDateOrNull(value);
  return parsed ? parsed.toISOString() : null;
};

export const resolveKickoffAtFromMatch = ({
  fecha = null,
  hora = null,
  scheduledAt = null,
  kickoffTimeZone = MATCH_TIMEZONE_AR,
} = {}) => {
  const localKickoff = parseDateTimeInTimeZone(fecha || null, hora || null, kickoffTimeZone);
  if (localKickoff && !Number.isNaN(localKickoff.getTime())) {
    return localKickoff;
  }

  return toDateOrNull(scheduledAt);
};

export const deriveSurveyWindowFromMatch = ({
  fecha = null,
  hora = null,
  scheduledAt = null,
  kickoffTimeZone = MATCH_TIMEZONE_AR,
  fallbackNowIso = null,
  surveyStartDelayMs = SURVEY_START_DELAY_MS,
  surveyFinalizeDelayMs = SURVEY_FINALIZE_DELAY_MS,
} = {}) => {
  const kickoffAt = resolveKickoffAtFromMatch({
    fecha,
    hora,
    scheduledAt,
    kickoffTimeZone,
  });
  if (kickoffAt) {
    const openedAt = new Date(kickoffAt.getTime() + Math.max(0, Number(surveyStartDelayMs) || 0));
    const closesAt = new Date(openedAt.getTime() + Math.max(0, Number(surveyFinalizeDelayMs) || 0));
    return {
      source: 'kickoff',
      kickoffAtIso: kickoffAt.toISOString(),
      openedAtIso: openedAt.toISOString(),
      closesAtIso: closesAt.toISOString(),
    };
  }

  const fallbackBase = toDateOrNull(fallbackNowIso) || new Date();
  const openedAt = fallbackBase;
  const closesAt = new Date(openedAt.getTime() + Math.max(0, Number(surveyFinalizeDelayMs) || 0));
  return {
    source: 'fallback_now',
    kickoffAtIso: null,
    openedAtIso: openedAt.toISOString(),
    closesAtIso: closesAt.toISOString(),
  };
};

export const isSurveyWindowConsistentWithKickoff = ({
  openedAt = null,
  closesAt = null,
  expectedOpenedAt = null,
  expectedClosesAt = null,
  toleranceMs = DEFAULT_ALIGNMENT_TOLERANCE_MS,
} = {}) => {
  const openedDate = toDateOrNull(openedAt);
  const closesDate = toDateOrNull(closesAt);
  const expectedOpenedDate = toDateOrNull(expectedOpenedAt);
  const expectedClosesDate = toDateOrNull(expectedClosesAt);
  const tol = Math.max(0, Number(toleranceMs) || 0);

  if (!openedDate || !closesDate || !expectedOpenedDate || !expectedClosesDate) return false;
  if (closesDate.getTime() <= expectedOpenedDate.getTime()) return false;

  const openDelta = Math.abs(openedDate.getTime() - expectedOpenedDate.getTime());
  const closeDelta = Math.abs(closesDate.getTime() - expectedClosesDate.getTime());
  return openDelta <= tol && closeDelta <= tol;
};

export const isSurveyWindowInvalidForKickoff = ({
  closesAt = null,
  expectedOpenedAt = null,
} = {}) => {
  const closesDate = toDateOrNull(closesAt);
  const expectedOpenedDate = toDateOrNull(expectedOpenedAt);
  if (!closesDate || !expectedOpenedDate) return true;
  return closesDate.getTime() <= expectedOpenedDate.getTime();
};

export const toSurveyWindowIso = ({ openedAt = null, closesAt = null } = {}) => ({
  openedAtIso: toIsoOrNull(openedAt),
  closesAtIso: toIsoOrNull(closesAt),
});
