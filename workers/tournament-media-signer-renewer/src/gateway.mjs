/**
 * The Functions gateway credential — which is NOT the attestation secret, and
 * the two must never be confused again.
 *
 * They authorise different things at different layers:
 *
 *   gateway credential   the Supabase Functions gateway, before the function
 *                        runs. With `verify_jwt = true` the gateway verifies a
 *                        JWT in `Authorization: Bearer`. It is public by
 *                        design and proves nothing about who may renew.
 *
 *   attestation secret   the signer's own `health` action, inside the function.
 *                        It is the thing that actually authorises a renewal,
 *                        travels in `x-media-attestation-secret`, and is the
 *                        only real secret this process holds.
 *
 * The bug this module fixes: the renewer sent whatever `TOURNAMENT_MEDIA_GATEWAY_KEY`
 * happened to contain as a Bearer token, and the documented value was a
 * publishable key. `sb_publishable_...` is not a JWT. Against a function
 * deployed with `verify_jwt = true` — which the manifest requires for every
 * Edge Function — the gateway rejects it with 401 before the signer is ever
 * reached, so the renewer would have failed every cycle in Staging and the
 * attestation would have expired on schedule, with the renewal alert blaming
 * the gateway. Better to refuse at start-up, naming the rule.
 *
 * Accepted shapes are enumerated in `GATEWAY_CREDENTIAL_OPTIONS` below and in
 * docs/operations/tournament-media-signer-attestation-renewal.md#credencial-del-gateway.
 *
 * Nothing here ever logs, echoes, prefixes, hashes or compares a credential
 * value against a literal. Every error names a variable and a rule.
 */

export const GATEWAY_CREDENTIAL_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'dedicated-identity-jwt',
    variable: 'TOURNAMENT_MEDIA_GATEWAY_JWT',
    preferred: true,
    description: 'A JWT minted for the renewer identity alone, with role anon or authenticated. '
      + 'Preferred because it can be rotated and revoked without touching any browser client.',
  }),
  Object.freeze({
    id: 'legacy-anon-jwt',
    variable: 'SUPABASE_ANON_KEY',
    preferred: false,
    description: 'The legacy anon key, which is itself a JWT and therefore satisfies verify_jwt. '
      + 'Serves as both apikey and bearer.',
  }),
  Object.freeze({
    id: 'publishable-plus-jwt',
    variable: 'SUPABASE_PUBLISHABLE_KEY (apikey) + TOURNAMENT_MEDIA_GATEWAY_JWT (bearer)',
    preferred: false,
    description: 'A new-style sb_publishable_ key is NOT a JWT. It may travel as the apikey header, '
      + 'but the bearer still has to be a JWT, so this option requires the dedicated identity JWT.',
  }),
]);

export const REJECTED_GATEWAY_CREDENTIALS = Object.freeze([
  'sb_secret_… — a service credential, and this process must hold none',
  'a JWT whose role claim is service_role — same reason, in JWT clothing',
  'sb_publishable_… used as the bearer — not a JWT, refused by verify_jwt = true',
  'any opaque string used as the bearer — verify_jwt = true accepts nothing else',
]);

const SERVICE_PREFIXES = /^(?:sb_secret_|service_role)/;
const PUBLISHABLE_PREFIX = /^sb_publishable_/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

const decodeSegment = (segment) => {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
};

/** True for a new-style publishable key, which is deliberately not a JWT. */
export const isPublishableKey = (value) => PUBLISHABLE_PREFIX.test(String(value || ''));

/** True for anything that announces itself as a service credential. */
export const isServiceCredential = (value) => SERVICE_PREFIXES.test(String(value || ''));

/**
 * Structural validation only. This does not — and must not — verify the
 * signature: the renewer holds no signing key, and a locally "verified" JWT
 * would only prove we can check our own arithmetic. The gateway does the real
 * verification. What we can do locally is refuse a credential that the gateway
 * is certain to reject, and refuse one that is privileged.
 *
 * @returns {{ role, expiresAt, projectRef, algorithm }} claims only, no value.
 */
export function inspectGatewayJwt(value, { now = Date.now(), clockSkewSeconds = 60 } = {}) {
  const raw = String(value || '');
  if (!raw) return { ok: false, code: 'RENEWER_GATEWAY_JWT_MISSING', rule: 'a JWT is required' };
  if (isServiceCredential(raw)) {
    return { ok: false, code: 'RENEWER_GATEWAY_KEY_PRIVILEGED', rule: 'service credentials are forbidden' };
  }
  if (isPublishableKey(raw)) {
    return {
      ok: false,
      code: 'RENEWER_GATEWAY_JWT_NOT_A_JWT',
      rule: 'a publishable key is not a JWT and cannot satisfy verify_jwt = true',
    };
  }
  const segments = raw.split('.');
  if (segments.length !== 3 || !JWT_SHAPE.test(raw)) {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_MALFORMED', rule: 'a JWT has three base64url segments' };
  }
  let header;
  let payload;
  try {
    header = decodeSegment(segments[0]);
    payload = decodeSegment(segments[1]);
  } catch {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_MALFORMED', rule: 'header and payload must decode to JSON' };
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_MALFORMED', rule: 'header and payload must be JSON objects' };
  }
  const algorithm = String(header.alg || '');
  if (!algorithm || algorithm.toLowerCase() === 'none') {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_ALG', rule: 'alg must be present and must not be none' };
  }
  if (header.typ !== undefined && String(header.typ).toUpperCase() !== 'JWT') {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_MALFORMED', rule: 'typ, when present, must be JWT' };
  }
  const role = typeof payload.role === 'string' ? payload.role : null;
  if (!role) {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_ROLE', rule: 'the payload must carry a role claim' };
  }
  if (role === 'service_role' || /service/i.test(role)) {
    return { ok: false, code: 'RENEWER_GATEWAY_KEY_PRIVILEGED', rule: 'role must not be a service role' };
  }
  if (!['anon', 'authenticated'].includes(role)) {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_ROLE', rule: 'role must be anon or authenticated' };
  }
  if (!Number.isFinite(payload.exp)) {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_EXP', rule: 'the payload must carry a numeric exp claim' };
  }
  if (payload.exp * 1000 <= now - clockSkewSeconds * 1000) {
    return { ok: false, code: 'RENEWER_GATEWAY_JWT_EXPIRED', rule: 'the credential has already expired' };
  }
  return {
    ok: true,
    role,
    algorithm,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    projectRef: typeof payload.ref === 'string' ? payload.ref : null,
  };
}
