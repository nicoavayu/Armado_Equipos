import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { clone, loadManifest, readJson } from './readiness-lib.mjs';
import {
  COLLECTOR_ROLE_CONTRACT,
  ObservabilityError,
  assertCollectorVisibility,
  assertSnapshotIsAnonymous,
  deriveSustainedSeconds,
  evaluateMetric,
  evaluateObservability,
  loadCatalog,
  missingCollectors,
  observabilityReadiness,
  snapshotFromCollectorPhases,
  validateCatalog,
  worstSeverityOf,
} from './observability-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catalog = loadCatalog(ROOT);
const manifest = loadManifest(ROOT);
const snapshot = () => readJson(path.join(ROOT, 'ops/torneos-staging/fixtures/observability-snapshot.json'));
const metricByName = (name) => catalog.metrics.find((metric) => metric.name === name);
const phases = readJson(path.join(ROOT, 'ops/torneos-staging/fixtures/observability-collector-phases.json')).cases;
/** The two rows of one collector case, as the SQL files would return them. */
const phaseCase = (name) => clone(phases[name]);
/** A snapshot assembled through the real two-phase contract. */
const fromPhases = (name, mutate = () => {}) => {
  const rows = phaseCase(name);
  mutate(rows);
  return snapshotFromCollectorPhases({ preflight: rows.preflight, metrics: rows.metrics });
};

const expectCode = (code, run) => assert.throws(run, (error) => (
  error instanceof ObservabilityError && error.code === code
));

const evaluate = (mutate = () => {}) => {
  const state = snapshot();
  mutate(state);
  return evaluateObservability({ repoRoot: ROOT, catalog, snapshot: state });
};

const severityOf = (evaluation, name) => evaluation.metrics.find((metric) => metric.name === name)?.severity;

// --- the catalog itself ----------------------------------------------------

test('the catalog declares a complete contract for every metric', () => {
  const result = validateCatalog({ repoRoot: ROOT, catalog });
  assert.equal(result.ok, true);
  assert.ok(result.metricCount >= 19);
  for (const metric of catalog.metrics) {
    assert.ok(metric.thresholds.some(({ severity }) => severity === 'critical'), metric.name);
    assert.ok(metric.recovery && typeof metric.recovery.value === 'number', metric.name);
    assert.ok(metric.runbook.startsWith('docs/'), metric.name);
    assert.ok(fs.existsSync(path.join(ROOT, metric.runbook.split('#')[0])), metric.runbook);
  }
});

test('a metric without a threshold, a recovery condition or a runbook is rejected', () => {
  const noThreshold = clone(catalog);
  noThreshold.metrics[0].thresholds = [];
  expectCode('OBSERVABILITY_THRESHOLD', () => validateCatalog({ repoRoot: ROOT, catalog: noThreshold }));

  const noCritical = clone(catalog);
  noCritical.metrics[0].thresholds = noCritical.metrics[0].thresholds
    .filter(({ severity }) => severity !== 'critical');
  expectCode('OBSERVABILITY_SEVERITY', () => validateCatalog({ repoRoot: ROOT, catalog: noCritical }));

  const noRecovery = clone(catalog);
  delete noRecovery.metrics[0].recovery;
  expectCode('OBSERVABILITY_RECOVERY', () => validateCatalog({ repoRoot: ROOT, catalog: noRecovery }));

  const noRunbook = clone(catalog);
  noRunbook.metrics[0].runbook = 'docs/operations/does-not-exist.md';
  expectCode('OBSERVABILITY_RUNBOOK_MISSING', () => validateCatalog({ repoRoot: ROOT, catalog: noRunbook }));

  const strayNamespace = clone(catalog);
  strayNamespace.metrics[0].name = 'some_other_service_queue_depth';
  expectCode('OBSERVABILITY_METRIC_NAME', () => validateCatalog({ repoRoot: ROOT, catalog: strayNamespace }));

  const unknownCollector = clone(catalog);
  unknownCollector.metrics[0].source.collector = 'somewhere';
  expectCode('OBSERVABILITY_COLLECTOR', () => validateCatalog({ repoRoot: ROOT, catalog: unknownCollector }));
});

test('retention is declared and never below the documented minimum', () => {
  assert.equal(catalog.retention.metricsDays, 30);
  assert.equal(catalog.retention.alertEventsDays, 90);
  assert.equal(catalog.retention.structuredLogsDays, 14);
  assert.equal(catalog.retention.minimumRecommendedDays, 14);
  const short = clone(catalog);
  short.retention.structuredLogsDays = 7;
  expectCode('OBSERVABILITY_RETENTION', () => validateCatalog({ repoRoot: ROOT, catalog: short }));
});

test('the catalog forbids identifying labels and identifying log content', () => {
  for (const label of ['organization_id', 'tournament_id', 'gallery_id', 'user_id', 'object_name', 'job_id']) {
    assert.ok(catalog.labelPolicy.forbiddenLabels.includes(label), label);
  }
  const prohibited = catalog.prohibitedInLogsAndMetrics.join(' ').toLowerCase();
  for (const item of ['object names', 'signed urls', 'lease tokens', 'attestation secret', 'identity maps']) {
    assert.ok(prohibited.includes(item), item);
  }
});

// --- the read-only collector query -----------------------------------------

test('the database collector query is read-only and returns nothing identifying', () => {
  const sql = fs.readFileSync(path.join(ROOT, manifest.observability.query), 'utf8');
  const body = sql.replace(/--.*$/gm, '');
  for (const forbidden of [
    /\binsert\b/i, /\bupdate\b/i, /\bdelete\b/i, /\bcreate\b/i, /\bdrop\b/i,
    /\balter\b/i, /\bgrant\b/i, /\brevoke\b/i, /\btruncate\b/i,
  ]) {
    assert.doesNotMatch(body, forbidden, `${forbidden} must not appear in the collector query`);
  }
  // It reads the queue and the attestations, and it selects no identifying column.
  assert.match(body, /tournament_media_processing_jobs/);
  assert.match(body, /tournament_media_service_attestations/);
  for (const column of ['quarantine_path', 'lease_token', 'requested_by', 'organization_id', 'gallery_id', 'worker_id', 'session_id']) {
    assert.doesNotMatch(body, new RegExp(`'[^']*',\\s*[^)]*${column}`), column);
  }
  // uploadReady is the database's verdict, never recomputed here.
  assert.match(body, /tournament_media_pipeline_readiness\(\)/);
});

// --- evaluation ------------------------------------------------------------

test('the healthy fixture is fully observable with no alerts', () => {
  const evaluation = evaluate();
  assert.equal(evaluation.observable, true);
  assert.deepEqual(evaluation.missingRequired, []);
  assert.equal(evaluation.worstSeverity, 'ok');
  assert.deepEqual(evaluation.alerts, []);
});

test('a missing metric is unknown, and unknown makes the pipeline unobservable', () => {
  const evaluation = evaluate((state) => { delete state.database.queueDepth; });
  assert.equal(severityOf(evaluation, 'arma2_torneos_media_queue_depth'), 'unknown');
  assert.deepEqual(evaluation.missingRequired, ['arma2_torneos_media_queue_depth']);
  assert.equal(evaluation.observable, false, 'absence must never read as health');
  // A collector that stops reporting is not "ok": the metric is not an alert,
  // and precisely for that reason readiness has to close on it.
  assert.deepEqual(evaluation.alerts, []);
  const missing = snapshot();
  delete missing.database.queueDepth;
  assert.equal(observabilityReadiness({ repoRoot: ROOT, catalog, snapshot: missing }).ready, false);
});

test('queue depth and job age escalate warning then critical', () => {
  const warning = evaluate((state) => { state.database.queueDepth = 30; });
  assert.equal(severityOf(warning, 'arma2_torneos_media_queue_depth'), 'warning');
  const critical = evaluate((state) => { state.database.queueDepth = 150; });
  assert.equal(severityOf(critical, 'arma2_torneos_media_queue_depth'), 'critical');
  const stale = evaluate((state) => { state.database.oldestJobAgeSeconds = 4000; });
  assert.equal(severityOf(stale, 'arma2_torneos_media_oldest_job_age_seconds'), 'critical');
  assert.equal(stale.worstSeverity, 'critical');
  assert.ok(stale.alerts.some((alert) => alert.metric === 'arma2_torneos_media_oldest_job_age_seconds'
    && alert.runbook.includes('#job-age')));
});

test('a threshold with a dwell time does not fire on a single spike', () => {
  const spike = evaluate((state) => {
    state.database.queueDepth = 150;
    state.database.queueDepthSustainedSeconds = 30;
  });
  assert.equal(severityOf(spike, 'arma2_torneos_media_queue_depth'), 'ok');
  const sustained = evaluate((state) => {
    state.database.queueDepth = 150;
    state.database.queueDepthSustainedSeconds = 600;
  });
  assert.equal(severityOf(sustained, 'arma2_torneos_media_queue_depth'), 'critical');
});

test('an expired or stuck lease alerts, and a clean sweep recovers', () => {
  const expired = evaluate((state) => {
    state.database.expiredLeases = 3;
    state.database.stuckLeaseAgeSeconds = 400;
  });
  assert.equal(severityOf(expired, 'arma2_torneos_media_expired_leases'), 'warning');
  assert.equal(severityOf(expired, 'arma2_torneos_media_stuck_lease_age_seconds'), 'warning');
  const stuck = evaluate((state) => {
    state.database.expiredLeases = 9;
    state.database.stuckLeaseAgeSeconds = 1200;
  });
  assert.equal(severityOf(stuck, 'arma2_torneos_media_expired_leases'), 'critical');
  assert.equal(severityOf(stuck, 'arma2_torneos_media_stuck_lease_age_seconds'), 'critical');
  const swept = evaluate();
  const metric = swept.metrics.find(({ name }) => name === 'arma2_torneos_media_expired_leases');
  assert.equal(metric.recovered, true);
});

test('a ClamAV signature set approaching seven days alerts before the self-test fails', () => {
  const fiveDays = 5 * 24 * 3600;
  const warning = evaluate((state) => { state.database.clamavSignatureAgeSeconds = fiveDays; });
  assert.equal(severityOf(warning, 'arma2_torneos_media_clamav_signature_age_seconds'), 'warning');
  // Just under five days is still quiet, so the alert really is the five-day mark.
  const quiet = evaluate((state) => { state.database.clamavSignatureAgeSeconds = fiveDays - 60; });
  assert.equal(severityOf(quiet, 'arma2_torneos_media_clamav_signature_age_seconds'), 'ok');
  // Seven days is where the worker self-test fails by contract.
  const critical = evaluate((state) => { state.database.clamavSignatureAgeSeconds = 7 * 24 * 3600; });
  assert.equal(severityOf(critical, 'arma2_torneos_media_clamav_signature_age_seconds'), 'critical');
  assert.equal(manifest.worker.maxSignatureAgeDays, 7);
});

test('an attestation approaching expiry alerts, and an absent one reads as expired', () => {
  const warning = evaluate((state) => { state.database.signerAttestationExpiresInSeconds = 1100; });
  assert.equal(severityOf(warning, 'arma2_torneos_media_signer_attestation_expires_in_seconds'), 'warning');
  const critical = evaluate((state) => { state.database.signerAttestationExpiresInSeconds = 300; });
  assert.equal(severityOf(critical, 'arma2_torneos_media_signer_attestation_expires_in_seconds'), 'critical');
  // The query reports -1 for an absent row: absent must be worse than fresh,
  // never unknown.
  const absent = evaluate((state) => { state.database.processorAttestationExpiresInSeconds = -1; });
  assert.equal(severityOf(absent, 'arma2_torneos_media_processor_attestation_expires_in_seconds'), 'critical');
  const processorWarning = evaluate((state) => { state.database.processorAttestationExpiresInSeconds = 280; });
  assert.equal(severityOf(processorWarning, 'arma2_torneos_media_processor_attestation_expires_in_seconds'), 'warning');
});

test('consecutive renewal failures alert before the signer attestation can expire', () => {
  const renewal = manifest.signerAttestationRenewal;
  const one = evaluate((state) => { state.runtime.attestationRenewalConsecutiveFailures = 1; });
  assert.equal(severityOf(one, 'arma2_torneos_media_signer_attestation_renewal_failures_consecutive'), 'warning');
  const two = evaluate((state) => { state.runtime.attestationRenewalConsecutiveFailures = 2; });
  assert.equal(severityOf(two, 'arma2_torneos_media_signer_attestation_renewal_failures_consecutive'), 'critical');
  // The critical threshold has to be reached with TTL still to spare.
  const critical = metricByName('arma2_torneos_media_signer_attestation_renewal_failures_consecutive')
    .thresholds.find(({ severity }) => severity === 'critical');
  assert.ok(critical.value * renewal.intervalSeconds < renewal.attestationTtlSeconds);
});

test('self-test and cleanup failures alert on the first occurrence', () => {
  const selfTest = evaluate((state) => { state.runtime.selfTestFailures15m = 1; });
  assert.equal(severityOf(selfTest, 'arma2_torneos_media_selftest_failures_total'), 'warning');
  const repeated = evaluate((state) => { state.runtime.selfTestFailures15m = 4; });
  assert.equal(severityOf(repeated, 'arma2_torneos_media_selftest_failures_total'), 'critical');
  const cleanup = evaluate((state) => { state.runtime.cleanupFailures30m = 1; });
  assert.equal(severityOf(cleanup, 'arma2_torneos_media_cleanup_failures_total'), 'warning');
});

test('residual _probe/ and _selftest/ objects alert', () => {
  const residue = evaluate((state) => {
    state.storage.residualProbeObjects = 2;
    state.storage.residualSelfTestObjects = 3;
  });
  assert.equal(severityOf(residue, 'arma2_torneos_media_residual_probe_objects'), 'warning');
  assert.equal(severityOf(residue, 'arma2_torneos_media_residual_selftest_objects'), 'warning');
  const many = evaluate((state) => {
    state.storage.residualProbeObjects = 12;
    state.storage.residualSelfTestObjects = 40;
  });
  assert.equal(severityOf(many, 'arma2_torneos_media_residual_probe_objects'), 'critical');
  assert.equal(severityOf(many, 'arma2_torneos_media_residual_selftest_objects'), 'critical');
  // The catalog counts objects under the prefixes; it never carries their names.
  for (const name of ['arma2_torneos_media_residual_probe_objects', 'arma2_torneos_media_residual_selftest_objects']) {
    assert.equal(metricByName(name).type, 'gauge');
    assert.ok(metricByName(name).source.prefix.startsWith('_'));
  }
});

test('signer and processor latency and error ratios alert', () => {
  const slow = evaluate((state) => {
    state.runtime.signerLatencyP95Ms = 3200;
    state.runtime.processorLatencyP95Ms = 1600;
  });
  assert.equal(severityOf(slow, 'arma2_torneos_media_signer_latency_p95_ms'), 'critical');
  assert.equal(severityOf(slow, 'arma2_torneos_media_processor_latency_p95_ms'), 'warning');
  const failing = evaluate((state) => {
    state.runtime.signerErrorRatio = 0.12;
    state.runtime.processorErrorRatio = 0.03;
  });
  assert.equal(severityOf(failing, 'arma2_torneos_media_signer_error_ratio'), 'critical');
  assert.equal(severityOf(failing, 'arma2_torneos_media_processor_error_ratio'), 'warning');
});

test('uploadReady falling and migration drift are alerts of their own', () => {
  const closed = evaluate((state) => { state.database.uploadReady = 0; });
  assert.equal(severityOf(closed, 'arma2_torneos_media_upload_ready'), 'critical');
  const drift = evaluate((state) => { state.readiness.migrationDrift = 1; });
  assert.equal(severityOf(drift, 'arma2_torneos_media_migration_drift'), 'critical');
});

// --- nothing identifying may pass through ----------------------------------

test('a snapshot carrying an identifying field or value is refused', () => {
  expectCode('SNAPSHOT_IDENTIFYING_FIELD', () => evaluate((state) => {
    state.database.oldestJobId = 4;
  }));
  expectCode('SNAPSHOT_IDENTIFYING_FIELD', () => evaluate((state) => {
    state.storage.oldestObjectName = 'anything';
  }));
  expectCode('SNAPSHOT_IDENTIFYING_VALUE', () => evaluate((state) => {
    state.storage.oldestResidual = '3f1a2b4c-1111-2222-3333-444455556666/x.png';
  }));
  expectCode('SNAPSHOT_IDENTIFYING_VALUE', () => evaluate((state) => {
    state.runtime.lastError = 'https://example.invalid/object?token=abc123';
  }));
  assert.equal(assertSnapshotIsAnonymous(snapshot()), true);
});

test('a UUID is caught wherever it sits inside a string, not only at its start', () => {
  // The pattern used to be anchored at the start of the value, so a UUID one
  // character into a message walked straight through the check.
  const embedded = [
    'job 3f1a2b4c-1111-2222-3333-444455556666 abandoned after 3 attempts',
    'lease held by 3f1a2b4c-1111-2222-3333-444455556666',
    'prefix:3f1a2b4c-1111-2222-3333-444455556666:suffix',
    '3F1A2B4C-1111-2222-3333-444455556666 in upper case',
  ];
  for (const value of embedded) {
    expectCode('SNAPSHOT_IDENTIFYING_VALUE',
      () => assertSnapshotIsAnonymous({ runtime: { note: value } }));
  }
  // Inside an array and inside a nested object too.
  expectCode('SNAPSHOT_IDENTIFYING_VALUE', () => assertSnapshotIsAnonymous({
    runtime: { notes: ['fine', { deeper: 'saw 3f1a2b4c-1111-2222-3333-444455556666 here' }] },
  }));
  // A filename mid-string is caught as well, not only as a suffix.
  expectCode('SNAPSHOT_IDENTIFYING_VALUE', () => assertSnapshotIsAnonymous({
    runtime: { note: 'failed on cover.png while processing' },
  }));
  // And something that merely looks hex-ish is not a false positive.
  assert.equal(assertSnapshotIsAnonymous({ runtime: { note: 'release abc1234 deadbeef' } }), true);
});

// --- the readiness gate ----------------------------------------------------

/** A hypothetical future catalog whose collectors all exist. Never the shipped one. */
const withCollectorsBuilt = (source = catalog) => {
  const built = clone(source);
  for (const collector of Object.values(built.collectors)) {
    collector.implemented = true;
    collector.implementedBy = 'package.json';
  }
  return built;
};

test('observability is not ready while the signals are undeployed or unvalidated', () => {
  const notDeployed = observabilityReadiness({ repoRoot: ROOT, catalog, snapshot: snapshot() });
  assert.equal(notDeployed.ready, false);
  assert.deepEqual(notDeployed.blockers, [
    'collectors.not_implemented:database',
    'collectors.not_implemented:readiness',
    'collectors.not_implemented:runtime',
    'collectors.not_implemented:storage',
    'signals.not_deployed',
    'signals.not_validated',
  ]);

  const deployedOnly = withCollectorsBuilt();
  deployedOnly.signalsDeployedInStaging = true;
  assert.deepEqual(
    observabilityReadiness({ repoRoot: ROOT, catalog: deployedOnly, snapshot: snapshot() }).blockers,
    ['signals.not_validated'],
  );

  const validated = withCollectorsBuilt();
  validated.signalsDeployedInStaging = true;
  validated.validatedInStaging = true;
  assert.equal(observabilityReadiness({ repoRoot: ROOT, catalog: validated, snapshot: snapshot() }).ready, true);

  // Even fully declared, a critical signal or a missing one keeps it closed.
  const incomplete = snapshot();
  delete incomplete.database.queueDepth;
  assert.deepEqual(
    observabilityReadiness({ repoRoot: ROOT, catalog: validated, snapshot: incomplete }).blockers,
    ['signals.incomplete'],
  );
  const critical = snapshot();
  critical.database.uploadReady = 0;
  assert.deepEqual(
    observabilityReadiness({ repoRoot: ROOT, catalog: validated, snapshot: critical }).blockers,
    ['signals.critical'],
  );
  // No snapshot at all is the most closed state of the three.
  assert.deepEqual(
    observabilityReadiness({ repoRoot: ROOT, catalog: validated }).blockers,
    ['signals.no_snapshot'],
  );
});

test('the shipped catalog keeps the flag closed', () => {
  assert.equal(catalog.signalsDeployedInStaging, false);
  assert.equal(catalog.validatedInStaging, false);
  assert.equal(manifest.observability.signalsDeployedInStaging, false);
  assert.equal(manifest.observability.validatedInStaging, false);
  assert.equal(manifest.flags.initial.REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY, false);
});

test('evaluateMetric reports the breached threshold and its recovery condition', () => {
  const metric = metricByName('arma2_torneos_media_queue_depth');
  const evaluated = evaluateMetric(metric, { database: { queueDepth: 150, queueDepthSustainedSeconds: 1200 } });
  assert.equal(evaluated.severity, 'critical');
  assert.equal(evaluated.breached.value, 100);
  assert.equal(evaluated.recovery.comparator, '<');
  assert.equal(evaluated.recovery.value, 10);
  assert.equal(evaluated.recovered, false);
});

// --- H1: the collector may not mistake invisibility for health --------------

test('the preflight touches no protected table, so it can report their absence', () => {
  const sql = fs.readFileSync(path.join(ROOT, manifest.observability.preflightQuery), 'utf8');
  // Everything the role contract is asserted with.
  assert.match(sql, /relrowsecurity/);
  assert.match(sql, /relforcerowsecurity/);
  assert.match(sql, /rolbypassrls/);
  assert.match(sql, /has_table_privilege/);
  assert.match(sql, /has_function_privilege/);
  assert.match(sql, /to_regclass/);
  assert.match(sql, /to_regprocedure/);
  assert.match(sql, /'phase',\s*'preflight'/);

  // The load-bearing property: the protected tables are NEVER named as
  // relations. `to_regclass('public.' || quote_ident(...))` resolves them from
  // a VALUES list of strings, so they never enter the range table and can
  // therefore never cause a parse error or a privilege error.
  const body = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  for (const table of COLLECTOR_ROLE_CONTRACT.requiredTables) {
    assert.doesNotMatch(body, new RegExp(`FROM\\s+public\\.${table}`, 'i'),
      `the preflight must not read ${table}`);
    assert.doesNotMatch(body, new RegExp(`JOIN\\s+public\\.${table}`, 'i'));
  }
  assert.doesNotMatch(body, /public\.tournament_media_pipeline_readiness\s*\(\s*\)\s*(?:->>|->)/,
    'the preflight must probe the function by privilege, never call it');
  // Only catalog relations may appear in a FROM/JOIN.
  const relations = [...body.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_.]*)/gi)]
    .map(([, name]) => name.toLowerCase())
    .filter((name) => name.includes('.'));
  for (const relation of relations) {
    assert.ok(relation.startsWith('pg_catalog.'),
      `the preflight may only read pg_catalog, found ${relation}`);
  }
  assert.equal(COLLECTOR_ROLE_CONTRACT.grantsInThisChange, false);
  assert.equal(COLLECTOR_ROLE_CONTRACT.phases.length, 2);
});

test('the metrics query is honest that it cannot guard itself', () => {
  const sql = fs.readFileSync(path.join(ROOT, manifest.observability.query), 'utf8');
  assert.match(sql, /'phase',\s*'metrics'/);
  // The counts are no longer wrapped in a CASE that never protected anything.
  assert.doesNotMatch(sql, /CASE WHEN \(SELECT ok FROM gate\) THEN/,
    'the removed gate looked like a guard and could not be one');
  // It states its precondition where somebody about to run it will read it.
  assert.match(sql, /PRECONDITION/);
  assert.match(sql, /media-pipeline-preflight\.sql/);
  // It carries the identity the evaluator pairs on.
  assert.match(sql, /current_user/);
  assert.match(sql, /current_database/);
  // The manifest names both halves, and they exist.
  assert.ok(fs.existsSync(path.join(ROOT, manifest.observability.preflightQuery)));
  assert.equal(manifest.observability.collectorContract.phases, 2);
});

test('a collector that cannot see the tables never reaches the counts', () => {
  const blind = phaseCase('rls-blind');
  // The preflight refused, so Phase B was never run: there are no metrics.
  assert.equal(blind.preflight.observable, false);
  assert.equal(blind.metrics, undefined);
  expectCode('COLLECTOR_VISIBILITY_UNPROVEN',
    () => snapshotFromCollectorPhases({ preflight: blind.preflight, metrics: {} }));
  // Fail-closed all the way to the flag, and as a verdict rather than a crash.
  const readiness = observabilityReadiness({
    repoRoot: ROOT,
    catalog,
    snapshot: { collectedAt: null, database: { collector: {}, visibility: blind.preflight } },
  });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.startsWith('signals.unproven:')));
});

test('each way the role contract can fail is a named blocker, not an exception', () => {
  // Every one of these was previously unreportable: the statement failed with
  // the very condition it was supposed to describe.
  const cases = {
    'table-absent': 'tournament_media_processing_jobs:table_absent',
    'no-select-privilege': 'tournament_media_service_attestations:no_select_privilege',
    'no-execute-privilege': 'tournament_media_pipeline_readiness:no_execute_privilege',
    'force-rls-on-owned-table': 'tournament_media_processing_jobs:rls_forced_on_owned_table',
    'rls-blind': 'tournament_media_processing_jobs:rls_enabled_with_policies_and_without_bypass',
  };
  for (const [name, blocker] of Object.entries(cases)) {
    const { preflight } = phaseCase(name);
    assert.equal(preflight.observable, false, `${name} must not be observable`);
    assert.ok(preflight.blockers.includes(blocker),
      `${name} must report ${blocker}, got ${JSON.stringify(preflight.blockers)}`);
    expectCode('COLLECTOR_VISIBILITY_UNPROVEN',
      () => snapshotFromCollectorPhases({ preflight, metrics: {} }));
  }
});

test('ownership exempts from RLS only while FORCE is off', () => {
  const forced = phaseCase('force-rls-on-owned-table').preflight
    .tables.tournament_media_processing_jobs;
  assert.equal(forced.isOwner, true);
  assert.equal(forced.rlsForced, true);
  assert.equal(forced.rlsExempt, false, 'FORCE filters the owner like anybody else');

  const unforced = phaseCase('owner-without-force').preflight
    .tables.tournament_media_processing_jobs;
  assert.equal(unforced.isOwner, true);
  assert.equal(unforced.rlsForced, false);
  assert.equal(unforced.rlsExempt, true);
  // And that collector's counts are believed.
  const evaluation = evaluateObservability({
    repoRoot: ROOT,
    catalog,
    snapshot: deriveSustainedSeconds({
      catalog,
      snapshot: { ...snapshot(), database: fromPhases('owner-without-force').database },
      at: Date.parse('2099-01-01T01:00:00Z'),
    }).snapshot,
  });
  assert.equal(evaluation.observable, true);
});

test('metrics without a preflight are refused, however complete they look', () => {
  const good = phaseCase('observable-and-idle');

  // No preflight at all.
  expectCode('COLLECTOR_PREFLIGHT_MISSING',
    () => snapshotFromCollectorPhases({ metrics: good.metrics }));
  // Something that is not a preflight row.
  expectCode('COLLECTOR_PREFLIGHT_MISSING', () => snapshotFromCollectorPhases({
    preflight: { ...good.preflight, phase: 'metrics' }, metrics: good.metrics,
  }));
  // No metrics.
  expectCode('COLLECTOR_METRICS_MISSING',
    () => snapshotFromCollectorPhases({ preflight: good.preflight }));
  // A contract version nobody here understands.
  expectCode('COLLECTOR_CONTRACT_VERSION', () => snapshotFromCollectorPhases({
    preflight: { ...good.preflight, contractVersion: 2 }, metrics: good.metrics,
  }));

  // And a hand-assembled visibility block cannot impersonate a proof: only
  // snapshotFromCollectorPhases may stamp provenBy.
  const forged = snapshot();
  delete forged.database.visibility.provenBy;
  expectCode('COLLECTOR_PREFLIGHT_MISSING', () => assertCollectorVisibility(forged));
  expectCode('COLLECTOR_PREFLIGHT_MISSING',
    () => evaluateObservability({ repoRoot: ROOT, catalog, snapshot: forged }));

  const noProof = snapshot();
  delete noProof.database.visibility;
  expectCode('COLLECTOR_VISIBILITY_MISSING', () => assertCollectorVisibility(noProof));

  const partialProof = snapshot();
  delete partialProof.database.visibility.tables.tournament_media_processing_jobs;
  expectCode('COLLECTOR_VISIBILITY_MISSING', () => assertCollectorVisibility(partialProof));
});

test('the two phases must be about the same role, database and moment', () => {
  const mismatches = {
    'a different role': (rows) => { rows.metrics.collector.role = 'somebody_else'; },
    'a different database': (rows) => { rows.metrics.collector.database = 'other_db'; },
    'metrics before the proof': (rows) => { rows.metrics.collectedAt = '2098-12-31T23:00:00.000Z'; },
    'a stale proof': (rows) => { rows.metrics.collectedAt = '2099-01-01T01:00:00.000Z'; },
    'an unnamed role': (rows) => { delete rows.metrics.collector.role; },
  };
  for (const [what, mutate] of Object.entries(mismatches)) {
    expectCode('COLLECTOR_PHASE_MISMATCH', () => fromPhases('observable-and-idle', mutate));
    assert.ok(what);
  }
  // The unmutated pair is accepted, and carries the proof forward.
  const assembled = fromPhases('observable-and-idle');
  assert.equal(assembled.database.visibility.provenBy, 'preflight');
  assert.equal(assembled.database.visibility.observable, true);
  assert.equal(assembled.database.collector.role, 'torneos_media_observability_collector');
  assert.equal(assembled.database.queueDepth, 0);
  // The envelope fields do not leak into the metric namespace.
  for (const key of ['phase', 'contractVersion']) {
    assert.ok(!(key in assembled.database), `${key} must not become a metric path`);
  }
});

test('zero real rows and zero rows because of RLS are not the same answer', () => {
  // The whole point of the split: the blind collector produces NO counts at
  // all, because Phase B is never run. There is nothing to mistake for health.
  const blind = phaseCase('rls-blind');
  const idle = phaseCase('observable-and-idle');
  assert.equal(blind.metrics, undefined, 'a blind collector must never reach Phase B');
  assert.equal(idle.metrics.queueDepth, 0);

  // The proven-idle collector evaluates as healthy...
  const derived = deriveSustainedSeconds({
    catalog,
    snapshot: { ...snapshot(), database: fromPhases('observable-and-idle').database },
    at: Date.parse('2099-01-01T01:00:00Z'),
  });
  const evaluation = evaluateObservability({ repoRoot: ROOT, catalog, snapshot: derived.snapshot });
  assert.equal(evaluation.observable, true, 'a genuinely empty queue is observable and healthy');
  assert.equal(evaluation.worstSeverity, 'ok');
  assert.equal(evaluation.metrics.find((m) => m.name === 'arma2_torneos_media_queue_depth').value, 0);

  // ...and the blind one cannot be assembled into a snapshot at all, even if a
  // caller pairs its refusal with a full set of counts it did not earn.
  expectCode('COLLECTOR_VISIBILITY_UNPROVEN', () => snapshotFromCollectorPhases({
    preflight: blind.preflight,
    metrics: { ...idle.metrics, collector: blind.preflight.collector },
  }));
});

// --- M1: dwell time is measured, never assumed ------------------------------

test('the literal SQL output carries no dwell, so a breaching value is unknown', () => {
  // The real query emits instantaneous values only: one scrape cannot know how
  // long anything has held. This is that exact shape, with a breaching value.
  const literal = {
    ...snapshot(),
    database: fromPhases('observable-and-idle', (rows) => { rows.metrics.queueDepth = 40; }).database,
  };
  assert.equal(literal.database.queueDepthSustainedSeconds, undefined);

  const evaluated = evaluateMetric(metricByName('arma2_torneos_media_queue_depth'), literal);
  assert.equal(evaluated.value, 40);
  assert.equal(evaluated.severity, 'unknown');
  assert.equal(evaluated.reason, 'dwell_unknown');
  assert.equal(evaluated.undecidableSeverity, 'warning');
  // Never Infinity: the old default asserted "true forever" and fired instantly.
  assert.equal(evaluated.sustainedSeconds, null);

  const evaluation = evaluateObservability({ repoRoot: ROOT, catalog, snapshot: literal });
  assert.equal(evaluation.observable, false);
  assert.ok(evaluation.missingRequired.includes('arma2_torneos_media_queue_depth'));
});

test('a value that breaches nothing needs no dwell', () => {
  const literal = { ...snapshot(), database: fromPhases('observable-and-idle').database };
  const evaluated = evaluateMetric(metricByName('arma2_torneos_media_queue_depth'), literal);
  assert.equal(evaluated.severity, 'ok', 'an untripped threshold does not need a window');
  assert.equal(evaluated.sustainedSeconds, null);
});

test('a dwell-free threshold still decides without a window', () => {
  const literal = {
    ...snapshot(),
    database: fromPhases('observable-and-idle', (rows) => {
      rows.metrics.signerAttestationExpiresInSeconds = 300;
    }).database,
  };
  // forSeconds is 0 on the attestation thresholds, so this is decidable now.
  const evaluated = evaluateMetric(metricByName('arma2_torneos_media_signer_attestation_expires_in_seconds'), literal);
  assert.equal(evaluated.severity, 'critical');
});

test('the collector derives dwell across scrapes, per severity band', () => {
  const at0 = Date.parse('2099-01-01T00:00:00Z');
  const base = {
    ...snapshot(),
    database: fromPhases('observable-and-idle', (rows) => { rows.metrics.queueDepth = 30; }).database,
  };

  // First scrape: the band has been observed for zero seconds, which is honest.
  const first = deriveSustainedSeconds({ catalog, snapshot: base, at: at0 });
  assert.equal(first.snapshot.database.queueDepthSustainedSeconds, 0);
  assert.equal(first.state.bands.arma2_torneos_media_queue_depth.band, 'warning');
  assert.equal(evaluateMetric(metricByName('arma2_torneos_media_queue_depth'), first.snapshot).severity, 'ok',
    'a fresh breach has not yet met its 600s window');

  // Eleven minutes later, still in the warning band: the window is met.
  const later = deriveSustainedSeconds({
    catalog, snapshot: base, previous: first.state, at: at0 + 660_000,
  });
  assert.equal(later.snapshot.database.queueDepthSustainedSeconds, 660);
  assert.equal(evaluateMetric(metricByName('arma2_torneos_media_queue_depth'), later.snapshot).severity, 'warning');

  // A wiggle inside the same band does not restart the clock...
  const wiggled = { ...base, database: { ...base.database, queueDepth: 33 } };
  const stillWarning = deriveSustainedSeconds({
    catalog, snapshot: wiggled, previous: later.state, at: at0 + 720_000,
  });
  assert.equal(stillWarning.snapshot.database.queueDepthSustainedSeconds, 720);

  // ...but leaving the band does.
  const recovered = { ...base, database: { ...base.database, queueDepth: 1 } };
  const reset = deriveSustainedSeconds({
    catalog, snapshot: recovered, previous: stillWarning.state, at: at0 + 780_000,
  });
  assert.equal(reset.snapshot.database.queueDepthSustainedSeconds, 0);
  assert.equal(reset.state.bands.arma2_torneos_media_queue_depth.band, 'ok');
});

test('derived dwell state is small, anonymous and safe to persist', () => {
  const derived = deriveSustainedSeconds({ catalog, snapshot: snapshot(), at: Date.now() });
  assert.equal(derived.state.schemaVersion, 1);
  assert.doesNotThrow(() => assertSnapshotIsAnonymous(derived.state));
  for (const entry of Object.values(derived.state.bands)) {
    assert.deepEqual(Object.keys(entry).sort(), ['band', 'since']);
  }
});

// --- M2: metrics nobody can collect ----------------------------------------

test('every collector says whether it exists, and none of them does yet', () => {
  assert.deepEqual(missingCollectors(catalog), ['database', 'readiness', 'runtime', 'storage']);
  for (const [name, collector] of Object.entries(catalog.collectors)) {
    assert.equal(collector.implemented, false, name);
    assert.ok(collector.blocker.length >= 20, `${name} must say what is missing`);
    assert.ok(collector.plannedSource.length >= 20, `${name} must name a concrete source`);
  }
  // And the manifest agrees, so neither file can open the gate alone.
  assert.deepEqual(manifest.observability.collectorsNotImplemented, missingCollectors(catalog));
});

test('a collector that claims an implementation it does not have is rejected', () => {
  const lying = clone(catalog);
  lying.collectors.storage.implemented = true;
  lying.collectors.storage.implementedBy = 'scripts/does-not-exist.mjs';
  expectCode('OBSERVABILITY_COLLECTOR_STATUS', () => validateCatalog({ repoRoot: ROOT, catalog: lying }));

  const vague = clone(catalog);
  delete vague.collectors.runtime.plannedSource;
  expectCode('OBSERVABILITY_COLLECTOR_SOURCE', () => validateCatalog({ repoRoot: ROOT, catalog: vague }));

  const undefinedSource = clone(catalog);
  delete undefinedSource.metrics[0].source.definition;
  expectCode('OBSERVABILITY_SOURCE_DEFINITION',
    () => validateCatalog({ repoRoot: ROOT, catalog: undefinedSource }));
});

test('signals cannot be declared live while a collector does not exist', () => {
  const premature = clone(catalog);
  premature.signalsDeployedInStaging = true;
  expectCode('OBSERVABILITY_COLLECTOR_CLAIM', () => validateCatalog({ repoRoot: ROOT, catalog: premature }));
});

test('migration drift is defined over versions, never over a remote checksum', () => {
  const metric = metricByName('arma2_torneos_media_migration_drift');
  // The remote migration history exposes version and name only. The inspector
  // records checksum: null and says so in its own limitations, so a metric
  // defined over remote checksums could never have reported at all.
  assert.match(metric.source.definition, /version presence and order/i);
  assert.doesNotMatch(metric.description, /checksum differs/i);
  assert.match(metric.description, /never a checksum comparison/i);
  const inspector = fs.readFileSync(path.join(ROOT, 'scripts/torneos-staging/inspect-remote-readonly-lib.mjs'), 'utf8');
  assert.match(inspector, /Remote migration history does not expose checksums/);
});

// --- L: a summary that cannot hide a page ----------------------------------

test('an unknown metric never masks a critical one in the worst severity', () => {
  // The bug: the threshold-escalation order puts `unknown` above `critical`,
  // because for "could this missing dwell window change the verdict?" it does.
  // Reusing that order for the summary meant one absent signal downgraded a
  // real page to `unknown`, and an on-call dashboard showed the wrong thing.
  assert.equal(worstSeverityOf(['ok', 'unknown', 'critical']), 'critical');
  assert.equal(worstSeverityOf(['critical', 'unknown']), 'critical');
  assert.equal(worstSeverityOf(['warning', 'unknown']), 'unknown', 'unknown still outranks warning');
  assert.equal(worstSeverityOf(['ok', 'warning']), 'warning');
  assert.equal(worstSeverityOf([]), 'ok');
  assert.equal(worstSeverityOf(['ok']), 'ok');

  // End to end: one metric absent, another critical.
  const evaluation = evaluate((state) => {
    delete state.database.queueDepth;
    state.database.signerAttestationExpiresInSeconds = 30;
  });
  assert.equal(severityOf(evaluation, 'arma2_torneos_media_queue_depth'), 'unknown');
  assert.equal(severityOf(evaluation, 'arma2_torneos_media_signer_attestation_expires_in_seconds'), 'critical');
  assert.equal(evaluation.worstSeverity, 'critical',
    'a confirmed critical must not be hidden behind an unrelated absent signal');
  // The absent signal is still reported, just not as the headline.
  assert.ok(evaluation.missingRequired.includes('arma2_torneos_media_queue_depth'));
  assert.equal(evaluation.observable, false);
});

test('unproven visibility is a controlled ready:false, not a thrown error', () => {
  const blind = phaseCase('rls-blind');
  const snapshotWithoutProof = {
    collectedAt: null,
    database: { collector: {}, visibility: blind.preflight },
  };
  // It used to throw here, so a caller asking "is observability ready?" got an
  // exception instead of an answer — and the answer was always going to be no.
  const readiness = observabilityReadiness({
    repoRoot: ROOT, catalog, snapshot: snapshotWithoutProof,
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.evaluation, null);
  assert.equal(readiness.refusal.code, 'COLLECTOR_PREFLIGHT_MISSING');
  assert.ok(readiness.blockers.includes('signals.unproven:COLLECTOR_PREFLIGHT_MISSING'));
  // The pre-existing blockers are still reported alongside it.
  assert.ok(readiness.blockers.includes('signals.not_deployed'));
  assert.ok(readiness.blockers.some((blocker) => blocker.startsWith('collectors.not_implemented:')));
});

test('a snapshot carrying a new-style Supabase key is refused', () => {
  for (const value of ['sb_secret_abcdefghijklmnop', 'sb_publishable_abcdefghijklmnop']) {
    const leaking = snapshot();
    leaking.database.collector.role = value;
    expectCode('SNAPSHOT_IDENTIFYING_VALUE', () => assertSnapshotIsAnonymous(leaking));
  }
  // The prose that names the prefixes while explaining what is rejected is not
  // a key and must not be flagged.
  assert.doesNotThrow(() => assertSnapshotIsAnonymous({
    note: 'sb_secret_… is a service credential and is rejected',
  }));
});

test('migration drift is described as it is actually computed', () => {
  const metric = metricByName('arma2_torneos_media_migration_drift');
  const lib = fs.readFileSync(path.join(ROOT, 'scripts/torneos-staging/readiness-lib.mjs'), 'utf8');
  // The three detail arrays computeMigrationDrift() actually sums.
  for (const part of [
    'duplicatedRemoteVersions', 'remoteVersionsWithoutLocalFile', 'targetVersionsAppliedOutOfOrder',
  ]) {
    assert.ok(lib.includes(part), `${part} must exist in the implementation`);
    assert.ok(metric.source.definition.includes(part),
      `the definition must name ${part}, which is what is counted`);
  }
  // The claim that drifted from the code: it compares against the LOCAL
  // migration files, never against the manifest target.
  assert.doesNotMatch(metric.description, /remote versions the manifest does not declare/i);
  assert.match(metric.source.definition, /NOT against the manifest target/);
  assert.match(metric.description, /never a checksum comparison/i);
});
