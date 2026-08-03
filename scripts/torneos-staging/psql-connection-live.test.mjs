// Live contract test: exercises the real runPsql() spawn against a real PostgreSQL server over TCP.
// It never contacts Staging or Production; the server is an ephemeral local instance.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

import { buildVerifySql, runPsql } from './single-migration-executor-lib.mjs';

const PORT = 56800 + Math.floor(Math.random() * 300);
const DATABASE = 'arma2_a1_psql_contract';
// Exercises percent-encoding end to end: these characters are illegal raw inside a URI userinfo.
const PASSWORD = 'p@ss w/ord:#1';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-a1-psql-contract-pg-'));

const EXECUTION = {
  applicationName: 'arma2-torneos-a1-migrate',
  timeouts: { lockTimeoutMs: 5000, statementTimeoutMs: 120000, idleInTransactionSessionTimeoutMs: 60000 },
};

// The keg-only Homebrew path is a local convenience, never a product constant: production callers
// pass --psql=<path>. Resolution order mirrors that contract.
const resolvePsql = () => {
  const explicit = process.env.A1_PSQL_BINARY;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const onPath = spawnSync('command', ['-v', 'psql'], { shell: true, encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim();
  for (const candidate of [
    '/opt/homebrew/opt/libpq/bin/psql',
    '/usr/local/opt/libpq/bin/psql',
    '/usr/lib/postgresql/16/bin/psql',
  ]) if (fs.existsSync(candidate)) return candidate;
  return null;
};

const PSQL = resolvePsql();
const postgres = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: PASSWORD,
  port: PORT,
  persistent: false,
  onLog: () => {},
  onError: () => {},
});

const url = (overrides = {}) => {
  const {
    user = 'postgres', password = PASSWORD, host = '127.0.0.1', port = PORT, database = DATABASE,
    query = 'sslmode=disable',
  } = overrides;
  const credential = password === null ? encodeURIComponent(user)
    : `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgresql://${credential}@${host}:${port}/${database}${query ? `?${query}` : ''}`;
};

let started = false;

test.before(async () => {
  if (!PSQL) return;
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DATABASE);
  started = true;
  const client = new pg.Client({
    host: '127.0.0.1', port: PORT, user: 'postgres', password: PASSWORD, database: DATABASE,
  });
  await client.connect();
  await client.query(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text primary key, name text, statements text[]
    );
    insert into supabase_migrations.schema_migrations(version, name)
    values ('20260801090000', 'baseline');
  `);
  await client.end();
});

test.after(async () => {
  if (started) await postgres.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const skipReason = PSQL ? false : 'psql binary unavailable; set A1_PSQL_BINARY to run this suite';

test('runPsql connects over TCP to a real server instead of the local Unix socket', { skip: skipReason },
  async () => {
    const result = await runPsql({
      databaseUrl: url(), sql: "SELECT 'LIVE_OK' AS marker;", psql: PSQL,
    });
    assert.match(result.stdout, /LIVE_OK/);
    assert.doesNotMatch(result.stdout, /\.s\.PGSQL/);
    assert.doesNotMatch(result.stderr, /\.s\.PGSQL/);
  });

test('the pre-fix contract (whole URI in PGDATABASE) fails against the very same server',
  { skip: skipReason }, () => {
    // Reproduces exactly what the epic did before this fix: libpq never expands a connection URI
    // supplied through PGDATABASE, so it treats it as a database name and falls back to the socket.
    const legacy = spawnSync(PSQL, ['-X', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--file=-'], {
      env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', PGDATABASE: url() },
      input: "SELECT 'LIVE_OK' AS marker;", encoding: 'utf8', shell: false,
    });
    assert.notEqual(legacy.status, 0, 'the legacy projection must not be able to connect');
    assert.match(legacy.stderr, /\.s\.PGSQL|could not connect|does not exist/);
    assert.doesNotMatch(String(legacy.stdout), /LIVE_OK/);
  });

test('verify-mode SQL runs read-only through the fixed connection', { skip: skipReason }, async () => {
  const result = await runPsql({
    databaseUrl: url(),
    sql: buildVerifySql({ historyAfter: ['20260801090000'], execution: EXECUTION }),
    psql: PSQL,
  });
  assert.match(result.stdout, /HISTORY_OK/);
  assert.doesNotMatch(result.stdout, /HISTORY_DRIFT/);
});

test('an explicit psql path outside PATH is honoured', { skip: skipReason }, async () => {
  const staged = path.join(DATA_DIR, 'psql-copy');
  fs.copyFileSync(PSQL, staged);
  fs.chmodSync(staged, 0o755);
  const result = await runPsql({
    databaseUrl: url(), sql: 'SELECT 1;', psql: staged,
    env: { PATH: '/nonexistent', LANG: 'C', LC_ALL: 'C' },
  });
  assert.match(result.stdout, /1/);
});

test('a wrong connection URI fails with a sanitized error that never leaks the credential',
  { skip: skipReason }, async () => {
    await assert.rejects(
      runPsql({ databaseUrl: url({ port: PORT + 137 }), sql: 'SELECT 1;', psql: PSQL }),
      (error) => {
        assert.equal(error.code, 'PSQL_FAILED');
        assert.ok(Number.isInteger(error.details.exitCode));
        for (const secret of [PASSWORD, encodeURIComponent(PASSWORD)]) {
          assert.ok(!error.details.stderr.includes(secret), 'stderr must not leak the credential');
          assert.ok(!error.message.includes(secret), 'message must not leak the credential');
        }
        return true;
      },
    );
  });

test('the credential never reaches the process arguments of a real spawn', { skip: skipReason },
  async () => {
    const seen = [];
    await runPsql({
      databaseUrl: url(),
      sql: 'SELECT 1;',
      psql: PSQL,
      spawnFn: (command, args, options) => {
        seen.push([command, ...args].join(' '));
        return spawn(command, args, options);
      },
    });
    for (const argv of seen) {
      assert.ok(!argv.includes(PASSWORD));
      assert.ok(!argv.includes(encodeURIComponent(PASSWORD)));
      assert.ok(!argv.includes('postgresql://'));
    }
  });
