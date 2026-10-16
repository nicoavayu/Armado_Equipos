// MODERATION (0022): «Reportar» from OUTSIDE the Torneos shell (the public tournament page and its call for teams), with the
// same composition rule as the app: the gateway in the hybrid composition (only with the connected opt-in), the LOCAL
// single-project service on the QA stack, nothing anywhere else. Reporting needs a session — there is no anonymous write
// route — so the page first asks `isSignedIn()`; without a session it offers to sign in or to write an email. The person's
// Core session reaches the gateway through the same read-only bridge as the inbox probe.
import { resolveTorneosBackendMode, resolveTorneosConnectedProduct } from '../foundation/config';
import { createTorneosClient } from '../foundation/torneosClient';
import { createTorneosTransport } from '../foundation/torneosTransport';
import { reportTournamentContent } from '../api/tournamentWorkspaceService';
import { reportContentParams } from '../domain/contentModeration';
import { createCoreSessionBridge } from './coreSessionBridge';
import { translateBoundaryError } from './stagingV1WorkspaceService';

export function createContentReportService({ env = process.env, bridge = null, fetchImpl } = {}) {
  const backendMode = resolveTorneosBackendMode(env);
  if (!resolveTorneosConnectedProduct(env, { backendMode })) return null;
  const session = bridge || createCoreSessionBridge();
  const isSignedIn = async () => Boolean(await session.getCoreAccessToken().catch(() => null));
  if (backendMode.mode === 'legacy-local') {
    return Object.freeze({ mode: 'legacy-local', isSignedIn, report: (input) => reportTournamentContent(input) });
  }
  if (backendMode.mode !== 'hybrid' || !backendMode.gatewayUrl) return null;
  let client = null;
  const clientOf = () => {
    if (!client) {
      const transport = createTorneosTransport({
        gatewayUrl: backendMode.gatewayUrl,
        getCoreAccessToken: session.getCoreAccessToken,
        onCoreAuthChange: session.onCoreAuthChange,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
      client = createTorneosClient({ transport, connected: true });
    }
    return client;
  };
  return Object.freeze({
    mode: 'hybrid',
    isSignedIn,
    async report(input) {
      let params;
      try {
        params = reportContentParams(input);
      } catch (error) {
        throw translateBoundaryError(error, error.message);
      }
      try {
        return await clientOf().execute('report_tournament_content', params);
      } catch (error) {
        throw translateBoundaryError(error, 'No pudimos enviar el reporte.');
      }
    },
  });
}
