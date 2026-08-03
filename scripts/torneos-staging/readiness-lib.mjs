import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const STAGE_NAMES = Object.freeze([
  'inspect', 'plan', 'dry-run', 'migrate', 'storage', 'secrets-check',
  'edge-deploy', 'worker-check', 'attest', 'enable-multimedia',
  'qa-multimedia', 'enable-social', 'qa-social', 'rollback', 'cleanup-local',
]);

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
  const a1 = migrations[0];
  const execution = a1.execution;
  assert(execution.authorizedStage === 'A1' && execution.singleMigrationOnly === true
    && execution.transactionRequired === true && execution.onErrorStop === true
    && execution.applicationName === 'arma2-torneos-a1-migrate'
    && execution.projectRef === manifest.environment.authorizedProjectRef
    && execution.repositoryShaSource === 'authorized-argument-must-match-head'
    && execution.checksumRequired === true && execution.versionRequired === true
    && execution.snapshotRequired === true && execution.planRequired === true
    && execution.historyBeforeSource === 'snapshot-exact'
    && execution.historyAfterRule === 'history-before-plus-this-version'
    && execution.concurrentMigrations === 'abort' && execution.postApplyPause === true,
  'MIGRATION_EXECUTION_CONTRACT', 'A1 execution contract is incomplete.');
  const expectedTimeouts = {
    lockTimeoutMs: 5000,
    statementTimeoutMs: 120000,
    idleInTransactionSessionTimeoutMs: 60000,
  };
  for (const [name, expected] of Object.entries(expectedTimeouts)) {
    const value = execution.timeouts?.[name];
    assert(Number.isInteger(value) && value > 0 && value <= limits[name] && value === expected,
      'MIGRATION_TIMEOUT', `${name} must equal the authorized A1 value.`);
  }
  assert(migrations.slice(1).every((migration) => migration.execution?.blocked === true
    && migration.execution.authorizedStage === null && migration.execution.reason === 'outside-a1'),
  'MIGRATION_SCOPE', 'A2 and Social must remain explicitly blocked.');

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
  try { git(repoRoot, ['rev-parse', '--verify', epicRef]); } catch {
    fail('REPOSITORY_EPIC_REF', `Missing local remote-tracking ref ${epicRef}.`);
  }
  assert(isAncestor(repoRoot, epicRef, headSha), 'REPOSITORY_EPIC_CONTAINMENT',
    `HEAD must descend from ${manifest.repository.baseBranch}.`);
  for (const [index, mergeCommit] of manifest.repository.requiredMergeCommits.entries()) {
    assert(isAncestor(repoRoot, mergeCommit, headSha), 'REPOSITORY_REQUIRED_PR',
      `HEAD does not include required PR #${manifest.repository.requiredMergedPrs[index]}.`);
  }
  return {
    branch: git(repoRoot, ['branch', '--show-current']),
    headSha,
    clean: status === '',
    epicRef,
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
    flags: { current: state.flags, requiredOrder: manifest.flags.enableOrder },
    qa: manifest.qa,
    rollback: manifest.rollback,
    approvals: manifest.approvals,
    manualSteps: [
      'authorize each mutating stage independently',
      'pause and verify signer health before processor deploy',
      'provision the external worker outside this repository',
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
