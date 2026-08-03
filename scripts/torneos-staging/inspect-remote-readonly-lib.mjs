import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { analyzeSql, canonicalJson, loadManifest, sha256 } from './readiness-lib.mjs';

export const AUTHORIZED_STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
export const FORBIDDEN_PRODUCTION_REF = 'rcyuuoaqfwcembdajcss';
export const EXPECTED_REPOSITORY_SHA = '93225cae8fde398e1c73b8a9e077325bda6d450d';

export class InspectorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InspectorError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => { throw new InspectorError(code, message, details); };
const assert = (condition, code, message, details) => {
  if (!condition) fail(code, message, details);
};

const REQUIRED_TABLES = Object.freeze({
  migration_history: 'supabase_migrations.schema_migrations',
  storage_bucket: 'storage.buckets',
  storage_objects: 'storage.objects',
  attestations: 'public.tournament_media_service_attestations',
  jobs: 'public.tournament_media_processing_jobs',
  sessions: 'public.tournament_media_upload_sessions',
  assets: 'public.tournament_media_assets',
  variants: 'public.tournament_media_variants',
  social_permissions: 'public.tournament_social_permissions',
});

const SAFE_FUNCTIONS = new Set([
  'coalesce', 'count', 'current_database', 'current_setting', 'extract',
  'has_database_privilege', 'has_schema_privilege', 'has_table_privilege',
  'lower', 'max', 'now', 'pg_get_function_identity_arguments',
  'tournament_media_pipeline_readiness',
]);

const stripSqlForAnalysis = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--.*$/gm, ' ')
  .replace(/'(?:''|[^'])*'/g, "''")
  .replace(/"(?:""|[^"])*"/g, '""');

export function assertReadOnlySql(sql) {
  const normalized = stripSqlForAnalysis(sql);
  const forbidden = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|REFRESH|REINDEX|CLUSTER|COMMENT|SECURITY\s+LABEL)\b/i;
  const match = normalized.match(forbidden);
  assert(!match, 'SQL_MUTATION_FORBIDDEN', `SQL contains forbidden keyword ${match?.[1] || ''}.`);

  const trimmed = normalized.trim();
  const permittedControl = /^(?:BEGIN\s+READ\s+ONLY|COMMIT)$/i.test(trimmed.replace(/;\s*$/, ''));
  const permittedSet = /^SET\s+LOCAL\s+(?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout|search_path)\s*=/i.test(trimmed);
  assert(/^SELECT\b/i.test(trimmed) || permittedControl || permittedSet,
    'SQL_STATEMENT_FORBIDDEN', 'Only SELECT, BEGIN READ ONLY, approved SET LOCAL, and COMMIT are allowed.');

  if (/^SELECT\b/i.test(trimmed)) {
    const calls = [...normalized.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)]
      .map((item) => item[1].toLowerCase())
      .filter((name) => !['and', 'case', 'exists', 'filter', 'from', 'in', 'not', 'or', 'when', 'where'].includes(name));
    const unexpected = [...new Set(calls.filter((name) => !SAFE_FUNCTIONS.has(name)))];
    assert(unexpected.length === 0, 'SQL_FUNCTION_FORBIDDEN',
      `SQL calls a non-allowlisted function: ${unexpected.join(', ')}.`, { unexpected });
  }
  return true;
}

export function parseNamedSql(sql) {
  const marker = /^-- inspector:statement ([a-z0-9_]+)\s*$/gm;
  const matches = [...sql.matchAll(marker)];
  assert(matches.length > 0, 'SQL_SECTIONS_MISSING', 'Inspector SQL has no named statements.');
  const statements = new Map();
  for (const [index, match] of matches.entries()) {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? sql.length;
    const statement = sql.slice(start, end).trim();
    assert(statement.endsWith(';'), 'SQL_TERMINATOR', `Statement ${match[1]} must end with a semicolon.`);
    assert(!statements.has(match[1]), 'SQL_SECTION_DUPLICATE', `Duplicate SQL statement ${match[1]}.`);
    assertReadOnlySql(statement);
    statements.set(match[1], statement);
  }
  return statements;
}

export function loadInspectorSql(sqlFile) {
  return parseNamedSql(fs.readFileSync(sqlFile, 'utf8'));
}

export function validateTarget({ projectRef, databaseUrl, apiUrl = `https://${projectRef}.supabase.co` }) {
  assert(projectRef !== FORBIDDEN_PRODUCTION_REF, 'PRODUCTION_FORBIDDEN', 'Production project ref is forbidden.');
  assert(projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN', 'Project ref is not the authorized Staging project.');

  let parsedApi;
  try { parsedApi = new URL(apiUrl); } catch { fail('API_URL_INVALID', 'Staging API URL is invalid.'); }
  assert(parsedApi.protocol === 'https:' && parsedApi.hostname === `${AUTHORIZED_STAGING_REF}.supabase.co`
    && parsedApi.port === '' && ['', '/'].includes(parsedApi.pathname)
    && !parsedApi.username && !parsedApi.password && !parsedApi.search && !parsedApi.hash,
  'API_URL_MISMATCH', 'API URL does not belong to the authorized Staging project.');

  let parsedDatabase;
  try { parsedDatabase = new URL(databaseUrl); } catch { fail('DATABASE_URL_INVALID', 'STAGING_READONLY_DATABASE_URL is not a valid URL.'); }
  assert(['postgres:', 'postgresql:'].includes(parsedDatabase.protocol),
    'DATABASE_URL_INVALID', 'STAGING_READONLY_DATABASE_URL must use PostgreSQL.');
  const host = parsedDatabase.hostname.toLowerCase();
  const username = decodeURIComponent(parsedDatabase.username || '').toLowerCase();
  assert(!host.includes(FORBIDDEN_PRODUCTION_REF) && !username.includes(FORBIDDEN_PRODUCTION_REF),
    'PRODUCTION_FORBIDDEN', 'PostgreSQL URL resolves to Production.');
  const direct = host === `db.${AUTHORIZED_STAGING_REF}.supabase.co`;
  const pooler = host.endsWith('.pooler.supabase.com')
    && (username === `postgres.${AUTHORIZED_STAGING_REF}` || username.endsWith(`.${AUTHORIZED_STAGING_REF}`));
  assert(direct || pooler, 'DATABASE_PROJECT_MISMATCH',
    'PostgreSQL host and user do not prove membership in the authorized Staging project.');
  assert(parsedDatabase.password, 'DATABASE_CREDENTIAL_MISSING',
    'STAGING_READONLY_DATABASE_URL must include its independent read-only credential.');
  return { projectRef, apiHost: parsedApi.hostname, databaseHostKind: direct ? 'direct' : 'pooler' };
}

const normalizeCell = (value) => {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeCell);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeCell(child)]));
  }
  if (typeof value === 'string' && /^\d+$/.test(value) && value.length < 15) return Number(value);
  return value;
};

const normalizeRows = (rows = []) => rows.map((row) => normalizeCell(row));

export function assertReadOnlyRole(row) {
  assert(row, 'ROLE_INSPECTION_FAILED', 'Could not inspect the connected PostgreSQL role.');
  assert(row.superuser === false, 'ROLE_PRIVILEGED', 'Read-only role must not be superuser.');
  assert(row.bypass_rls === false, 'ROLE_PRIVILEGED', 'Read-only role must not bypass RLS.');
  assert(row.create_role === false && row.create_database === false,
    'ROLE_PRIVILEGED', 'Read-only role must not create roles or databases.');
  assert(row.database_create === false && row.schema_create === false,
    'ROLE_WRITE_PRIVILEGE', 'Read-only role has CREATE privilege.');
  assert(row.relation_write === false, 'ROLE_WRITE_PRIVILEGE',
    'Read-only role has INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER privilege.');
  return {
    verified: true,
    superuser: false,
    bypassRls: false,
    create: false,
    relationWrite: false,
  };
}

const tableSet = (rows) => new Set(rows.map((row) => `${row.schema_name}.${row.table_name}`));

export async function inspectDatabase({ databaseUrl, statements, Client }) {
  const client = new Client({ connectionString: databaseUrl, application_name: 'arma2-torneos-readonly-inspector' });
  const results = {};
  let remoteCalls = 0;
  let transactionOpen = false;
  try {
    await client.connect();
    remoteCalls += 1;
    for (const name of ['begin_read_only', 'statement_timeout', 'lock_timeout', 'idle_timeout', 'search_path']) {
      await client.query(statements.get(name));
      remoteCalls += 1;
      if (name === 'begin_read_only') transactionOpen = true;
    }
    const transaction = await client.query(statements.get('transaction_guard'));
    remoteCalls += 1;
    assert(transaction.rows[0]?.transaction_read_only === 'on', 'TRANSACTION_NOT_READ_ONLY',
      'PostgreSQL did not enter a read-only transaction.');

    const role = await client.query(statements.get('role_privileges'));
    remoteCalls += 1;
    results.role = assertReadOnlyRole(role.rows[0]);

    for (const name of ['tables', 'columns', 'functions', 'grants', 'policies', 'indexes', 'triggers', 'constraints']) {
      const response = await client.query(statements.get(name));
      remoteCalls += 1;
      results[name] = normalizeRows(response.rows);
    }
    const existing = tableSet(results.tables);
    for (const [name, requiredTable] of Object.entries(REQUIRED_TABLES)) {
      if (!existing.has(requiredTable)) {
        results[name] = [];
        continue;
      }
      const response = await client.query(statements.get(name));
      remoteCalls += 1;
      results[name] = normalizeRows(response.rows);
    }
    const readinessFunction = results.functions.find((item) => (
      item.function_name === 'tournament_media_pipeline_readiness'
      && item.volatility !== 'v'
    ));
    if (readinessFunction) {
      const response = await client.query(statements.get('readiness'));
      remoteCalls += 1;
      results.readiness = normalizeRows(response.rows);
    } else results.readiness = [];

    await client.query(statements.get('commit_read_only'));
    remoteCalls += 1;
    transactionOpen = false;
    return { results, remoteCalls, transactionReadOnlyVerified: true };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
    }
    if (error instanceof InspectorError) throw error;
    fail('DATABASE_INSPECTION_FAILED', 'Read-only database inspection failed. No credential or query text was logged.');
  } finally {
    try { await client.end(); } catch { /* no-op */ }
  }
}

const safeCliEnv = (accessToken) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  SUPABASE_ACCESS_TOKEN: accessToken,
  NO_COLOR: '1',
});

const runSupabaseJson = ({ cli = 'supabase', args, accessToken }) => {
  try {
    const raw = execFileSync(cli, args, {
      encoding: 'utf8', env: safeCliEnv(accessToken), stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(raw);
  } catch {
    fail('SUPABASE_METADATA_FAILED', 'Supabase read-only metadata listing failed; output was suppressed to protect credentials.');
  }
};

const asArray = (value) => Array.isArray(value) ? value : (Array.isArray(value?.data) ? value.data : []);

export function inspectSupabaseMetadata({ accessToken, projectRef, cli = 'supabase' }) {
  assert(accessToken, 'CREDENTIAL_MISSING', 'Missing required environment variable SUPABASE_ACCESS_TOKEN.');
  assert(projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN', 'Metadata target is not authorized Staging.');
  const functionsRaw = runSupabaseJson({
    cli, accessToken,
    args: ['functions', 'list', '--project-ref', projectRef, '-o', 'json'],
  });
  const secretsRaw = runSupabaseJson({
    cli, accessToken,
    args: ['secrets', 'list', '--project-ref', projectRef, '-o', 'json'],
  });
  const functions = asArray(functionsRaw).map((item) => ({
    name: String(item.name || item.slug || ''),
    version: item.version ?? null,
    status: item.status ?? null,
    updatedAt: item.updated_at || item.updatedAt || null,
  })).filter((item) => item.name).sort((a, b) => a.name.localeCompare(b.name));
  const secretNames = asArray(secretsRaw).map((item) => String(item.name || ''))
    .filter(Boolean).sort();
  return { functions, secretNames, remoteCalls: 2 };
}

const safeName = (value) => (/^[a-zA-Z0-9_.:-]{1,120}$/.test(String(value || '')) ? String(value) : null);
const safeEvidenceValue = (value) => (/^[a-zA-Z0-9_.:+ -]{1,120}$/.test(String(value || '')) ? String(value) : null);
const safeTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
};

const sanitizeAttestations = (rows) => rows.map((row) => {
  const envelope = row.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {};
  const capabilities = envelope.capabilities && typeof envelope.capabilities === 'object'
    ? envelope.capabilities : {};
  const evidence = envelope.evidence && typeof envelope.evidence === 'object' ? envelope.evidence : {};
  const booleanCapabilities = Object.fromEntries(Object.entries(capabilities)
    .filter(([key, value]) => safeName(key) && typeof value === 'boolean')
    .map(([key, value]) => [key, value]));
  const evidenceAllowlist = new Set([
    'workerType', 'antivirusVersion', 'signatureAgeDays', 'codec', 'libvips',
    'cleanup', 'backendFingerprint', 'contentSniffing', 'checksumVerification',
  ]);
  const safeEvidence = Object.fromEntries(Object.entries(evidence)
    .filter(([key, value]) => evidenceAllowlist.has(key)
      && (typeof value === 'boolean' || typeof value === 'number' || safeEvidenceValue(value)))
    .map(([key, value]) => [key, value]));
  return {
    service: safeName(row.service),
    attestedAt: safeTimestamp(row.attested_at),
    expiresAt: safeTimestamp(row.expires_at),
    capabilities: booleanCapabilities,
    evidence: safeEvidence,
  };
}).filter((item) => item.service);

const sanitizeReadiness = (row) => {
  const source = row?.readiness && typeof row.readiness === 'object' ? row.readiness : {};
  const allowed = new Set([
    'uploadReady', 'storageReady', 'signerReady', 'processorReady', 'pixelDecodeReady',
    'pixelTranscodeReady', 'metadataSanitizationReady', 'antivirusReady', 'cleanupReady',
  ]);
  const result = Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => allowed.has(key) && typeof value === 'boolean'));
  result.blockers = Array.isArray(source.blockers)
    ? source.blockers.map(safeName).filter(Boolean).sort() : [];
  return result;
};

export function localMigrationInventory(repoRoot) {
  const directory = path.join(repoRoot, 'supabase', 'migrations');
  return fs.readdirSync(directory).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort()
    .map((name) => ({
      version: name.slice(0, 14), name: name.slice(15, -4),
      file: `supabase/migrations/${name}`,
      sha256: sha256(fs.readFileSync(path.join(directory, name))),
    }));
}

const directoryDigest = (directory) => {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push([path.relative(directory, absolute), fs.readFileSync(absolute)]);
    }
  };
  visit(directory);
  const digest = crypto.createHash('sha256');
  for (const [name, content] of files) digest.update(name).update('\0').update(content).update('\0');
  return digest.digest('hex');
};

export function buildSnapshot({ repoRoot, repositorySha, projectRef, timestamp, database, metadata }) {
  assert(repositorySha === EXPECTED_REPOSITORY_SHA, 'REPOSITORY_DRIFT', 'Snapshot must bind the exact authorized epic SHA.');
  assert(projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN', 'Snapshot project is not authorized Staging.');
  const localMigrations = localMigrationInventory(repoRoot);
  const localByVersion = new Map(localMigrations.map((item) => [item.version, item]));
  const remoteHistory = (database.results.migration_history || []).map((item) => ({
    version: String(item.version), name: safeName(item.name), checksum: null,
  }));
  const versions = remoteHistory.map((item) => item.version);
  const duplicates = [...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))].sort();
  const remoteSet = new Set(versions);
  const expectedFunctions = [
    ['tournament-media-signer', 'supabase/functions/tournament-media-signer'],
    ['tournament-media-processor', 'supabase/functions/tournament-media-processor'],
  ];
  const functions = metadata.functions.map((item) => {
    const local = expectedFunctions.find(([name]) => name === item.name);
    return { ...item, localSha256: local ? directoryDigest(path.join(repoRoot, local[1])) : null,
      remoteContentVerifiable: false };
  });
  const expectedSecrets = [
    'TOURNAMENT_MEDIA_ATTESTATION_SECRET', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY',
  ];
  const secretSet = new Set(metadata.secretNames);
  const storageBucket = database.results.storage_bucket?.[0] || null;
  const policies = database.results.policies || [];
  const directWriteRoles = [...new Set(policies
    .filter((item) => item.schema_name === 'storage' && item.table_name === 'objects'
      && ['INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(String(item.cmd).toUpperCase()))
    .flatMap((item) => item.roles || [])
    .filter((role) => ['PUBLIC', 'anon', 'authenticated'].includes(role)))].sort();
  const readiness = sanitizeReadiness(database.results.readiness?.[0]);
  const expectedFunctionSet = new Set(expectedFunctions.map(([name]) => name));
  const actualFunctionSet = new Set(functions.map((item) => item.name));
  const blockers = [...new Set([
    ...readiness.blockers,
    ...(!storageBucket ? ['storage.bucket_absent'] : []),
    ...(storageBucket?.public ? ['storage.bucket_public'] : []),
    ...(directWriteRoles.length ? ['storage.client_write_open'] : []),
    ...expectedFunctions.filter(([name]) => !actualFunctionSet.has(name)).map(([name]) => `edge.${name}_absent`),
    ...functions.filter((item) => !expectedFunctionSet.has(item.name)).map(() => 'edge.unexpected_function'),
    ...(!readiness.uploadReady ? ['readiness.upload_not_ready'] : []),
    ...(duplicates.length ? ['migrations.duplicate_history'] : []),
    ...remoteHistory.filter((item) => !localByVersion.has(item.version)).map(() => 'migrations.remote_missing_locally'),
  ])].sort();
  const snapshot = {
    schemaVersion: 1,
    repositorySha,
    projectRef,
    timestamp: new Date(timestamp).toISOString(),
    migrationState: {
      schema: 'supabase_migrations',
      remoteHistory,
      remoteChecksumUnavailable: true,
      local: localMigrations,
      appliedLocalVersions: localMigrations.filter((item) => remoteSet.has(item.version)).map((item) => item.version),
      pendingLocalVersions: localMigrations.filter((item) => !remoteSet.has(item.version)).map((item) => item.version),
      remoteVersionsMissingLocally: remoteHistory.filter((item) => !localByVersion.has(item.version)).map((item) => item.version),
      duplicates,
    },
    schemaState: {
      tables: database.results.tables,
      columns: database.results.columns,
      functions: (database.results.functions || []).map((item) => ({
        ...item,
        settings: (item.settings || []).filter((setting) => String(setting).startsWith('search_path=')),
      })),
      grants: database.results.grants,
      rls: database.results.policies,
      indexes: database.results.indexes,
      triggers: database.results.triggers,
      constraints: database.results.constraints,
    },
    storage: {
      exists: Boolean(storageBucket),
      bucket: storageBucket ? {
        name: storageBucket.bucket, public: storageBucket.public,
        maxFileBytes: storageBucket.max_file_bytes,
        allowedMimeTypes: storageBucket.allowed_mime_types || [],
      } : null,
      policies: policies.filter((item) => item.schema_name === 'storage'),
      directWriteRoles,
      objectCounts: database.results.storage_objects?.[0] || { total: 0, svg: 0, partial: 0, variants: 0, quarantine: 0 },
    },
    edgeFunctions: functions,
    secrets: expectedSecrets.map((name) => ({ name, present: secretSet.has(name) })),
    aggregates: {
      jobs: database.results.jobs || [], sessions: database.results.sessions || [],
      assets: database.results.assets || [], variants: database.results.variants || [],
      socialPermissions: database.results.social_permissions?.[0]?.count ?? null,
    },
    workerAttestations: sanitizeAttestations(database.results.attestations || []),
    readiness,
    flags: {
      repositoryContract: {
        productionForcedFalse: true,
        REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: false,
        REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: false,
        dependencies: ['mediaUpload requires media + operational readiness', 'social enablement follows Multimedia QA'],
      },
      remote: {
        REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED: 'unknown',
        REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'unknown',
      },
    },
    blockers,
    limitations: [
      'Remote migration history does not expose checksums; only local checksums were calculated.',
      'Edge Functions metadata does not expose deployed source content; remote content was not checksum-verified.',
      'Frontend deployment flags were not queried from Vercel and remain unknown.',
      'No external worker runtime or mutating health endpoint was contacted.',
    ],
    readOnlyEvidence: {
      transactionReadOnlyVerified: database.transactionReadOnlyVerified,
      role: database.results.role,
      commands: ['PostgreSQL SELECT inside BEGIN READ ONLY', 'supabase functions list', 'supabase secrets list'],
      queryErrorsAbortTransaction: true,
      ddlStatements: 0, dmlStatements: 0,
    },
    remoteCalls: database.remoteCalls + metadata.remoteCalls,
    mutationsPerformed: 0,
  };
  assertSnapshotSanitized(snapshot);
  return snapshot;
}

const forbiddenKey = /^(?:password|token|jwt|apiKey|connectionString|databaseUrl|signedUrl|objectPath|originalFileName|payload|editorialContent|email|secretValue)$/i;
const forbiddenValuePatterns = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /(?:postgres(?:ql)?|https?):\/\/[^\s]+/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  /(?:^|\/)[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\//i,
  /[?&](?:token|signature|sig)=/i,
];

export function assertSnapshotSanitized(value, currentKey = '') {
  assert(!forbiddenKey.test(currentKey), 'SNAPSHOT_SECRET', `Snapshot contains forbidden key ${currentKey}.`);
  if (typeof value === 'string') {
    for (const pattern of forbiddenValuePatterns) {
      assert(!pattern.test(value), 'SNAPSHOT_UNSANITIZED', `Snapshot value matched forbidden pattern ${pattern}.`);
    }
  } else if (Array.isArray(value)) {
    for (const child of value) assertSnapshotSanitized(child, currentKey);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertSnapshotSanitized(child, key);
  }
  return true;
}

export function validateSnapshot(snapshot) {
  assert(snapshot?.schemaVersion === 1, 'SNAPSHOT_SCHEMA', 'Unsupported snapshot schemaVersion.');
  assert(snapshot.repositorySha === EXPECTED_REPOSITORY_SHA, 'REPOSITORY_DRIFT', 'Snapshot repository SHA differs.');
  assert(snapshot.projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN', 'Snapshot project differs.');
  assert(snapshot.mutationsPerformed === 0, 'SNAPSHOT_MUTATION', 'Snapshot reports remote mutations.');
  assert(typeof snapshot.remoteCalls === 'number' && snapshot.remoteCalls >= 0,
    'SNAPSHOT_SCHEMA', 'Snapshot remoteCalls must be a non-negative number.');
  assertSnapshotSanitized(snapshot);
  return true;
}

export function buildDryRun({ repoRoot, snapshot, repositorySha }) {
  validateSnapshot(snapshot);
  assert(repositorySha === EXPECTED_REPOSITORY_SHA && snapshot.repositorySha === repositorySha,
    'REPOSITORY_DRIFT', 'Dry-run SHA must exactly match the snapshot and authorized epic.');
  const manifest = loadManifest(repoRoot);
  const applied = new Set(snapshot.migrationState.remoteHistory.map((item) => item.version));
  const migrations = manifest.migrationPolicy.migrations
    .filter((item) => !applied.has(item.version))
    .map((item) => {
      const sql = fs.readFileSync(path.join(repoRoot, item.file), 'utf8');
      return { order: item.order, version: item.version, file: item.file,
        localSha256: item.sha256, remoteChecksum: 'unverifiable', dependencies: item.order === 1 ? [] : [manifest.migrationPolicy.migrations[item.order - 2].version],
        affected: analyzeSql(sql), locks: item.expectedLocks, risk: item.risk, rollback: item.rollback };
    });
  const expectedPolicyNames = manifest.storage.policies;
  const actualPolicies = snapshot.storage.policies.map((item) => item.policy_name);
  const expectedFunctions = manifest.edgeFunctions.map((item) => item.name);
  const actualFunctions = snapshot.edgeFunctions.map((item) => item.name);
  const missingSecrets = manifest.configuration.secretAlternatives
    .filter((group) => !group.some((name) => snapshot.secrets.some((item) => item.name === name && item.present)));
  const core = {
    schemaVersion: 1, repositorySha, projectRef: snapshot.projectRef,
    snapshotSha256: sha256(canonicalJson(snapshot)), mutationsPerformed: 0,
    migrations: {
      pending: migrations,
      discrepancies: {
        duplicates: snapshot.migrationState.duplicates,
        unexpectedRemote: snapshot.migrationState.remoteVersionsMissingLocally,
        remoteChecksumUnavailable: snapshot.migrationState.remoteChecksumUnavailable,
      },
    },
    storage: {
      current: snapshot.storage,
      requiredOperation: !snapshot.storage.exists ? 'create private bucket only after separate approval'
        : 'reconcile contract differences only after separate approval',
      missingPolicies: expectedPolicyNames.filter((name) => !actualPolicies.includes(name)),
      unexpectedPolicies: actualPolicies.filter((name) => !expectedPolicyNames.includes(name)),
      risk: 'bucket or policy changes can expose or block media access',
      rollback: 'restore captured bucket configuration and exact prior policies under separate approval',
    },
    edge: {
      present: actualFunctions, missing: expectedFunctions.filter((name) => !actualFunctions.includes(name)),
      order: expectedFunctions, missingSecretAlternatives: missingSecrets,
      healthPending: true,
      rollback: 'restore the recorded previous release; revoke attestations only under separate approval',
    },
    worker: {
      attestations: snapshot.workerAttestations,
      readiness: snapshot.readiness,
      infrastructure: snapshot.workerAttestations.length ? 'partially-observable-through-database' : 'unknown',
      manualSteps: ['provision or verify external worker', 'run approved self-test', 'record fresh attestations'],
    },
    flags: {
      known: snapshot.flags.repositoryContract,
      unknown: snapshot.flags.remote,
      futureOrder: manifest.flags.enableOrder,
      conditions: ['migrations and storage verified', 'functions and worker healthy', 'fresh attestations', 'uploadReady=true', 'QA receipts'],
    },
    qa: {
      roles: 'execute the 12-role matrix', multimedia: 'execute 23 Multimedia cases',
      social: 'execute 18 Estudio Social cases', revocation: 'prove immediate fail-closed revocation',
      failClosed: 'prove expired attestations and unhealthy worker close uploads',
      rollback: 'disable flags first and preserve user data',
    },
    risks: [...snapshot.blockers, ...snapshot.limitations],
    blockers: snapshot.blockers,
  };
  return { ...core, planId: sha256(canonicalJson(core)) };
}

export function formatDryRunMarkdown(plan) {
  const lines = [
    '# Arma2 Torneos — Staging read-only dry-run', '',
    `- Repository SHA: \`${plan.repositorySha}\``,
    `- Snapshot SHA-256: \`${plan.snapshotSha256}\``,
    `- Remote mutations: **${plan.mutationsPerformed}**`, '',
    '## Migraciones', '',
  ];
  if (!plan.migrations.pending.length) lines.push('No hay migraciones locales pendientes verificables.', '');
  for (const item of plan.migrations.pending) {
    lines.push(`${item.order}. \`${item.file}\``, `   - SHA-256 local: \`${item.localSha256}\``,
      `   - Checksum remoto: ${item.remoteChecksum}`, `   - Dependencias: ${item.dependencies.join(', ') || 'ninguna'}`,
      `   - Locks previsibles: ${item.locks.join('; ')}`, `   - Riesgo: ${item.risk}`, `   - Rollback: \`${item.rollback}\``,
      `   - Objetos: ${item.affected.tables.length} tablas, ${item.affected.functions.length} funciones, ${item.affected.indexes.length} índices, ${item.affected.triggers.length} triggers`, '');
  }
  lines.push('## Storage', '', `- Operación futura: ${plan.storage.requiredOperation}`,
    `- Policies faltantes: ${plan.storage.missingPolicies.join(', ') || 'ninguna'}`,
    `- Policies inesperadas: ${plan.storage.unexpectedPolicies.join(', ') || 'ninguna'}`,
    `- Riesgo: ${plan.storage.risk}`, `- Rollback: ${plan.storage.rollback}`, '',
    '## Edge', '', `- Presentes: ${plan.edge.present.join(', ') || 'ninguna'}`,
    `- Ausentes: ${plan.edge.missing.join(', ') || 'ninguna'}`, `- Orden futuro: ${plan.edge.order.join(' → ')}`,
    `- Secretos alternativos faltantes: ${plan.edge.missingSecretAlternatives.map((item) => item.join('|')).join(', ') || 'ninguno'}`,
    `- Health pendiente: ${plan.edge.healthPending}`, `- Rollback: ${plan.edge.rollback}`, '',
    '## Worker y readiness', '', `- Infraestructura: ${plan.worker.infrastructure}`,
    `- uploadReady: ${plan.worker.readiness.uploadReady ?? 'unknown'}`,
    `- Pasos manuales: ${plan.worker.manualSteps.join('; ')}`, '',
    '## Flags', '', `- Multimedia remoto: ${plan.flags.unknown.REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED}`,
    `- Social remoto: ${plan.flags.unknown.REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED}`,
    `- Orden futuro: ${plan.flags.futureOrder.join(' → ')}`, '',
    '## QA y rollback', '', `- Roles: ${plan.qa.roles}`, `- Multimedia: ${plan.qa.multimedia}`,
    `- Estudio Social: ${plan.qa.social}`, `- Revocación: ${plan.qa.revocation}`,
    `- Fail-closed: ${plan.qa.failClosed}`, `- Rollback: ${plan.qa.rollback}`, '',
    '## Bloqueos y limitaciones', '');
  lines.push(...(plan.risks.length ? plan.risks.map((item) => `- ${item}`) : ['- Ninguno informado.']));
  const markdown = `${lines.join('\n')}\n`;
  assertSnapshotSanitized(markdown);
  return markdown;
}

export function defaultArtifactDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-torneos-readonly-'));
}
