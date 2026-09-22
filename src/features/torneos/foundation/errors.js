// Errors raised by the Torneos foundation. Every failure between the UI and the
// gateway surfaces as one of these codes; the staging-v1 adapter translates them
// into the workspace error copy. `rpcError` carries the PostgREST/adapter error
// body untouched ({ message, code, details, hint }) so the legacy code lookup keeps
// working without re-mapping 190 codes here.
export const TORNEOS_BOUNDARY_CODES = Object.freeze([
  // client-side, before any network
  'TORNEOS_OUTSIDE_STAGING_V1',
  'TORNEOS_TRANSPORT_NOT_CONNECTED',
  'TORNEOS_TRANSPORT_DISPOSED',
  'TORNEOS_INVALID_REQUEST',
  'CORE_AUTH_REQUIRED',
  // exchange
  'TORNEOS_EXCHANGE_DENIED',
  // gateway / dependencies
  'CORE_UNAVAILABLE',
  'TORNEOS_UNAVAILABLE',
  'TORNEOS_SESSION_INVALID',
  'TORNEOS_FORBIDDEN',
  'TORNEOS_RATE_LIMITED',
  // PostgREST / adapter passthrough
  'TORNEOS_RPC_ERROR',
]);

export class TorneosBoundaryError extends Error {
  constructor(code, { status = null, cause = null, rpcError = null, gatewayError = null } = {}) {
    super(code);
    this.name = 'TorneosBoundaryError';
    this.code = code;
    this.status = status;
    this.cause = cause;
    this.rpcError = rpcError;
    this.gatewayError = gatewayError;
  }
}

export const isTorneosBoundaryError = (error) => error instanceof TorneosBoundaryError
  || (Boolean(error) && error.name === 'TorneosBoundaryError' && typeof error.code === 'string');
