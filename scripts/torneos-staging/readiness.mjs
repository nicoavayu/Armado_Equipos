#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ReadinessError,
  assertSanitizedOutput,
  buildPlan,
  formatHumanPlan,
  inspectRepository,
  loadManifest,
  readJson,
  simulateStage,
  validateManifest,
  validateState,
} from './readiness-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
  return { command: positional[0], options };
};

const fixturePath = (options) => path.resolve(
  ROOT,
  String(options.fixture || 'ops/torneos-staging/fixtures/local-ready.json'),
);

const print = (value, json) => {
  const output = typeof value === 'string'
    ? value
    : `${JSON.stringify(value, null, json ? 2 : 0)}\n`;
  assertSanitizedOutput(output);
  process.stdout.write(output);
};

export function main(argv = process.argv.slice(2)) {
  const { command, options } = parse(argv);
  const manifest = loadManifest(ROOT);
  const state = readJson(fixturePath(options));
  const manifestResult = validateManifest({ repoRoot: ROOT, manifest });
  const stateResult = validateState({ repoRoot: ROOT, manifest, state });

  if (command === 'inspect') {
    const repository = inspectRepository({ repoRoot: ROOT, manifest, requireClean: options['allow-dirty'] !== true });
    print({ status: 'ok', mode: 'local-fixture', remoteCalls: 0, manifest: manifestResult, repository, state: stateResult }, options.json);
    return;
  }

  const repository = inspectRepository({
    repoRoot: ROOT,
    manifest,
    requireClean: options['allow-dirty'] !== true,
  });
  const exactSha = options['repository-sha'] || repository.headSha;
  if (exactSha !== repository.headSha) {
    throw new ReadinessError('REPOSITORY_DRIFT', 'Requested SHA differs from exact HEAD.');
  }
  const includeSql = options['include-sql'] === true;
  const plan = buildPlan({ repoRoot: ROOT, manifest, state, repositorySha: exactSha, includeSql });

  if (command === 'plan' || command === 'dry-run') {
    if (options.json) print(plan, true);
    else print(formatHumanPlan(plan), false);
    return;
  }

  if (command === 'rollback' && options.simulate === true) {
    const result = simulateStage({ manifest, plan, state, stage: 'rollback' });
    print({ status: 'simulated', remoteCalls: 0, receipt: result.receipt, state: result.state }, options.json);
    return;
  }

  if (manifest.stages.some(({ name }) => name === command)) {
    throw new ReadinessError(
      'REMOTE_STAGE_BLOCKED',
      `${command} is not executed without an authorized remote inspector snapshot, persisted plan, prior receipt and per-stage approval. See the runbook.`,
    );
  }
  throw new ReadinessError('STAGE_UNKNOWN', `Unknown stage ${command || '<missing>'}.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    const code = error instanceof ReadinessError ? error.code : 'READINESS_FAILURE';
    console.error(`[torneos-readiness] ${code}: ${error.message}`);
    process.exit(1);
  }
}
