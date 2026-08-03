import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  AUTHORIZED_STAGING_REF,
  FORBIDDEN_PRODUCTION_REF,
  InspectorError,
  validateExecutionPlan,
  validateTarget,
} from './inspect-remote-readonly-lib.mjs';
import { canonicalJson, loadManifest, sha256 } from './readiness-lib.mjs';

export const A1_VERSION = '20260802090000';
export const A1_FILE = 'supabase/migrations/20260802090000_tournament_media_upload_pipeline.sql';
export const A1_CHECKSUM = '793ffbbe8cf7f7f94b4924d781fa81e01ebf92208c80e70b60e2daf92a72a417';
export const A1_CONFIRMATION = 'APPLY-ONLY-A1-20260802090000';
export const PRODUCTION_GUARD_CONFIRMATION = 'PRODUCTION-IS-FORBIDDEN';

export class SingleMigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SingleMigrationError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => { throw new SingleMigrationError(code, message, details); };
const assert = (condition, code, message, details) => {
  if (!condition) fail(code, message, details);
};

export function parseStrictArgs(argv) {
  const result = { _: [] };
  for (const raw of argv) {
    if (!raw.startsWith('--')) {
      result._.push(raw);
      continue;
    }
    const [key, ...rest] = raw.slice(2).split('=');
    assert(key && rest.length, 'ARGUMENT_FORMAT', `Argument --${key || ''} must use --name=value.`);
    assert(!Object.hasOwn(result, key), 'ARGUMENT_DUPLICATE', `Argument --${key} was supplied more than once.`);
    result[key] = rest.join('=');
  }
  return result;
}

export function approvalTokenForPlan(plan) {
  return sha256(`arma2-a1-apply:${plan.planId}:${plan.repositorySha}:${A1_VERSION}`);
}

const exactMigrationPath = (repoRoot, value) => {
  assert(typeof value === 'string' && value.length > 0, 'MIGRATION_REQUIRED',
    '--migration must name exactly the authorized A1 file.');
  assert(!/[\*?\[\]{},]/.test(value) && !value.includes('..') && !value.includes(':'),
    'MIGRATION_SELECTION', 'Globs, ranges, traversal, and multiple migration selectors are forbidden.');
  assert(value === A1_FILE, 'MIGRATION_NOT_AUTHORIZED', 'Only the exact A1 migration file is authorized.');
  const absolute = path.resolve(repoRoot, value);
  assert(fs.statSync(absolute).isFile(), 'MIGRATION_SELECTION', 'Migration selection must be one regular file.');
  return absolute;
};

const readJson = (file, code) => {
  assert(typeof file === 'string' && file.length > 0, code, `${code.toLowerCase()} file is required.`);
  const absolute = path.resolve(file);
  assert(fs.statSync(absolute).isFile(), code, `${absolute} must be a regular file.`);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
};

const historyVersions = (snapshot) => snapshot.migrationState.remoteHistory.map((item) => String(item.version));

export function prepareExecution({ repoRoot, options, env = process.env, now = new Date(), requireClean = true }) {
  assert(options._?.length === 0, 'MIGRATION_SELECTION', 'Positional migration selectors are forbidden.');
  const manifest = loadManifest(repoRoot);
  assert(options['project-ref'] !== FORBIDDEN_PRODUCTION_REF, 'PRODUCTION_FORBIDDEN',
    'Production project ref is forbidden.');
  assert(options['project-ref'] === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN',
    'Exact authorized Staging project ref is required.');
  assert(options['production-guard'] === PRODUCTION_GUARD_CONFIRMATION, 'PRODUCTION_GUARD',
    `--production-guard must equal ${PRODUCTION_GUARD_CONFIRMATION}.`);
  const expectedRepositorySha = String(options['expected-repository-sha'] || '');
  const snapshot = readJson(options.snapshot, 'SNAPSHOT_REQUIRED');
  const plan = readJson(options.plan, 'PLAN_REQUIRED');
  validateExecutionPlan({
    repoRoot, plan, snapshot, expectedRepositorySha, now, requireClean,
  });
  assert(options['migration-version'] === A1_VERSION, 'MIGRATION_VERSION',
    `Migration version must be exactly ${A1_VERSION}.`);
  assert(options['migration-checksum'] === A1_CHECKSUM, 'MIGRATION_CHECKSUM',
    `Migration checksum must be exactly ${A1_CHECKSUM}.`);
  assert(options['snapshot-sha'] === sha256(canonicalJson(snapshot))
    && options['snapshot-sha'] === plan.snapshotSha256, 'SNAPSHOT_DRIFT',
  'Snapshot checksum differs from the plan or supplied argument.');
  assert(options['plan-id'] === plan.planId, 'PLAN_ID_DRIFT', 'Supplied plan ID differs from the plan file.');
  assert(options.confirmation === A1_CONFIRMATION, 'A1_CONFIRMATION',
    `--confirmation must equal ${A1_CONFIRMATION}.`);
  assert(options['approval-token'] === approvalTokenForPlan(plan), 'APPROVAL_TOKEN',
    'Exact per-plan A1 approval token is required.');
  const migrationFile = exactMigrationPath(repoRoot, options.migration);
  assert(sha256(fs.readFileSync(migrationFile)) === A1_CHECKSUM, 'MIGRATION_CHECKSUM',
    'Canonical A1 migration checksum differs.');
  const a1 = manifest.migrationPolicy.migrations[0];
  assert(a1.version === A1_VERSION && a1.file === A1_FILE && a1.sha256 === A1_CHECKSUM,
    'MIGRATION_MANIFEST_DRIFT', 'Manifest A1 identity differs from the executor contract.');
  const pending = plan.migrations.pending.map((item) => item.version);
  assert(pending[0] === A1_VERSION, 'MIGRATION_PENDING_ORDER', 'A1 must be the first pending migration.');
  assert(!historyVersions(snapshot).includes(A1_VERSION), 'MIGRATION_ALREADY_APPLIED',
    'A1 is already present in migration history.');
  const databaseUrl = String(env.STAGING_MIGRATION_DATABASE_URL || '');
  assert(databaseUrl, 'DATABASE_URL_REQUIRED', 'STAGING_MIGRATION_DATABASE_URL is required for apply or verify.');
  validateTarget({ projectRef: options['project-ref'], databaseUrl });
  return {
    manifest,
    plan,
    snapshot,
    expectedRepositorySha,
    migrationFile,
    databaseUrl,
    historyBefore: historyVersions(snapshot),
    historyAfter: [...historyVersions(snapshot), A1_VERSION],
    execution: a1.execution,
  };
}

const sqlTextArrayLiteral = (sql) => {
  const tag = '$arma2_a1_canonical_sql$';
  assert(!sql.includes(tag), 'MIGRATION_SQL_TAG', 'Canonical SQL contains the reserved history delimiter.');
  return `ARRAY[${tag}${sql}${tag}]::text[]`;
};

const versionArrayLiteral = (versions) => (
  versions.length ? `ARRAY[${versions.map((version) => `'${version}'`).join(', ')}]::text[]` : 'ARRAY[]::text[]'
);

export function buildTransactionalSql({ migrationSql, execution, historyBefore, historyAfter }) {
  assert(typeof migrationSql === 'string' && migrationSql.length > 0, 'MIGRATION_SQL', 'A1 SQL is empty.');
  const beginMatches = [...migrationSql.matchAll(/^\s*BEGIN\s*;\s*$/gim)];
  const commitMatches = [...migrationSql.matchAll(/^\s*COMMIT\s*;\s*$/gim)];
  assert(beginMatches.length === 1 && commitMatches.length === 1, 'MIGRATION_TRANSACTION',
    'Canonical A1 must contain exactly one BEGIN and one COMMIT.');
  const begin = beginMatches[0];
  const commit = commitMatches[0];
  assert(begin.index < commit.index && migrationSql.slice(commit.index + commit[0].length).trim() === '',
    'MIGRATION_TRANSACTION', 'Canonical A1 COMMIT must be the final statement.');
  const timeouts = execution.timeouts;
  for (const [name, maximum] of Object.entries({
    lockTimeoutMs: 10000,
    statementTimeoutMs: 300000,
    idleInTransactionSessionTimeoutMs: 120000,
  })) {
    assert(Number.isInteger(timeouts?.[name]) && timeouts[name] > 0 && timeouts[name] <= maximum,
      'MIGRATION_TIMEOUT', `${name} is missing or outside its allowed range.`);
  }
  assert(execution.applicationName === 'arma2-torneos-a1-migrate', 'APPLICATION_NAME',
    'A1 application_name differs from the contract.');
  const before = migrationSql.slice(0, begin.index + begin[0].length);
  const body = migrationSql.slice(begin.index + begin[0].length, commit.index);
  const guard = `
SET LOCAL lock_timeout = '${timeouts.lockTimeoutMs}ms';
SET LOCAL statement_timeout = '${timeouts.statementTimeoutMs}ms';
SET LOCAL idle_in_transaction_session_timeout = '${timeouts.idleInTransactionSessionTimeoutMs}ms';
SET LOCAL application_name = '${execution.applicationName}';
DO $arma2_a1_session_guard$
BEGIN
  IF current_setting('lock_timeout')::interval <> interval '${timeouts.lockTimeoutMs} milliseconds'
    OR current_setting('statement_timeout')::interval <> interval '${timeouts.statementTimeoutMs} milliseconds'
    OR current_setting('idle_in_transaction_session_timeout')::interval <> interval '${timeouts.idleInTransactionSessionTimeoutMs} milliseconds'
    OR current_setting('application_name') <> '${execution.applicationName}' THEN
    RAISE EXCEPTION 'A1 migration session settings differ from contract';
  END IF;
END
$arma2_a1_session_guard$;
SELECT pg_advisory_xact_lock(hashtextextended('arma2-torneos-single-migration', 0));
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $arma2_a1_history_guard$
DECLARE actual text[];
BEGIN
  SELECT COALESCE(array_agg(version ORDER BY version), ARRAY[]::text[])
  INTO actual
  FROM supabase_migrations.schema_migrations;
  IF actual IS DISTINCT FROM ${versionArrayLiteral(historyBefore)} THEN
    RAISE EXCEPTION 'unexpected migration history before A1';
  END IF;
END
$arma2_a1_history_guard$;
`;
  const history = `
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('${A1_VERSION}', 'tournament_media_upload_pipeline', ${sqlTextArrayLiteral(migrationSql)});
DO $arma2_a1_history_after$
DECLARE actual text[];
BEGIN
  SELECT COALESCE(array_agg(version ORDER BY version), ARRAY[]::text[])
  INTO actual
  FROM supabase_migrations.schema_migrations;
  IF actual IS DISTINCT FROM ${versionArrayLiteral(historyAfter)} THEN
    RAISE EXCEPTION 'unexpected migration history after A1';
  END IF;
END
$arma2_a1_history_after$;
COMMIT;
`;
  return `${before}${guard}${body}${history}`;
}

export function buildVerifySql({ historyAfter, execution }) {
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '${execution.timeouts.statementTimeoutMs}ms';
SET LOCAL lock_timeout = '${execution.timeouts.lockTimeoutMs}ms';
SET LOCAL idle_in_transaction_session_timeout = '${execution.timeouts.idleInTransactionSessionTimeoutMs}ms';
SET LOCAL application_name = '${execution.applicationName}-verify';
SELECT CASE WHEN COALESCE(array_agg(version ORDER BY version), ARRAY[]::text[])
  = ${versionArrayLiteral(historyAfter)} THEN 'HISTORY_OK' ELSE 'HISTORY_DRIFT' END
FROM supabase_migrations.schema_migrations;
SELECT current_setting('lock_timeout'), current_setting('statement_timeout'),
  current_setting('idle_in_transaction_session_timeout'), current_setting('application_name');
COMMIT;
`;
}

export function runPsql({ databaseUrl, sql, psql = 'psql' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, ['-X', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--file=-'], {
      env: {
        PATH: process.env.PATH,
        LANG: process.env.LANG || 'C',
        LC_ALL: process.env.LC_ALL || 'C',
        PGDATABASE: databaseUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(new SingleMigrationError('PSQL_EXECUTION', error.message)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, onErrorStop: true });
      else reject(new SingleMigrationError('PSQL_FAILED', `psql aborted with exit code ${code}.`, {
        stderr: stderr.slice(-2000),
      }));
    });
    child.stdin.end(sql);
  });
}

export function buildReceipt({ contract, verification }) {
  assert(verification?.history === 'HISTORY_OK', 'VERIFY_HISTORY', 'Receipt requires exact verified history.');
  const core = {
    schemaVersion: 1,
    operation: 'apply-single-migration',
    stage: 'A1',
    repositorySha: contract.expectedRepositorySha,
    projectRef: AUTHORIZED_STAGING_REF,
    planId: contract.plan.planId,
    snapshotSha256: contract.plan.snapshotSha256,
    manifestSha256: contract.plan.manifestSha256,
    migrationVersion: A1_VERSION,
    migrationChecksum: A1_CHECKSUM,
    historyBefore: contract.historyBefore,
    historyAfter: contract.historyAfter,
    timeouts: contract.execution.timeouts,
    applicationName: contract.execution.applicationName,
    transaction: true,
    onErrorStop: true,
    postApplyPauseRequired: true,
  };
  return { ...core, receiptSha256: sha256(canonicalJson(core)) };
}

export const executorErrorCode = (error) => (
  error instanceof SingleMigrationError || error instanceof InspectorError ? error.code : 'EXECUTOR_FAILURE'
);
