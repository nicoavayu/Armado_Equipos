import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PassThrough, Writable } from 'node:stream';
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
  MAX_CA_CERT_BYTES,
  PSQL_CONNECTION_PARAM_ALLOWLIST,
  REMOTE_CHANNEL_BINDINGS,
  REMOTE_SSLMODES,
  STAGING_CA_CERT_ENV,
  SingleMigrationError,
  VERIFIED_TLS_SSLMODE,
  VERIFIED_TLS_TARGET_MODES,
  approvalTokenForPlan,
  buildLocalTestConnection,
  buildOperationalConnection,
  buildPsqlConnectionEnv,
  isValidatedConnection,
  prepareExecution,
  resolveCaCertificatePath,
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
// The only URL shape a remote apply or verify accepts: the server identity must be verified.
const DIRECT_VERIFIED_URL = `${DIRECT_URL}?sslmode=${VERIFIED_TLS_SSLMODE}`;
const UNKNOWN_HOST_URL = 'postgresql://postgres:secret@db.unknown-project.supabase.co:5432/postgres';
const PRODUCTION_URL = `postgresql://postgres:secret@db.${FORBIDDEN_PRODUCTION_REF}.supabase.co:5432/postgres`;

// A syntactically valid PEM bundle. It is not a real certificate and carries no key material; the
// executor only has to prove it validates provenance and permissions before pointing psql at it.
const CA_PEM = `-----BEGIN CERTIFICATE-----\n${'QXJtYTIgVG9ybmVvcyBBMSB0ZXN0IENBIGJ1bmRsZSAtIG5vdCBhIHJlYWwgY2Vy'.repeat(3)}\n-----END CERTIFICATE-----\n`;
const CA_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-a1-ca-'));
const CA_PATH = path.join(CA_DIRECTORY, 'staging-ca.crt');
fs.writeFileSync(CA_PATH, CA_PEM, { mode: 0o600 });

const writeCa = (name, { contents = CA_PEM, mode = 0o600 } = {}) => {
  const file = path.join(CA_DIRECTORY, name);
  fs.writeFileSync(file, contents, { mode });
  fs.chmodSync(file, mode);
  return file;
};

test.after(() => fs.rmSync(CA_DIRECTORY, { recursive: true, force: true }));

const isExecutorError = (error) => (
  error instanceof SingleMigrationError || error instanceof InspectorError
);
const expectCode = (code, run) => assert.throws(run, (error) => (
  isExecutorError(error) && error.code === code
), `expected ${code}`);
const rejectsWithCode = (code, promise) => assert.rejects(promise, (error) => (
  isExecutorError(error) && error.code === code
), `expected ${code}`);

const operational = (
  databaseUrl = DIRECT_VERIFIED_URL, targetMode = 'apply', caCertPath = CA_PATH,
) => buildOperationalConnection({
  projectRef: AUTHORIZED_STAGING_REF, databaseUrl, targetMode, inheritedEnv: {}, caCertPath,
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

test('regression 4-6: sslmode require, verify-ca and verify-full survive the projection', () => {
  for (const accepted of REMOTE_SSLMODES) {
    assert.equal(buildPsqlConnectionEnv(`${DIRECT_URL}?sslmode=${accepted}`, {}).env.PGSSLMODE,
      accepted);
  }
  // But only verify-full reaches an operational apply or verify: see the CA contract below.
  assert.equal(operational().env.PGSSLMODE, VERIFIED_TLS_SSLMODE);
});

test('regression 7: a remote URL without sslmode fails closed at require', () => {
  assert.equal(buildPsqlConnectionEnv(DIRECT_URL, {}).env.PGSSLMODE, 'require');
  assert.equal(buildPsqlConnectionEnv(
    `postgresql://postgres.${AUTHORIZED_STAGING_REF}:secret@${POOLER_HOST}:6543/postgres`, {},
  ).env.PGSSLMODE, 'require');
  // `require` encrypts but authenticates nothing, so it is not enough for an operational target.
  expectCode('TLS_VERIFICATION_REQUIRED', () => operational(DIRECT_URL));
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

// --- CA bundle contract -------------------------------------------------------------------------

test('a valid CA bundle is projected onto PGSSLROOTCERT for psql', () => {
  const connection = operational();
  assert.equal(connection.env.PGSSLROOTCERT, CA_PATH);
  assert.equal(connection.env.PGSSLMODE, VERIFIED_TLS_SSLMODE);
  const projected = buildPsqlConnectionEnv(DIRECT_VERIFIED_URL, {}, {
    caCertPath: CA_PATH, requireCaCert: true, requireVerifiedTls: true,
  });
  assert.equal(projected.env.PGSSLROOTCERT, CA_PATH);
  assert.equal(projected.caCertificate, CA_PATH);
  // NODE_EXTRA_CA_CERTS only configures Node's own TLS stack; psql never reads it, so it is not a
  // substitute and the executor never consults it.
  const source = fs.readFileSync(
    path.join(ROOT, 'scripts/torneos-staging/single-migration-executor-lib.mjs'), 'utf8',
  );
  assert.doesNotMatch(source, /process\.env\.NODE_EXTRA_CA_CERTS|env\.NODE_EXTRA_CA_CERTS/);
});

test('an absent CA bundle fails closed for every remote apply and verify', () => {
  for (const targetMode of VERIFIED_TLS_TARGET_MODES) {
    for (const missing of [null, '', '   ', 0, false]) {
      expectCode('CA_CERT_REQUIRED', () => operational(DIRECT_VERIFIED_URL, targetMode, missing));
    }
    // Omitting the argument entirely is the same failure, not a default.
    expectCode('CA_CERT_REQUIRED', () => buildOperationalConnection({
      projectRef: AUTHORIZED_STAGING_REF,
      databaseUrl: DIRECT_VERIFIED_URL,
      targetMode,
      inheritedEnv: {},
    }));
  }
  // The projection layer refuses just as hard when the CA is declared required.
  expectCode('CA_CERT_REQUIRED', () => buildPsqlConnectionEnv(DIRECT_VERIFIED_URL, {}, {
    requireCaCert: true, requireVerifiedTls: true,
  }));
});

test('an insecure or malformed CA bundle fails closed instead of downgrading verification', () => {
  const groupWritable = writeCa('group-writable.crt', { mode: 0o620 });
  const worldWritable = writeCa('world-writable.crt', { mode: 0o606 });
  const notPem = writeCa('not-a-bundle.crt', { contents: 'just some bytes\n' });
  const empty = writeCa('empty.crt', { contents: '' });
  const oversized = writeCa('oversized.crt', {
    contents: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(MAX_CA_CERT_BYTES + 1)}\n-----END CERTIFICATE-----\n`,
  });
  const symlink = path.join(CA_DIRECTORY, 'symlinked.crt');
  fs.symlinkSync(CA_PATH, symlink);
  const directory = fs.mkdtempSync(path.join(CA_DIRECTORY, 'dir-'));

  for (const [file, code] of [
    [groupWritable, 'CA_CERT_INSECURE'],
    [worldWritable, 'CA_CERT_INSECURE'],
    [symlink, 'CA_CERT_INSECURE'],
    [directory, 'CA_CERT_INVALID'],
    [notPem, 'CA_CERT_INVALID'],
    [empty, 'CA_CERT_INVALID'],
    [oversized, 'CA_CERT_INVALID'],
    [path.join(CA_DIRECTORY, 'does-not-exist.crt'), 'CA_CERT_INVALID'],
    ['relative/staging-ca.crt', 'CA_CERT_INVALID'],
    [`${CA_PATH}\nPGSSLMODE=disable`, 'CA_CERT_INVALID'],
  ]) {
    expectCode(code, () => resolveCaCertificatePath(file));
    expectCode(code, () => operational(DIRECT_VERIFIED_URL, 'apply', file));
  }
  // A bundle owned by somebody else is refused even with impeccable permissions.
  expectCode('CA_CERT_INSECURE', () => resolveCaCertificatePath(CA_PATH, {
    currentUid: (process.getuid?.() ?? 0) + 1,
  }));
});

test('an inherited PGSSLROOTCERT is refused out loud, never silently ignored', () => {
  const inherited = { PATH: '/usr/bin', PGSSLROOTCERT: '/tmp/attacker-root.crt' };
  expectCode('CA_CERT_INHERITED', () => buildPsqlConnectionEnv(DIRECT_URL, inherited));
  expectCode('CA_CERT_INHERITED', () => buildOperationalConnection({
    projectRef: AUTHORIZED_STAGING_REF,
    databaseUrl: DIRECT_VERIFIED_URL,
    targetMode: 'apply',
    inheritedEnv: inherited,
    caCertPath: CA_PATH,
  }));
  // Even the test-only local profile refuses it, so no suite can normalise the habit.
  expectCode('CA_CERT_INHERITED', () => buildLocalTestConnection({
    databaseUrl: 'postgresql://postgres:secret@127.0.0.1:56999/arma2_local?sslmode=disable',
    inheritedEnv: inherited,
    allowInsecureLocalTestConnection: true,
  }));
  // The validated bundle wins because it is the only source, not because it was merged last.
  assert.equal(operational().env.PGSSLROOTCERT, CA_PATH);
});

test('sslrootcert inside the URL stays rejected, CA path and all', () => {
  for (const query of [
    `sslrootcert=${encodeURIComponent(CA_PATH)}`,
    'sslrootcert=/tmp/root.crt',
    `sslmode=${VERIFIED_TLS_SSLMODE}&sslrootcert=${encodeURIComponent(CA_PATH)}`,
    'sslcert=/tmp/client.crt',
    'sslkey=/tmp/client.key',
  ]) {
    expectCode('DATABASE_URL_PARAMETER', () => buildPsqlConnectionEnv(`${DIRECT_URL}?${query}`, {}));
    expectCode('DATABASE_URL_PARAMETER',
      () => operational(`${DIRECT_URL}?${query}`, 'apply', CA_PATH));
  }
});

test('remote apply and verify require sslmode=verify-full and nothing less', () => {
  assert.deepEqual([...VERIFIED_TLS_TARGET_MODES], ['apply', 'verify']);
  for (const targetMode of VERIFIED_TLS_TARGET_MODES) {
    for (const insufficient of ['require', 'verify-ca']) {
      expectCode('TLS_VERIFICATION_REQUIRED',
        () => operational(`${DIRECT_URL}?sslmode=${insufficient}`, targetMode));
    }
    // No sslmode at all falls back to `require`, which is still not verification.
    expectCode('TLS_VERIFICATION_REQUIRED', () => operational(DIRECT_URL, targetMode));
    const connection = operational(DIRECT_VERIFIED_URL, targetMode);
    assert.equal(connection.env.PGSSLMODE, VERIFIED_TLS_SSLMODE);
    assert.equal(connection.env.PGSSLROOTCERT, CA_PATH);
  }
});

// --- Target validation ------------------------------------------------------------------------

// `main()` reaches a connection only through `prepareExecution`, and `prepareExecution` reaches a
// descriptor only through `validateTarget`. The first link is asserted statically (the CLI source
// has no other path to psql); the second is asserted functionally below, for both modes.
const prepareWith = (options, databaseUrl, targetMode, caCertPath = CA_PATH) => prepareExecution({
  repoRoot: ROOT,
  options,
  env: {
    STAGING_MIGRATION_DATABASE_URL: databaseUrl,
    ...(caCertPath === null ? {} : { [STAGING_CA_CERT_ENV]: caCertPath }),
  },
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
      expectCode('TLS_VERIFICATION_REQUIRED',
        () => prepareWith(options, `${DIRECT_URL}?sslmode=require`, targetMode));
      // The CA travels through its own environment variable; without it the mode aborts.
      expectCode('CA_CERT_REQUIRED', () => prepareWith(options, DIRECT_VERIFIED_URL, targetMode, null));
      const contract = prepareWith(options, `${DIRECT_URL}?sslmode=verify-full`, targetMode);
      assert.ok(isValidatedConnection(contract.connection));
      assert.equal(contract.connection.targetMode, targetMode);
      assert.equal(contract.connection.profile, 'remote');
      assert.equal(contract.connection.databaseHostKind, 'direct');
      assert.equal(contract.connection.env.PGSSLMODE, 'verify-full');
      assert.equal(contract.connection.env.PGSSLROOTCERT, CA_PATH);
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
    // PGSSLROOTCERT is not listed here: it no longer gets quietly dropped, it aborts. See the
    // dedicated CA test above.
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
  // The CA is the single exception, and only from its own validated variable.
  assert.equal(buildPsqlConnectionEnv(DIRECT_VERIFIED_URL, hostile, {
    caCertPath: CA_PATH, requireCaCert: true, requireVerifiedTls: true,
  }).env.PGSSLROOTCERT, CA_PATH);
  assert.equal(env.PGHOST, DIRECT_HOST);
  assert.equal(env.PGUSER, 'postgres');
  assert.equal(env.PGDATABASE, 'postgres');
  assert.equal(env.PGPASSWORD, PASSWORD);
  assert.equal(env.PATH, '/usr/bin');
  // An inherited PGSSLMODE=disable must not be able to downgrade the connection either.
  assert.equal(env.PGSSLMODE, 'require');
  const allowed = new Set([
    'PATH', 'LANG', 'LC_ALL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
    'PGSSLMODE', 'PGSSLROOTCERT', 'PGCONNECT_TIMEOUT', 'PGTARGETSESSIONATTRS', 'PGCHANNELBINDING',
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
  assert.equal(call.options.env.PGSSLMODE, VERIFIED_TLS_SSLMODE);
  assert.equal(call.options.env.PGSSLROOTCERT, CA_PATH);
  assert.equal(result.psqlExitCode, 0);
  assert.equal(result.signal, null);
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
      assert.equal(error.details.psqlExitCode, 3);
      assert.equal(error.details.signal, null);
      assert.equal(error.details.stdinErrorCode, null);
      assert.equal(error.details.requiresReadOnlyReinspection, true);
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

// --- stdin transport: a child that stops reading -------------------------------------------------

// A payload comfortably larger than any pipe buffer, so a child that exits early cannot possibly
// have consumed it. 100 KB is the contractual floor; this is well past it.
const LARGE_SQL = `-- ${'x'.repeat(512 * 1024)}\nSELECT 1;\n`;

// Simulates psql dying mid-write: stdin rejects the payload with EPIPE and the process still
// reports its own exit code, signal and stderr through `close`, a turn later.
const makeEarlyExitSpawn = ({ exitCode = 3, signal = null, stderr = '', errorCode = 'EPIPE' } = {}) => {
  const calls = [];
  const spawnFn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let written = 0;
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        written += chunk.length;
        const error = new Error('write EPIPE');
        error.code = errorCode;
        callback(error);
      },
    });
    child.stdin.on('error', () => {
      calls[calls.length - 1].bytesWritten = written;
      if (stderr) child.stderr.write(stderr);
      child.stdout.end();
      child.stderr.end();
      // The child's own outcome arrives after the stdin failure, exactly as it does with real pipes.
      setImmediate(() => child.emit('close', exitCode, signal));
    });
    return child;
  };
  return { calls, spawnFn };
};

test('a child that stops reading a >100 KB payload never raises an uncaughtException', async () => {
  const uncaught = [];
  const capture = (error) => uncaught.push(error);
  process.on('uncaughtException', capture);
  try {
    const { calls, spawnFn } = makeEarlyExitSpawn({
      exitCode: 3, stderr: `psql: error: could not send data to server ${DIRECT_URL}\n`,
    });
    await assert.rejects(
      runPsql({ connection: operational(), sql: LARGE_SQL, spawnFn }),
      (error) => {
        assert.equal(error.code, 'PSQL_STDIN_TRANSPORT');
        // EPIPE is recognised as an early close, not swallowed and not fatal.
        assert.equal(error.details.stdinErrorCode, 'EPIPE');
        // The child's outcome survived the transport failure.
        assert.equal(error.details.psqlExitCode, 3);
        assert.equal(error.details.exitCode, 3);
        assert.equal(error.details.signal, null);
        assert.match(error.details.stderr, /could not send data to server/);
        // The remote state is undetermined: nothing here claims a rollback.
        assert.equal(error.details.requiresReadOnlyReinspection, true);
        assert.doesNotMatch(error.message, /roll ?back/i);
        assert.doesNotMatch(JSON.stringify(error.details), /roll ?back/i);
        // And no secret rode along with the diagnosis.
        for (const secret of [PASSWORD, encodeURIComponent(PASSWORD), DIRECT_URL, CA_PEM]) {
          assert.ok(!error.details.stderr.includes(secret));
          assert.ok(!error.message.includes(secret));
        }
        return true;
      },
    );
    assert.ok(LARGE_SQL.length > 100 * 1024, 'the payload must exceed the 100 KB floor');
    assert.equal(calls.length, 1, 'the failure must not be retried automatically');
  } finally {
    process.off('uncaughtException', capture);
  }
  assert.deepEqual(uncaught, []);
});

test('an exit code of 0 does not absolve a truncated stdin write', async () => {
  const { spawnFn } = makeEarlyExitSpawn({ exitCode: 0 });
  await assert.rejects(
    runPsql({ connection: operational(), sql: LARGE_SQL, spawnFn }),
    (error) => {
      assert.equal(error.code, 'PSQL_STDIN_TRANSPORT');
      assert.equal(error.details.psqlExitCode, 0);
      assert.equal(error.details.stdinErrorCode, 'EPIPE');
      assert.equal(error.details.requiresReadOnlyReinspection, true);
      return true;
    },
  );
});

test('a child killed by a signal reports the signal alongside the exit code', async () => {
  const { spawnFn } = makeEarlyExitSpawn({ exitCode: null, signal: 'SIGKILL' });
  await assert.rejects(
    runPsql({ connection: operational(), sql: LARGE_SQL, spawnFn }),
    (error) => {
      assert.equal(error.details.signal, 'SIGKILL');
      assert.equal(error.details.psqlExitCode, null);
      assert.equal(error.details.requiresReadOnlyReinspection, true);
      return true;
    },
  );
});

test('a real child that exits before reading a >100 KB payload is diagnosed, not fatal', async () => {
  const uncaught = [];
  const capture = (error) => uncaught.push(error);
  process.on('uncaughtException', capture);
  try {
    await assert.rejects(
      runPsql({
        connection: operational(),
        sql: LARGE_SQL,
        // A real process with real pipes: it writes to stderr and exits without draining stdin.
        spawnFn: (command, args, options) => spawn(process.execPath, [
          '-e', 'process.stderr.write("psql: fatal: server closed the connection\\n"); process.exit(3);',
        ], { ...options, stdio: ['pipe', 'pipe', 'pipe'], shell: false }),
      }),
      (error) => {
        assert.ok(['PSQL_STDIN_TRANSPORT', 'PSQL_FAILED'].includes(error.code), error.code);
        assert.equal(error.details.psqlExitCode, 3, 'the real exit code must survive');
        assert.match(error.details.stderr, /server closed the connection/);
        assert.equal(error.details.requiresReadOnlyReinspection, true);
        if (error.code === 'PSQL_STDIN_TRANSPORT') {
          assert.match(error.details.stdinErrorCode, /EPIPE|ERR_STREAM_DESTROYED/);
        }
        return true;
      },
    );
  } finally {
    process.off('uncaughtException', capture);
  }
  assert.deepEqual(uncaught, [], 'the EPIPE must never escape as an uncaught exception');
});

test('a healthy child consumes the whole SQL payload and resolves', async () => {
  const { calls, spawnFn } = makeSpawnRecorder({ stdout: 'HISTORY_OK\n' });
  const result = await runPsql({ connection: operational(), sql: LARGE_SQL, spawnFn });
  assert.equal(result.psqlExitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.onErrorStop, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stdin, LARGE_SQL, 'the child must receive the payload byte for byte');
});

test('a spawn that never produces a process is reported without leaking or asserting rollback',
  async () => {
    const spawnFn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      setImmediate(() => {
        const error = new Error(`spawn psql ENOENT for ${DIRECT_URL}`);
        error.code = 'ENOENT';
        child.emit('error', error);
      });
      return child;
    };
    await assert.rejects(
      runPsql({ connection: operational(), sql: 'SELECT 1;', spawnFn }),
      (error) => {
        assert.equal(error.code, 'PSQL_EXECUTION');
        assert.equal(error.details.requiresReadOnlyReinspection, true);
        assert.ok(!error.message.includes(DIRECT_URL));
        assert.ok(!error.message.includes(PASSWORD));
        return true;
      },
    );
  });

// --- The executor still selects A1 and nothing else ----------------------------------------------

test('the fixed transport did not widen the migration selection beyond A1', async () => {
  await withContractFiles(async ({ options }) => {
    const contract = prepareWith(options, DIRECT_VERIFIED_URL, 'apply');
    assert.equal(path.relative(ROOT, contract.migrationFile), A1_FILE);
    assert.deepEqual(contract.historyAfter.filter((version) => version === A1_VERSION), [A1_VERSION]);
    assert.equal(contract.historyAfter.length, contract.historyBefore.length + 1);
    for (const rejected of [
      'supabase/migrations',
      'supabase/migrations/*.sql',
      'all',
      `${A1_FILE},supabase/migrations/20260802120000_tournament_media_trusted_processing.sql`,
      'supabase/migrations/20260802120000_tournament_media_trusted_processing.sql',
    ]) {
      assert.throws(() => prepareWith({ ...options, migration: rejected }, DIRECT_VERIFIED_URL, 'apply'),
        (error) => isExecutorError(error)
          && ['MIGRATION_SELECTION', 'MIGRATION_NOT_AUTHORIZED'].includes(error.code));
    }
    // Production stays blocked on the very same path, before any descriptor exists.
    expectCode('PRODUCTION_FORBIDDEN',
      () => prepareWith({ ...options, 'project-ref': FORBIDDEN_PRODUCTION_REF }, DIRECT_VERIFIED_URL, 'apply'));
    expectCode('PRODUCTION_FORBIDDEN', () => prepareWith(options, PRODUCTION_URL, 'apply'));
  });
});
