import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

const ICS_MIME_TYPE = 'text/calendar;charset=utf-8';
const GOOGLE_CALENDAR_EVENT_URL = 'https://calendar.google.com/calendar/render';
export const DEFAULT_MATCH_DURATION_MIN = 90;

const pad = (value) => String(value).padStart(2, '0');

const toUtcStamp = (date) => [
  date.getUTCFullYear(),
  pad(date.getUTCMonth() + 1),
  pad(date.getUTCDate()),
].join('') + 'T' + [
  pad(date.getUTCHours()),
  pad(date.getUTCMinutes()),
  pad(date.getUTCSeconds()),
].join('') + 'Z';

const toLocalStamp = (date) => [
  date.getFullYear(),
  pad(date.getMonth() + 1),
  pad(date.getDate()),
].join('') + 'T' + [
  pad(date.getHours()),
  pad(date.getMinutes()),
  pad(date.getSeconds()),
].join('');

const normalizeText = (value) => String(value || '')
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .trim();

const escapeIcsText = (value) => normalizeText(value)
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

const toShortVenue = (value) => normalizeText(value)
  .replace(/\bCP\s*[A-Z]?\d{4,}[A-Z0-9-]*\b/gi, '')
  .replace(/\b[A-Z]?\d{4,}[A-Z0-9-]*\b/g, '')
  .replace(/\bargentina\b/gi, '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean)[0] || '';

const parseMatchStart = (fechaRaw, horaRaw) => {
  const fecha = String(fechaRaw || '').trim().slice(0, 10);
  const hora = String(horaRaw || '').trim().slice(0, 5);
  if (!fecha) return null;
  const safeHora = /^\d{2}:\d{2}$/.test(hora) ? hora : '00:00';
  const parsed = new Date(`${fecha}T${safeHora}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatFileDate = (date) => {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}${m}${d}-${hh}${mm}`;
};

const buildMatchCalendarEvent = (match, {
  durationMinutes = DEFAULT_MATCH_DURATION_MIN,
} = {}) => {
  const startAt = parseMatchStart(match?.fecha, match?.hora);
  if (!startAt) {
    throw new Error('Partido sin fecha/hora válida para calendario');
  }

  const safeDuration = Math.max(1, Number(durationMinutes) || DEFAULT_MATCH_DURATION_MIN);
  const endAt = new Date(startAt.getTime() + safeDuration * 60 * 1000);
  const shortVenue = toShortVenue(match?.sede);
  const summary = normalizeText(match?.nombre) || (shortVenue ? `Partido - ${shortVenue}` : 'Partido');
  const location = shortVenue || 'Sede a confirmar';
  const description = [
    `Fecha: ${String(match?.fecha || '').trim() || 'A confirmar'}`,
    `Hora: ${String(match?.hora || '').trim() || 'A confirmar'}`,
    `Sede: ${location}`,
  ].join('\n');
  const uid = `${String(match?.id || 'match')}-${startAt.getTime()}@arma2.app`;
  const fileName = `arma2-partido-${formatFileDate(startAt)}.ics`;

  return {
    startAt,
    endAt,
    summary,
    location,
    description,
    uid,
    fileName,
  };
};

const getResolvedCalendarTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (_error) {
    return '';
  }
};

export const buildMatchCalendarIcs = (match, options) => {
  const {
    startAt,
    endAt,
    summary,
    location,
    description,
    uid,
    fileName,
  } = buildMatchCalendarEvent(match, options);

  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ARMA2//Partidos//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toLocalStamp(startAt)}`,
    `DTEND:${toLocalStamp(endAt)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  return {
    content,
    fileName,
  };
};

export const buildGoogleCalendarUrl = (match, options) => {
  const {
    startAt,
    endAt,
    summary,
    location,
    description,
  } = buildMatchCalendarEvent(match, options);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary,
    dates: `${toUtcStamp(startAt)}/${toUtcStamp(endAt)}`,
    location,
    details: description,
  });

  const timeZone = getResolvedCalendarTimeZone();
  if (timeZone) {
    params.set('ctz', timeZone);
  }

  return `${GOOGLE_CALENDAR_EVENT_URL}?${params.toString()}`;
};

export const shareOrDownloadCalendarIcs = async ({ content, fileName, title = 'Agregar al calendario' }) => {
  if (!content || !fileName) {
    throw new Error('Archivo de calendario inválido');
  }

  const blob = new Blob([content], { type: ICS_MIME_TYPE });

  if (typeof File !== 'undefined' && navigator?.share && navigator?.canShare) {
    try {
      const file = new File([blob], fileName, { type: ICS_MIME_TYPE });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title, files: [file] });
        return { method: 'share' };
      }
    } catch (_shareError) {
      // Fallback to download
    }
  }

  const objectUrl = window.URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => {
      window.URL.revokeObjectURL(objectUrl);
    }, 1000);
  }

  return { method: 'download' };
};

const openGoogleCalendarUrl = async (url) => {
  if (!url) {
    throw new Error('URL de Google Calendar inválida');
  }

  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return { method: 'google_calendar' };
  }

  if (typeof window !== 'undefined') {
    if (typeof window.open === 'function') {
      const openedWindow = window.open(url, '_blank');
      if (openedWindow) {
        try {
          openedWindow.opener = null;
        } catch (_error) {
          // Ignore cross-origin restrictions after opening the tab.
        }
        return { method: 'google_calendar' };
      }
    }

    if (window.location?.assign) {
      window.location.assign(url);
      return { method: 'google_calendar' };
    }
  }

  throw new Error('No se pudo abrir Google Calendar');
};

export const openMatchCalendarInvite = async (match, options) => {
  try {
    const googleCalendarUrl = buildGoogleCalendarUrl(match, options);
    return await openGoogleCalendarUrl(googleCalendarUrl);
  } catch (_googleCalendarError) {
    const { content, fileName } = buildMatchCalendarIcs(match, options);
    return shareOrDownloadCalendarIcs({
      content,
      fileName,
      title: 'Agregar al calendario',
    });
  }
};
