// Parseo LOCAL: jamás usar strings ISO con new Date()
export const parseLocalDate = (yyyyMmDd) => {
  if (!yyyyMmDd) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0); // Local time
};

export const parseLocalDateTime = (yyyyMmDd, hhmm) => {
  if (!yyyyMmDd) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const [hh = 0, mm = 0] = (hhmm || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh, mm, 0, 0); // Local time
};

export const MATCH_TIMEZONE_AR = 'America/Argentina/Buenos_Aires';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const formatterCache = new Map();

const getFormatterForTimeZone = (timeZone) => {
  const key = String(timeZone || '').trim() || MATCH_TIMEZONE_AR;
  if (formatterCache.has(key)) return formatterCache.get(key);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: key,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(key, formatter);
  return formatter;
};

const getTimeZoneOffsetMs = (timeZone, date) => {
  const formatter = getFormatterForTimeZone(timeZone);
  const parts = formatter.formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') values[part.type] = part.value;
  });

  const asUtcMs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
    0,
  );
  return asUtcMs - date.getTime();
};

export const parseDateTimeInTimeZone = (
  yyyyMmDd,
  hhmm = '00:00',
  timeZone = MATCH_TIMEZONE_AR,
) => {
  const dateRaw = String(yyyyMmDd || '').trim();
  const timeRaw = String(hhmm || '00:00').trim().replace('.', ':');
  const dateMatch = dateRaw.match(DATE_RE);
  const timeMatch = timeRaw.match(TIME_RE);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || 0);
  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || !Number.isFinite(hour)
    || !Number.isFinite(minute)
    || !Number.isFinite(second)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return null;
  }

  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const firstOffsetMs = getTimeZoneOffsetMs(timeZone, new Date(utcGuessMs));
  let resolvedUtcMs = utcGuessMs - firstOffsetMs;

  const secondOffsetMs = getTimeZoneOffsetMs(timeZone, new Date(resolvedUtcMs));
  if (secondOffsetMs !== firstOffsetMs) {
    resolvedUtcMs = utcGuessMs - secondOffsetMs;
  }

  const resolved = new Date(resolvedUtcMs);
  if (Number.isNaN(resolved.getTime())) return null;
  return resolved;
};

export const weekdayFromYMD = (yyyyMmDd) => {
  const dt = parseLocalDate(yyyyMmDd);
  return dt ? dt.getDay() : 0; // 0=Domingo
};

export const formatLocalDateShort = (yyyyMmDd) => {
  const dt = parseLocalDate(yyyyMmDd);
  return dt.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
};

export const formatLocalDM = (yyyyMmDd) => {
  const dt = parseLocalDate(yyyyMmDd);
  return dt.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
};
