/**
 * The TTL arithmetic, in the one place it now lives, and the packaging that
 * makes the renewer reproducible.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { attestationMargin, worstCaseCycleSeconds } from '../src/schedule.mjs';
import { OUTCOME, createRenewerState, runRenewalCycle } from '../src/renewer.mjs';
import { testConfig } from './fixtures.mjs';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');

const schedule = {
  intervalSeconds: 1200, jitterRatio: 0.1, maxAttempts: 3,
  timeoutMs: 10_000, backoffBaseMs: 2000, backoffMaxMs: 30_000,
};

// --- one implementation of the margin --------------------------------------

test('the worst case respects the backoff cap', () => {
  // Uncapped, four doublings from a 2s base would contribute far more than the
  // cap allows. The version this replaced omitted the cap entirely, so a
  // schedule the renewer refused could still pass manifest validation.
  const capped = worstCaseCycleSeconds({ ...schedule, maxAttempts: 6, backoffMaxMs: 5000 });
  const uncapped = worstCaseCycleSeconds({ ...schedule, maxAttempts: 6, backoffMaxMs: 10 ** 9 });
  assert.ok(capped < uncapped);
  // With the cap, no single backoff may exceed it: five gaps, each ≤ 5s, plus
  // jitter, plus six timeouts, plus the jittered interval.
  assert.ok(capped <= 1200 * 1.1 + (6 * 10 + 5 * 5 * 1.1));
});

test('the renewer config and the manifest validator agree, because they share the function', async () => {
  // readiness-lib imports this exact function; if that import were replaced by
  // a second copy this test would keep passing, so the assertion is on the
  // module identity, not on the numbers.
  const readinessLib = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'torneos-staging', 'readiness-lib.mjs'), 'utf8',
  );
  assert.match(readinessLib,
    /import \{ worstCaseCycleSeconds \} from '\.\.\/\.\.\/workers\/tournament-media-signer-renewer\/src\/schedule\.mjs'/);
  assert.doesNotMatch(readinessLib, /2 \*\* renewal\.maxAttempts/,
    'the manifest validator must not recompute the worst case on its own');
});

// --- initial severity ------------------------------------------------------

test('a known expiry gives a real margin and a proportionate severity', () => {
  const base = { ttlSeconds: 3600, safetyMarginSeconds: 900, now: 10_000_000 };
  // Renewed a moment ago: plenty of margin, so a failure is a warning.
  const fresh = attestationMargin({ ...base, lastSuccessAtMs: base.now - 60_000 });
  assert.equal(fresh.marginProven, true);
  assert.equal(fresh.severity, 'warning');
  assert.ok(fresh.expiresInSeconds > 900);

  // Renewed long enough ago that expiry is inside the safety margin: critical.
  const stale = attestationMargin({ ...base, lastSuccessAtMs: base.now - 3000 * 1000 });
  assert.equal(stale.marginProven, true);
  assert.equal(stale.severity, 'critical');
  assert.equal(stale.reason, 'expiry_within_safety_margin');
});

test('a process that has never succeeded cannot prove a margin and escalates to critical', () => {
  const margin = attestationMargin({
    lastSuccessAtMs: null, ttlSeconds: 3600, safetyMarginSeconds: 900, now: Date.now(),
  });
  assert.equal(margin.marginProven, false);
  assert.equal(margin.expiresInSeconds, null);
  // The old behaviour left this at warning forever, which inverted the
  // relationship between evidence and severity: no evidence is not mild.
  assert.equal(margin.severity, 'critical');
  assert.equal(margin.reason, 'no_known_expiry');
});

test('an operator-supplied expiry restores a provable margin', () => {
  const now = Date.now();
  const margin = attestationMargin({
    lastSuccessAtMs: null,
    knownExpiresAtMs: now + 2400 * 1000,
    ttlSeconds: 3600,
    safetyMarginSeconds: 900,
    now,
  });
  assert.equal(margin.marginProven, true);
  assert.equal(margin.severity, 'warning');
  assert.equal(margin.expiresInSeconds, 2400);
});

test('a cold renewer alerts critical on its first failures, not warning', async () => {
  const lines = [];
  const state = createRenewerState();
  const config = testConfig({ alertAfterFailures: 1 });
  const { outcome } = await runRenewalCycle({
    state,
    config,
    deps: {
      fetchImpl: async () => ({ status: 503, json: async () => ({}) }),
      log: (event, detail) => lines.push({ event, ...detail }),
    },
  });
  assert.equal(outcome, OUTCOME.FAILED);
  const alert = lines.find(({ event }) => event === 'renewal_alert');
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.attestationMarginProven, false);
  assert.equal(alert.attestationExpiresInSeconds, null);
  // Fail-closed all the way through: nothing about the alert keeps the
  // attestation alive, and the process still records no renewal.
  assert.equal(state.lastRenewedAt, null);
});

// --- reproducible packaging ------------------------------------------------

test('the renewer ships a lockfile that pins nothing external', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package-lock.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));
  assert.ok(lock.lockfileVersion >= 3);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  // A renewer with no dependencies is a renewer with no supply chain. If that
  // ever changes, this assertion is the place to make the decision consciously.
  assert.deepEqual(Object.keys(lock.packages), ['']);
  assert.deepEqual(pkg.dependencies, {});
});

test('npm ci installs reproducibly from the lockfile alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewer-ci-'));
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(PACKAGE_DIR, file), path.join(dir, file));
  }
  // Offline on purpose: with no dependencies this must not reach a registry.
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], {
    cwd: dir, stdio: 'pipe',
  });
  // And the lockfile is unchanged by the install, which is what "ci" means.
  assert.equal(
    fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'),
    fs.readFileSync(path.join(PACKAGE_DIR, 'package-lock.json'), 'utf8'),
  );
});

test('an operator can hand the renewer a known expiry through the environment', async () => {
  const { readRenewerConfig, RenewerConfigError } = await import('../src/config.mjs');
  const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({
      iss: 'supabase', ref: 'hhyvmhgpapyuzjgxfnqv', role: 'anon',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'fixture-signature',
  ].join('.');
  const env = (overrides = {}) => ({
    SUPABASE_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co',
    TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'hhyvmhgpapyuzjgxfnqv.supabase.co',
    TOURNAMENT_MEDIA_ATTESTATION_SECRET: 'x'.repeat(48),
    SUPABASE_ANON_KEY: jwt,
    ...overrides,
  });
  assert.equal(readRenewerConfig(env()).knownAttestationExpiresAtMs, null);
  assert.equal(
    readRenewerConfig(env({ TOURNAMENT_MEDIA_ATTESTATION_KNOWN_EXPIRES_AT: '2099-01-01T00:00:00Z' }))
      .knownAttestationExpiresAtMs,
    Date.parse('2099-01-01T00:00:00Z'),
  );
  assert.throws(
    () => readRenewerConfig(env({ TOURNAMENT_MEDIA_ATTESTATION_KNOWN_EXPIRES_AT: 'sometime soon' })),
    (error) => error instanceof RenewerConfigError && error.code === 'RENEWER_KNOWN_EXPIRY_INVALID',
  );
});
