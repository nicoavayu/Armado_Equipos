import { isStagingV1Operation } from './stagingV1Scope';
import { isStagingV1Table } from './stagingV1Tables';
import { TorneosBoundaryError } from './errors';

export { TorneosBoundaryError };

// PostgREST resolves an RPC by the exact set of named arguments it receives and the
// baseline functions declare no defaults: an argument left `undefined` by a page
// (JSON drops it) would make the whole call unresolvable (PGRST202). Every declared
// argument therefore travels, as an explicit null when the page has no value.
export function normalizeRpcParams(params) {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, value === undefined ? null : value]));
}

// The client is the scope boundary: an operation outside staging v1 never reaches
// the transport, and without a transport nothing reaches the network at all. No
// auth object, token, storage, realtime or Core client lives here.
export function createTorneosClient({ transport = null } = {}) {
  const connected = Boolean(transport) && typeof transport.rpc === 'function';
  return Object.freeze({
    status: connected ? 'connected' : 'foundation-disabled',
    async execute(operation, params = {}, options = {}) {
      if (!isStagingV1Operation(operation)) {
        throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      }
      if (!connected) throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      return transport.rpc(operation, normalizeRpcParams(params), options);
    },
    async select(table, query = {}, options = {}) {
      if (!isStagingV1Table(table)) {
        throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      }
      if (!connected || typeof transport.select !== 'function') {
        throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      }
      return transport.select(table, query, options);
    },
    clear() { transport?.clear?.(); },
    dispose() { transport?.dispose?.(); },
  });
}
