import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTHORIZED_STAGING_REF,
  FORBIDDEN_PRODUCTION_REF,
  InspectorError,
  buildDryRun,
  buildSnapshot,
} from './inspect-remote-readonly-lib.mjs';
import {
  A1_CHECKSUM,
  A1_CONFIRMATION,
  A1_FILE,
  A1_VERSION,
  LOOPBACK_TEST_HOSTS,
  MAX_CONNECT_TIMEOUT_SECONDS,
  PRODUCTION_GUARD_CONFIRMATION,
  PSQL_CONNECTION_PARAM_ALLOWLIST,
  REMOTE_CHANNEL_BINDINGS,
  REMOTE_SSLMODES,
  SingleMigrationError,
  approvalTokenForPlan,
  buildLocalTestConnection,
  buildOperationalConnection,
  buildPsqlConnectionEnv,
  isValidatedConnection,
  prepareExecution,
  runPsql,
  sanitizePsqlError,
} from './single-migration-executor-lib.mjs';
import { canonicalJson, sha256 } from './readiness-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'ops', 'torneos-staging', 'fixtures', 'remote-readonly-equivalent.json');
const DIRECT_HOST = `db.${AUTHORIZED_STAGING_REF}.supabase.co`;
const POOLER_HOST = 'aws-0-us-east-1.pooler.supabase.com';
const PASSWORD = 'p@ss w/ord:with#specials';
const DIRECT_URL = `postgresql://postgres:${encodeURIComponent(PASSWORD)}@${DIRECT_HOST}:5432/postgres`;
const UNKNOWN_HOST_URL = 'postgresql://postgres:secret@db.unknown-project.supabase.co:5432/postgres';
const PRODUCTION_URL = `postgresql://postgres:secret@db.${FORBIDDEN_PRODUCTION_REF}.supabase.co:5432/postgres`;

const isExecutorError = (error) => (
  error instanceof SingleMigrationError || error instanceof InspectorError
);
const expectCode = (code, run) => assert.throws(run, (error) => (
  isExecutorError(error) && error.code === code
), `expected ${code}`);
const rejectsWithCode = (code, promise) => assert.rejects(promise, (error) => (
  isExecutorError(error) && error.code === code
), `expected ${code}`);

const operational = (databaseUrl = DIRECT_URL, targetMode = 'apply') => buildOperationalConnection({
  projectRef: AUTHORIZED_STAGING_REF, databaseUrl, targetMode, inheritedEnv: {},
});

// Records what the executor would hand to psql without ever launching a process.
const makeSpawnRecorder = ({ exitCode = 0, stderr = '', stdout = '' } = {}) => {
  const calls = [];
  const spawnFn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const stdinChunks = [];
    child.stdin.on('data', (chunk) => stdinChunks.push(chunk));
    child.stdin.on('finish', () => {
      calls[calls.length - 1].stdin = Buffer.concat(stdinChunks).toString('utf8');
      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', exitCode));
    });
    return child;
  };
  return { calls, spawnFn };
};

// Builds the exact artifacts the operational modes require, so apply and verify can be driven
// end to end without ever reaching a network.
const makeContractFiles = () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const snapshot = buildSnapshot({
    repoRoot: ROOT,
    repositorySha: head,
    projectRef: AUTHORIZED_STAGING_REF,
    timestamp: new Date().toISOString(),
    database: fixture.database,
    metadata: fixture.metadata,
  });
  const plan = buildDryRun({ repoRoot: ROOT, snapshot, repositorySha: head });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-a1-psql-contract-'));
  const snapshotFile = path.join(directory, 'snapshot.json');
  const planFile = path.join(directory, 'plan.json');
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  fs.writeFileSync(planFile, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const options = {
    _: [],
    'project-ref': AUTHORIZED_STAGING_REF,
    'production-guard': PRODUCTION_GUARD_CONFIRMATION,
    'expected-repository-sha': head,
    snapshot: snapshotFile,
    plan: planFile,
    'snapshot-sha': sha256(canonicalJson(snapshot)),
    'plan-id': plan.planId,
    migration: A1_FILE,
    'migration-version': A1_VERSION,
    'migration-checksum': A1_CHECKSUM,
    confirmation: A1_CONFIRMATION,
    'approval-token': approvalTokenForPlan(plan),
  };
  return { directory, head, snapshot, plan, options };
};

const withContractFiles = async (run) => {
  const input = makeContractFiles();
  try { await run(input); } finally { fs.rmSync(input.directory, { recursive: true, force: true }); }
};

test('the connection URL is never handed to psql as PGDATABASE', () => {
  const { env } = buildPsqlConnectionEnv(DIRECT_URL, {});
  assert.equal(env.PGDATABASE, 'postgres');
  for (const value of Object.values(env)) {
    assert.doesNotMatch(String(value), /^postgres(ql)?:\/\//);
    assert.ok(!String(value).includes(DIRECT_HOST) || value === DIRECT_HOST);
  }
});

test('host, port, user, database and credential are projected onto discrete libpq variables', () => {
  const { env } = buildPsqlConnectionEnv(
    `postgresql://postgres:secret@${DIRECT_HOST}:6544/arma2_db`, {},
  );
  assert.equal(env.PGHOST, DIRECT_HOST);
  assert.equal(env.PGPORT, '6544');
  assert.equal(env.PGUSER, 'postgres');
  assert.equal(env.PGPASSWORD, 'secret');
  assert.equal(env.PGDATABASE, 'arma2_db');
});

test('a missing port falls back to the PostgreSQL default', () => {
  const { env } = buildPsqlConnectionEnv(`postgresql://postgres:secret@${DIRECT_HOST}/postgres`, {});
  assert.equal(env.PGPORT, '5432');
});

test('percent-encoded credentials and database names are decoded exactly once', () => {
  const { env } = buildPsqlConnectionEnv(DIRECT_URL, {});
  assert.equal(env.PGPASSWORD, PASSWORD);
  assert.notEqual(env.PGPASSWORD, encodeURIComponent(PASSWORD));
  const encodedDb = buildPsqlConnectionEnv(
    `postgresql://postgres:secret@${DIRECT_HOST}:5432/${encodeURIComponent('my db')}`, {},
  );
  assert.equal(encodedDb.env.PGDATABASE, 'my db');
  const encodedUser = buildPsqlConnectionEnv(
    `postgresql://${encodeURIComponent('user.with@sign')}:secret@${DIRECT_HOST}:5432/postgres`, {},
  );
  assert.equal(encodedUser.env.PGUSER, 'user.with@sign');
});

test('the pooler username carrying the project ref is preserved verbatim', () => {
  const { env } = buildPsqlConnectionEnv(
    `postgresql://postgres.${AUTHORIZED_STAGING_REF}:secret@${POOLER_HOST}:6543/postgres`, {},
  );
  assert.equal(env.PGUSER, `postgres.${AUTHORIZED_STAGING_REF}`);
  assert.equal(env.PGHOST, POOLER_HOST);
  assert.equal(env.PGPORT, '6543');
});

test('allowlisted connection parameters are projected onto their libpq variables', () => {
  const { env } = buildPsqlConnectionEnv(
    `${DIRECT_URL}?sslmode=verify-full&connect_timeout=5`
    + '&target_session_attrs=read-write&channel_binding=require', {},
  );
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.equal(env.PGCONNECT_TIMEOUT, '5');
  assert.equal(env.PGTARGETSESSIONATTRS, 'read-write');
  assert.equal(env.PGCHANNELBINDING, 'require');
  assert.deepEqual(
    Object.keys(PSQL_CONNECTION_PARAM_ALLOWLIST).sort(),
    ['channel_binding', 'connect_timeout', 'sslmode', 'target_session_attrs'],
  );
});

// --- TLS contract -----------------------------------------------------------------------------

test('regression 1-3: sslmode=disable, allow and prefer are rejected on the remote path', () => {
  for (const downgrade of ['disable', 'allow', 'prefer']) {
    expectCode('DATABASE_URL_PARAMETER',
      () => buildPsqlConnectionEnv(`${DIRECT_URL}?sslmode=${downgrade}`, {}));
    expectCode('DATABASE_URL_PARAMETER', () => operational(`${DIRECT_URL}?sslmode=${downgrade}`));
  }
  assert.deepEqual([...REMOTE_SSLMODES], ['require', 'verify-ca', 'verify-full']);
});

test('regression 4-6: sslmode require, verify-ca and verify-full are accepted', () => {
  for (const accepted of REMOTE_SSLMODES) {
    assert.equal(buildPsqlConnectionEnv(`${DIRECT_URL}?sslmode=${accepted}`, {}).env.PGSSLMODE,
      accepted);
    assert.equal(operational(`${DIRECT_URL}?sslmode=${accepted}`).env.PGSSLMODE, accepted);
  }
});

test('regression 7: a remote URL without sslmode fails closed at require', () => {
  assert.equal(buildPsqlConnectionEnv(DIRECT_URL, {}).env.PGSSLMODE, 'require');
  assert.equal(operational().env.PGSSLMODE, 'require');
  assert.equal(operational(
    `postgresql://postgres.${AUTHORIZED_STAGING_REF}:secret@${POOLER_HOST}:6543/postgres`,
  ).env.PGSSLMODE, 'require');
});

test('channel_binding may not be disabled on the remote path', () => {
  expectCode('DATABASE_URL_PARAMETER',
    () => buildPsqlConnectionEnv(`${DIRECT_URL}?channel_binding=disable`, {}));
  for (const accepted of REMOTE_CHANNEL_BINDINGS) {
    assert.equal(buildPsqlConnectionEnv(`${DIRECT_URL}?channel_binding=${accepted}`, {})
      .env.PGCHANNELBINDING, accepted);
  }
  assert.deepEqual([...REMOTE_CHANNEL_BINDINGS], ['prefer', 'require']);
});

test('regression 8: a TLS-less local connection is refused without the test-only opt-in', () => {
  const local = `postgresql://postgres:secret@127.0.0.1:56999/arma2_local?sslmode=disable`;
  expectCode('DATABASE_URL_PARAMETER', () => buildPsqlConnectionEnv(local, {}));
  expectCode('CONNECTION_TEST_ONLY', () => buildLocalTestConnection({ databaseUrl: local }));
  expectCode('CONNECTION_TEST_ONLY', () => buildLocalTestConnection({
    databaseUrl: local, allowInsecureLocalTestConnection: false,
  }));
  // Truthy is not enough: the opt-in must be the literal boolean.
  expectCode('CONNECTION_TEST_ONLY', () => buildLocalTestConnection({
    databaseUrl: local, allowInsecureLocalTestConnection: 'true',
  }));
});

test('regression 9: a TLS-less loopback connection is accepted only with the explicit opt-in', () => {
  for (const host of LOOPBACK_TEST_HOSTS) {
    const authority = host === '::1' ? '[::1]' : host;
    const connection = buildLocalTestConnection({
      databaseUrl: `postgresql://postgres:secret@${authority}:56999/arma2_local?sslmode=disable`,
      inheritedEnv: {},
      allowInsecureLocalTestConnection: true,
    });
    assert.equal(connection.profile, 'local-test');
    assert.equal(connection.targetMode, 'local-test');
    assert.equal(connection.env.PGSSLMODE, 'disable');
    assert.equal(connection.env.PGHOST, host);
    assert.ok(isValidatedConnection(connection));
  }
});

test('regression 10: the test-only opt-in refuses any Supabase or non-loopback host', () => {
  for (const hostile of [
    DIRECT_URL,
    `postgresql://postgres:secret@${POOLER_HOST}:6543/postgres?sslmode=disable`,
    'postgresql://postgres:secret@10.0.0.5:5432/postgres?sslmode=disable',
    'postgresql://postgres:secret@db.other.example.com:5432/postgres?sslmode=disable',
  ]) {
    expectCode('CONNECTION_TEST_ONLY', () => buildLocalTestConnection({
      databaseUrl: hostile, allowInsecureLocalTestConnection: true,
    }));
  }
  expectCode('PRODUCTION_FORBIDDEN', () => buildLocalTestConnection({
    databaseUrl: PRODUCTION_URL, allowInsecureLocalTestConnection: true,
  }));
});

test('the test-only opt-in is unreachable from the CLI and never serialized', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'scripts/torneos-staging/apply-single-migration.mjs'), 'utf8');
  assert.doesNotMatch(cli, /allowInsecureLocalTestConnection|buildLocalTestConnection/);
  assert.doesNotMatch(cli, /databaseUrl/);
  // Only the test suites may name the exception at all.
  const named = execFileSync('git', ['grep', '-l', 'allowInsecureLocalTestConnection', '--', 'scripts', 'src', 'supabase'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.deepEqual(named.sort(), [
    'scripts/torneos-staging/psql-connection-contract.test.mjs',
    'scripts/torneos-staging/psql-connection-live.test.mjs',
    'scripts/torneos-staging/single-migration-executor-lib.mjs',
  ]);
  const connection = buildLocalTestConnection({
    databaseUrl: 'postgresql://postgres:secret@127.0.0.1:56999/arma2_local?sslmode=disable',
    inheritedEnv: {},
    allowInsecureLocalTestConnection: true,
  });
  const serialized = JSON.stringify({ connection });
  assert.doesNotMatch(serialized, /allowInsecure|PGPASSWORD|secret/);
  assert.deepEqual(JSON.parse(serialized).connection, {
    profile: 'local-test', projectRef: null, targetMode: 'local-test', databaseHostKind: 'loopback',
  });
});

// --- Target validation ------------------------------------------------------------------------

// `main()` reaches a connection only through `prepareExecution`, and `prepareExecution` reaches a
// descriptor only through `validateTarget`. The first link is asserted statically (the CLI source
// has no other path to psql); the second is asserted functionally below, for both modes.
const prepareWith = (options, databaseUrl, targetMode) => prepareExecution({
  repoRoot: ROOT,
  options,
  env: { STAGING_MIGRATION_DATABASE_URL: databaseUrl },
  requireClean: false,
  targetMode,
});

const prepareDryRun = (options, targetMode) => prepareExecution({
  repoRoot: ROOT, options, env: {}, requireClean: false, requireApproval: false,
  requireDatabaseUrl: false, targetMode,
});

for (const [regression, targetMode] of [['11', 'apply'], ['12', 'verify']]) {
  test(`regression ${regression}: ${targetMode} always goes through validateTarget`, async () => {
    await withContractFiles(async ({ options }) => {
      expectCode('DATABASE_PROJECT_MISMATCH', () => prepareWith(options, UNKNOWN_HOST_URL, targetMode));
      expectCode('PRODUCTION_FORBIDDEN', () => prepareWith(options, PRODUCTION_URL, targetMode));
      expectCode('DATABASE_URL_REQUIRED', () => prepareWith(options, '', targetMode));
      expectCode('DATABASE_URL_PARAMETER',
        () => prepareWith(options, `${DIRECT_URL}?sslmode=prefer`, targetMode));
      const contract = prepareWith(options, `${DIRECT_URL}?sslmode=verify-full`, targetMode);
      assert.ok(isValidatedConnection(contract.connection));
      assert.equal(contract.connection.targetMode, targetMode);
      assert.equal(contract.connection.profile, 'remote');
      assert.equal(contract.connection.databaseHostKind, 'direct');
      assert.equal(contract.connection.env.PGSSLMODE, 'verify-full');
      assert.ok(!Object.hasOwn(contract, 'databaseUrl'), 'the raw URL must not survive in the contract');
      // A dry-run mints no connection at all, so it can never spawn.
      assert.equal(prepareDryRun(options, targetMode).connection, null);
    });
  });
}

test('the CLI reaches psql only through the descriptor minted by prepareExecution', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'scripts/torneos-staging/apply-single-migration.mjs'), 'utf8');
  const runPsqlCalls = [...cli.matchAll(/runPsql\(\{([^}]*)/g)].map((match) => match[1]);
  assert.equal(runPsqlCalls.length, 2, 'apply and verify are the only psql call sites');
  for (const call of runPsqlCalls) {
    assert.match(call, /connection:\s*contract\.connection/);
    assert.doesNotMatch(call, /databaseUrl|env:|spawnFn/);
  }
  assert.match(cli, /prepareExecution\(\{[\s\S]*?targetMode:\s*mode,/);
  assert.equal((cli.match(/prepareExecution\(/g) || []).length, 1);
  // The executor is the only production caller of runPsql.
  const callers = execFileSync('git', ['grep', '-l', 'runPsql', '--', 'scripts', 'src', 'supabase'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((file) => !file.endsWith('.test.mjs'));
  assert.deepEqual(callers.sort(), [
    'scripts/torneos-staging/apply-single-migration.mjs',
    'scripts/torneos-staging/single-migration-executor-lib.mjs',
  ]);
});

test('regression 13: runPsql refuses anything that is not a validated descriptor', async () => {
  const { calls, spawnFn } = makeSpawnRecorder();
  const forged = {
    profile: 'remote', targetMode: 'apply', env: { PGHOST: 'evil.invalid' }, redactions: [],
  };
  for (const connection of [
    undefined, null, DIRECT_URL, { databaseUrl: DIRECT_URL }, forged,
    { ...operational() },
  ]) {
    await rejectsWithCode('CONNECTION_NOT_VALIDATED',
      runPsql({ connection, sql: 'SELECT 1;', spawnFn }));
  }
  // A receipt-mode descriptor is validated but never spawnable.
  await rejectsWithCode('CONNECTION_TARGET_MODE',
    runPsql({ connection: operational(DIRECT_URL, 'receipt'), sql: 'SELECT 1;', spawnFn }));
  assert.equal(calls.length, 0, 'no process may be spawned for an unvalidated descriptor');
});

test('regression 14: Production aborts before any process is spawned', async () => {
  expectCode('PRODUCTION_FORBIDDEN', () => buildPsqlConnectionEnv(PRODUCTION_URL, {}));
  expectCode('PRODUCTION_FORBIDDEN', () => buildPsqlConnectionEnv(
    `postgresql://postgres.${FORBIDDEN_PRODUCTION_REF}:secret@${POOLER_HOST}:6543/postgres`, {},
  ));
  expectCode('PRODUCTION_FORBIDDEN', () => operational(PRODUCTION_URL));
  expectCode('PRODUCTION_FORBIDDEN', () => buildOperationalConnection({
    projectRef: FORBIDDEN_PRODUCTION_REF, databaseUrl: DIRECT_URL, targetMode: 'apply', inheritedEnv: {},
  }));
  const { calls, spawnFn } = makeSpawnRecorder();
  await rejectsWithCode('CONNECTION_NOT_VALIDATED',
    runPsql({ connection: { databaseUrl: PRODUCTION_URL }, sql: 'SELECT 1;', spawnFn }));
  assert.equal(calls.length, 0);
});

test('regression 15: an unknown host aborts before any process is spawned', async () => {
  const { calls, spawnFn } = makeSpawnRecorder();
  for (const unknown of [
    UNKNOWN_HOST_URL,
    'postgresql://postgres:secret@db.example.com:5432/postgres',
    'postgresql://postgres:secret@127.0.0.1:5432/postgres',
    `postgresql://postgres:secret@${POOLER_HOST}:6543/postgres`, // pooler without the project ref
  ]) expectCode('DATABASE_PROJECT_MISMATCH', () => operational(unknown));
  expectCode('PROJECT_REF_UNKNOWN', () => buildOperationalConnection({
    projectRef: 'some-other-project', databaseUrl: DIRECT_URL, targetMode: 'apply', inheritedEnv: {},
  }));
  assert.equal(calls.length, 0);
  await rejectsWithCode('CONNECTION_NOT_VALIDATED',
    runPsql({ connection: { env: { PGHOST: 'evil.invalid' } }, sql: 'SELECT 1;', spawnFn }));
  assert.equal(calls.length, 0);
});

// --- URL and parameter contract ---------------------------------------------------------------

test('parameters outside the allowlist abort instead of overriding the A1 contract', () => {
  for (const query of [
    'application_name=someone-else',
    'options=-c%20search_path%3Devil',
    'statement_timeout=1',
    'lock_timeout=1',
    'search_path=evil',
    'passfile=/tmp/whatever',
    'service=prod',
    'hostaddr=203.0.113.10',
    'sslrootcert=/tmp/root.crt',
  ]) expectCode('DATABASE_URL_PARAMETER', () => buildPsqlConnectionEnv(`${DIRECT_URL}?${query}`, {}));
  expectCode('DATABASE_URL_PARAMETER',
    () => buildPsqlConnectionEnv(`${DIRECT_URL}?sslmode=bogus`, {}));
  expectCode('DATABASE_URL_PARAMETER',
    () => buildPsqlConnectionEnv(`${DIRECT_URL}?sslmode=require&sslmode=verify-full`, {}));
  expectCode('DATABASE_URL_PARAMETER',
    () => buildPsqlConnectionEnv(`${DIRECT_URL}?connect_timeout=5&connect_timeout=6`, {}));
});

test('connect_timeout must be a bounded positive integer', () => {
  for (const rejected of ['abc', '0', '00', '-1', '1.5', '007', '', ' 5', `${MAX_CONNECT_TIMEOUT_SECONDS + 1}`, '9999']) {
    expectCode('DATABASE_URL_PARAMETER',
      () => buildPsqlConnectionEnv(`${DIRECT_URL}?connect_timeout=${encodeURIComponent(rejected)}`, {}));
  }
  for (const accepted of ['1', '10', String(MAX_CONNECT_TIMEOUT_SECONDS)]) {
    assert.equal(buildPsqlConnectionEnv(`${DIRECT_URL}?connect_timeout=${accepted}`, {})
      .env.PGCONNECT_TIMEOUT, accepted);
  }
  assert.equal(MAX_CONNECT_TIMEOUT_SECONDS, 30);
});

test('malformed URLs, foreign schemes, fragments and missing identity abort', () => {
  expectCode('DATABASE_URL_REQUIRED', () => buildPsqlConnectionEnv('', {}));
  expectCode('DATABASE_URL_INVALID', () => buildPsqlConnectionEnv('not a url', {}));
  for (const scheme of ['https', 'http', 'mysql', 'file']) {
    expectCode('DATABASE_URL_INVALID',
      () => buildPsqlConnectionEnv(`${scheme}://${DIRECT_HOST}/postgres`, {}));
  }
  expectCode('DATABASE_URL_INVALID',
    () => buildPsqlConnectionEnv(`postgresql://postgres:secret@${DIRECT_HOST}:5432/postgres#frag`, {}));
  expectCode('DATABASE_URL_INVALID',
    () => buildPsqlConnectionEnv(`postgresql://:secret@${DIRECT_HOST}:5432/postgres`, {}));
  expectCode('DATABASE_URL_INVALID',
    () => buildPsqlConnectionEnv(`postgresql://postgres:secret@${DIRECT_HOST}:5432/`, {}));
  expectCode('DATABASE_URL_INVALID',
    () => buildPsqlConnectionEnv(`postgresql://postgres:secret@${DIRECT_HOST}:5432/one/two`, {}));
});

test('a URL without a password aborts for apply and verify but may be relaxed explicitly', () => {
  const passwordless = `postgresql://postgres@${DIRECT_HOST}:5432/postgres`;
  expectCode('DATABASE_CREDENTIAL_MISSING', () => buildPsqlConnectionEnv(passwordless, {}));
  expectCode('DATABASE_CREDENTIAL_MISSING', () => operational(passwordless));
  const relaxed = buildPsqlConnectionEnv(passwordless, {}, { requirePassword: false });
  assert.ok(!Object.hasOwn(relaxed.env, 'PGPASSWORD'));
});

test('hostile inherited PG* settings never reach the child process', () => {
  const hostile = {
    PATH: '/usr/bin',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    PGSERVICE: 'production',
    PGSERVICEFILE: '/tmp/pg_service.conf',
    PGPASSFILE: '/tmp/pgpass',
    PGOPTIONS: '-c search_path=evil',
    PGHOSTADDR: '203.0.113.10',
    PGREQUIRESSL: '0',
    PGSSLMODE: 'disable',
    PGSSLCERT: '/tmp/client.crt',
    PGSSLKEY: '/tmp/client.key',
    PGSSLROOTCERT: '/tmp/root.crt',
    PGDATABASE: 'someone-elses-db',
    PGUSER: 'someone-else',
    PGPASSWORD: 'someone-elses-password',
    PGHOST: 'evil.invalid',
  };
  const { env } = buildPsqlConnectionEnv(DIRECT_URL, hostile);
  for (const removed of [
    'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGHOSTADDR',
    'PGREQUIRESSL', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLROOTCERT',
  ]) assert.ok(!Object.hasOwn(env, removed), `${removed} must not be inherited`);
  assert.equal(env.PGHOST, DIRECT_HOST);
  assert.equal(env.PGUSER, 'postgres');
  assert.equal(env.PGDATABASE, 'postgres');
  assert.equal(env.PGPASSWORD, PASSWORD);
  assert.equal(env.PATH, '/usr/bin');
  // An inherited PGSSLMODE=disable must not be able to downgrade the connection either.
  assert.equal(env.PGSSLMODE, 'require');
  const allowed = new Set([
    'PATH', 'LANG', 'LC_ALL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
    'PGSSLMODE', 'PGCONNECT_TIMEOUT', 'PGTARGETSESSIONATTRS', 'PGCHANNELBINDING',
  ]);
  for (const key of Object.keys(env)) assert.ok(allowed.has(key), `unexpected variable ${key}`);
});

// --- Spawn contract and sanitization ------------------------------------------------------------

test('runPsql keeps the spawn contract: no credential in argv, shell false, SQL over stdin', async () => {
  const { calls, spawnFn } = makeSpawnRecorder({ stdout: 'HISTORY_OK\n' });
  const result = await runPsql({
    connection: operational(), sql: 'SELECT 1;', psql: '/opt/custom/bin/psql', spawnFn,
  });
  assert.equal(result.stdout, 'HISTORY_OK\n');
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.command, '/opt/custom/bin/psql');
  assert.deepEqual(call.args, ['-X', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--file=-']);
  assert.equal(call.options.shell, false);
  assert.equal(call.stdin, 'SELECT 1;');
  const argv = [call.command, ...call.args].join(' ');
  for (const secret of [PASSWORD, encodeURIComponent(PASSWORD), DIRECT_URL, DIRECT_HOST]) {
    assert.ok(!argv.includes(secret), 'credentials must never appear in argv');
  }
  // The regression that the previous contract missed: PGDATABASE held the whole URI.
  assert.equal(call.options.env.PGDATABASE, 'postgres');
  assert.equal(call.options.env.PGHOST, DIRECT_HOST);
  assert.equal(call.options.env.PGPASSWORD, PASSWORD);
  assert.equal(call.options.env.PGSSLMODE, 'require');
});

test('psql failures surface exit code and SQLSTATE with the credential redacted', async () => {
  const { spawnFn } = makeSpawnRecorder({
    exitCode: 3,
    stderr: `psql: error: connection failed for ${DIRECT_URL}\n`
      + `ERROR:  duplicate key value (SQLSTATE 23505) password=${PASSWORD}\n`,
  });
  await assert.rejects(
    runPsql({ connection: operational(), sql: 'SELECT 1;', spawnFn }),
    (error) => {
      assert.equal(error.code, 'PSQL_FAILED');
      assert.equal(error.details.exitCode, 3);
      assert.equal(error.details.sqlState, '23505');
      assert.match(error.details.stderr, /duplicate key value/);
      assert.ok(error.details.stderr.length <= 800);
      for (const secret of [PASSWORD, encodeURIComponent(PASSWORD), DIRECT_URL]) {
        assert.ok(!error.details.stderr.includes(secret), 'stderr must be redacted');
        assert.ok(!error.message.includes(secret), 'message must be redacted');
      }
      assert.ok(!error.details.stderr.includes('SELECT 1;'), 'SQL must not be echoed back');
      return true;
    },
  );
});

test('regression 16: no secret reaches argv, the environment dump, the log or the error', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhcm1hMiJ9.c2lnbmF0dXJlLXZhbHVl';
  const noisy = [
    `psql: connection string ${DIRECT_URL} refused`,
    `PGPASSWORD=${PASSWORD} PGPASSFILE=/Users/nicoavayu/.pgpass`,
    `password=${encodeURIComponent(PASSWORD)}`,
    `https://${FORBIDDEN_PRODUCTION_REF}.supabase.co/rest/v1?apikey=${jwt}`,
    `bearer ${jwt}`,
    `at /Users/nicoavayu/Downloads/arma2/scripts/torneos-staging/apply-single-migration.mjs:54`,
    'ERROR:  permission denied (SQLSTATE 42501)',
  ].join('\n');
  const safe = sanitizePsqlError(noisy, { secrets: [PASSWORD, encodeURIComponent(PASSWORD)] });
  for (const secret of [
    PASSWORD, encodeURIComponent(PASSWORD), DIRECT_URL, jwt, FORBIDDEN_PRODUCTION_REF,
    '/Users/nicoavayu', 'https://',
  ]) assert.ok(!safe.includes(secret), `${secret} must be redacted`);
  assert.doesNotMatch(safe, /PGPASSWORD=(?!\[REDACTED)/);
  // The technical signal survives.
  assert.match(safe, /permission denied/);
  assert.match(safe, /42501/);
  assert.ok(safe.length <= 2000);
  assert.equal(sanitizePsqlError('x'.repeat(5000), { maxLength: 800 }).length, 800);
});

test('explicit secrets are redacted even when they defeat the generic patterns', () => {
  const plain = 'trivial';
  const safe = sanitizePsqlError(`credential ${plain} leaked`, { secrets: [plain] });
  assert.ok(!safe.includes(plain));
  assert.match(safe, /\[REDACTED_SECRET\]/);
});
