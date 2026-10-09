// The Torneos inbox summary read from OUTSIDE Torneos (the space selector, while the person is in Core), with the same
// composition rule as the app: the gateway in the hybrid composition (only with the connected opt-in), the LOCAL
// single-project service on the QA stack, nothing anywhere else. One aggregated, read-only RPC; no Torneos provider,
// page or listener is mounted. The person's Core session reaches the gateway through the same read-only bridge.
import { resolveTorneosBackendMode, resolveTorneosConnectedProduct } from '../foundation/config';
import { createTorneosClient } from '../foundation/torneosClient';
import { createTorneosTransport } from '../foundation/torneosTransport';
import { loadTorneosInboxSummary } from '../api/tournamentWorkspaceService';
import { createCoreSessionBridge } from './coreSessionBridge';

export function createTorneosInboxProbe({ env = process.env } = {}) {
  const backendMode = resolveTorneosBackendMode(env);
  if (!resolveTorneosConnectedProduct(env, { backendMode })) return null;
  if (backendMode.mode === 'legacy-local') {
    return Object.freeze({ load: () => loadTorneosInboxSummary() });
  }
  if (backendMode.mode !== 'hybrid' || !backendMode.gatewayUrl) return null;
  const bridge = createCoreSessionBridge();
  const transport = createTorneosTransport({
    gatewayUrl: backendMode.gatewayUrl,
    getCoreAccessToken: bridge.getCoreAccessToken,
    onCoreAuthChange: bridge.onCoreAuthChange,
  });
  const client = createTorneosClient({ transport, connected: true });
  return Object.freeze({
    load: () => client.execute('get_my_torneos_inbox_summary', {}),
  });
}
