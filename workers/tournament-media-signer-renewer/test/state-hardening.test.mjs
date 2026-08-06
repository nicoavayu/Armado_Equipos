/**
 * The state file as a trust boundary.
 *
 * Everything here is a real filesystem operation on a real temporary directory:
 * real symlinks, real hard links, real modes. None of it is mocked, because
 * every bug this file guards against is a bug in how the code talks to the
 * kernel, and a mocked `fs` would agree with whatever the code believed.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RenewerStateError, emptyState, readState, writeState,
} from '../src/state-store.mjs';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'renewer-harden-'));

const expectCode = (code, run) => assert.throws(run, (error) => {
  assert.ok(error instanceof RenewerStateError, `expected RenewerStateError, got ${error}`);
  assert.equal(error.code, code);
  return true;
});

// --- symlinks and extra names ----------------------------------------------

test('a symlinked state path is refused rather than followed', () => {
  const dir = tempDir();
  const real = path.join(dir, 'elsewhere.json');
  const link = path.join(dir, 'state.json');
  writeState(real, emptyState());
  fs.symlinkSync(real, link);
  // Without O_NOFOLLOW this would read `real` and report success, which is how
  // a state file gets quietly relocated to somewhere the attacker can write.
  expectCode('RENEWER_STATE_SYMLINK', () => readState(link));
});

test('a state file with a second hard link is refused', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  writeState(file, emptyState());
  fs.linkSync(file, path.join(dir, 'shadow.json'));
  // Mode 0600 on a file somebody else also has a name for protects nothing.
  expectCode('RENEWER_STATE_SYMLINK', () => readState(file));
});

test('a dangling symlink is a refusal, not an absent file', () => {
  const dir = tempDir();
  const link = path.join(dir, 'state.json');
  fs.symlinkSync(path.join(dir, 'does-not-exist.json'), link);
  // The tempting bug: ENOENT from following the link looks exactly like "the
  // file has never existed", which would start with a fresh counter.
  expectCode('RENEWER_STATE_SYMLINK', () => readState(link));
});

// --- the directory ----------------------------------------------------------

test('a group- or other-writable directory is refused', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  writeState(file, emptyState());
  for (const mode of [0o707, 0o770]) {
    fs.chmodSync(dir, mode);
    expectCode('RENEWER_STATE_PERMISSIONS', () => readState(file));
    expectCode('RENEWER_STATE_PERMISSIONS', () => writeState(file, emptyState()));
  }
  fs.chmodSync(dir, 0o700);
  assert.equal(readState(file).existed, true, 'a private directory is fine again');
});

// --- size -------------------------------------------------------------------

test('an oversized state file is refused before it is parsed', () => {
  const file = path.join(tempDir(), 'state.json');
  fs.writeFileSync(file, `{"schemaVersion":1,"pad":"${'x'.repeat(16 * 1024)}"}`, { mode: 0o600 });
  expectCode('RENEWER_STATE_CORRUPT', () => readState(file));
});

// --- types on the way in ----------------------------------------------------

test('writeState validates every field type before anything reaches the disk', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  const invalid = [
    { consecutiveFailures: -1 },
    { consecutiveFailures: 1.5 },
    { consecutiveFailures: '3' },
    { consecutiveFailures: null },
    { alerting: 'yes' },
    { alerting: null },
    { lastFailureCode: 'lower_case' },
    { lastFailureCode: 42 },
    { lastSuccessAt: 'not-a-date' },
    { lastSuccessAt: 1234567890 },
    { updatedAt: {} },
  ];
  for (const patch of invalid) {
    expectCode('RENEWER_STATE_INVALID', () => writeState(file, { ...emptyState(), ...patch }));
  }
  // Nothing was created by any of those refusals.
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('an unexpected field is refused rather than dropped', () => {
  const file = path.join(tempDir(), 'state.json');
  expectCode('RENEWER_STATE_INVALID',
    () => writeState(file, { ...emptyState(), attestationSecret: 'x'.repeat(48) }));
  assert.equal(fs.existsSync(file), false);
});

test('a state file missing a field is corruption, not a partial state', () => {
  const file = path.join(tempDir(), 'state.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, consecutiveFailures: 2 }), { mode: 0o600 });
  expectCode('RENEWER_STATE_CORRUPT', () => readState(file));
});

// --- atomicity and cleanup --------------------------------------------------

test('a failed write leaves no temporary file behind', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  // A directory where the state file should be: the rename cannot succeed.
  fs.mkdirSync(file);
  expectCode('RENEWER_STATE_WRITE_FAILED', () => writeState(file, emptyState()));
  const litter = fs.readdirSync(dir).filter((entry) => entry.endsWith('.tmp'));
  assert.deepEqual(litter, [], 'the temp file must be removed on the error path');
});

test('the temp file name is unpredictable, so it cannot be pre-created or guessed', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  const seen = new Set();
  const realRename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { seen.add(path.basename(from)); return realRename(from, to); };
    for (let i = 0; i < 8; i += 1) writeState(file, emptyState());
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(seen.size, 8, 'every write must use a fresh random temp name');
  for (const name of seen) {
    assert.match(name, /^\.state\.json\.[0-9a-f]{24}\.tmp$/);
    assert.ok(!name.includes(String(process.pid)), 'the pid is predictable and must not be the name');
  }
});

test('the mode is confirmed after the rename, whatever the umask was', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  const previous = process.umask(0o000);
  try {
    writeState(file, emptyState());
  } finally {
    process.umask(previous);
  }
  assert.equal(fs.lstatSync(file).mode & 0o777, 0o600);
  assert.equal(readState(file).existed, true);
});

test('a state file whose mode was widened after the write is refused on read', () => {
  const file = path.join(tempDir(), 'state.json');
  writeState(file, emptyState());
  fs.chmodSync(file, 0o644);
  expectCode('RENEWER_STATE_PERMISSIONS', () => readState(file));
});

// --- what may never be in there ---------------------------------------------

test('the persisted bytes carry nothing but the six declared fields', () => {
  const file = path.join(tempDir(), 'state.json');
  writeState(file, {
    consecutiveFailures: 3,
    lastSuccessAt: '2099-01-01T00:00:00.000Z',
    lastFailureCode: 'SIGNER_TIMEOUT',
    alerting: true,
    updatedAt: '2099-01-01T00:00:01.000Z',
  });
  const raw = fs.readFileSync(file, 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
    'alerting', 'consecutiveFailures', 'lastFailureCode', 'lastSuccessAt',
    'schemaVersion', 'updatedAt',
  ]);
  for (const forbidden of ['secret', 'apikey', 'authorization', 'bearer', 'http', 'token']) {
    assert.ok(!raw.toLowerCase().includes(forbidden), `the state file must not mention ${forbidden}`);
  }
});
