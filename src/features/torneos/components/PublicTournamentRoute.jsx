import React, { useMemo } from 'react';
import PublicTournamentPage from './PublicTournamentPage';
import { publicTournamentService } from '../api/publicTournamentService';
import { torneosFeatureFlags } from '../config/featureFlags';
import { resolvePublicCatalogService, resolvePublicTournamentService } from '../stagingV1/publicTournamentComposition';
import { publicCatalogService } from '../api/publicCatalogService';
import { createContentReportService } from '../stagingV1/contentReportService';

// The anonymous public tournament page, composed like /torneos: the gateway's public route in the
// hybrid composition, the legacy service only on the LOCAL single-project stack, and a closed
// service (every slug "not found", no request at all) whenever Torneos or its public pages are off.
// Read once: the browser bundle replaces `process.env` with a new object literal wherever it is read, so a default
// of `process.env` would rebuild both services on every render of this route.
const BUILD_ENV = process.env;

export default function PublicTournamentRoute({ flags = torneosFeatureFlags, env = BUILD_ENV }) {
  const service = useMemo(
    () => resolvePublicTournamentService({ env, flags, legacyService: publicTournamentService }),
    [env, flags],
  );
  // CONNECTED-V1: the call for teams of this tournament, when it is listed (closed service → no call, no request).
  const catalogService = useMemo(
    () => resolvePublicCatalogService({ env, flags, legacyService: publicCatalogService }),
    [env, flags],
  );
  // MODERATION (0022): «Reportar contenido» with a session, by the same composition rule (null → sign in / email only).
  const reportService = useMemo(
    () => (service.mode === 'closed' ? null : createContentReportService({ env })),
    [env, service],
  );
  return (
    <PublicTournamentPage
      service={service}
      catalogService={catalogService.mode === 'closed' ? null : catalogService}
      reportService={reportService}
    />
  );
}
