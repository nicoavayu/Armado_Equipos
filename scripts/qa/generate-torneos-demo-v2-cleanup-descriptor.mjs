#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  V2_CLEANUP_AUTHORIZATION,
  buildCleanupDescriptor,
} from './torneos-demo-v2-cleanup-contract.mjs';

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!['--historical-worktree', '--identity-map', '--output'].includes(name) || !value) {
      throw new Error(
        'Use --historical-worktree <path> --identity-map <ignored-file> --output <path>.',
      );
    }
    options[name.slice(2)] = value;
  }
  if (!options['historical-worktree'] || !options['identity-map'] || !options.output) {
    throw new Error(
      'Use --historical-worktree <path> --identity-map <ignored-file> --output <path>.',
    );
  }
  return options;
}

function gitOutput(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed.`);
  }
  return result.stdout.trim();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const historicalWorktree = resolve(options['historical-worktree']);
  const identityMapFile = resolve(historicalWorktree, options['identity-map']);
  const output = resolve(options.output);
  const head = gitOutput(historicalWorktree, ['rev-parse', 'HEAD']);
  if (head !== V2_CLEANUP_AUTHORIZATION.sourceCommit) {
    throw new Error(`Historical worktree rejected: expected ${V2_CLEANUP_AUTHORIZATION.sourceCommit}.`);
  }
  const trackedChanges = gitOutput(historicalWorktree, [
    'status',
    '--porcelain',
    '--untracked-files=no',
  ]);
  if (trackedChanges) throw new Error('Historical worktree has tracked changes.');

  const previousCwd = process.cwd();
  const previousIdentityMap = process.env.QA_IDENTITY_MAP_FILE;
  try {
    process.chdir(historicalWorktree);
    process.env.QA_IDENTITY_MAP_FILE = identityMapFile;
    const identityModule = await import(pathToFileURL(
      resolve(historicalWorktree, 'scripts/qa/torneos-qa-identity-map.mjs'),
    ));
    const manifestModule = await import(pathToFileURL(
      resolve(historicalWorktree, 'scripts/qa/torneos-demo-manifest.mjs'),
    ));
    const identityMap = await identityModule.loadQAIdentityMap({ env: process.env });
    const manifest = manifestModule.buildCanonicalManifest({ identityMap });
    manifestModule.validateCanonicalManifest(manifest);
    const descriptor = buildCleanupDescriptor(manifest);
    const body = `// Generated only from commit ${V2_CLEANUP_AUTHORIZATION.sourceCommit}.\n`
      + '// Regenerate with generate-torneos-demo-v2-cleanup-descriptor.mjs; do not edit manually.\n'
      + "import { validateCleanupDescriptor } from './torneos-demo-v2-cleanup-contract.mjs';\n\n"
      + `const descriptor = ${JSON.stringify(descriptor, null, 2)};\n\n`
      + 'export const TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR = Object.freeze(\n'
      + '  validateCleanupDescriptor(descriptor),\n'
      + ');\n';
    await writeFile(output, body, { encoding: 'utf8', mode: 0o644 });
    console.log(JSON.stringify({
      sourceCommit: descriptor.sourceCommit,
      descriptorFingerprint: descriptor.descriptorFingerprint,
      rows: descriptor.expected.totalRows,
      tables: descriptor.expected.tables,
      output,
    }, null, 2));
  } finally {
    process.chdir(previousCwd);
    if (previousIdentityMap === undefined) delete process.env.QA_IDENTITY_MAP_FILE;
    else process.env.QA_IDENTITY_MAP_FILE = previousIdentityMap;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
