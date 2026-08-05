import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { clone, loadManifest, readJson } from './readiness-lib.mjs';
import {
  ObservabilityError,
  assertSnapshotIsAnonymous,
  evaluateMetric,
  evaluateObservability,
  loadCatalog,
  observabilityReadiness,
  validateCatalog,
} from './observability-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catalog = loadCatalog(ROOT);
const manifest = loadManifest(ROOT);
const snapshot = () => readJson(path.join(ROOT, 'ops/torneos-staging/fixtures/observability-snapshot.json'));
const metricByName = (name) => catalog.metrics.find((metric) => metric.name === name);

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

// --- the readiness gate ----------------------------------------------------

test('observability is not ready while the signals are undeployed or unvalidated', () => {
  const notDeployed = observabilityReadiness({ repoRoot: ROOT, catalog, snapshot: snapshot() });
  assert.equal(notDeployed.ready, false);
  assert.deepEqual(notDeployed.blockers, ['signals.not_deployed', 'signals.not_validated']);

  const deployedOnly = clone(catalog);
  deployedOnly.signalsDeployedInStaging = true;
  assert.deepEqual(
    observabilityReadiness({ repoRoot: ROOT, catalog: deployedOnly, snapshot: snapshot() }).blockers,
    ['signals.not_validated'],
  );

  const validated = clone(catalog);
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
