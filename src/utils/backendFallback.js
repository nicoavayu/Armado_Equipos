// Strict feature-detection helpers for the security-patch rollout.
//
// During the rollout window (secure client shipped before the Stage A backend
// objects are guaranteed live), the client may fall back to a legacy path ONLY
// when the backend object is PROVABLY ABSENT:
//   * an RPC that does not exist yet  -> PostgREST error code 'PGRST202';
//   * an Edge Function not deployed   -> HTTP 404.
//
// It must NEVER fall back on 401/403, validation rejections, business errors,
// rate limiting (429) or SQL errors — those are real answers from a deployed
// object and the caller must surface them. See PR rollout notes / plan §Rollout.

/**
 * True only when a supabase.rpc(...) error means the function is not defined
 * in the database yet (PostgREST "function not found").
 * @param {{ code?: string, message?: string } | null | undefined} error
 * @returns {boolean}
 */
export const isMissingRpcError = (error) => {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  // Some gateway configurations omit the code but keep the canonical message.
  const message = String(error.message || '').toLowerCase();
  return (
    error.code === undefined
    && message.includes('could not find the function')
  );
};

/**
 * True only when a supabase.functions.invoke(...) error means the Edge Function
 * is not deployed (HTTP 404). Works with FunctionsHttpError (error.context is a
 * Response) and with a raw fetch Response.
 * @param {*} errorOrResponse
 * @returns {boolean}
 */
export const isMissingEdgeFunctionError = (errorOrResponse) => {
  if (!errorOrResponse) return false;
  const status = errorOrResponse.status
    ?? errorOrResponse.context?.status
    ?? errorOrResponse.response?.status;
  return Number(status) === 404;
};
