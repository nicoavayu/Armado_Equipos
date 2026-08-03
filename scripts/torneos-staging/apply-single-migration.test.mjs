import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTHORIZED_STAGING_REF,
  buildDryRun,
  buildSnapshot,
} from './inspect-remote-readonly-lib.mjs';
import {
  A1_CHECKSUM,
  A1_CONFIRMATION,
  A1_FILE,
  A1_VERSION,
  PRODUCTION_GUARD_CONFIRMATION,
  SingleMigrationError,
  approvalTokenForPlan,
  buildExecutionDryRun,
  buildTransactionalSql,
  normalizeHistoryVersions,
  parseStrictArgs,
  prepareExecution,
  sanitizePsqlError,
  splitSqlStatements,
} from './single-migration-executor-lib.mjs';
import { canonicalJson, loadManifest, sha256 } from './readiness-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'ops', 'torneos-staging', 'fixtures', 'remote-readonly-equivalent.json');
const DATABASE_URL = `postgresql://readonly.${AUTHORIZED_STAGING_REF}:fixture-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`;

const expectCode = (code, run) => assert.throws(run, (error) => (
  error instanceof SingleMigrationError && error.code === code
));

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-a1-executor-test-'));
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

test('strict parser rejects duplicate flags, positional selectors, and arrays', () => {
  expectCode('ARGUMENT_DUPLICATE', () => parseStrictArgs(['--migration=a.sql', '--migration=b.sql']));
  assert.deepEqual(parseStrictArgs(['a.sql'])._, ['a.sql']);
  expectCode('ARGUMENT_FORMAT', () => parseStrictArgs(['--migration']));
});

test('A1 execution contract is prepared completely before opening a connection', () => {
  const input = makeContractFiles();
  try {
    const contract = prepareExecution({
      repoRoot: ROOT,
      options: input.options,
      env: { STAGING_MIGRATION_DATABASE_URL: DATABASE_URL },
      requireClean: false,
    });
    assert.equal(contract.expectedRepositorySha, input.head);
    assert.deepEqual(contract.historyAfter.slice(-1), [A1_VERSION]);
    assert.equal(contract.execution.timeouts.lockTimeoutMs, 5000);
  } finally {
    fs.rmSync(input.directory, { recursive: true, force: true });
  }
});

test('migration history normalization is stable for unordered strings, safe integers, and empty history', () => {
  assert.deepEqual(normalizeHistoryVersions([
    '20260801090000', 20260727090000, '20260727215106',
  ]), ['20260727090000', '20260727215106', '20260801090000']);
  assert.deepEqual(normalizeHistoryVersions([]), []);
  expectCode('MIGRATION_HISTORY_DUPLICATE', () => normalizeHistoryVersions([
    '20260801090000', '20260801090000',
  ]));
  expectCode('MIGRATION_HISTORY_INVALID', () => normalizeHistoryVersions(['not-a-version']));
});

test('unordered snapshot history is normalized before comparison without false drift', () => {
  const input = makeContractFiles();
  try {
    input.snapshot.migrationState.remoteHistory.reverse();
    input.plan = buildDryRun({ repoRoot: ROOT, snapshot: input.snapshot, repositorySha: input.head });
    fs.writeFileSync(input.options.snapshot, `${JSON.stringify(input.snapshot)}\n`, { mode: 0o600 });
    fs.writeFileSync(input.options.plan, `${JSON.stringify(input.plan)}\n`, { mode: 0o600 });
    input.options['snapshot-sha'] = sha256(canonicalJson(input.snapshot));
    input.options['plan-id'] = input.plan.planId;
    input.options['approval-token'] = approvalTokenForPlan(input.plan);
    const contract = prepareExecution({
      repoRoot: ROOT,
      options: input.options,
      env: { STAGING_MIGRATION_DATABASE_URL: DATABASE_URL },
      requireClean: false,
    });
    assert.deepEqual(contract.historyBefore, [...contract.historyBefore].sort());
  } finally {
    fs.rmSync(input.directory, { recursive: true, force: true });
  }
});

test('duplicate or unexpected snapshot history aborts before connection', () => {
  for (const kind of ['duplicate', 'unexpected']) {
    const input = makeContractFiles();
    try {
      if (kind === 'duplicate') {
        input.snapshot.migrationState.remoteHistory.push(
          structuredClone(input.snapshot.migrationState.remoteHistory[0]),
        );
        input.snapshot.migrationState.duplicates = [input.snapshot.migrationState.remoteHistory[0].version];
      } else {
        input.snapshot.migrationState.remoteHistory.push({
          version: '20990101000000', name: 'unexpected', checksum: null,
        });
        input.snapshot.migrationState.remoteVersionsMissingLocally = ['20990101000000'];
      }
      input.plan = buildDryRun({ repoRoot: ROOT, snapshot: input.snapshot, repositorySha: input.head });
      fs.writeFileSync(input.options.snapshot, `${JSON.stringify(input.snapshot)}\n`, { mode: 0o600 });
      fs.writeFileSync(input.options.plan, `${JSON.stringify(input.plan)}\n`, { mode: 0o600 });
      input.options['snapshot-sha'] = sha256(canonicalJson(input.snapshot));
      input.options['plan-id'] = input.plan.planId;
      input.options['approval-token'] = approvalTokenForPlan(input.plan);
      expectCode(kind === 'duplicate' ? 'MIGRATION_HISTORY_DUPLICATE' : 'MIGRATION_HISTORY_UNEXPECTED',
        () => prepareExecution({
          repoRoot: ROOT,
          options: input.options,
          env: { STAGING_MIGRATION_DATABASE_URL: DATABASE_URL },
          requireClean: false,
        }));
    } finally {
      fs.rmSync(input.directory, { recursive: true, force: true });
    }
  }
});

test('directories, globs, ranges, other migrations, two migrations, and all-pending abort', () => {
  for (const value of [
    'supabase/migrations',
    'supabase/migrations/*.sql',
    '20260802090000:20260802120000',
    'supabase/migrations/20260802120000_tournament_media_trusted_processing.sql',
    `${A1_FILE},supabase/migrations/20260802120000_tournament_media_trusted_processing.sql`,
    'all',
  ]) {
    const input = makeContractFiles();
    try {
      input.options.migration = value;
      assert.throws(() => prepareExecution({
        repoRoot: ROOT,
        options: input.options,
        env: { STAGING_MIGRATION_DATABASE_URL: DATABASE_URL },
        requireClean: false,
      }), (error) => error instanceof SingleMigrationError
        && ['MIGRATION_SELECTION', 'MIGRATION_NOT_AUTHORIZED'].includes(error.code));
    } finally {
      fs.rmSync(input.directory, { recursive: true, force: true });
    }
  }
});

test('wrong checksum, SHA, Production ref, or approval aborts before connection', () => {
  for (const [field, value, code] of [
    ['migration-checksum', '0'.repeat(64), 'MIGRATION_CHECKSUM'],
    ['expected-repository-sha', '0'.repeat(40), 'REPOSITORY_DRIFT'],
    ['project-ref', 'rcyuuoaqfwcembdajcss', 'PRODUCTION_FORBIDDEN'],
    ['approval-token', '0'.repeat(64), 'APPROVAL_TOKEN'],
    ['approval-token', '', 'APPROVAL_TOKEN'],
  ]) {
    const input = makeContractFiles();
    try {
      input.options[field] = value;
      assert.throws(() => prepareExecution({
        repoRoot: ROOT,
        options: input.options,
        env: { STAGING_MIGRATION_DATABASE_URL: DATABASE_URL },
        requireClean: false,
      }), (error) => error?.code === code);
    } finally {
      fs.rmSync(input.directory, { recursive: true, force: true });
    }
  }
});

test('generated psql input is singular, transactional, ON_ERROR_STOP-compatible, and records A1 before COMMIT', () => {
  const manifest = loadManifest(ROOT);
  const migrationSql = fs.readFileSync(path.join(ROOT, A1_FILE), 'utf8');
  const sql = buildTransactionalSql({
    migrationSql,
    execution: manifest.migrationPolicy.migrations[0].execution,
    historyBefore: ['20260801090000'],
    historyAfter: ['20260801090000', A1_VERSION],
  });
  const executable = sql.replace(/\$arma2_a1_canonical_sql\$[\s\S]*?\$arma2_a1_canonical_sql\$/g, "''");
  assert.equal((executable.match(/^\s*BEGIN\s*;/gim) || []).length, 1);
  assert.equal((executable.match(/^\s*COMMIT\s*;/gim) || []).length, 1);
  assert.match(sql, /SET LOCAL lock_timeout = '5000ms'/);
  assert.match(sql, /SET LOCAL statement_timeout = '120000ms'/);
  assert.match(sql, /SET LOCAL idle_in_transaction_session_timeout = '60000ms'/);
  assert.match(sql, /SET LOCAL application_name = 'arma2-torneos-a1-migrate'/);
  assert.match(sql, /LOCK TABLE supabase_migrations\.schema_migrations IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(sql, /VALUES \('20260802090000', 'tournament_media_upload_pipeline'/);
  assert.ok(sql.indexOf("VALUES ('20260802090000'") < sql.lastIndexOf('COMMIT;'));
  assert.doesNotMatch(sql, /20260802120000_tournament_media_trusted_processing/);
  assert.doesNotMatch(sql, /20260803090000_tournament_social_studio/);
  assert.match(sql, /A1 already applied/);
  const canonicalBody = migrationSql.slice(
    migrationSql.match(/^\s*BEGIN\s*;\s*$/im).index
      + migrationSql.match(/^\s*BEGIN\s*;\s*$/im)[0].length,
    migrationSql.match(/^\s*COMMIT\s*;\s*$/im).index,
  );
  assert.equal(sql.split(canonicalBody).length, 2,
    'removing the canonical COMMIT and inserting history must not alter the A1 body');
  assert.equal(sha256(fs.readFileSync(path.join(ROOT, A1_FILE))), A1_CHECKSUM);
});

test('history registration uses the Supabase CLI-compatible parsed statement array', () => {
  const manifest = loadManifest(ROOT);
  const migrationSql = fs.readFileSync(path.join(ROOT, A1_FILE), 'utf8');
  const statements = splitSqlStatements(migrationSql);
  assert.ok(statements.length > 10);
  assert.match(statements[0], /^-- Arma2 Torneos[\s\S]*\bBEGIN$/);
  assert.equal(statements.at(-1), 'COMMIT');
  const sql = buildTransactionalSql({
    migrationSql,
    execution: manifest.migrationPolicy.migrations[0].execution,
    historyBefore: ['20260801090000'],
    historyAfter: [A1_VERSION, '20260801090000'],
  });
  const delimiters = sql.match(/\$arma2_a1_canonical_sql\$/g) || [];
  assert.equal(delimiters.length, statements.length * 2);
  assert.match(sql, /ARRAY\[\$arma2_a1_canonical_sql\$/);
});

test('executor dry-run validates the exact contract without a database URL or persisted approval token', () => {
  const input = makeContractFiles();
  try {
    delete input.options.confirmation;
    delete input.options['approval-token'];
    const contract = prepareExecution({
      repoRoot: ROOT,
      options: input.options,
      env: {},
      requireClean: false,
      requireApproval: false,
      requireDatabaseUrl: false,
    });
    const preview = buildExecutionDryRun(contract);
    assert.equal(preview.operation, 'would-apply-single-migration');
    assert.equal(preview.migration.file, A1_FILE);
    assert.equal(preview.migration.selectionCount, 1);
    assert.equal(preview.shell, false);
    assert.equal(preview.sqlTransport, 'stdin');
    assert.equal(preview.databaseUrlInArguments, false);
    assert.match(preview.approval.expectedTokenSha256, /^[0-9a-f]{64}$/);
    assert.equal(preview.approval.persisted, false);
    assert.equal(preview.mutationsPerformed, 0);
  } finally {
    fs.rmSync(input.directory, { recursive: true, force: true });
  }
});

test('psql errors preserve SQLSTATE and technical context while redacting secrets and sensitive paths', () => {
  const unsafe = [
    'ERROR SQLSTATE 23505 duplicate key',
    'postgresql://postgres:super-secret@db.example.invalid:5432/postgres?token=value',
    'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signaturevalue',
    'https://example.invalid/path?access_token=hidden',
    'rcyuuoaqfwcembdajcss',
    '/Users/private-owner/projects/secret.sql',
    `password=${'x'.repeat(3000)}`,
  ].join('\n');
  const safe = sanitizePsqlError(unsafe);
  assert.match(safe, /SQLSTATE 23505/);
  assert.match(safe, /duplicate key/);
  assert.ok(safe.length <= 2000);
  for (const forbidden of [
    'super-secret', 'signaturevalue', 'access_token=hidden',
    'rcyuuoaqfwcembdajcss', '/Users/private-owner', 'x'.repeat(100),
  ]) assert.doesNotMatch(safe, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('missing, zero, negative, alternate, or over-limit timeouts abort SQL construction', () => {
  const manifest = loadManifest(ROOT);
  const migrationSql = fs.readFileSync(path.join(ROOT, A1_FILE), 'utf8');
  for (const [field, value] of [
    ['lockTimeoutMs', undefined], ['lockTimeoutMs', 0], ['lockTimeoutMs', -1],
    ['lockTimeoutMs', 4999], ['lockTimeoutMs', 10001],
    ['statementTimeoutMs', 119999], ['statementTimeoutMs', 300001],
    ['idleInTransactionSessionTimeoutMs', 59999], ['idleInTransactionSessionTimeoutMs', 120001],
  ]) {
    const execution = structuredClone(manifest.migrationPolicy.migrations[0].execution);
    if (value === undefined) delete execution.timeouts[field];
    else execution.timeouts[field] = value;
    expectCode('MIGRATION_TIMEOUT', () => buildTransactionalSql({
      migrationSql,
      execution,
      historyBefore: [],
      historyAfter: [A1_VERSION],
    }));
  }
});
