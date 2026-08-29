/**
 * The lock, against real competitors.
 *
 * The failure this file exists for cannot be reproduced in one process: two
 * renewers that both observe the same stale lock, both remove it and both
 * recreate it, each convinced it is the only writer. So the central test here
 * spawns two actual child processes, releases them at the same wall-clock
 * instant, and asserts that exactly one of them ends up owning the lock.
 *
 * The paused-process test is likewise real: it SIGSTOPs a child that holds the
 * lock, because "the owner is not responding" and "the owner is gone" are the
 * two states a lock must never confuse, and only a genuinely stopped process
 * demonstrates the difference.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RenewerStateError, acquireLock, isLockStale, processIdentity,
} from '../src/state-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(HERE, '..', 'src', 'state-store.mjs');
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'renewer-lock-'));

const expectCode = (code, run) => assert.throws(run, (error) => (
  error instanceof RenewerStateError && error.code === code
));

/** A dead pid, high enough that it cannot be in use. */
const DEAD_PID = 2 ** 30;

/**
 * Spawns a module child. NOTE the argv shape: under `node -e`, the script's own
 * arguments begin at `process.argv[1]`, not `[2]` — there is no script path to
 * occupy that slot. Children below therefore read `process.argv.slice(1)`.
 */
const runChild = (source, args = []) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, ...args],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  const done = new Promise((resolve) => {
    child.on('exit', (code) => resolve({ code, out, err }));
  });
  return {
    child, done, get out() { return out; }, get err() { return err; },
  };
};

/**
 * Waits for a holder child to announce that it owns the lock. Polls the
 * accumulated output rather than racing a second `data` listener, and surfaces
 * the child's stderr on timeout so a broken harness is never mistaken for a
 * broken lock.
 */
async function waitForHeld(holder, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (holder.out.includes('HELD')) return;
    if (holder.child.exitCode !== null) {
      throw new Error(`the holder exited early (${holder.child.exitCode}): ${holder.err}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(`the holder never took the lock: ${holder.err || '(no stderr)'}`);
}

// --- two real processes, one stale lock -------------------------------------

test('two real processes racing for one stale lock produce exactly one winner', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'race.lock');
  // A lock from a process that is definitely gone, definitely old, and from
  // this host and this boot — so the ONLY thing standing between the two
  // children is the takeover protocol itself.
  fs.writeFileSync(file, `${JSON.stringify({
    v: 1,
    pid: DEAD_PID,
    host: os.hostname(),
    bootEpochSeconds: Math.round(Date.now() / 1000 - os.uptime()),
    startedAtEpochMs: 1,
    nonce: 'stale-nonce-0000',
    at: new Date(Date.now() - 3_600_000).toISOString(),
  })}\n`, { mode: 0o600 });

  // Both children busy-wait to the same millisecond before calling, so they
  // are genuinely concurrent rather than merely both started.
  const startAt = Date.now() + 400;
  const source = `
    import { acquireLock } from ${JSON.stringify(STORE)};
    const [file, startAt] = process.argv.slice(1);
    while (Date.now() < Number(startAt)) { /* spin to the shared instant */ }
    try {
      const lock = acquireLock(file, { staleAfterMs: 60_000 });
      process.stdout.write('ACQUIRED ' + lock.identity.nonce + '\\n');
      // Hold it briefly so the winner is observable on disk.
      await new Promise((r) => setTimeout(r, 300));
      lock.release();
    } catch (error) {
      process.stdout.write('REFUSED ' + error.code + '\\n');
    }
  `;
  const a = runChild(source, [file, String(startAt)]);
  const b = runChild(source, [file, String(startAt)]);
  const [first, second] = await Promise.all([a.done, b.done]);

  const outputs = [first.out.trim(), second.out.trim()];
  const acquired = outputs.filter((line) => line.startsWith('ACQUIRED'));
  const refused = outputs.filter((line) => line.startsWith('REFUSED'));
  assert.equal(acquired.length, 1,
    `exactly one process may take a stale lock, got ${JSON.stringify(outputs)}`);
  assert.equal(refused.length, 1, `the loser must refuse, got ${JSON.stringify(outputs)}`);
  assert.match(refused[0], /RENEWER_LOCK_HELD/);
});

test('a lock held by a live child process is never taken over', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'held.lock');
  const holder = runChild(`
    import { acquireLock } from ${JSON.stringify(STORE)};
    const lock = acquireLock(process.argv[1]);
    process.stdout.write('HELD\\n');
    await new Promise((r) => setTimeout(r, 3000));
    lock.release();
  `, [file]);
  try {
    await waitForHeld(holder);
    // However old we claim the lock is, a live owner is a live owner.
    expectCode('RENEWER_LOCK_HELD', () => acquireLock(file, { staleAfterMs: 1 }));
  } finally {
    holder.child.kill('SIGKILL');
    await holder.done;
  }
});

test('a PAUSED holder is not mistaken for a dead one', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'paused.lock');
  const holder = runChild(`
    import { acquireLock } from ${JSON.stringify(STORE)};
    const lock = acquireLock(process.argv[1]);
    process.stdout.write('HELD\\n');
    await new Promise((r) => setTimeout(r, 5000));
    lock.release();
  `, [file]);
  try {
    await waitForHeld(holder);
    // Stopped, not dead. It will resume, still believing it owns the counter.
    holder.child.kill('SIGSTOP');
    expectCode('RENEWER_LOCK_HELD', () => acquireLock(file, { staleAfterMs: 1 }));
    holder.child.kill('SIGCONT');
  } finally {
    holder.child.kill('SIGKILL');
    await holder.done;
  }
});

// --- release is scoped to what we still own ---------------------------------

test('release deletes only a lock that is still ours', () => {
  const dir = tempDir();
  const file = path.join(dir, 'ours.lock');
  const mine = acquireLock(file);
  // Somebody else took it over while we were not looking — the exact situation
  // a paused process wakes up into.
  fs.writeFileSync(file, `${JSON.stringify({
    v: 1, pid: process.pid, host: os.hostname(), nonce: 'somebody-else', at: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  mine.release();
  assert.equal(fs.existsSync(file), true, 'releasing must not delete another instance\'s lock');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).nonce, 'somebody-else');
});

test('release is idempotent and removes its own lock exactly once', () => {
  const file = path.join(tempDir(), 'own.lock');
  const lock = acquireLock(file);
  lock.release();
  assert.equal(fs.existsSync(file), false);
  lock.release();
  // A second instance may now claim it, and the first one's extra release must
  // not remove that.
  const next = acquireLock(file);
  lock.release();
  assert.equal(fs.existsSync(file), true);
  next.release();
});

// --- staleness decisions ----------------------------------------------------

test('a clock that moved backwards never makes a lock look stale', () => {
  const identity = processIdentity();
  const holder = {
    pid: DEAD_PID,
    host: identity.host,
    bootEpochSeconds: identity.bootEpochSeconds,
    // Stamped in the future: the wall clock was corrected backwards after the
    // lock was taken. Reading that as "very old" would be a licence to steal.
    at: new Date(Date.now() + 3_600_000).toISOString(),
  };
  assert.equal(isLockStale(holder, { now: Date.now(), staleAfterMs: 1, identity }), false);
});

test('a lock from a previous boot is stale even if its pid is alive now', () => {
  const identity = processIdentity();
  const holder = {
    // Our own pid, which is certainly alive — and certainly not the process
    // that took this lock, because the machine has rebooted since.
    pid: process.pid,
    host: identity.host,
    bootEpochSeconds: identity.bootEpochSeconds - 86_400,
    at: new Date(Date.now() - 86_400_000).toISOString(),
  };
  assert.equal(isLockStale(holder, { now: Date.now(), staleAfterMs: 60_000, identity }), true);
});

test('a lock from another host is never taken over, because liveness cannot be checked', () => {
  const identity = processIdentity();
  const holder = {
    pid: DEAD_PID,
    host: `${identity.host}-somewhere-else`,
    bootEpochSeconds: identity.bootEpochSeconds,
    at: new Date(0).toISOString(),
  };
  assert.equal(isLockStale(holder, { now: Date.now(), staleAfterMs: 1, identity }), false);
});

test('an unreadable lock record is refused rather than assumed abandoned', () => {
  const file = path.join(tempDir(), 'garbage.lock');
  fs.writeFileSync(file, 'not json at all', { mode: 0o600 });
  expectCode('RENEWER_LOCK_HELD', () => acquireLock(file, { staleAfterMs: 1 }));
});

test('the lock identity distinguishes processes beyond the pid alone', () => {
  const a = processIdentity();
  const b = processIdentity();
  assert.notEqual(a.nonce, b.nonce, 'the nonce is what makes release provable');
  assert.equal(a.pid, b.pid);
  assert.equal(a.host, os.hostname());
  assert.ok(Number.isFinite(a.bootEpochSeconds));
  assert.ok(a.startedAtEpochMs > 0 && a.startedAtEpochMs <= Date.now());
});
