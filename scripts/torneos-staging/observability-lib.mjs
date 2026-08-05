/**
 * Evaluation of the Multimedia observability catalog.
 *
 * The catalog (`ops/torneos-staging/observability/catalog.json`) declares the
 * exact metric names, thresholds, severities, recovery conditions, runbooks,
 * label policy, forbidden fields and retention. This module is the executable
 * half: it takes a collected snapshot and produces metric values, alerts and a
 * single verdict.
 *
 * Four rules matter more than the arithmetic:
 *
 *   1. Fail-closed on absence. A metric with no value is `unknown`, and an
 *      `unknown` metric is not "fine" — it makes the whole evaluation not
 *      observable, which is exactly the state in which the Multimedia flag must
 *      stay closed. A blind pipeline may not be an apparently healthy one.
 *
 *   2. Invisible is not empty. Row Level Security answers a forbidden count
 *      with zero, which is indistinguishable from a healthy idle queue. The
 *      database collector therefore proves its own visibility in the same
 *      statement that collects the counts, and this module refuses a snapshot
 *      whose proof is missing or negative — before any zero is believed.
 *
 *   3. Dwell time is measured, never assumed. A threshold with a dwell window
 *      can only fire, or be cleared, if the collector said how long the value
 *      has held. Absent dwell on a breaching value is `unknown`, not `ok`.
 *
 *   4. Nothing identifying may pass through. The snapshot is checked against
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

/**
 * The exact contract the database collector's role has to satisfy, asserted by
 * the SQL in the same statement that produces the counts. It is duplicated here
 * only as the machine-readable half of the same sentence: the SQL proves it,
 * this module refuses to believe a snapshot that did not prove it, and
 * docs/operations/tournament-media-observability.md explains it.
 *
 * Membership in a policy's target role is deliberately NOT sufficient. A policy
 * can filter, and a filtered count cannot be told apart from a small one.
 */
export const COLLECTOR_ROLE_CONTRACT = Object.freeze({
  collector: 'database',
  requiredTables: Object.freeze([
    'tournament_media_processing_jobs',
    'tournament_media_service_attestations',
  ]),
  requiredTablePrivilege: 'SELECT',
  requiredFunctionPrivilege: 'EXECUTE on public.tournament_media_pipeline_readiness()',
  rlsExemption: Object.freeze([
    'rolbypassrls on the collector role (intended shape)',
    'rolsuper on the collector role',
    'ownership of the table while the table is not FORCE ROW LEVEL SECURITY',
  ]),
  insufficient: Object.freeze([
    'membership in a policy target role: a policy filters, and a filtered count reads as a small one',
    'SELECT privilege alone while RLS is enabled and the role is not exempt',
  ]),
  grantsInThisChange: false,
});

/**
 * The canary. A snapshot may only be evaluated once the collector has proven it
 * could have seen the rows it is counting.
 *
 * This is the whole point of H1: without it, `queueDepth: 0` from a role that
 * RLS filters to nothing is byte-identical to `queueDepth: 0` from an empty
 * queue, and the second one is healthy while the first one is blind.
 */
export function assertCollectorVisibility(snapshot) {
  const visibility = snapshot?.database?.visibility;
  assert(visibility && typeof visibility === 'object', 'COLLECTOR_VISIBILITY_MISSING',
    'The database snapshot carries no visibility proof; its counts cannot be believed.');
  assert(typeof visibility.observable === 'boolean', 'COLLECTOR_VISIBILITY_MISSING',
    'The visibility proof does not state whether the collector could observe the tables.');
  assert(visibility.observable === true, 'COLLECTOR_VISIBILITY_UNPROVEN',
    'The collector could not observe the media tables; its zeros are absence, not health.',
    { blockers: visibility.blockers || [] });

  const tables = visibility.tables;
  assert(tables && typeof tables === 'object', 'COLLECTOR_VISIBILITY_MISSING',
    'The visibility proof reports no per-table verdict.');
  for (const table of COLLECTOR_ROLE_CONTRACT.requiredTables) {
    const entry = tables[table];
    assert(entry && typeof entry === 'object', 'COLLECTOR_VISIBILITY_MISSING',
      `The visibility proof says nothing about ${table}.`);
    assert(entry.present === true, 'COLLECTOR_VISIBILITY_UNPROVEN', `${table} is absent.`);
    assert(entry.canSelect === true, 'COLLECTOR_VISIBILITY_UNPROVEN',
      `The collector holds no SELECT privilege on ${table}.`);
    // The one that matters: RLS on, exemption off, counts meaningless.
    assert(entry.rlsEnabled !== true || entry.rlsExempt === true, 'COLLECTOR_VISIBILITY_UNPROVEN',
      `RLS is enabled on ${table} and the collector is not exempt; its counts are filtered.`);
    assert(entry.observable === true, 'COLLECTOR_VISIBILITY_UNPROVEN',
      `The collector reports ${table} as not observable.`);
  }
  // Deliberately no completeness check here. A metric the collector did not
  // ship is already handled by the rest of this module: it evaluates as
  // `unknown`, which makes the pipeline unobservable and keeps the flag shut.
  // This function answers one question only — could the collector have seen the
  // rows? — and answering a second one here would turn an ordinary partial
  // scrape into a crash.
  return { ok: true, role: snapshot.database.collector?.role || null };
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

  // Every collector says, out loud, whether it exists. A metric whose collector
  // is a paragraph rather than a program is a metric nobody is watching, and
  // the catalog may not let it look otherwise.
  for (const [name, collector] of Object.entries(catalog.collectors || {})) {
    assert(typeof collector.implemented === 'boolean', 'OBSERVABILITY_COLLECTOR_STATUS',
      `Collector ${name} does not declare whether it is implemented.`);
    if (collector.implemented === true) {
      assert(typeof collector.implementedBy === 'string'
        && fs.existsSync(path.join(repoRoot, collector.implementedBy.split(' ')[0])),
      'OBSERVABILITY_COLLECTOR_STATUS',
      `Collector ${name} claims an implementation that does not exist in the repository.`);
    } else {
      // Not implemented is allowed; not implemented and vague is not. The
      // source has to be concrete enough that somebody can go build it.
      assert(typeof collector.blocker === 'string' && collector.blocker.length >= 20,
        'OBSERVABILITY_COLLECTOR_STATUS',
        `Collector ${name} is not implemented and does not say what is missing.`);
      assert(typeof collector.plannedSource === 'string' && collector.plannedSource.length >= 20,
        'OBSERVABILITY_COLLECTOR_SOURCE',
        `Collector ${name} is not implemented and names no concrete source.`);
    }
  }
  // A catalog with a missing collector may not claim its signals are live.
  const unimplemented = Object.entries(catalog.collectors || {})
    .filter(([, collector]) => collector.implemented !== true).map(([name]) => name);
  if (unimplemented.length > 0) {
    assert(catalog.signalsDeployedInStaging === false && catalog.validatedInStaging === false,
      'OBSERVABILITY_COLLECTOR_CLAIM',
      'Signals cannot be declared deployed or validated while a collector does not exist.');
  }

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
    // A required metric has to say exactly where its number comes from. This is
    // what stops an unbuildable metric — one whose "source" was a remote
    // checksum the API does not expose — from sitting in the required list
    // looking like it merely has not been switched on yet.
    assert(typeof metric.source?.definition === 'string' && metric.source.definition.length >= 20,
      'OBSERVABILITY_SOURCE_DEFINITION',
      `Metric ${metric.name} does not define concretely how its value is produced.`);
    if (metric.requiredForObservabilityReady !== false) {
      const collector = catalog.collectors[metric.source.collector];
      assert(collector.implemented === true || typeof collector.plannedSource === 'string',
        'OBSERVABILITY_SOURCE_IMPOSSIBLE',
        `Required metric ${metric.name} depends on a collector with no concrete source.`);
    }
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
    // Unanchored on purpose. A UUID leaks just as completely from the middle of
    // a message ("job 550e8400-... abandoned") as it does from the start, and
    // the anchored version this replaces let exactly that through.
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    /\.(?:jpg|jpeg|png|webp)(?:$|[?#\s])/i,
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

const dwellPathOf = (metric) => `${metric.source.path}SustainedSeconds`;

/** The dwell the collector reported, or null. Never a default, never Infinity. */
const readDwellSeconds = (metric, snapshot) => {
  const raw = readPath(snapshot, dwellPathOf(metric));
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
};

/**
 * Evaluates one metric.
 *
 * `sustainedSeconds` is how long the collector says the value has held; a
 * threshold with a dwell window only fires once that window has been met, so a
 * single scrape spike is not an alert.
 *
 * When the collector reports no dwell at all, a breaching threshold with a
 * window is UNDECIDABLE, and the metric goes to `unknown`. It used to default
 * to `Infinity`, which quietly asserted "this has been true forever" and turned
 * every dwell-gated threshold into an instant alert on a snapshot that never
 * measured anything. Both directions of that assumption are wrong; the honest
 * answer is that we do not know.
 */
export function evaluateMetric(metric, snapshot) {
  const raw = readPath(snapshot, metric.source.path);
  const base = {
    name: metric.name,
    signal: metric.signal,
    recovery: metric.recovery,
    runbook: metric.runbook,
  };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return {
      ...base, value: null, severity: 'unknown', breached: null, sustainedSeconds: null, reason: 'metric_absent',
    };
  }
  const sustainedSeconds = readDwellSeconds(metric, snapshot);

  let severity = 'ok';
  let breached = null;
  let undecidable = null;
  for (const threshold of metric.thresholds) {
    if (!compare(threshold.comparator, raw, threshold.value)) continue;
    if (threshold.forSeconds > 0 && sustainedSeconds === null) {
      // Cannot be decided either way without a window.
      if (SEVERITY_ORDER.indexOf(threshold.severity) > SEVERITY_ORDER.indexOf(undecidable || 'ok')) {
        undecidable = threshold.severity;
      }
      continue;
    }
    if (sustainedSeconds !== null && sustainedSeconds < threshold.forSeconds) continue;
    if (SEVERITY_ORDER.indexOf(threshold.severity) > SEVERITY_ORDER.indexOf(severity)) {
      severity = threshold.severity;
      breached = threshold;
    }
  }
  // Only unknown when the missing window could still change the verdict: a
  // metric already known to be critical is not made less actionable by a
  // second, undecidable warning threshold.
  if (undecidable && SEVERITY_ORDER.indexOf(undecidable) > SEVERITY_ORDER.indexOf(severity)) {
    return {
      ...base,
      value: raw,
      severity: 'unknown',
      breached: null,
      sustainedSeconds: null,
      reason: 'dwell_unknown',
      undecidableSeverity: undecidable,
    };
  }
  const recovered = compare(metric.recovery.comparator, raw, metric.recovery.value);
  return {
    ...base, value: raw, severity, breached, recovered, sustainedSeconds,
  };
}

/**
 * Dwell derivation, which is the collector's job and not the database's.
 *
 * A single SELECT cannot know how long a value has held; it only knows the
 * value. So the collector keeps one small piece of state between scrapes — the
 * severity band each metric is in, and when it entered it — and stamps the
 * derived `*SustainedSeconds` onto the snapshot before evaluation.
 *
 * Band, not value: a gauge that wiggles between 61 and 64 has not left its
 * warning band, and restarting its dwell on every wiggle would mean a
 * persistent breach never matures into an alert.
 *
 * The returned state is small, non-identifying and safe to persist. A cold
 * start reports a dwell of 0, which is honest: the collector has observed this
 * band for zero seconds so far.
 */
export function deriveSustainedSeconds({
  catalog, snapshot, previous = null, at = Date.now(),
}) {
  assert(catalog && Array.isArray(catalog.metrics), 'DWELL_CATALOG', 'A catalog is required.');
  assert(snapshot && typeof snapshot === 'object', 'DWELL_SNAPSHOT', 'A snapshot is required.');
  const enriched = structuredClone(snapshot);
  const bands = {};
  for (const metric of catalog.metrics) {
    const raw = readPath(snapshot, metric.source.path);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    // Highest severity whose comparator is satisfied right now, dwell ignored.
    const band = metric.thresholds.reduce((worst, threshold) => (
      compare(threshold.comparator, raw, threshold.value)
        && SEVERITY_ORDER.indexOf(threshold.severity) > SEVERITY_ORDER.indexOf(worst)
        ? threshold.severity : worst
    ), 'ok');
    const prior = previous?.bands?.[metric.name];
    const since = prior && prior.band === band && Number.isFinite(prior.since) ? prior.since : at;
    bands[metric.name] = { band, since };
    const segments = dwellPathOf(metric).split('.');
    const leaf = segments.pop();
    const parent = segments.reduce((node, key) => {
      if (!node[key] || typeof node[key] !== 'object') node[key] = {};
      return node[key];
    }, enriched);
    parent[leaf] = Math.max(0, Math.floor((at - since) / 1000));
  }
  return { state: { schemaVersion: 1, at, bands }, snapshot: enriched };
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
  // Before a single count is read: could the collector have seen the rows? A
  // snapshot that cannot answer that is refused outright rather than evaluated
  // into a page of green zeros.
  const needsDatabase = catalog.metrics.some((metric) => metric.source.collector === 'database'
    && metric.requiredForObservabilityReady !== false);
  if (needsDatabase) assertCollectorVisibility(snapshot);
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
 * The single JSON row the collector SQL returns, placed where the catalog's
 * `database.*` paths expect it. Nothing is reshaped and nothing is defaulted:
 * a NULL the query emitted stays absent, so it evaluates as `unknown` rather
 * than as a zero somebody invented on the way through.
 */
export function snapshotFromDatabaseRow(row, rest = {}) {
  assert(row && typeof row === 'object', 'SNAPSHOT_ROW', 'A collector row is required.');
  const database = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'collectedAt' || value === null) continue;
    database[key] = value;
  }
  return { collectedAt: row.collectedAt || null, ...rest, database };
}

/** Collectors a required metric depends on that do not exist yet. */
export function missingCollectors(catalog) {
  const required = new Set(catalog.metrics
    .filter((metric) => metric.requiredForObservabilityReady !== false)
    .map((metric) => metric.source.collector));
  return [...required]
    .filter((name) => catalog.collectors?.[name]?.implemented !== true)
    .sort();
}

/**
 * The gate the flag has to pass. Observability counts as validated only when
 * every collector a required metric depends on actually exists, the catalog
 * says the signals are deployed AND validated in Staging, every required metric
 * reported a value, and nothing is critical. Any other combination keeps
 * `REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY` closed.
 *
 * The collector check is first because it is the one that cannot be waited out:
 * a signal whose collector was never written will never report a value no
 * matter how long Staging runs, and a required metric in that state is the
 * difference between "not switched on yet" and "not buildable as specified".
 */
export function observabilityReadiness({
  repoRoot = process.cwd(), catalog = loadCatalog(repoRoot), snapshot = null,
} = {}) {
  const blockers = [];
  for (const collector of missingCollectors(catalog)) {
    blockers.push(`collectors.not_implemented:${collector}`);
  }
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
