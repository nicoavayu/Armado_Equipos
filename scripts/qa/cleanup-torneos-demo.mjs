#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import productionGuard from './production-guard.js';
import {
  SEED_KEY,
  SEED_ORGANIZATION_SLUG,
  buildCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import { loadQAIdentityMap } from './torneos-qa-identity-map.mjs';
import {
  cleanupManifest,
  offlinePlan,
  withDatabase,
} from './torneos-seed-db.mjs';

const {
  assertLocalDatabaseTarget,
  assertRemoteApplyDisabled,
  assertSafeQaEnvironment,
} = productionGuard;

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--apply') || args.has('--apply-remote')) assertRemoteApplyDisabled();
  const identityMap = await loadQAIdentityMap({ env: process.env });
  const manifest = buildCanonicalManifest({ identityMap });
  validateCanonicalManifest(manifest);
  if (!args.has('--dry-run-local') && !args.has('--apply-local')) {
    if (args.size > 0 && !args.has('--dry-run')) {
      throw new Error('Use --dry-run, --dry-run-local, or --apply-local.');
    }
    assertSafeQaEnvironment(process.env);
    console.log(JSON.stringify({
      mode: 'offline-cleanup-plan',
      connects: false,
      writes: false,
      seedKey: manifest.seedKey,
      ownershipProof: [
        'tournament_organizations.creation_key',
        'tournament_audit_log qa.seed.applied marker',
        'manifestHash',
        'deterministic persisted identities',
      ],
      rollback: offlinePlan(manifest).rollback,
    }, null, 2));
    return;
  }
  const target = assertLocalDatabaseTarget(process.env);
  const apply = args.has('--apply-local');
  if (
    apply
    && (
      process.env.QA_ALLOW_LOCAL_CLEANUP !== 'true'
      || process.env.QA_CONFIRM_SEED_KEY !== SEED_KEY
      || process.env.QA_CONFIRM_ORGANIZATION_SLUG !== SEED_ORGANIZATION_SLUG
    )
  ) {
    throw new Error(
      `Cleanup requires QA_ALLOW_LOCAL_CLEANUP=true, `
      + `QA_CONFIRM_SEED_KEY=${SEED_KEY}, and `
      + `QA_CONFIRM_ORGANIZATION_SLUG=${SEED_ORGANIZATION_SLUG}.`,
    );
  }
  const result = await withDatabase(
    target.databaseUrl,
    (client) => cleanupManifest(client, manifest, {
      apply,
      allowLocalTriggerBypass: apply,
    }),
  );
  console.log(JSON.stringify({
    mode: apply ? 'local-cleanup-apply' : 'local-cleanup-dry-run',
    seedKey: manifest.seedKey,
    result,
  }, null, 2));
  if (result.status === 'reject') process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
