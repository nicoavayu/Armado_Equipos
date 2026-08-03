import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  FULL_GIT_SHA,
  analyzeSql,
  canonicalJson,
  loadManifest,
  sha256,
  validateManifest,
  validateRepositoryBinding,
} from './readiness-lib.mjs';

export const AUTHORIZED_STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
export const FORBIDDEN_PRODUCTION_REF = 'rcyuuoaqfwcembdajcss';
export const SUPERSEDED_PLAN_IDS = Object.freeze([
  'dd06024015444217e9cd87054b165b7fe902d15b920d5842af1825c947355762',
  'e4144f8bcb810755d18c471e85e389faaa2e4448f68d356367fb4551cfd6e88e',
]);
export const TARGET_EDGE_FUNCTIONS = Object.freeze([
  'tournament-media-signer',
  'tournament-media-processor',
]);

const DOCUMENTED_PREEXISTING_TORNEOS_FUNCTIONS = new Set([]);
const RESERVED_TORNEOS_FUNCTION_NAMESPACE = /^(?:tournament|torneos)(?:-|$)/i;
const EXPECTED_STORAGE_POLICIES = Object.freeze([
  'tournament_media_service_read',
  'tournament_media_service_insert',
  'tournament_media_service_update',
  'tournament_media_service_delete',
]);
const EXPECTED_STORAGE_POLICY_CONTRACT = Object.freeze({
  tournament_media_service_read: { command: 'SELECT', bucketScope: 'tournament-media' },
  tournament_media_service_insert: { command: 'INSERT', bucketScope: 'tournament-media' },
  tournament_media_service_update: { command: 'UPDATE', bucketScope: 'deny-all' },
  tournament_media_service_delete: { command: 'DELETE', bucketScope: 'deny-all' },
});
const EXPECTED_STORAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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
  'acldefault', 'aclexplode', 'coalesce', 'count', 'current_database', 'current_setting', 'extract',
  'has_database_privilege', 'has_schema_privilege', 'has_table_privilege',
  'jsonb_agg', 'jsonb_build_object', 'lower', 'max', 'now', 'nullif', 'pg_get_function_identity_arguments',
  'position',
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
      .filter((name) => !['and', 'case', 'exists', 'filter', 'from', 'in', 'not', 'or', 'values', 'when', 'where'].includes(name));
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
  assert(row.replication === false && row.inherit === false,
    'ROLE_PRIVILEGED', 'Read-only role must be NOREPLICATION and NOINHERIT.');
  assert(row.database_create === false && row.schema_create === false,
    'ROLE_WRITE_PRIVILEGE', 'Read-only role has CREATE privilege.');
  assert(row.relation_write === false, 'ROLE_WRITE_PRIVILEGE',
    'Read-only role has INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER privilege.');
  return {
    verified: true,
    superuser: false,
    bypassRls: false,
    replication: false,
    inherit: false,
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

export const safeCliEnv = (accessToken) => {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NO_COLOR: '1',
  };
  if (String(accessToken || '').trim()) env.SUPABASE_ACCESS_TOKEN = accessToken;
  return env;
};

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

const STORAGE_ADMIN_STATEMENTS = [
  'BEGIN READ ONLY;',
  "SET LOCAL statement_timeout = '5s';",
  "SET LOCAL lock_timeout = '1s';",
  `SELECT jsonb_build_object(
    'transactionReadOnly', current_setting('transaction_read_only'),
    'bucket', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', id,
        'nameMatchesId', name = id,
        'public', public,
        'maxFileBytes', file_size_limit,
        'allowedMimeTypes', allowed_mime_types,
        'ownerConfigured', owner IS NOT NULL OR NULLIF(owner_id, '') IS NOT NULL,
        'avifAutodetection', avif_autodetection,
        'type', type::text
      )), '[]'::jsonb)
      FROM storage.buckets
      WHERE id = 'tournament-media'
    ),
    'rls', (
      SELECT jsonb_build_object('enabled', relation_row.relrowsecurity, 'forced', relation_row.relforcerowsecurity)
      FROM pg_class relation_row
      JOIN pg_namespace namespace_row ON namespace_row.oid = relation_row.relnamespace
      WHERE namespace_row.nspname = 'storage' AND relation_row.relname = 'objects'
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', policyname,
        'command', cmd,
        'roles', roles::text[],
        'permissive', permissive,
        'bucketScope', CASE
          WHEN position('tournament-media' in COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) > 0 THEN 'tournament-media'
          WHEN position('jugadores-fotos' in COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) > 0 THEN 'jugadores-fotos'
          WHEN position('team-crests' in COALESCE(qual::text, '') || ' ' || COALESCE(with_check::text, '')) > 0 THEN 'team-crests'
          WHEN COALESCE(qual::text, '') = 'false' OR COALESCE(with_check::text, '') = 'false' THEN 'deny-all'
          ELSE 'unclassified'
        END
      ) ORDER BY policyname), '[]'::jsonb)
      FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    ),
    'grants', jsonb_build_object(
      'public', COALESCE((
        SELECT jsonb_agg(DISTINCT acl_row.privilege_type ORDER BY acl_row.privilege_type)
        FROM pg_class relation_row
        CROSS JOIN LATERAL aclexplode(COALESCE(relation_row.relacl, acldefault('r', relation_row.relowner))) acl_row
        WHERE relation_row.oid = 'storage.objects'::regclass AND acl_row.grantee = 0
      ), '[]'::jsonb),
      'roles', (
        SELECT jsonb_agg(jsonb_build_object(
          'role', role_name,
          'select', has_table_privilege(role_name, 'storage.objects', 'SELECT'),
          'insert', has_table_privilege(role_name, 'storage.objects', 'INSERT'),
          'update', has_table_privilege(role_name, 'storage.objects', 'UPDATE'),
          'delete', has_table_privilege(role_name, 'storage.objects', 'DELETE')
        ) ORDER BY role_name)
        FROM (
          SELECT 'anon' AS role_name
          UNION ALL SELECT 'authenticated'
          UNION ALL SELECT 'service_role'
        ) target_roles
      )
    )
  ) AS inspection;`,
  'COMMIT;',
];
const STORAGE_ADMIN_SQL = STORAGE_ADMIN_STATEMENTS.join('\n');

export function inspectSupabaseStorageMetadata({ accessToken, projectRef, cli = 'supabase' }) {
  assert(projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN',
    'Storage metadata target is not authorized Staging.');
  for (const statement of STORAGE_ADMIN_STATEMENTS) assertReadOnlySql(statement);
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-supabase-storage-readonly-'));
  try {
    const supabaseDirectory = path.join(workdir, 'supabase');
    const tempDirectory = path.join(supabaseDirectory, '.temp');
    fs.mkdirSync(tempDirectory, { recursive: true });
    fs.writeFileSync(path.join(supabaseDirectory, 'config.toml'), [
      'project_id = "arma2-storage-readonly"', '',
      '[api]', 'port = 54321', '',
      '[db]', 'port = 54322', 'shadow_port = 54320', '',
      '[studio]', 'port = 54323', '',
      '[analytics]', 'port = 54327', '',
    ].join('\n'), { mode: 0o600 });
    fs.writeFileSync(path.join(tempDirectory, 'project-ref'), `${projectRef}\n`, { mode: 0o600 });
    const raw = runSupabaseJson({
      cli,
      accessToken,
      args: ['db', 'query', '--linked', '--agent=no', '-o', 'json', '--workdir', workdir, STORAGE_ADMIN_SQL],
    });
    const inspection = asArray(raw)[0]?.inspection;
    assert(inspection && inspection.transactionReadOnly === 'on', 'STORAGE_ADMIN_NOT_READ_ONLY',
      'Administrative Storage metadata query did not prove a read-only transaction.');
    assertSnapshotSanitized(inspection);
    return { ...inspection, remoteCalls: 1, transactionReadOnlyVerified: true };
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
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

export function classifyEdgeFunctions({ repoRoot, functions }) {
  const localDirectories = new Map([
    ['tournament-media-signer', 'supabase/functions/tournament-media-signer'],
    ['tournament-media-processor', 'supabase/functions/tournament-media-processor'],
  ]);
  return functions.map((item) => {
    const name = String(item.name || '');
    const isTarget = TARGET_EDGE_FUNCTIONS.includes(name);
    const documentedPreexisting = DOCUMENTED_PREEXISTING_TORNEOS_FUNCTIONS.has(name);
    const inReservedNamespace = RESERVED_TORNEOS_FUNCTION_NAMESPACE.test(name);
    const classification = isTarget ? 'A' : (documentedPreexisting ? 'C' : (inReservedNamespace ? 'D' : 'B'));
    const classificationLabel = {
      A: 'target_vertical',
      B: 'preexisting_unrelated_allowed',
      C: 'preexisting_torneos_documented',
      D: 'unexpected_or_suspicious',
    }[classification];
    const localDirectory = localDirectories.get(name);
    return {
      name,
      status: item.status ?? null,
      version: item.version ?? null,
      updatedAt: safeTimestamp(item.updatedAt),
      belongsToTorneos: isTarget || documentedPreexisting || inReservedNamespace,
      collidesWithTarget: isTarget,
      classification,
      classificationLabel,
      localSha256: localDirectory ? directoryDigest(path.join(repoRoot, localDirectory)) : null,
      remoteContentVerifiable: false,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const edgeBlockers = (functions) => [
  ...TARGET_EDGE_FUNCTIONS
    .filter((name) => !functions.some((item) => item.name === name))
    .map((name) => `edge.${name}_absent`),
  ...functions
    .filter((item) => item.classification === 'D')
    .map(() => 'edge.unexpected_function'),
  ...functions
    .filter((item) => item.collidesWithTarget)
    .map((item) => `edge.${item.name}_collision`),
];

export function classifyStorageMetadata(storageAdmin) {
  if (!storageAdmin || !Array.isArray(storageAdmin.bucket) || !Array.isArray(storageAdmin.policies)) {
    return {
      status: 'bucket_presence_unverifiable',
      exists: 'unknown',
      bucket: null,
      policies: [],
      otherPolicies: [],
      directWriteRoles: [],
      grants: null,
      rls: null,
      objectCounts: 'unknown',
      unexpectedConfiguration: ['storage.admin_metadata_unavailable'],
      rlsLimitedFields: ['storage.objectCounts'],
    };
  }
  const bucketRow = storageAdmin.bucket[0] || null;
  const targetPolicies = storageAdmin.policies.filter((item) => EXPECTED_STORAGE_POLICIES.includes(item.name));
  const otherPolicies = storageAdmin.policies.filter((item) => !EXPECTED_STORAGE_POLICIES.includes(item.name));
  const directWriteRoles = [...new Set(storageAdmin.policies
    .filter((item) => item.bucketScope === 'tournament-media'
      && ['INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(String(item.command).toUpperCase()))
    .flatMap((item) => item.roles || [])
    .filter((role) => ['public', 'PUBLIC', 'anon', 'authenticated'].includes(role)))].sort();
  const allowedMimeTypes = [...(bucketRow?.allowedMimeTypes || [])].sort();
  const expectedMimeTypes = [...EXPECTED_STORAGE_MIME_TYPES].sort();
  const unexpectedConfiguration = [];
  if (bucketRow) {
    if (bucketRow.name !== 'tournament-media' || bucketRow.nameMatchesId !== true) {
      unexpectedConfiguration.push('storage.bucket_identity');
    }
    if (bucketRow.public !== false) unexpectedConfiguration.push('storage.bucket_public');
    if (bucketRow.maxFileBytes !== 12 * 1024 * 1024) unexpectedConfiguration.push('storage.bucket_size_limit');
    if (JSON.stringify(allowedMimeTypes) !== JSON.stringify(expectedMimeTypes)) {
      unexpectedConfiguration.push('storage.bucket_mime_types');
    }
    if (bucketRow.avifAutodetection === true) unexpectedConfiguration.push('storage.bucket_avif_autodetection');
  }
  for (const name of EXPECTED_STORAGE_POLICIES) {
    const policy = targetPolicies.find((item) => item.name === name);
    if (!policy) {
      unexpectedConfiguration.push(`storage.policy_missing:${name}`);
      continue;
    }
    const expected = EXPECTED_STORAGE_POLICY_CONTRACT[name];
    if (String(policy.command).toUpperCase() !== expected.command) {
      unexpectedConfiguration.push(`storage.policy_command:${name}`);
    }
    if (policy.bucketScope !== expected.bucketScope) {
      unexpectedConfiguration.push(`storage.policy_scope:${name}`);
    }
    if (JSON.stringify([...(policy.roles || [])].sort()) !== JSON.stringify(['service_role'])) {
      unexpectedConfiguration.push(`storage.policy_roles:${name}`);
    }
  }
  for (const policy of otherPolicies.filter((item) => (
    item.bucketScope === 'tournament-media' || String(item.name).startsWith('tournament_media_')
  ))) unexpectedConfiguration.push(`storage.policy_unexpected:${policy.name}`);
  if (directWriteRoles.length) unexpectedConfiguration.push('storage.client_write_open');
  const status = !bucketRow ? 'bucket_absent'
    : (unexpectedConfiguration.length ? 'bucket_present_noncompliant' : 'bucket_present_compliant');
  return {
    status,
    exists: Boolean(bucketRow),
    bucket: bucketRow,
    policies: targetPolicies.map((item) => ({
      schema_name: 'storage', table_name: 'objects', policy_name: item.name,
      cmd: item.command, roles: item.roles, permissive: item.permissive,
      bucketScope: item.bucketScope,
    })),
    otherPolicies: otherPolicies.map((item) => ({
      policy_name: item.name, cmd: item.command, roles: item.roles, bucketScope: item.bucketScope,
    })),
    directWriteRoles,
    grants: storageAdmin.grants,
    rls: storageAdmin.rls,
    objectCounts: 'unknown',
    unexpectedConfiguration,
    rlsLimitedFields: ['storage.objectCounts'],
  };
}

export function buildSnapshot({ repoRoot, repositorySha, projectRef, timestamp, database, metadata }) {
  assert(FULL_GIT_SHA.test(repositorySha), 'REPOSITORY_SHA',
    'Snapshot must bind a full 40-character repository SHA.');
  assert(projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN', 'Snapshot project is not authorized Staging.');
  const localMigrations = localMigrationInventory(repoRoot);
  const localByVersion = new Map(localMigrations.map((item) => [item.version, item]));
  const remoteHistory = (database.results.migration_history || []).map((item) => ({
    version: String(item.version), name: safeName(item.name), checksum: null,
  }));
  const versions = remoteHistory.map((item) => item.version);
  const duplicates = [...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))].sort();
  const remoteSet = new Set(versions);
  const functions = classifyEdgeFunctions({ repoRoot, functions: metadata.functions });
  const expectedSecrets = [
    'TOURNAMENT_MEDIA_ATTESTATION_SECRET', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY',
  ];
  const secretSet = new Set(metadata.secretNames);
  const tableByName = new Map((database.results.tables || [])
    .map((item) => [`${item.schema_name}.${item.table_name}`, item]));
  const rlsLimited = (name) => tableByName.get(name)?.rls_enabled === true;
  const storageBucket = database.results.storage_bucket?.[0] || null;
  const storageExists = storageBucket ? true : (rlsLimited('storage.buckets') ? 'unknown' : false);
  const rlsLimitedFields = [
    ['storage.bucket', 'storage.buckets'],
    ['storage.objectCounts', 'storage.objects'],
    ['aggregates.jobs', 'public.tournament_media_processing_jobs'],
    ['aggregates.sessions', 'public.tournament_media_upload_sessions'],
    ['aggregates.assets', 'public.tournament_media_assets'],
    ['aggregates.variants', 'public.tournament_media_variants'],
    ['aggregates.socialPermissions', 'public.tournament_social_permissions'],
    ['workerAttestations', 'public.tournament_media_service_attestations'],
  ].filter(([, table]) => rlsLimited(table)).map(([field]) => field);
  const policies = database.results.policies || [];
  const directWriteRoles = [...new Set(policies
    .filter((item) => item.schema_name === 'storage' && item.table_name === 'objects'
      && ['INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(String(item.cmd).toUpperCase()))
    .flatMap((item) => item.roles || [])
    .filter((role) => ['PUBLIC', 'anon', 'authenticated'].includes(role)))].sort();
  const readiness = sanitizeReadiness(database.results.readiness?.[0]);
  const blockers = [...new Set([
    ...readiness.blockers,
    ...(storageExists === false ? ['storage.bucket_absent'] : []),
    ...(storageExists === 'unknown' ? ['storage.bucket_unknown'] : []),
    ...(storageBucket?.public ? ['storage.bucket_public'] : []),
    ...(directWriteRoles.length ? ['storage.client_write_open'] : []),
    ...edgeBlockers(functions),
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
      status: storageExists === false ? 'bucket_absent'
        : (storageExists === 'unknown' ? 'bucket_presence_unverifiable' : 'bucket_present_noncompliant'),
      exists: storageExists,
      bucket: storageBucket ? {
        name: storageBucket.bucket, public: storageBucket.public,
        maxFileBytes: storageBucket.max_file_bytes,
        allowedMimeTypes: storageBucket.allowed_mime_types || [],
      } : null,
      policies: policies.filter((item) => item.schema_name === 'storage'),
      directWriteRoles,
      objectCounts: rlsLimited('storage.objects') ? 'unknown'
        : (database.results.storage_objects?.[0] || { total: 0, svg: 0, partial: 0, variants: 0, quarantine: 0 }),
      rlsLimitedFields: rlsLimitedFields.filter((field) => field.startsWith('storage.')),
    },
    edgeFunctions: functions,
    secrets: expectedSecrets.map((name) => ({ name, present: secretSet.has(name) })),
    aggregates: {
      jobs: rlsLimited('public.tournament_media_processing_jobs') ? 'unknown' : (database.results.jobs || []),
      sessions: rlsLimited('public.tournament_media_upload_sessions') ? 'unknown' : (database.results.sessions || []),
      assets: rlsLimited('public.tournament_media_assets') ? 'unknown' : (database.results.assets || []),
      variants: rlsLimited('public.tournament_media_variants') ? 'unknown' : (database.results.variants || []),
      socialPermissions: rlsLimited('public.tournament_social_permissions') ? 'unknown'
        : (database.results.social_permissions?.[0]?.count ?? null),
      rlsLimitedFields: rlsLimitedFields.filter((field) => field.startsWith('aggregates.')),
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
      ...(rlsLimitedFields.length
        ? [`RLS prevented complete observation of: ${rlsLimitedFields.join(', ')}; those fields are unknown.`]
        : []),
    ],
    readOnlyEvidence: {
      transactionReadOnlyVerified: database.transactionReadOnlyVerified,
      role: database.results.role,
      commands: ['PostgreSQL SELECT inside BEGIN READ ONLY', 'supabase functions list', 'supabase secrets list'],
      queryErrorsAbortTransaction: true,
      rlsLimitedFields,
      ddlStatements: 0, dmlStatements: 0,
    },
    remoteCalls: database.remoteCalls + metadata.remoteCalls,
    mutationsPerformed: 0,
  };
  assertSnapshotSanitized(snapshot);
  return snapshot;
}

export function refreshFocalSnapshot({
  repoRoot,
  repositorySha,
  projectRef,
  timestamp,
  priorSnapshot,
  priorSnapshotSha256,
  metadata,
  storageAdmin,
}) {
  validateSnapshot(priorSnapshot);
  assert(FULL_GIT_SHA.test(repositorySha) && repositorySha === priorSnapshot.repositorySha,
    'REPOSITORY_DRIFT', 'Focal snapshot must bind the same full repository SHA as its source.');
  assert(projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN',
    'Focal snapshot project is not authorized Staging.');
  assert(sha256(`${JSON.stringify(JSON.parse(canonicalJson(priorSnapshot)), null, 2)}\n`) === priorSnapshotSha256,
    'PRIOR_SNAPSHOT_DRIFT', 'Prior sanitized snapshot SHA-256 does not match the authorized evidence.');

  const edgeFunctions = classifyEdgeFunctions({ repoRoot, functions: metadata.functions });
  const storage = classifyStorageMetadata(storageAdmin);
  const expectedSecrets = [
    'TOURNAMENT_MEDIA_ATTESTATION_SECRET', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY',
  ];
  const secretSet = new Set(metadata.secretNames);
  const storageBlockers = storage.status === 'bucket_absent' ? ['storage.bucket_absent']
    : (storage.status === 'bucket_presence_unverifiable' ? ['storage.bucket_unknown']
      : (storage.status === 'bucket_present_noncompliant' ? storage.unexpectedConfiguration : []));
  const inheritedRlsFields = (priorSnapshot.readOnlyEvidence.rlsLimitedFields || [])
    .filter((field) => field !== 'storage.bucket');
  const inheritedLimitations = priorSnapshot.limitations
    .filter((item) => !String(item).startsWith('RLS prevented complete observation of:'));
  const snapshot = {
    ...structuredClone(priorSnapshot),
    timestamp: new Date(timestamp).toISOString(),
    storage,
    edgeFunctions,
    secrets: expectedSecrets.map((name) => ({ name, present: secretSet.has(name) })),
    blockers: [...new Set([
      ...priorSnapshot.blockers.filter((item) => !item.startsWith('edge.') && !item.startsWith('storage.')),
      ...edgeBlockers(edgeFunctions),
      ...storageBlockers,
    ])].sort(),
    limitations: [
      ...inheritedLimitations,
      ...(inheritedRlsFields.length
        ? [`RLS prevented complete observation of: ${inheritedRlsFields.join(', ')}; those fields are unknown.`]
        : []),
      `The focal reinspection refreshed Edge, Secret names, and Storage catalog metadata; non-focal database evidence was inherited from sanitized snapshot ${priorSnapshotSha256}.`,
    ],
    readOnlyEvidence: {
      ...priorSnapshot.readOnlyEvidence,
      commands: [
        ...priorSnapshot.readOnlyEvidence.commands,
        'supabase db query --linked: Storage catalogs inside BEGIN READ ONLY',
      ],
      rlsLimitedFields: inheritedRlsFields,
      storageAdministrativeTransactionReadOnlyVerified: storageAdmin?.transactionReadOnlyVerified === true,
      storageObjectsRead: false,
      sourceSnapshotSha256: priorSnapshotSha256,
    },
    remoteCalls: metadata.remoteCalls + (storageAdmin?.remoteCalls || 0),
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

export function validateSnapshot(snapshot, { expectedRepositorySha } = {}) {
  assert(snapshot?.schemaVersion === 1, 'SNAPSHOT_SCHEMA', 'Unsupported snapshot schemaVersion.');
  assert(FULL_GIT_SHA.test(snapshot.repositorySha), 'REPOSITORY_SHA',
    'Snapshot repository SHA must be 40 lowercase hexadecimal characters.');
  if (expectedRepositorySha !== undefined) {
    assert(FULL_GIT_SHA.test(expectedRepositorySha) && snapshot.repositorySha === expectedRepositorySha,
      'REPOSITORY_DRIFT', 'Snapshot repository SHA differs from the authorized SHA.');
  }
  assert(snapshot.projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN', 'Snapshot project differs.');
  assert(snapshot.mutationsPerformed === 0, 'SNAPSHOT_MUTATION', 'Snapshot reports remote mutations.');
  assert(typeof snapshot.remoteCalls === 'number' && snapshot.remoteCalls >= 0,
    'SNAPSHOT_SCHEMA', 'Snapshot remoteCalls must be a non-negative number.');
  assertSnapshotSanitized(snapshot);
  return true;
}

export function buildDryRun({ repoRoot, snapshot, repositorySha, ttlSeconds = 1800 }) {
  validateSnapshot(snapshot, { expectedRepositorySha: repositorySha });
  assert(FULL_GIT_SHA.test(repositorySha) && snapshot.repositorySha === repositorySha,
    'REPOSITORY_DRIFT', 'Dry-run SHA must exactly match the snapshot and authorized HEAD.');
  const manifest = loadManifest(repoRoot);
  const manifestResult = validateManifest({ repoRoot, manifest });
  assert(Number.isInteger(ttlSeconds) && ttlSeconds > 0 && ttlSeconds <= 3600,
    'PLAN_TTL', 'Plan TTL must be between 1 and 3600 seconds.');
  const createdAt = new Date(snapshot.timestamp);
  assert(!Number.isNaN(createdAt.valueOf()), 'PLAN_TIME', 'Snapshot timestamp is invalid.');
  const applied = new Set(snapshot.migrationState.remoteHistory.map((item) => item.version));
  const migrations = manifest.migrationPolicy.migrations
    .filter((item) => !applied.has(item.version))
    .map((item) => {
      const sql = fs.readFileSync(path.join(repoRoot, item.file), 'utf8');
      return { order: item.order, version: item.version, file: item.file,
        localSha256: item.sha256, remoteChecksum: 'unverifiable', dependencies: item.order === 1 ? [] : [manifest.migrationPolicy.migrations[item.order - 2].version],
        execution: item.execution,
        affected: analyzeSql(sql), locks: item.expectedLocks,
        estimatedDuration: 'unknown: no Staging execution evidence exists; measure only during a separately approved migration window',
        risk: item.risk, rollback: item.rollback,
        validation: 'verify migration history, affected object contracts, grants, RLS and readiness before continuing',
        pause: 'mandatory approval boundary before the next migration or stage' };
    });
  const expectedPolicyNames = manifest.storage.policies;
  const actualPolicies = snapshot.storage.policies.map((item) => item.policy_name);
  const expectedFunctions = manifest.edgeFunctions.map((item) => item.name);
  const actualFunctions = snapshot.edgeFunctions.map((item) => item.name);
  const missingSecrets = manifest.configuration.secretAlternatives
    .filter((group) => !group.some((name) => snapshot.secrets.some((item) => item.name === name && item.present)));
  const core = {
    schemaVersion: 2, status: 'active', repositorySha, projectRef: snapshot.projectRef,
    manifestSha256: manifestResult.manifestSha256,
    snapshotSha256: sha256(canonicalJson(snapshot)),
    remoteCalls: snapshot.remoteCalls,
    mutationsPerformed: 0,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.valueOf() + ttlSeconds * 1000).toISOString(),
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
      requiredOperation: snapshot.storage.status === 'bucket_absent'
        ? 'create private tournament-media bucket only after separate approval; preserve existing service_role policies'
        : (snapshot.storage.status === 'bucket_present_compliant' ? 'no change'
          : (snapshot.storage.status === 'bucket_present_noncompliant'
            ? 'reconcile only the reported contract differences after separate approval'
            : 'no operation: bucket presence is unverifiable')),
      missingPolicies: expectedPolicyNames.filter((name) => !actualPolicies.includes(name)),
      unexpectedPolicies: actualPolicies.filter((name) => !expectedPolicyNames.includes(name)),
      target: {
        private: true,
        maxFileBytes: 12 * 1024 * 1024,
        allowedMimeTypes: [...EXPECTED_STORAGE_MIME_TYPES],
        forbiddenMimeTypes: ['image/svg+xml'],
        directClientWriteRoles: [],
      },
      verification: 're-read storage.buckets and policy/grant catalogs; do not inspect storage.objects content',
      risk: 'bucket or policy changes can expose or block media access',
      rollback: 'restore captured bucket configuration and exact prior policies under separate approval',
      pause: 'mandatory approval boundary before Secrets',
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
    futureAuthorizations: {
      A_migrations: migrations,
      B_storage: {
        operation: snapshot.storage.status === 'bucket_absent' ? 'create bucket' : (snapshot.storage.status === 'bucket_present_compliant' ? 'no change' : 'reconcile or pause'),
        target: { private: true, maxFileBytes: 12 * 1024 * 1024, allowedMimeTypes: [...EXPECTED_STORAGE_MIME_TYPES] },
        policies: expectedPolicyNames,
        verification: 'catalog-only reinspection plus readiness contract',
        rollback: snapshot.storage.status === 'bucket_absent'
          ? 'delete the newly created bucket only if empty and separately approved; otherwise keep it private and pause'
          : 'restore captured prior bucket metadata and policies under separate approval',
        pause: 'mandatory before Secrets',
      },
      C_secrets: {
        namesOnly: [
          'TOURNAMENT_MEDIA_ATTESTATION_SECRET',
          'SUPABASE_SECRET_KEYS|SUPABASE_SERVICE_ROLE_KEY',
          'SUPABASE_PUBLISHABLE_KEYS|SUPABASE_ANON_KEY',
        ],
        action: 'generate and configure only after separate approval',
      },
      D_edge: {
        order: ['tournament-media-signer', 'validate signer health', 'tournament-media-processor', 'validate processor health'],
        action: 'deploy only after separate per-function approval',
      },
      E_worker: {
        requirements: ['external runtime', 'ClamAV', 'freshclam', 'network', 'credentials', 'self-test', 'attestation', 'observability'],
        rollback: 'stop leasing, drain current job, revoke attestation and restore prior runtime',
      },
      F_readiness: {
        sequence: ['verify all gates', 'prove uploadReady=true', 'run revocation test', 'confirm return to false', 'prove recovery'],
      },
      G_flags_and_qa: {
        sequence: ['enable Multimedia', 'QA Multimedia', 'enable Social', 'QA Social'],
        action: 'leave both flags OFF until separately approved',
      },
    },
  };
  return { ...core, planId: sha256(canonicalJson(core)) };
}

export function validateExecutionPlan({
  repoRoot,
  plan,
  snapshot,
  expectedRepositorySha,
  now = new Date(),
  requireClean = false,
}) {
  if (SUPERSEDED_PLAN_IDS.includes(plan?.planId)) {
    fail('PLAN_SUPERSEDED', 'The historical pre-A1 plan is superseded and cannot be executed.');
  }
  const manifest = loadManifest(repoRoot);
  validateRepositoryBinding({ repoRoot, manifest, expectedRepositorySha, requireClean });
  validateSnapshot(snapshot, { expectedRepositorySha });
  assert(plan?.schemaVersion === 2 && plan.status === 'active', 'PLAN_SCHEMA',
    'Only an active execution plan schema v2 is accepted.');
  assert(plan.repositorySha === expectedRepositorySha, 'PLAN_REPOSITORY_DRIFT',
    'Plan repository SHA does not match the authorized HEAD.');
  assert(plan.projectRef === manifest.environment.authorizedProjectRef
    && plan.projectRef === snapshot.projectRef, 'PLAN_PROJECT_REF',
  'Plan project ref differs from the manifest or source snapshot.');
  const manifestSha256 = validateManifest({ repoRoot, manifest }).manifestSha256;
  assert(plan.manifestSha256 === manifestSha256, 'PLAN_MANIFEST_DRIFT',
    'Plan manifest checksum differs from the current manifest.');
  assert(plan.snapshotSha256 === sha256(canonicalJson(snapshot)), 'PLAN_SNAPSHOT_DRIFT',
    'Plan source snapshot checksum differs.');
  const expiresAt = new Date(plan.expiresAt);
  assert(!Number.isNaN(expiresAt.valueOf()) && now.valueOf() < expiresAt.valueOf(),
    'PLAN_EXPIRED', 'Execution plan has expired.');
  const applied = new Set(snapshot.migrationState.remoteHistory.map((item) => item.version));
  const expectedPending = manifest.migrationPolicy.migrations
    .filter((item) => !applied.has(item.version))
    .map((item) => ({ version: item.version, file: item.file, localSha256: item.sha256 }));
  const actualPending = (plan.migrations?.pending || [])
    .map((item) => ({ version: item.version, file: item.file, localSha256: item.localSha256 }));
  assert(canonicalJson(actualPending) === canonicalJson(expectedPending), 'PLAN_PENDING_DRIFT',
    'Plan pending migration list or order differs from the snapshot and manifest.');
  for (const item of plan.migrations.pending) {
    assert(sha256(fs.readFileSync(path.join(repoRoot, item.file))) === item.localSha256,
      'PLAN_MIGRATION_DRIFT', `Migration checksum changed for ${item.version}.`);
  }
  const { planId, ...core } = plan;
  assert(planId === sha256(canonicalJson(core)), 'PLAN_ID_DRIFT', 'Plan ID does not match its content.');
  return { ok: true, manifest, manifestSha256, pending: actualPending };
}

export function formatDryRunMarkdown(plan) {
  const lines = [
    '# Arma2 Torneos — Staging read-only dry-run', '',
    `- Repository SHA: \`${plan.repositorySha}\``,
    `- Snapshot SHA-256: \`${plan.snapshotSha256}\``,
    `- Remote calls heredadas del snapshot: **${plan.remoteCalls}**`,
    `- Remote mutations: **${plan.mutationsPerformed}**`, '',
    '## Migraciones', '',
  ];
  if (!plan.migrations.pending.length) lines.push('No hay migraciones locales pendientes verificables.', '');
  for (const item of plan.migrations.pending) {
    lines.push(`${item.order}. \`${item.file}\``, `   - SHA-256 local: \`${item.localSha256}\``,
      `   - Checksum remoto: ${item.remoteChecksum}`, `   - Dependencias: ${item.dependencies.join(', ') || 'ninguna'}`,
      `   - Locks previsibles: ${item.locks.join('; ')}`, `   - Riesgo: ${item.risk}`, `   - Rollback: \`${item.rollback}\``,
      `   - Duración: ${item.estimatedDuration}`, `   - Validación: ${item.validation}`, `   - Pausa: ${item.pause}`,
      `   - Objetos: ${item.affected.tables.length} tablas, ${item.affected.functions.length} funciones, ${item.affected.indexes.length} índices, ${item.affected.triggers.length} triggers`, '');
  }
  lines.push('## Storage', '', `- Operación futura: ${plan.storage.requiredOperation}`,
    `- Policies faltantes: ${plan.storage.missingPolicies.join(', ') || 'ninguna'}`,
    `- Policies inesperadas: ${plan.storage.unexpectedPolicies.join(', ') || 'ninguna'}`,
    `- Verificación: ${plan.storage.verification}`, `- Riesgo: ${plan.storage.risk}`,
    `- Rollback: ${plan.storage.rollback}`, `- Pausa: ${plan.storage.pause}`, '',
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
  lines.push('', '## Plan futuro por autorización', '',
    '### Etapa A — Migraciones', '',
    '- Ejecutar sólo las migraciones enumeradas arriba, una por autorización y con pausa obligatoria.', '',
    '### Etapa B — Storage', '',
    `- Operación: ${plan.futureAuthorizations.B_storage.operation}.`,
    `- Policies: ${plan.futureAuthorizations.B_storage.policies.join(', ')}.`,
    `- Verificación: ${plan.futureAuthorizations.B_storage.verification}.`,
    `- Rollback: ${plan.futureAuthorizations.B_storage.rollback}.`, '',
    '### Etapa C — Secretos', '',
    `- Nombres solamente: ${plan.futureAuthorizations.C_secrets.namesOnly.join(', ')}.`, '',
    '### Etapa D — Edge', '',
    `- Orden: ${plan.futureAuthorizations.D_edge.order.join(' → ')}.`, '',
    '### Etapa E — Worker', '',
    `- Requisitos: ${plan.futureAuthorizations.E_worker.requirements.join(', ')}.`,
    `- Rollback: ${plan.futureAuthorizations.E_worker.rollback}.`, '',
    '### Etapa F — Readiness', '',
    `- Secuencia: ${plan.futureAuthorizations.F_readiness.sequence.join(' → ')}.`, '',
    '### Etapa G — Flags y QA', '',
    `- Secuencia: ${plan.futureAuthorizations.G_flags_and_qa.sequence.join(' → ')}.`,
    `- Acción actual: ${plan.futureAuthorizations.G_flags_and_qa.action}.`);
  const markdown = `${lines.join('\n')}\n`;
  assertSnapshotSanitized(markdown);
  return markdown;
}

export function defaultArtifactDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-torneos-readonly-'));
}
