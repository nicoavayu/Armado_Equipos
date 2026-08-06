import assert from 'node:assert/strict';
import test from 'node:test';

import { RenewerConfigError, readRenewerConfig, worstCaseCycleSeconds } from '../src/config.mjs';
import { COMPILED_FORBIDDEN_PROJECT_REFS } from '../src/forbidden-targets.mjs';
import { inspectGatewayJwt } from '../src/gateway.mjs';
import {
  OUTCOME,
  computeBackoffMs,
  computeSleepMs,
  createLogger,
  createRedactor,
  createRenewerState,
  renewOnce,
  renewWithRetries,
  runRenewalCycle,
  runRenewalLoop,
} from '../src/renewer.mjs';

const SECRET = 'a'.repeat(48);
const PROJECT_REF = 'hhyvmhgpapyuzjgxfnqv';

/**
 * A structurally valid, deliberately unsigned JWT. The renewer never verifies
 * signatures — only the gateway can — so a fixture with a placeholder signature
 * exercises exactly the checks the renewer actually performs.
 */
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const makeJwt = ({
  role = 'anon', expSeconds = 3600, ref = PROJECT_REF, alg = 'HS256', typ = 'JWT',
} = {}) => [
  b64url({ alg, typ }),
  b64url({ iss: 'supabase', ref, role, exp: Math.floor(Date.now() / 1000) + expSeconds }),
  'fixture-signature-not-verified-here',
].join('.');

const ANON_JWT = makeJwt();
const PUBLISHABLE_KEY = 'sb_publishable_fixture_key_value';

const baseEnv = (overrides = {}) => ({
  SUPABASE_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co',
  TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'hhyvmhgpapyuzjgxfnqv.supabase.co',
  TOURNAMENT_MEDIA_ATTESTATION_SECRET: SECRET,
  SUPABASE_ANON_KEY: ANON_JWT,
  ...overrides,
});

const config = (overrides = {}) => readRenewerConfig(baseEnv(overrides));

const expectConfigCode = (code, run) => assert.throws(run, (error) => (
  error instanceof RenewerConfigError && error.code === code
));

const okBody = { service: 'signer', release: '0.1.0', evidence: { signedUploadUrls: true, signedReadUrls: true } };
const jsonResponse = (status, body) => ({
  status,
  json: async () => body,
});

// --- configuration ---------------------------------------------------------

test('a valid configuration renews well before the TTL and keeps a safety margin', () => {
  const resolved = config();
  assert.equal(resolved.ttlSeconds, 3600);
  assert.equal(resolved.intervalSeconds, 1200);
  assert.equal(resolved.healthUrl,
    'https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/tournament-media-signer');
  // The whole worst case — jittered interval plus every retry timing out —
  // still leaves at least the safety margin of the TTL unused.
  assert.ok(worstCaseCycleSeconds(resolved) + resolved.safetyMarginSeconds <= resolved.ttlSeconds);
  assert.ok(resolved.worstCaseCycleSeconds < resolved.ttlSeconds / 2);
});

test('a missing attestation secret refuses to start', () => {
  expectConfigCode('RENEWER_SECRET_MISSING',
    () => readRenewerConfig(baseEnv({ TOURNAMENT_MEDIA_ATTESTATION_SECRET: '' })));
  // Too short is treated as missing: no partial secret is ever accepted.
  expectConfigCode('RENEWER_SECRET_MISSING',
    () => readRenewerConfig(baseEnv({ TOURNAMENT_MEDIA_ATTESTATION_SECRET: 'short' })));
});

test('a missing or privileged gateway credential refuses to start', () => {
  expectConfigCode('RENEWER_GATEWAY_KEY_MISSING',
    () => readRenewerConfig({ ...baseEnv(), SUPABASE_ANON_KEY: '' }));
  expectConfigCode('RENEWER_GATEWAY_KEY_PRIVILEGED',
    () => readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: 'sb_secret_never_use_this_here' })));
  // The same privilege wearing a JWT is refused just as flatly.
  expectConfigCode('RENEWER_GATEWAY_KEY_PRIVILEGED',
    () => readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: makeJwt({ role: 'service_role' }) })));
  expectConfigCode('RENEWER_GATEWAY_KEY_PRIVILEGED',
    () => readRenewerConfig(baseEnv({ TOURNAMENT_MEDIA_GATEWAY_JWT: 'sb_secret_never_use_this_here' })));
});

// --- the gateway credential, which is not the attestation secret ------------

test('a publishable key cannot be the bearer, because verify_jwt = true rejects it', () => {
  // This is the deployment reality the renewer used to ignore: every Edge
  // Function in the manifest is deployed with verifyJwt true, and a
  // sb_publishable_ key is not a JWT. Sending it would 401 at the gateway
  // forever while the alert blamed the credential.
  expectConfigCode('RENEWER_GATEWAY_JWT_REQUIRED', () => readRenewerConfig({
    ...baseEnv(), SUPABASE_ANON_KEY: undefined, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
  }));
  const inspected = inspectGatewayJwt(PUBLISHABLE_KEY);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.code, 'RENEWER_GATEWAY_JWT_NOT_A_JWT');
});

test('a publishable key is accepted as the apikey when a dedicated identity JWT is supplied', () => {
  const resolved = readRenewerConfig({
    ...baseEnv(),
    SUPABASE_ANON_KEY: undefined,
    SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    TOURNAMENT_MEDIA_GATEWAY_JWT: makeJwt({ role: 'authenticated' }),
  });
  assert.equal(resolved.gatewayCredentialKind, 'publishable-plus-jwt');
  // The two headers carry two different values on purpose.
  assert.equal(resolved.apikey, PUBLISHABLE_KEY);
  assert.notEqual(resolved.authorizationJwt, resolved.apikey);
  assert.equal(resolved.gatewayJwtRole, 'authenticated');
  // And neither of them is the attestation secret.
  assert.notEqual(resolved.authorizationJwt, resolved.attestationSecret);
  assert.notEqual(resolved.apikey, resolved.attestationSecret);
});

test('a legacy anon JWT is accepted structurally and serves as both headers', () => {
  const resolved = config();
  assert.equal(resolved.gatewayCredentialKind, 'legacy-anon-jwt');
  assert.equal(resolved.gatewayJwtRole, 'anon');
  assert.equal(resolved.apikey, resolved.authorizationJwt);
  assert.ok(Date.parse(resolved.gatewayJwtExpiresAt) > Date.now());
  const inspected = inspectGatewayJwt(ANON_JWT);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.projectRef, PROJECT_REF);
});

test('a malformed, expired, algorithm-less or wrong-project JWT refuses to start', () => {
  expectConfigCode('RENEWER_GATEWAY_JWT_MALFORMED',
    () => readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: 'not.a.jwt at all' })));
  expectConfigCode('RENEWER_GATEWAY_JWT_MALFORMED',
    () => readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: 'onlytwo.segments' })));
  expectConfigCode('RENEWER_GATEWAY_JWT_EXPIRED',
    () => readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: makeJwt({ expSeconds: -7200 }) })));
  expectConfigCode('RENEWER_GATEWAY_JWT_ALG',
    () => readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: makeJwt({ alg: 'none' }) })));
  expectConfigCode('RENEWER_GATEWAY_JWT_ROLE',
    () => readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: makeJwt({ role: 'postgres' }) })));
  expectConfigCode('RENEWER_GATEWAY_JWT_PROJECT_MISMATCH',
    () => readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: makeJwt({ ref: 'someotherprojectref' }) })));
});

test('no credential value ever appears in a configuration error', () => {
  const values = [PUBLISHABLE_KEY, SECRET, makeJwt({ role: 'service_role' })];
  for (const value of values) {
    try {
      readRenewerConfig(baseEnv({ SUPABASE_ANON_KEY: value }));
    } catch (error) {
      assert.doesNotMatch(error.message, new RegExp(value.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});

test('the target host has to be named twice and agree', () => {
  expectConfigCode('RENEWER_EXPECTED_HOST_MISSING',
    () => readRenewerConfig(baseEnv({ TOURNAMENT_MEDIA_EXPECTED_API_HOST: '' })));
  expectConfigCode('RENEWER_HOST_MISMATCH', () => readRenewerConfig(baseEnv({
    SUPABASE_URL: 'https://rcyuuoaqfwcembdajcss.supabase.co',
  })));
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => readRenewerConfig(baseEnv({
    SUPABASE_URL: 'https://rcyuuoaqfwcembdajcss.supabase.co',
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'rcyuuoaqfwcembdajcss.supabase.co',
    TOURNAMENT_MEDIA_FORBIDDEN_API_HOSTS: 'rcyuuoaqfwcembdajcss.supabase.co',
  })));
  for (const url of [
    'http://hhyvmhgpapyuzjgxfnqv.supabase.co',
    'https://user:pass@hhyvmhgpapyuzjgxfnqv.supabase.co',
    'https://hhyvmhgpapyuzjgxfnqv.supabase.co/rest/v1',
  ]) {
    expectConfigCode('RENEWER_URL_INVALID', () => readRenewerConfig(baseEnv({ SUPABASE_URL: url })));
  }
});

test('a schedule that could miss the expiry refuses to start', () => {
  // An interval longer than the TTL, and an interval whose worst case eats the
  // margin, are both start-up failures rather than a silent gap in readiness.
  expectConfigCode('RENEWER_SCHEDULE_UNSAFE', () => readRenewerConfig(baseEnv({
    TOURNAMENT_MEDIA_RENEW_INTERVAL_SECONDS: '3500',
  })));
  expectConfigCode('RENEWER_SCHEDULE_UNSAFE', () => readRenewerConfig(baseEnv({
    TOURNAMENT_MEDIA_RENEW_INTERVAL_SECONDS: '2800',
    TOURNAMENT_MEDIA_RENEW_SAFETY_MARGIN_SECONDS: '900',
  })));
  expectConfigCode('RENEWER_ALERT_TOO_LATE', () => readRenewerConfig(baseEnv({
    TOURNAMENT_MEDIA_RENEW_INTERVAL_SECONDS: '1200',
    TOURNAMENT_MEDIA_RENEW_SAFETY_MARGIN_SECONDS: '120',
    TOURNAMENT_MEDIA_RENEW_ALERT_AFTER_FAILURES: '3',
  })));
});

// --- jitter and backoff ----------------------------------------------------

test('jitter spreads the cadence symmetrically and never collapses to zero', () => {
  const resolved = config();
  const low = computeSleepMs({ ...resolved, random: () => 0 });
  const high = computeSleepMs({ ...resolved, random: () => 1 });
  const middle = computeSleepMs({ ...resolved, random: () => 0.5 });
  assert.equal(low, 1080000);
  assert.equal(high, 1320000);
  assert.equal(middle, 1200000);
  assert.ok(low > 0 && low < high);
  // Even a degenerate interval keeps a floor, so a misconfigured jitter can
  // never turn into a hot loop against the signer.
  assert.ok(computeSleepMs({ intervalSeconds: 60, jitterRatio: 0.5, random: () => 0 }) >= 1000);
});

test('backoff is exponential, jittered and capped', () => {
  const resolved = config();
  const args = { ...resolved, random: () => 0 };
  assert.equal(computeBackoffMs({ ...args, attempt: 1 }), 2000);
  assert.equal(computeBackoffMs({ ...args, attempt: 2 }), 4000);
  assert.equal(computeBackoffMs({ ...args, attempt: 3 }), 8000);
  // Capped.
  assert.equal(computeBackoffMs({ ...args, attempt: 12 }), resolved.backoffMaxMs);
  // Jittered upward only, so a cap is still a cap plus the jitter ratio.
  const jittered = computeBackoffMs({ ...resolved, attempt: 1, random: () => 1 });
  assert.equal(jittered, Math.round(2000 * 1.1));
});

// --- the health call -------------------------------------------------------

test('the renewal call carries the secret in a header, never in the URL or body', async () => {
  const seen = [];
  const resolved = config();
  const result = await renewOnce(resolved, {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return jsonResponse(200, okBody);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.release, '0.1.0');
  const [call] = seen;
  assert.equal(call.url, resolved.healthUrl);
  assert.doesNotMatch(call.url, /a{20}/);
  assert.equal(call.init.headers['x-media-attestation-secret'], SECRET);
  assert.equal(call.init.body, JSON.stringify({ action: 'health' }));
  assert.doesNotMatch(call.init.body, /a{20}/);
});

test('an explicit timeout aborts the request and reports it as a timeout', async () => {
  const resolved = config({ TOURNAMENT_MEDIA_RENEW_TIMEOUT_MS: '1000' });
  const result = await renewOnce(resolved, {
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SIGNER_TIMEOUT');
});

test('an invalid health response is a failure even with HTTP 200', async () => {
  const resolved = config();
  for (const body of [
    null,
    { service: 'processor', release: '0.2.0', evidence: {} },
    { service: 'signer', release: '0.1.0', evidence: { signedUploadUrls: true, signedReadUrls: false } },
    { service: 'signer', evidence: { signedUploadUrls: true, signedReadUrls: true } },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await renewOnce(resolved, { fetchImpl: async () => jsonResponse(200, body) });
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.code, 'SIGNER_HEALTH_INVALID');
  }
  const unparseable = await renewOnce(resolved, {
    fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('not json'); } }),
  });
  assert.equal(unparseable.code, 'SIGNER_HEALTH_INVALID');
});

test('a rejected secret is reported without retrying, a 5xx is retried', async () => {
  const resolved = config();
  let calls = 0;
  const rejected = await renewWithRetries(resolved, {
    fetchImpl: async () => { calls += 1; return jsonResponse(403, { error: 'forbidden' }); },
    sleep: async () => {},
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'SIGNER_SECRET_REJECTED');
  assert.equal(calls, 1, 'a rejected secret must not be retried');

  calls = 0;
  const unavailable = await renewWithRetries(resolved, {
    fetchImpl: async () => { calls += 1; return jsonResponse(503, { error: 'bucket_absent' }); },
    sleep: async () => {},
  });
  assert.equal(unavailable.code, 'SIGNER_UNAVAILABLE');
  assert.equal(calls, resolved.maxAttempts);

  calls = 0;
  const recovered = await renewWithRetries(resolved, {
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? jsonResponse(500, {}) : jsonResponse(200, okBody);
    },
    sleep: async () => {},
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.attempt, 3);
});

// --- cycles, alerting and fail-closed --------------------------------------

test('consecutive failures raise one alert and a later success clears it', async () => {
  const resolved = config();
  const state = createRenewerState();
  const lines = [];
  const log = createLogger({ write: (line) => lines.push(JSON.parse(line)), secrets: [SECRET, ANON_JWT] });
  const failing = { fetchImpl: async () => jsonResponse(503, {}), sleep: async () => {}, log };
  const passing = { fetchImpl: async () => jsonResponse(200, okBody), sleep: async () => {}, log };

  const first = await runRenewalCycle({ state, config: resolved, deps: failing });
  assert.equal(first.outcome, OUTCOME.FAILED);
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(lines.filter((line) => line.event === 'renewal_alert').length, 0,
    'a single failure is not an alert: the TTL still has room');

  await runRenewalCycle({ state, config: resolved, deps: failing });
  assert.equal(state.consecutiveFailures, 2);
  const alerts = lines.filter((line) => line.event === 'renewal_alert');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].metric,
    'arma2_torneos_media_signer_attestation_renewal_failures_consecutive');
  assert.equal(alerts[0].value, 2);
  assert.equal(alerts[0].code, 'SIGNER_UNAVAILABLE');
  assert.match(alerts[0].runbook, /signer-attestation-renewal/);

  await runRenewalCycle({ state, config: resolved, deps: passing });
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.alerting, false);
  assert.equal(lines.filter((line) => line.event === 'renewal_recovered').length, 1);
});

test('renewal is idempotent and overlapping ticks do not pile up', async () => {
  const resolved = config();
  const state = createRenewerState();
  let inFlight = 0;
  let maxInFlight = 0;
  const deps = {
    sleep: async () => {},
    fetchImpl: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      inFlight -= 1;
      return jsonResponse(200, okBody);
    },
  };
  const [first, second] = await Promise.all([
    runRenewalCycle({ state, config: resolved, deps }),
    runRenewalCycle({ state, config: resolved, deps }),
  ]);
  const outcomes = [first.outcome, second.outcome].sort();
  assert.deepEqual(outcomes, [OUTCOME.RENEWED, OUTCOME.SKIPPED_IN_FLIGHT].sort());
  assert.equal(maxInFlight, 1);
  // Repeating the cycle is safe: the attestation row is keyed by service, so a
  // duplicate renewal refreshes rather than duplicates.
  await runRenewalCycle({ state, config: resolved, deps });
  assert.equal(state.consecutiveFailures, 0);
});

test('the renewer never extends or forges an attestation when it cannot reach the signer', async () => {
  const resolved = config();
  const state = createRenewerState();
  const lines = [];
  const log = createLogger({ write: (line) => lines.push(JSON.parse(line)), secrets: [SECRET] });
  await runRenewalCycle({
    state,
    config: resolved,
    deps: { fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, sleep: async () => {}, log },
  });
  assert.equal(state.lastRenewedAt, null, 'a failed cycle must not record a renewal');
  assert.equal(state.lastFailureCode, 'SIGNER_UNREACHABLE');
  // Fail-closed: no event claims readiness, and nothing writes an attestation.
  assert.equal(lines.some((line) => line.event === 'renewal_succeeded'), false);
});

test('the loop paces itself with jitter and stops on request', async () => {
  const resolved = config();
  const state = createRenewerState();
  const sleeps = [];
  let cycles = 0;
  await runRenewalLoop({
    config: resolved,
    state,
    deps: {
      fetchImpl: async () => { cycles += 1; return jsonResponse(200, okBody); },
      sleep: async (ms) => { sleeps.push(ms); },
      random: () => 0.5,
      log: () => {},
    },
    shouldContinue: () => cycles < 3,
  });
  assert.equal(cycles, 3);
  assert.deepEqual(sleeps, [1200000, 1200000]);
  assert.ok(sleeps.every((ms) => ms < resolved.ttlSeconds * 1000));
});

// --- redaction -------------------------------------------------------------

test('no log line can carry the attestation secret, the gateway key or a token', () => {
  const redact = createRedactor([SECRET, ANON_JWT]);
  const payload = redact({
    event: 'renewal_failed',
    message: `POST failed with header x-media-attestation-secret: ${SECRET}`,
    headers: { Authorization: `Bearer ${ANON_JWT}`, apikey: ANON_JWT },
    url: 'https://example.invalid/object?token=signed-value&x=1',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop',
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, new RegExp(SECRET));
  assert.doesNotMatch(serialized, new RegExp(ANON_JWT));
  assert.doesNotMatch(serialized, /token=signed-value/);
  assert.doesNotMatch(serialized, /eyJhbGciOiJIUzI1NiJ9/);
  assert.equal(payload.headers, undefined, 'credential-bearing keys are dropped entirely');
});

test('a failure whose error text embeds the secret is still safe to log', async () => {
  const resolved = config();
  const state = createRenewerState();
  const lines = [];
  const log = createLogger({
    write: (line) => lines.push(line),
    secrets: [resolved.attestationSecret, resolved.authorizationJwt],
  });
  await runRenewalCycle({
    state,
    config: resolved,
    deps: {
      // Some clients echo the request — including headers — into the error.
      fetchImpl: async () => { throw new Error(`upstream rejected header ${SECRET}`); },
      sleep: async () => {},
      log,
    },
  });
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.doesNotMatch(line, new RegExp(SECRET));
    assert.doesNotMatch(line, new RegExp(ANON_JWT));
  }
});

// --- the credential must be shown to belong to THIS project -----------------

test('a project-bound host requires the JWT to carry a matching ref claim', () => {
  // A `<ref>.supabase.co` host names a project in the address itself, so a
  // credential that cannot be shown to belong to that project is refused
  // rather than sent. "We could not tell" is not a reason to offer the
  // attestation secret to an endpoint.
  const noRef = [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ iss: 'supabase', role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 }),
    'fixture-signature-not-verified-here',
  ].join('.');
  expectConfigCode('RENEWER_GATEWAY_JWT_REF_MISSING', () => config({ SUPABASE_ANON_KEY: noRef }));

  // A ref from another project is still the pre-existing mismatch.
  expectConfigCode('RENEWER_GATEWAY_JWT_PROJECT_MISMATCH',
    () => config({ SUPABASE_ANON_KEY: makeJwt({ ref: 'someotherprojectref00' }) }));

  // The matching ref is accepted, and is carried on the config.
  assert.equal(config().gatewayJwtProjectRef, PROJECT_REF);
  assert.equal(config().projectRef, PROJECT_REF);

  // A custom domain carries no ref in its host, so the claim is only compared
  // when the credential offers one — demanding it there would be demanding
  // something the address cannot be checked against.
  const custom = readRenewerConfig({
    ...baseEnv(),
    SUPABASE_URL: 'https://api.arma2.example',
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'api.arma2.example',
    SUPABASE_ANON_KEY: noRef,
  });
  assert.equal(custom.gatewayJwtProjectRef, null);
});

test('a forbidden project ref is refused by name as well as by host', () => {
  expectConfigCode('RENEWER_HOST_FORBIDDEN', () => config({
    TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS: `something,${PROJECT_REF}`,
  }));
  // The descriptor every request is validated against carries the list too, so
  // the block survives into the transport rather than living only in start-up.
  // The environment's entry is ADDED to the compiled policy, never substituted
  // for it: both are present, and Production is present first.
  const resolved = config({ TOURNAMENT_MEDIA_FORBIDDEN_PROJECT_REFS: 'prodref00000000000000' });
  assert.deepEqual(resolved.target.forbiddenProjectRefs,
    [...COMPILED_FORBIDDEN_PROJECT_REFS, 'prodref00000000000000']);
  assert.equal(resolved.target.url, resolved.healthUrl);
  assert.equal(resolved.target.path, '/functions/v1/tournament-media-signer');
});

// --- latency is measured on a clock that cannot go backwards ----------------

test('latency comes from a monotonic clock, not the wall clock', async () => {
  // `Date.now()` is not monotonic: an NTP step or a manual correction during a
  // slow request produces a negative or wildly inflated latency, and latency is
  // a published metric. This simulates the clock jumping backwards mid-request.
  const jumping = (() => {
    let calls = 0;
    return () => { calls += 1; return calls === 1 ? 1_000_000 : 0; };
  })();
  const result = await renewOnce(config(), {
    monotonic: jumping,
    fetchImpl: async () => jsonResponse(200, okBody),
  });
  assert.equal(result.ok, true);
  assert.ok(result.latencyMs < 0, 'the fixture proves the value is taken from the supplied clock');

  // The real default is performance.now(), which cannot regress.
  const real = await renewOnce(config(), { fetchImpl: async () => jsonResponse(200, okBody) });
  assert.ok(real.latencyMs >= 0, 'the default clock must never produce a negative latency');
  assert.ok(Number.isInteger(real.latencyMs));
});

test('the redactor removes new-style Supabase keys, which are not JWTs', () => {
  const redact = createRedactor([]);
  const line = redact({
    message: 'gateway rejected sb_publishable_abcdefghijklmnopqrst for sb_secret_zyxwvutsrqponmlkjihg',
  });
  assert.doesNotMatch(line.message, /sb_publishable_abcdefghijklmnopqrst/);
  assert.doesNotMatch(line.message, /sb_secret_zyxwvutsrqponmlkjihg/);
  assert.match(line.message, /\[redacted\]/);
});
