import { SURVEY_FINALIZE_DELAY_MS } from '../config/surveyConfig';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const SURVEY_WINDOW_HOURS = Math.max(1, Math.round(SURVEY_FINALIZE_DELAY_MS / HOUR_MS));

export const resolveSurveyDeadlineAt = (source = {}) => {
  const data = source?.data || {};
  const explicitDeadline = (
    data?.survey_deadline_at
    || data?.surveyDeadlineAt
    || data?.deadline_at
    || data?.deadlineAt
    || source?.survey_deadline_at
    || source?.deadline_at
    || source?.deadlineAt
    || null
  );

  const explicitDate = toDate(explicitDeadline);
  if (explicitDate) return explicitDate;

  const createdAt = (
    source?.created_at
    || source?.createdAt
    || data?.survey_opened_at
    || data?.surveyOpenedAt
    || null
  );
  const createdDate = toDate(createdAt);
  if (!createdDate) return null;

  return new Date(createdDate.getTime() + SURVEY_FINALIZE_DELAY_MS);
};

export const getSurveyRemainingLabel = (deadlineAt, now = new Date()) => {
  const deadlineDate = toDate(deadlineAt);
  if (!deadlineDate) {
    return `Tenés ${SURVEY_WINDOW_HOURS} horas para completar la encuesta.`;
  }

  const nowDate = toDate(now) || new Date();
  const msLeft = deadlineDate.getTime() - nowDate.getTime();

  if (msLeft <= 0) {
    return 'La encuesta está en cierre.';
  }

  if (msLeft >= HOUR_MS) {
    const hoursLeft = Math.ceil(msLeft / HOUR_MS);
    return hoursLeft === 1
      ? 'Queda 1 hora para completar la encuesta.'
      : `Quedan ${hoursLeft} horas para completar la encuesta.`;
  }

  const minutesLeft = Math.ceil(msLeft / MINUTE_MS);
  if (minutesLeft <= 1) return 'Queda menos de 1 minuto para completar la encuesta.';
  return `Quedan ${minutesLeft} minutos para completar la encuesta.`;
};

export const getSurveyStartMessage = ({ source = {}, matchName = 'este partido', now = new Date() } = {}) => {
  const remaining = getSurveyRemainingLabel(resolveSurveyDeadlineAt(source), now);
  return `La encuesta del partido ${matchName} está lista. ${remaining}`;
};
