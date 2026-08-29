/**
 * Shutdown, against the real entrypoint.
 *
 * Every test here spawns `src/cli.mjs` itself — the real file, with the real
 * argv, the real config parsing, the real lock, the real state file and the
 * real `isMain` bootstrap — and sends it a real SIGTERM. Nothing is re-created
 * inline. That matters because the bug being guarded against was never in the
 * loop's logic; it was in what the process was blocked on when the signal
 * arrived, and only a process can be blocked.
 *
 * The single thing that is substituted is the network: an ESM preload replaces
 * `globalThis.fetch` before the CLI is loaded. That is not a way of avoiding the
 * real code path — the CLI still builds the request, still validates the target,
 * still applies its timeout — it is how the suite gets a request that hangs on
 * demand without a packet leaving the machine. The preload also records every
 * call, so "no new attempt was started after stopping" is an assertion about
 * observed behaviour rather than an inference.
 *
 * The four blocking points a shutdown has to reach are covered one by one:
 * a hung fetch, a fetch waiting out its timeout, a backoff between retries, and
 * the second retry itself. The state write is covered too, by interrupting the
 * process at the exact moment it renames the state file into place.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'cli.mjs');

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const REF = 'stagingref0000000000';
const jwt = () => [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ iss: 'supabase', ref: REF, role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 }),
  'fixture-signature',
].join('.');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'renewer-sigterm-'));

/**
 * The preload. `MODE` decides what the stubbed fetch does; `CALLS` is where it
 * records that it was invoked at all.
 *
 *   hang     never settles unless the request is aborted
 *   fail     answers 503 immediately, so the CLI goes into its backoff
 *   failhang answers 503 once, then hangs on every later attempt
 */
const PRELOAD = `
import fs from 'node:fs';

const calls = process.env.RENEWER_TEST_CALLS;
const mode = process.env.RENEWER_TEST_MODE || 'hang';
let n = 0;

const record = (what) => fs.appendFileSync(calls, what + '\\n');

const hang = (init) => new Promise((resolve, reject) => {
  // A pending request holds an open socket, and an open socket holds the event
  // loop. Without this timer the stub would let Node run out of work and exit
  // on its own before any signal arrived — which would make the whole suite
  // pass for entirely the wrong reason. This models the socket.
  const openSocket = setTimeout(() => {}, 3600_000);
  const abort = () => {
    clearTimeout(openSocket);
    const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
  };
  const signal = init && init.signal;
  if (!signal) return;
  if (signal.aborted) { abort(); return; }
  signal.addEventListener('abort', abort, { once: true });
});

globalThis.fetch = (url, init) => {
  n += 1;
  record('fetch:' + n);
  if (mode === 'fail') {
    return Promise.resolve({ status: 503, redirected: false, json: async () => ({}) });
  }
  if (mode === 'failhang' && n === 1) {
    return Promise.resolve({ status: 503, redirected: false, json: async () => ({}) });
  }
  return hang(init);
};

// Interrupts the process at the precise moment the state file is renamed into
// place, which is the one instant where a half-applied write would be visible.
if (process.env.RENEWER_TEST_SIGNAL_ON_RENAME === '1') {
  const realRename = fs.renameSync;
  fs.renameSync = function patched(from, to) {
    if (String(to).endsWith('state.json')) {
      record('rename');
      process.kill(process.pid, 'SIGTERM');
    }
    return realRename.call(this, from, to);
  };
}
`;

/**
 * Spawns the real CLI. Returns the child plus the paths the assertions need.
 * Nothing here reaches the network: the preload has already replaced fetch by
 * the time the CLI is imported.
 */
function spawnCli({ argv = [], mode = 'hang', env = {}, dir = tempDir() } = {}) {
  const preload = path.join(dir, 'preload.mjs');
  const calls = path.join(dir, 'calls.log');
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(preload, PRELOAD);
  fs.writeFileSync(calls, '');

  const child = spawn(process.execPath, ['--import', preload, CLI, ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      RENEWER_TEST_CALLS: calls,
      RENEWER_TEST_MODE: mode,
      SUPABASE_URL: `https://${REF}.supabase.co`,
      TOURNAMENT_MEDIA_EXPECTED_API_HOST: `${REF}.supabase.co`,
      TOURNAMENT_MEDIA_ATTESTATION_SECRET: 'x'.repeat(48),
      SUPABASE_ANON_KEY: jwt(),
      TOURNAMENT_MEDIA_RENEW_STATE_FILE: statePath,
      TOURNAMENT_MEDIA_RENEW_INTERVAL_SECONDS: '60',
      TOURNAMENT_MEDIA_RENEW_TIMEOUT_MS: '30000',
      TOURNAMENT_MEDIA_RENEW_MAX_ATTEMPTS: '2',
      TOURNAMENT_MEDIA_RENEW_BACKOFF_MS: '20000',
      TOURNAMENT_MEDIA_RENEW_BACKOFF_MAX_MS: '20000',
      TOURNAMENT_MEDIA_RENEW_JITTER_RATIO: '0',
      ...env,
    },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, out, err }));
  });
  return {
    child,
    dir,
    calls,
    statePath,
    lockPath: `${statePath}.lock`,
    exited,
    get out() { return out; },
    get err() { return err; },
    callCount: () => fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length,
    /**
     * Unconditional cleanup. A test that fails its wait must still not leave a
     * child holding a lock and a pipe, or the whole file hangs at exit and the
     * real failure is never reported.
     */
    async dispose() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    },
  };
}

/** Runs a test body and disposes of the child however it ends. */
const withCli = async (options, body) => {
  const run = spawnCli(options);
  try {
    return await body(run);
  } finally {
    await run.dispose();
  }
};

/** Waits until the child has actually reached the blocking point under test. */
async function waitUntil(predicate, { timeoutMs = 8000, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** SIGTERM, then the two things every shutdown must guarantee. */
async function terminateAndAssert(run, { expectCalls = null } = {}) {
  const sentAt = Date.now();
  run.child.kill('SIGTERM');
  const result = await run.exited;
  const elapsedMs = Date.now() - sentAt;

  assert.ok(elapsedMs < 5000,
    `SIGTERM must terminate in under 5s, took ${elapsedMs}ms (stderr: ${result.err})`);
  assert.equal(result.signal, null, 'the process must exit on its own, not be killed');
  // The lock is gone, so the next scheduled run is not refused by a lock whose
  // owner no longer exists.
  assert.equal(fs.existsSync(run.lockPath), false, 'the lock must be released before exit');
  // The state survived, because the failure counter is the only thing that
  // makes `--once` able to alert at all.
  assert.equal(fs.existsSync(run.statePath), true, 'the state must be persisted before exit');
  const persisted = JSON.parse(fs.readFileSync(run.statePath, 'utf8'));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(fs.lstatSync(run.statePath).mode & 0o777, 0o600);
  if (expectCalls !== null) {
    assert.equal(run.callCount(), expectCalls,
      `expected exactly ${expectCalls} request(s) to have been started`);
  }
  return { result, elapsedMs, persisted };
}

// --- the four blocking points -----------------------------------------------

/** One attempt per cycle, so a loop-mode test reaches its interval sleep fast. */
const SINGLE_ATTEMPT = { TOURNAMENT_MEDIA_RENEW_MAX_ATTEMPTS: '1' };

test('SIGTERM during a hung fetch aborts the request and exits promptly', async () => {
  await withCli({ argv: ['--once'], mode: 'hang' }, async (run) => {
    await waitUntil(() => run.callCount() >= 1, { what: 'the first request' });
    const { result, persisted } = await terminateAndAssert(run, { expectCalls: 1 });
    // A shutdown is not a renewal failure: it must not move the counter that
    // drives the alert, or a rolling restart would manufacture alerts.
    assert.equal(persisted.consecutiveFailures, 0);
    assert.equal(persisted.alerting, false);
    assert.match(result.out, /shutdown_requested/);
    assert.doesNotMatch(result.out, /renewal_alert/);
  });
});

test('SIGTERM beats a still-running request timeout, and says which one it was', async () => {
  // The timeout is 30s and the signal arrives within one. If the shutdown did
  // not reach the request, this test would take thirty seconds.
  await withCli({ argv: ['--once'], mode: 'hang' }, async (run) => {
    await waitUntil(() => run.callCount() >= 1, { what: 'the first request' });
    const { result, elapsedMs } = await terminateAndAssert(run, { expectCalls: 1 });
    assert.ok(elapsedMs < 5000, 'the 30s timeout must not be waited out');
    // Timeout and shutdown stay distinguishable in the log stream.
    assert.doesNotMatch(result.out, /SIGNER_TIMEOUT/);
    assert.match(result.out, /"event":"renewal_interrupted"/);
  });
});

test('SIGTERM during a backoff ends it, and no further attempt is started', async () => {
  // The first attempt fails immediately, so the process is sitting in a
  // twenty-second backoff when the signal arrives.
  await withCli({ argv: ['--once'], mode: 'failhang' }, async (run) => {
    await waitUntil(() => run.out.includes('renewal_attempt_failed'), { what: 'the first failure' });
    // Exactly one request has been made and the second must never be started.
    const { elapsedMs } = await terminateAndAssert(run, { expectCalls: 1 });
    assert.ok(elapsedMs < 5000, 'the 20s backoff must not be waited out');
  });
});

test('SIGTERM during the second retry aborts that attempt too', async () => {
  // Attempt one fails fast; attempt two hangs. Signal arrives during attempt
  // two, which is a different code path from signalling during attempt one.
  await withCli({
    argv: ['--once'],
    mode: 'failhang',
    env: { TOURNAMENT_MEDIA_RENEW_BACKOFF_MS: '100', TOURNAMENT_MEDIA_RENEW_BACKOFF_MAX_MS: '100' },
  }, async (run) => {
    await waitUntil(() => run.callCount() >= 2, { what: 'the second attempt' });
    await terminateAndAssert(run, { expectCalls: 2 });
  });
});

test('SIGTERM while the state file is being written leaves a complete state', async () => {
  // The signal is delivered from inside the rename itself, so the process is
  // interrupted at the one instant a torn write would be observable.
  await withCli({
    argv: ['--once'],
    mode: 'fail',
    env: { ...SINGLE_ATTEMPT, RENEWER_TEST_SIGNAL_ON_RENAME: '1' },
  }, async (run) => {
    const result = await run.exited;
    assert.equal(result.signal, null, 'the process must not be killed mid-write');
    assert.equal(fs.existsSync(run.lockPath), false, 'the lock is released even on this path');
    // The file is complete and valid — the rename is atomic, so it is either
    // the old state or the new one, never half of either.
    const persisted = JSON.parse(fs.readFileSync(run.statePath, 'utf8'));
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(persisted.consecutiveFailures, 1, 'the failed cycle was recorded');
    assert.equal(fs.lstatSync(run.statePath).mode & 0o777, 0o600);
    // No temp files left behind by the interrupted write.
    assert.deepEqual(fs.readdirSync(run.dir).filter((entry) => entry.endsWith('.tmp')), []);
  });
});

// --- the long-running shape -------------------------------------------------

test('SIGTERM during the interval sleep of the real loop exits promptly and cleanly', async () => {
  await withCli({ argv: [], mode: 'fail', env: SINGLE_ATTEMPT }, async (run) => {
    await waitUntil(() => run.out.includes('renewal_sleeping'), { what: 'the interval sleep' });
    const { result } = await terminateAndAssert(run);
    assert.equal(result.code, 0, 'a requested shutdown is a clean exit, not a failure');
    assert.match(result.out, /"event":"renewer_stopped"/);
    assert.match(result.out, /"stoppedBy":"SIGTERM"/);
  });
});

test('SIGINT is handled exactly like SIGTERM', async () => {
  await withCli({ argv: [], mode: 'fail', env: SINGLE_ATTEMPT }, async (run) => {
    await waitUntil(() => run.out.includes('renewal_sleeping'), { what: 'the interval sleep' });
    const sentAt = Date.now();
    run.child.kill('SIGINT');
    const result = await run.exited;
    assert.ok(Date.now() - sentAt < 5000);
    assert.equal(result.code, 0);
    assert.equal(fs.existsSync(run.lockPath), false);
    assert.match(result.out, /"signal":"SIGINT"/);
  });
});

test('a second signal during the wind-down does not re-enter the teardown', async () => {
  await withCli({ argv: [], mode: 'hang', env: SINGLE_ATTEMPT }, async (run) => {
    await waitUntil(() => run.callCount() >= 1, { what: 'the first request' });
    run.child.kill('SIGTERM');
    run.child.kill('SIGTERM');
    const result = await run.exited;
    assert.equal(fs.existsSync(run.lockPath), false);
    const requests = result.out.split('\n').filter((line) => line.includes('shutdown_requested'));
    assert.equal(requests.length, 1, 'the shutdown must be requested exactly once');
  });
});

// --- no credential anywhere in the transcript -------------------------------

test('nothing the interrupted process printed names a credential', async () => {
  await withCli({ argv: ['--once'], mode: 'hang' }, async (run) => {
    await waitUntil(() => run.callCount() >= 1, { what: 'the first request' });
    const { result } = await terminateAndAssert(run);
    const transcript = `${result.out}\n${result.err}`;
    assert.ok(transcript.length > 0);
    assert.ok(!transcript.includes('x'.repeat(48)), 'the attestation secret must never be printed');
    assert.doesNotMatch(transcript, /eyJ[A-Za-z0-9_-]{8,}\./, 'no JWT may be printed');
    assert.doesNotMatch(transcript, /"headers"/);
    assert.doesNotMatch(transcript, /Bearer\s+\S/);
    // ...and the state file is not a back door for them either.
    assert.ok(!fs.readFileSync(run.statePath, 'utf8').includes('x'.repeat(48)));
  });
});
