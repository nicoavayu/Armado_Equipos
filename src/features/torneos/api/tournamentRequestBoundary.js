import { withTimeout } from '../../../utils/promiseTimeout';

export const DEFAULT_TOURNAMENT_REQUEST_TIMEOUT_MS = 12_000;
const TOURNAMENT_REQUEST_TIMEOUT_MESSAGE = 'La solicitud tardó demasiado. Revisá la conexión y volvé a intentar.';

export function createRecoverableTournamentService(
  service,
  timeoutMs = DEFAULT_TOURNAMENT_REQUEST_TIMEOUT_MS,
) {
  if (!service) return service;

  return Object.freeze(Object.fromEntries(
    Object.entries(service).map(([name, value]) => {
      if (
        typeof value !== 'function'
        || name === 'createIdempotencyKey'
        || name === 'resolveTeamShieldUrl'
      ) {
        return [name, value];
      }
      return [name, (...args) => {
        try {
          return withTimeout(
            value.apply(service, args),
            timeoutMs,
            TOURNAMENT_REQUEST_TIMEOUT_MESSAGE,
          );
        } catch (error) {
          return Promise.reject(error);
        }
      }];
    }),
  ));
}
