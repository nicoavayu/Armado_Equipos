import { useMemo } from 'react';
import { torneosFeatureFlags } from '../../config/featureFlags';
import { publicCatalogService } from '../../api/publicCatalogService';
import { resolvePublicCatalogService } from '../../stagingV1/publicTournamentComposition';

// Read once: the browser bundle replaces `process.env` with a new object literal wherever it is read, so a default
// of `process.env` would change on every render and rebuild the gateway service (and reload the page) each time.
const BUILD_ENV = process.env;

// Explorar torneos reads the same safe public projection inside the app and on the public web: the gateway's
// public route in the hybrid composition, the LOCAL stack's public RPCs in legacy-local, nothing otherwise.
export function useCatalogService({ flags = torneosFeatureFlags, env = BUILD_ENV } = {}) {
  return useMemo(
    () => resolvePublicCatalogService({ env, flags, legacyService: publicCatalogService }),
    [env, flags],
  );
}
