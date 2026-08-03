import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { AUTHORIZED_STAGING_REF, FORBIDDEN_PRODUCTION_REF } from './inspect-remote-readonly-lib.mjs';
import {
  PSQL_CONNECTION_PARAM_ALLOWLIST,
  SingleMigrationError,
  buildPsqlConnectionEnv,
  runPsql,
  sanitizePsqlError,
} from './single-migration-executor-lib.mjs';

const DIRECT_HOST = `db.${AUTHORIZED_STAGING_REF}.supabase.co`;
const POOLER_HOST = 'aws-0-us-east-1.pooler.supabase.com';
const PASSWORD = 'p@ss w/ord:with#specials';
const DIRECT_URL = `postgresql://postgres:${encodeURIComponent(PASSWORD)}@${DIRECT_HOST}:5432/postgres`;

const expectCode = (code, run) => assert.throws(run, (error) => (
  error instanceof SingleMigrationError && error.code === code
));

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

test('TLS is required unless the URL explicitly downgrades it', () => {
  assert.equal(buildPsqlConnectionEnv(DIRECT_URL, {}).env.PGSSLMODE, 'require');
  assert.equal(buildPsqlConnectionEnv(`${DIRECT_URL}?sslmode=disable`, {}).env.PGSSLMODE, 'disable');
});

test('parameters outside the allowlist abort instead of overriding the A1 contract', () => {
  for (const query of [
    'application_name=someone-else',
    'options=-c%20search_path%3Devil',
    'statement_timeout=1',
    'lock_timeout=1',
    'passfile=/tmp/whatever',
    'service=prod',
  ]) expectCode('DATABASE_URL_PARAMETER', () => buildPsqlConnectionEnv(`${DIRECT_URL}?${query}`, {}));
  expectCode('DATABASE_URL_PARAMETER',
    () => buildPsqlConnectionEnv(`${DIRECT_URL}?sslmode=bogus`, {}));
  expectCode('DATABASE_URL_PARAMETER',
    () => buildPsqlConnectionEnv(`${DIRECT_URL}?connect_timeout=abc`, {}));
  expectCode('DATABASE_URL_PARAMETER',
    () => buildPsqlConnectionEnv(`${DIRECT_URL}?sslmode=require&sslmode=disable`, {}));
});

test('a Production connection URL aborts before any process is spawned', async () => {
  expectCode('PRODUCTION_FORBIDDEN', () => buildPsqlConnectionEnv(
    `postgresql://postgres:secret@db.${FORBIDDEN_PRODUCTION_REF}.supabase.co:5432/postgres`, {},
  ));
  expectCode('PRODUCTION_FORBIDDEN', () => buildPsqlConnectionEnv(
    `postgresql://postgres.${FORBIDDEN_PRODUCTION_REF}:secret@${POOLER_HOST}:6543/postgres`, {},
  ));
  const { calls, spawnFn } = makeSpawnRecorder();
  await assert.rejects(runPsql({
    databaseUrl: `postgresql://postgres:secret@db.${FORBIDDEN_PRODUCTION_REF}.supabase.co:5432/postgres`,
    sql: 'SELECT 1;',
    spawnFn,
  }), (error) => error.code === 'PRODUCTION_FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('malformed URLs, foreign schemes, fragments and missing identity abort', () => {
  expectCode('DATABASE_URL_REQUIRED', () => buildPsqlConnectionEnv('', {}));
  expectCode('DATABASE_URL_INVALID', () => buildPsqlConnectionEnv('not a url', {}));
  expectCode('DATABASE_URL_INVALID',
    () => buildPsqlConnectionEnv(`https://${DIRECT_HOST}/postgres`, {}));
  expectCode('DATABASE_URL_INVALID',
    () => buildPsqlConnectionEnv(`postgresql://postgres:secret@${DIRECT_HOST}:5432/postgres#frag`, {}));
  expectCode('DATABASE_URL_INVALID',
    () => buildPsqlConnectionEnv(`postgresql://:secret@${DIRECT_HOST}:5432/postgres`, {}));
  expectCode('DATABASE_URL_INVALID',
    () => buildPsqlConnectionEnv(`postgresql://postgres:secret@${DIRECT_HOST}:5432/`, {}));
});

test('a URL without a password aborts for apply and verify but may be relaxed explicitly', () => {
  const passwordless = `postgresql://postgres@${DIRECT_HOST}:5432/postgres`;
  expectCode('DATABASE_CREDENTIAL_MISSING', () => buildPsqlConnectionEnv(passwordless, {}));
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
  const allowed = new Set([
    'PATH', 'LANG', 'LC_ALL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
    'PGSSLMODE', 'PGCONNECT_TIMEOUT', 'PGTARGETSESSIONATTRS', 'PGCHANNELBINDING',
  ]);
  for (const key of Object.keys(env)) assert.ok(allowed.has(key), `unexpected variable ${key}`);
});

test('runPsql keeps the spawn contract: no credential in argv, shell false, SQL over stdin', async () => {
  const { calls, spawnFn } = makeSpawnRecorder({ stdout: 'HISTORY_OK\n' });
  const result = await runPsql({
    databaseUrl: DIRECT_URL, sql: 'SELECT 1;', psql: '/opt/custom/bin/psql', spawnFn, env: {},
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
});

test('psql failures surface exit code and SQLSTATE with the credential redacted', async () => {
  const { spawnFn } = makeSpawnRecorder({
    exitCode: 3,
    stderr: `psql: error: connection failed for ${DIRECT_URL}\n`
      + `ERROR:  duplicate key value (SQLSTATE 23505) password=${PASSWORD}\n`,
  });
  await assert.rejects(
    runPsql({ databaseUrl: DIRECT_URL, sql: 'SELECT 1;', spawnFn, env: {} }),
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

test('explicit secrets are redacted even when they defeat the generic patterns', () => {
  const plain = 'trivial';
  const safe = sanitizePsqlError(`credential ${plain} leaked`, { secrets: [plain] });
  assert.ok(!safe.includes(plain));
  assert.match(safe, /\[REDACTED_SECRET\]/);
});
