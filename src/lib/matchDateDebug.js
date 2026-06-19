/**
 * Debug-mode helpers for match date/time validation.
 * Ultra-permissive: only block matches >1min in the past.
 */

/**
 * Normalize time string to HH:mm format
 * @param {string} timeStr - Time in "HH:mm" or "HH:mm:ss" format
 * @returns {string|null} - Normalized "HH:mm" or null if invalid
 */
export function normalizeTimeHHmm(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

/**
 * Build a local DateTime from date and time strings
 * @param {string} dateStr - Date in "YYYY-MM-DD" format
 * @param {string} timeStr - Time in "HH:mm" or "HH:mm:ss" format
 * @returns {Date|null} - Date object or null if invalid
 */
export function buildLocalDateTime(dateStr, timeStr) {
  const t = normalizeTimeHHmm(timeStr);
  if (!t) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  if (![y,m,d,hh,mm].every(Number.isFinite)) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * Check if match is blocked (in the past beyond grace period)
 * @param {string} dateStr - Date in "YYYY-MM-DD" format
 * @param {string} timeStr - Time in "HH:mm" or "HH:mm:ss" format
 * @param {number} graceMs - Grace period in milliseconds (default 60000 = 1 minute)
 * @returns {boolean} - True if blocked, false if allowed
 */
export function isBlockedInDebug(dateStr, timeStr, graceMs = 60_000) {
  const match = buildLocalDateTime(dateStr, timeStr);
  if (!match) return false; // debug: si no puedo parsear, NO bloqueo
  const now = new Date();
  return match.getTime() < (now.getTime() - graceMs);
}

// --- Allowed booking window -------------------------------------------------
// Matches can only be scheduled within sane hours: from 07:00 up to and
// including midnight (00:00). Anything strictly between 00:01 and 06:59 is
// rejected so nobody can accidentally create a 3 AM match. Midnight (00:00) is
// treated as the upper boundary ("hasta las 00:00") and is allowed.

/** First selectable time-of-day (minutes from midnight): 07:00. */
export const MATCH_TIME_MIN = '07:00';
/** Last 15-min slot before midnight, used as the <input type="time"> max. */
export const MATCH_TIME_MAX = '23:59';
/** User-facing message when a time falls outside the allowed window. */
export const MATCH_TIME_RANGE_MESSAGE = 'Elegí un horario entre las 07:00 y las 00:00.';

/**
 * Whether a time-of-day is inside the allowed booking window (07:00–00:00).
 * Midnight (00:00) counts as the closing boundary and is allowed; 00:01–06:59
 * are blocked.
 * @param {string} timeStr - Time in "HH:mm" or "HH:mm:ss" format
 * @returns {boolean} - True if allowed, false otherwise
 */
export function isAllowedMatchTime(timeStr) {
  const normalized = normalizeTimeHHmm(timeStr);
  if (!normalized) return false;
  const [hh, mm] = normalized.split(':').map(Number);
  const minutes = hh * 60 + mm;
  if (minutes === 0) return true; // 00:00 = midnight boundary
  return minutes >= 7 * 60; // 07:00 onwards
}

/**
 * Get debug info for logging (temporary)
 * @param {string} dateStr - Date in "YYYY-MM-DD" format
 * @param {string} timeStr - Time in "HH:mm" or "HH:mm:ss" format
 * @returns {object} - Debug info object
 */
export function getDebugInfo(dateStr, timeStr) {
  const match = buildLocalDateTime(dateStr, timeStr);
  const now = new Date();
  
  if (!match) {
    return {
      valid: false,
      nowLocal: now.toLocaleString('es-AR'),
      matchLocal: 'INVALID',
      deltaMs: null,
    };
  }
  
  return {
    valid: true,
    nowLocal: now.toLocaleString('es-AR'),
    matchLocal: match.toLocaleString('es-AR'),
    deltaMs: match.getTime() - now.getTime(),
  };
}
