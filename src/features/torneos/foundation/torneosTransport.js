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
//   • ERROR-CONTRACT-V1: expected domain errors answer 409/422/429 (migration 0006, PTxyz). A 500 whose PostgREST
//     body carries a Torneos functional code as its whole message (a database before 0006, or an invariant) is a
//     structured answer of a live backend, not an outage: it keeps the bearer and surfaces rpcError. A 503, any
//     other 5xx and an unstructured 500 stay fail-closed (bearer dropped, TORNEOS_UNAVAILABLE).
//
// Rules this module enforces: the bearer lives in memory only, is never decoded and
// never persisted; a change of Core session discards it; every failure closes
// (no request goes anywhere but the gateway); one silent re-exchange on 401, never more.
//
// POST-SMOKE: Core re-announces a valid session while actions are in flight (TOKEN_REFRESHED from the
// refresh ticker, SIGNED_IN with the same session on every hidden→visible tab transition). Such a
// renewal of the SAME identity (the bridge attributes it: `{ sameIdentity: true }`) still discards the
// cache and any exchange answer bound to the superseded Core token, but the action then re-derives its
// bearer ONCE from Core's current session instead of reporting a logout. Anything else — sign-out,
// another user, USER_UPDATED, an event the bridge cannot attribute — is an identity boundary and an
// action that straddles one fails closed with CORE_AUTH_REQUIRED.
//
// COMPETITION-V1 adds the anonymous public read-only route: createTorneosPublicTransport →
// POST /torneos/public/v1/rpc/<name>, with NO credential of any kind (the gateway refuses one)
// and no Core session involved. It serves the public tournament page and nothing else.
//
// MEDIA-V1 adds the gateway's two media routes with the same bearer, renewal and failure mapping as the RPC route:
// POST /torneos/media/v1/upload?gallery=&key= (one normalized photo as the raw body; real upload progress through
// XMLHttpRequest, the only browser API that reports it) and POST /torneos/media/v1/urls (signed reads).
//
// MP-A5 adds the commerce routes (MP-A4 gateway): POST /commerce/v1/season-checkout and, with the
// COMMERCE-PRODUCTION gateway, POST /commerce/v1/purchase-refresh, with the same bearer, headers and
// failure mapping as the RPC route. They are never retried beyond that single 401 renewal: the caller
// repeats a checkout on purpose, with the same idempotency key.
import { TorneosBoundaryError } from './errors';
import { COMMERCE_PATHS } from './stagingV1CommerceScope';
import { MEDIA_UPLOAD_ROUTE, MEDIA_URLS_ROUTE } from './mediaV1Scope';

export const EXCHANGE_PATH = '/exchange';
export const REST_PATH = '/torneos/rest/v1';
export const PUBLIC_RPC_PATH = '/torneos/public/v1/rpc';
// BRANDING-V1: one versioned object of the branding bucket (gateway object route).
export const BRANDING_OBJECT_ROUTE = '/torneos/branding/v1/object';
const BRANDING_UPLOAD_TYPES = Object.freeze({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
const BRANDING_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
// A 4 MiB photo on a slow mobile uplink, plus the gateway's verification and storage write.
export const MEDIA_UPLOAD_TIMEOUT_MS = 90_000;
// The gateway gives the checkout up to 4 s (DB) + 8 s (payments) after its own checks.
export const COMMERCE_REQUEST_TIMEOUT_MS = 20_000;
const MAX_REQUEST_TIMEOUT_MS = 120_000;
// Renew before the gateway's own tolerance window would refuse the bearer.
export const BEARER_RENEWAL_MARGIN_MS = 20_000;
export const CORE_AUTH_EVENTS_THAT_CLEAR = Object.freeze([
  'SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED',
]);
// The only events that may renew the SAME identity, and only when the bridge says so.
export const CORE_AUTH_RENEWAL_EVENTS = Object.freeze(['TOKEN_REFRESHED', 'SIGNED_IN']);
// Internal: an exchange answered for a Core token that a same-identity renewal superseded. Never surfaces.
const SESSION_RENEWED = 'CORE_SESSION_RENEWED';
const RPC_NAME = /^[a-z0-9_]{1,63}$/;
const TABLE_NAME = /^[a-z0-9_]{1,63}$/;

// fetch cannot report upload progress; XMLHttpRequest can. Same request (method, headers, body, abort), answered as a
// Response so the caller's mapping is the one every other route uses. Without XMLHttpRequest (tests, workers): fetch.
export function xhrUpload(url, { method, headers, body, signal, onProgress, fetchImpl }) {
  if (typeof XMLHttpRequest === 'undefined' || typeof Response === 'undefined') {
    return fetchImpl(url, { method, headers, body, credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open(method, url, true);
    request.withCredentials = false;
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') onProgress(event.loaded / event.total);
    };
    const settle = () => signal?.removeEventListener?.('abort', abort);
    request.onload = () => {
      settle();
      resolve(new Response(request.responseText, {
        status: request.status,
        headers: { 'content-type': request.getResponseHeader('content-type') || 'application/json' },
      }));
    };
    request.onerror = () => { settle(); reject(new TypeError('network')); };
    request.ontimeout = () => { settle(); reject(new TypeError('timeout')); };
    request.onabort = () => { settle(); reject(signal?.reason || new DOMException('aborted', 'AbortError')); };
    if (signal) {
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
    }
    request.send(body);
  });
}

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
// Functional codes of the Torneos database are whole messages (RAISE ... message = 'TORNEOS_X'). The boundary codes
// the gateway itself uses for outages never qualify.
const DOMAIN_ERROR_MESSAGE = /^TORNEOS_[A-Z0-9_]+$/;
const OUTAGE_CODES = Object.freeze(['TORNEOS_UNAVAILABLE', 'TORNEOS_PAYMENTS_UNAVAILABLE']);
const isStructuredDomainError = (status, rpcError) => status === 500
  && Boolean(rpcError) && DOMAIN_ERROR_MESSAGE.test(rpcError.message) && !OUTAGE_CODES.includes(rpcError.message);

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
  uploadImpl = xhrUpload,
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
  let identity = 0;    // bumps on every identity boundary; a same-identity renewal leaves it alone
  let disposed = false;

  const clear = () => {
    generation += 1;
    cached = null;
    pending = null;
  };
  // Synchronous callback: never call another Auth method under GoTrue's lock.
  const unsubscribe = typeof onCoreAuthChange === 'function'
    ? onCoreAuthChange((event, detail) => {
      if (event && !CORE_AUTH_EVENTS_THAT_CLEAR.includes(event)) return;
      const renewal = CORE_AUTH_RENEWAL_EVENTS.includes(event) && detail?.sameIdentity === true;
      if (!renewal) identity += 1;
      clear();
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

  async function exchange(token, started, epoch) {
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
      // The answer is bound to a Core token that is no longer current: never cached, never used.
      throw new TorneosBoundaryError(!disposed && epoch === identity ? SESSION_RENEWED : 'CORE_AUTH_REQUIRED');
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

  async function derive(force) {
    const token = await coreToken();
    if (!force && cached?.coreToken === token && cached.until > now() + BEARER_RENEWAL_MARGIN_MS) {
      return cached.token;
    }
    if (force || pending?.coreToken !== token) {
      clear();
      const started = generation;
      const request = exchange(token, started, identity);
      pending = { coreToken: token, request };
      request.finally(() => { if (pending?.request === request) pending = null; }).catch(() => {});
    }
    return pending.request;
  }

  async function bearer({ force = false, epoch = identity } = {}) {
    let token;
    try {
      token = await derive(force);
    } catch (error) {
      if (error?.code !== SESSION_RENEWED) throw error;
      // Core renewed the same identity mid-exchange: ask Core again, exactly once. Core decides — no
      // session → CORE_AUTH_REQUIRED; a real refusal of the new token → its own code.
      try {
        token = await derive(false);
      } catch (again) {
        if (again?.code === SESSION_RENEWED) throw new TorneosBoundaryError('CORE_AUTH_REQUIRED');
        throw again;
      }
    }
    // An action never continues under an identity other than the one it started with.
    if (epoch !== identity) throw new TorneosBoundaryError('CORE_AUTH_REQUIRED');
    return token;
  }

  async function send(method, path, {
    body = undefined, rawBody = undefined, headers = {}, signal = undefined, attempt = 0, timeoutMs = requestTimeoutMs,
    epoch = identity, onUploadProgress = undefined,
  } = {}) {
    const token = await bearer({ force: attempt > 0, epoch });
    const { signal: timed, release } = withTimeout(timeoutMs, signal);
    let response;
    try {
      const request = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        // A raw body (BRANDING-V1 / MEDIA-V1 image) travels as is, with the Content-Type the caller fixed.
        body: rawBody !== undefined ? rawBody : (body !== undefined ? JSON.stringify(body) : undefined),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: timed,
      };
      response = onUploadProgress
        ? await uploadImpl(`${base}${path}`, { ...request, onProgress: onUploadProgress, fetchImpl })
        : await fetchImpl(`${base}${path}`, request);
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
      if (attempt === 0) return send(method, path, { body, rawBody, headers, signal, timeoutMs, attempt: 1, epoch, onUploadProgress });
      throw new TorneosBoundaryError('TORNEOS_SESSION_INVALID', { status, gatewayError });
    }
    if (status === 503) {
      clear();
      const code = gatewayError === 'CORE_UNAVAILABLE' ? 'CORE_UNAVAILABLE' : 'TORNEOS_UNAVAILABLE';
      throw new TorneosBoundaryError(code, { status, gatewayError });
    }
    // A live backend answering a functional code: no outage, the bearer stays valid, no retry.
    if (isStructuredDomainError(status, rpcError)) throw new TorneosBoundaryError('TORNEOS_RPC_ERROR', { status, rpcError });
    if (status >= 500) {
      clear();
      throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status, gatewayError });
    }
    // Adapter refusals carry a functional code; PostgREST errors come through untouched.
    if (gatewayError && /^(TORNEOS_[A-Z_]+|CORE_DENIED)$/.test(gatewayError)) {
      // MEDIA-V1 refusals carry what the person can act on: the content verdict (code) and the season quota numbers.
      const mediaDetail = json && (typeof json.code === 'string' || (json.quota && typeof json.quota === 'object'))
        ? { code: typeof json.code === 'string' ? json.code : null, quota: json.quota || null } : null;
      throw new TorneosBoundaryError('TORNEOS_RPC_ERROR', {
        status, gatewayError, rpcError: { message: gatewayError, code: gatewayError, details: mediaDetail, hint: null },
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
    async commerce(path, body, { signal, timeoutMs = COMMERCE_REQUEST_TIMEOUT_MS } = {}) {
      if (!COMMERCE_PATHS.includes(path)) throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_REQUEST_TIMEOUT_MS) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      const { json } = await send('POST', path, { body, signal, timeoutMs });
      return json;
    },
    // BRANDING-V1: the client validated the path; the image must match its extension and the bucket limit.
    async brandingObject(method, path, file = undefined, { signal } = {}) {
      const extension = String(path).slice(String(path).lastIndexOf('.') + 1);
      if (method === 'POST') {
        const type = BRANDING_UPLOAD_TYPES[extension];
        if (!file || typeof file.size !== 'number' || file.size <= 0 || file.size > BRANDING_UPLOAD_MAX_BYTES
          || file.type !== type) {
          throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
        }
        const { json } = await send('POST', `${BRANDING_OBJECT_ROUTE}/${path}`, {
          rawBody: file, headers: { 'Content-Type': type }, signal, timeoutMs: COMMERCE_REQUEST_TIMEOUT_MS,
        });
        return json;
      }
      if (method !== 'DELETE') throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      const { json } = await send('DELETE', `${BRANDING_OBJECT_ROUTE}/${path}`, { signal });
      return json;
    },
    // MEDIA-V1: the client validated ids, type and size. A functional refusal (422 content, 409 duplicate / in
    // progress, 422 season quota) keeps the gateway's code on the error (gatewayError) and its numbers (detail).
    async mediaUpload({ galleryId, idempotencyKey, file, thumbnailSize = 0 }, { signal, onProgress } = {}) {
      const query = new URLSearchParams({
        gallery: galleryId, key: idempotencyKey, ...(thumbnailSize > 0 ? { thumb: String(thumbnailSize) } : {}),
      }).toString();
      const { json, status } = await send('POST', `${MEDIA_UPLOAD_ROUTE}?${query}`, {
        rawBody: file, headers: { 'Content-Type': file.type }, signal, timeoutMs: MEDIA_UPLOAD_TIMEOUT_MS,
        onUploadProgress: typeof onProgress === 'function' ? onProgress : () => {},
      });
      return { ...(json || {}), httpStatus: status };
    },
    async mediaUrls(items, { signal } = {}) {
      const { json } = await send('POST', MEDIA_URLS_ROUTE, { body: { items }, signal });
      return json;
    },
    clear,
    dispose() {
      disposed = true;
      clear();
      if (typeof unsubscribe === 'function') unsubscribe();
    },
  });
}

// COMPETITION-V1: the anonymous transport of the public tournament page. No bearer, no Core
// session, no retries: a refusal or an outage is reported as such and the page shows it.
export function createTorneosPublicTransport({
  gatewayUrl,
  fetchImpl = (...args) => window.fetch(...args),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof gatewayUrl !== 'string' || !/^https?:\/\//.test(gatewayUrl)) {
    throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
  }
  const base = gatewayUrl.replace(/\/$/, '');
  return Object.freeze({
    async publicRpc(name, params = {}, { signal } = {}) {
      if (!RPC_NAME.test(String(name))) throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      const { signal: timed, release } = withTimeout(requestTimeoutMs, signal);
      let response;
      try {
        response = await fetchImpl(`${base}${PUBLIC_RPC_PATH}/${name}`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: timed,
        });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { cause });
      } finally {
        release();
      }
      const { json } = await readBody(response);
      const { status } = response;
      if (status >= 200 && status < 300) return json;
      const gatewayError = gatewayErrorOf(json);
      if (status === 403) throw new TorneosBoundaryError('TORNEOS_FORBIDDEN', { status, gatewayError });
      if (status === 400 || status === 413 || status === 415) throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST', { status, gatewayError });
      if (status === 429) throw new TorneosBoundaryError('TORNEOS_RATE_LIMITED', { status, gatewayError });
      throw new TorneosBoundaryError('TORNEOS_UNAVAILABLE', { status, gatewayError });
    },
  });
}
