/**
 * Shutdown, tested with a real signal rather than a stand-in.
 *
 * The unit-level tests below exercise the pieces; the last one spawns an actual
 * child process, lets it enter a twenty-minute sleep, sends it a real SIGTERM
 * and measures how long it takes to exit. That is the only version of this test
 * that would have caught the original bug, because the original bug was
 * precisely that the process was correct in every respect except that it was
 * not listening while it slept.
 *
 * The child never leaves the machine: its fetch is a stub.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createInterruptibleSleep, installShutdownHandlers, runRenewalLoop } from '../src/renewer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
  const config = {
    healthUrl: 'https://example.invalid/functions/v1/tournament-media-signer',
    apikey: 'k', authorizationJwt: 'j', attestationSecret: 'x'.repeat(48),
    ttlSeconds: 3600, safetyMarginSeconds: 900, intervalSeconds: 1200, jitterRatio: 0,
    maxAttempts: 1, timeoutMs: 500, backoffBaseMs: 10, backoffMaxMs: 20, alertAfterFailures: 2,
  };
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

test('a real SIGTERM during the interval sleep ends the process in under five seconds', async () => {
  // A standalone harness: the renewer's own loop and shutdown wiring, a stubbed
  // fetch, and a twenty-minute interval so the process is certainly asleep when
  // the signal arrives.
  const harness = `
    import { createInterruptibleSleep, installShutdownHandlers, runRenewalLoop } from ${JSON.stringify(path.join(HERE, '..', 'src', 'renewer.mjs'))};
    const config = {
      healthUrl: 'https://example.invalid/functions/v1/tournament-media-signer',
      apikey: 'k', authorizationJwt: 'j', attestationSecret: 'x'.repeat(48),
      ttlSeconds: 3600, safetyMarginSeconds: 900, intervalSeconds: 1200, jitterRatio: 0,
      maxAttempts: 1, timeoutMs: 500, backoffBaseMs: 10, backoffMaxMs: 20, alertAfterFailures: 2,
    };
    const fetchImpl = async () => ({
      status: 200,
      json: async () => ({ service: 'signer', release: '0.1.0', evidence: { signedUploadUrls: true, signedReadUrls: true } }),
    });
    let stopping = false;
    const napper = createInterruptibleSleep();
    const remove = installShutdownHandlers({
      onSignal: () => { stopping = true; napper.cancel(); },
    });
    const log = (event) => {
      if (event === 'renewal_sleeping') process.stdout.write('ASLEEP\\n');
    };
    await runRenewalLoop({ config, deps: { log, sleep: napper.sleep, fetchImpl }, shouldContinue: () => !stopping });
    remove();
    process.stdout.write('STOPPED\\n');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', harness], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the child never reached its sleep')), 10_000);
    child.stdout.on('data', () => {
      if (out.includes('ASLEEP')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('the child exited before sleeping')); });
  });

  const sentAt = Date.now();
  child.kill('SIGTERM');
  const code = await new Promise((resolve) => child.on('exit', resolve));
  const elapsedMs = Date.now() - sentAt;

  assert.ok(elapsedMs < 5000, `SIGTERM during the sleep must terminate in under 5s, took ${elapsedMs}ms`);
  assert.equal(code, 0, 'a requested shutdown is a clean exit, not a failure');
  assert.match(out, /STOPPED/, 'the loop must finish rather than be killed mid-sleep');
});
