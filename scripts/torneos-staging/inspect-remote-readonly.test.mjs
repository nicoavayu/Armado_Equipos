import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTHORIZED_STAGING_REF,
  EXPECTED_REPOSITORY_SHA,
  FORBIDDEN_PRODUCTION_REF,
  InspectorError,
  assertReadOnlyRole,
  assertReadOnlySql,
  assertSnapshotSanitized,
  buildDryRun,
  buildSnapshot,
  formatDryRunMarkdown,
  inspectDatabase,
  loadInspectorSql,
  validateSnapshot,
  validateTarget,
} from './inspect-remote-readonly-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SQL = path.join(ROOT, 'scripts', 'torneos-staging', 'inspect-remote-readonly.sql');
const FIXTURE = path.join(ROOT, 'ops', 'torneos-staging', 'fixtures', 'remote-readonly-equivalent.json');
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const expectCode = (code, run) => assert.throws(run, (error) => (
  error instanceof InspectorError && error.code === code
));

const stagingDatabaseUrl = `postgresql://readonly.${AUTHORIZED_STAGING_REF}:fixture-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`;

test('the complete inspector SQL is named, statically read-only, and transaction guarded', () => {
  const statements = loadInspectorSql(SQL);
  assert.equal(statements.get('begin_read_only').trim(), 'BEGIN READ ONLY;');
  assert.match(statements.get('transaction_guard'), /transaction_read_only/);
  assert.ok([...statements.values()].every(assertReadOnlySql));
  assert.match(statements.get('statement_timeout'), /statement_timeout/);
  assert.match(statements.get('lock_timeout'), /lock_timeout/);
  assert.match(statements.get('idle_timeout'), /idle_in_transaction_session_timeout/);
  assert.match(statements.get('search_path'), /search_path/);
});

test('DML, DDL, COPY, CALL, DO and non-allowlisted volatile functions are rejected', () => {
  for (const sql of [
    'INSERT INTO public.fixture VALUES (1);', 'UPDATE public.fixture SET value = 1;',
    'DELETE FROM public.fixture;', 'MERGE INTO public.fixture USING other ON true WHEN MATCHED THEN DELETE;',
    'CREATE TABLE public.fixture(id int);', 'ALTER TABLE public.fixture ADD COLUMN value int;',
    'DROP TABLE public.fixture;', 'TRUNCATE public.fixture;', 'GRANT SELECT ON public.fixture TO anon;',
    'REVOKE SELECT ON public.fixture FROM anon;', 'COPY public.fixture TO STDOUT;',
    'CALL public.fixture();', 'DO $$ begin null; end $$;', 'SELECT pg_sleep(1);',
    'SELECT nextval(\'fixture_seq\');',
  ]) expectCode(sql.startsWith('SELECT') ? 'SQL_FUNCTION_FORBIDDEN' : 'SQL_MUTATION_FORBIDDEN',
    () => assertReadOnlySql(sql));
});

test('authorized Staging direct and pooler URLs pass without exposing them', () => {
  assert.equal(validateTarget({ projectRef: AUTHORIZED_STAGING_REF, databaseUrl: stagingDatabaseUrl }).projectRef,
    AUTHORIZED_STAGING_REF);
  const direct = `postgresql://readonly:fixture-password@db.${AUTHORIZED_STAGING_REF}.supabase.co:5432/postgres`;
  assert.equal(validateTarget({ projectRef: AUTHORIZED_STAGING_REF, databaseUrl: direct }).databaseHostKind, 'direct');
});

test('Production, unknown refs, Production hosts and inconsistent URL/ref pairs abort', () => {
  expectCode('PRODUCTION_FORBIDDEN', () => validateTarget({
    projectRef: FORBIDDEN_PRODUCTION_REF,
    databaseUrl: `postgresql://readonly:fixture@db.${FORBIDDEN_PRODUCTION_REF}.supabase.co/postgres`,
  }));
  expectCode('PROJECT_REF_UNKNOWN', () => validateTarget({
    projectRef: 'unknownprojectfixture', databaseUrl: stagingDatabaseUrl,
  }));
  expectCode('API_URL_MISMATCH', () => validateTarget({
    projectRef: AUTHORIZED_STAGING_REF, databaseUrl: stagingDatabaseUrl,
    apiUrl: `https://${FORBIDDEN_PRODUCTION_REF}.supabase.co`,
  }));
  expectCode('PRODUCTION_FORBIDDEN', () => validateTarget({
    projectRef: AUTHORIZED_STAGING_REF,
    databaseUrl: `postgresql://readonly.${AUTHORIZED_STAGING_REF}:fixture@db.${FORBIDDEN_PRODUCTION_REF}.supabase.co/postgres`,
  }));
  expectCode('DATABASE_PROJECT_MISMATCH', () => validateTarget({
    projectRef: AUTHORIZED_STAGING_REF,
    databaseUrl: 'postgresql://readonly.otherproject:fixture@aws-0-us-east-1.pooler.supabase.com/postgres',
  }));
});

test('transaction and role guards reject any write-capable connection', () => {
  for (const [field, code] of [
    ['superuser', 'ROLE_PRIVILEGED'], ['bypass_rls', 'ROLE_PRIVILEGED'],
    ['create_role', 'ROLE_PRIVILEGED'], ['create_database', 'ROLE_PRIVILEGED'],
    ['database_create', 'ROLE_WRITE_PRIVILEGE'], ['schema_create', 'ROLE_WRITE_PRIVILEGE'],
    ['relation_write', 'ROLE_WRITE_PRIVILEGE'],
  ]) {
    const row = { superuser: false, bypass_rls: false, create_role: false, create_database: false,
      database_create: false, schema_create: false, relation_write: false, [field]: true };
    expectCode(code, () => assertReadOnlyRole(row));
  }
});

test('database inspection aborts immediately when transaction_read_only is not on', async () => {
  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql) {
      if (String(sql).includes("current_setting('transaction_read_only')")) {
        return { rows: [{ transaction_read_only: 'off' }] };
      }
      return { rows: [] };
    }
  }
  const statements = loadInspectorSql(SQL);
  await assert.rejects(
    inspectDatabase({ databaseUrl: stagingDatabaseUrl, statements, Client: FakeClient }),
    (error) => error instanceof InspectorError && error.code === 'TRANSACTION_NOT_READ_ONLY',
  );
});

test('fixture snapshot is deterministic, sanitized and explicitly zero-mutation', () => {
  const input = fixture();
  const args = { repoRoot: ROOT, repositorySha: EXPECTED_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00.000Z',
    database: input.database, metadata: input.metadata };
  const first = buildSnapshot(args);
  const second = buildSnapshot(args);
  assert.deepEqual(first, second);
  assert.equal(first.remoteCalls, 0);
  assert.equal(first.mutationsPerformed, 0);
  assert.equal(first.migrationState.remoteChecksumUnavailable, true);
  assert.equal(first.flags.remote.REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED, 'unknown');
  assert.ok(first.blockers.includes('storage.bucket_absent'));
  assert.equal(validateSnapshot(first), true);
});

test('snapshot sanitizer rejects secret values, JWTs, signed URLs, email and object paths', () => {
  const samples = [
    { secretValue: 'fixture-secret' },
    { note: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop' },
    { note: 'https://example.invalid/object?token=fixture' },
    { note: 'person@example.com' },
    { objectPath: '11111111-1111-4111-8111-111111111111/file.jpg' },
    { note: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/file.jpg' },
  ];
  for (const sample of samples) expectCode(/secretValue|objectPath/.test(Object.keys(sample)[0]) ? 'SNAPSHOT_SECRET' : 'SNAPSHOT_UNSANITIZED',
    () => assertSnapshotSanitized(sample));
});

test('dry-run reports duplicate/unexpected migration, unsafe Storage and unexpected Function without mutation', () => {
  const input = fixture();
  input.database.results.migration_history.push(
    { version: '20260801090000', name: 'duplicate' },
    { version: '20990101000000', name: 'unexpected' },
  );
  input.database.results.storage_bucket = [{ bucket: 'tournament-media', public: true,
    max_file_bytes: 12582912, allowed_mime_types: ['image/jpeg'] }];
  input.database.results.policies.push({ schema_name: 'storage', table_name: 'objects',
    policy_name: 'client_write', roles: ['authenticated'], cmd: 'INSERT' });
  input.metadata.functions.push({ name: 'unexpected-function', version: 1, status: 'ACTIVE', updatedAt: null });
  const snapshot = buildSnapshot({ repoRoot: ROOT, repositorySha: EXPECTED_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  const plan = buildDryRun({ repoRoot: ROOT, snapshot, repositorySha: EXPECTED_REPOSITORY_SHA });
  assert.deepEqual(plan.migrations.discrepancies.duplicates, ['20260801090000']);
  assert.deepEqual(plan.migrations.discrepancies.unexpectedRemote, ['20990101000000']);
  assert.ok(snapshot.blockers.includes('storage.bucket_public'));
  assert.ok(snapshot.blockers.includes('storage.client_write_open'));
  assert.ok(snapshot.blockers.includes('edge.unexpected_function'));
  assert.equal(plan.mutationsPerformed, 0);
});

test('dry-run JSON and Markdown bind the exact SHA and remain sanitized', () => {
  const input = fixture();
  const snapshot = buildSnapshot({ repoRoot: ROOT, repositorySha: EXPECTED_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  const plan = buildDryRun({ repoRoot: ROOT, snapshot, repositorySha: EXPECTED_REPOSITORY_SHA });
  assert.equal(plan.migrations.pending.length, 3);
  assert.ok(plan.migrations.pending.every((item) => item.remoteChecksum === 'unverifiable'));
  const markdown = formatDryRunMarkdown(plan);
  assert.match(markdown, /Remote mutations: \*\*0\*\*/);
  assert.equal(assertSnapshotSanitized(plan), true);
  assert.equal(assertSnapshotSanitized(markdown), true);
  expectCode('REPOSITORY_DRIFT', () => buildDryRun({ repoRoot: ROOT, snapshot,
    repositorySha: '0'.repeat(40) }));
});
