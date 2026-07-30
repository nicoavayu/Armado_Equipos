#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import productionGuard from './production-guard.js';
import {
  buildCanonicalManifest,
  qaUsers,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import {
  materializeManifest,
  offlinePlan,
  preflightDatabase,
  withDatabase,
} from './torneos-seed-db.mjs';

const {
  assertLocalDatabaseTarget,
  assertRemoteApplyDisabled,
  assertRemotePlanTarget,
  assertSafeQaEnvironment,
} = productionGuard;

export function dryRun({ env = process.env } = {}) {
  assertSafeQaEnvironment(env);
  const manifest = buildCanonicalManifest({
    users: qaUsers({ env, localDefaults: true }),
  });
  return {
    ...offlinePlan(manifest),
    validation: validateCanonicalManifest(manifest),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--apply') || args.has('--execute') || args.has('--apply-remote')) {
    assertRemoteApplyDisabled();
  }
  if (args.has('--remote-plan')) {
    const target = assertRemotePlanTarget(process.env);
    console.log(JSON.stringify({
      ...dryRun(),
      mode: target.mode,
      target,
      note: 'No connection was opened and no credential was accepted.',
    }, null, 2));
    return;
  }
  if (args.has('--preflight-local') || args.has('--apply-local')) {
    const target = assertLocalDatabaseTarget(process.env);
    if (args.has('--apply-local') && process.env.QA_ALLOW_LOCAL_SEED !== 'true') {
      throw new Error('QA_ALLOW_LOCAL_SEED=true is required for local materialization.');
    }
    const manifest = buildCanonicalManifest({
      users: qaUsers({ env: process.env, localDefaults: true }),
    });
    validateCanonicalManifest(manifest);
    const result = await withDatabase(target.databaseUrl, async (client) => (
      args.has('--apply-local')
        ? materializeManifest(client, manifest, {
          failAfterTable: process.env.QA_SEED_FAIL_AFTER_TABLE || null,
        })
        : preflightDatabase(client, manifest)
    ));
    console.log(JSON.stringify({
      mode: args.has('--apply-local') ? 'local-apply' : 'local-preflight',
      target: { mode: target.mode, host: new URL(target.databaseUrl).hostname },
      seedKey: manifest.seedKey,
      manifestHash: manifest.manifestHash,
      result,
    }, null, 2));
    return;
  }
  if (args.size > 0 && !args.has('--dry-run')) {
    throw new Error(
      'Unknown arguments. Use --dry-run, --remote-plan, --preflight-local, or --apply-local.',
    );
  }
  console.log(JSON.stringify(dryRun(), null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    const detail = error.preflight ? { message: error.message, preflight: error.preflight } : {
      message: error.message,
    };
    console.error(JSON.stringify({ error: detail }, null, 2));
    process.exitCode = 1;
  });
}
