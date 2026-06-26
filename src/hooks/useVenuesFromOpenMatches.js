import { useMemo } from 'react';
import { groupVenuesFromOpenMatches } from '../utils/venuesFromOpenMatches';

/**
 * Memoized venue grouping for the Jugar > PARTIDOS "Mapa" view.
 * Thin wrapper over the pure {@link groupVenuesFromOpenMatches} helper so the
 * map only recomputes venues when the match list identity changes.
 *
 * @param {Array<object>} matches Open matches as returned by the open-matches RPC.
 * @returns {{ venues: Array<object>, unmappableMatches: Array<object>, unmappableCount: number }}
 */
export const useVenuesFromOpenMatches = (matches) => useMemo(
  () => groupVenuesFromOpenMatches(matches),
  [matches],
);

export default useVenuesFromOpenMatches;
