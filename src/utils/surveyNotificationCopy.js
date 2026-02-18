import { SURVEY_FINALIZE_DELAY_MS } from '../config/surveyConfig';
import { quoteMatchName } from './notificationText';

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
    return 'La encuesta ya finalizó.';
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

export const getSurveyStartMessage = ({ matchName = 'este partido' } = {}) => {
  return `Ya está disponible la encuesta del partido ${quoteMatchName(matchName, 'este partido')}.`;
};

export const getSurveyReminderMessage = ({ source = {}, matchName = 'este partido', now = new Date() } = {}) => {
  const deadlineAt = resolveSurveyDeadlineAt(source);
  const deadlineDate = toDate(deadlineAt);
  if (!deadlineDate) {
    return `Recordatorio: no te olvides de completar la encuesta del partido ${quoteMatchName(matchName, 'este partido')}.`;
  }

  const nowDate = toDate(now) || new Date();
  const msLeft = deadlineDate.getTime() - nowDate.getTime();
  if (msLeft <= 0) {
    return `La encuesta del partido ${quoteMatchName(matchName, 'este partido')} ya finalizó.`;
  }

  const hoursLeft = Math.ceil(msLeft / HOUR_MS);
  if (hoursLeft <= 1) {
    return `Recordatorio: falta 1 hora para que cierre la encuesta del partido ${quoteMatchName(matchName, 'este partido')}.`;
  }

  return `Recordatorio: la encuesta del partido ${quoteMatchName(matchName, 'este partido')} sigue abierta por tiempo limitado.`;
};

export const getSurveyResultsReadyMessage = ({ matchName = 'este partido' } = {}) =>
  `Ya están listos los resultados de la encuesta del partido ${quoteMatchName(matchName, 'este partido')}.`;
