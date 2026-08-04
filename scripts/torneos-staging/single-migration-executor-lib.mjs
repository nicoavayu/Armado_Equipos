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
export const A1_ROLLBACK = 'supabase/rollbacks/20260802090000_tournament_media_upload_pipeline.safe.sql';
export const A1_ROLLBACK_CHECKSUM = '1e8eecc3e93eccc2701b1b4808bb9039aa0c67a45dd4a12d322e5d1102dcf8ad';
export const A1_CONFIRMATION = 'APPLY-ONLY-A1-20260802090000';

export const A2_VERSION = '20260802120000';
export const A2_FILE = 'supabase/migrations/20260802120000_tournament_media_trusted_processing.sql';
export const A2_CHECKSUM = '5b678c593f685feb66ee34fd694403bac2cae828321eae65ee044287a51eba73';
export const A2_ROLLBACK = 'supabase/rollbacks/20260802120000_tournament_media_trusted_processing.safe.sql';
export const A2_ROLLBACK_CHECKSUM = '9d7236bc51af0c321cff8ac772869b57959e718a7d6d2a6c06a60d255f62fc49';
// A2's authorization phrase is bound to the plan it authorizes: the operator cannot mint it before
// the plan exists, and it cannot be replayed against a different (or refreshed) plan. A1's phrase is
// deliberately left as the historical static string so its contract stays byte-identical.
export const A2_CONFIRMATION_PREFIX = 'APPLY-ONLY-A2-20260802120000-PLAN-';
export const A2_CONFIRMATION_PLAN_ID_LENGTH = 16;
export const a2ConfirmationForPlan = (plan) => {
  const planId = String(plan?.planId || '');
  assert(/^[0-9a-f]{64}$/.test(planId), 'PLAN_ID_INVALID',
    'An A2 authorization phrase can only be derived from a full plan ID.');
  return `${A2_CONFIRMATION_PREFIX}${planId.slice(0, A2_CONFIRMATION_PLAN_ID_LENGTH)}`;
};

// Social is named here only so the executor can prove it is never selected, never applied and never
// present in generated SQL. It carries no stage contract and cannot be authorized.
export const SOCIAL_VERSION = '20260803090000';
export const SOCIAL_FILE = 'supabase/migrations/20260803090000_tournament_social_studio.sql';

export const PRODUCTION_GUARD_CONFIRMATION = 'PRODUCTION-IS-FORBIDDEN';
// The single, dedicated channel for the CA bundle psql must verify Staging against.
// `NODE_EXTRA_CA_CERTS` is deliberately NOT read here: it only affects Node's own TLS stack and is
// invisible to psql/libpq, so trusting it would have promised a verification that never happened.
export const STAGING_CA_CERT_ENV = 'STAGING_DATABASE_CA_CERT';

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

/**
 * The closed allowlist of executable stages.
 *
 * Every operational identity of a stage — version, file, checksum, rollback, application name,
 * timeouts, predecessors, authorization phrase — is fixed here. The CLI may only *name* a stage;
 * it can never introduce a version, a file, a checksum or a rollback of its own, so an operator
 * cannot widen the executor's reach by argument. Authorizing a further migration requires editing
 * this table and the manifest together, under review.
 */
export const STAGE_CONTRACTS = Object.freeze({
  A1: Object.freeze({
    stage: 'A1',
    manifestIndex: 0,
    version: A1_VERSION,
    file: A1_FILE,
    checksum: A1_CHECKSUM,
    rollback: A1_ROLLBACK,
    rollbackChecksum: A1_ROLLBACK_CHECKSUM,
    migrationName: 'tournament_media_upload_pipeline',
    applicationName: 'arma2-torneos-a1-migrate',
    timeouts: Object.freeze({
      lockTimeoutMs: 5000, statementTimeoutMs: 120000, idleInTransactionSessionTimeoutMs: 60000,
    }),
    // Versions that must already be in remote history, exactly once, before this stage may run.
    requiresAppliedBefore: Object.freeze([]),
    // Versions that must be absent from remote history: the stage itself and everything after it.
    forbiddenAppliedBefore: Object.freeze([A1_VERSION, A2_VERSION, SOCIAL_VERSION]),
    sqlTag: '$arma2_a1_canonical_sql$',
    guardPrefix: 'arma2_a1',
    tokenPrefix: 'arma2-a1-apply',
    confirmation: () => A1_CONFIRMATION,
  }),
  A2: Object.freeze({
    stage: 'A2',
    manifestIndex: 1,
    version: A2_VERSION,
    file: A2_FILE,
    checksum: A2_CHECKSUM,
    rollback: A2_ROLLBACK,
    rollbackChecksum: A2_ROLLBACK_CHECKSUM,
    migrationName: 'tournament_media_trusted_processing',
    applicationName: 'arma2-torneos-a2-migrate',
    timeouts: Object.freeze({
      lockTimeoutMs: 5000, statementTimeoutMs: 180000, idleInTransactionSessionTimeoutMs: 60000,
    }),
    requiresAppliedBefore: Object.freeze([A1_VERSION]),
    forbiddenAppliedBefore: Object.freeze([A2_VERSION, SOCIAL_VERSION]),
    sqlTag: '$arma2_a2_canonical_sql$',
    guardPrefix: 'arma2_a2',
    tokenPrefix: 'arma2-a2-apply',
    confirmation: (plan) => a2ConfirmationForPlan(plan),
  }),
});

export const AUTHORIZED_STAGES = Object.freeze(Object.keys(STAGE_CONTRACTS));
// The default keeps every historical A1 invocation working unchanged: an operator who never learned
// about `--stage` still gets exactly the A1 contract they had before.
export const DEFAULT_STAGE = 'A1';

/**
 * Resolves a stage name to its frozen contract. This is the only entry point into the table, and it
 * accepts nothing outside the allowlist — Social in particular resolves to no contract at all.
 */
export function resolveStageContract(value) {
  const requested = value === undefined || value === null || value === '' ? DEFAULT_STAGE : value;
  assert(typeof requested === 'string' && Object.hasOwn(STAGE_CONTRACTS, requested),
    'STAGE_NOT_AUTHORIZED',
    `--stage must be exactly one of: ${AUTHORIZED_STAGES.join(', ')}. Social is never executable.`);
  return STAGE_CONTRACTS[requested];
}

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

/**
 * The per-plan approval token. The stage is part of the preimage through both its token prefix and
 * its version, so an approval minted for A1 can never satisfy A2 and vice versa, even for the same
 * plan. For A1 the preimage is byte-identical to the historical one.
 */
export function approvalTokenForPlan(plan, stage = DEFAULT_STAGE) {
  const contract = resolveStageContract(stage);
  return sha256(`${contract.tokenPrefix}:${plan.planId}:${plan.repositorySha}:${contract.version}`);
}

const exactMigrationPath = (repoRoot, value, contract) => {
  assert(typeof value === 'string' && value.length > 0, 'MIGRATION_REQUIRED',
    `--migration must name exactly the authorized ${contract.stage} file.`);
  assert(!/[\*?\[\]{},]/.test(value) && !value.includes('..') && !value.includes(':'),
    'MIGRATION_SELECTION', 'Globs, ranges, traversal, and multiple migration selectors are forbidden.');
  // Naming Social is not merely "not this stage": it is never executable by any stage, so it is
  // rejected with its own code rather than being folded into a generic mismatch.
  assert(value !== SOCIAL_FILE && !value.includes(SOCIAL_VERSION), 'SOCIAL_FORBIDDEN',
    'The Social migration is outside every authorized stage and can never be applied by this executor.');
  assert(value === contract.file, 'MIGRATION_NOT_AUTHORIZED',
    `Only the exact ${contract.stage} migration file is authorized for stage ${contract.stage}.`);
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
  // The stage is resolved first: everything below is derived from its frozen contract, never from
  // an operator-supplied version, file, checksum or rollback.
  const contract = resolveStageContract(options.stage);
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
  assert(options['migration-version'] === contract.version, 'MIGRATION_VERSION',
    `Migration version must be exactly ${contract.version} for stage ${contract.stage}.`);
  assert(options['migration-checksum'] === contract.checksum, 'MIGRATION_CHECKSUM',
    `Migration checksum must be exactly ${contract.checksum} for stage ${contract.stage}.`);
  // A supplied rollback is optional, but if present it must be this stage's exact rollback: an
  // approval may never be paired with another stage's undo path.
  if (options.rollback !== undefined) {
    assert(options.rollback === contract.rollback, 'ROLLBACK_NOT_AUTHORIZED',
      `--rollback must be exactly ${contract.rollback} for stage ${contract.stage}.`);
  }
  assert(options['snapshot-sha'] === sha256(canonicalJson(snapshot))
    && options['snapshot-sha'] === plan.snapshotSha256, 'SNAPSHOT_DRIFT',
  'Snapshot checksum differs from the plan or supplied argument.');
  assert(options['plan-id'] === plan.planId, 'PLAN_ID_DRIFT', 'Supplied plan ID differs from the plan file.');
  if (requireApproval) {
    // The phrase and the token are both stage-scoped, so an A1 authorization presented for A2 (or
    // the reverse) fails here rather than reaching a connection.
    assert(options.confirmation === contract.confirmation(plan), `${contract.stage}_CONFIRMATION`,
      `--confirmation must equal this plan's exact ${contract.stage} authorization phrase.`);
    assert(options['approval-token'] === approvalTokenForPlan(plan, contract.stage), 'APPROVAL_TOKEN',
      `Exact per-plan ${contract.stage} approval token is required.`);
  }
  const migrationFile = exactMigrationPath(repoRoot, options.migration, contract);
  assert(sha256(fs.readFileSync(migrationFile)) === contract.checksum, 'MIGRATION_CHECKSUM',
    `Canonical ${contract.stage} migration checksum differs.`);
  // The rollback is pinned by content too: a stage is not authorized while its declared undo path
  // has drifted from the reviewed one.
  const rollbackFile = path.resolve(repoRoot, contract.rollback);
  assert(fs.statSync(rollbackFile).isFile(), 'ROLLBACK_MISSING',
    `${contract.rollback} must exist before ${contract.stage} may be authorized.`);
  assert(sha256(fs.readFileSync(rollbackFile)) === contract.rollbackChecksum, 'ROLLBACK_CHECKSUM',
    `Canonical ${contract.stage} rollback checksum differs.`);
  const manifestMigrations = manifest.migrationPolicy.migrations;
  const entry = manifestMigrations[contract.manifestIndex];
  assert(entry.version === contract.version && entry.file === contract.file
    && entry.sha256 === contract.checksum && entry.rollback === contract.rollback
    && entry.rollbackSha256 === contract.rollbackChecksum
    && entry.execution?.authorizedStage === contract.stage
    && entry.execution.applicationName === contract.applicationName,
  'MIGRATION_MANIFEST_DRIFT', `Manifest ${contract.stage} identity differs from the executor contract.`);
  assert(canonicalJson([...entry.execution.requiresAppliedBefore])
    === canonicalJson([...contract.requiresAppliedBefore]), 'MIGRATION_MANIFEST_DRIFT',
  `Manifest ${contract.stage} predecessors differ from the executor contract.`);
  // Social must still be blocked in the manifest at the moment any stage is authorized, so A2 can
  // never be carried out under a manifest that has quietly opened Social.
  const social = manifestMigrations.find((item) => item.version === SOCIAL_VERSION);
  assert(social?.execution?.blocked === true && social.execution.authorizedStage === null,
    'SOCIAL_FORBIDDEN', 'Social must remain explicitly blocked in the manifest.');
  assert((snapshot.migrationState.remoteVersionsMissingLocally || []).length === 0,
    'MIGRATION_HISTORY_UNEXPECTED', 'Snapshot contains a remote migration absent from the repository.');
  // Remote history is judged before the plan's pending list, so an operator sees the precise reason
  // ("A1 is not applied", "A2 is already applied") rather than the pending-order symptom it causes.
  const historyBefore = historyVersions(snapshot);
  // Predecessors must be present exactly once. `normalizeHistoryVersions` has already rejected any
  // duplicate, so presence here is presence exactly once.
  for (const predecessor of contract.requiresAppliedBefore) {
    assert(historyBefore.filter((version) => version === predecessor).length === 1,
      'MIGRATION_PREDECESSOR_MISSING',
      `${contract.stage} requires ${predecessor} to be applied exactly once before it.`);
  }
  for (const forbidden of contract.forbiddenAppliedBefore) {
    assert(!historyBefore.includes(forbidden), forbidden === contract.version
      ? 'MIGRATION_ALREADY_APPLIED' : 'MIGRATION_HISTORY_UNEXPECTED',
    forbidden === contract.version
      ? `${contract.stage} is already present in migration history.`
      : `${forbidden} must not be applied before ${contract.stage}.`);
  }
  const pending = plan.migrations.pending.map((item) => item.version);
  assert(pending[0] === contract.version, 'MIGRATION_PENDING_ORDER',
    `${contract.stage} must be the first pending migration.`);
  // Exactly one migration is carried out per execution. The plan may legitimately list later
  // pending migrations (A2 leaves Social pending), but none of them is ever selected or applied.
  assert(new Set(pending).size === pending.length, 'MIGRATION_PENDING_ORDER',
    'Plan pending list contains a duplicate migration version.');
  const databaseUrl = String(env.STAGING_MIGRATION_DATABASE_URL || '');
  let connection = null;
  if (requireDatabaseUrl) {
    assert(databaseUrl, 'DATABASE_URL_REQUIRED', 'STAGING_MIGRATION_DATABASE_URL is required for apply or verify.');
    validateTarget({ projectRef: options['project-ref'], databaseUrl });
    // The raw URL stops here. Everything downstream travels as a validated descriptor, so no call
    // site can reach psql with a host that was never checked.
    connection = buildOperationalConnection({
      projectRef: options['project-ref'],
      databaseUrl,
      targetMode,
      inheritedEnv: env,
      // The CA path also comes from the environment, never from argv: it is an operational secret's
      // trust anchor, not a switch, and it is validated before it can be projected onto psql.
      caCertPath: typeof env[STAGING_CA_CERT_ENV] === 'string' ? env[STAGING_CA_CERT_ENV] : null,
    });
  }
  return {
    manifest,
    plan,
    snapshot,
    expectedRepositorySha,
    migrationFile,
    rollbackFile,
    connection,
    contract,
    stage: contract.stage,
    historyBefore,
    historyAfter: normalizeHistoryVersions([...historyBefore, contract.version], {
      label: `post-${contract.stage} history`,
    }),
    execution: entry.execution,
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

const sqlTextArrayLiteral = (statements, tag) => {
  assert(statements.every((statement) => !statement.includes(tag)), 'MIGRATION_SQL_TAG',
    'Canonical SQL contains the reserved history delimiter.');
  return `ARRAY[${statements.map((statement) => `${tag}${statement}${tag}`).join(', ')}]::text[]`;
};

const versionArrayLiteral = (versions) => (
  normalizeHistoryVersions(versions).length
    ? `ARRAY[${normalizeHistoryVersions(versions).map((version) => `'${version}'`).join(', ')}]::text[]`
    : 'ARRAY[]::text[]'
);

export function buildTransactionalSql({
  migrationSql, execution, historyBefore, historyAfter, stage = DEFAULT_STAGE,
}) {
  const contract = resolveStageContract(stage);
  const { version, guardPrefix } = contract;
  assert(typeof migrationSql === 'string' && migrationSql.length > 0, 'MIGRATION_SQL',
    `${contract.stage} SQL is empty.`);
  const beginMatches = [...migrationSql.matchAll(/^\s*BEGIN\s*;\s*$/gim)];
  const commitMatches = [...migrationSql.matchAll(/^\s*COMMIT\s*;\s*$/gim)];
  assert(beginMatches.length === 1 && commitMatches.length === 1, 'MIGRATION_TRANSACTION',
    `Canonical ${contract.stage} must contain exactly one BEGIN and one COMMIT.`);
  const begin = beginMatches[0];
  const commit = commitMatches[0];
  assert(begin.index < commit.index && migrationSql.slice(commit.index + commit[0].length).trim() === '',
    'MIGRATION_TRANSACTION', `Canonical ${contract.stage} COMMIT must be the final statement.`);
  const timeouts = execution.timeouts;
  for (const [name, exact] of Object.entries(contract.timeouts)) {
    assert(timeouts?.[name] === exact, 'MIGRATION_TIMEOUT', `${name} must equal exactly ${exact}.`);
  }
  assert(execution.applicationName === contract.applicationName, 'APPLICATION_NAME',
    `${contract.stage} application_name differs from the contract.`);
  const before = migrationSql.slice(0, begin.index + begin[0].length);
  const body = migrationSql.slice(begin.index + begin[0].length, commit.index);
  const canonicalStatements = splitSqlStatements(migrationSql);
  const normalizedBefore = normalizeHistoryVersions(historyBefore, { label: `pre-${contract.stage} history` });
  const normalizedAfter = normalizeHistoryVersions(historyAfter, { label: `post-${contract.stage} history` });
  assert(canonicalJson(normalizedAfter) === canonicalJson(
    normalizeHistoryVersions([...normalizedBefore, version], {
      label: `derived post-${contract.stage} history`,
    }),
  ), 'MIGRATION_HISTORY_AFTER',
  `Post-${contract.stage} history must equal pre-${contract.stage} history plus ${contract.stage} exactly once.`);
  // Every predecessor this stage depends on must already be in the pre-history the transaction will
  // assert against, so the remote guard below enforces the dependency too, not only the local check.
  for (const predecessor of contract.requiresAppliedBefore) {
    assert(normalizedBefore.includes(predecessor), 'MIGRATION_PREDECESSOR_MISSING',
      `${contract.stage} pre-history must contain ${predecessor}.`);
  }
  const guard = `
SET LOCAL lock_timeout = '${timeouts.lockTimeoutMs}ms';
SET LOCAL statement_timeout = '${timeouts.statementTimeoutMs}ms';
SET LOCAL idle_in_transaction_session_timeout = '${timeouts.idleInTransactionSessionTimeoutMs}ms';
SET LOCAL application_name = '${execution.applicationName}';
DO $${guardPrefix}_session_guard$
BEGIN
  IF current_setting('lock_timeout')::interval <> interval '${timeouts.lockTimeoutMs} milliseconds'
    OR current_setting('statement_timeout')::interval <> interval '${timeouts.statementTimeoutMs} milliseconds'
    OR current_setting('idle_in_transaction_session_timeout')::interval <> interval '${timeouts.idleInTransactionSessionTimeoutMs} milliseconds'
    OR current_setting('application_name') <> '${execution.applicationName}' THEN
    RAISE EXCEPTION '${contract.stage} migration session settings differ from contract';
  END IF;
END
$${guardPrefix}_session_guard$;
SELECT pg_advisory_xact_lock(hashtextextended('arma2-torneos-single-migration', 0));
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $${guardPrefix}_history_guard$
DECLARE actual text[];
BEGIN
  SELECT COALESCE(array_agg(version ORDER BY version), ARRAY[]::text[])
  INTO actual
  FROM supabase_migrations.schema_migrations;
  IF '${version}' = ANY(actual) THEN
    RAISE EXCEPTION '${contract.stage} already applied';
  ELSIF actual IS DISTINCT FROM ${versionArrayLiteral(normalizedBefore)} THEN
    RAISE EXCEPTION 'unexpected migration history before ${contract.stage}';
  END IF;
END
$${guardPrefix}_history_guard$;
`;
  const history = `
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('${version}', '${contract.migrationName}', ${sqlTextArrayLiteral(canonicalStatements, contract.sqlTag)});
DO $${guardPrefix}_history_after$
DECLARE actual text[];
BEGIN
  SELECT COALESCE(array_agg(version ORDER BY version), ARRAY[]::text[])
  INTO actual
  FROM supabase_migrations.schema_migrations;
  IF actual IS DISTINCT FROM ${versionArrayLiteral(normalizedAfter)} THEN
    RAISE EXCEPTION 'unexpected migration history after ${contract.stage}';
  END IF;
END
$${guardPrefix}_history_after$;
COMMIT;
`;
  const sql = `${before}${guard}${body}${history}`;
  // Last line of defence before the payload leaves the process: whatever the canonical body
  // contained, the statement this executor is about to run may not register Social.
  assert(!sql.includes(`VALUES ('${SOCIAL_VERSION}'`), 'SOCIAL_FORBIDDEN',
    'Generated SQL must never register the Social migration.');
  return sql;
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
// The two remote modes that actually talk to Staging must prove the server's identity, not merely
// encrypt the channel: `require` alone accepts any certificate, so a hostile DNS answer or an
// on-path proxy would still receive the migration credential. Those modes therefore demand
// `verify-full` plus an explicit, validated CA bundle.
export const VERIFIED_TLS_TARGET_MODES = Object.freeze(['apply', 'verify']);
export const VERIFIED_TLS_SSLMODE = 'verify-full';
// A CA bundle is a handful of PEM blocks. Anything larger is not the file the operator meant.
export const MAX_CA_CERT_BYTES = 256 * 1024;

/**
 * Resolves the operator-supplied CA bundle path into a path psql may be pointed at.
 *
 * The bundle is the trust anchor of the whole connection, so it is accepted only when the process
 * can still reason about who controls it: a regular file (never a symlink, whose target could be
 * swapped between this check and the spawn), owned by the current user, and not writable by group
 * or others. Anything else fails closed rather than silently downgrading verification.
 */
export function resolveCaCertificatePath(value, {
  lstat = fs.lstatSync,
  readFile = fs.readFileSync,
  currentUid = (typeof process.getuid === 'function' ? process.getuid() : null),
} = {}) {
  assert(typeof value === 'string' && value.trim().length > 0, 'CA_CERT_REQUIRED',
    `${STAGING_CA_CERT_ENV} is required: remote apply and verify must verify Staging against an explicit CA bundle.`);
  const candidate = value.trim();
  assert(!/[\0\r\n]/.test(candidate), 'CA_CERT_INVALID',
    `${STAGING_CA_CERT_ENV} must be a plain filesystem path.`);
  assert(path.isAbsolute(candidate), 'CA_CERT_INVALID',
    `${STAGING_CA_CERT_ENV} must be an absolute path.`);
  const absolute = path.normalize(candidate);
  let stats;
  try { stats = lstat(absolute); } catch {
    fail('CA_CERT_INVALID', `${STAGING_CA_CERT_ENV} does not name an existing file.`);
  }
  assert(!stats.isSymbolicLink(), 'CA_CERT_INSECURE',
    `${STAGING_CA_CERT_ENV} must not be a symbolic link.`);
  assert(stats.isFile(), 'CA_CERT_INVALID', `${STAGING_CA_CERT_ENV} must name a regular file.`);
  assert(currentUid === null || stats.uid === currentUid, 'CA_CERT_INSECURE',
    `${STAGING_CA_CERT_ENV} must be owned by the current user.`);
  assert((stats.mode & 0o022) === 0, 'CA_CERT_INSECURE',
    `${STAGING_CA_CERT_ENV} must not be writable by group or others.`);
  assert(stats.size > 0 && stats.size <= MAX_CA_CERT_BYTES, 'CA_CERT_INVALID',
    `${STAGING_CA_CERT_ENV} must be a non-empty file of at most ${MAX_CA_CERT_BYTES} bytes.`);
  let contents;
  try { contents = readFile(absolute, 'utf8'); } catch {
    fail('CA_CERT_INVALID', `${STAGING_CA_CERT_ENV} is not readable.`);
  }
  assert(contents.includes('-----BEGIN CERTIFICATE-----')
    && contents.includes('-----END CERTIFICATE-----'), 'CA_CERT_INVALID',
  `${STAGING_CA_CERT_ENV} must contain a PEM certificate bundle.`);
  return absolute;
}

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
  caCertPath = null,
  requireCaCert = false,
  requireVerifiedTls = false,
  caCertChecks = {},
} = {}) {
  assert(CONNECTION_PROFILES.includes(profile), 'CONNECTION_PROFILE',
    `Connection profile must be one of: ${CONNECTION_PROFILES.join(', ')}.`);
  // An inherited PGSSLROOTCERT is not merely dropped: it is refused out loud. Silently ignoring it
  // would leave an operator believing the CA they exported is the one being verified against.
  assert(!(typeof inheritedEnv?.PGSSLROOTCERT === 'string' && inheritedEnv.PGSSLROOTCERT.length),
    'CA_CERT_INHERITED',
    `An inherited PGSSLROOTCERT is never accepted; supply the CA bundle through ${STAGING_CA_CERT_ENV}.`);
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

  // Fail closed. On the remote profile the allowlist above has already rejected every downgrade,
  // so this default can only ever be raised, never lowered.
  const sslMode = projected.PGSSLMODE || (profile === 'local-test' ? 'disable' : DEFAULT_REMOTE_SSLMODE);
  assert(!requireVerifiedTls || sslMode === VERIFIED_TLS_SSLMODE, 'TLS_VERIFICATION_REQUIRED',
    `Remote ${VERIFIED_TLS_TARGET_MODES.join(' and ')} require sslmode=${VERIFIED_TLS_SSLMODE}; `
    + `${sslMode} does not verify the server identity.`);
  // The CA never travels in the URL (`sslrootcert` is not allowlisted) and is never inherited: the
  // only source is the dedicated variable, validated before it can be projected.
  const caCertificate = (requireCaCert || (typeof caCertPath === 'string' && caCertPath.length))
    ? resolveCaCertificatePath(caCertPath, caCertChecks)
    : null;

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
    PGSSLMODE: sslMode,
  }, projected);
  if (caCertificate) env.PGSSLROOTCERT = caCertificate;
  if (password) env.PGPASSWORD = password;
  return {
    env, password, hostname, caCertificate, redactions: [password, parsed.password].filter(Boolean),
  };
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
  projectRef, databaseUrl, targetMode, inheritedEnv = process.env, caCertPath = null,
  caCertChecks = {},
}) {
  assert(CONNECTION_TARGET_MODES.includes(targetMode), 'CONNECTION_TARGET_MODE',
    `Operational target mode must be one of: ${CONNECTION_TARGET_MODES.join(', ')}.`);
  assert(projectRef !== FORBIDDEN_PRODUCTION_REF, 'PRODUCTION_FORBIDDEN',
    'Production project ref is forbidden.');
  assert(projectRef === AUTHORIZED_STAGING_REF, 'PROJECT_REF_UNKNOWN',
    'Exact authorized Staging project ref is required.');
  const target = validateTarget({ projectRef, databaseUrl });
  const verified = VERIFIED_TLS_TARGET_MODES.includes(targetMode);
  const { env, redactions } = buildPsqlConnectionEnv(databaseUrl, inheritedEnv, {
    requirePassword: true,
    profile: 'remote',
    caCertPath,
    requireCaCert: verified,
    requireVerifiedTls: verified,
    caCertChecks,
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
    let stdinError = null;
    let settled = false;
    const settle = (action) => {
      if (settled) return;
      settled = true;
      action();
    };
    // Whatever went wrong, the caller may not assume the transaction rolled back: the child may have
    // died after COMMIT reached the server. The remote state is undetermined until it is re-read.
    const failure = (code, message, details = {}) => new SingleMigrationError(code, message, {
      psqlExitCode: null,
      signal: null,
      stdinErrorCode: stdinError?.code ? String(stdinError.code) : null,
      stderr: sanitize(stderr, { maxLength: 800 }),
      requiresReadOnlyReinspection: true,
      ...details,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // child.stdin is a Writable, and psql may exit before it has consumed a large payload. Without
    // this listener the resulting EPIPE would surface as an uncaughtException that tears the process
    // down, destroying the exit code, the signal and psql's own stderr — the only evidence of what
    // actually happened remotely. The error is recorded and never settles the promise on its own.
    child.stdin.on('error', (error) => { if (!stdinError) stdinError = error; });
    // A spawn that never produced a process has no exit code to wait for.
    child.on('error', (error) => settle(() => reject(
      failure('PSQL_EXECUTION', sanitize(error.message)),
    )));
    // The child's `close` is always awaited: it is the only event that carries the real outcome.
    // Settling is deferred one turn so a stdin EPIPE delivered alongside the close is still seen.
    child.on('close', (code, signal) => setImmediate(() => settle(() => {
      const exitCode = typeof code === 'number' ? code : null;
      const exitSignal = signal || null;
      const sanitizedStderr = sanitize(stderr, { maxLength: 800 });
      const details = {
        psqlExitCode: exitCode,
        signal: exitSignal,
        stdinErrorCode: stdinError?.code ? String(stdinError.code) : null,
        sqlState: extractSqlState(sanitizedStderr),
        stderr: sanitizedStderr,
        // Retained for existing callers; `psqlExitCode` is the contractual name.
        exitCode,
        requiresReadOnlyReinspection: true,
      };
      if (stdinError) {
        // Exit code 0 does not clear this: psql cannot have executed SQL it never received.
        reject(failure('PSQL_STDIN_TRANSPORT',
          `psql stopped reading its input before the payload was fully written (${details.stdinErrorCode || 'stream error'}); `
          + 'the remote outcome is undetermined.', details));
        return;
      }
      if (exitCode === 0 && !exitSignal) {
        resolve({
          stdout, stderr: sanitize(stderr), onErrorStop: true, psqlExitCode: 0, signal: null,
        });
        return;
      }
      reject(failure('PSQL_FAILED', exitSignal
        ? `psql was terminated by signal ${exitSignal}.`
        : `psql aborted with exit code ${exitCode}.`, details));
    })));
    // Writing to an already destroyed pipe can also throw synchronously.
    try { child.stdin.end(sql); } catch (error) { if (!stdinError) stdinError = error; }
  });
}

export function buildExecutionDryRun(contract) {
  const stage = contract.contract;
  const token = approvalTokenForPlan(contract.plan, stage.stage);
  return {
    schemaVersion: 1,
    operation: 'would-apply-single-migration',
    stage: stage.stage,
    projectRef: AUTHORIZED_STAGING_REF,
    repositorySha: contract.expectedRepositorySha,
    planId: contract.plan.planId,
    snapshotSha256: contract.plan.snapshotSha256,
    manifestSha256: contract.plan.manifestSha256,
    migration: {
      version: stage.version,
      file: stage.file,
      sha256: stage.checksum,
      rollback: stage.rollback,
      rollbackSha256: stage.rollbackChecksum,
      requiresAppliedBefore: [...stage.requiresAppliedBefore],
      selectionCount: 1,
    },
    // Named explicitly so a reviewer of the dry-run can see that Social is still pending and is not
    // part of this execution.
    notSelected: contract.plan.migrations.pending
      .map((item) => item.version)
      .filter((version) => version !== stage.version),
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
  const stage = contract.contract;
  const core = {
    schemaVersion: 1,
    operation: 'apply-single-migration',
    stage: stage.stage,
    repositorySha: contract.expectedRepositorySha,
    projectRef: AUTHORIZED_STAGING_REF,
    planId: contract.plan.planId,
    snapshotSha256: contract.plan.snapshotSha256,
    manifestSha256: contract.plan.manifestSha256,
    migrationVersion: stage.version,
    migrationChecksum: stage.checksum,
    rollback: stage.rollback,
    rollbackChecksum: stage.rollbackChecksum,
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
