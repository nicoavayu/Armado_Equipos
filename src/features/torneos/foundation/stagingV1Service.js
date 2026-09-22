import { stagingV1Scope } from './stagingV1Scope';
import { createTorneosClient } from './torneosClient';

// Narrow services grouped by approved feature. No generic RPC or Core fallback.
// Methods accept existing RPC parameter objects. The UI does not consume this
// shape: the staging-v1 workspace adapter (src/features/torneos/stagingV1) maps
// the legacy aliases onto `client.execute` instead.
export function createStagingV1Service({ transport = null } = {}) {
  const client = createTorneosClient({ transport });
  return Object.freeze(Object.fromEntries(
    Object.entries(stagingV1Scope).map(([feature, operations]) => [
      feature,
      Object.freeze(Object.fromEntries(operations.map((operation) => [
        operation, (params = {}, options = {}) => client.execute(operation, params, options),
      ]))),
    ]),
  ));
}
