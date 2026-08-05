/**
 * Scheduled renewal of the SIGNER attestation.
 *
 * The processor tier renews itself from inside its own loop
 * (`workers/tournament-media-processor/src/index.mjs`). The signer cannot: it
 * is an Edge Function, it only attests while it is answering a `health` call,
 * and that call is authorised by a secret nobody may expose publicly. Its
 * attestation therefore lives 3600s and, before this module existed, somebody
 * had to hand-run the probe every hour or `uploadReady` closed on its own.
 *
 * This is the missing scheduler, and it is deliberately dumb:
 *   - it holds no service credential, so a compromise of it cannot read the
 *     bucket, the queue or the identity map. It can only ask the signer to
 *     re-prove itself, which is the same thing an operator would do by hand;
 *   - it never asserts readiness. The signer's own probe decides. A 200 means
 *     the signer really wrote an attestation it really earned;
 *   - it fails CLOSED by doing nothing. There is no path here that extends,
 *     forges or keeps an attestation alive. If this process dies, hangs, loses
 *     the network or is denied by the secret, the attestation simply expires
 *     and uploads stop — which is the correct outcome, not an outage to route
 *     around.
 *
 * Every log line is structured and passes through a redactor that removes the
 * configured secrets even when they arrive inside somebody else's error text.
 */

import { secretValues } from './config.mjs';
import { attestationMargin } from './schedule.mjs';

export const OUTCOME = Object.freeze({
  RENEWED: 'renewed',
  FAILED: 'failed',
  SKIPPED_IN_FLIGHT: 'skipped_in_flight',
});

/** Errors that cannot be fixed by trying again in two seconds. */
const NON_RETRYABLE = new Set([
  'SIGNER_GATEWAY_REJECTED',
  'SIGNER_SECRET_REJECTED',
  'SIGNER_NOT_FOUND',
  'SIGNER_REQUEST_INVALID',
  'SIGNER_HEALTH_INVALID',
]);

/**
 * Redaction is value-based, not key-based: the secret is removed wherever it
 * appears, including inside a message some library built for us. Header and
 * credential keys are additionally dropped by name.
 */
export function createRedactor(secrets = []) {
  const values = [...secrets].filter((value) => typeof value === 'string' && value.length >= 8);
  // Whole containers go too: a `headers` object has no business in a log line
  // even after its known credential keys have been removed.
  const forbiddenKey = /^(?:authorization|apikey|api_key|secret|token|key|cookie|set-cookie|headers|credentials|x-media-attestation-secret)$/i;
  const redactString = (input) => {
    let output = String(input);
    for (const value of values) output = output.split(value).join('[redacted]');
    // A signed URL or a bearer token that reached us from anywhere else.
    output = output.replace(/([?&](?:token|signature|sig|apikey)=)[^&\s]+/gi, '$1[redacted]');
    output = output.replace(/(bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1[redacted]');
    output = output.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]');
    return output;
  };
  const redact = (value) => {
    if (typeof value === 'string') return redactString(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !forbiddenKey.test(key))
        .map(([key, item]) => [key, redact(item)]));
    }
    return value;
  };
  return redact;
}

export function createLogger({ write, secrets = [], now = () => new Date() } = {}) {
  const redact = createRedactor(secrets);
  const emit = write || ((line) => process.stdout.write(`${line}\n`));
  return (event, detail = {}) => {
    const payload = redact({ at: now().toISOString(), component: 'signer-attestation-renewer', event, ...detail });
    emit(JSON.stringify(payload));
    return payload;
  };
}

/**
 * Jittered interval. Two renewers provisioned from the same template must not
 * hit the signer — and therefore the storage probe — at the same second, and a
 * restarted renewer must not re-synchronise onto the old phase.
 */
export function computeSleepMs({ intervalSeconds, jitterRatio, random = Math.random }) {
  const base = intervalSeconds * 1000;
  const spread = base * jitterRatio;
  // Symmetric around the base, so the average cadence stays the configured one.
  return Math.max(1000, Math.round(base - spread + random() * spread * 2));
}

/** Bounded exponential backoff with jitter, capped so a retry storm cannot eat the TTL. */
export function computeBackoffMs({
  attempt, backoffBaseMs, backoffMaxMs, jitterRatio, random = Math.random,
}) {
  const exponential = Math.min(backoffMaxMs, backoffBaseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.round(exponential * (1 + random() * jitterRatio));
}

const classifyStatus = (status) => {
  if (status === 200) return null;
  if (status === 401) return 'SIGNER_GATEWAY_REJECTED';
  if (status === 403) return 'SIGNER_SECRET_REJECTED';
  if (status === 404) return 'SIGNER_NOT_FOUND';
  if (status === 400 || status === 405) return 'SIGNER_REQUEST_INVALID';
  if (status === 429) return 'SIGNER_THROTTLED';
  if (status >= 500) return 'SIGNER_UNAVAILABLE';
  return 'SIGNER_UNEXPECTED_STATUS';
};

/**
 * One health call, with an explicit timeout. The secret travels in a header and
 * never in the URL or the body, so it cannot end up in an access log.
 */
export async function renewOnce(config, { fetchImpl = fetch, monotonic = () => Date.now() } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = monotonic();
  try {
    const response = await fetchImpl(config.healthUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Two different credentials for two different layers: the apikey gets
        // past the gateway, the Bearer JWT satisfies verify_jwt = true, and the
        // attestation secret is the only one that authorises the renewal.
        apikey: config.apikey,
        Authorization: `Bearer ${config.authorizationJwt}`,
        'x-media-attestation-secret': config.attestationSecret,
      },
      body: JSON.stringify({ action: 'health' }),
      signal: controller.signal,
    });
    const latencyMs = monotonic() - startedAt;
    const statusCode = classifyStatus(response.status);
    if (statusCode) {
      return { ok: false, code: statusCode, status: response.status, latencyMs };
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: 'SIGNER_HEALTH_INVALID', status: response.status, latencyMs };
    }
    // A 200 whose body is not the signer's own certification shape means the
    // deployment answering us is not the signer we think it is.
    if (!body || body.service !== 'signer' || typeof body.release !== 'string'
      || !body.evidence || body.evidence.signedUploadUrls !== true
      || body.evidence.signedReadUrls !== true) {
      return { ok: false, code: 'SIGNER_HEALTH_INVALID', status: response.status, latencyMs };
    }
    return { ok: true, code: null, status: response.status, latencyMs, release: body.release };
  } catch (error) {
    const latencyMs = monotonic() - startedAt;
    const aborted = error?.name === 'AbortError' || controller.signal.aborted;
    return {
      ok: false,
      code: aborted ? 'SIGNER_TIMEOUT' : 'SIGNER_UNREACHABLE',
      status: null,
      latencyMs,
      detail: String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * A sleep that can be cut short, because the alternative is a container that
 * ignores SIGTERM for up to twenty minutes and is eventually SIGKILLed.
 *
 * The old loop slept on a bare `setTimeout` and only re-checked the stop flag
 * when the timer fired, so a shutdown during the interval — the overwhelmingly
 * likely moment, since the process spends nearly all its time there — waited
 * out the whole interval. Every orchestrator's patience is shorter than that.
 *
 * `cancel()` clears the pending timer and resolves the pending sleep, and is
 * idempotent. Nothing is left registered afterwards: no timer to keep the event
 * loop alive, no resolver holding a closure.
 */
export function createInterruptibleSleep() {
  let timer = null;
  let resolveCurrent = null;
  let cancelled = false;
  const sleep = (ms) => {
    if (cancelled) return Promise.resolve('cancelled');
    return new Promise((resolve) => {
      resolveCurrent = resolve;
      // Deliberately NOT unref'd. The interval sleep is the only thing keeping
      // a long-lived renewer alive between cycles; an unref'd timer would let
      // the process exit the moment it went to sleep, which looks like a clean
      // shutdown and is actually a renewer that stopped renewing.
      timer = setTimeout(() => {
        timer = null;
        resolveCurrent = null;
        resolve('elapsed');
      }, ms);
    });
  };
  const cancel = () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (resolveCurrent) {
      const resolve = resolveCurrent;
      resolveCurrent = null;
      resolve('cancelled');
    }
  };
  return { sleep, cancel, get cancelled() { return cancelled; } };
}

/**
 * Signal wiring, extracted so it can be tested with a fake emitter and so the
 * listeners are removable. Handlers are registered with `once` and explicitly
 * removed on release, which matters for `--once`: a process that exits while
 * still holding signal listeners keeps them registered through whatever the
 * host does next.
 */
export function installShutdownHandlers({
  target = process, signals = ['SIGTERM', 'SIGINT'], onSignal,
}) {
  const handlers = signals.map((signal) => {
    const handler = () => onSignal(signal);
    target.once(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of handlers) target.removeListener(signal, handler);
  };
}

/** Bounded retries. A misconfiguration is reported once, not hammered. */
export async function renewWithRetries(config, deps = {}) {
  const {
    fetchImpl = fetch, monotonic = () => Date.now(), sleep = defaultSleep,
    random = Math.random, log = () => {},
  } = deps;
  let last = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await renewOnce(config, { fetchImpl, monotonic });
    last.attempt = attempt;
    if (last.ok) return last;
    if (NON_RETRYABLE.has(last.code)) {
      log('renewal_attempt_failed', { attempt, code: last.code, status: last.status, retryable: false });
      return last;
    }
    log('renewal_attempt_failed', { attempt, code: last.code, status: last.status, retryable: true });
    if (attempt < config.maxAttempts) {
      const backoffMs = computeBackoffMs({
        attempt,
        backoffBaseMs: config.backoffBaseMs,
        backoffMaxMs: config.backoffMaxMs,
        jitterRatio: config.jitterRatio,
        random,
      });
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoffMs);
    }
  }
  return last;
}

/**
 * In-memory state, optionally seeded from what a previous run persisted.
 *
 * `persisted` is what makes `--once` able to alert at all: without it the
 * failure counter restarts at zero on every invocation and never reaches the
 * threshold. See `state-store.mjs`.
 */
export function createRenewerState(persisted = null) {
  const lastSuccessAt = persisted?.lastSuccessAt ? Date.parse(persisted.lastSuccessAt) : null;
  return {
    inFlight: false,
    consecutiveFailures: Number.isInteger(persisted?.consecutiveFailures)
      ? persisted.consecutiveFailures : 0,
    lastRenewedAt: Number.isFinite(lastSuccessAt) ? lastSuccessAt : null,
    lastFailureCode: persisted?.lastFailureCode ?? null,
    alerting: persisted?.alerting === true,
    cycles: 0,
  };
}

/** The subset that may be written to disk: a counter, a time, a code, a flag. */
export function persistableState(state, { now = Date.now() } = {}) {
  return {
    consecutiveFailures: state.consecutiveFailures,
    lastSuccessAt: state.lastRenewedAt === null ? null : new Date(state.lastRenewedAt).toISOString(),
    lastFailureCode: state.lastFailureCode,
    alerting: state.alerting,
    updatedAt: new Date(now).toISOString(),
  };
}

/**
 * One full cycle. Idempotent by construction: the signer's attestation is a
 * single row keyed by service, so a duplicate renewal — from an overlapping
 * tick, a second replica, or an operator running the probe by hand — only
 * refreshes the same row. The in-flight guard exists to avoid piling requests
 * on a signer that is already slow, not to protect correctness.
 */
export async function runRenewalCycle({ state, config, deps = {} }) {
  const { log = () => {}, now = () => Date.now() } = deps;
  if (state.inFlight) {
    log('renewal_skipped', { reason: 'in_flight' });
    return { outcome: OUTCOME.SKIPPED_IN_FLIGHT, state };
  }
  state.inFlight = true;
  state.cycles += 1;
  try {
    const result = await renewWithRetries(config, deps);
    if (result?.ok) {
      const at = now();
      state.consecutiveFailures = 0;
      state.lastFailureCode = null;
      state.lastRenewedAt = at;
      if (state.alerting) {
        state.alerting = false;
        log('renewal_recovered', {
          severity: 'info',
          metric: 'arma2_torneos_media_signer_attestation_renewal_failures_consecutive',
          value: 0,
        });
      }
      log('renewal_succeeded', {
        release: result.release,
        latencyMs: result.latencyMs,
        attempt: result.attempt,
        attestationTtlSeconds: config.ttlSeconds,
        // Derived from the TTL the signer is known to write, never from a value
        // this process could influence.
        attestationExpiresAt: new Date(at + config.ttlSeconds * 1000).toISOString(),
      });
      return { outcome: OUTCOME.RENEWED, state, result };
    }
    state.consecutiveFailures += 1;
    state.lastFailureCode = result?.code || 'SIGNER_UNREACHABLE';
    // One implementation of this arithmetic, shared with the config validator.
    // A process that has never succeeded — a cold container, a `--once` run
    // whose state file is new — cannot show any margin, and an unprovable
    // margin escalates to critical instead of sitting in warning forever.
    const margin = attestationMargin({
      lastSuccessAtMs: state.lastRenewedAt,
      knownExpiresAtMs: config.knownAttestationExpiresAtMs ?? null,
      ttlSeconds: config.ttlSeconds,
      safetyMarginSeconds: config.safetyMarginSeconds,
      now: now(),
    });
    log('renewal_failed', {
      code: state.lastFailureCode,
      consecutiveFailures: state.consecutiveFailures,
      attestationExpiresInSeconds: margin.expiresInSeconds,
      attestationMarginProven: margin.marginProven,
    });
    if (state.consecutiveFailures >= config.alertAfterFailures) {
      state.alerting = true;
      log('renewal_alert', {
        // Fail-closed: nothing here keeps the attestation alive. The alert is
        // the only action, and the expiry does the enforcing.
        severity: margin.severity,
        severityReason: margin.reason,
        metric: 'arma2_torneos_media_signer_attestation_renewal_failures_consecutive',
        value: state.consecutiveFailures,
        code: state.lastFailureCode,
        attestationExpiresInSeconds: margin.expiresInSeconds,
        attestationMarginProven: margin.marginProven,
        runbook: 'docs/operations/tournament-media-signer-attestation-renewal.md#incidentes',
      });
    }
    return { outcome: OUTCOME.FAILED, state, result };
  } finally {
    state.inFlight = false;
  }
}

/**
 * The loop. `shouldContinue` lets the CLI stop on a signal and lets the tests
 * run an exact number of cycles without real timers.
 */
export async function runRenewalLoop({
  config, state = createRenewerState(), deps = {}, shouldContinue = () => true,
}) {
  const { sleep = defaultSleep, random = Math.random, log = () => {} } = deps;
  log('renewer_started', {
    host: config.host,
    functionName: config.functionName,
    intervalSeconds: config.intervalSeconds,
    jitterRatio: config.jitterRatio,
    attestationTtlSeconds: config.ttlSeconds,
    worstCaseCycleSeconds: config.worstCaseCycleSeconds,
    safetyMarginSeconds: config.safetyMarginSeconds,
    instanceId: config.instanceId,
  });
  while (shouldContinue(state)) {
    // eslint-disable-next-line no-await-in-loop
    await runRenewalCycle({ state, config, deps });
    if (!shouldContinue(state)) break;
    const sleepMs = computeSleepMs({
      intervalSeconds: config.intervalSeconds, jitterRatio: config.jitterRatio, random,
    });
    log('renewal_sleeping', { sleepMs });
    // The sleep is interruptible; a shutdown mid-interval ends here rather than
    // twenty minutes from here.
    // eslint-disable-next-line no-await-in-loop
    const woke = await sleep(sleepMs);
    if (woke === 'cancelled') break;
  }
  log('renewer_stopped', { cycles: state.cycles, consecutiveFailures: state.consecutiveFailures });
  return state;
}

export { secretValues };
