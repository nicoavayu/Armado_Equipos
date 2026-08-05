/**
 * Configuration for the signer attestation renewer.
 *
 * Everything is validated at start-up and the process refuses to run on any
 * doubt: a renewer that runs with a half-understood target is worse than one
 * that never starts, because the attestation expiring on its own is already the
 * safe outcome (`uploadReady` closes, uploads stop).
 *
 * Two credentials are read, and only one of them is a secret:
 *   - the attestation secret, which is what the signer's `health` action
 *     actually authorises against. It is never logged, never placed in a URL,
 *     and never sent anywhere except the one authorised host below.
 *   - the Functions gateway credential (publishable/anon). It is public by
 *     design. This process deliberately holds NO service credential: it cannot
 *     read the bucket, cannot read the queue and cannot write an attestation
 *     itself. It can only ask the signer to re-prove itself.
 */

export class RenewerConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RenewerConfigError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new RenewerConfigError(code, message); };

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
  const forbidden = String(env.TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS || '')
    .split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (forbidden.includes(url.hostname.toLowerCase())) {
    fail('RENEWER_HOST_FORBIDDEN', 'SUPABASE_URL host is explicitly forbidden.');
  }
  const functionName = String(env.TOURNAMENT_MEDIA_SIGNER_FUNCTION || 'tournament-media-signer').trim();
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(functionName)) {
    fail('RENEWER_FUNCTION_INVALID', 'Signer function name is invalid.');
  }
  return { origin: url.origin, host: url.hostname.toLowerCase(), functionName };
}

/**
 * The worst case a renewal cycle can take: a full jittered interval, then every
 * retry timing out with every backoff jittered to its maximum. If that plus the
 * safety margin does not fit inside the attestation TTL, the schedule cannot
 * guarantee renewal before expiry and this process must not start.
 */
export function worstCaseCycleSeconds(config) {
  const interval = config.intervalSeconds * (1 + config.jitterRatio);
  let backoffMs = 0;
  for (let attempt = 1; attempt < config.maxAttempts; attempt += 1) {
    backoffMs += Math.min(config.backoffMaxMs, config.backoffBaseMs * (2 ** (attempt - 1)))
      * (1 + config.jitterRatio);
  }
  const attemptsMs = config.maxAttempts * config.timeoutMs + backoffMs;
  return interval + attemptsMs / 1000;
}

export function readRenewerConfig(env = process.env) {
  const target = resolveHealthUrl(env);

  const attestationSecret = String(env.TOURNAMENT_MEDIA_ATTESTATION_SECRET || '');
  if (attestationSecret.length < 32) {
    // Length is checked, the value never is: no comparison against a literal,
    // no prefix in a log line, no error message carrying it.
    fail('RENEWER_SECRET_MISSING',
      'TOURNAMENT_MEDIA_ATTESTATION_SECRET is required and must be at least 32 characters.');
  }
  const gatewayKey = String(
    env.TOURNAMENT_MEDIA_GATEWAY_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '',
  );
  if (!gatewayKey) {
    fail('RENEWER_GATEWAY_KEY_MISSING',
      'A Functions gateway credential (publishable/anon) is required. Never use a service credential.');
  }
  if (/^(?:sb_secret_|service_role)/.test(gatewayKey)) {
    fail('RENEWER_GATEWAY_KEY_PRIVILEGED',
      'The gateway credential must not be a service credential.');
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

  const config = {
    ...target,
    healthUrl: `${target.origin}/functions/v1/${target.functionName}`,
    attestationSecret,
    gatewayKey,
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

/** The values that must never reach a log line, an alert or an exit message. */
export function secretValues(config) {
  return [config.attestationSecret, config.gatewayKey].filter(Boolean);
}
