import { useMemo } from 'react';
import { torneosFeatureFlags } from '../../config/featureFlags';
import { publicCatalogService } from '../../api/publicCatalogService';
import { resolvePublicCatalogService } from '../../stagingV1/publicTournamentComposition';

// Explorar torneos reads the same safe public projection inside the app and on the public web: the gateway's
// public route in the hybrid composition, the LOCAL stack's public RPCs in legacy-local, nothing otherwise.
export function useCatalogService({ flags = torneosFeatureFlags, env = process.env } = {}) {
  return useMemo(
    () => resolvePublicCatalogService({ env, flags, legacyService: publicCatalogService }),
    [env, flags],
  );
}
