/**
 * The little bit of memory `--once` needs, and the lock that keeps two
 * renewers from becoming one confused renewer.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * `--once` runs one cycle and exits. Its failure counter therefore started at
 * zero every single time, and the alert threshold — two consecutive failures —
 * could never be reached: an external scheduler firing `--once` every twenty
 * minutes could fail for a week and emit `consecutiveFailures: 1` forever,
 * never once emitting `renewal_alert`. The signal the observability catalog
 * declares required, `..._renewal_failures_consecutive`, was structurally
 * unreachable in exactly the deployment shape the runbook recommends.
 *
 * So the counter has to survive between runs, which means a file, which means
 * every rule below.
 *
 * ---------------------------------------------------------------------------
 * Rules for the state file
 * ---------------------------------------------------------------------------
 *   - 0600, created and verified AFTER the rename, on the descriptor rather
 *     than the path. A wider mode is a refusal, not a warning: the file records
 *     operational posture and belongs to one process.
 *   - Never follow a symlink. Every open passes O_NOFOLLOW and every check is
 *     an `fstat` of the descriptor that was actually opened, not a `stat` of a
 *     path that could be swapped between the check and the read. `nlink` must
 *     be exactly 1, so a hard link cannot give a second name to the file we
 *     just validated.
 *   - The file and its directory must belong to this user, and the directory
 *     must not be writable by group or other — otherwise somebody else can
 *     replace the file by renaming over it, and no permission bit on the file
 *     itself would stop them.
 *   - A size cap before reading, so a file that grew into something else is
 *     refused rather than parsed.
 *   - Atomic writes. Write a temp file with a cryptographically random name,
 *     fsync it, rename it over the target, then fsync the DIRECTORY so the
 *     rename itself survives a power loss. A crash mid-write leaves the
 *     previous state, never half of one. The temp file is removed on every
 *     error path.
 *   - Exact types on the way in and on the way out. A field that is the wrong
 *     type is corruption, never something to coerce.
 *   - No secrets, no response bodies, no URLs, no headers. Only a counter, a
 *     timestamp, a failure code and a flag — all of it already present in the
 *     log stream. The allowed field list is closed and enforced in both
 *     directions.
 *   - Corruption fails CLOSED. Unreadable, unparseable or wrong-shaped state is
 *     an error that stops the run. A renewer that silently resets its counter
 *     on a corrupt file is a renewer whose alert can be suppressed by
 *     corrupting a file, and the state file is not a trust boundary we want.
 *
 * ---------------------------------------------------------------------------
 * Rules for the lock
 * ---------------------------------------------------------------------------
 * See `acquireLock`. The short version: a pid is not an identity, and
 * `rm` followed by `create` is not a takeover.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class RenewerStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RenewerStateError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new RenewerStateError(code, message); };

export const STATE_SCHEMA_VERSION = 1;
const FILE_MODE = 0o600;
/** Generous for six small fields, and far below anything worth parsing blind. */
const MAX_STATE_BYTES = 8 * 1024;

const O = fs.constants;
const READ_FLAGS = O.O_RDONLY | O.O_NOFOLLOW;
const CREATE_FLAGS = O.O_WRONLY | O.O_CREAT | O.O_EXCL | O.O_NOFOLLOW;

/** The complete set of fields the state file may carry, with their exact types. */
const FIELD_TYPES = Object.freeze({
  schemaVersion: (value) => value === STATE_SCHEMA_VERSION,
  consecutiveFailures: (value) => Number.isInteger(value) && value >= 0 && value <= 1_000_000,
  lastSuccessAt: (value) => value === null
    || (typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))),
  lastFailureCode: (value) => value === null
    || (typeof value === 'string' && /^[A-Z_]{4,64}$/.test(value)),
  alerting: (value) => typeof value === 'boolean',
  updatedAt: (value) => value === null
    || (typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))),
});

const FIELDS = Object.freeze(Object.keys(FIELD_TYPES));

export function emptyState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureCode: null,
    alerting: false,
    updatedAt: null,
  };
}

const currentUid = () => (typeof process.getuid === 'function' ? process.getuid() : null);

/**
 * The directory is part of the trust boundary. A group- or other-writable
 * directory lets anybody rename a file of their choosing over the state file,
 * and no mode on the state file itself would prevent it — the mode belongs to
 * their file by then.
 */
function assertSafeDirectory(directory) {
  let stat;
  try {
    stat = fs.statSync(directory);
  } catch (error) {
    return fail('RENEWER_STATE_UNREADABLE',
      `The renewer state directory cannot be inspected (${error.code}).`);
  }
  if (!stat.isDirectory()) {
    fail('RENEWER_STATE_PERMISSIONS', 'The renewer state directory is not a directory.');
  }
  const uid = currentUid();
  if (uid !== null && stat.uid !== uid) {
    fail('RENEWER_STATE_PERMISSIONS',
      'The renewer state directory is owned by another user.');
  }
  if ((stat.mode & 0o022) !== 0) {
    fail('RENEWER_STATE_PERMISSIONS',
      `The renewer state directory is group- or other-writable (mode ${(stat.mode & 0o777).toString(8)}).`);
  }
  return stat;
}

/**
 * Everything that has to be true about the descriptor we just opened. All of it
 * from `fstat`, so none of it can be invalidated by a rename between the check
 * and the read.
 */
function assertSafeFileHandle(fd, { requireMode = true } = {}) {
  const stat = fs.fstatSync(fd);
  if (!stat.isFile()) {
    fail('RENEWER_STATE_CORRUPT', 'The renewer state path is not a regular file.');
  }
  if (stat.nlink !== 1) {
    fail('RENEWER_STATE_SYMLINK',
      `The renewer state file has ${stat.nlink} links; exactly one name may refer to it.`);
  }
  const uid = currentUid();
  if (uid !== null && stat.uid !== uid) {
    fail('RENEWER_STATE_PERMISSIONS', 'The renewer state file is owned by another user.');
  }
  // Mode is checked, not repaired: a widened mode may mean somebody else has
  // been writing here, and quietly narrowing it would erase the evidence.
  if (requireMode && (stat.mode & 0o777) !== FILE_MODE) {
    fail('RENEWER_STATE_PERMISSIONS',
      `The renewer state file must be mode 0600; found ${(stat.mode & 0o777).toString(8)}.`);
  }
  if (stat.size > MAX_STATE_BYTES) {
    fail('RENEWER_STATE_CORRUPT',
      `The renewer state file is ${stat.size} bytes; the maximum is ${MAX_STATE_BYTES}.`);
  }
  return stat;
}

/** O_NOFOLLOW turns a symlinked path into ELOOP instead of a silent redirect. */
function openNoFollow(file, flags, mode) {
  try {
    return fs.openSync(file, flags, mode);
  } catch (error) {
    if (error.code === 'ELOOP') {
      fail('RENEWER_STATE_SYMLINK', 'The renewer state path is a symbolic link; refusing to follow it.');
    }
    throw error;
  }
}

/**
 * fsync on the directory, so the rename is durable and not just the bytes it
 * points at. Best-effort: some filesystems refuse to fsync a directory, and
 * that is not a reason to fail a write that already succeeded.
 */
function syncDirectory(directory) {
  let fd = null;
  try {
    fd = fs.openSync(directory, O.O_RDONLY);
    fs.fsyncSync(fd);
  } catch {
    // EINVAL/EACCES/EISDIR on exotic filesystems. Ignored deliberately.
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already gone */ } }
  }
}

/**
 * Strict shape validation. Anything unexpected is corruption rather than
 * something to coerce: a state file is written by exactly one program, so a
 * field it did not write means the file is not the file we think it is.
 */
function parseState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('RENEWER_STATE_CORRUPT', 'The renewer state file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('RENEWER_STATE_CORRUPT', 'The renewer state file is not a JSON object.');
  }
  if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) {
    fail('RENEWER_STATE_CORRUPT', 'The renewer state file declares an unsupported schema version.');
  }
  for (const key of Object.keys(parsed)) {
    if (!FIELDS.includes(key)) {
      fail('RENEWER_STATE_CORRUPT', `The renewer state file carries an unexpected field ${key}.`);
    }
  }
  for (const key of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      fail('RENEWER_STATE_CORRUPT', `The renewer state file is missing ${key}.`);
    }
    if (!FIELD_TYPES[key](parsed[key])) {
      fail('RENEWER_STATE_CORRUPT', `The renewer state file has an invalid ${key}.`);
    }
  }
  return parsed;
}

/**
 * Reads the state, or returns an empty one when the file has never existed.
 *
 * "Never existed" is the only absence that is not an error. A file that exists
 * but cannot be read, whose mode is wider than 0600, that is a symlink, that
 * has more than one name, or that belongs to somebody else stops the run.
 */
export function readState(file) {
  let fd;
  try {
    fd = openNoFollow(file, READ_FLAGS);
  } catch (error) {
    if (error instanceof RenewerStateError) throw error;
    if (error.code === 'ENOENT') return { state: emptyState(), existed: false };
    return fail('RENEWER_STATE_UNREADABLE',
      `The renewer state file cannot be opened (${error.code}).`);
  }
  try {
    assertSafeDirectory(path.dirname(file));
    const stat = assertSafeFileHandle(fd);
    const buffer = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) {
      const chunk = fs.readSync(fd, buffer, read, stat.size - read, read);
      if (chunk === 0) break;
      read += chunk;
    }
    return { state: parseState(buffer.subarray(0, read).toString('utf8')), existed: true };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Atomic, 0600, fsynced, type-checked. The temp file is a sibling so the rename
 * cannot cross devices, and its name is random so two writers — or a hostile
 * one predicting `${pid}.tmp` — cannot collide on it.
 */
export function writeState(file, state) {
  const payload = { ...emptyState(), ...state, schemaVersion: STATE_SCHEMA_VERSION };
  for (const key of Object.keys(payload)) {
    if (!FIELDS.includes(key)) {
      fail('RENEWER_STATE_INVALID', `Refusing to persist unexpected state field ${key}.`);
    }
  }
  // Types are validated BEFORE anything is written, so a bad value can never
  // reach the disk and become a corrupt file the next run has to refuse.
  for (const key of FIELDS) {
    if (!FIELD_TYPES[key](payload[key])) {
      fail('RENEWER_STATE_INVALID', `Refusing to persist an invalid ${key}.`);
    }
  }

  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertSafeDirectory(directory);

  const temp = path.join(directory,
    `.${path.basename(file)}.${crypto.randomBytes(12).toString('hex')}.tmp`);
  let handle = null;
  try {
    handle = openNoFollow(temp, CREATE_FLAGS, FILE_MODE);
    fs.writeFileSync(handle, `${JSON.stringify(payload)}\n`);
    // openSync's mode argument is masked by the process umask; set it outright,
    // on the descriptor rather than the path.
    fs.fchmodSync(handle, FILE_MODE);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(temp, file);
  } catch (error) {
    if (handle !== null) { try { fs.closeSync(handle); } catch { /* already closed */ } }
    // The temp file is removed on EVERY error path, so a failed write cannot
    // leave a litter of half-written 0600 files next to the real one.
    try { fs.rmSync(temp, { force: true }); } catch { /* nothing else to do */ }
    if (error instanceof RenewerStateError) throw error;
    return fail('RENEWER_STATE_WRITE_FAILED',
      `The renewer state file could not be written (${error.code || 'unknown'}).`);
  }
  // The rename is only durable once the directory entry is.
  syncDirectory(directory);

  // Confirm what actually landed rather than what was requested: umask, an
  // exotic filesystem or a hostile rename would all show up here.
  const verify = openNoFollow(file, READ_FLAGS);
  try {
    assertSafeFileHandle(verify);
  } finally {
    fs.closeSync(verify);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------

/**
 * Who this process is, for lock purposes.
 *
 * A pid alone is not an identity. Pids are reused, and after a reboot they are
 * reused from the beginning, so a lock left behind by pid 4242 looks exactly
 * like a lock held by the brand-new pid 4242 that now belongs to somebody
 * else's database. Three more fields make the record decidable:
 *
 *   host                 a lock on a shared filesystem may only be reasoned
 *                        about by the machine that took it; nobody else can ask
 *                        whether the pid is alive.
 *   bootEpochSeconds     when this machine booted. A different boot means the
 *                        pid in the record cannot possibly be the same process,
 *                        whatever the process table says now.
 *   startedAtEpochMs     when this process started, which distinguishes a
 *                        reused pid within one boot.
 *   nonce                a random value, so `release()` can prove the lock it
 *                        is about to delete is still the one it took.
 */
export function processIdentity({ pid = process.pid, now = Date.now() } = {}) {
  return {
    v: 1,
    pid,
    host: os.hostname(),
    // os.uptime() has second resolution, so this drifts by a second or two
    // between calls. Comparisons below use a tolerance rather than equality.
    bootEpochSeconds: Math.round(now / 1000 - os.uptime()),
    startedAtEpochMs: Math.round(performance.timeOrigin),
    nonce: crypto.randomUUID(),
  };
}

/** Two boot stamps are the same boot when they agree to within a couple of minutes. */
const BOOT_TOLERANCE_SECONDS = 120;

function readLockHolder(file) {
  let fd;
  try {
    fd = openNoFollow(file, READ_FLAGS);
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_STATE_BYTES) return null;
    const buffer = Buffer.alloc(stat.size);
    fs.readSync(fd, buffer, 0, stat.size, 0);
    const parsed = JSON.parse(buffer.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to somebody else. Still alive — and a
    // SIGSTOPped process answers exactly the same way, which is correct: a
    // paused renewer is not a dead one and must never be displaced.
    return error.code === 'EPERM';
  }
}

/**
 * Whether a lock may be taken over. Every branch that cannot be decided
 * returns false, because refusing to run is always safe and running twice
 * never is.
 */
export function isLockStale(holder, { now, staleAfterMs, identity }) {
  if (!holder || typeof holder !== 'object') return false;
  // A record from another machine cannot be reasoned about at all: this host
  // has no way to ask whether that pid is alive.
  if (typeof holder.host === 'string' && holder.host !== identity.host) return false;

  const holderBoot = holder.bootEpochSeconds;
  if (Number.isFinite(holderBoot)
    && Math.abs(holderBoot - identity.bootEpochSeconds) > BOOT_TOLERANCE_SECONDS) {
    // A different boot. The pid cannot be the same process, so age does not
    // matter and neither does the process table.
    return true;
  }
  // A live pid is never displaced, however old the lock is.
  if (isProcessAlive(holder.pid)) return false;

  const stampedAt = Date.parse(holder.at);
  if (!Number.isFinite(stampedAt)) return false;
  const age = now - stampedAt;
  // A lock stamped in the future means the clock moved backwards. Treating that
  // as "very old" would make a wall-clock correction a licence to steal a live
  // lock, so it is treated as "cannot tell" instead.
  if (age < 0) return false;
  return age >= staleAfterMs;
}

/**
 * Deterministic, synchronous pause. Used only for the takeover settle window,
 * which happens at most once per process and only when a stale lock was found.
 *
 * `Atomics.wait` on a throwaway buffer is the one way to block a Node main
 * thread for a known duration without burning CPU and without making
 * `acquireLock` async — and it has to stay synchronous, because the whole point
 * is that no other work may be interleaved between claiming the lock and
 * proving it is ours. Both globals are standard and long-present in Node; the
 * shared ESLint env is a browser-oriented one that simply does not list them.
 */
const sleepSync = (ms) => {
  if (!(ms > 0)) return;
  // eslint-disable-next-line no-undef
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * An exclusive lock, so two renewers cannot both believe they own the counter.
 *
 * ---------------------------------------------------------------------------
 * Why the takeover is shaped like this
 * ---------------------------------------------------------------------------
 * The previous version removed a stale lock and then created a fresh one. Two
 * processes that both saw the same stale lock could interleave as:
 *
 *      A: rm  →  A: create (A owns it)  →  B: rm (deletes A's LIVE lock)  →
 *      B: create (B owns it)
 *
 * and both would proceed, each certain it was the only writer. The window is
 * small and the consequence — two processes interleaving one failure counter,
 * so the alert threshold is reached late or not at all — is exactly what the
 * lock exists to prevent.
 *
 * There is no portable "delete this file only if it still contains X", so the
 * takeover is instead:
 *
 *   1. write a temp file carrying OUR identity,
 *   2. `rename()` it over the lock — atomic, and never a moment where the lock
 *      does not exist for somebody else to slip into,
 *   3. wait a settle window, then read the lock back and check the nonce.
 *
 * Because `rename` is atomic, exactly one competitor's bytes survive. The
 * settle window is what makes step 3 meaningful: it is longer than the window
 * in which a competitor that observed the same stale lock could still be
 * renaming, so by the time anyone verifies, the file has stopped changing.
 * Whoever renamed last owns it; everybody else reads a nonce that is not theirs
 * and refuses to run. One winner, deterministically.
 *
 * A fresh lock is claimed with O_EXCL instead, which needs none of this.
 */
export function acquireLock(file, {
  staleAfterMs = 15 * 60 * 1000,
  now = Date.now(),
  pid = process.pid,
  identity = processIdentity({ pid, now }),
  settleMs = 150,
} = {}) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertSafeDirectory(directory);

  const record = () => `${JSON.stringify({ ...identity, at: new Date(now).toISOString() })}\n`;

  const writeTemp = () => {
    const temp = path.join(directory,
      `.${path.basename(file)}.${crypto.randomBytes(12).toString('hex')}.tmp`);
    let handle = null;
    try {
      handle = openNoFollow(temp, CREATE_FLAGS, FILE_MODE);
      fs.writeFileSync(handle, record());
      fs.fchmodSync(handle, FILE_MODE);
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      handle = null;
      return temp;
    } catch (error) {
      if (handle !== null) { try { fs.closeSync(handle); } catch { /* already closed */ } }
      try { fs.rmSync(temp, { force: true }); } catch { /* nothing else to do */ }
      throw error;
    }
  };

  const claimExclusive = () => {
    let handle = null;
    try {
      handle = openNoFollow(file, CREATE_FLAGS, FILE_MODE);
      fs.writeFileSync(handle, record());
      fs.fchmodSync(handle, FILE_MODE);
      fs.fsyncSync(handle);
    } finally {
      if (handle !== null) fs.closeSync(handle);
    }
    syncDirectory(directory);
  };

  try {
    claimExclusive();
  } catch (error) {
    if (error instanceof RenewerStateError) throw error;
    if (error.code !== 'EEXIST') {
      return fail('RENEWER_LOCK_UNAVAILABLE', `The renewer lock cannot be created (${error.code}).`);
    }
    const holder = readLockHolder(file);
    if (!isLockStale(holder, { now, staleAfterMs, identity })) {
      fail('RENEWER_LOCK_HELD',
        'Another renewer instance holds the lock; refusing to run a second one.');
    }
    // Atomic replace. Never rm-then-create.
    let temp;
    try {
      temp = writeTemp();
      fs.renameSync(temp, file);
      syncDirectory(directory);
    } catch (renameError) {
      if (temp) { try { fs.rmSync(temp, { force: true }); } catch { /* gone */ } }
      return fail('RENEWER_LOCK_UNAVAILABLE',
        `The renewer lock could not be taken over (${renameError.code || 'unknown'}).`);
    }
    // Settle, then prove it is ours. See the block comment above.
    sleepSync(settleMs);
    const after = readLockHolder(file);
    if (!after || after.nonce !== identity.nonce) {
      fail('RENEWER_LOCK_HELD',
        'Another instance won the takeover of the stale renewer lock; refusing to run a second one.');
    }
  }

  let released = false;
  return {
    file,
    identity,
    release() {
      if (released) return;
      released = true;
      // Only ever delete a lock that is still ours. A lock that has been taken
      // over — because this process was paused past the stale window — belongs
      // to somebody else now, and deleting it would hand a third process a free
      // claim while the second one is still running.
      const holder = readLockHolder(file);
      if (holder && holder.nonce === identity.nonce) {
        try { fs.rmSync(file, { force: true }); } catch { /* nothing else to do */ }
      }
    },
  };
}

/** Conventional sibling paths, so the runbook only has to name one file. */
export const lockPathFor = (statePath) => `${statePath}.lock`;
