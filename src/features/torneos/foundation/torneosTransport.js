// The only module that talks to the Torneos gateway.
//
//   Core session (existing singleton, read-only)  →  POST /exchange  →  bridge bearer
//   bridge bearer  →  POST /torneos/rest/v1/rpc/<name> | GET /torneos/rest/v1/<table>
//
// Contract (gateway certified in R4/R5):
//   • exchange: bearer Core, empty body → { access_token, token_type:'Bearer', expires_in }.
//     There is no refresh endpoint: renewing means a new exchange with the current Core token.
//   • bearer invalid/absent or Core session inactive → 401 { error:'access denied' }
//   • RPC outside the allowlist → 403 { error:'rpc not enabled' } (before the session check)
//   • Core Auth / Torneos REST down → 503 { error:'access denied' }
//   • Core contract down → 503 { error:'CORE_UNAVAILABLE' }; adapter SQL fault → 503 TORNEOS_UNAVAILABLE
//   • adapter refusals → { error:'TORNEOS_*' } with 400/403/429; Core denial → { error:'CORE_DENIED' }
//   • everything else is a PostgREST passthrough ({ message, code, details, hint } on error)
//
// Rules this module enforces: the bearer lives in memory only, is never decoded and
// never persisted; a change of Core session discards it; every failure closes
// (no request goes anywhere but the gateway); one silent re-exchange on 401, never more.
import { TorneosBoundaryError } from './errors';

export const EXCHANGE_PATH = '/exchange';
export const REST_PATH = '/torneos/rest/v1';
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
// Renew before the gateway's own tolerance window would refuse the bearer.
export const BEARER_RENEWAL_MARGIN_MS = 20_000;
export const CORE_AUTH_EVENTS_THAT_CLEAR = Object.freeze([
  'SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED',
]);
const RPC_NAME = /^[a-z0-9_]{1,63}$/;
const TABLE_NAME = /^[a-z0-9_]{1,63}$/;

function withTimeout(ms, external) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms);
  if (typeof timer?.unref === 'function') timer.unref();
  const onExternalAbort = () => controller.abort(external.reason);
  if (external) {
    if (external.aborted) onExternalAbort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    release() {
      clearTimeout(timer);
      external?.removeEventListener?.('abort', onExternalAbort);
    },
  };
}

async function readBody(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  let text = '';
  try {
    text = await response.text();
  } catch {
    return { json: null, text: '' };
  }
  if (!text) return { json: null, text };
  if (/json/i.test(contentType) || /^[[{]/.test(text.trim())) {
    try {
      return { json: JSON.parse(text), text };
    } catch {
      return { json: null, text };
    }
  }
  return { json: null, text };
}

const gatewayErrorOf = (json) => (
  json && typeof json === 'object' && !Array.isArray(json) && typeof json.error === 'string'
    ? json.error
    : null
);
const postgrestErrorOf = (json) => (
  json && typeof json === 'object' && !Array.isArray(json) && typeof json.message === 'string'
    ? {
      message: json.message,
      code: typeof json.code === 'string' ? json.code : null,
      details: json.details ?? null,
      hint: json.hint ?? null,
    }
    : null
);

export function createTorneosTransport({
  gatewayUrl,
  getCoreAccessToken,
  onCoreAuthChange = null,
  fetchImpl = (...args) => window.fetch(...args),
  now = () => Date.now(),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof gatewayUrl !== 'string' || !/^https?:\/\//.test(gatewayUrl)) {
    throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
  }
  if (typeof getCoreAccessToken !== 'function') {
    throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
  }
  const base = gatewayUrl.replace(/\/$/, '');
  let cached = null;   // { token, coreToken, until }
  let pending = null;  // { coreToken, request }
  let generation = 0;
  let disposed = false;

  const clear = () => {
    generation += 1;
    cached = null;
    pending = null;
  };
  // Synchronous callback: never call another Auth method under GoTrue's lock.
  const unsubscribe = typeof onCoreAuthChange === 'function'
    ? onCoreAuthChange((event) => {
      if (!event || CORE_AUTH_EVENTS_THAT_CLEAR.includes(event)) clear();
    })
    : null;

  async function coreToken() {
    if (disposed) throw new TorneosBoundaryError('TORNEOS_TRANSPORT_DISPOSED');
    let token = null;
    try {
      token = await getCoreAccessToken();
    } catch (cause) {
      clear();
      throw new TorneosBoundaryError('CORE_AUTH_REQUIRED', { cause });
    }
    if (typeof token !== 'string' || !token) {
      clear();
      throw new TorneosBoundaryError('CORE_AUTH_REQUIRED');
    }
    return token;
  }

  async function exchange(token, started) {
    const { signal, release } = withTimeout(requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(`${base}${EXCHANGE_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch (cause) {
      throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { cause });
    } finally {
      release();
    }
    const { json } = await readBody(response);
    if (started !== generation || disposed) {
      throw new TorneosBoundaryError('CORE_AUTH_REQUIRED');
    }
    const gatewayError = gatewayErrorOf(json);
    if (response.status === 200) {
      const okShape = json && typeof json.access_token === 'string' && json.access_token
        && json.token_type === 'Bearer'
        && Number.isInteger(json.expires_in) && json.expires_in > 0;
      if (!okShape) throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: 200 });
      cached = { token: json.access_token, coreToken: token, until: now() + json.expires_in * 1000 };
      return cached.token;
    }
    if (response.status === 401) throw new TorneosBoundaryError('TORNEOS_EXCHANGE_DENIED', { status: 401, gatewayError });
    if (response.status === 403) throw new TorneosBoundaryError('TORNEOS_FORBIDDEN', { status: 403, gatewayError });
    if (response.status === 400) throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST', { status: 400, gatewayError });
    if (response.status === 429) throw new TorneosBoundaryError('TORNEOS_RATE_LIMITED', { status: 429, gatewayError });
    if (response.status === 503 && gatewayError === 'CORE_UNAVAILABLE') {
      throw new TorneosBoundaryError('CORE_UNAVAILABLE', { status: 503, gatewayError });
    }
    throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status: response.status, gatewayError });
  }

  async function bearer({ force = false } = {}) {
    const token = await coreToken();
    if (!force && cached?.coreToken === token && cached.until > now() + BEARER_RENEWAL_MARGIN_MS) {
      return cached.token;
    }
    if (force || pending?.coreToken !== token) {
      clear();
      const started = generation;
      const request = exchange(token, started);
      pending = { coreToken: token, request };
      request.finally(() => { if (pending?.request === request) pending = null; }).catch(() => {});
    }
    return pending.request;
  }

  async function send(method, path, { body = undefined, headers = {}, signal = undefined, attempt = 0 } = {}) {
    const token = await bearer({ force: attempt > 0 });
    const { signal: timed, release } = withTimeout(requestTimeoutMs, signal);
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: timed,
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      clear();
      throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { cause });
    } finally {
      release();
    }
    const { json } = await readBody(response);
    const { status } = response;
    if (status >= 200 && status < 300) {
      return { status, json, contentRange: response.headers?.get?.('content-range') || null };
    }
    const gatewayError = gatewayErrorOf(json);
    const rpcError = postgrestErrorOf(json);
    if (status === 401) {
      clear();
      // One silent renewal: the bearer may simply have aged past the gateway's TTL.
      if (attempt === 0) return send(method, path, { body, headers, signal, attempt: 1 });
      throw new TorneosBoundaryError('TORNEOS_SESSION_INVALID', { status, gatewayError });
    }
    if (status === 503) {
      clear();
      const code = gatewayError === 'CORE_UNAVAILABLE' ? 'CORE_UNAVAILABLE' : 'TORNEOS_UNAVAILABLE';
      throw new TorneosBoundaryError(code, { status, gatewayError });
    }
    if (status >= 500) {
      clear();
      throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status, gatewayError });
    }
    // Adapter refusals carry a functional code; PostgREST errors come through untouched.
    if (gatewayError && /^(TORNEOS_[A-Z_]+|CORE_DENIED)$/.test(gatewayError)) {
      throw new TorneosBoundaryError('TORNEOS_RPC_ERROR', {
        status, gatewayError, rpcError: { message: gatewayError, code: gatewayError, details: null, hint: null },
      });
    }
    if (rpcError) throw new TorneosBoundaryError('TORNEOS_RPC_ERROR', { status, rpcError });
    if (status === 403) throw new TorneosBoundaryError('TORNEOS_FORBIDDEN', { status, gatewayError });
    if (status === 429) throw new TorneosBoundaryError('TORNEOS_RATE_LIMITED', { status, gatewayError });
    if (status === 400) throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST', { status, gatewayError });
    throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status, gatewayError });
  }

  return Object.freeze({
    get status() { return disposed ? 'disposed' : 'connected'; },
    async rpc(name, params = {}, { signal } = {}) {
      if (!RPC_NAME.test(String(name))) throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      const { json } = await send('POST', `${REST_PATH}/rpc/${name}`, { body: params, signal });
      return json;
    },
    async select(table, query = {}, { signal } = {}) {
      if (!TABLE_NAME.test(String(table))) throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (!/^[a-z0-9_]+$/.test(key) || typeof value !== 'string') {
          throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
        }
        search.set(key, value);
      }
      const suffix = search.toString() ? `?${search.toString()}` : '';
      const { json } = await send('GET', `${REST_PATH}/${table}${suffix}`, { signal });
      return Array.isArray(json) ? json : [];
    },
    clear,
    dispose() {
      disposed = true;
      clear();
      if (typeof unsubscribe === 'function') unsubscribe();
    },
  });
}
