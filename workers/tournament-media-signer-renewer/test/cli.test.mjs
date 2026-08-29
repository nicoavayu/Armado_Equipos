/**
 * The entrypoint's refusals.
 *
 * Every case here returns before any network call is attempted, which is the
 * point: a renewer that cannot trust its own state, or that is not the only
 * instance, must stop at start-up rather than half-run.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertSupportedRuntime, main } from '../src/cli.mjs';
import { acquireLock, emptyState, lockPathFor, writeState } from '../src/state-store.mjs';

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    iss: 'supabase', ref: 'hhyvmhgpapyuzjgxfnqv', role: 'anon',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  'fixture-signature',
].join('.');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'renewer-cli-'));

/** Runs main() with a scoped environment and captures what it wrote to stderr. */
const run = async (argv, env) => {
  const saved = { ...process.env };
  const errors = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { errors.push(String(chunk)); return true; };
  try {
    Object.assign(process.env, env);
    const code = await main(argv);
    return { code, errors: errors.map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } }) };
  } finally {
    process.stderr.write = originalWrite;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
};

const baseEnv = (statePath) => ({
  SUPABASE_URL: 'https://hhyvmhgpapyuzjgxfnqv.supabase.co',
  TOURNAMENT_MEDIA_EXPECTED_API_HOST: 'hhyvmhgpapyuzjgxfnqv.supabase.co',
  TOURNAMENT_MEDIA_ATTESTATION_SECRET: 'x'.repeat(48),
  SUPABASE_ANON_KEY: jwt,
  ...(statePath ? { TOURNAMENT_MEDIA_RENEW_STATE_FILE: statePath } : {}),
});

test('a corrupt state file stops the run before anything is attempted', async () => {
  const file = path.join(tempDir(), 'state.json');
  fs.writeFileSync(file, '{"schemaVersion":1,"consecutive', { mode: 0o600 });
  const { code, errors } = await run(['--once'], baseEnv(file));
  assert.equal(code, 1);
  assert.equal(errors[0].event, 'startup_refused');
  assert.equal(errors[0].code, 'RENEWER_STATE_CORRUPT');
  // Fail-closed: the corrupt file is left exactly as found, not reset.
  assert.equal(fs.readFileSync(file, 'utf8'), '{"schemaVersion":1,"consecutive');
  // And no lock is left behind by the refusal.
  assert.equal(fs.existsSync(lockPathFor(file)), false);
});

test('a second instance is refused while the first holds the lock', async () => {
  const file = path.join(tempDir(), 'state.json');
  writeState(file, emptyState());
  const held = acquireLock(lockPathFor(file));
  try {
    const { code, errors } = await run(['--once'], baseEnv(file));
    assert.equal(code, 1);
    assert.equal(errors[0].code, 'RENEWER_LOCK_HELD');
  } finally {
    held.release();
  }
});

test('a state file with a wider mode is refused', async () => {
  const file = path.join(tempDir(), 'state.json');
  writeState(file, emptyState());
  fs.chmodSync(file, 0o666);
  const { code, errors } = await run(['--once'], baseEnv(file));
  assert.equal(code, 1);
  assert.equal(errors[0].code, 'RENEWER_STATE_PERMISSIONS');
});

test('a misconfigured gateway credential is a start-up refusal that names no value', async () => {
  const { code, errors } = await run(['--once'], {
    ...baseEnv(null), SUPABASE_ANON_KEY: 'sb_publishable_not_a_jwt_value_here',
  });
  assert.equal(code, 1);
  assert.equal(errors[0].event, 'startup_refused');
  assert.equal(errors[0].code, 'RENEWER_GATEWAY_JWT_REQUIRED');
  assert.doesNotMatch(errors[0].message, /sb_publishable_not_a_jwt_value_here/);
});

test('a relative state path is refused, so the file cannot follow the working directory', async () => {
  const { code, errors } = await run(['--once'], {
    ...baseEnv(null), TOURNAMENT_MEDIA_RENEW_STATE_FILE: 'state.json',
  });
  assert.equal(code, 1);
  assert.equal(errors[0].code, 'RENEWER_STATE_PATH_INVALID');
});

test('an unsupported Node runtime is refused at start-up, naming what is missing', async () => {
  // The engines field is advisory — npm warns and installs anyway, and nothing
  // reads it when the container just runs `node src/cli.mjs`. Without this
  // check, a runtime without AbortSignal.any would start fine and fail at the
  // first shutdown, which is the worst moment to find out.
  assert.deepEqual(assertSupportedRuntime(), { ok: true, missing: [] });
  assert.deepEqual(
    assertSupportedRuntime([['AbortSignal.any', () => false], ['fetch', () => true]]),
    { ok: false, missing: ['AbortSignal.any'] },
  );
});

test('the declared engines range covers the runtime the suites actually run on', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const range = pkg.engines.node;
  assert.match(range, /^>=20\.6\.0 <27$/, 'the supported range must be stated, not implied');
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 20 || (major === 20 && minor >= 6),
    `the suites are running on Node ${process.versions.node}, below the declared minimum`);
  assert.ok(major < 27, `Node ${process.versions.node} is outside the declared range`);
  // The lockfile records the same range, so `npm ci` cannot disagree with it.
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages[''].engines.node, range);
});
