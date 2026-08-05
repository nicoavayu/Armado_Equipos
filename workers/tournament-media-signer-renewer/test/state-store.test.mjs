/**
 * The state file and the lock: everything that makes `--once` able to alert,
 * and everything that keeps two renewers from becoming one confused one.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RenewerStateError, acquireLock, emptyState, lockPathFor, readState, writeState,
} from '../src/state-store.mjs';
import {
  OUTCOME, createRenewerState, persistableState, runRenewalCycle,
} from '../src/renewer.mjs';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'renewer-state-'));

const expectStateCode = (code, run) => assert.throws(run, (error) => (
  error instanceof RenewerStateError && error.code === code
));

const config = {
  healthUrl: 'https://example.invalid/functions/v1/tournament-media-signer',
  apikey: 'apikey-fixture',
  authorizationJwt: 'jwt-fixture',
  attestationSecret: 'x'.repeat(48),
  ttlSeconds: 3600,
  safetyMarginSeconds: 900,
  maxAttempts: 1,
  timeoutMs: 1000,
  backoffBaseMs: 10,
  backoffMaxMs: 20,
  jitterRatio: 0,
  alertAfterFailures: 2,
};

const failingFetch = async () => ({ status: 503, json: async () => ({}) });
const okFetch = async () => ({
  status: 200,
  json: async () => ({
    service: 'signer', release: '0.1.0', evidence: { signedUploadUrls: true, signedReadUrls: true },
  }),
});

// --- the file itself -------------------------------------------------------

test('a state file is written atomically, with mode 0600, and read back exactly', () => {
  const dir = tempDir();
  const file = path.join(dir, 'renewer.json');
  const written = writeState(file, {
    consecutiveFailures: 3,
    lastSuccessAt: '2099-01-01T00:00:00.000Z',
    lastFailureCode: 'SIGNER_UNAVAILABLE',
    alerting: true,
    updatedAt: '2099-01-01T00:10:00.000Z',
  });
  assert.equal((fs.statSync(file).mode & 0o777), 0o600);
  assert.deepEqual(readState(file).state, written);
  // No temp file survives a successful write.
  assert.deepEqual(fs.readdirSync(dir), ['renewer.json']);
});

test('an absent state file is an empty state, not an error', () => {
  const file = path.join(tempDir(), 'never-written.json');
  const { state, existed } = readState(file);
  assert.equal(existed, false);
  assert.deepEqual(state, emptyState());
});

test('a corrupt state file fails closed instead of resetting the counter', () => {
  const dir = tempDir();
  // Truncated JSON, as a crash mid-write would leave if writes were not atomic.
  const truncated = path.join(dir, 'truncated.json');
  fs.writeFileSync(truncated, '{"schemaVersion":1,"consecutiveFa', { mode: 0o600 });
  expectStateCode('RENEWER_STATE_CORRUPT', () => readState(truncated));

  // Valid JSON of the wrong shape is corruption too: this file has exactly one
  // writer, so a field it did not write means it is not the file we think it is.
  const foreign = path.join(dir, 'foreign.json');
  fs.writeFileSync(foreign, JSON.stringify({ ...emptyState(), injected: true }), { mode: 0o600 });
  expectStateCode('RENEWER_STATE_CORRUPT', () => readState(foreign));

  const negative = path.join(dir, 'negative.json');
  fs.writeFileSync(negative, JSON.stringify({ ...emptyState(), consecutiveFailures: -4 }), { mode: 0o600 });
  expectStateCode('RENEWER_STATE_CORRUPT', () => readState(negative));

  const oldSchema = path.join(dir, 'old.json');
  fs.writeFileSync(oldSchema, JSON.stringify({ ...emptyState(), schemaVersion: 99 }), { mode: 0o600 });
  expectStateCode('RENEWER_STATE_CORRUPT', () => readState(oldSchema));
});

test('a state file readable by anyone else is refused, not silently narrowed', () => {
  const file = path.join(tempDir(), 'wide.json');
  writeState(file, emptyState());
  fs.chmodSync(file, 0o644);
  expectStateCode('RENEWER_STATE_PERMISSIONS', () => readState(file));
  // Refusing rather than repairing keeps the evidence that somebody widened it.
  assert.equal((fs.statSync(file).mode & 0o777), 0o644);
});

test('the state file carries no secret and no response body', () => {
  const file = path.join(tempDir(), 'state.json');
  const state = createRenewerState();
  state.consecutiveFailures = 2;
  state.lastFailureCode = 'SIGNER_UNAVAILABLE';
  writeState(file, persistableState(state));
  const text = fs.readFileSync(file, 'utf8');
  for (const forbidden of [config.attestationSecret, config.authorizationJwt, config.apikey, 'https://']) {
    assert.doesNotMatch(text, new RegExp(forbidden));
  }
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [
    'alerting', 'consecutiveFailures', 'lastFailureCode', 'lastSuccessAt', 'schemaVersion', 'updatedAt',
  ]);
});

// --- what the state file is for --------------------------------------------

test('two --once runs accumulate failures and reach the alert threshold', async () => {
  const file = path.join(tempDir(), 'once.json');
  const lines = [];
  const log = (event, detail) => lines.push({ event, ...detail });

  // Run one: one failure, below the threshold, nothing alerts.
  const first = createRenewerState(readState(file).state);
  await runRenewalCycle({ state: first, config, deps: { fetchImpl: failingFetch, log, sleep: async () => {} } });
  writeState(file, persistableState(first));
  assert.equal(first.consecutiveFailures, 1);
  assert.equal(lines.filter(({ event }) => event === 'renewal_alert').length, 0);

  // Run two: a brand new process, which is exactly the point.
  const second = createRenewerState(readState(file).state);
  assert.equal(second.consecutiveFailures, 1, 'the counter has to survive the process');
  const { outcome } = await runRenewalCycle({
    state: second, config, deps: { fetchImpl: failingFetch, log, sleep: async () => {} },
  });
  writeState(file, persistableState(second));
  assert.equal(outcome, OUTCOME.FAILED);
  assert.equal(second.consecutiveFailures, 2);
  const alerts = lines.filter(({ event }) => event === 'renewal_alert');
  assert.equal(alerts.length, 1, 'the second consecutive failure must alert');
  assert.equal(alerts[0].value, 2);
  assert.equal(readState(file).state.alerting, true);
});

test('a later success clears the persisted state and emits recovery', async () => {
  const file = path.join(tempDir(), 'recovery.json');
  writeState(file, {
    consecutiveFailures: 4,
    lastSuccessAt: null,
    lastFailureCode: 'SIGNER_UNAVAILABLE',
    alerting: true,
    updatedAt: '2099-01-01T00:00:00.000Z',
  });
  const lines = [];
  const state = createRenewerState(readState(file).state);
  assert.equal(state.alerting, true);
  await runRenewalCycle({
    state,
    config,
    deps: { fetchImpl: okFetch, log: (event, detail) => lines.push({ event, ...detail }) },
  });
  writeState(file, persistableState(state));
  const persisted = readState(file).state;
  assert.equal(persisted.consecutiveFailures, 0);
  assert.equal(persisted.alerting, false);
  assert.equal(persisted.lastFailureCode, null);
  assert.ok(Date.parse(persisted.lastSuccessAt) > 0, 'recovery records when the renewal happened');
  assert.equal(lines.filter(({ event }) => event === 'renewal_recovered').length, 1);
});

// --- one writer ------------------------------------------------------------

test('a second process is refused the lock while the first holds it', () => {
  const file = path.join(tempDir(), 'state.json.lock');
  const first = acquireLock(file);
  expectStateCode('RENEWER_LOCK_HELD', () => acquireLock(file));
  first.release();
  // Once released the lock is available again, and releasing twice is a no-op.
  const second = acquireLock(file);
  first.release();
  second.release();
  assert.equal(fs.existsSync(file), false);
});

test('a lock left behind by a dead process is taken over only when it is also old', () => {
  const dir = tempDir();
  const file = path.join(dir, 'stale.lock');
  // A pid that cannot exist, so liveness is unambiguous.
  fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 30, at: new Date(0).toISOString() }), { mode: 0o600 });

  // Dead but fresh: still refused, because a brand-new owner may simply not be
  // visible in the process table yet.
  expectStateCode('RENEWER_LOCK_HELD',
    () => acquireLock(file, { now: 1000, staleAfterMs: 60_000 }));

  // Dead and old: taken over.
  const taken = acquireLock(file, { now: 3_600_000, staleAfterMs: 60_000 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, process.pid);
  taken.release();
});

test('a lock held by a live process is never taken over, however old it is', () => {
  const file = path.join(tempDir(), 'live.lock');
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date(0).toISOString() }), { mode: 0o600 });
  expectStateCode('RENEWER_LOCK_HELD',
    () => acquireLock(file, { now: Date.now(), staleAfterMs: 1 }));
});

test('the lock path is derived from the state path, so one setting configures both', () => {
  assert.equal(lockPathFor('/var/lib/renewer/state.json'), '/var/lib/renewer/state.json.lock');
});
