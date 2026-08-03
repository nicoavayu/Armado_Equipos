import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalJson, sha256 } from './readiness-lib.mjs';

import {
  AUTHORIZED_STAGING_REF,
  FORBIDDEN_PRODUCTION_REF,
  InspectorError,
  SUPERSEDED_PLAN_IDS,
  assertReadOnlyRole,
  assertReadOnlySql,
  assertSnapshotSanitized,
  buildDryRun,
  buildSnapshot,
  classifyEdgeFunctions,
  classifyStorageMetadata,
  formatDryRunMarkdown,
  inspectDatabase,
  loadInspectorSql,
  refreshFocalSnapshot,
  safeCliEnv,
  validateSnapshot,
  validateExecutionPlan,
  validateTarget,
} from './inspect-remote-readonly-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNTHETIC_REPOSITORY_SHA = 'a'.repeat(40);
const SQL = path.join(ROOT, 'scripts', 'torneos-staging', 'inspect-remote-readonly.sql');
const FIXTURE = path.join(ROOT, 'ops', 'torneos-staging', 'fixtures', 'remote-readonly-equivalent.json');
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const expectCode = (code, run) => assert.throws(run, (error) => (
  error instanceof InspectorError && error.code === code
));

const stagingDatabaseUrl = `postgresql://readonly.${AUTHORIZED_STAGING_REF}:fixture-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`;
const storageAdminFixture = (bucket = []) => ({
  bucket,
  rls: { enabled: true, forced: false },
  policies: [
    { name: 'team_crests_insert_owner_folder', command: 'INSERT', roles: ['authenticated'], permissive: 'PERMISSIVE', bucketScope: 'team-crests' },
    { name: 'tournament_media_service_read', command: 'SELECT', roles: ['service_role'], permissive: 'PERMISSIVE', bucketScope: 'tournament-media' },
    { name: 'tournament_media_service_insert', command: 'INSERT', roles: ['service_role'], permissive: 'PERMISSIVE', bucketScope: 'tournament-media' },
    { name: 'tournament_media_service_update', command: 'UPDATE', roles: ['service_role'], permissive: 'PERMISSIVE', bucketScope: 'deny-all' },
    { name: 'tournament_media_service_delete', command: 'DELETE', roles: ['service_role'], permissive: 'PERMISSIVE', bucketScope: 'deny-all' },
  ],
  grants: { public: [], roles: [] },
  remoteCalls: 1,
  transactionReadOnlyVerified: true,
});

test('the complete inspector SQL is named, statically read-only, and transaction guarded', () => {
  const statements = loadInspectorSql(SQL);
  assert.equal(statements.get('begin_read_only').trim(), 'BEGIN READ ONLY;');
  assert.match(statements.get('transaction_guard'), /transaction_read_only/);
  assert.ok([...statements.values()].every(assertReadOnlySql));
  assert.match(statements.get('statement_timeout'), /statement_timeout/);
  assert.match(statements.get('statement_timeout'), /'5s'/);
  assert.match(statements.get('lock_timeout'), /lock_timeout/);
  assert.match(statements.get('lock_timeout'), /'1s'/);
  assert.match(statements.get('idle_timeout'), /idle_in_transaction_session_timeout/);
  assert.match(statements.get('search_path'), /search_path/);
  assert.match(statements.get('role_privileges'), /has_schema_privilege\(current_user, namespace_row\.oid, 'USAGE'\)/);
  assert.match(statements.get('role_privileges'), /FROM pg_roles role_row\s+WHERE role_row\.rolname = current_user/);
  assert.match(statements.get('grants'), /aclexplode/);
  assert.match(statements.get('policies'), /roles::text\[\]/);
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
    ['replication', 'ROLE_PRIVILEGED'], ['inherit', 'ROLE_PRIVILEGED'],
    ['database_create', 'ROLE_WRITE_PRIVILEGE'], ['schema_create', 'ROLE_WRITE_PRIVILEGE'],
    ['relation_write', 'ROLE_WRITE_PRIVILEGE'],
  ]) {
    const row = { superuser: false, bypass_rls: false, create_role: false, create_database: false,
      replication: false, inherit: false,
      database_create: false, schema_create: false, relation_write: false, [field]: true };
    expectCode(code, () => assertReadOnlyRole(row));
  }
});

test('Supabase metadata accepts the existing CLI session without injecting a token', () => {
  assert.equal(Object.hasOwn(safeCliEnv(), 'SUPABASE_ACCESS_TOKEN'), false);
  assert.equal(safeCliEnv('fixture-token').SUPABASE_ACCESS_TOKEN, 'fixture-token');
});

test('legitimate unrelated Edge Functions are class B and do not block', () => {
  const input = fixture();
  input.metadata.functions = [
    { name: 'accept-invite', version: 5, status: 'ACTIVE', updatedAt: 1785369072971 },
    { name: 'push-sender', version: 5, status: 'ACTIVE', updatedAt: 1785369165668 },
  ];
  const classified = classifyEdgeFunctions({ repoRoot: ROOT, functions: input.metadata.functions });
  assert.ok(classified.every((item) => item.classification === 'B'));
  assert.ok(classified.every((item) => item.belongsToTorneos === false && item.collidesWithTarget === false));
  const snapshot = buildSnapshot({ repoRoot: ROOT, repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  assert.ok(!snapshot.blockers.includes('edge.unexpected_function'));
});

test('unknown Functions inside the reserved Torneos namespace remain blocking class D', () => {
  const input = fixture();
  input.metadata.functions = [
    { name: 'tournament-media-shadow', version: 1, status: 'ACTIVE', updatedAt: null },
  ];
  const classified = classifyEdgeFunctions({ repoRoot: ROOT, functions: input.metadata.functions });
  assert.equal(classified[0].classification, 'D');
  assert.equal(classified[0].belongsToTorneos, true);
  const snapshot = buildSnapshot({ repoRoot: ROOT, repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  assert.ok(snapshot.blockers.includes('edge.unexpected_function'));
});

test('signer and processor name collisions are class A and block before deployment', () => {
  const input = fixture();
  input.metadata.functions = [
    { name: 'tournament-media-signer', version: 9, status: 'ACTIVE', updatedAt: null },
    { name: 'tournament-media-processor', version: 3, status: 'ACTIVE', updatedAt: null },
  ];
  const classified = classifyEdgeFunctions({ repoRoot: ROOT, functions: input.metadata.functions });
  assert.ok(classified.every((item) => item.classification === 'A' && item.collidesWithTarget));
  const snapshot = buildSnapshot({ repoRoot: ROOT, repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  assert.ok(snapshot.blockers.includes('edge.tournament-media-signer_collision'));
  assert.ok(snapshot.blockers.includes('edge.tournament-media-processor_collision'));
  assert.ok(!snapshot.blockers.includes('edge.tournament-media-signer_absent'));
});

test('administrative Storage metadata resolves absent, compliant and noncompliant bucket states', () => {
  const absent = classifyStorageMetadata(storageAdminFixture());
  assert.equal(absent.status, 'bucket_absent');
  assert.equal(absent.exists, false);
  assert.deepEqual(absent.directWriteRoles, []);
  assert.equal(absent.policies.length, 4);
  assert.equal(absent.otherPolicies[0].bucketScope, 'team-crests');

  const compliant = classifyStorageMetadata(storageAdminFixture([{
    name: 'tournament-media', nameMatchesId: true, public: false,
    maxFileBytes: 12582912, allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png'],
    ownerConfigured: false, avifAutodetection: false, type: 'STANDARD',
  }]));
  assert.equal(compliant.status, 'bucket_present_compliant');

  const unsafeInput = storageAdminFixture([{
    name: 'tournament-media', nameMatchesId: true, public: true,
    maxFileBytes: 1, allowedMimeTypes: ['image/svg+xml'],
    ownerConfigured: true, avifAutodetection: true, type: 'STANDARD',
  }]);
  unsafeInput.policies.push({ name: 'tournament_media_client_insert', command: 'INSERT',
    roles: ['authenticated'], permissive: 'PERMISSIVE', bucketScope: 'tournament-media' });
  const noncompliant = classifyStorageMetadata(unsafeInput);
  assert.equal(noncompliant.status, 'bucket_present_noncompliant');
  assert.deepEqual(noncompliant.directWriteRoles, ['authenticated']);
  assert.ok(noncompliant.unexpectedConfiguration.includes('storage.bucket_public'));
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
  const args = { repoRoot: ROOT, repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00.000Z',
    database: input.database, metadata: input.metadata };
  const first = buildSnapshot(args);
  const second = buildSnapshot(args);
  assert.deepEqual(first, second);
  assert.equal(first.remoteCalls, 0);
  assert.equal(first.mutationsPerformed, 0);
  assert.equal(first.migrationState.remoteChecksumUnavailable, true);
  assert.equal(first.flags.remote.REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED, 'unknown');
  assert.equal(first.readiness.uploadReady, false);
  assert.ok(first.blockers.includes('storage.bucket_absent'));
  assert.equal(validateSnapshot(first), true);
});

test('focal refresh inherits sanitized non-focal evidence and counts only new remote calls', () => {
  const input = fixture();
  const prior = buildSnapshot({ repoRoot: ROOT, repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  const serialized = `${JSON.stringify(JSON.parse(canonicalJson(prior)), null, 2)}\n`;
  const refreshed = refreshFocalSnapshot({
    repoRoot: ROOT,
    repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF,
    timestamp: '2026-08-03T03:00:00Z',
    priorSnapshot: prior,
    priorSnapshotSha256: sha256(serialized),
    metadata: { functions: [{ name: 'accept-invite', version: 5, status: 'ACTIVE', updatedAt: null }],
      secretNames: [], remoteCalls: 2 },
    storageAdmin: storageAdminFixture(),
  });
  assert.equal(refreshed.remoteCalls, 3);
  assert.equal(refreshed.mutationsPerformed, 0);
  assert.equal(refreshed.storage.status, 'bucket_absent');
  assert.ok(refreshed.blockers.includes('storage.bucket_absent'));
  assert.ok(!refreshed.blockers.includes('edge.unexpected_function'));
  assert.equal(refreshed.readOnlyEvidence.storageObjectsRead, false);
});

test('RLS-filtered operational rows remain unknown instead of becoming absent or zero', () => {
  const input = fixture();
  input.database.results.tables.push(
    { schema_name: 'storage', table_name: 'buckets', rls_enabled: true, rls_forced: false },
    { schema_name: 'storage', table_name: 'objects', rls_enabled: true, rls_forced: false },
    { schema_name: 'public', table_name: 'tournament_media_assets', rls_enabled: true, rls_forced: false },
  );
  input.database.results.storage_objects = [{ total: 0, svg: 0, partial: 0, variants: 0, quarantine: 0 }];
  input.database.results.assets = [];
  const snapshot = buildSnapshot({ repoRoot: ROOT, repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  assert.equal(snapshot.storage.exists, 'unknown');
  assert.equal(snapshot.storage.objectCounts, 'unknown');
  assert.equal(snapshot.aggregates.assets, 'unknown');
  assert.ok(snapshot.blockers.includes('storage.bucket_unknown'));
  assert.ok(!snapshot.blockers.includes('storage.bucket_absent'));
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

test('dry-run reports duplicate/unexpected migration, unsafe Storage and reserved-namespace Function without mutation', () => {
  const input = fixture();
  input.database.results.migration_history.push(
    { version: '20260801090000', name: 'duplicate' },
    { version: '20990101000000', name: 'unexpected' },
  );
  input.database.results.storage_bucket = [{ bucket: 'tournament-media', public: true,
    max_file_bytes: 12582912, allowed_mime_types: ['image/jpeg'] }];
  input.database.results.policies.push({ schema_name: 'storage', table_name: 'objects',
    policy_name: 'client_write', roles: ['authenticated'], cmd: 'INSERT' });
  input.metadata.functions.push({ name: 'tournament-media-shadow', version: 1, status: 'ACTIVE', updatedAt: null });
  const snapshot = buildSnapshot({ repoRoot: ROOT, repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  const plan = buildDryRun({ repoRoot: ROOT, snapshot, repositorySha: SYNTHETIC_REPOSITORY_SHA });
  assert.deepEqual(plan.migrations.discrepancies.duplicates, ['20260801090000']);
  assert.deepEqual(plan.migrations.discrepancies.unexpectedRemote, ['20990101000000']);
  assert.ok(snapshot.blockers.includes('storage.bucket_public'));
  assert.ok(snapshot.blockers.includes('storage.client_write_open'));
  assert.ok(snapshot.blockers.includes('edge.unexpected_function'));
  assert.equal(plan.mutationsPerformed, 0);
});

test('dry-run JSON and Markdown bind the exact SHA and remain sanitized', () => {
  const input = fixture();
  const snapshot = buildSnapshot({ repoRoot: ROOT, repositorySha: SYNTHETIC_REPOSITORY_SHA,
    projectRef: AUTHORIZED_STAGING_REF, timestamp: '2026-08-03T02:00:00Z',
    database: input.database, metadata: input.metadata });
  const plan = buildDryRun({ repoRoot: ROOT, snapshot, repositorySha: SYNTHETIC_REPOSITORY_SHA });
  assert.equal(plan.migrations.pending.length, 3);
  assert.ok(plan.migrations.pending.every((item) => item.remoteChecksum === 'unverifiable'));
  const markdown = formatDryRunMarkdown(plan);
  assert.match(markdown, /Remote mutations: \*\*0\*\*/);
  assert.equal(assertSnapshotSanitized(plan), true);
  assert.equal(assertSnapshotSanitized(markdown), true);
  expectCode('REPOSITORY_DRIFT', () => buildDryRun({ repoRoot: ROOT, snapshot,
    repositorySha: '0'.repeat(40) }));
});

test('execution plans bind HEAD, manifest, migration checksums, snapshot, project, order, and expiry', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const input = fixture();
  const timestamp = new Date().toISOString();
  const snapshot = buildSnapshot({
    repoRoot: ROOT,
    repositorySha: head,
    projectRef: AUTHORIZED_STAGING_REF,
    timestamp,
    database: input.database,
    metadata: input.metadata,
  });
  const plan = buildDryRun({ repoRoot: ROOT, snapshot, repositorySha: head });
  assert.equal(validateExecutionPlan({
    repoRoot: ROOT, plan, snapshot, expectedRepositorySha: head, requireClean: false,
  }).ok, true);

  const reordered = structuredClone(plan);
  reordered.migrations.pending.reverse();
  expectCode('PLAN_PENDING_DRIFT', () => validateExecutionPlan({
    repoRoot: ROOT, plan: reordered, snapshot, expectedRepositorySha: head, requireClean: false,
  }));

  const wrongSnapshot = structuredClone(snapshot);
  wrongSnapshot.blockers.push('synthetic.drift');
  expectCode('PLAN_SNAPSHOT_DRIFT', () => validateExecutionPlan({
    repoRoot: ROOT, plan, snapshot: wrongSnapshot, expectedRepositorySha: head, requireClean: false,
  }));

  expectCode('PLAN_EXPIRED', () => validateExecutionPlan({
    repoRoot: ROOT, plan, snapshot, expectedRepositorySha: head,
    now: new Date(Date.parse(plan.expiresAt) + 1), requireClean: false,
  }));
});

test('historical pre-A1 plan is explicitly superseded before repository or network validation', () => {
  expectCode('PLAN_SUPERSEDED', () => validateExecutionPlan({
    repoRoot: ROOT,
    plan: { planId: SUPERSEDED_PLAN_IDS[0] },
    snapshot: {},
    expectedRepositorySha: '0'.repeat(40),
  }));
});
