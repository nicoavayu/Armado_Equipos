/**
 * Evaluation of the Multimedia observability catalog.
 *
 * The catalog (`ops/torneos-staging/observability/catalog.json`) declares the
 * exact metric names, thresholds, severities, recovery conditions, runbooks,
 * label policy, forbidden fields and retention. This module is the executable
 * half: it takes a collected snapshot and produces metric values, alerts and a
 * single verdict.
 *
 * Two rules matter more than the arithmetic:
 *
 *   1. Fail-closed on absence. A metric with no value is `unknown`, and an
 *      `unknown` metric is not "fine" — it makes the whole evaluation not
 *      observable, which is exactly the state in which the Multimedia flag must
 *      stay closed. A blind pipeline may not be an apparently healthy one.
 *
 *   2. Nothing identifying may pass through. The snapshot is checked against
 *      the catalog's own prohibited list before anything is evaluated, so a
 *      collector that starts shipping object names or user ids fails here
 *      rather than in the metrics backend, where it would already be too late.
 */

import fs from 'node:fs';
import path from 'node:path';

export class ObservabilityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ObservabilityError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => { throw new ObservabilityError(code, message, details); };
const assert = (condition, code, message, details) => { if (!condition) fail(code, message, details); };

export const SEVERITY_ORDER = Object.freeze(['ok', 'warning', 'critical', 'unknown']);
const COMPARATORS = Object.freeze({
  '>=': (value, threshold) => value >= threshold,
  '>': (value, threshold) => value > threshold,
  '<=': (value, threshold) => value <= threshold,
  '<': (value, threshold) => value < threshold,
  '==': (value, threshold) => value === threshold,
});

export function loadCatalog(repoRoot = process.cwd()) {
  return JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'ops', 'torneos-staging', 'observability', 'catalog.json'), 'utf8',
  ));
}

const readPath = (source, dottedPath) => dottedPath.split('.')
  .reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), source);

/**
 * Structural validation of the catalog itself. Every metric has to carry the
 * five things an on-call person needs at 3am: a name, a threshold with a
 * severity, a recovery condition, a runbook and a source.
 */
export function validateCatalog({ repoRoot = process.cwd(), catalog = loadCatalog(repoRoot) } = {}) {
  assert(catalog.schemaVersion === 1, 'OBSERVABILITY_SCHEMA', 'Unsupported observability catalog schema.');
  assert(typeof catalog.metricNamespace === 'string' && catalog.metricNamespace.length > 0,
    'OBSERVABILITY_NAMESPACE', 'Catalog must declare a metric namespace.');
  assert(Array.isArray(catalog.metrics) && catalog.metrics.length > 0,
    'OBSERVABILITY_METRICS', 'Catalog declares no metrics.');
  assert(Array.isArray(catalog.prohibitedInLogsAndMetrics)
    && catalog.prohibitedInLogsAndMetrics.length > 0,
  'OBSERVABILITY_PROHIBITED', 'Catalog must declare what may never be logged.');
  const retention = catalog.retention || {};
  for (const field of ['metricsDays', 'alertEventsDays', 'structuredLogsDays', 'minimumRecommendedDays']) {
    assert(Number.isInteger(retention[field]) && retention[field] > 0,
      'OBSERVABILITY_RETENTION', `Retention field ${field} is missing or invalid.`);
  }
  assert(retention.structuredLogsDays >= retention.minimumRecommendedDays,
    'OBSERVABILITY_RETENTION', 'Structured log retention is below the declared minimum.');
  assert(Array.isArray(catalog.labelPolicy?.forbiddenLabels)
    && catalog.labelPolicy.forbiddenLabels.length > 0,
  'OBSERVABILITY_LABELS', 'Catalog must forbid per-tenant labels explicitly.');

  const names = new Set();
  for (const metric of catalog.metrics) {
    assert(typeof metric.name === 'string' && metric.name.startsWith(catalog.metricNamespace),
      'OBSERVABILITY_METRIC_NAME', `Metric name must start with ${catalog.metricNamespace}.`, { metric: metric.name });
    assert(/^[a-z][a-z0-9_]*$/.test(metric.name), 'OBSERVABILITY_METRIC_NAME',
      `Metric name ${metric.name} is not a valid metric identifier.`);
    assert(!names.has(metric.name), 'OBSERVABILITY_METRIC_DUPLICATE', `Duplicate metric ${metric.name}.`);
    names.add(metric.name);
    assert(typeof metric.signal === 'string' && metric.signal.length > 0,
      'OBSERVABILITY_SIGNAL', `Metric ${metric.name} declares no signal.`);
    assert(['gauge', 'counter'].includes(metric.type), 'OBSERVABILITY_METRIC_TYPE',
      `Metric ${metric.name} has an invalid type.`);
    assert(typeof metric.description === 'string' && metric.description.length >= 20,
      'OBSERVABILITY_DESCRIPTION', `Metric ${metric.name} needs a usable description.`);
    assert(typeof metric.source?.path === 'string' && metric.source.path.includes('.'),
      'OBSERVABILITY_SOURCE', `Metric ${metric.name} has no snapshot path.`);
    assert(typeof metric.source?.collector === 'string'
      && Object.prototype.hasOwnProperty.call(catalog.collectors || {}, metric.source.collector),
    'OBSERVABILITY_COLLECTOR', `Metric ${metric.name} names an undeclared collector.`);
    assert(Array.isArray(metric.thresholds) && metric.thresholds.length > 0,
      'OBSERVABILITY_THRESHOLD', `Metric ${metric.name} declares no threshold.`);
    const severities = new Set();
    for (const threshold of metric.thresholds) {
      assert(['warning', 'critical'].includes(threshold.severity), 'OBSERVABILITY_SEVERITY',
        `Metric ${metric.name} has an invalid severity.`);
      assert(!severities.has(threshold.severity), 'OBSERVABILITY_THRESHOLD',
        `Metric ${metric.name} repeats severity ${threshold.severity}.`);
      severities.add(threshold.severity);
      assert(Object.prototype.hasOwnProperty.call(COMPARATORS, threshold.comparator),
        'OBSERVABILITY_COMPARATOR', `Metric ${metric.name} has an unknown comparator.`);
      assert(typeof threshold.value === 'number' && Number.isFinite(threshold.value),
        'OBSERVABILITY_THRESHOLD', `Metric ${metric.name} has a non-numeric threshold.`);
      assert(Number.isInteger(threshold.forSeconds) && threshold.forSeconds >= 0,
        'OBSERVABILITY_THRESHOLD', `Metric ${metric.name} has an invalid dwell time.`);
    }
    assert(severities.has('critical'), 'OBSERVABILITY_SEVERITY',
      `Metric ${metric.name} must declare a critical threshold.`);
    assert(Object.prototype.hasOwnProperty.call(COMPARATORS, metric.recovery?.comparator)
      && typeof metric.recovery?.value === 'number',
    'OBSERVABILITY_RECOVERY', `Metric ${metric.name} declares no recovery condition.`);
    assert(typeof metric.runbook === 'string' && metric.runbook.startsWith('docs/')
      && metric.runbook.includes('.md'),
    'OBSERVABILITY_RUNBOOK', `Metric ${metric.name} must point at a runbook under docs/.`);
    const runbookFile = metric.runbook.split('#')[0];
    assert(fs.existsSync(path.join(repoRoot, runbookFile)), 'OBSERVABILITY_RUNBOOK_MISSING',
      `Runbook ${runbookFile} referenced by ${metric.name} does not exist.`);
  }
  return { ok: true, metricCount: catalog.metrics.length, names: [...names] };
}

/**
 * The snapshot may not carry anything that identifies a tenant, a person or an
 * object. This is a shape check, not a content guess: any key that looks like
 * an identifier or a path is refused outright.
 */
export function assertSnapshotIsAnonymous(snapshot) {
  const forbiddenKey = /(?:object_?name|objectname|path|token|secret|key|url|email|user_?id|organization_?id|tournament_?id|gallery_?id|job_?id|identity|ip_?address)/i;
  const forbiddenValue = [
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
    /[?&](?:token|signature|sig)=/i,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    /\.(?:jpg|jpeg|png|webp)$/i,
  ];
  const walk = (value, trail) => {
    if (typeof value === 'string') {
      for (const pattern of forbiddenValue) {
        assert(!pattern.test(value), 'SNAPSHOT_IDENTIFYING_VALUE',
          `Snapshot field ${trail} carries an identifying value.`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${trail}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        assert(!forbiddenKey.test(key), 'SNAPSHOT_IDENTIFYING_FIELD',
          `Snapshot field ${trail ? `${trail}.` : ''}${key} is forbidden by the catalog.`);
        walk(item, trail ? `${trail}.${key}` : key);
      }
    }
  };
  walk(snapshot, '');
  return true;
}

const compare = (comparator, value, threshold) => COMPARATORS[comparator](value, threshold);

/**
 * Evaluates one metric. `sustainedSeconds` is how long the collector says the
 * value has been where it is; a threshold with a dwell time only fires once
 * that time has been met, so a single scrape spike is not an alert.
 */
export function evaluateMetric(metric, snapshot) {
  const raw = readPath(snapshot, metric.source.path);
  const sustainedSeconds = Number(
    readPath(snapshot, `${metric.source.path}SustainedSeconds`) ?? Infinity,
  );
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return {
      name: metric.name,
      signal: metric.signal,
      value: null,
      severity: 'unknown',
      breached: null,
      reason: 'metric_absent',
      recovery: metric.recovery,
      runbook: metric.runbook,
    };
  }
  let severity = 'ok';
  let breached = null;
  for (const threshold of metric.thresholds) {
    if (!compare(threshold.comparator, raw, threshold.value)) continue;
    if (sustainedSeconds < threshold.forSeconds) continue;
    if (SEVERITY_ORDER.indexOf(threshold.severity) > SEVERITY_ORDER.indexOf(severity)) {
      severity = threshold.severity;
      breached = threshold;
    }
  }
  const recovered = compare(metric.recovery.comparator, raw, metric.recovery.value);
  return {
    name: metric.name,
    signal: metric.signal,
    value: raw,
    severity,
    breached,
    recovered,
    recovery: metric.recovery,
    runbook: metric.runbook,
  };
}

/**
 * @returns {{ observable, worstSeverity, metrics, alerts, missing }}
 *   `observable` is false whenever any metric required for readiness has no
 *   value. That is the flag gate: observability is not "mostly there".
 */
export function evaluateObservability({
  repoRoot = process.cwd(), catalog = loadCatalog(repoRoot), snapshot,
} = {}) {
  assert(snapshot && typeof snapshot === 'object', 'SNAPSHOT_MISSING', 'A snapshot is required.');
  assertSnapshotIsAnonymous(snapshot);
  const metrics = catalog.metrics.map((metric) => evaluateMetric(metric, snapshot));
  const missing = metrics
    .filter((metric) => metric.severity === 'unknown')
    .map(({ name }) => name);
  const requiredNames = new Set(catalog.metrics
    .filter((metric) => metric.requiredForObservabilityReady !== false)
    .map(({ name }) => name));
  const missingRequired = missing.filter((name) => requiredNames.has(name));
  const alerts = metrics
    .filter((metric) => metric.severity === 'warning' || metric.severity === 'critical')
    .map((metric) => ({
      metric: metric.name,
      signal: metric.signal,
      severity: metric.severity,
      value: metric.value,
      threshold: metric.breached,
      recovery: metric.recovery,
      runbook: metric.runbook,
    }));
  const worstSeverity = metrics.reduce((worst, metric) => (
    SEVERITY_ORDER.indexOf(metric.severity) > SEVERITY_ORDER.indexOf(worst) ? metric.severity : worst
  ), 'ok');
  return {
    collectedAt: snapshot.collectedAt || null,
    observable: missingRequired.length === 0,
    missingRequired,
    worstSeverity,
    alerts,
    metrics,
  };
}

/**
 * The gate the flag has to pass. Observability counts as validated only when
 * the catalog says the signals are deployed AND validated in Staging, every
 * required metric reported a value, and nothing is critical. Any other
 * combination keeps `REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY` closed.
 */
export function observabilityReadiness({
  repoRoot = process.cwd(), catalog = loadCatalog(repoRoot), snapshot = null,
} = {}) {
  const blockers = [];
  if (catalog.signalsDeployedInStaging !== true) blockers.push('signals.not_deployed');
  if (catalog.validatedInStaging !== true) blockers.push('signals.not_validated');
  let evaluation = null;
  if (snapshot) {
    evaluation = evaluateObservability({ repoRoot, catalog, snapshot });
    if (!evaluation.observable) blockers.push('signals.incomplete');
    if (evaluation.worstSeverity === 'critical') blockers.push('signals.critical');
  } else {
    blockers.push('signals.no_snapshot');
  }
  return { ready: blockers.length === 0, blockers, evaluation };
}
