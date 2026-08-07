/**
 * Configuration for the signer attestation renewer.
 *
 * Everything is validated at start-up and the process refuses to run on any
 * doubt: a renewer that runs with a half-understood target is worse than one
 * that never starts, because the attestation expiring on its own is already the
 * safe outcome (`uploadReady` closes, uploads stop).
 *
 * Two credentials are read, they authorise different layers, and only one of
 * them is a secret. See `gateway.mjs` for the full distinction:
 *   - the attestation secret, which is what the signer's `health` action
 *     actually authorises against. It is never logged, never placed in a URL,
 *     and never sent anywhere except the one authorised host below.
 *   - the Functions gateway credential, which only gets the request past the
 *     gateway. It is public by design, and because every Edge Function in the
 *     manifest is deployed with `verify_jwt = true`, the bearer half of it has
 *     to be an actual JWT. This process deliberately holds NO service
 *     credential: it cannot read the bucket, cannot read the queue and cannot
 *     write an attestation itself. It can only ask the signer to re-prove
 *     itself.
 */

import path from 'node:path';

import {
  hostCarriesForbiddenRef, isCompiledForbiddenProjectRef, normalizeHost, projectRefFromHost,
  resolveForbiddenApiHosts, resolveForbiddenProjectRefs,
} from './forbidden-targets.mjs';
import {
  GATEWAY_CREDENTIAL_OPTIONS, inspectGatewayJwt, isPublishableKey, isServiceCredential,
} from './gateway.mjs';
import { worstCaseCycleSeconds } from './schedule.mjs';
import { createTarget } from './target.mjs';

export class RenewerConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RenewerConfigError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new RenewerConfigError(code, message); };

/**
 * A host whose first DNS label IS the project ref. Only for these can the ref
 * claim be demanded, because only for these does the address itself name a
 * project to compare against.
 *
 * The pattern is anchored, so it has to be applied to a CANONICAL host —
 * `normalizeHost` from `forbidden-targets.mjs`, the same normalisation every
 * other host decision in this package already goes through. `<ref>.supabase.co.`
 * and `<ref>.supabase.co` are one host to a resolver, but the trailing root dot
 * defeats the `$` anchor, and a host that failed this test was treated as a
 * custom domain — for which the ref claim is optional. One typed dot therefore
 * turned a REQUIRED claim into an optional one. See `isProjectBoundHost`.
 */
const PROJECT_BOUND_HOST = /^[a-z0-9]{16,32}\.supabase\.(?:co|in|net)$/;

/**
 * Whether the address itself names a project. Canonicalises first, so the answer
 * cannot be changed by a difference that does not change which host is reached.
 * Deliberately the only reader of `PROJECT_BOUND_HOST`: a second call site
 * testing the raw host is how the dot got back in.
 */
const isProjectBoundHost = (host) => PROJECT_BOUND_HOST.test(normalizeHost(host));

const readInteger = (raw, fallback, { min, max, code, name }) => {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(code, `${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
};

const readRatio = (raw, fallback, { min, max, code, name }) => {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    fail(code, `${name} must be a number between ${min} and ${max}.`);
  }
  return value;
};

/**
 * The target has to be named twice and agree with itself: the URL, and the host
 * the operator says they expect. A copy-pasted production URL therefore fails
 * here instead of renewing an attestation against the wrong project.
 *
 * Agreement alone is not authorization, though — two copies of the same wrong
 * host still name Production. So both statements are additionally checked
 * against the compiled policy in `forbidden-targets.mjs`, which the environment
 * can only extend. A deployment that never exported
 * `TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS` or
 * `TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS` — or exported them empty — still
 * refuses Production here.
 */
function resolveHealthUrl(env) {
  const rawUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const expectedHost = String(env.TOURNAMENT_MEDIA_EXPECTED_API_HOST || '').trim().toLowerCase();
  if (!rawUrl) fail('RENEWER_URL_MISSING', 'SUPABASE_URL is required.');
  if (!expectedHost) {
    fail('RENEWER_EXPECTED_HOST_MISSING',
      'TOURNAMENT_MEDIA_EXPECTED_API_HOST is required and must name the authorized host.');
  }
  let url;
  try { url = new URL(rawUrl); } catch { return fail('RENEWER_URL_INVALID', 'SUPABASE_URL is not a URL.'); }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    fail('RENEWER_URL_INVALID', 'SUPABASE_URL must be a bare https origin.');
  }
  if (url.hostname.toLowerCase() !== expectedHost) {
    fail('RENEWER_HOST_MISMATCH', 'SUPABASE_URL host is not the expected authorized host.');
  }
  // The compiled policy plus whatever the environment added. The environment
  // cannot subtract: absent, empty and whitespace-only values all still yield a
  // list that forbids Production, which is the whole point of resolving them
  // here instead of splitting the raw string inline.
  const forbidden = resolveForbiddenApiHosts(env.TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS);
  const forbiddenRefs = resolveForbiddenProjectRefs(env.TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS);
  const host = url.hostname.toLowerCase();
  // Both statements the operator made are checked against the policy, not just
  // the URL. They have already been proven equal above, so this is belt and
  // braces — but the guarantee "EXPECTED_API_HOST may not name Production" is
  // then anchored in a line of code rather than in a chain of inference.
  //
  // The ref test reads EVERY label, not the first one. `db.<prod-ref>.supabase.co`
  // and `gateway.<prod-ref>.example.com` name Production just as plainly as the
  // bare host does; a first-label-only test called them `db` and `gateway` and
  // let them through. Neither message ever names the host — the operator knows
  // what they exported, and an error line is not the place to reprint it.
  for (const [what, candidate] of [['SUPABASE_URL host', host], ['TOURNAMENT_MEDIA_EXPECTED_API_HOST', expectedHost]]) {
    if (forbidden.includes(normalizeHost(candidate))) {
      fail('RENEWER_HOST_FORBIDDEN', `${what} is explicitly forbidden.`);
    }
    if (hostCarriesForbiddenRef(candidate, forbiddenRefs)) {
      fail('RENEWER_HOST_FORBIDDEN', `${what} carries an explicitly forbidden project ref.`);
    }
  }
  const functionName = String(env.TOURNAMENT_MEDIA_SIGNER_FUNCTION || 'tournament-media-signer').trim();
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(functionName)) {
    fail('RENEWER_FUNCTION_INVALID', 'Signer function name is invalid.');
  }
  const projectRef = projectRefFromHost(host);
  // The frozen descriptor every request is re-checked against. Built here, at
  // the one point where the operator's two independent statements about the
  // target have just been proven to agree.
  let descriptor;
  try {
    descriptor = createTarget({
      origin: url.origin,
      functionName,
      projectRef,
      forbiddenHosts: forbidden,
      forbiddenProjectRefs: forbiddenRefs,
    });
  } catch (error) {
    return fail('RENEWER_URL_INVALID', `The authorized target is not usable: ${error.message}`);
  }
  return { origin: url.origin, host, projectRef, functionName, target: descriptor };
}

/**
 * Resolves the two halves of the gateway credential.
 *
 * `apikey` may be a publishable key or a legacy anon key; `authorizationJwt`
 * must be a JWT, because `verify_jwt = true` accepts nothing else. When the
 * apikey is a publishable key it cannot double as the bearer, so the dedicated
 * identity JWT becomes mandatory and its absence is a start-up refusal rather
 * than a 401 an hour later.
 */
function resolveGatewayCredential(env, { now = Date.now() } = {}) {
  const explicitJwt = String(env.TOURNAMENT_MEDIA_GATEWAY_JWT || '');
  const legacyKey = String(
    env.TOURNAMENT_MEDIA_GATEWAY_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '',
  );
  if (!explicitJwt && !legacyKey) {
    fail('RENEWER_GATEWAY_KEY_MISSING',
      'A Functions gateway credential is required. Accepted options: '
      + `${GATEWAY_CREDENTIAL_OPTIONS.map(({ variable }) => variable).join(' | ')}. `
      + 'Never a service credential.');
  }
  for (const [name, value] of [['TOURNAMENT_MEDIA_GATEWAY_KEY/SUPABASE_*', legacyKey], ['TOURNAMENT_MEDIA_GATEWAY_JWT', explicitJwt]]) {
    if (value && isServiceCredential(value)) {
      fail('RENEWER_GATEWAY_KEY_PRIVILEGED',
        `${name} looks like a service credential; the renewer must hold none.`);
    }
  }

  // A publishable key is not a JWT, so it can only ever be the apikey half.
  const publishableApikey = legacyKey && isPublishableKey(legacyKey);
  const bearerSource = explicitJwt || (publishableApikey ? '' : legacyKey);
  if (!bearerSource) {
    fail('RENEWER_GATEWAY_JWT_REQUIRED',
      'The configured gateway credential is a publishable key, which is not a JWT and cannot '
      + 'satisfy verify_jwt = true. Set TOURNAMENT_MEDIA_GATEWAY_JWT to a dedicated identity JWT '
      + 'with role anon or authenticated.');
  }
  const inspected = inspectGatewayJwt(bearerSource, { now });
  if (!inspected.ok) {
    // The value is never in the message: only the variable and the rule.
    fail(inspected.code,
      `${explicitJwt ? 'TOURNAMENT_MEDIA_GATEWAY_JWT' : 'the configured gateway credential'} `
      + `is not usable against verify_jwt = true: ${inspected.rule}.`);
  }
  return {
    apikey: legacyKey || bearerSource,
    authorizationJwt: bearerSource,
    gatewayCredentialKind: explicitJwt
      ? (publishableApikey ? 'publishable-plus-jwt' : 'dedicated-identity-jwt')
      : 'legacy-anon-jwt',
    gatewayJwtRole: inspected.role,
    gatewayJwtExpiresAt: inspected.expiresAt,
    gatewayJwtAlgorithm: inspected.algorithm,
    gatewayJwtProjectRef: inspected.projectRef,
  };
}

export { worstCaseCycleSeconds };

export function readRenewerConfig(env = process.env, { now = Date.now() } = {}) {
  const target = resolveHealthUrl(env);

  const attestationSecret = String(env.TOURNAMENT_MEDIA_ATTESTATION_SECRET || '');
  if (attestationSecret.length < 32) {
    // Length is checked, the value never is: no comparison against a literal,
    // no prefix in a log line, no error message carrying it.
    fail('RENEWER_SECRET_MISSING',
      'TOURNAMENT_MEDIA_ATTESTATION_SECRET is required and must be at least 32 characters.');
  }
  const gateway = resolveGatewayCredential(env, { now });
  // The credential must belong to the project we are renewing against. A JWT
  // from another project would be rejected by the gateway anyway; failing here
  // says which variable to fix instead of leaving a 401 to be diagnosed.
  //
  // When the endpoint is project-bound — a `<ref>.supabase.co` host, where the
  // ref is part of the address itself — the `ref` claim is REQUIRED, not merely
  // checked when present. A JWT without one cannot be shown to belong to this
  // project, and "we could not tell" is not a reason to send the attestation
  // secret. A custom domain carries no ref in its host, so there the claim is
  // compared only when the credential offers it.
  const projectBound = isProjectBoundHost(target.host);
  if (projectBound && !gateway.gatewayJwtProjectRef) {
    fail('RENEWER_GATEWAY_JWT_REF_MISSING',
      'The gateway JWT carries no ref claim, and the authorized host is project-bound; '
      + 'the credential cannot be shown to belong to this project.');
  }
  // Checked BEFORE the mismatch rule, and deliberately so. A custom domain
  // fronting Production produces a host that names no forbidden ref and a
  // credential that does; both rules would refuse it, but only this one says
  // why. "Your credential belongs to the forbidden project" is a different
  // operational fact from "these two names disagree", and the more urgent one.
  if (isCompiledForbiddenProjectRef(gateway.gatewayJwtProjectRef)) {
    fail('RENEWER_GATEWAY_JWT_PROJECT_FORBIDDEN',
      'The gateway JWT ref claim names a forbidden project.');
  }
  if (gateway.gatewayJwtProjectRef && gateway.gatewayJwtProjectRef !== target.projectRef) {
    fail('RENEWER_GATEWAY_JWT_PROJECT_MISMATCH',
      'The gateway JWT ref claim names a different project than the authorized host.');
  }

  const ttlSeconds = readInteger(env.TOURNAMENT_MEDIA_SIGNER_ATTEST_TTL_SECONDS, 3600, {
    min: 300, max: 86400, code: 'RENEWER_TTL_INVALID', name: 'TOURNAMENT_MEDIA_SIGNER_ATTEST_TTL_SECONDS',
  });
  const intervalSeconds = readInteger(env.TOURNAMENT_MEDIA_RENEW_INTERVAL_SECONDS, 1200, {
    min: 60, max: 43200, code: 'RENEWER_INTERVAL_INVALID', name: 'TOURNAMENT_MEDIA_RENEW_INTERVAL_SECONDS',
  });
  const jitterRatio = readRatio(env.TOURNAMENT_MEDIA_RENEW_JITTER_RATIO, 0.1, {
    min: 0, max: 0.5, code: 'RENEWER_JITTER_INVALID', name: 'TOURNAMENT_MEDIA_RENEW_JITTER_RATIO',
  });
  const timeoutMs = readInteger(env.TOURNAMENT_MEDIA_RENEW_TIMEOUT_MS, 10000, {
    min: 1000, max: 60000, code: 'RENEWER_TIMEOUT_INVALID', name: 'TOURNAMENT_MEDIA_RENEW_TIMEOUT_MS',
  });
  const maxAttempts = readInteger(env.TOURNAMENT_MEDIA_RENEW_MAX_ATTEMPTS, 3, {
    min: 1, max: 6, code: 'RENEWER_ATTEMPTS_INVALID', name: 'TOURNAMENT_MEDIA_RENEW_MAX_ATTEMPTS',
  });
  const backoffBaseMs = readInteger(env.TOURNAMENT_MEDIA_RENEW_BACKOFF_MS, 2000, {
    min: 100, max: 30000, code: 'RENEWER_BACKOFF_INVALID', name: 'TOURNAMENT_MEDIA_RENEW_BACKOFF_MS',
  });
  const backoffMaxMs = readInteger(env.TOURNAMENT_MEDIA_RENEW_BACKOFF_MAX_MS, 30000, {
    min: backoffBaseMs, max: 120000, code: 'RENEWER_BACKOFF_INVALID', name: 'TOURNAMENT_MEDIA_RENEW_BACKOFF_MAX_MS',
  });
  const alertAfterFailures = readInteger(env.TOURNAMENT_MEDIA_RENEW_ALERT_AFTER_FAILURES, 2, {
    min: 1, max: 10, code: 'RENEWER_ALERT_INVALID', name: 'TOURNAMENT_MEDIA_RENEW_ALERT_AFTER_FAILURES',
  });
  const safetyMarginSeconds = readInteger(
    env.TOURNAMENT_MEDIA_RENEW_SAFETY_MARGIN_SECONDS, Math.floor(ttlSeconds / 4), {
      min: 60, max: 43200, code: 'RENEWER_MARGIN_INVALID', name: 'TOURNAMENT_MEDIA_RENEW_SAFETY_MARGIN_SECONDS',
    },
  );

  const statePath = String(env.TOURNAMENT_MEDIA_RENEW_STATE_FILE || '').trim();
  if (statePath && !path.isAbsolute(statePath)) {
    fail('RENEWER_STATE_PATH_INVALID',
      'TOURNAMENT_MEDIA_RENEW_STATE_FILE must be an absolute path.');
  }

  // An operator who already knows when the current attestation expires can say
  // so, which turns the first cycle's severity from "cannot prove a margin" into
  // a real number. Optional by design: its absence is handled, not guessed at.
  const knownExpiresAtRaw = String(env.TOURNAMENT_MEDIA_ATTESTATION_KNOWN_EXPIRES_AT || '').trim();
  let knownAttestationExpiresAtMs = null;
  if (knownExpiresAtRaw) {
    knownAttestationExpiresAtMs = Date.parse(knownExpiresAtRaw);
    if (!Number.isFinite(knownAttestationExpiresAtMs)) {
      fail('RENEWER_KNOWN_EXPIRY_INVALID',
        'TOURNAMENT_MEDIA_ATTESTATION_KNOWN_EXPIRES_AT must be an ISO-8601 timestamp.');
    }
  }

  const config = {
    ...target,
    // Derived from the descriptor, never re-assembled from parts: the string
    // that is fetched and the string that is validated must have one source.
    healthUrl: target.target.url,
    attestationSecret,
    ...gateway,
    statePath: statePath || null,
    knownAttestationExpiresAtMs,
    ttlSeconds,
    intervalSeconds,
    jitterRatio,
    timeoutMs,
    maxAttempts,
    backoffBaseMs,
    backoffMaxMs,
    alertAfterFailures,
    safetyMarginSeconds,
    instanceId: String(env.TOURNAMENT_MEDIA_RENEWER_ID || 'media-signer-renewer'),
  };
  const worstCase = worstCaseCycleSeconds(config);
  if (worstCase + safetyMarginSeconds > ttlSeconds) {
    fail('RENEWER_SCHEDULE_UNSAFE',
      `Worst-case cycle ${Math.ceil(worstCase)}s plus margin ${safetyMarginSeconds}s exceeds the `
      + `${ttlSeconds}s attestation TTL.`);
  }
  if (alertAfterFailures * config.intervalSeconds >= ttlSeconds) {
    fail('RENEWER_ALERT_TOO_LATE',
      'The alert would fire at or after the attestation has already expired.');
  }
  config.worstCaseCycleSeconds = Math.ceil(worstCase);
  return Object.freeze(config);
}

/**
 * The values that must never reach a log line, an alert or an exit message.
 * Both halves of the gateway credential are included even though they are
 * public by design: a log line is not the place to publish them, and a leaked
 * bearer is still a bearer.
 */
export function secretValues(config) {
  return [config.attestationSecret, config.apikey, config.authorizationJwt].filter(Boolean);
}
