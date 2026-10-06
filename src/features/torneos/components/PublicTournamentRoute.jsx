import React, { useMemo } from 'react';
import PublicTournamentPage from './PublicTournamentPage';
import { publicTournamentService } from '../api/publicTournamentService';
import { torneosFeatureFlags } from '../config/featureFlags';
import { resolvePublicCatalogService, resolvePublicTournamentService } from '../stagingV1/publicTournamentComposition';
import { publicCatalogService } from '../api/publicCatalogService';

// The anonymous public tournament page, composed like /torneos: the gateway's public route in the
// hybrid composition, the legacy service only on the LOCAL single-project stack, and a closed
// service (every slug "not found", no request at all) whenever Torneos or its public pages are off.
export default function PublicTournamentRoute({ flags = torneosFeatureFlags, env = process.env }) {
  const service = useMemo(
    () => resolvePublicTournamentService({ env, flags, legacyService: publicTournamentService }),
    [env, flags],
  );
  // CONNECTED-V1: the call for teams of this tournament, when it is listed (closed service → no call, no request).
  const catalogService = useMemo(
    () => resolvePublicCatalogService({ env, flags, legacyService: publicCatalogService }),
    [env, flags],
  );
  return <PublicTournamentPage service={service} catalogService={catalogService.mode === 'closed' ? null : catalogService} />;
}
