import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ReadinessError,
  assertSanitizedOutput,
  authorizeStage,
  buildPlan,
  canonicalJson,
  clone,
  loadManifest,
  readJson,
  simulateStage,
  stageAuthorization,
  validateManifest,
  validateRepositoryBinding,
  validateStageReadiness,
  validateState,
} from './readiness-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = loadManifest(ROOT);
const fixture = () => readJson(path.join(ROOT, 'ops/torneos-staging/fixtures/local-ready.json'));
const HEAD = 'a'.repeat(40);

const expectCode = (code, run) => assert.throws(run, (error) => (
  error instanceof ReadinessError && error.code === code
));

const rejectWithoutMutation = (code, mutate, run = validateState) => {
  const state = fixture();
  mutate(state);
  const before = canonicalJson(state);
  expectCode(code, () => run({ repoRoot: ROOT, manifest, state }));
  assert.equal(canonicalJson(state), before, `${code} must not mutate input state`);
};

test('versioned manifest, checksums, rollbacks, worker and QA contracts are valid', () => {
  const result = validateManifest({ repoRoot: ROOT, manifest });
  assert.equal(result.ok, true);
  assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
});

test('repository binding is dynamic, exact, based on the epic, and includes PRs 122-125', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const result = validateRepositoryBinding({
    repoRoot: ROOT,
    manifest,
    expectedRepositorySha: head,
    requireClean: false,
  });
  assert.equal(result.headSha, head);
  assert.deepEqual(result.requiredMergedPrs, [122, 123, 124, 125]);
  expectCode('REPOSITORY_DRIFT', () => validateRepositoryBinding({
    repoRoot: ROOT,
    manifest,
    expectedRepositorySha: 'f'.repeat(40),
    requireClean: false,
  }));
});

test('A1 and A2 have exact bounded session timeouts and Social remains blocked', () => {
  const [a1, a2, social] = manifest.migrationPolicy.migrations;
  // A1 keeps its historical contract byte for byte.
  assert.deepEqual(a1.execution.timeouts, {
    lockTimeoutMs: 5000,
    statementTimeoutMs: 120000,
    idleInTransactionSessionTimeoutMs: 60000,
  });
  assert.equal(a1.execution.authorizedStage, 'A1');
  assert.equal(a1.execution.transactionRequired, true);
  assert.equal(a1.execution.onErrorStop, true);
  assert.equal(a1.execution.applicationName, 'arma2-torneos-a1-migrate');
  assert.equal(a1.execution.singleMigrationOnly, true);
  assert.deepEqual(a1.execution.requiresAppliedBefore, []);
  // A2 is authorized as its own stage, with its own application name and timeouts, and depends on
  // A1 having been applied first.
  assert.equal(a2.execution.authorizedStage, 'A2');
  assert.deepEqual(a2.execution.timeouts, {
    lockTimeoutMs: 5000,
    statementTimeoutMs: 180000,
    idleInTransactionSessionTimeoutMs: 60000,
  });
  assert.equal(a2.execution.transactionRequired, true);
  assert.equal(a2.execution.onErrorStop, true);
  assert.equal(a2.execution.applicationName, 'arma2-torneos-a2-migrate');
  assert.equal(a2.execution.singleMigrationOnly, true);
  assert.deepEqual(a2.execution.requiresAppliedBefore, ['20260802090000']);
  assert.notEqual(a2.execution.applicationName, a1.execution.applicationName);
  // Social is still outside every authorized stage.
  assert.equal(social.execution.blocked, true);
  assert.equal(social.execution.authorizedStage, null);
  assert.equal(social.execution.reason, 'outside-authorized-stages');
});

test('missing, zero, negative, or over-limit A1 timeouts abort', () => {
  for (const [field, value] of [
    ['lockTimeoutMs', undefined],
    ['lockTimeoutMs', 0],
    ['lockTimeoutMs', -1],
    ['lockTimeoutMs', 10001],
    ['statementTimeoutMs', 300001],
    ['idleInTransactionSessionTimeoutMs', 120001],
  ]) {
    const changed = clone(manifest);
    if (value === undefined) delete changed.migrationPolicy.migrations[0].execution.timeouts[field];
    else changed.migrationPolicy.migrations[0].execution.timeouts[field] = value;
    expectCode('MIGRATION_TIMEOUT', () => validateManifest({ repoRoot: ROOT, manifest: changed }));
  }
});

test('plan and dry-run data are deterministic and can include exact SQL', () => {
  const state = fixture();
  const createdAt = '2099-01-01T00:00:00.000Z';
  const first = buildPlan({ repoRoot: ROOT, manifest, state, repositorySha: HEAD, includeSql: true, createdAt });
  const second = buildPlan({ repoRoot: ROOT, manifest, state, repositorySha: HEAD, includeSql: true, createdAt });
  assert.deepEqual(first, second);
  assert.equal(first.migrations.length, 3);
  assert.match(first.migrations[0].sql, /^-- Arma2 Torneos · Multimedia Upload pipeline/);
  assert.ok(first.migrations.every(({ rollback, affected }) => rollback && affected.functions.length > 0));
  assertSanitizedOutput(first);
});

test('manifest does not claim the three migrations are the only remote history', () => {
  assert.equal(manifest.migrationPolicy.selection, 'explicit-subset-not-complete-remote-history');
  assert.equal(manifest.migrationPolicy.unexpectedRemoteMigration, 'abort');
});

test('production project ref aborts fail-closed', () => {
  rejectWithoutMutation('PRODUCTION_FORBIDDEN', (state) => {
    state.projectRef = manifest.environment.forbiddenProjectRefs[0];
    state.apiUrl = `https://${state.projectRef}.supabase.co`;
    state.credentialProjectRef = state.projectRef;
  });
});

test('unknown project ref aborts fail-closed', () => {
  rejectWithoutMutation('PROJECT_REF_UNKNOWN', (state) => {
    state.projectRef = 'unknownprojectfixture';
    state.apiUrl = 'https://unknownprojectfixture.supabase.co';
    state.credentialProjectRef = state.projectRef;
  });
});

test('production URL paired with staging ref aborts', () => {
  rejectWithoutMutation('PROJECT_URL_MISMATCH', (state) => {
    state.apiUrl = `https://${manifest.environment.forbiddenProjectRefs[0]}.supabase.co`;
  });
});

test('credential from another project aborts', () => {
  rejectWithoutMutation('CREDENTIAL_PROJECT_MISMATCH', (state) => {
    state.credentialProjectRef = 'differentprojectfixture';
  });
});

test('service role in browser environment aborts', () => {
  rejectWithoutMutation('BROWSER_SERVICE_ROLE', (state) => {
    state.browserEnvironmentKeys.push('SUPABASE_SERVICE_ROLE_KEY');
  });
});

test('unexpected remote migration aborts', () => {
  rejectWithoutMutation('MIGRATION_UNEXPECTED', (state) => {
    state.remoteHistory.push({ version: '20990101000000', name: 'unexpected' });
  });
});

test('different applied migration checksum aborts', () => {
  rejectWithoutMutation('MIGRATION_CHECKSUM', (state) => {
    const first = manifest.migrationPolicy.migrations[0];
    state.remoteHistory.push({ version: first.version, name: 'media', sha256: '0'.repeat(64) });
    state.pendingMigrations.shift();
  });
});

test('applied target migration out of order aborts', () => {
  rejectWithoutMutation('MIGRATION_OUT_OF_ORDER', (state) => {
    const second = manifest.migrationPolicy.migrations[1];
    state.remoteHistory.push({ version: second.version, name: 'trusted', sha256: second.sha256 });
    state.pendingMigrations = [manifest.migrationPolicy.migrations[0].version, manifest.migrationPolicy.migrations[2].version];
  });
});

test('public bucket aborts', () => {
  rejectWithoutMutation('STORAGE_PUBLIC', (state) => {
    state.storage.exists = true;
    state.storage.public = true;
  });
});

test('unexpected policy and client write policy abort', () => {
  rejectWithoutMutation('STORAGE_POLICY_UNEXPECTED', (state) => {
    state.storage.exists = true;
    state.storage.policies = ['authenticated_can_upload'];
  });
  rejectWithoutMutation('STORAGE_CLIENT_WRITE', (state) => {
    state.storage.exists = true;
    state.storage.policies = [];
    state.storage.directWriteRoles = ['authenticated'];
  });
});

test('unexpected Edge Function aborts', () => {
  rejectWithoutMutation('EDGE_UNEXPECTED', (state) => {
    state.edgeFunctions.push({ name: 'deploy-everything', sha256: '0'.repeat(64) });
  });
});

const readyState = () => {
  const state = fixture();
  state.pendingMigrations = [];
  for (const migration of manifest.migrationPolicy.migrations) {
    state.remoteHistory.push({ version: migration.version, name: 'fixture', status: 'applied', sha256: migration.sha256 });
  }
  state.storage = { exists: true, bucket: manifest.storage.bucket, public: false,
    maxFileBytes: manifest.storage.maxFileBytes, allowedMimeTypes: manifest.storage.allowedMimeTypes,
    policies: [...manifest.storage.policies], directWriteRoles: [] };
  state.availableSecretNames = ['SUPABASE_SECRET_KEYS', 'SUPABASE_PUBLISHABLE_KEYS', 'TOURNAMENT_MEDIA_ATTESTATION_SECRET'];
  state.worker = { deployed: true, nodeMajor: 22, sharpVersion: '0.33.5', libvips: true,
    clamav: true, clamd: true, freshclam: true, signatureAgeDays: 0, cleanup: true,
    health: true, selfTest: true, attested: false };
  return state;
};

test('missing secret name aborts before Edge deploy', () => {
  const state = readyState();
  state.availableSecretNames = ['SUPABASE_SECRET_KEYS'];
  expectCode('SECRET_MISSING', () => validateStageReadiness({ manifest, state, stage: 'edge-deploy', input: { functionName: 'tournament-media-signer' } }));
});

test('worker without antivirus, fresh signatures or cleanup aborts', () => {
  for (const [field, code, value] of [
    ['clamav', 'WORKER_ANTIVIRUS', false],
    ['signatureAgeDays', 'WORKER_SIGNATURES_STALE', 7],
    ['cleanup', 'WORKER_CLEANUP', false],
  ]) {
    const state = readyState();
    state.worker[field] = value;
    expectCode(code, () => validateStageReadiness({ manifest, state, stage: 'worker-check' }));
  }
});

test('processor Edge deploy requires a verified signer first', () => {
  const state = readyState();
  expectCode('EDGE_ORDER', () => validateStageReadiness({
    manifest, state, stage: 'edge-deploy', input: { functionName: 'tournament-media-processor' },
  }));
});

test('uploadReady=false and Social-before-Multimedia both abort', () => {
  const state = readyState();
  expectCode('UPLOAD_NOT_READY', () => validateStageReadiness({ manifest, state, stage: 'enable-multimedia' }));
  state.readiness.uploadReady = true;
  expectCode('SOCIAL_ORDER', () => validateStageReadiness({ manifest, state, stage: 'enable-social' }));
});

test('mutating stage requires exact plan, explicit confirmation, token and prior receipt', () => {
  const state = fixture();
  const plan = buildPlan({ repoRoot: ROOT, manifest, state, repositorySha: HEAD });
  const original = clone(state);
  expectCode('APPROVAL_MISSING', () => authorizeStage({
    manifest, plan, state, stage: 'migrate', repositorySha: HEAD,
    confirmation: '', token: '', priorReceipt: { stage: 'dry-run', planId: plan.planId },
  }));
  assert.deepEqual(state, original);
  const approval = stageAuthorization(plan, 'migrate');
  assert.equal(authorizeStage({
    manifest, plan, state, stage: 'migrate', repositorySha: HEAD,
    ...approval, priorReceipt: { stage: 'dry-run', planId: plan.planId },
  }).ok, true);
});

test('repository or inspected state drift invalidates authorization', () => {
  const state = fixture();
  const plan = buildPlan({ repoRoot: ROOT, manifest, state, repositorySha: HEAD });
  const approval = stageAuthorization(plan, 'migrate');
  expectCode('REPOSITORY_DRIFT', () => authorizeStage({
    manifest, plan, state, stage: 'migrate', repositorySha: 'b'.repeat(40),
    ...approval, priorReceipt: { stage: 'dry-run', planId: plan.planId },
  }));
  const drifted = clone(state);
  drifted.worker.health = true;
  expectCode('STATE_DRIFT', () => authorizeStage({
    manifest, plan, state: drifted, stage: 'migrate', repositorySha: HEAD,
    ...approval, priorReceipt: { stage: 'dry-run', planId: plan.planId },
  }));
});

test('simulated rollback disables flags and attestations without deleting user data', () => {
  const state = fixture();
  state.flags.multimedia = true;
  state.flags.social = true;
  state.readiness = { uploadReady: true, signerAttested: true, processorAttested: true };
  state.userDataFixture = [{ id: 'preserved' }];
  const plan = buildPlan({ repoRoot: ROOT, manifest, state: { ...state, flags: { ...state.flags, multimedia: false, social: false }, readiness: { uploadReady: false, signerAttested: false, processorAttested: false } }, repositorySha: HEAD });
  const result = simulateStage({ manifest, plan, state, stage: 'rollback' });
  assert.equal(result.state.flags.multimedia, false);
  assert.equal(result.state.flags.social, false);
  assert.deepEqual(result.state.userDataFixture, state.userDataFixture);
  assert.equal(result.state.rollback.userDataDeleted, false);
});

test('output sanitizer rejects JWTs, signed URLs, passwords and identity maps', () => {
  for (const output of [
    'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop',
    'https://example.invalid/file?token=secret-value',
    'password=should-never-print',
    '{"identityMap":{"owner":"person"}}',
  ]) expectCode('OUTPUT_SECRET', () => assertSanitizedOutput(output));
});

test('Production flag always aborts stage readiness', () => {
  const state = readyState();
  state.flags.production = true;
  expectCode('PRODUCTION_FLAG', () => validateStageReadiness({ manifest, state, stage: 'worker-check' }));
});
