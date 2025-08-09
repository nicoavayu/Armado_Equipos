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