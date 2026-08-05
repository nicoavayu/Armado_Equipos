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
 * Rules
 * ---------------------------------------------------------------------------
 *   - 0600, created and verified. A wider mode is a refusal, not a warning:
 *     the file records operational posture and belongs to one process.
 *   - Atomic writes. Write a sibling temp file, fsync it, rename it over the
 *     target. A crash mid-write leaves the previous state, never half of one.
 *   - No secrets, no response bodies, no URLs. Only a counter, a timestamp, a
 *     failure code and a flag — all of it already present in the log stream.
 *   - Corruption fails CLOSED. Unreadable, unparseable or wrong-shaped state is
 *     an error that stops the run. A renewer that silently resets its counter
 *     on a corrupt file is a renewer whose alert can be suppressed by
 *     corrupting a file, and the state file is not a trust boundary we want.
 *   - One writer. An exclusive lock, created with O_EXCL, refuses the second
 *     process rather than interleaving two counters over one file.
 */

import fs from 'node:fs';
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

/** The complete set of fields the state file may carry. Anything else is corruption. */
const FIELDS = Object.freeze([
  'schemaVersion', 'consecutiveFailures', 'lastSuccessAt', 'lastFailureCode', 'alerting', 'updatedAt',
]);

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
  if (!Number.isInteger(parsed.consecutiveFailures) || parsed.consecutiveFailures < 0) {
    fail('RENEWER_STATE_CORRUPT', 'The renewer state file has an invalid failure counter.');
  }
  if (typeof parsed.alerting !== 'boolean') {
    fail('RENEWER_STATE_CORRUPT', 'The renewer state file has an invalid alerting flag.');
  }
  for (const key of ['lastSuccessAt', 'updatedAt']) {
    const value = parsed[key];
    if (value !== null && !(typeof value === 'string' && Number.isFinite(Date.parse(value)))) {
      fail('RENEWER_STATE_CORRUPT', `The renewer state file has an invalid ${key}.`);
    }
  }
  if (parsed.lastFailureCode !== null
    && !(typeof parsed.lastFailureCode === 'string' && /^[A-Z_]{4,64}$/.test(parsed.lastFailureCode))) {
    fail('RENEWER_STATE_CORRUPT', 'The renewer state file has an invalid failure code.');
  }
  return parsed;
}

/**
 * Reads the state, or returns an empty one when the file has never existed.
 *
 * "Never existed" is the only absence that is not an error. A file that exists
 * but cannot be read, or whose mode is wider than 0600, stops the run.
 */
export function readState(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { state: emptyState(), existed: false };
    fail('RENEWER_STATE_UNREADABLE', `The renewer state file cannot be inspected (${error.code}).`);
  }
  if (!stat.isFile()) {
    fail('RENEWER_STATE_CORRUPT', 'The renewer state path is not a regular file.');
  }
  // Mode is checked, not repaired: a widened mode may mean somebody else has
  // been writing here, and quietly narrowing it would erase the evidence.
  if ((stat.mode & 0o777) !== FILE_MODE) {
    fail('RENEWER_STATE_PERMISSIONS',
      `The renewer state file must be mode 0600; found ${(stat.mode & 0o777).toString(8)}.`);
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail('RENEWER_STATE_UNREADABLE', `The renewer state file cannot be read (${error.code}).`);
  }
  return { state: parseState(text), existed: true };
}

/** Atomic, 0600, fsynced. The temp file is a sibling so the rename cannot cross devices. */
export function writeState(file, state) {
  const payload = { ...emptyState(), ...state, schemaVersion: STATE_SCHEMA_VERSION };
  for (const key of Object.keys(payload)) {
    if (!FIELDS.includes(key)) {
      fail('RENEWER_STATE_INVALID', `Refusing to persist unexpected state field ${key}.`);
    }
  }
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`);
  const handle = fs.openSync(temp, 'wx', FILE_MODE);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(payload)}\n`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  // openSync's mode argument is masked by the process umask; set it outright.
  fs.chmodSync(temp, FILE_MODE);
  fs.renameSync(temp, file);
  return payload;
}

/**
 * An exclusive lock, so two renewers cannot both believe they own the counter.
 *
 * A crashed process would otherwise leave its lock behind forever, so a lock
 * whose recorded pid is gone AND which is older than `staleAfterMs` is taken
 * over. Both conditions, never one: a live pid is never displaced, and neither
 * is a fresh lock whose owner might simply be slow to appear in the process
 * table.
 */
export function acquireLock(file, { staleAfterMs = 15 * 60 * 1000, now = Date.now(), pid = process.pid } = {}) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const claim = () => {
    const handle = fs.openSync(file, 'wx', FILE_MODE);
    try {
      fs.writeFileSync(handle, `${JSON.stringify({ pid, at: new Date(now).toISOString() })}\n`);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.chmodSync(file, FILE_MODE);
  };
  try {
    claim();
  } catch (error) {
    if (error.code !== 'EEXIST') {
      fail('RENEWER_LOCK_UNAVAILABLE', `The renewer lock cannot be created (${error.code}).`);
    }
    const holder = readLockHolder(file);
    const age = holder?.at ? now - Date.parse(holder.at) : Number.POSITIVE_INFINITY;
    const alive = holder?.pid ? isProcessAlive(holder.pid) : true;
    if (alive || !(age >= staleAfterMs)) {
      fail('RENEWER_LOCK_HELD',
        'Another renewer instance holds the lock; refusing to run a second one.');
    }
    // Stale: the owner is gone and the lock is old. Take it over in place.
    fs.rmSync(file, { force: true });
    try {
      claim();
    } catch {
      fail('RENEWER_LOCK_HELD', 'The renewer lock was taken by another instance during recovery.');
    }
  }
  let released = false;
  return {
    file,
    release() {
      if (released) return;
      released = true;
      fs.rmSync(file, { force: true });
    },
  };
}

function readLockHolder(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to somebody else. Still alive.
    return error.code === 'EPERM';
  }
}

/** Conventional sibling paths, so the runbook only has to name one file. */
export const lockPathFor = (statePath) => `${statePath}.lock`;
