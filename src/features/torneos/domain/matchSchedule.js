const OFFICIAL_STATUSES = new Set(['official', 'played', 'completed']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);
const UPCOMING_STATUSES = new Set(['ready', 'scheduled', 'postponed']);

export const PUBLIC_MATCH_KIND = Object.freeze({
  OFFICIAL: 'official',
  UPCOMING: 'upcoming',
  HISTORICAL: 'historical',
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled',
  UNSCHEDULED: 'unscheduled',
});

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

export function getMatchScheduleTime(match) {
  if (!match?.scheduledAt) return null;
  const timestamp = new Date(match.scheduledAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function hasScheduledTime(match) {
  return getMatchScheduleTime(match) !== null;
}

export function countScheduledMatches(matches = []) {
  return (Array.isArray(matches) ? matches : []).filter(hasScheduledTime).length;
}

export function classifyPublicMatch(match, now = Date.now()) {
  const status = normalizeStatus(match?.status);
  if (match?.result || OFFICIAL_STATUSES.has(status)) return PUBLIC_MATCH_KIND.OFFICIAL;
  if (CANCELLED_STATUSES.has(status)) return PUBLIC_MATCH_KIND.CANCELLED;

  const scheduledTime = getMatchScheduleTime(match);
  if (scheduledTime === null) {
    return status === 'postponed'
      ? PUBLIC_MATCH_KIND.POSTPONED
      : PUBLIC_MATCH_KIND.UNSCHEDULED;
  }
  if (scheduledTime <= now) return PUBLIC_MATCH_KIND.HISTORICAL;
  return UPCOMING_STATUSES.has(status)
    ? PUBLIC_MATCH_KIND.UPCOMING
    : PUBLIC_MATCH_KIND.UNSCHEDULED;
}

/**
 * El acta se abre con normalidad desde seis horas antes del horario del partido.
 * Más temprano la apertura sigue siendo posible, pero el backend exige dejar
 * registrado por qué se adelanta.
 */
export const MATCH_OPEN_WINDOW_HOURS = 6;
export const MATCH_OPEN_REASON_MIN_LENGTH = 3;

export function requiresEarlyOpenReason(match, now = Date.now()) {
  const scheduledTime = getMatchScheduleTime(match);
  if (scheduledTime === null) return false;
  return now < scheduledTime - MATCH_OPEN_WINDOW_HOURS * 60 * 60 * 1000;
}

export function isEarlyOpenReasonValid(reason) {
  return String(reason || '').trim().length >= MATCH_OPEN_REASON_MIN_LENGTH;
}

export function describeEarlyOpen(match, now = Date.now()) {
  if (!requiresEarlyOpenReason(match, now)) return null;
  return {
    title: 'Falta bastante para el horario del partido',
    description: `El acta se abre normalmente desde ${MATCH_OPEN_WINDOW_HOURS} horas antes. Si necesitás abrirla ahora, contá por qué: queda registrado junto al acta.`,
    label: 'Por qué se abre antes de tiempo',
    placeholder: 'Se adelantó el partido, cambio de sede, decisión organizativa…',
  };
}

export function getPublicMatchLabel(match, now = Date.now()) {
  const kind = classifyPublicMatch(match, now);
  if (kind === PUBLIC_MATCH_KIND.OFFICIAL) return 'Resultado oficial';
  if (kind === PUBLIC_MATCH_KIND.CANCELLED) return 'Partido cancelado';
  if (String(match?.status || '').toLowerCase() === 'postponed') return 'Partido postergado';
  if (kind === PUBLIC_MATCH_KIND.UPCOMING) return 'Próximo partido';
  if (kind === PUBLIC_MATCH_KIND.HISTORICAL) return 'Partido anterior';
  return 'Horario a confirmar';
}
