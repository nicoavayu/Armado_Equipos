import { distanceInMeters } from '../services/locationService';
import { hasValidCoordinates, toCoordinateNumber } from './matchLocation';
import { getProfilePositions, GOALKEEPER_POSITION } from './positions';

/**
 * Whether a profile is eligible for the goalkeeper market: it lists ARQ among
 * its positions AND has explicitly opted in with "disponible para atajar".
 * @param {object} profile
 * @returns {boolean}
 */
export const isGoalkeeperMarketEligible = (profile) => (
  Boolean(profile)
  && profile.disponible_arquero === true
  && getProfilePositions(profile).includes(GOALKEEPER_POSITION)
);

/**
 * Distance in km from a user location to a profile, or null when either side
 * lacks valid coordinates. Uses the SAME haversine helper as the Jugadores tab.
 * @param {?{lat:number,lng:number}} userLocation
 * @param {object} profile
 * @returns {?number}
 */
export const goalkeeperDistanceKm = (userLocation, profile) => {
  if (!userLocation || !hasValidCoordinates(profile?.latitud, profile?.longitud)) return null;
  const meters = distanceInMeters(
    userLocation.lat,
    userLocation.lng,
    toCoordinateNumber(profile.latitud),
    toCoordinateNumber(profile.longitud),
  );
  return Number.isFinite(meters) ? meters / 1000 : null;
};

/**
 * Build the ordered goalkeeper-market list:
 *  - keeps only ARQ + available profiles,
 *  - excludes the current user,
 *  - drops profiles whose (known) distance exceeds the radius,
 *  - keeps profiles without coordinates (shown last),
 *  - orders nearest-first (unknown distance sorts last).
 *
 * @param {object} params
 * @param {object[]} params.goalkeepers
 * @param {?{lat:number,lng:number}} [params.userLocation]
 * @param {?number} [params.maxDistanceKm]
 * @param {?string} [params.currentUserId]
 * @returns {Array<object & {distanceKm: ?number}>}
 */
export const buildGoalkeeperMarket = ({
  goalkeepers,
  userLocation = null,
  maxDistanceKm = null,
  currentUserId = null,
}) => {
  const list = Array.isArray(goalkeepers) ? goalkeepers : [];
  const hasRadius = Boolean(userLocation) && maxDistanceKm != null && Number.isFinite(Number(maxDistanceKm));

  return list
    .filter(isGoalkeeperMarketEligible)
    .filter((gk) => {
      const id = gk.user_id || gk.id || gk.uuid;
      return !currentUserId || String(id) !== String(currentUserId);
    })
    .map((gk) => ({ ...gk, distanceKm: goalkeeperDistanceKm(userLocation, gk) }))
    .filter((gk) => {
      // A known distance beyond the radius is out; unknown distance stays in.
      if (!hasRadius) return true;
      if (gk.distanceKm == null) return true;
      return gk.distanceKm <= Number(maxDistanceKm);
    })
    .sort((a, b) => {
      const aHas = Number.isFinite(a.distanceKm);
      const bHas = Number.isFinite(b.distanceKm);
      if (aHas && bHas) return a.distanceKm - b.distanceKm;
      if (aHas) return -1;
      if (bHas) return 1;
      return 0;
    });
};
