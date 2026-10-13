/**
 * 0018 — the season's media lifecycle as the server states it (get_effective_tournament_season_entitlements and
 * get_tournament_season_media_usage carry `seasonLifecycle`). A season lasts at most six months from its explicit
 * activation; its photos and thumbnails are removed when it ends. The client never computes a deadline itself: it only
 * shows the one the server sent, in Buenos Aires time.
 */

const STATUSES = new Set(['draft', 'active', 'completed', 'archived']);
const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const isoOrNull = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);

export function normalizeSeasonLifecycle(raw) {
  if (!raw || typeof raw !== 'object' || !STATUSES.has(raw.status)) return null;
  return {
    status: raw.status,
    activatedAt: isoOrNull(raw.activatedAt),
    mediaDeadlineAt: isoOrNull(raw.mediaDeadlineAt),
    activationBasis: raw.activationBasis === 'explicit' || raw.activationBasis === 'migration_0018' ? raw.activationBasis : null,
    mediaOpen: raw.mediaOpen === true,
    // Photos readable and downloadable until the deletion moment, even for a season that is already closed to uploads.
    mediaReadable: raw.mediaReadable === true,
    maxMonths: Number.isInteger(raw.maxMonths) ? raw.maxMonths : 6,
    photosPendingDeletion: Number.isInteger(raw.photosPendingDeletion) ? raw.photosPendingDeletion : 0,
  };
}

/** «15/09/2026 a las 20:00» in Buenos Aires, or '' for a missing date. */
export function formatSeasonDeadline(iso) {
  const time = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(time)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('es-AR', {
    timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} a las ${parts.hour}:${parts.minute}`;
}

/** The plain sentence about the deadline, for Mi plan and Multimedia. Never promises more than the server said. */
export function seasonDeadlineCopy(lifecycle) {
  if (!lifecycle) return '';
  const when = formatSeasonDeadline(lifecycle.mediaDeadlineAt);
  if (lifecycle.status === 'draft' || !when) {
    return `La temporada dura hasta ${lifecycle.maxMonths} meses desde que la actives.`;
  }
  if (!lifecycle.mediaOpen && lifecycle.mediaReadable) {
    return `La temporada terminó: no se suben fotos nuevas. Sus fotos y miniaturas se eliminan el ${when}.`;
  }
  if (!lifecycle.mediaOpen) return 'La temporada terminó y sus fotos y miniaturas se eliminaron.';
  return `La temporada vence el ${when}: dura hasta ${lifecycle.maxMonths} meses desde que la activaste.`;
}

export const SEASON_MEDIA_DELETION_COPY = 'Al terminar la temporada se eliminan sus fotos y miniaturas. Los resultados, tablas e historial se conservan.';
