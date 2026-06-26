import {
  hasValidCoordinates,
  normalizePlaceId,
  toCoordinateNumber,
} from './matchLocation';
import { formatVenueShort } from './venueFormat';

// Phase A — venue grouping for the Jugar > PARTIDOS "Mapa" view.
//
// These helpers are PURE (no MapLibre / DOM dependency) so they can be unit
// tested and reused. They only consume data already returned by the existing
// open-matches RPC/view (sede_place_id, sede_latitud, sede_longitud, sede,
// sedeMaps, falta_jugadores, cupo_jugadores, jugadores_count, modalidad,
// tipo_partido, kickoff_at, fecha, hora). No new backend fields are required.

// ~11 m grid. Matches without a Google place_id fall back to this rounded-coord
// key so near-identical pins still collapse into a single venue.
const COORD_FALLBACK_PRECISION = 4;
const COORD_FALLBACK_FACTOR = 10 ** COORD_FALLBACK_PRECISION;

const roundCoord = (value) => Math.round(value * COORD_FALLBACK_FACTOR) / COORD_FALLBACK_FACTOR;

/**
 * Returns `{ lat, lng }` for a match when it carries valid coordinates, else null.
 * Matches without valid coordinates cannot be placed on the map (but stay in Lista).
 */
export const getMatchCoordinates = (match) => {
  const lat = toCoordinateNumber(match?.sede_latitud ?? match?.latitud);
  const lng = toCoordinateNumber(match?.sede_longitud ?? match?.longitud);
  if (!hasValidCoordinates(lat, lng)) return null;
  return { lat, lng };
};

/**
 * Stable grouping key for a match's venue.
 * Prefers the Google Place ID (the natural venue identity); when absent, falls
 * back to rounded coordinates. Returns null when the match has no valid
 * coordinates — such matches are not mappable.
 */
export const getVenueKey = (match) => {
  const coords = getMatchCoordinates(match);
  if (!coords) return null;

  const placeId = normalizePlaceId(match?.sede_place_id);
  if (placeId) return `place:${placeId}`;

  return `geo:${roundCoord(coords.lat)},${roundCoord(coords.lng)}`;
};

const buildVenueLabel = (match) => {
  const short = formatVenueShort({
    name: match?.sede,
    sede: match?.sede,
    address: match?.sede_direccion_normalizada,
  });
  return short || String(match?.sede || match?.sede_direccion_normalizada || 'Sede sin nombre').trim() || 'Sede sin nombre';
};

/**
 * Phase A goalkeeper-need detector. There is currently NO honest match-level
 * "missing goalkeeper" field in the open-match payload (per the feature audit:
 * per-player `is_goalkeeper` is a balancing artifact, `falta_jugadores` is
 * generic, `sin_arquero_fijo` is survey-only). To avoid false positives this
 * returns true ONLY when an explicit opt-in flag exists and is true. Until that
 * field is added (Phase B: `partidos.busca_arquero`) it is always false, so the
 * UI never shows a fabricated "needs GK" state.
 *
 * @param {object} match
 * @returns {boolean}
 */
export const matchNeedsGoalkeeper = (match) => (
  match?.busca_arquero === true || match?.necesita_arquero === true
);

const buildVenue = (key, matches) => {
  const mappable = matches.filter((match) => getMatchCoordinates(match));
  const first = mappable[0] || matches[0];

  // Centroid of the member coordinates keeps the pin steady even if rows for the
  // same place_id carry slightly different lat/lng.
  const coordsList = mappable.map(getMatchCoordinates);
  const lat = coordsList.reduce((sum, c) => sum + c.lat, 0) / coordsList.length;
  const lng = coordsList.reduce((sum, c) => sum + c.lng, 0) / coordsList.length;

  return {
    key,
    placeId: normalizePlaceId(first?.sede_place_id),
    lat,
    lng,
    label: buildVenueLabel(first),
    sede: String(first?.sede || first?.sede_direccion_normalizada || '').trim(),
    sedeMaps: first?.sedeMaps ?? null,
    matches,
    activeMatchCount: matches.length,
    needsGoalkeeper: matches.some(matchNeedsGoalkeeper),
  };
};

/**
 * Groups a list of open matches into mappable venues.
 *
 * - Groups by `sede_place_id` when present, otherwise by rounded coordinates.
 * - Matches without valid coordinates are excluded from the venues and reported
 *   via `unmappableMatches` / `unmappableCount` (they still belong in Lista).
 * - Venue order follows first appearance so the result is deterministic.
 *
 * @param {Array<object>} matches
 * @returns {{ venues: Array<object>, unmappableMatches: Array<object>, unmappableCount: number }}
 */
export const groupVenuesFromOpenMatches = (matches) => {
  const list = Array.isArray(matches) ? matches : [];
  const order = [];
  const byKey = new Map();
  const unmappableMatches = [];

  for (const match of list) {
    const key = getVenueKey(match);
    if (!key) {
      unmappableMatches.push(match);
      continue;
    }
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key).push(match);
  }

  const venues = order.map((key) => buildVenue(key, byKey.get(key)));

  return {
    venues,
    unmappableMatches,
    unmappableCount: unmappableMatches.length,
  };
};

/**
 * Total active matches across venues — NOT the venue count. A venue with 3 open
 * matches contributes 3. This is what cluster/pin badges must display.
 *
 * @param {Array<object>} venues
 * @returns {number}
 */
export const countActiveMatchesForVenues = (venues) => (
  (Array.isArray(venues) ? venues : []).reduce(
    (sum, venue) => sum + (Number(venue?.activeMatchCount) || 0),
    0,
  )
);

/**
 * Builds a GeoJSON FeatureCollection for MapLibre. Each feature is one venue
 * carrying its active-match count so clustering can SUM counts (active matches),
 * not merely count venues.
 *
 * @param {Array<object>} venues
 * @returns {{ type: 'FeatureCollection', features: Array<object> }}
 */
export const buildVenuesGeoJSON = (venues) => ({
  type: 'FeatureCollection',
  features: (Array.isArray(venues) ? venues : [])
    .filter((venue) => hasValidCoordinates(venue?.lat, venue?.lng))
    .map((venue) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [venue.lng, venue.lat],
      },
      properties: {
        venueKey: venue.key,
        matchCount: venue.activeMatchCount,
        needsGoalkeeper: venue.needsGoalkeeper ? 1 : 0,
        label: venue.label,
      },
    })),
});
