/**
 * Shared test fixtures.
 *
 * The config object is built through the real `createTarget`, not hand-written,
 * so a test can never accidentally exercise a request path with a descriptor
 * shape that production could not produce. Every suite that fakes a config now
 * gets the same one from here.
 */

import { createTarget } from '../src/target.mjs';

export const TEST_ORIGIN = 'https://example.invalid';
export const TEST_FUNCTION = 'tournament-media-signer';

/** A frozen descriptor for the fake host the offline suites use. */
export const testTarget = (overrides = {}) => createTarget({
  origin: TEST_ORIGIN,
  functionName: TEST_FUNCTION,
  ...overrides,
});

/**
 * A complete renewer config with a real descriptor attached. The numbers are
 * the small, fast variants the offline suites want; anything a test cares about
 * it passes in `overrides`.
 */
export function testConfig(overrides = {}) {
  const target = overrides.target || testTarget();
  return {
    origin: target.origin,
    host: target.hostname,
    projectRef: target.projectRef,
    functionName: target.functionName,
    target,
    healthUrl: target.url,
    apikey: 'k',
    authorizationJwt: 'j',
    attestationSecret: 'x'.repeat(48),
    ttlSeconds: 3600,
    safetyMarginSeconds: 900,
    intervalSeconds: 1200,
    jitterRatio: 0,
    maxAttempts: 1,
    timeoutMs: 500,
    backoffBaseMs: 10,
    backoffMaxMs: 20,
    alertAfterFailures: 2,
    knownAttestationExpiresAtMs: null,
    instanceId: 'test-renewer',
    ...overrides,
  };
}

/** A signer `health` response that satisfies every shape check. */
export const okHealthBody = () => ({
  service: 'signer',
  release: '0.1.0',
  evidence: { signedUploadUrls: true, signedReadUrls: true },
});
