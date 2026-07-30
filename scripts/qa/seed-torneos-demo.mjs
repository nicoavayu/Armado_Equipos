#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import productionGuard from './production-guard.js';
import {
  buildBaseManifest,
  buildCanonicalManifest,
  resolveCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import { loadQAIdentityMap } from './torneos-qa-identity-map.mjs';
import { QA_IDENTITY_ROLES } from './torneos-qa-identity-map.mjs';
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

export function dryRun({ env = process.env, identityMap } = {}) {
  assertSafeQaEnvironment(env);
  if (!identityMap) {
    throw new Error('dryRun requires an explicit QAIdentityMap.');
  }
  const manifest = resolveCanonicalManifest({
    baseManifest: buildBaseManifest(),
    identityMap,
  });
  return {
    ...offlinePlan(manifest),
    validation: validateCanonicalManifest(manifest),
  };
}

export function baseDryRun({ env = process.env } = {}) {
  assertSafeQaEnvironment(env);
  const manifest = buildBaseManifest();
  return {
    mode: 'offline-base-manifest',
    connects: false,
    writes: false,
    resolved: false,
    seedKey: manifest.seedKey,
    datasetVersion: manifest.datasetVersion,
    baseManifestHash: manifest.baseManifestHash,
    rowsBeforeMarker: manifest.operations.reduce(
      (sum, operation) => sum + operation.rows.length,
      0,
    ),
    expectedResolvedRows: 587,
    expectedTables: 32,
    identityRoles: QA_IDENTITY_ROLES,
    note: 'Load a QAIdentityMap to calculate the authorized resolved manifest hash.',
  };
}

function hasIdentitySource(env) {
  return Boolean(env.QA_IDENTITY_MAP_FILE) || QA_IDENTITY_ROLES.some((role) => (
    env[`QA_IDENTITY_${role.toUpperCase()}_AUTH_USER_ID`]
    || env[`QA_IDENTITY_${role.toUpperCase()}_EMAIL`]
  ));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--apply') || args.has('--execute') || args.has('--apply-remote')) {
    assertRemoteApplyDisabled();
  }
  if (args.has('--remote-plan')) {
    const target = assertRemotePlanTarget(process.env);
    const identityMap = await loadQAIdentityMap({ env: process.env });
    console.log(JSON.stringify({
      ...dryRun({ identityMap }),
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
    const identityMap = await loadQAIdentityMap({ env: process.env });
    const manifest = buildCanonicalManifest({ identityMap });
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
  if (!hasIdentitySource(process.env)) {
    console.log(JSON.stringify(baseDryRun(), null, 2));
    return;
  }
  const identityMap = await loadQAIdentityMap({ env: process.env });
  console.log(JSON.stringify(dryRun({ identityMap }), null, 2));
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
