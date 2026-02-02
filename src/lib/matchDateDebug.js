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
