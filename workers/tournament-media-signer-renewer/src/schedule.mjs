/**
 * The one place that reasons about the attestation TTL.
 *
 * Before this module there were three copies of that arithmetic — the renewer's
 * config, the renewer's alerting, and the manifest validator in
 * `scripts/torneos-staging/readiness-lib.mjs` — and they had already drifted:
 * the manifest validator's version of the worst case ignored the backoff cap,
 * so a configuration the renewer refused to start with could still pass
 * validation. A safety margin that two files compute differently is not a
 * safety margin.
 *
 * This file has no imports and no I/O so both sides can use it as-is.
 */

/**
 * The worst case a renewal cycle can take: a full jittered interval, then every
 * retry timing out with every backoff jittered to its maximum. If that plus the
 * safety margin does not fit inside the attestation TTL, the schedule cannot
 * guarantee renewal before expiry.
 */
export function worstCaseCycleSeconds({
  intervalSeconds, jitterRatio, maxAttempts, timeoutMs, backoffBaseMs, backoffMaxMs,
}) {
  const interval = intervalSeconds * (1 + jitterRatio);
  let backoffMs = 0;
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    // The cap is part of the arithmetic, not a detail: without it the estimate
    // grows without bound and stops describing what the retry loop does.
    backoffMs += Math.min(backoffMaxMs, backoffBaseMs * (2 ** (attempt - 1))) * (1 + jitterRatio);
  }
  return interval + (maxAttempts * timeoutMs + backoffMs) / 1000;
}

/**
 * How much attestation TTL is left, and whether that number is a measurement or
 * a guess.
 *
 * `marginProven` is the important half. A renewer that has never had a
 * successful cycle — a fresh container, a restarted one-shot, a process that
 * lost its state file — knows nothing about when the current attestation
 * expires. It may have started one second after a renewal or one second before
 * an expiry, and the two are indistinguishable from inside the process.
 *
 * The old behaviour treated that as `warning` forever, which is the wrong way
 * round: an unprovable margin is not a mild problem, it is the absence of the
 * evidence the severity is supposed to be based on. So:
 *
 *   - a known `expiresAt` (from a previous success, or handed in by the
 *     operator) gives a real number and a real severity;
 *   - no such anchor gives `critical`, because no safe margin can be shown.
 *
 * The attestation still expires on its own either way. This only decides how
 * loudly the process says so.
 */
export function attestationMargin({
  lastSuccessAtMs = null,
  knownExpiresAtMs = null,
  ttlSeconds,
  safetyMarginSeconds,
  now,
}) {
  const expiresAtMs = knownExpiresAtMs !== null && Number.isFinite(knownExpiresAtMs)
    ? knownExpiresAtMs
    : (lastSuccessAtMs !== null && Number.isFinite(lastSuccessAtMs)
      ? lastSuccessAtMs + ttlSeconds * 1000
      : null);
  if (expiresAtMs === null) {
    return {
      expiresInSeconds: null,
      marginProven: false,
      severity: 'critical',
      reason: 'no_known_expiry',
    };
  }
  const expiresInSeconds = Math.round((expiresAtMs - now) / 1000);
  const withinMargin = expiresInSeconds <= safetyMarginSeconds;
  return {
    expiresInSeconds,
    marginProven: true,
    severity: withinMargin ? 'critical' : 'warning',
    reason: withinMargin ? 'expiry_within_safety_margin' : 'margin_remaining',
  };
}
