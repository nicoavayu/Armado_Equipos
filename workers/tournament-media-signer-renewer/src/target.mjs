/**
 * The one place that decides where a credentialed request may go.
 *
 * ---------------------------------------------------------------------------
 * Why this module exists
 * ---------------------------------------------------------------------------
 * Both callers — the renewer loop and the one-shot gateway probe — send three
 * credentials in headers: the Functions `apikey`, a bearer JWT, and
 * `x-media-attestation-secret`, which is the only real secret in the system.
 * `fetch` follows redirects by default and re-sends headers on a same-origin
 * hop, and undici will re-send even cross-origin for a 307/308 unless told
 * otherwise. So a signer host that answered `301 Location: https://evil/` would
 * have collected the attestation secret, and nothing in the previous code would
 * have noticed: the renewer would simply have logged a confusing status.
 *
 * The fix is structural rather than watchful. `redirect: 'error'` makes the
 * runtime reject the redirect before it opens a connection to the second host,
 * so the secret is never serialised toward it — verified in
 * `test/redirect.test.mjs` by a second HTTP server that asserts it received
 * nothing at all. `response.redirected` is checked as well, because a caller may
 * inject a `fetchImpl`, and an injected implementation might follow redirects on
 * its own.
 *
 * Every request also re-validates its own URL against a frozen descriptor
 * immediately before it is made. Validation at config time is not enough: the
 * URL is a string, strings get concatenated, and the check that matters is the
 * one that runs at the moment of the call.
 *
 * ---------------------------------------------------------------------------
 * The protocol rule
 * ---------------------------------------------------------------------------
 * https is required, with exactly one exception: a loopback literal
 * (127.0.0.1, ::1). A loopback address cannot reach Production and cannot
 * exfiltrate to a remote host, so plain http there is not a weakening of the
 * boundary — it is what makes the redirect tests above able to run a real
 * server. There is no flag, no env var and no test-only branch that relaxes
 * anything else; `config.mjs` independently requires https for the real target.
 */

export class TargetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new TargetError(code, message); };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', '::1', 'localhost']);

/** Loopback literals only. `localhost` resolves through the resolver, so it is not one. */
const isLoopbackLiteral = (hostname) => hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';

const normalizeList = (values) => Object.freeze([...new Set((values || [])
  .map((value) => String(value || '').trim().toLowerCase())
  .filter(Boolean))]);

/**
 * The immutable description of the single endpoint a caller is allowed to
 * reach. Built once, frozen, and re-checked before every request.
 *
 * `projectRef` is carried explicitly rather than re-derived at each call site:
 * two call sites deriving "the first DNS label" independently is how they drift.
 */
export function createTarget({
  origin, functionName, projectRef = null,
  forbiddenHosts = [], forbiddenProjectRefs = [],
}) {
  let url;
  try {
    url = new URL(String(origin));
  } catch {
    return fail('SIGNER_TARGET_INVALID', 'The target origin is not a URL.');
  }
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(String(functionName || ''))) {
    fail('SIGNER_TARGET_INVALID', 'The target function name is invalid.');
  }
  const hostname = url.hostname.toLowerCase();
  const secure = url.protocol === 'https:';
  if (!secure && !isLoopbackLiteral(hostname)) {
    fail('SIGNER_TARGET_INSECURE', 'The target must be https unless it is a loopback literal.');
  }
  const forbiddenHostList = normalizeList(forbiddenHosts);
  const forbiddenRefList = normalizeList(forbiddenProjectRefs);
  if (forbiddenHostList.includes(hostname)) {
    fail('SIGNER_TARGET_FORBIDDEN', 'The target host is explicitly forbidden.');
  }
  const ref = projectRef === null ? null : String(projectRef).toLowerCase();
  if (ref && forbiddenRefList.includes(ref)) {
    fail('SIGNER_TARGET_FORBIDDEN', 'The target project ref is explicitly forbidden.');
  }
  const path = `/functions/v1/${functionName}`;
  return Object.freeze({
    origin: url.origin,
    hostname,
    protocol: url.protocol,
    functionName,
    projectRef: ref,
    path,
    url: `${url.origin}${path}`,
    forbiddenHosts: forbiddenHostList,
    forbiddenProjectRefs: forbiddenRefList,
  });
}

/**
 * Re-validates a concrete URL against the descriptor. Exact equality on every
 * component that can change where the bytes go, and the forbidden lists are
 * re-applied here too so a descriptor built from a stale config cannot smuggle
 * Production past a later-tightened list.
 */
export function assertAuthorizedUrl(candidate, target) {
  let url;
  try {
    url = new URL(String(candidate));
  } catch {
    return fail('SIGNER_TARGET_INVALID', 'The request URL is not a URL.');
  }
  if (url.protocol !== target.protocol) {
    fail('SIGNER_TARGET_PROTOCOL', 'The request protocol is not the authorized one.');
  }
  if (url.protocol !== 'https:' && !isLoopbackLiteral(url.hostname.toLowerCase())) {
    fail('SIGNER_TARGET_INSECURE', 'A non-https request may only target a loopback literal.');
  }
  if (url.username || url.password) {
    fail('SIGNER_TARGET_CREDENTIALS', 'The request URL may not carry userinfo.');
  }
  if (url.search || url.hash) {
    fail('SIGNER_TARGET_PATH', 'The request URL may not carry a query string or fragment.');
  }
  if (url.hostname.toLowerCase() !== target.hostname) {
    fail('SIGNER_TARGET_HOST', 'The request host is not the authorized host.');
  }
  if (url.origin !== target.origin) {
    // Catches a changed port, which `hostname` alone does not.
    fail('SIGNER_TARGET_HOST', 'The request origin is not the authorized origin.');
  }
  if (url.pathname !== target.path) {
    fail('SIGNER_TARGET_PATH', 'The request path is not the authorized function path.');
  }
  if (target.forbiddenHosts.includes(url.hostname.toLowerCase())) {
    fail('SIGNER_TARGET_FORBIDDEN', 'The request host is explicitly forbidden.');
  }
  if (target.projectRef) {
    const ref = url.hostname.toLowerCase().split('.')[0];
    if (target.forbiddenProjectRefs.includes(ref)) {
      fail('SIGNER_TARGET_FORBIDDEN', 'The request project ref is explicitly forbidden.');
    }
    // Only meaningful for a `<ref>.host` shape; a loopback test server has no
    // ref to check and must not be forced to invent one.
    if (!isLoopbackLiteral(url.hostname.toLowerCase()) && ref !== target.projectRef) {
      fail('SIGNER_TARGET_PROJECT_REF', 'The request host does not carry the authorized project ref.');
    }
  }
  return url;
}

/**
 * True when a thrown fetch error is the runtime refusing a redirect. undici
 * raises `TypeError: fetch failed` with `cause.message === 'unexpected
 * redirect'`; other runtimes word it differently, so the whole error chain is
 * searched for the word rather than matched against one exact string.
 */
export function isRedirectRefusal(error) {
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (/redirect/i.test(String(current.message || ''))) return true;
    current = current.cause;
  }
  return false;
}

/**
 * The only way either caller is allowed to send a credentialed request.
 *
 * Redirects are refused twice over: `redirect: 'error'` stops the runtime from
 * ever connecting to the second host, and `response.redirected` catches an
 * injected `fetchImpl` that followed one anyway. A 3xx that somehow arrives as
 * a resolved response is also refused, because a caller could pass
 * `redirect: 'manual'` semantics through a custom implementation.
 *
 * @throws {TargetError} SIGNER_TARGET_* before any I/O, SIGNER_REDIRECTED after.
 */
export async function fetchAuthorized(candidate, {
  target, fetchImpl = fetch, headers = {}, ...init
} = {}) {
  if (!target || typeof target !== 'object') {
    fail('SIGNER_TARGET_INVALID', 'A frozen target descriptor is required.');
  }
  const url = assertAuthorizedUrl(candidate, target);
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      ...init,
      headers,
      // Not negotiable, and deliberately after the spread so a caller cannot
      // override it: this is the line that keeps the attestation secret from
      // being re-sent to whatever a Location header names.
      redirect: 'error',
    });
  } catch (error) {
    if (isRedirectRefusal(error)) {
      throw new TargetError('SIGNER_REDIRECTED',
        'The authorized host answered with a redirect; the request was refused before any '
        + 'credential could be sent to the redirect target.');
    }
    throw error;
  }
  if (response && response.redirected === true) {
    fail('SIGNER_REDIRECTED', 'The response reports a followed redirect; refusing to trust it.');
  }
  if (response && typeof response.status === 'number'
    && response.status >= 300 && response.status < 400) {
    fail('SIGNER_REDIRECTED', 'The authorized host answered with a redirect status.');
  }
  return response;
}

export { LOOPBACK_HOSTS };
