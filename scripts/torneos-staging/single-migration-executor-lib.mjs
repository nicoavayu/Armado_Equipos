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

export function normalizeHistoryVersions(values, { label = 'migration history' } = {}) {
  assert(Array.isArray(values), 'MIGRATION_HISTORY_INVALID', `${label} must be an array.`);
  const normalized = values.map((value) => String(value));
  assert(normalized.every((version) => /^\d{14}$/.test(version)), 'MIGRATION_HISTORY_INVALID',
    `${label} contains an invalid migration version.`);
  const duplicates = [...new Set(normalized.filter((version, index) => (
    normalized.indexOf(version) !== index
  )))].sort();
  assert(duplicates.length === 0, 'MIGRATION_HISTORY_DUPLICATE',
    `${label} contains duplicate migration versions.`, { duplicates });
  return normalized.sort((left, right) => left.localeCompare(right));
}

const historyVersions = (snapshot) => normalizeHistoryVersions(
  snapshot.migrationState.remoteHistory.map((item) => item.version),
  { label: 'snapshot migration history' },
);

export function prepareExecution({
  repoRoot,
  options,
  env = process.env,
  now = new Date(),
  requireClean = true,
  requireApproval = true,
  requireDatabaseUrl = true,
  targetMode = 'apply',
}) {
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
  if (requireApproval) {
    assert(options.confirmation === A1_CONFIRMATION, 'A1_CONFIRMATION',
      `--confirmation must equal ${A1_CONFIRMATION}.`);
    assert(options['approval-token'] === approvalTokenForPlan(plan), 'APPROVAL_TOKEN',
      'Exact per-plan A1 approval token is required.');
  }
  const migrationFile = exactMigrationPath(repoRoot, options.migration);
  assert(sha256(fs.readFileSync(migrationFile)) === A1_CHECKSUM, 'MIGRATION_CHECKSUM',
    'Canonical A1 migration checksum differs.');
  const a1 = manifest.migrationPolicy.migrations[0];
  assert(a1.version === A1_VERSION && a1.file === A1_FILE && a1.sha256 === A1_CHECKSUM,
    'MIGRATION_MANIFEST_DRIFT', 'Manifest A1 identity differs from the executor contract.');
  const pending = plan.migrations.pending.map((item) => item.version);
  assert(pending[0] === A1_VERSION, 'MIGRATION_PENDING_ORDER', 'A1 must be the first pending migration.');
  assert((snapshot.migrationState.remoteVersionsMissingLocally || []).length === 0,
    'MIGRATION_HISTORY_UNEXPECTED', 'Snapshot contains a remote migration absent from the repository.');
  const historyBefore = historyVersions(snapshot);
  assert(!historyBefore.includes(A1_VERSION), 'MIGRATION_ALREADY_APPLIED',
    'A1 is already present in migration history.');
  const databaseUrl = String(env.STAGING_MIGRATION_DATABASE_URL || '');
  let connection = null;
  if (requireDatabaseUrl) {
    assert(databaseUrl, 'DATABASE_URL_REQUIRED', 'STAGING_MIGRATION_DATABASE_URL is required for apply or verify.');
    validateTarget({ projectRef: options['project-ref'], databaseUrl });
    // The raw URL stops here. Everything downstream travels as a validated descriptor, so no call
    // site can reach psql with a host that was never checked.
    connection = buildOperationalConnection({
      projectRef: options['project-ref'], databaseUrl, targetMode, inheritedEnv: env,
    });
  }
  return {
    manifest,
    plan,
    snapshot,
    expectedRepositorySha,
    migrationFile,
    connection,
    historyBefore,
    historyAfter: normalizeHistoryVersions([...historyBefore, A1_VERSION], { label: 'post-A1 history' }),
    execution: a1.execution,
  };
}

export function splitSqlStatements(sql) {
  assert(typeof sql === 'string', 'MIGRATION_SQL', 'Migration SQL must be text.');
  const statements = [];
  let start = 0;
  let index = 0;
  let state = 'ready';
  let blockDepth = 0;
  let parenDepth = 0;
  let dollarDelimiter = '';
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1] || '';
    if (state === 'line-comment') {
      if (char === '\n') state = 'ready';
      index += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (char === '/' && next === '*') { blockDepth += 1; index += 2; continue; }
      if (char === '*' && next === '/') {
        blockDepth -= 1;
        index += 2;
        if (blockDepth === 0) state = 'ready';
        continue;
      }
      index += 1;
      continue;
    }
    if (state === 'single-quote' || state === 'double-quote') {
      const delimiter = state === 'single-quote' ? "'" : '"';
      if (char === delimiter && next === delimiter) { index += 2; continue; }
      if (char === delimiter) state = 'ready';
      index += 1;
      continue;
    }
    if (state === 'dollar-quote') {
      if (sql.startsWith(dollarDelimiter, index)) {
        index += dollarDelimiter.length;
        state = 'ready';
      } else index += 1;
      continue;
    }
    if (char === '-' && next === '-') { state = 'line-comment'; index += 2; continue; }
    if (char === '/' && next === '*') {
      state = 'block-comment'; blockDepth = 1; index += 2; continue;
    }
    if (char === "'") { state = 'single-quote'; index += 1; continue; }
    if (char === '"') { state = 'double-quote'; index += 1; continue; }
    if (char === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarDelimiter = match[0];
        state = 'dollar-quote';
        index += dollarDelimiter.length;
        continue;
      }
    }
    if (char === '(') parenDepth += 1;
    else if (char === ')' && parenDepth > 0) parenDepth -= 1;
    else if (char === '\\') { index += 2; continue; }
    else if (char === ';' && parenDepth === 0) {
      const statement = sql.slice(start, index + 1).replace(/;+$/u, '').trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  const finalStatement = sql.slice(start).replace(/;+$/u, '').trim();
  if (finalStatement) statements.push(finalStatement);
  assert(state === 'ready' && blockDepth === 0 && parenDepth === 0,
    'MIGRATION_SQL_PARSE', 'Canonical SQL ended inside an unterminated lexical construct.');
  return statements;
}

const sqlTextArrayLiteral = (statements) => {
  const tag = '$arma2_a1_canonical_sql$';
  assert(statements.every((statement) => !statement.includes(tag)), 'MIGRATION_SQL_TAG',
    'Canonical SQL contains the reserved history delimiter.');
  return `ARRAY[${statements.map((statement) => `${tag}${statement}${tag}`).join(', ')}]::text[]`;
};

const versionArrayLiteral = (versions) => (
  normalizeHistoryVersions(versions).length
    ? `ARRAY[${normalizeHistoryVersions(versions).map((version) => `'${version}'`).join(', ')}]::text[]`
    : 'ARRAY[]::text[]'
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
  for (const [name, exact] of Object.entries({
    lockTimeoutMs: 5000,
    statementTimeoutMs: 120000,
    idleInTransactionSessionTimeoutMs: 60000,
  })) {
    assert(timeouts?.[name] === exact, 'MIGRATION_TIMEOUT', `${name} must equal exactly ${exact}.`);
  }
  assert(execution.applicationName === 'arma2-torneos-a1-migrate', 'APPLICATION_NAME',
    'A1 application_name differs from the contract.');
  const before = migrationSql.slice(0, begin.index + begin[0].length);
  const body = migrationSql.slice(begin.index + begin[0].length, commit.index);
  const canonicalStatements = splitSqlStatements(migrationSql);
  const normalizedBefore = normalizeHistoryVersions(historyBefore, { label: 'pre-A1 history' });
  const normalizedAfter = normalizeHistoryVersions(historyAfter, { label: 'post-A1 history' });
  assert(canonicalJson(normalizedAfter) === canonicalJson(
    normalizeHistoryVersions([...normalizedBefore, A1_VERSION], { label: 'derived post-A1 history' }),
  ), 'MIGRATION_HISTORY_AFTER', 'Post-A1 history must equal pre-A1 history plus A1 exactly once.');
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
  IF '${A1_VERSION}' = ANY(actual) THEN
    RAISE EXCEPTION 'A1 already applied';
  ELSIF actual IS DISTINCT FROM ${versionArrayLiteral(normalizedBefore)} THEN
    RAISE EXCEPTION 'unexpected migration history before A1';
  END IF;
END
$arma2_a1_history_guard$;
`;
  const history = `
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('${A1_VERSION}', 'tournament_media_upload_pipeline', ${sqlTextArrayLiteral(canonicalStatements)});
DO $arma2_a1_history_after$
DECLARE actual text[];
BEGIN
  SELECT COALESCE(array_agg(version ORDER BY version), ARRAY[]::text[])
  INTO actual
  FROM supabase_migrations.schema_migrations;
  IF actual IS DISTINCT FROM ${versionArrayLiteral(normalizedAfter)} THEN
    RAISE EXCEPTION 'unexpected migration history after A1';
  END IF;
END
$arma2_a1_history_after$;
COMMIT;
`;
  return `${before}${guard}${body}${history}`;
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function sanitizePsqlError(value, { maxLength = 2000, secrets = [] } = {}) {
  let sanitized = String(value || '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 3) continue;
    for (const variant of new Set([secret, encodeURIComponent(secret)])) {
      sanitized = sanitized.replace(new RegExp(escapeRegExp(variant), 'g'), '[REDACTED_SECRET]');
    }
  }
  sanitized = sanitized
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
    .replace(/\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]{8,}/gi, '[REDACTED_TOKEN]')
    .replace(/([?&](?:access_token|apikey|api_key|jwt|password|secret|signature|sig|token)=)[^&\s]+/gi,
      '$1[REDACTED]')
    .replace(/\b(PG(?:PASSWORD|PASSFILE|SSLKEY)|password|pass|access[_ -]?token|api[_ -]?key|jwt|secret)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]')
    .replace(/(?:\/Users|\/home)\/[^\s:"']+/g, '[REDACTED_PATH]')
    .replaceAll(FORBIDDEN_PRODUCTION_REF, '[REDACTED_PROJECT_REF]');
  if (sanitized.length > maxLength) {
    sanitized = `[truncated] ${sanitized.slice(-(maxLength - 12))}`;
  }
  return sanitized;
}

export const extractSqlState = (value) => {
  const match = String(value || '').match(/\bSQLSTATE[: ]+([0-9A-Z]{5})\b/i)
    || String(value || '').match(/\((?:SQLSTATE )([0-9A-Z]{5})\)/i);
  return match ? match[1].toUpperCase() : null;
};

// TLS never degrades on the operational path to Supabase Staging: `require` is the floor and the
// only upgrades are certificate verification. `disable`, `allow` and `prefer` would let a passive
// attacker (or a hostile DNS answer) read the migration credential in clear, so they are rejected
// even when the URL asks for them explicitly. There is no operational way to downgrade this.
export const REMOTE_SSLMODES = Object.freeze(['require', 'verify-ca', 'verify-full']);
export const DEFAULT_REMOTE_SSLMODE = 'require';
// SCRAM channel binding may be negotiated (`prefer`) or demanded (`require`); turning it off on a
// remote administrative connection has no documented technical justification for this executor.
export const REMOTE_CHANNEL_BINDINGS = Object.freeze(['prefer', 'require']);
// Only the local, test-only profile may talk to a TLS-less PostgreSQL, and only over loopback.
export const LOCAL_TEST_SSLMODES = Object.freeze(['disable', ...REMOTE_SSLMODES]);
export const LOCAL_TEST_CHANNEL_BINDINGS = Object.freeze(['disable', ...REMOTE_CHANNEL_BINDINGS]);
export const LOOPBACK_TEST_HOSTS = Object.freeze(['127.0.0.1', '::1', 'localhost']);
// libpq gives up on the connection after this many seconds. Bounded so a hostile URL cannot park
// the executor on an unreachable host while it holds the operator's approval window open.
export const MAX_CONNECT_TIMEOUT_SECONDS = 30;

export const CONNECTION_PROFILES = Object.freeze(['remote', 'local-test']);
// A descriptor may be minted for `receipt`, but only these modes may reach a spawn.
export const CONNECTION_TARGET_MODES = Object.freeze(['apply', 'verify', 'receipt']);
export const SPAWNABLE_TARGET_MODES = Object.freeze(['apply', 'verify', 'local-test']);

// libpq never expands a connection URI supplied through PGDATABASE: it treats the whole string as a
// literal database name and falls back to the local Unix socket. The URL is therefore parsed here and
// projected onto discrete libpq variables. Only these connection parameters may travel in the URL.
const connectionParamAllowlist = (profile) => Object.freeze({
  sslmode: {
    variable: 'PGSSLMODE',
    values: profile === 'local-test' ? LOCAL_TEST_SSLMODES : REMOTE_SSLMODES,
  },
  connect_timeout: {
    variable: 'PGCONNECT_TIMEOUT',
    // Positive integer seconds, no leading zeros, never 0 (which means "wait forever").
    pattern: /^[1-9]\d*$/,
    max: MAX_CONNECT_TIMEOUT_SECONDS,
  },
  target_session_attrs: {
    variable: 'PGTARGETSESSIONATTRS',
    values: ['any', 'read-write', 'read-only', 'primary', 'standby', 'prefer-standby'],
  },
  channel_binding: {
    variable: 'PGCHANNELBINDING',
    values: profile === 'local-test' ? LOCAL_TEST_CHANNEL_BINDINGS : REMOTE_CHANNEL_BINDINGS,
  },
});

export const PSQL_CONNECTION_PARAM_ALLOWLIST = connectionParamAllowlist('remote');

// Inherited libpq settings can silently redirect the connection or swap the credential, so the child
// process is built from this allowlist instead of from process.env.
export const PSQL_INHERITED_ENV_ALLOWLIST = Object.freeze(['PATH', 'LANG', 'LC_ALL']);

const bareHostname = (value) => String(value || '').toLowerCase().replace(/^\[|\]$/g, '');

/**
 * Projects a PostgreSQL connection URI onto discrete libpq environment variables.
 * The URI, and in particular its password, never reaches argv, stdout, stderr or any log.
 *
 * This is the projection only. Supabase target validation lives in `validateTarget` and is applied
 * by `buildOperationalConnection`, which is the sole way to obtain a spawnable remote descriptor;
 * the production ref is rejected here too as defense in depth.
 */
export function buildPsqlConnectionEnv(databaseUrl, inheritedEnv = process.env, {
  requirePassword = true,
  profile = 'remote',
} = {}) {
  assert(CONNECTION_PROFILES.includes(profile), 'CONNECTION_PROFILE',
    `Connection profile must be one of: ${CONNECTION_PROFILES.join(', ')}.`);
  assert(typeof databaseUrl === 'string' && databaseUrl.length > 0, 'DATABASE_URL_REQUIRED',
    'A PostgreSQL connection URL is required.');
  let parsed;
  try { parsed = new URL(databaseUrl); } catch {
    fail('DATABASE_URL_INVALID', 'The connection URL is not a valid URL.');
  }
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol), 'DATABASE_URL_INVALID',
    'The connection URL must use the PostgreSQL scheme.');
  assert(!parsed.hash, 'DATABASE_URL_INVALID', 'The connection URL must not carry a fragment.');
  const hostname = bareHostname(parsed.hostname);
  assert(!hostname.includes(FORBIDDEN_PRODUCTION_REF)
    && !decodeURIComponent(parsed.username || '').toLowerCase().includes(FORBIDDEN_PRODUCTION_REF),
  'PRODUCTION_FORBIDDEN', 'The connection URL resolves to Production.');
  assert(hostname, 'DATABASE_URL_INVALID', 'The connection URL must name a host.');
  if (profile === 'local-test') {
    // A test-only descriptor must never be able to reach a managed database, and in particular
    // never a Supabase project, whatever the flag or the URL claim.
    assert(!hostname.includes('supabase'), 'CONNECTION_TEST_ONLY',
      'The test-only local profile must never target a Supabase host.');
    assert(LOOPBACK_TEST_HOSTS.includes(hostname), 'CONNECTION_TEST_ONLY',
      `The test-only local profile only accepts loopback hosts: ${LOOPBACK_TEST_HOSTS.join(', ')}.`);
  }

  const user = decodeURIComponent(parsed.username || '');
  assert(user, 'DATABASE_URL_INVALID', 'The connection URL must carry its user.');
  const password = parsed.password ? decodeURIComponent(parsed.password) : '';
  assert(!requirePassword || password, 'DATABASE_CREDENTIAL_MISSING',
    'The connection URL must carry its credential.');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  assert(database && !database.includes('/'), 'DATABASE_URL_INVALID',
    'The connection URL must name exactly one database.');

  const allowlist = connectionParamAllowlist(profile);
  const projected = {};
  const seen = new Set();
  for (const [name, value] of parsed.searchParams) {
    const rule = Object.hasOwn(allowlist, name) ? allowlist[name] : null;
    assert(rule, 'DATABASE_URL_PARAMETER',
      `Connection parameter ${name} is not allowlisted for the A1 executor.`);
    assert(!seen.has(name), 'DATABASE_URL_PARAMETER', `Connection parameter ${name} is duplicated.`);
    seen.add(name);
    assert(rule.values ? rule.values.includes(value) : rule.pattern.test(value),
      'DATABASE_URL_PARAMETER', `Connection parameter ${name} carries an unsupported value.`);
    assert(rule.max === undefined || Number(value) <= rule.max, 'DATABASE_URL_PARAMETER',
      `Connection parameter ${name} must not exceed ${rule.max}.`);
    projected[rule.variable] = value;
  }

  const env = {};
  for (const name of PSQL_INHERITED_ENV_ALLOWLIST) {
    const value = inheritedEnv?.[name];
    if (typeof value === 'string' && value.length) env[name] = value;
  }
  env.LANG = env.LANG || 'C';
  env.LC_ALL = env.LC_ALL || 'C';
  Object.assign(env, {
    PGHOST: hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: user,
    PGDATABASE: database,
    // Fail closed. On the remote profile the allowlist above has already rejected every downgrade,
    // so this default can only ever be raised, never lowered.
    PGSSLMODE: projected.PGSSLMODE || (profile === 'local-test' ? 'disable' : DEFAULT_REMOTE_SSLMODE),
  }, projected);
  if (password) env.PGPASSWORD = password;
  return { env, password, hostname, redactions: [password, parsed.password].filter(Boolean) };
}

// Brand carried by descriptors that a validating builder produced. It is a module-private symbol,
// so no caller outside this module can forge one, and no JSON payload can carry it.
const VALIDATED_CONNECTION = Symbol('arma2.a1.validated-connection');

const sealConnection = ({ profile, projectRef, targetMode, env, redactions, databaseHostKind }) => {
  const descriptor = { profile, projectRef, targetMode, databaseHostKind };
  // The credential-bearing environment is non-enumerable and the descriptor serializes to its
  // identity only, so it can never end up inside a snapshot, a plan, a dry-run or a receipt.
  Object.defineProperty(descriptor, VALIDATED_CONNECTION, { value: true, enumerable: false });
  Object.defineProperty(descriptor, 'env', { value: Object.freeze({ ...env }), enumerable: false });
  Object.defineProperty(descriptor, 'redactions', {
    value: Object.freeze([...redactions]), enumerable: false,
  });
  Object.defineProperty(descriptor, 'toJSON', {
    value: () => ({ profile, projectRef, targetMode, databaseHostKind }), enumerable: false,
  });
  return Object.freeze(descriptor);
};

export const isValidatedConnection = (value) => Boolean(
  value && typeof value === 'object' && value[VALIDATED_CONNECTION] === true,
);

/**
 * The only way to obtain a descriptor that `runPsql` will accept for a remote target.
 * `validateTarget` runs here as defense in depth — `prepareExecution` already ran it — so a spawn
 * against an unvalidated or unknown host is impossible by construction, not by convention.
 */
export function buildOperationalConnection({
  projectRef, databaseUrl, targetMode, inheritedEnv = process.env,
}) {
  assert(CONNECTION_TARGET_MODES.includes(targetMode), 'CONNECTION_TARGET_MODE',
    `Operational target mode must be one of: ${CONNECTION_TARGET_MODES.join(', ')}.`);
  assert(projectRef !== FORBIDDEN_PRODUCTION_REF, 'PRODUCTION_FORBIDDEN',
    'Production project ref is forbidden.');
  assert(projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN',
    'Exact authorized Staging project ref is required.');
  const target = validateTarget({ projectRef, databaseUrl });
  const { env, redactions } = buildPsqlConnectionEnv(databaseUrl, inheritedEnv, {
    requirePassword: true, profile: 'remote',
  });
  return sealConnection({
    profile: 'remote',
    projectRef,
    targetMode,
    env,
    redactions,
    databaseHostKind: target.databaseHostKind,
  });
}

/**
 * TEST-ONLY. Local PostgreSQL instances used by the regression suites have no TLS, and the remote
 * contract above refuses to talk to them — correctly. This is the only exception, and it is
 * deliberately unreachable from the operational path: `allowInsecureLocalTestConnection` defaults
 * to false, no CLI argument and no environment variable maps to it, it is never persisted in a
 * descriptor, snapshot, plan or receipt, the host must be loopback, any Supabase host is refused,
 * and the resulting descriptor carries the `local-test` target mode that `apply` and `verify`
 * never mint. Callers must pass the flag literally, in test code.
 */
export function buildLocalTestConnection({
  databaseUrl, inheritedEnv = process.env, allowInsecureLocalTestConnection = false,
}) {
  assert(allowInsecureLocalTestConnection === true, 'CONNECTION_TEST_ONLY',
    'A TLS-less local connection requires the explicit test-only opt-in.');
  const { env, redactions } = buildPsqlConnectionEnv(databaseUrl, inheritedEnv, {
    requirePassword: false, profile: 'local-test',
  });
  return sealConnection({
    profile: 'local-test',
    projectRef: null,
    targetMode: 'local-test',
    env,
    redactions,
    databaseHostKind: 'loopback',
  });
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

// async so that a rejected connection contract surfaces as a rejection, never as a sync throw.
// `connection` must be a descriptor minted by `buildOperationalConnection` (which re-runs
// `validateTarget`) or by the test-only `buildLocalTestConnection`. A raw URL is not accepted:
// there is no argument and no mode that reaches a spawn without target validation.
export async function runPsql({ connection, sql, psql = 'psql', spawnFn = spawn }) {
  assert(isValidatedConnection(connection), 'CONNECTION_NOT_VALIDATED',
    'runPsql requires a validated connection descriptor; a raw connection URL is not accepted.');
  assert(SPAWNABLE_TARGET_MODES.includes(connection.targetMode), 'CONNECTION_TARGET_MODE',
    `Only ${SPAWNABLE_TARGET_MODES.join(', ')} descriptors may reach psql.`);
  const { env, redactions } = connection;
  const sanitize = (value, options = {}) => sanitizePsqlError(value, { ...options, secrets: redactions });
  return new Promise((resolve, reject) => {
    // The URL never reaches argv and the SQL always travels over stdin.
    const child = spawnFn(psql, ['-X', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--file=-'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(new SingleMigrationError(
      'PSQL_EXECUTION', sanitize(error.message),
    )));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr: sanitize(stderr), onErrorStop: true });
      else {
        const sanitizedStderr = sanitize(stderr, { maxLength: 800 });
        reject(new SingleMigrationError('PSQL_FAILED', `psql aborted with exit code ${code}.`, {
          exitCode: code,
          sqlState: extractSqlState(sanitizedStderr),
          stderr: sanitizedStderr,
        }));
      }
    });
    child.stdin.end(sql);
  });
}

export function buildExecutionDryRun(contract) {
  const token = approvalTokenForPlan(contract.plan);
  return {
    schemaVersion: 1,
    operation: 'would-apply-single-migration',
    projectRef: AUTHORIZED_STAGING_REF,
    repositorySha: contract.expectedRepositorySha,
    planId: contract.plan.planId,
    snapshotSha256: contract.plan.snapshotSha256,
    manifestSha256: contract.plan.manifestSha256,
    migration: {
      version: A1_VERSION,
      file: A1_FILE,
      sha256: A1_CHECKSUM,
      selectionCount: 1,
    },
    historyBefore: contract.historyBefore,
    historyAfter: contract.historyAfter,
    timeouts: contract.execution.timeouts,
    applicationName: contract.execution.applicationName,
    locks: {
      advisory: 'pg_advisory_xact_lock:arma2-torneos-single-migration',
      history: 'supabase_migrations.schema_migrations:SHARE ROW EXCLUSIVE',
    },
    transaction: true,
    onErrorStop: true,
    sqlTransport: 'stdin',
    shell: false,
    databaseUrlInArguments: false,
    approval: { requiredForApply: true, expectedTokenSha256: sha256(token), persisted: false },
    postApplyPauseRequired: true,
    remoteCalls: contract.snapshot.remoteCalls,
    mutationsPerformed: 0,
  };
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
