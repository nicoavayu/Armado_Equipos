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
  computeMigrationDrift,
  stripSourceComments,
  validateAttestationContract,
  validateManifest,
  validateObservabilityContract,
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

/**
 * The state an operator would have AFTER deploying and validating the signals
 * in Staging. It is deliberately not the default: every enablement test has to
 * opt into it, so a regression that drops the gate shows up as a passing test
 * that should have failed.
 */
const observedState = (state) => {
  state.observability = {
    signalsDeployed: true, validatedInStaging: true, missingRequiredSignals: [], catalogMetrics: 20,
  };
  state.flags.observabilityReady = true;
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
  observedState(state);
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

// --- attestation contract: the manifest may not describe code that does not exist

test('the manifest describes the real attestation behaviour of both Edge Functions', () => {
  const [signer, processor] = manifest.edgeFunctions;
  assert.deepEqual(signer.attests, ['signer']);
  assert.deepEqual(signer.revokesOnHealth, []);
  assert.equal(signer.attestationTtlSeconds, 3600);
  // The drift the audit found: the processor health does NOT certify the
  // processor tier. It revokes a stale attestation and writes none.
  assert.deepEqual(processor.attests, []);
  assert.deepEqual(processor.revokesOnHealth, ['processor']);
  assert.equal(processor.attestationTtlSeconds, null);
  assert.equal(processor.processorAttestationOwner, 'workers/tournament-media-processor');
  assert.match(processor.healthContract, /REVOKES/);
  assert.doesNotMatch(processor.healthContract, /processor attestation$/);
  assert.equal(validateAttestationContract({ repoRoot: ROOT, manifest }).ok, true);
});

test('a manifest that claims the processor attests is rejected against the source', () => {
  const changed = clone(manifest);
  changed.edgeFunctions[1].attests = ['processor'];
  expectCode('ATTESTATION_CONTRACT', () => validateManifest({ repoRoot: ROOT, manifest: changed }));

  const claimsTtl = clone(manifest);
  claimsTtl.edgeFunctions[1].attestationTtlSeconds = 900;
  expectCode('ATTESTATION_TTL', () => validateManifest({ repoRoot: ROOT, manifest: claimsTtl }));

  const dropsRevocation = clone(manifest);
  dropsRevocation.edgeFunctions[1].revokesOnHealth = [];
  expectCode('ATTESTATION_CONTRACT', () => validateManifest({ repoRoot: ROOT, manifest: dropsRevocation }));

  const wrongSignerTtl = clone(manifest);
  wrongSignerTtl.edgeFunctions[0].attestationTtlSeconds = 7200;
  expectCode('ATTESTATION_TTL', () => validateManifest({ repoRoot: ROOT, manifest: wrongSignerTtl }));
});

test('the signer renewal contract renews before expiry, alerts in time and holds no service credential', () => {
  const renewal = manifest.signerAttestationRenewal;
  assert.equal(renewal.required, true);
  assert.equal(renewal.attestationTtlSeconds, 3600);
  assert.ok(renewal.intervalSeconds * (1 + renewal.jitterRatio) < renewal.attestationTtlSeconds / 2);
  assert.ok(renewal.alertAfterConsecutiveFailures * renewal.intervalSeconds < renewal.attestationTtlSeconds);
  assert.equal(renewal.idempotent, true);
  assert.equal(renewal.holdsServiceCredential, false);
  assert.ok(renewal.timeoutMs > 0 && renewal.maxAttempts >= 1);
  assert.ok(renewal.backoffMaxMs >= renewal.backoffBaseMs);

  const slow = clone(manifest);
  slow.signerAttestationRenewal.intervalSeconds = 3000;
  expectCode('ATTESTATION_RENEWAL_UNSAFE', () => validateManifest({ repoRoot: ROOT, manifest: slow }));

  const lateAlert = clone(manifest);
  lateAlert.signerAttestationRenewal.alertAfterConsecutiveFailures = 4;
  expectCode('ATTESTATION_RENEWAL_UNSAFE', () => validateManifest({ repoRoot: ROOT, manifest: lateAlert }));

  const privileged = clone(manifest);
  privileged.signerAttestationRenewal.holdsServiceCredential = true;
  expectCode('ATTESTATION_RENEWAL', () => validateManifest({ repoRoot: ROOT, manifest: privileged }));
});

test('the renewal scheduler stays unconfigured and undeployed, and names its owners', () => {
  const { scheduler } = manifest.signerAttestationRenewal;
  assert.equal(scheduler.configuredInThisChange, false);
  assert.equal(scheduler.deployedInThisChange, false);
  assert.ok(scheduler.stagingOwner.length > 10);
  assert.ok(scheduler.productionOwner.length > 10);
  assert.ok(scheduler.rejectedAlternatives.some((entry) => /pg_cron/.test(entry)),
    'the alternative that would expose the secret has to be recorded as rejected');
  for (const field of ['configuredInThisChange', 'deployedInThisChange']) {
    const changed = clone(manifest);
    changed.signerAttestationRenewal.scheduler[field] = true;
    expectCode('ATTESTATION_RENEWAL_SCOPE', () => validateManifest({ repoRoot: ROOT, manifest: changed }));
  }
});

// --- observability ---------------------------------------------------------

test('every required signal has a metric, and every catalog metric is required', () => {
  const result = validateObservabilityContract({ repoRoot: ROOT, manifest });
  assert.equal(result.ok, true);
  const catalog = readJson(path.join(ROOT, manifest.observability.catalog));
  const signals = new Set(catalog.metrics.map(({ signal }) => signal));
  for (const required of manifest.observability.requiredSignals) {
    assert.ok(signals.has(required), `${required} has no metric`);
  }
  for (const signal of signals) {
    assert.ok(manifest.observability.requiredSignals.includes(signal), `${signal} is not required`);
  }
  // The minimum the audit demanded, by name.
  for (const signal of [
    'quarantine-depth', 'queue-depth', 'job-age', 'expired-leases', 'stuck-leases',
    'attestation-expiry', 'clamav-signature-age', 'selftest-failures', 'cleanup-failures',
    'residual-probe-objects', 'residual-selftest-objects',
    'signer-latency', 'signer-error-rate', 'processor-latency', 'processor-error-rate',
  ]) {
    assert.ok(signals.has(signal), `${signal} is missing from the catalog`);
  }
});

test('a required signal without a metric, or a metric nobody requires, aborts', () => {
  const orphanSignal = clone(manifest);
  orphanSignal.observability.requiredSignals.push('signal-nobody-implemented');
  expectCode('OBSERVABILITY_SIGNAL_MISSING',
    () => validateManifest({ repoRoot: ROOT, manifest: orphanSignal }));

  const droppedSignal = clone(manifest);
  droppedSignal.observability.requiredSignals = droppedSignal.observability.requiredSignals
    .filter((signal) => signal !== 'queue-depth');
  expectCode('OBSERVABILITY_SIGNAL_UNDECLARED',
    () => validateManifest({ repoRoot: ROOT, manifest: droppedSignal }));
});

test('the observability flag stays closed until the signals are deployed and validated', () => {
  assert.equal(manifest.observability.validatedInStaging, false);
  assert.equal(manifest.observability.signalsDeployedInStaging, false);
  assert.equal(manifest.flags.initial.REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY, false);
  assert.equal(manifest.flags.multimediaRequiresObservability, true);

  // Opening the flag while the signals are not validated is a manifest error.
  const openedFlag = clone(manifest);
  openedFlag.flags.initial.REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY = true;
  expectCode('OBSERVABILITY_FLAG_OPEN', () => validateManifest({ repoRoot: ROOT, manifest: openedFlag }));

  // And so is claiming validation in only one of the two places.
  const halfClaimed = clone(manifest);
  halfClaimed.observability.validatedInStaging = true;
  expectCode('OBSERVABILITY_STATE_DRIFT', () => validateManifest({ repoRoot: ROOT, manifest: halfClaimed }));
});

test('enablement stages abort while observability is not deployed and validated', () => {
  for (const stage of ['enable-multimedia', 'qa-multimedia', 'enable-social', 'qa-social']) {
    const state = readyState();
    state.readiness.uploadReady = true;
    state.qaReceipts.multimedia = true;
    expectCode('OBSERVABILITY_NOT_VALIDATED',
      () => validateStageReadiness({ manifest, state, stage }));
  }
  // Deployed but not validated is still closed.
  const halfway = readyState();
  halfway.readiness.uploadReady = true;
  halfway.observability = { signalsDeployed: true, validatedInStaging: false, missingRequiredSignals: [] };
  expectCode('OBSERVABILITY_NOT_VALIDATED',
    () => validateStageReadiness({ manifest, state: halfway, stage: 'enable-multimedia' }));

  // Validated but with a signal reporting nothing is closed too: fail-closed on
  // absence, not "mostly observable".
  const incomplete = observedState(readyState());
  incomplete.readiness.uploadReady = true;
  incomplete.observability.missingRequiredSignals = ['arma2_torneos_media_queue_depth'];
  expectCode('OBSERVABILITY_INCOMPLETE',
    () => validateStageReadiness({ manifest, state: incomplete, stage: 'enable-multimedia' }));

  // Signals validated but the browser flag still closed is also a stop.
  const flagClosed = observedState(readyState());
  flagClosed.readiness.uploadReady = true;
  flagClosed.flags.observabilityReady = false;
  expectCode('OBSERVABILITY_FLAG_CLOSED',
    () => validateStageReadiness({ manifest, state: flagClosed, stage: 'enable-multimedia' }));

  // With everything in place the stage is allowed.
  const ready = observedState(readyState());
  ready.readiness.uploadReady = true;
  assert.equal(validateStageReadiness({ manifest, state: ready, stage: 'enable-multimedia' }).ok, true);
});

test('simulated Multimedia enablement is impossible without validated observability', () => {
  const state = readyState();
  state.readiness = { uploadReady: true, signerAttested: true, processorAttested: true };
  const plan = buildPlan({ repoRoot: ROOT, manifest, state: fixture(), repositorySha: HEAD });
  expectCode('OBSERVABILITY_NOT_VALIDATED',
    () => simulateStage({ manifest, plan, state, stage: 'enable-multimedia' }));
  const observed = observedState(clone(state));
  assert.equal(simulateStage({ manifest, plan, state: observed, stage: 'enable-multimedia' })
    .state.flags.multimedia, true);
});

test('the inspected state may not open the flag ahead of the signals', () => {
  rejectWithoutMutation('OBSERVABILITY_FLAG_DRIFT', (state) => {
    state.flags.observabilityReady = true;
  });
  rejectWithoutMutation('OBSERVABILITY_STATE_DRIFT', (state) => {
    state.observability.validatedInStaging = true;
  });
  rejectWithoutMutation('OBSERVABILITY_STATE_MISSING', (state) => {
    delete state.observability.signalsDeployed;
  });
});

// --- the stage allowlist stays closed --------------------------------------

test('the authorized stage extension is a proposal, not an authorization', () => {
  assert.deepEqual(manifest.authorizedStages, ['A1', 'A2']);
  const proposal = manifest.authorizedStagesProposal;
  assert.equal(proposal.applied, false);
  assert.deepEqual(proposal.proposedStages, ['A3', 'A4', 'A5', 'A6']);
  for (const stage of proposal.proposedStages) {
    assert.ok(!manifest.authorizedStages.includes(stage), `${stage} must not be authorized yet`);
  }
  const applied = clone(manifest);
  applied.authorizedStagesProposal.applied = true;
  expectCode('STAGE_PROPOSAL_APPLIED', () => validateManifest({ repoRoot: ROOT, manifest: applied }));

  const extended = clone(manifest);
  extended.authorizedStages = ['A1', 'A2', 'A3'];
  expectCode('MANIFEST_STAGE_ALLOWLIST', () => validateManifest({ repoRoot: ROOT, manifest: extended }));
});

// --- drift detection may not be fooled, or tripped, by prose ----------------

test('the drift regexes read code, not comments', () => {
  const source = [
    '// This function must never call revoke_tournament_media_service_attestation.',
    '/* Nor attest_tournament_media_service, however tempting. */',
    'const label = "attest_tournament_media_service is mentioned in this string";',
    'const url = "https://example.invalid/a//b";',
    'await client.rpc("attest_tournament_media_service", { p_service: \'signer\' });',
  ].join('\n');
  const stripped = stripSourceComments(source);

  // Comments are gone...
  assert.doesNotMatch(stripped, /must never call/);
  assert.doesNotMatch(stripped, /however tempting/);
  // ...but code, and strings inside code, survive intact.
  assert.match(stripped, /p_service: 'signer'/);
  assert.match(stripped, /is mentioned in this string/);
  assert.match(stripped, /example\.invalid\/a\/\/b/, 'a // inside a string is not a comment');
  // Line count is preserved so any later message still points at the right line.
  assert.equal(stripped.split('\n').length, source.split('\n').length);

  // The concrete consequence: a file that only talks about attesting no longer
  // satisfies a positive check, and a file that only warns about revoking no
  // longer trips a negative one.
  const talksOnly = '// calls attest_tournament_media_service with p_service: "signer"\nexport const noop = () => {};';
  assert.doesNotMatch(stripSourceComments(talksOnly), /attest_tournament_media_service/);
});

test('the real Edge Function sources still satisfy the contract once comments are stripped', () => {
  // Guards the fix itself: stripping must not have broken the positive checks.
  assert.equal(validateAttestationContract({ repoRoot: ROOT, manifest }).ok, true);
});

// --- migration drift, over what the remote actually exposes -----------------

test('migration drift counts version presence and order, never a remote checksum', () => {
  const state = fixture();
  const clean = computeMigrationDrift({ repoRoot: ROOT, manifest, state });
  assert.equal(clean.drift, 0);
  assert.match(clean.observedFrom, /no checksum/);

  const duplicated = fixture();
  duplicated.remoteHistory = [...(duplicated.remoteHistory || []), ...(duplicated.remoteHistory || [])];
  if (duplicated.remoteHistory.length > 0) {
    const withDuplicates = computeMigrationDrift({ repoRoot: ROOT, manifest, state: duplicated });
    assert.ok(withDuplicates.drift > 0);
    assert.ok(withDuplicates.details.duplicatedRemoteVersions.length > 0);
  }

  const foreign = fixture();
  foreign.remoteHistory = [...(foreign.remoteHistory || []), { version: '29991231235959', name: 'not_in_this_repository' }];
  const withForeign = computeMigrationDrift({ repoRoot: ROOT, manifest, state: foreign });
  assert.ok(withForeign.details.remoteVersionsWithoutLocalFile.includes('29991231235959'));
  assert.ok(withForeign.drift >= 1);

  // Nothing counted comes from a checksum, because the remote exposes none.
  // The only mention of the word is the explanation of why.
  assert.equal(JSON.stringify(withForeign.details).includes('checksum'), false);
  assert.deepEqual(Object.keys(withForeign.details).sort(), [
    'duplicatedRemoteVersions', 'remoteVersionsWithoutLocalFile', 'targetVersionsAppliedOutOfOrder',
  ]);
});

// --- the deploy-blocking contracts the manifest now carries -----------------

test('the manifest keeps the gateway credential separate from the attestation secret', () => {
  const gateway = manifest.signerAttestationRenewal.gatewayCredential;
  assert.equal(gateway.separateFromAttestationSecret, true);
  assert.equal(gateway.mustSatisfyVerifyJwt, true);
  assert.ok(gateway.rejected.some((entry) => /sb_publishable_/.test(entry)));

  const conflated = clone(manifest);
  conflated.signerAttestationRenewal.gatewayCredential.mustSatisfyVerifyJwt = false;
  expectCode('ATTESTATION_RENEWAL_CREDENTIAL',
    () => validateManifest({ repoRoot: ROOT, manifest: conflated }));

  const permissive = clone(manifest);
  permissive.signerAttestationRenewal.gatewayCredential.rejected = ['nothing in particular'];
  expectCode('ATTESTATION_RENEWAL_CREDENTIAL',
    () => validateManifest({ repoRoot: ROOT, manifest: permissive }));
});

test('the manifest requires --once to be able to alert at all', () => {
  const once = manifest.signerAttestationRenewal.onceMode;
  assert.equal(once.statePersisted, true);
  assert.equal(once.stateFileMode, '0600');
  assert.equal(once.exclusiveLock, true);
  assert.equal(once.corruptionFailsClosed, true);
  assert.ok(once.orchestratorAlternative.length > 20);

  const unsafe = clone(manifest);
  unsafe.signerAttestationRenewal.onceMode.corruptionFailsClosed = false;
  expectCode('ATTESTATION_RENEWAL_STATE', () => validateManifest({ repoRoot: ROOT, manifest: unsafe }));
});

test('the manifest declares the Staging probe as prepared, gated and never executed', () => {
  const probe = manifest.signerAttestationRenewal.gatewayProbe;
  assert.equal(probe.executedInThisChange, false);
  assert.equal(probe.requiresExplicitAuthorization, true);
  assert.match(probe.writes, /attestation/i);

  const executed = clone(manifest);
  executed.signerAttestationRenewal.gatewayProbe.executedInThisChange = true;
  expectCode('ATTESTATION_PROBE_SCOPE', () => validateManifest({ repoRoot: ROOT, manifest: executed }));
});

test('a collector the catalog does not have keeps the manifest gate shut', () => {
  assert.deepEqual(manifest.observability.collectorsNotImplemented,
    ['database', 'readiness', 'runtime', 'storage']);
  assert.equal(manifest.observability.collectorContract.grantedInThisChange, false);

  const pretending = clone(manifest);
  pretending.observability.collectorsNotImplemented = [];
  expectCode('OBSERVABILITY_COLLECTOR_DRIFT',
    () => validateObservabilityContract({ repoRoot: ROOT, manifest: pretending }));
});
