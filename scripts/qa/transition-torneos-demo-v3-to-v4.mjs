import process from 'node:process';
import { fileURLToPath } from 'node:url';

import productionGuard from './production-guard.js';
import { buildCanonicalManifest as buildV4Manifest } from './torneos-demo-manifest.mjs';
import {
  V3_LEGACY_AUTHORIZATION,
  buildLegacyV3Manifest,
  validateLegacyV3Manifest,
} from './torneos-demo-v3-contract.mjs';
import {
  V4_CURRENT_AUTHORIZATION,
  validateCurrentV4Manifest,
} from './torneos-demo-v4-contract.mjs';
import { canonicalJson, loadQAIdentityMap } from './torneos-qa-identity-map.mjs';
import {
  detectCleanupTriggerBlockers,
  insertManifestMarkerInCurrentTransaction,
  preflightDatabase,
  readUnexpectedOrganizationRows,
  withDatabase,
  withSerializableRetry,
} from './torneos-seed-db.mjs';

const { assertLocalDatabaseTarget, assertRemoteApplyDisabled, assertSafeQaEnvironment } = productionGuard;

export const TRANSITION_CONFIRMATION = 'TRANSICIONAR torneos-demo-v3 A torneos-demo-v4 LOCAL';

function markerOperation(operation) {
  return operation.table === 'tournament_audit_log'
    && operation.rows.some((row) => row.resource_type === 'qa_seed_execution');
}

function baseOperations(manifest) {
  return manifest.operations.filter((operation) => !markerOperation(operation));
}

function identityValue(operation, row) {
  return Object.fromEntries(operation.identity.map((column) => [column, row[column]]));
}

export function validateTransitionArtifacts({
  v3Manifest,
  v4Manifest,
  v3Authorization = V3_LEGACY_AUTHORIZATION,
  v4Authorization = V4_CURRENT_AUTHORIZATION,
} = {}) {
  validateLegacyV3Manifest(v3Manifest, v3Authorization);
  validateCurrentV4Manifest(v4Manifest, v4Authorization);
  if (v3Manifest.seedRegistryId === v4Manifest.seedRegistryId) {
    throw new Error('V3 and V4 must use different seed markers.');
  }
  const v3Operations = baseOperations(v3Manifest);
  const v4Operations = baseOperations(v4Manifest);
  if (v3Operations.length !== v4Operations.length) {
    throw new Error('V3/V4 base operation counts differ.');
  }
  const differences = [];
  v3Operations.forEach((v3Operation, operationIndex) => {
    const v4Operation = v4Operations[operationIndex];
    if (
      v3Operation.table !== v4Operation.table
      || canonicalJson(v3Operation.identity) !== canonicalJson(v4Operation.identity)
      || v3Operation.rows.length !== v4Operation.rows.length
    ) {
      throw new Error(`V3/V4 operation shape differs at ${v3Operation.table}.`);
    }
    v3Operation.rows.forEach((v3Row, rowIndex) => {
      const v4Row = v4Operation.rows[rowIndex];
      if (canonicalJson(identityValue(v3Operation, v3Row)) !== canonicalJson(
        identityValue(v4Operation, v4Row),
      )) {
        throw new Error(`V3/V4 row identity differs at ${v3Operation.table}.`);
      }
      const columns = new Set([...Object.keys(v3Row), ...Object.keys(v4Row)]);
      for (const column of columns) {
        if (canonicalJson(v3Row[column]) !== canonicalJson(v4Row[column])) {
          differences.push({
            table: v3Operation.table,
            identity: identityValue(v3Operation, v3Row),
            column,
            before: v3Row[column],
            after: v4Row[column],
          });
        }
      }
    });
  });
  if (
    differences.length !== 1
    || differences[0].table !== 'tournament_discipline_ledgers'
    || differences[0].column !== 'automatic_suspensions'
    || differences[0].before !== 0
    || differences[0].after !== 1
  ) {
    throw new Error(`Unexpected V3/V4 data differences: ${canonicalJson(differences)}`);
  }
  return Object.freeze({
    baseRows: 586,
    markerRows: 1,
    totalRows: 587,
    tables: 32,
    differences,
  });
}

function quotedIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function setAuditDeleteTriggers(client, blockers, enabled) {
  if (blockers.length === 0) return;
  await client.query('lock table public.tournament_audit_log in access exclusive mode');
  for (const blocker of blockers) {
    await client.query(
      `alter table public.tournament_audit_log ${enabled ? 'enable' : 'disable'} trigger ${quotedIdentifier(blocker.trigger)}`,
    );
  }
}

async function deliberateFailure(client, failAfterStep, step) {
  if (failAfterStep === step) {
    await client.query('select 1 / 0 as qa_deliberate_transition_failure');
  }
}

export async function transitionV3ToV4(client, {
  v3Manifest,
  v4Manifest,
  v3Authorization = V3_LEGACY_AUTHORIZATION,
  v4Authorization = V4_CURRENT_AUTHORIZATION,
  failAfterStep = null,
  retry = {},
} = {}) {
  const contract = validateTransitionArtifacts({
    v3Manifest,
    v4Manifest,
    v3Authorization,
    v4Authorization,
  });
  if (![null, 'ledger_update', 'v3_marker_delete', 'v4_marker_insert'].includes(failAfterStep)) {
    throw new Error('Unsupported transition failure injection step.');
  }
  return withSerializableRetry(async (attempt) => {
    await client.query('begin isolation level serializable');
    try {
      await client.query("set local idle_in_transaction_session_timeout = '5min'");
      for (const seedKey of [v3Manifest.seedKey, v4Manifest.seedKey].sort()) {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [seedKey]);
      }
      const v4Preflight = await preflightDatabase(client, v4Manifest);
      if (v4Preflight.status === 'skip') {
        await client.query('rollback');
        return { status: 'skip', reason: 'v4_already_materialized', attempts: attempt };
      }
      if (v4Preflight.status !== 'legacy_dataset_detected') {
        const error = new Error(`V3 to V4 transition rejected: ${v4Preflight.reason}.`);
        error.preflight = v4Preflight;
        throw error;
      }
      const v3Preflight = await preflightDatabase(client, v3Manifest);
      if (v3Preflight.status !== 'skip') {
        const error = new Error(`Frozen V3 validation rejected: ${v3Preflight.reason}.`);
        error.preflight = v3Preflight;
        throw error;
      }
      const foreignRows = await readUnexpectedOrganizationRows(client, v3Manifest);
      if (foreignRows.length > 0) {
        const error = new Error('V3 to V4 transition rejected foreign organization rows.');
        error.foreignRows = foreignRows;
        throw error;
      }
      const difference = contract.differences[0];
      const ledgerUpdate = await client.query(
        `update public.tournament_discipline_ledgers
         set automatic_suspensions = $3
         where revision_id = $1
           and roster_player_id = $2
           and automatic_suspensions = $4`,
        [
          difference.identity.revision_id,
          difference.identity.roster_player_id,
          difference.after,
          difference.before,
        ],
      );
      if (ledgerUpdate.rowCount !== 1) {
        throw new Error(`Transition expected one ledger update, changed ${ledgerUpdate.rowCount}.`);
      }
      await deliberateFailure(client, failAfterStep, 'ledger_update');

      const blockers = (await detectCleanupTriggerBlockers(client, v3Manifest)).filter(
        (blocker) => blocker.table === 'tournament_audit_log',
      );
      await setAuditDeleteTriggers(client, blockers, false);
      const markerDelete = await client.query(
        `delete from public.tournament_audit_log
         where resource_type = 'qa_seed_execution'
           and resource_id = $1
           and action = 'qa.seed.applied'
           and organization_id = $2
           and metadata ->> 'seed_key' = $3
           and metadata ->> 'manifest_hash' = $4`,
        [
          v3Manifest.seedRegistryId,
          v3Manifest.organizationId,
          v3Manifest.seedKey,
          v3Manifest.manifestHash,
        ],
      );
      if (markerDelete.rowCount !== 1) {
        throw new Error(`Transition expected one V3 marker delete, changed ${markerDelete.rowCount}.`);
      }
      await deliberateFailure(client, failAfterStep, 'v3_marker_delete');
      await insertManifestMarkerInCurrentTransaction(client, v4Manifest);
      await deliberateFailure(client, failAfterStep, 'v4_marker_insert');
      await setAuditDeleteTriggers(client, blockers, true);

      const verification = await preflightDatabase(client, v4Manifest);
      if (
        verification.status !== 'skip'
        || verification.present !== v4Manifest.expectedRowCount
        || verification.mismatched.length !== 0
      ) {
        const error = new Error('V4 verification failed before transition commit.');
        error.preflight = verification;
        throw error;
      }
      await client.query('commit');
      return {
        status: 'transitioned',
        attempts: attempt,
        changedRows: 1,
        retiredMarkers: 1,
        createdMarkers: 1,
        verification,
      };
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // The failed transaction may already be closed.
      }
      throw error;
    }
  }, retry);
}

export function transitionDryRun({ identityMap } = {}) {
  if (!identityMap) throw new Error('transitionDryRun requires an explicit QAIdentityMap.');
  const v3Manifest = buildLegacyV3Manifest({ identityMap });
  const v4Manifest = buildV4Manifest({ identityMap });
  const contract = validateTransitionArtifacts({ v3Manifest, v4Manifest });
  return {
    mode: 'offline-transition-plan',
    connects: false,
    writes: false,
    from: v3Manifest.seedKey,
    to: v4Manifest.seedKey,
    fromManifestHash: v3Manifest.manifestHash,
    toManifestHash: v4Manifest.manifestHash,
    identityMapFingerprint: v4Manifest.identityMapFingerprint,
    fromOwnershipFingerprint: v3Manifest.rowOwnershipFingerprint,
    toOwnershipFingerprint: v4Manifest.rowOwnershipFingerprint,
    counts: {
      baseRows: contract.baseRows,
      markerRows: contract.markerRows,
      totalRows: contract.totalRows,
      tables: contract.tables,
    },
    change: {
      table: contract.differences[0].table,
      column: contract.differences[0].column,
      before: contract.differences[0].before,
      after: contract.differences[0].after,
    },
    transaction: 'SERIALIZABLE with advisory locks, exact V3 validation and full rollback',
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--remote') || args.has('--apply-remote') || args.has('--execute')) {
    assertRemoteApplyDisabled();
  }
  const identityMap = await loadQAIdentityMap({ env: process.env });
  if (!args.has('--apply-local')) {
    if (args.size > 0 && !args.has('--dry-run')) {
      throw new Error('Use --dry-run or --apply-local. Remote transition is disabled.');
    }
    assertSafeQaEnvironment(process.env);
    console.log(JSON.stringify(transitionDryRun({ identityMap }), null, 2));
    return;
  }
  const target = assertLocalDatabaseTarget(process.env);
  if (
    process.env.QA_ALLOW_LOCAL_TRANSITION !== 'true'
    || process.env.QA_CONFIRM_TRANSITION !== TRANSITION_CONFIRMATION
  ) {
    throw new Error('Local transition requires explicit double confirmation.');
  }
  const v3Manifest = buildLegacyV3Manifest({ identityMap });
  const v4Manifest = buildV4Manifest({ identityMap });
  const result = await withDatabase(
    target.databaseUrl,
    (client) => transitionV3ToV4(client, { v3Manifest, v4Manifest }),
  );
  console.log(JSON.stringify({ mode: 'local-transition', result }, null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
