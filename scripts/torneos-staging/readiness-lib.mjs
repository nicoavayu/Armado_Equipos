import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { missingCollectors, validateCatalog } from './observability-lib.mjs';
import { worstCaseCycleSeconds } from '../../workers/tournament-media-signer-renewer/src/schedule.mjs';

export const STAGE_NAMES = Object.freeze([
  'inspect', 'plan', 'dry-run', 'migrate', 'storage', 'secrets-check',
  'edge-deploy', 'worker-check', 'attest', 'enable-multimedia',
  'qa-multimedia', 'enable-social', 'qa-social', 'rollback', 'cleanup-local',
]);

// The closed set of migration stages a manifest may authorize for execution. Social is deliberately
// absent: it can only become executable through a reviewed change to this list.
export const AUTHORIZED_MANIFEST_STAGES = Object.freeze(['A1', 'A2']);

export class ReadinessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReadinessError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new ReadinessError(code, message, details);
};

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const sortValue = (value) => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(sortValue(value));
export const clone = (value) => JSON.parse(JSON.stringify(value));

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadManifest(repoRoot = process.cwd()) {
  return readJson(path.join(repoRoot, 'ops', 'torneos-staging', 'manifest.json'));
}

const assert = (condition, code, message, details) => {
  if (!condition) fail(code, message, details);
};

export const FULL_GIT_SHA = /^[0-9a-f]{40}$/;

const fileDigest = (repoRoot, relativeFile) => (
  sha256(fs.readFileSync(path.join(repoRoot, relativeFile)))
);

const stripSqlComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '');

export function analyzeSql(sql) {
  const normalized = stripSqlComments(sql);
  const collect = (pattern) => [...normalized.matchAll(pattern)]
    .map((match) => `${match[1].toLowerCase()}.${match[2].toLowerCase()}`)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  const functions = collect(/create\s+(?:or\s+replace\s+)?function\s+"?([a-z_][\w]*)"?\."?([a-z_][\w]*)"?/gi);
  const tables = collect(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][\w]*)"?\."?([a-z_][\w]*)"?/gi);
  const policies = [...normalized.matchAll(/create\s+policy\s+"?([^"\s]+)"?/gi)]
    .map((match) => match[1]).sort();
  const indexes = [...normalized.matchAll(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([^"\s]+)"?/gi)]
    .map((match) => match[1]).sort();
  const triggers = [...normalized.matchAll(/create\s+trigger\s+"?([^"\s]+)"?/gi)]
    .map((match) => match[1]).sort();
  const types = collect(/create\s+type\s+"?([a-z_][\w]*)"?\."?([a-z_][\w]*)"?/gi);
  const grants = (normalized.match(/\bgrant\b/gi) || []).length;
  const revokes = (normalized.match(/\brevoke\b/gi) || []).length;
  return { tables, functions, types, indexes, triggers, policies, grants, revokes };
}

function validateNoEmbeddedSecrets(manifest) {
  const serialized = JSON.stringify(manifest);
  const jwt = /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/;
  const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  assert(!jwt.test(serialized), 'MANIFEST_SECRET_VALUE', 'Manifest contains a JWT-like value.');
  assert(!privateKey.test(serialized), 'MANIFEST_SECRET_VALUE', 'Manifest contains a private key.');
  assert(manifest.configuration.secretValuesInManifest === false,
    'MANIFEST_SECRET_POLICY', 'Manifest must forbid secret values.');
}

/**
 * Comments are prose, and the drift checks below are about behaviour.
 *
 * Without this, every one of the negative assertions — "the signer must NOT
 * call revoke", "the processor Edge Function must NEVER attest" — could be
 * tripped by a comment that merely names the function it forbids, and the
 * honest fix would be to stop explaining the code. Worse, the positive
 * assertions could be satisfied by a comment, so a file that only *talks* about
 * attesting would validate.
 *
 * Deliberately simple: line comments, block comments, and enough string
 * awareness that a `//` inside a quoted string is not mistaken for one. The
 * inputs are the repository's own Edge Function entrypoints, not arbitrary
 * input, so a full JavaScript lexer would be precision nobody needs here.
 */
export function stripSourceComments(source) {
  let out = '';
  let index = 0;
  let quote = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === '\\') { out += ' '; index += 2; continue; }
      if (char === quote) quote = null;
      out += char;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        // Newlines are preserved so line numbers in any later message stay usable.
        if (source[index] === '\n') out += '\n';
        index += 1;
      }
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Migration drift, defined over what the remote actually exposes.
 *
 * The observability catalog used to define this as "applied migrations whose
 * remote checksum differs from the manifest". There is no such checksum: the
 * remote migration history exposes `version` and `name` and nothing else, which
 * is why the read-only inspector records `checksum: null` and says so in its
 * own limitations list. A metric defined over a field that does not exist is
 * not a metric that has not been switched on yet — it is one that can never
 * report, while sitting in the required list looking like the former.
 *
 * So drift is counted from presence and order, all of which are observable:
 *
 *   - a remote version the manifest target does not declare and no local
 *     migration file explains;
 *   - a target migration applied out of the manifest's declared order;
 *   - a duplicated remote version.
 *
 * Checksum verification does not disappear — it still happens locally, against
 * the migration files, in `validateManifest`. It simply stops pretending to be
 * a remote observation.
 */
export function computeMigrationDrift({ repoRoot = process.cwd(), manifest = loadManifest(repoRoot), state }) {
  const localVersions = localMigrationVersions(repoRoot);
  const history = state?.remoteHistory || [];
  const remoteVersions = history.map(({ version }) => String(version));
  const seen = new Set(remoteVersions);
  const target = manifest.migrationPolicy.migrations.map(({ version }) => version);

  const duplicated = remoteVersions
    .filter((version, index) => remoteVersions.indexOf(version) !== index);
  const undeclared = remoteVersions.filter((version) => !localVersions.has(version));
  const applied = target.filter((version) => seen.has(version));
  const outOfOrder = applied.filter((version, index) => version !== target[index]);

  const details = {
    duplicatedRemoteVersions: [...new Set(duplicated)].sort(),
    remoteVersionsWithoutLocalFile: [...new Set(undeclared)].sort(),
    targetVersionsAppliedOutOfOrder: outOfOrder,
  };
  const drift = details.duplicatedRemoteVersions.length
    + details.remoteVersionsWithoutLocalFile.length
    + details.targetVersionsAppliedOutOfOrder.length;
  return { drift, details, observedFrom: 'version presence and order; the remote history exposes no checksum' };
}

/**
 * The manifest may not describe an attestation contract the code does not
 * implement. This reads both Edge entrypoints and the renewer and refuses any
 * disagreement, because a manifest that claims the processor health certifies
 * the processor tier is exactly the drift this check exists to catch: it does
 * the opposite — it REVOKES a stale processor attestation and writes none.
 */
export function validateAttestationContract({ repoRoot = process.cwd(), manifest = loadManifest(repoRoot) } = {}) {
  const byName = new Map(manifest.edgeFunctions.map((edge) => [edge.name, edge]));
  const source = (edge) => stripSourceComments(
    fs.readFileSync(path.join(repoRoot, edge.entrypoint), 'utf8'),
  );

  const signer = byName.get('tournament-media-signer');
  assert(canonicalJson(signer.attests) === canonicalJson(['signer'])
    && canonicalJson(signer.revokesOnHealth) === canonicalJson([]),
  'ATTESTATION_CONTRACT', 'The signer must be declared as the only writer of the signer attestation.');
  assert(signer.attestationTtlSeconds === 3600, 'ATTESTATION_TTL',
    'The declared signer attestation TTL differs from the contract.');
  const signerSource = source(signer);
  assert(/attest_tournament_media_service/.test(signerSource)
    && /p_service:\s*["']signer["']/.test(signerSource),
  'ATTESTATION_DRIFT', 'The signer does not attest itself the way the manifest declares.');
  assert(new RegExp(`p_ttl_seconds:\\s*${signer.attestationTtlSeconds}\\b`).test(signerSource),
    'ATTESTATION_DRIFT', 'The signer writes a TTL the manifest does not declare.');
  assert(!/revoke_tournament_media_service_attestation/.test(signerSource),
    'ATTESTATION_DRIFT', 'The signer is not declared as revoking anything.');

  const processor = byName.get('tournament-media-processor');
  assert(canonicalJson(processor.attests) === canonicalJson([]),
    'ATTESTATION_CONTRACT', 'The processor Edge Function must attest nothing.');
  assert(canonicalJson(processor.revokesOnHealth) === canonicalJson(['processor']),
    'ATTESTATION_CONTRACT', 'The processor health must be declared as revoking the stale processor attestation.');
  assert(processor.attestationTtlSeconds === null, 'ATTESTATION_TTL',
    'A function that writes no attestation may not declare a TTL.');
  assert(processor.processorAttestationOwner === manifest.worker.path,
    'ATTESTATION_CONTRACT', 'The processor attestation owner must be the external worker.');
  const processorSource = source(processor);
  assert(/revoke_tournament_media_service_attestation/.test(processorSource)
    && /p_service:\s*["']processor["']/.test(processorSource),
  'ATTESTATION_DRIFT', 'The processor health does not revoke the stale processor attestation.');
  assert(!/attest_tournament_media_service/.test(processorSource),
    'ATTESTATION_DRIFT', 'The processor Edge Function must never call the attestation contract.');

  // The worker owns the processor attestation and renews it inside its own loop.
  assert(manifest.worker.attestationTtlSeconds === 900
    && manifest.worker.attestationRenewalIntervalSeconds * 3 <= manifest.worker.attestationTtlSeconds,
  'ATTESTATION_RENEWAL', 'The worker must renew its attestation at or under a third of its TTL.');

  // The signer cannot renew itself, so the scheduler is part of the contract.
  const renewal = manifest.signerAttestationRenewal;
  assert(renewal?.required === true, 'ATTESTATION_RENEWAL',
    'The signer attestation renewal contract is missing.');
  assert(renewal.attestationTtlSeconds === signer.attestationTtlSeconds,
    'ATTESTATION_RENEWAL', 'Renewal TTL differs from the TTL the signer writes.');
  for (const file of [renewal.entrypoint, renewal.runbook]) {
    assert(fs.existsSync(path.join(repoRoot, file)), 'ATTESTATION_RENEWAL_MISSING', `${file} is missing.`);
  }
  // The same function the renewer refuses to start with, not a second copy of
  // it: this used to recompute the worst case without the backoff cap, so a
  // schedule the renewer rejected could still pass manifest validation.
  const worstCase = worstCaseCycleSeconds(renewal);
  assert(worstCase + renewal.safetyMarginSeconds <= renewal.attestationTtlSeconds,
    'ATTESTATION_RENEWAL_UNSAFE', 'The declared renewal schedule can miss the attestation expiry.');
  assert(renewal.alertAfterConsecutiveFailures * renewal.intervalSeconds < renewal.attestationTtlSeconds,
    'ATTESTATION_RENEWAL_UNSAFE', 'The renewal alert would fire after the attestation could expire.');
  assert(renewal.idempotent === true && renewal.holdsServiceCredential === false,
    'ATTESTATION_RENEWAL', 'Renewal must be idempotent and must not hold a service credential.');
  // Nothing is scheduled or deployed by this change; the manifest has to say so.
  assert(renewal.scheduler?.configuredInThisChange === false
    && renewal.scheduler?.deployedInThisChange === false,
  'ATTESTATION_RENEWAL_SCOPE', 'The renewal scheduler must remain unconfigured and undeployed.');
  for (const field of ['stagingOwner', 'productionOwner']) {
    assert(typeof renewal.scheduler?.[field] === 'string' && renewal.scheduler[field].length > 10,
      'ATTESTATION_RENEWAL_OWNER', `The renewal scheduler must name its ${field}.`);
  }
  const renewerConfig = stripSourceComments(fs.readFileSync(
    path.join(repoRoot, renewal.path, 'src', 'config.mjs'), 'utf8',
  ));
  assert(!/env\.SUPABASE_SERVICE_ROLE_KEY|env\.SUPABASE_SECRET_KEY/.test(renewerConfig),
    'ATTESTATION_RENEWAL_PRIVILEGE', 'The renewer must never read a service credential.');

  // The gateway credential is a different thing from the attestation secret and
  // the manifest has to keep saying so, because conflating them is what made
  // the renewer send a non-JWT as a Bearer to a function with verify_jwt = true.
  const gateway = renewal.gatewayCredential;
  assert(gateway && gateway.separateFromAttestationSecret === true,
    'ATTESTATION_RENEWAL_CREDENTIAL',
    'The manifest must state that the gateway credential is not the attestation secret.');
  assert(gateway.mustSatisfyVerifyJwt === true, 'ATTESTATION_RENEWAL_CREDENTIAL',
    'The gateway credential contract must require a JWT, because every Edge Function verifies JWT.');
  assert(Array.isArray(gateway.acceptedOptions) && gateway.acceptedOptions.length >= 2,
    'ATTESTATION_RENEWAL_CREDENTIAL', 'The manifest must enumerate the accepted gateway credentials.');
  assert(Array.isArray(gateway.rejected)
    && gateway.rejected.some((entry) => /service_role/.test(entry))
    && gateway.rejected.some((entry) => /sb_secret_/.test(entry))
    && gateway.rejected.some((entry) => /sb_publishable_/.test(entry)),
  'ATTESTATION_RENEWAL_CREDENTIAL',
  'The manifest must reject service credentials and a publishable key used as the bearer.');
  const renewerGateway = stripSourceComments(fs.readFileSync(
    path.join(repoRoot, renewal.path, 'src', 'gateway.mjs'), 'utf8',
  ));
  assert(/verify_jwt/.test(renewerGateway) && /RENEWER_GATEWAY_JWT_NOT_A_JWT/.test(renewerGateway),
    'ATTESTATION_RENEWAL_CREDENTIAL',
    'The renewer does not implement the declared gateway credential contract.');

  // The probe against Staging is prepared, never executed by this repository.
  const probe = renewal.gatewayProbe;
  assert(probe?.executedInThisChange === false && probe?.requiresExplicitAuthorization === true,
    'ATTESTATION_PROBE_SCOPE',
    'The gateway probe must be declared as unexecuted and authorization-gated.');
  for (const file of [probe.entrypoint, probe.runbook]) {
    assert(fs.existsSync(path.join(repoRoot, file)), 'ATTESTATION_PROBE_MISSING', `${file} is missing.`);
  }
  assert(typeof probe.writes === 'string' && /attestation/i.test(probe.writes),
    'ATTESTATION_PROBE_SCOPE', 'The probe contract must state that the health call writes an attestation.');
  assert(typeof probe.rollback === 'string' && probe.rollback.length > 20,
    'ATTESTATION_PROBE_ROLLBACK', 'The probe must declare how its attestation is rolled back.');

  // Persisted state is what makes the consecutive-failure metric reachable in
  // --once, so the manifest may not describe a renewer that cannot alert.
  const oneShot = renewal.onceMode;
  assert(oneShot?.statePersisted === true && oneShot?.stateFileMode === '0600'
    && oneShot?.atomicWrites === true && oneShot?.exclusiveLock === true
    && oneShot?.corruptionFailsClosed === true,
  'ATTESTATION_RENEWAL_STATE',
  'The --once contract must persist state safely, atomically, exclusively and fail-closed.');
  assert(typeof oneShot.orchestratorAlternative === 'string' && oneShot.orchestratorAlternative.length > 20,
    'ATTESTATION_RENEWAL_STATE',
    'The --once contract must document the orchestrator exit-code alternative.');
  return { ok: true };
}

/**
 * Observability is a gate, not a nice-to-have: every signal the manifest
 * requires has to exist in the catalog with a threshold, a severity, a recovery
 * condition and a runbook, and the browser flag has to stay closed until the
 * signals are deployed AND validated against Staging.
 */
export function validateObservabilityContract({ repoRoot = process.cwd(), manifest = loadManifest(repoRoot) } = {}) {
  const observability = manifest.observability;
  for (const file of [observability.catalog, observability.query, observability.runbook]) {
    assert(typeof file === 'string' && fs.existsSync(path.join(repoRoot, file)),
      'OBSERVABILITY_MISSING', `${file} declared by the manifest is missing.`);
  }
  const catalog = readJson(path.join(repoRoot, observability.catalog));
  validateCatalog({ repoRoot, catalog });

  const catalogSignals = new Set(catalog.metrics.map(({ signal }) => signal));
  const required = observability.requiredSignals;
  assert(Array.isArray(required) && required.length > 0,
    'OBSERVABILITY_SIGNALS', 'The manifest declares no required signals.');
  assert(new Set(required).size === required.length,
    'OBSERVABILITY_SIGNALS', 'The required signal list repeats a signal.');
  for (const signal of required) {
    assert(catalogSignals.has(signal), 'OBSERVABILITY_SIGNAL_MISSING',
      `Required signal ${signal} has no metric in the catalog.`);
  }
  // Bidirectional: a metric nobody requires is a metric nobody watches.
  for (const signal of catalogSignals) {
    assert(required.includes(signal), 'OBSERVABILITY_SIGNAL_UNDECLARED',
      `Catalog metric signal ${signal} is not declared as required.`);
  }

  // The flag stays closed until the signals are real. Manifest and catalog have
  // to agree, so flipping one of them alone can never open the gate.
  assert(observability.flagMustRemainFalseUntilValidated === true,
    'OBSERVABILITY_FLAG_CONTRACT', 'The observability flag contract is missing.');
  assert(observability.browserFlag === 'REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY',
    'OBSERVABILITY_FLAG_CONTRACT', 'The observability browser flag name differs.');
  assert(observability.signalsDeployedInStaging === catalog.signalsDeployedInStaging
    && observability.validatedInStaging === catalog.validatedInStaging,
  'OBSERVABILITY_STATE_DRIFT', 'Manifest and catalog disagree on observability state.');
  assert(manifest.flags.multimediaRequiresObservability === true,
    'OBSERVABILITY_FLAG_CONTRACT', 'Multimedia must require observability.');

  // A signal whose collector was never written will never report, no matter how
  // long Staging runs. The manifest has to name those collectors, agree with the
  // catalog about which ones they are, and keep the gate shut while any remain.
  // This is the difference between a signal that is off and one that cannot be
  // turned on as specified, and only the second kind blocks unconditionally.
  const missing = missingCollectors(catalog);
  assert(canonicalJson(observability.collectorsNotImplemented || []) === canonicalJson(missing),
    'OBSERVABILITY_COLLECTOR_DRIFT',
    'Manifest and catalog disagree about which collectors do not exist yet.');
  if (missing.length > 0) {
    assert(observability.signalsDeployedInStaging === false
      && observability.validatedInStaging === false,
    'OBSERVABILITY_COLLECTOR_CLAIM',
    'Signals cannot be declared deployed or validated while a required collector does not exist.');
    assert(manifest.flags.initial[observability.browserFlag] === false,
      'OBSERVABILITY_FLAG_OPEN', 'The observability flag must stay closed while a collector is missing.');
  }
  if (observability.validatedInStaging !== true || observability.signalsDeployedInStaging !== true) {
    assert(manifest.flags.initial[observability.browserFlag] === false,
      'OBSERVABILITY_FLAG_OPEN', 'The observability flag must start false until the signals are validated.');
    assert(manifest.flags.initial.REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED === false,
      'OBSERVABILITY_FLAG_OPEN', 'Multimedia cannot start enabled without validated observability.');
  }

  // The stage allowlist extension is a proposal until it is approved as its own
  // change: it may be written down, it may not be in effect.
  const proposal = manifest.authorizedStagesProposal;
  assert(proposal?.applied === false, 'STAGE_PROPOSAL_APPLIED',
    'The authorized stage extension must not be applied.');
  assert(fs.existsSync(path.join(repoRoot, proposal.document)), 'STAGE_PROPOSAL_MISSING',
    'The authorized stage proposal document is missing.');
  assert(Array.isArray(proposal.proposedStages) && proposal.proposedStages.length > 0
    && proposal.proposedStages.every((stage) => !AUTHORIZED_MANIFEST_STAGES.includes(stage)),
  'STAGE_PROPOSAL_OVERLAP', 'A proposed stage may not already be authorized.');
  return { ok: true };
}

export function validateManifest({ repoRoot = process.cwd(), manifest = loadManifest(repoRoot) } = {}) {
  assert(manifest.schemaVersion === 2, 'MANIFEST_SCHEMA', 'Unsupported manifest schema.');
  assert(canonicalJson(manifest.stages.map(({ name }) => name)) === canonicalJson(STAGE_NAMES),
    'MANIFEST_STAGES', 'Stage list or order differs from the deployment contract.');
  assert(manifest.repository.authorizedHeadArgumentRequired === true,
    'MANIFEST_REPOSITORY_SHA', 'The operational repository SHA must be supplied explicitly.');
  assert(canonicalJson(manifest.repository.requiredMergedPrs) === canonicalJson([122, 123, 124, 125]),
    'MANIFEST_REQUIRED_PRS', 'Required merged PR set differs.');
  assert(manifest.repository.requiredMergeCommits.length === 4
    && manifest.repository.requiredMergeCommits.every((sha) => /^[0-9a-f]{40}$/.test(sha)),
  'MANIFEST_REQUIRED_PRS', 'Required merge commits must be exact full Git SHAs.');
  assert(manifest.environment.name === 'staging', 'ENVIRONMENT_UNKNOWN', 'Only staging is authorized.');
  assert(!manifest.environment.forbiddenProjectRefs.includes(manifest.environment.authorizedProjectRef),
    'PROJECT_REF_COLLISION', 'Authorized project is also forbidden.');
  validateNoEmbeddedSecrets(manifest);

  const expectedMigrations = [
    '20260802090000_tournament_media_upload_pipeline.sql',
    '20260802120000_tournament_media_trusted_processing.sql',
    '20260803090000_tournament_social_studio.sql',
  ];
  const migrations = manifest.migrationPolicy.migrations;
  assert(canonicalJson(migrations.map((item) => path.basename(item.file))) === canonicalJson(expectedMigrations),
    'MIGRATION_ORDER', 'Migration allowlist or order is invalid.');
  const versions = new Set();
  for (const [index, migration] of migrations.entries()) {
    assert(migration.order === index + 1, 'MIGRATION_ORDER', `Invalid order for ${migration.file}.`);
    assert(!versions.has(migration.version), 'MIGRATION_DUPLICATE', `Duplicate ${migration.version}.`);
    versions.add(migration.version);
    assert(fs.existsSync(path.join(repoRoot, migration.file)), 'MIGRATION_MISSING', `${migration.file} is missing.`);
    assert(fileDigest(repoRoot, migration.file) === migration.sha256,
      'MIGRATION_CHECKSUM', `${migration.file} checksum differs from manifest.`);
    assert(fs.existsSync(path.join(repoRoot, migration.rollback)), 'ROLLBACK_MISSING', `${migration.rollback} is missing.`);
    // The rollback is pinned by content, not only by path: a stage may not be authorized against a
    // rollback that was edited after the manifest declared it.
    assert(fileDigest(repoRoot, migration.rollback) === migration.rollbackSha256,
      'ROLLBACK_CHECKSUM', `${migration.rollback} checksum differs from manifest.`);
    const rollbackSql = stripSqlComments(fs.readFileSync(path.join(repoRoot, migration.rollback), 'utf8'));
    assert(!/\b(?:drop|truncate)\b/i.test(rollbackSql) && !/\bdelete\s+from\b/i.test(rollbackSql),
      'ROLLBACK_DESTRUCTIVE', `${migration.rollback} contains automatic destructive SQL.`);
    assert(/\bbegin\s*;/i.test(rollbackSql) && /\bcommit\s*;/i.test(rollbackSql),
      'ROLLBACK_TRANSACTION', `${migration.rollback} must be transactional.`);
  }
  assert(manifest.migrationPolicy.transactionRequired === true
    && manifest.migrationPolicy.oneMigrationPerExecution === true
    && manifest.migrationPolicy.concurrentMigrationPolicy === 'abort'
    && manifest.migrationPolicy.pauseAfterEachMigration === true,
  'MIGRATION_EXECUTION_CONTRACT', 'Migration execution must be transactional, singular, exclusive, and paused.');
  const limits = manifest.migrationPolicy.timeoutLimitsMs;
  const limitContract = {
    lockTimeoutMs: 10000,
    statementTimeoutMs: 300000,
    idleInTransactionSessionTimeoutMs: 120000,
  };
  for (const [name, maximum] of Object.entries(limitContract)) {
    assert(Number.isInteger(limits?.[name]) && limits[name] > 0 && limits[name] === maximum,
      'MIGRATION_TIMEOUT_LIMIT', `${name} limit is missing or invalid.`);
  }
  // The authorized stages are a closed set declared by the manifest itself. Every migration is
  // either bound to exactly one of them or explicitly blocked; there is no third state and no free
  // stage value, so authorizing a new migration is always a reviewable manifest change.
  assert(canonicalJson(manifest.authorizedStages) === canonicalJson(AUTHORIZED_MANIFEST_STAGES),
    'MANIFEST_STAGE_ALLOWLIST', 'Authorized stage allowlist differs from the execution contract.');
  const stageContract = {
    A1: {
      migrationIndex: 0,
      applicationName: 'arma2-torneos-a1-migrate',
      requiresAppliedBefore: [],
      timeouts: { lockTimeoutMs: 5000, statementTimeoutMs: 120000, idleInTransactionSessionTimeoutMs: 60000 },
    },
    A2: {
      migrationIndex: 1,
      applicationName: 'arma2-torneos-a2-migrate',
      requiresAppliedBefore: ['20260802090000'],
      timeouts: { lockTimeoutMs: 5000, statementTimeoutMs: 180000, idleInTransactionSessionTimeoutMs: 60000 },
    },
  };
  for (const [stage, contract] of Object.entries(stageContract)) {
    const migration = migrations[contract.migrationIndex];
    const execution = migration.execution;
    assert(execution.authorizedStage === stage && execution.singleMigrationOnly === true
      && execution.transactionRequired === true && execution.onErrorStop === true
      && execution.applicationName === contract.applicationName
      && execution.projectRef === manifest.environment.authorizedProjectRef
      && execution.repositoryShaSource === 'authorized-argument-must-match-head'
      && execution.checksumRequired === true && execution.versionRequired === true
      && execution.rollbackRequired === true
      && execution.snapshotRequired === true && execution.planRequired === true
      && execution.historyBeforeSource === 'snapshot-exact'
      && execution.historyAfterRule === 'history-before-plus-this-version'
      && canonicalJson(execution.requiresAppliedBefore) === canonicalJson(contract.requiresAppliedBefore)
      && execution.concurrentMigrations === 'abort' && execution.postApplyPause === true,
    'MIGRATION_EXECUTION_CONTRACT', `${stage} execution contract is incomplete.`);
    for (const [name, expected] of Object.entries(contract.timeouts)) {
      const value = execution.timeouts?.[name];
      assert(Number.isInteger(value) && value > 0 && value <= limits[name] && value === expected,
        'MIGRATION_TIMEOUT', `${name} must equal the authorized ${stage} value.`);
    }
    // A stage may only require predecessors that the manifest itself declares, and only ones that
    // sort strictly before it, so no entry can authorize itself or depend on a later migration.
    for (const predecessor of execution.requiresAppliedBefore) {
      const declared = migrations.find((item) => item.version === predecessor);
      assert(declared && declared.order < migration.order, 'MIGRATION_PREDECESSOR',
        `${stage} declares a predecessor that is not an earlier manifest migration.`);
    }
  }
  const socialMigration = migrations[2];
  assert(socialMigration.execution?.blocked === true
    && socialMigration.execution.authorizedStage === null
    && socialMigration.execution.reason === 'outside-authorized-stages',
  'MIGRATION_SCOPE', 'Social must remain explicitly blocked.');
  assert(migrations.filter((item) => item.execution?.authorizedStage !== null
    && item.execution?.authorizedStage !== undefined).length === AUTHORIZED_MANIFEST_STAGES.length,
  'MIGRATION_SCOPE', 'Exactly the authorized stages may carry an execution authorization.');

  const storage = manifest.storage;
  assert(storage.bucket === 'tournament-media' && storage.public === false,
    'STORAGE_CONTRACT', 'Storage bucket must be private tournament-media.');
  assert(storage.maxFileBytes === 12 * 1024 * 1024,
    'STORAGE_CONTRACT', 'Storage limit must be exactly 12 MiB.');
  assert(canonicalJson(storage.allowedMimeTypes) === canonicalJson(['image/jpeg', 'image/png', 'image/webp']),
    'STORAGE_MIME', 'Storage MIME allowlist differs.');
  assert(storage.forbiddenMimeTypes.includes('image/svg+xml'), 'STORAGE_SVG', 'SVG must be forbidden.');
  assert(storage.clientDirectWriteRoles.length === 0, 'STORAGE_CLIENT_WRITE', 'Client writes must be empty.');
  assert(canonicalJson(storage.policies) === canonicalJson([
    'tournament_media_service_read', 'tournament_media_service_insert',
    'tournament_media_service_update', 'tournament_media_service_delete',
  ]), 'STORAGE_POLICIES', 'Storage policy allowlist differs.');

  assert(canonicalJson(manifest.edgeFunctions.map(({ name }) => name)) === canonicalJson([
    'tournament-media-signer', 'tournament-media-processor',
  ]), 'EDGE_ALLOWLIST', 'Edge Function allowlist differs.');
  for (const edge of manifest.edgeFunctions) {
    assert(fileDigest(repoRoot, edge.entrypoint) === edge.sha256,
      'EDGE_CHECKSUM', `${edge.name} checksum differs from manifest.`);
    assert(edge.verifyJwt === true, 'EDGE_JWT', `${edge.name} must verify JWT.`);
  }
  validateAttestationContract({ repoRoot, manifest });
  validateObservabilityContract({ repoRoot, manifest });

  const workerPackage = readJson(path.join(repoRoot, manifest.worker.path, 'package.json'));
  assert(workerPackage.dependencies?.sharp === manifest.worker.sharpVersion,
    'WORKER_SHARP', 'Worker sharp version differs.');
  assert(workerPackage.engines?.node === '22.x', 'WORKER_NODE', 'Worker package must pin Node 22.x.');
  assert(fs.existsSync(path.join(repoRoot, manifest.worker.path, 'package-lock.json')),
    'WORKER_LOCKFILE', 'Worker lockfile is missing.');
  const workerDockerfile = fs.readFileSync(path.join(repoRoot, manifest.worker.path, 'Dockerfile'), 'utf8');
  assert(/^FROM node:22\./m.test(workerDockerfile) && /\bnpm ci\b/.test(workerDockerfile),
    'WORKER_IMAGE', 'Worker image must pin Node 22 and use npm ci.');
  assert(manifest.worker.nodeMajor === 22, 'WORKER_NODE', 'Worker must require Node 22.');
  assert(manifest.worker.clamavRequired && manifest.worker.freshclamRequired,
    'WORKER_ANTIVIRUS', 'Worker must require clamd and freshclam.');

  const qa = readJson(path.join(repoRoot, manifest.qa.matrix));
  assert(qa.roles.length === 12, 'QA_ROLES', 'QA matrix must contain all 12 roles.');
  assert(qa.multimedia.length === 23, 'QA_MULTIMEDIA', 'Multimedia QA matrix is incomplete.');
  assert(qa.social.length === 18, 'QA_SOCIAL', 'Social QA matrix is incomplete.');
  assert(manifest.approvals.singleApplyAllCommand === false,
    'APPROVAL_CONTRACT', 'A single apply-all command is forbidden.');
  return { ok: true, manifestSha256: sha256(canonicalJson(manifest)) };
}

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

const isAncestor = (repoRoot, ancestor, descendant) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

export function validateRepositoryBinding({
  repoRoot = process.cwd(),
  manifest = loadManifest(repoRoot),
  expectedRepositorySha,
  requireClean = true,
} = {}) {
  assert(FULL_GIT_SHA.test(String(expectedRepositorySha || '')), 'REPOSITORY_SHA',
    'A full 40-character lowercase repository SHA is required.');
  const headSha = git(repoRoot, ['rev-parse', 'HEAD']);
  assert(headSha === expectedRepositorySha, 'REPOSITORY_DRIFT',
    'Authorized repository SHA does not match HEAD.');
  const status = git(repoRoot, ['status', '--porcelain']);
  if (requireClean) assert(status === '', 'REPOSITORY_DIRTY', 'Worktree must be clean.');
  const epicRef = `refs/remotes/origin/${manifest.repository.baseBranch}`;
  const requiredEpicAnchor = manifest.repository.requiredMergeCommits.at(-1);
  let epicAnchor = requiredEpicAnchor;
  try { epicAnchor = git(repoRoot, ['rev-parse', '--verify', epicRef]); } catch {
    try { git(repoRoot, ['cat-file', '-e', `${requiredEpicAnchor}^{commit}`]); } catch {
      fail('REPOSITORY_EPIC_REF',
        `Neither ${epicRef} nor the required epic anchor commit is available locally.`);
    }
  }
  assert(isAncestor(repoRoot, epicAnchor, headSha), 'REPOSITORY_EPIC_CONTAINMENT',
    `HEAD must descend from ${manifest.repository.baseBranch}.`);
  for (const [index, mergeCommit] of manifest.repository.requiredMergeCommits.entries()) {
    assert(isAncestor(repoRoot, mergeCommit, headSha), 'REPOSITORY_REQUIRED_PR',
      `HEAD does not include required PR #${manifest.repository.requiredMergedPrs[index]}.`);
  }
  return {
    branch: git(repoRoot, ['branch', '--show-current']),
    headSha,
    clean: status === '',
    epicRef: epicAnchor,
    requiredMergedPrs: [...manifest.repository.requiredMergedPrs],
  };
}

export function inspectRepository({
  repoRoot = process.cwd(), manifest = loadManifest(repoRoot), expectedRepositorySha, requireClean = true,
} = {}) {
  return validateRepositoryBinding({ repoRoot, manifest, expectedRepositorySha, requireClean });
}

export function localMigrationVersions(repoRoot = process.cwd()) {
  return new Set(fs.readdirSync(path.join(repoRoot, 'supabase', 'migrations'))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 14)));
}

const validateUrl = (raw, expectedHost) => {
  let url;
  try { url = new URL(raw); } catch { fail('PROJECT_URL_INVALID', 'Supabase URL is invalid.'); }
  assert(url.protocol === 'https:' && url.hostname === expectedHost && url.port === ''
    && ['', '/'].includes(url.pathname) && !url.username && !url.password && !url.search && !url.hash,
  'PROJECT_URL_MISMATCH', 'Supabase URL does not match the exact authorized project ref.');
};

export function validateState({ repoRoot = process.cwd(), manifest = loadManifest(repoRoot), state }) {
  const expectedRef = manifest.environment.authorizedProjectRef;
  assert(state.environment === 'staging', 'ENVIRONMENT_UNKNOWN', 'State must identify staging exactly.');
  assert(!manifest.environment.forbiddenProjectRefs.includes(state.projectRef),
    'PRODUCTION_FORBIDDEN', 'Production project ref is forbidden.');
  assert(state.projectRef === expectedRef, 'PROJECT_REF_UNKNOWN', 'Project ref is not the authorized staging ref.');
  validateUrl(state.apiUrl, manifest.environment.authorizedApiHost);
  assert(state.credentialProjectRef === expectedRef,
    'CREDENTIAL_PROJECT_MISMATCH', 'Credential belongs to another project.');
  const browserKeys = state.browserEnvironmentKeys || [];
  assert(!browserKeys.some((key) => /SERVICE_ROLE|SECRET_KEYS?|PRIVATE_KEY/i.test(key)),
    'BROWSER_SERVICE_ROLE', 'Privileged credential name is present in browser environment.');

  const localVersions = localMigrationVersions(repoRoot);
  const history = state.remoteHistory || [];
  const seen = new Set();
  for (const entry of history) {
    assert(/^\d{14}$/.test(entry.version), 'MIGRATION_HISTORY_INVALID', 'Remote migration version is invalid.');
    assert(!seen.has(entry.version), 'MIGRATION_DUPLICATE', `Remote history duplicates ${entry.version}.`);
    seen.add(entry.version);
    assert(localVersions.has(entry.version), 'MIGRATION_UNEXPECTED', `Remote migration ${entry.version} is not local.`);
  }
  const target = manifest.migrationPolicy.migrations;
  const appliedTarget = target.filter(({ version }) => seen.has(version));
  assert(canonicalJson(appliedTarget.map(({ version }) => version))
    === canonicalJson(target.slice(0, appliedTarget.length).map(({ version }) => version)),
  'MIGRATION_OUT_OF_ORDER', 'Target migrations are applied out of order.');
  for (const migration of appliedTarget) {
    const remote = history.find(({ version }) => version === migration.version);
    assert(remote.sha256 === migration.sha256, 'MIGRATION_CHECKSUM', `Remote checksum differs for ${migration.version}.`);
  }
  const expectedPending = target.filter(({ version }) => !seen.has(version)).map(({ version }) => version);
  assert(canonicalJson(state.pendingMigrations || []) === canonicalJson(expectedPending),
    'MIGRATION_PENDING_DRIFT', 'Pending migration list differs from inspected history.');

  if (state.storage?.exists) {
    assert(state.storage.bucket === manifest.storage.bucket, 'STORAGE_BUCKET', 'Unexpected bucket name.');
    assert(state.storage.public === false, 'STORAGE_PUBLIC', 'Bucket is public.');
    assert(state.storage.maxFileBytes === manifest.storage.maxFileBytes,
      'STORAGE_SIZE', 'Bucket size limit differs.');
    assert(canonicalJson(state.storage.allowedMimeTypes) === canonicalJson(manifest.storage.allowedMimeTypes),
      'STORAGE_MIME', 'Bucket MIME allowlist differs.');
    const unexpectedPolicies = (state.storage.policies || [])
      .filter((policy) => !manifest.storage.policies.includes(policy));
    assert(unexpectedPolicies.length === 0, 'STORAGE_POLICY_UNEXPECTED', 'Unexpected Storage policy.', { unexpectedPolicies });
    assert(!(state.storage.directWriteRoles || []).some((role) => ['anon', 'authenticated', 'PUBLIC'].includes(role)),
      'STORAGE_CLIENT_WRITE', 'Client has a direct Storage write policy.');
  }

  const expectedEdges = new Map(manifest.edgeFunctions.map((item) => [item.name, item]));
  for (const edge of state.edgeFunctions || []) {
    assert(expectedEdges.has(edge.name), 'EDGE_UNEXPECTED', `Unexpected Edge Function ${edge.name}.`);
    assert(edge.sha256 === expectedEdges.get(edge.name).sha256,
      'EDGE_CHECKSUM', `Edge checksum differs for ${edge.name}.`);
  }
  assert(state.flags?.production === false, 'PRODUCTION_FLAG', 'Production flag must be false.');
  assert(state.flags?.multimedia === false && state.flags?.social === false,
    'FLAGS_NOT_CLOSED', 'Multimedia and Social must start false.');

  // The observability flag may not run ahead of the signals it stands for.
  const observability = state.observability || {};
  for (const field of ['signalsDeployed', 'validatedInStaging']) {
    assert(typeof observability[field] === 'boolean', 'OBSERVABILITY_STATE_MISSING',
      `Inspected state must report observability.${field}.`);
  }
  if (state.flags?.observabilityReady === true) {
    assert(observability.signalsDeployed === true && observability.validatedInStaging === true,
      'OBSERVABILITY_FLAG_DRIFT', 'The observability flag is open without deployed, validated signals.');
  }
  if (manifest.observability.validatedInStaging === false) {
    assert(observability.validatedInStaging === false, 'OBSERVABILITY_STATE_DRIFT',
      'Staging reports validated observability that the manifest does not declare.');
  }
  return { ok: true, stateSha256: sha256(canonicalJson(state)), pendingMigrations: expectedPending };
}

export function buildPlan({
  repoRoot = process.cwd(), manifest = loadManifest(repoRoot), state, repositorySha,
  includeSql = false, createdAt = new Date().toISOString(), ttlSeconds = 1800,
}) {
  const manifestResult = validateManifest({ repoRoot, manifest });
  const stateResult = validateState({ repoRoot, manifest, state });
  assert(FULL_GIT_SHA.test(repositorySha), 'REPOSITORY_SHA', 'Plan requires an exact Git SHA.');
  const created = new Date(createdAt);
  assert(!Number.isNaN(created.valueOf()), 'PLAN_TIME', 'Plan creation time is invalid.');
  assert(Number.isInteger(ttlSeconds) && ttlSeconds > 0 && ttlSeconds <= 3600,
    'PLAN_TTL', 'Plan TTL must be between 1 and 3600 seconds.');
  const pending = manifest.migrationPolicy.migrations
    .filter(({ version }) => stateResult.pendingMigrations.includes(version))
    .map((migration) => {
      const sql = fs.readFileSync(path.join(repoRoot, migration.file), 'utf8');
      return {
        order: migration.order,
        version: migration.version,
        file: migration.file,
        sha256: migration.sha256,
        risk: migration.risk,
        expectedLocks: migration.expectedLocks,
        affected: analyzeSql(sql),
        rollback: migration.rollback,
        ...(includeSql ? { sql } : {}),
      };
    });
  const availableNames = new Set(state.availableSecretNames || []);
  const missingSecretAlternatives = manifest.configuration.secretAlternatives
    .filter((alternatives) => !alternatives.some((name) => availableNames.has(name)));
  const core = {
    schemaVersion: 1,
    environment: manifest.environment.name,
    projectRef: manifest.environment.authorizedProjectRef,
    repositorySha,
    baseBranch: manifest.repository.baseBranch,
    manifestSha256: manifestResult.manifestSha256,
    inspectedStateSha256: stateResult.stateSha256,
    createdAt: created.toISOString(),
    expiresAt: new Date(created.valueOf() + ttlSeconds * 1000).toISOString(),
    migrations: pending,
    storage: {
      action: state.storage?.exists ? 'verify' : 'create',
      ...manifest.storage,
    },
    edgeFunctions: manifest.edgeFunctions.map(({ name, role, sha256: digest, deployOrder, rollback }) => ({
      name, role, sha256: digest, deployOrder, rollback,
      action: (state.edgeFunctions || []).some((edge) => edge.name === name) ? 'verify' : 'deploy',
    })),
    missingSecretAlternatives,
    worker: { action: state.worker?.deployed ? 'verify' : 'provision-manually', contract: manifest.worker },
    signerAttestationRenewal: {
      action: state.signerAttestationRenewer?.deployed ? 'verify' : 'provision-manually',
      contract: manifest.signerAttestationRenewal,
    },
    observability: {
      action: state.observability?.validatedInStaging ? 'verify' : 'deploy-and-validate',
      current: state.observability || null,
      contract: manifest.observability,
    },
    flags: { current: state.flags, requiredOrder: manifest.flags.enableOrder },
    qa: manifest.qa,
    rollback: manifest.rollback,
    approvals: manifest.approvals,
    manualSteps: [
      'authorize each mutating stage independently',
      'pause and verify signer health before processor deploy',
      'provision the external worker outside this repository',
      'provision the signer attestation renewer next to the worker, outside this repository',
      'deploy and validate the observability signals before enabling Multimedia',
      'run revocation proof before enabling Multimedia',
      'record QA receipts before enabling Social',
    ],
  };
  return { ...core, planId: sha256(canonicalJson(core)) };
}

export function stageAuthorization(plan, stage) {
  assert(STAGE_NAMES.includes(stage), 'STAGE_UNKNOWN', `Unknown stage ${stage}.`);
  const prefix = plan.planId.slice(0, 12);
  return {
    confirmation: `APPROVE:${stage}:${plan.projectRef}:${prefix}`,
    token: sha256(`arma2-stage:${stage}:${plan.planId}:${plan.repositorySha}`),
  };
}

export function validateStageReadiness({ manifest, state, stage, input = {} }) {
  assert(manifest.stages.some(({ name }) => name === stage), 'STAGE_UNKNOWN', `Unknown stage ${stage}.`);
  if (stage === 'migrate') {
    assert(state.flags?.multimedia === false && state.flags?.social === false,
      'FLAGS_NOT_CLOSED', 'Flags must be false before migration.');
  }
  if (['storage', 'secrets-check', 'edge-deploy', 'worker-check', 'attest',
    'enable-multimedia', 'qa-multimedia', 'enable-social', 'qa-social'].includes(stage)) {
    assert((state.pendingMigrations || []).length === 0,
      'MIGRATIONS_PENDING', `${stage} requires verified migrations.`);
  }
  if (['secrets-check', 'edge-deploy', 'worker-check', 'attest',
    'enable-multimedia', 'qa-multimedia', 'enable-social', 'qa-social'].includes(stage)) {
    assert(state.storage?.exists === true && state.storage.public === false,
      'STORAGE_NOT_READY', `${stage} requires the private bucket.`);
    assert(canonicalJson(state.storage?.policies || []) === canonicalJson(manifest.storage.policies),
      'STORAGE_POLICIES', `${stage} requires exact Storage policies.`);
  }
  if (['secrets-check', 'edge-deploy', 'worker-check', 'attest',
    'enable-multimedia', 'qa-multimedia', 'enable-social', 'qa-social'].includes(stage)) {
    const names = new Set(state.availableSecretNames || []);
    const missing = manifest.configuration.secretAlternatives
      .filter((alternatives) => !alternatives.some((name) => names.has(name)));
    assert(missing.length === 0, 'SECRET_MISSING', 'Required secret name is missing.', { missing });
  }
  if (stage === 'edge-deploy') {
    const edge = manifest.edgeFunctions.find(({ name }) => name === input.functionName);
    assert(edge, 'EDGE_UNEXPECTED', 'Exact Edge Function name is required.');
    const deployedNames = new Set((state.edgeFunctions || []).map(({ name }) => name));
    if (edge.deployOrder === 2) {
      assert(deployedNames.has('tournament-media-signer'),
        'EDGE_ORDER', 'Signer must be deployed and verified before processor.');
    }
  }
  if (['worker-check', 'attest', 'enable-multimedia', 'qa-multimedia', 'enable-social', 'qa-social'].includes(stage)) {
    const worker = state.worker || {};
    assert(worker.deployed === true, 'WORKER_NOT_DEPLOYED', 'External worker is not deployed.');
    assert(worker.nodeMajor === manifest.worker.nodeMajor && worker.sharpVersion === manifest.worker.sharpVersion
      && worker.libvips === true, 'WORKER_RUNTIME', 'Worker runtime contract differs.');
    assert(worker.clamav === true && worker.clamd === true && worker.freshclam === true,
      'WORKER_ANTIVIRUS', 'Worker antivirus contract is not satisfied.');
    assert(Number(worker.signatureAgeDays) < manifest.worker.maxSignatureAgeDays,
      'WORKER_SIGNATURES_STALE', 'ClamAV signatures are too old.');
    assert(worker.cleanup === true, 'WORKER_CLEANUP', 'Worker cleanup proof is absent.');
    assert(worker.health === true && worker.selfTest === true,
      'WORKER_HEALTH', 'Worker health/self-test is not green.');
  }
  if (stage === 'attest') {
    assert(['signer', 'processor'].includes(input.service), 'ATTEST_SERVICE', 'Exact service is required.');
  }
  if (stage === 'enable-multimedia' || stage === 'qa-multimedia'
    || stage === 'enable-social' || stage === 'qa-social') {
    assert(state.readiness?.uploadReady === true, 'UPLOAD_NOT_READY', 'uploadReady=false blocks enablement.');
    // A pipeline nobody can see may not be a pipeline anybody can use. Both
    // halves are required: signals deployed, and signals proven against
    // Staging. Either one alone keeps the flag closed.
    if (manifest.flags?.multimediaRequiresObservability === true) {
      assert(state.observability?.signalsDeployed === true
        && state.observability?.validatedInStaging === true,
      'OBSERVABILITY_NOT_VALIDATED', `${stage} requires deployed and validated observability signals.`);
      assert(state.observability?.missingRequiredSignals === undefined
        || state.observability.missingRequiredSignals.length === 0,
      'OBSERVABILITY_INCOMPLETE', `${stage} requires every required signal to report a value.`);
      assert(state.flags?.observabilityReady === true,
        'OBSERVABILITY_FLAG_CLOSED', `${stage} requires ${manifest.observability.browserFlag}=true.`);
    }
  }
  if (stage === 'enable-social' || stage === 'qa-social') {
    assert(state.qaReceipts?.multimedia === true, 'SOCIAL_ORDER', 'Social requires Multimedia QA receipt.');
  }
  assert(state.flags?.production === false, 'PRODUCTION_FLAG', 'Production flags can never be enabled.');
  return { ok: true, stage };
}

export function authorizeStage({ manifest, plan, state, stage, repositorySha, confirmation, token, priorReceipt = null }) {
  const contract = manifest.stages.find(({ name }) => name === stage);
  assert(contract, 'STAGE_UNKNOWN', `Unknown stage ${stage}.`);
  assert(contract.mutation, 'STAGE_NOT_MUTATING', `${stage} does not accept mutation authorization.`);
  assert(plan.projectRef === manifest.environment.authorizedProjectRef,
    'PROJECT_REF_UNKNOWN', 'Plan targets an unauthorized ref.');
  assert(plan.environment === 'staging', 'ENVIRONMENT_UNKNOWN', 'Plan environment is not staging.');
  assert(repositorySha === plan.repositorySha, 'REPOSITORY_DRIFT', 'Repository SHA changed after plan.');
  assert(Date.now() < new Date(plan.expiresAt).valueOf(), 'PLAN_EXPIRED', 'Execution plan has expired.');
  const currentManifestSha = sha256(canonicalJson(manifest));
  assert(plan.manifestSha256 === currentManifestSha, 'PLAN_MANIFEST_DRIFT', 'Manifest changed after plan.');
  assert(sha256(canonicalJson(state)) === plan.inspectedStateSha256,
    'STATE_DRIFT', 'State changed after plan.');
  const expected = stageAuthorization(plan, stage);
  assert(confirmation === expected.confirmation, 'APPROVAL_MISSING', `Explicit ${stage} confirmation is missing.`);
  assert(token === expected.token, 'AUTHORIZATION_TOKEN', `Authorization token is invalid for ${stage}.`);
  if (contract.requires?.length) {
    assert(priorReceipt && contract.requires.includes(priorReceipt.stage) && priorReceipt.planId === plan.planId,
      'PRIOR_RECEIPT', `${stage} requires a prior-stage receipt.`);
  }
  return { ok: true, stage, planId: plan.planId, projectRef: plan.projectRef };
}

export function simulateStage({ manifest, plan, state, stage, input = {} }) {
  const next = clone(state);
  switch (stage) {
    case 'migrate':
      for (const migration of plan.migrations) {
        next.remoteHistory.push({ version: migration.version, name: path.basename(migration.file, '.sql').slice(15), status: 'applied', sha256: migration.sha256 });
      }
      next.pendingMigrations = [];
      break;
    case 'storage':
      next.storage = { exists: true, bucket: manifest.storage.bucket, public: false,
        maxFileBytes: manifest.storage.maxFileBytes, allowedMimeTypes: manifest.storage.allowedMimeTypes,
        policies: [...manifest.storage.policies], directWriteRoles: [] };
      break;
    case 'edge-deploy': {
      const edge = manifest.edgeFunctions.find(({ name }) => name === input.functionName);
      assert(edge, 'EDGE_UNEXPECTED', 'Exact Edge Function name is required.');
      assert(!(next.edgeFunctions || []).some(({ name }) => name === edge.name),
        'EDGE_ALREADY_DEPLOYED', 'Edge Function already exists in simulated state.');
      next.edgeFunctions.push({ name: edge.name, sha256: edge.sha256, healthy: true });
      break;
    }
    case 'attest':
      assert(['signer', 'processor'].includes(input.service), 'ATTEST_SERVICE', 'Exact service is required.');
      assert(next.worker?.health && next.worker?.selfTest, 'WORKER_NOT_READY', 'Worker self-test is not green.');
      next.readiness[`${input.service}Attested`] = true;
      next.readiness.uploadReady = next.readiness.signerAttested && next.readiness.processorAttested;
      break;
    case 'enable-multimedia':
      assert(next.readiness?.uploadReady === true, 'UPLOAD_NOT_READY', 'uploadReady=false blocks Multimedia.');
      assert(manifest.flags?.multimediaRequiresObservability !== true
        || (next.observability?.signalsDeployed === true
          && next.observability?.validatedInStaging === true),
      'OBSERVABILITY_NOT_VALIDATED', 'Multimedia cannot be enabled without validated observability.');
      next.flags.multimedia = true;
      break;
    case 'qa-multimedia':
      assert(next.flags.multimedia === true, 'MULTIMEDIA_DISABLED', 'Multimedia QA requires its flag.');
      next.qaReceipts.multimedia = true;
      break;
    case 'enable-social':
      assert(next.qaReceipts?.multimedia === true, 'SOCIAL_ORDER', 'Social requires completed Multimedia QA.');
      next.flags.social = true;
      break;
    case 'qa-social':
      assert(next.flags.social === true, 'SOCIAL_DISABLED', 'Social QA requires its flag.');
      next.qaReceipts.social = true;
      break;
    case 'rollback':
      next.flags.multimedia = false;
      next.flags.social = false;
      next.readiness.uploadReady = false;
      next.readiness.signerAttested = false;
      next.readiness.processorAttested = false;
      next.rollback = { simulated: true, userDataDeleted: false, bucketObjectsDeleted: false };
      break;
    case 'cleanup-local':
      next.cleanup = { localArtifactsRemoved: true, remoteMutations: 0 };
      break;
    default:
      fail('SIMULATION_UNSUPPORTED', `No mutation simulation for ${stage}.`);
  }
  const receipt = { schemaVersion: 1, stage, planId: plan.planId, projectRef: plan.projectRef,
    simulated: true, beforeSha256: sha256(canonicalJson(state)), afterSha256: sha256(canonicalJson(next)) };
  return { state: next, receipt };
}

export function assertSanitizedOutput(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  const forbidden = [
    /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /(?:access_token|refresh_token|service_role_key|password)\s*[=:]\s*["']?[^\s,"']{8,}/i,
    /[?&](?:token|signature|sig)=[^&\s]+/i,
    /"identityMap"\s*:/i,
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), 'OUTPUT_SECRET', `Output matched forbidden pattern ${pattern}.`);
  }
  return true;
}

export function formatHumanPlan(plan) {
  const lines = [
    `PLAN ${plan.planId}`,
    `environment=${plan.environment} projectRef=${plan.projectRef}`,
    `repositorySha=${plan.repositorySha} stateSha256=${plan.inspectedStateSha256}`,
    `migrations=${plan.migrations.length}`,
  ];
  for (const migration of plan.migrations) {
    lines.push(`  ${migration.order}. ${migration.file} sha256=${migration.sha256} risk=${migration.risk}`);
    lines.push(`     locks=${migration.expectedLocks.join('; ')}`);
    lines.push(`     rollback=${migration.rollback}`);
    lines.push(`     affected tables=${migration.affected.tables.length} functions=${migration.affected.functions.length} indexes=${migration.affected.indexes.length} triggers=${migration.affected.triggers.length} grants=${migration.affected.grants}`);
    if (migration.sql) lines.push(`----- SQL ${migration.file} -----\n${migration.sql}\n----- END SQL -----`);
  }
  lines.push(`storage=${plan.storage.action}:${plan.storage.bucket} private=${!plan.storage.public} maxBytes=${plan.storage.maxFileBytes}`);
  lines.push(`edge=${plan.edgeFunctions.map(({ name, action }) => `${name}:${action}`).join(',')}`);
  lines.push(`missingSecrets=${plan.missingSecretAlternatives.map((items) => items.join('|')).join(',') || 'none'}`);
  lines.push(`worker=${plan.worker.action} flags=${plan.flags.requiredOrder.join('>')}`);
  lines.push(`manual=${plan.manualSteps.join(' | ')}`);
  const output = `${lines.join('\n')}\n`;
  assertSanitizedOutput(output);
  return output;
}
