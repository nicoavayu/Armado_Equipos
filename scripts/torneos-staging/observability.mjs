#!/usr/bin/env node
/**
 * Local evaluation of the Multimedia observability catalog.
 *
 * Contacts nothing. It validates the catalog and, when given a snapshot,
 * evaluates it and prints the metrics, the alerts and the readiness verdict.
 * The snapshot is produced elsewhere by the collectors the catalog declares;
 * this command is how the definitions are exercised and reviewed before any of
 * them is deployed.
 *
 *   node scripts/torneos-staging/observability.mjs validate
 *   node scripts/torneos-staging/observability.mjs evaluate [--snapshot=path] [--json]
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { assertSanitizedOutput, readJson } from './readiness-lib.mjs';
import {
  ObservabilityError, evaluateObservability, loadCatalog, observabilityReadiness, validateCatalog,
} from './observability-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_SNAPSHOT = 'ops/torneos-staging/fixtures/observability-snapshot.json';

const parse = (argv) => {
  const positional = [];
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) positional.push(arg);
    else {
      const [key, ...rest] = arg.slice(2).split('=');
      options[key] = rest.length ? rest.join('=') : true;
    }
  }
  return { command: positional[0] || 'validate', options };
};

const print = (value, json) => {
  const output = typeof value === 'string' ? value : `${JSON.stringify(value, null, json ? 2 : 0)}\n`;
  assertSanitizedOutput(output);
  process.stdout.write(output);
};

export function main(argv = process.argv.slice(2)) {
  const { command, options } = parse(argv);
  const catalog = loadCatalog(ROOT);
  const catalogResult = validateCatalog({ repoRoot: ROOT, catalog });

  if (command === 'validate') {
    print({
      status: 'ok',
      remoteCalls: 0,
      metrics: catalogResult.metricCount,
      signalsDeployedInStaging: catalog.signalsDeployedInStaging === true,
      validatedInStaging: catalog.validatedInStaging === true,
    }, options.json);
    return 0;
  }

  if (command === 'evaluate') {
    const snapshot = readJson(path.resolve(ROOT, String(options.snapshot || DEFAULT_SNAPSHOT)));
    const evaluation = evaluateObservability({ repoRoot: ROOT, catalog, snapshot });
    const readiness = observabilityReadiness({ repoRoot: ROOT, catalog, snapshot });
    print({
      status: 'ok',
      remoteCalls: 0,
      source: options.snapshot ? 'provided-snapshot' : 'local-fixture',
      observable: evaluation.observable,
      worstSeverity: evaluation.worstSeverity,
      missingRequired: evaluation.missingRequired,
      alerts: evaluation.alerts,
      observabilityReady: readiness.ready,
      blockers: readiness.blockers,
      metrics: options.verbose === true ? evaluation.metrics : undefined,
    }, options.json);
    // A critical alert or an unobservable pipeline is a non-zero exit, so a
    // scheduled run of this command is itself a gate.
    return evaluation.worstSeverity === 'critical' || !evaluation.observable ? 1 : 0;
  }

  throw new ObservabilityError('COMMAND_UNKNOWN', `Unknown command ${command}.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    const code = error instanceof ObservabilityError ? error.code : 'OBSERVABILITY_FAILURE';
    console.error(`[torneos-observability] ${code}: ${error.message}`);
    process.exitCode = 1;
  }
}
