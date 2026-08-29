/**
 * Shutdown, at the unit level: the sleep, the signal wiring, and the one
 * `createShutdown` object that ties the request, the timeout, the backoff and
 * the interval to a single cancellation.
 *
 * The process-level half of this — a real SIGTERM sent to the real
 * `src/cli.mjs` while it is blocked on each of those four things in turn —
 * lives in `shutdown-process.test.mjs`. The split is deliberate: what is tested
 * here is the shape of the pieces, and what is tested there is the behaviour of
 * the actual entrypoint, which is the only thing an orchestrator will ever
 * signal.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  OUTCOME, createInterruptibleSleep, createRenewerState, createShutdown,
  installShutdownHandlers, renewWithRetries, runRenewalCycle, runRenewalLoop,
} from '../src/renewer.mjs';
import { testConfig } from './fixtures.mjs';

test('an interrupted sleep resolves immediately and reports why it woke', async () => {
  const napper = createInterruptibleSleep();
  const started = Date.now();
  const pending = napper.sleep(60_000);
  napper.cancel();
  assert.equal(await pending, 'cancelled');
  assert.ok(Date.now() - started < 1000);
  // Cancelling twice, or sleeping after a cancel, is a no-op rather than a hang.
  napper.cancel();
  assert.equal(await napper.sleep(60_000), 'cancelled');
});

test('an uninterrupted sleep still reports as elapsed', async () => {
  const napper = createInterruptibleSleep();
  assert.equal(await napper.sleep(1), 'elapsed');
});

test('shutdown handlers are registered once and fully removed', () => {
  const target = new EventEmitter();
  const seen = [];
  const remove = installShutdownHandlers({
    target, signals: ['SIGTERM', 'SIGINT'], onSignal: (signal) => seen.push(signal),
  });
  assert.equal(target.listenerCount('SIGTERM'), 1);
  assert.equal(target.listenerCount('SIGINT'), 1);
  target.emit('SIGTERM');
  assert.deepEqual(seen, ['SIGTERM']);
  remove();
  assert.equal(target.listenerCount('SIGTERM'), 0);
  assert.equal(target.listenerCount('SIGINT'), 0);
});

test('the loop leaves its sleep the moment a shutdown is requested', async () => {
  const napper = createInterruptibleSleep();
  let stopping = false;
  const events = [];
  const config = testConfig();
  const loop = runRenewalLoop({
    config,
    deps: {
      log: (event) => events.push(event),
      sleep: napper.sleep,
      fetchImpl: async () => ({
        status: 200,
        json: async () => ({
          service: 'signer', release: '0.1.0', evidence: { signedUploadUrls: true, signedReadUrls: true },
        }),
      }),
    },
    shouldContinue: () => !stopping,
  });
  // Wait for the loop to actually be asleep before asking it to stop.
  await new Promise((resolve) => { setTimeout(resolve, 25); });
  assert.ok(events.includes('renewal_sleeping'));
  const started = Date.now();
  stopping = true;
  napper.cancel();
  await loop;
  assert.ok(Date.now() - started < 1000, 'the loop must not wait out the interval');
  assert.equal(events.at(-1), 'renewer_stopped');
});

test('one shutdown object reaches the request, the backoff and the interval', async () => {
  const shutdown = createShutdown();
  assert.equal(shutdown.requested, false);
  assert.equal(shutdown.signal.aborted, false);

  const sleeping = shutdown.sleep(60_000);
  assert.equal(shutdown.request('SIGTERM'), true);

  // All three at once: the sleep is cut, the signal is aborted, and the reason
  // is recorded. Before this object each of those had a different owner and
  // only the last one actually happened.
  assert.equal(await sleeping, 'cancelled');
  assert.equal(shutdown.signal.aborted, true);
  assert.equal(shutdown.requested, true);
  assert.equal(shutdown.signalName, 'SIGTERM');

  // Idempotent: a SIGINT following a SIGTERM is ignored rather than re-entered.
  assert.equal(shutdown.request('SIGINT'), false);
  assert.equal(shutdown.signalName, 'SIGTERM');
});

test('a shutdown mid-retry stops the sequence and is not counted as a failure', async () => {
  const shutdown = createShutdown();
  let attempts = 0;
  const result = await renewWithRetries(testConfig({ maxAttempts: 4, backoffBaseMs: 5, backoffMaxMs: 5 }), {
    shutdown,
    sleep: shutdown.sleep,
    fetchImpl: async () => {
      attempts += 1;
      // The operator's signal lands during the second attempt.
      if (attempts === 2) shutdown.request('SIGTERM');
      return { status: 503, redirected: false, json: async () => ({}) };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(attempts, 2, 'no attempt may be started after the shutdown');
  // The cycle reports the shutdown rather than a signer failure, so the
  // consecutive-failure counter and its alert are left alone.
  const state = createRenewerState();
  const { outcome } = await runRenewalCycle({
    state,
    config: testConfig({ maxAttempts: 1 }),
    deps: {
      shutdown,
      sleep: shutdown.sleep,
      fetchImpl: async () => ({ status: 503, redirected: false, json: async () => ({}) }),
    },
  });
  assert.equal(outcome, OUTCOME.SHUTDOWN);
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.alerting, false);
});

// The end-to-end version of all of this — a real SIGTERM to the real
// `src/cli.mjs`, blocked on a real hung request, a real backoff and a real
// state write — lives in `shutdown-process.test.mjs`. It is deliberately not
// duplicated here: an inline copy of the loop can only ever prove that the copy
// shuts down.
