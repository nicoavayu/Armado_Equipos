#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  InspectorError,
  assertSnapshotSanitized,
  buildDryRun,
  defaultArtifactDirectory,
  formatDryRunMarkdown,
} from './inspect-remote-readonly-lib.mjs';
import {
  ReadinessError,
  canonicalJson,
  loadManifest,
  sha256,
  validateRepositoryBinding,
} from './readiness-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const parse = (argv) => Object.fromEntries(argv.map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));

export function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (!options.snapshot) throw new InspectorError('SNAPSHOT_REQUIRED', '--snapshot=<absolute path> is required.');
  const repositorySha = String(options['expected-repository-sha'] || '');
  validateRepositoryBinding({
    repoRoot: ROOT,
    manifest: loadManifest(ROOT),
    expectedRepositorySha: repositorySha,
    requireClean: options['allow-dirty'] !== true,
  });
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(String(options.snapshot)), 'utf8'));
  const plan = buildDryRun({ repoRoot: ROOT, snapshot, repositorySha });
  const markdown = formatDryRunMarkdown(plan);
  const json = `${JSON.stringify(JSON.parse(canonicalJson(plan)), null, 2)}\n`;
  assertSnapshotSanitized(json);
  const outputDirectory = options['output-dir']
    ? path.resolve(String(options['output-dir'])) : defaultArtifactDirectory();
  fs.mkdirSync(outputDirectory, { recursive: true });
  const markdownFile = path.join(outputDirectory, 'staging-readonly-dry-run.md');
  const jsonFile = path.join(outputDirectory, 'staging-readonly-dry-run.json');
  fs.writeFileSync(markdownFile, markdown, { mode: 0o600 });
  fs.writeFileSync(jsonFile, json, { mode: 0o600 });
  const result = { status: 'ok', markdown: markdownFile, json: jsonFile,
    planId: plan.planId, jsonSha256: sha256(json), mutationsPerformed: 0 };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); } catch (error) {
    const code = error instanceof InspectorError || error instanceof ReadinessError
      ? error.code : 'DRY_RUN_FAILURE';
    process.stderr.write(`[torneos-readonly-dry-run] ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
