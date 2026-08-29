import { createHash } from 'node:crypto';

import * as v3 from './torneos-demo-v3-manifest.mjs';
import { canonicalJson } from './torneos-qa-identity-map.mjs';

export const V3_LEGACY_AUTHORIZATION = Object.freeze({
  seedKey: 'torneos-demo-v3',
  datasetVersion: 3,
  markerId: '85ab8c2e-6cd5-54c4-86b6-fbbfc0f0b050',
  manifestHash: '0afc357d733bdfbed0bae9ea8bf87b6c0b58a05ada2c0d8b65ef4b51cbb596f4',
  identityMapFingerprint: 'd13bf642667c8a02c79a6f7b6db3325be3a2196c1569cfb655d67a72a3ab4cdd',
  ownershipFingerprint: '940e50032644694b3e2e06f0a022ada8b0474bfa4e70cb22ea45e4ceb3701d7a',
  baseRows: 586,
  markerRows: 1,
  totalRows: 587,
  tables: 32,
});

function rowsFor(manifest, table) {
  return manifest.operations
    .filter((operation) => operation.table === table)
    .flatMap((operation) => operation.rows);
}

function assertExact(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`Frozen V3 ${label} changed: expected ${expected}, got ${actual}.`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isMarkerRow(operation, row) {
  return operation.table === 'tournament_audit_log'
    && row.resource_type === 'qa_seed_execution';
}

function baseOperations(manifest) {
  return manifest.operations.map((operation) => ({
    ...operation,
    rows: operation.rows.filter((row) => !isMarkerRow(operation, row)),
  })).filter((operation) => operation.rows.length > 0);
}

function recomputeManifestHash(operations) {
  return sha256(canonicalJson(operations.map((operation) => ({
    table: operation.table,
    identity: operation.identity,
    rows: operation.rows,
  }))));
}

function recomputeOwnershipFingerprint(operations, seedKey) {
  return sha256(canonicalJson({
    seedKey,
    operations: operations.map((operation) => ({
      table: operation.table,
      identities: operation.rows.map((row) => Object.fromEntries(
        operation.identity.map((column) => [column, row[column]]),
      )),
    })),
  }));
}

export function buildLegacyV3Manifest(options) {
  return v3.buildCanonicalManifest(options);
}

export function validateLegacyV3Manifest(
  manifest,
  authorization = V3_LEGACY_AUTHORIZATION,
) {
  const summary = v3.validateCanonicalManifest(manifest);
  const operations = baseOperations(manifest);
  const marker = manifest.operations.flatMap((operation) => operation.rows).find(
    (row) => row.resource_type === 'qa_seed_execution',
  );
  assertExact('seed key', manifest.seedKey, authorization.seedKey);
  assertExact('dataset version', manifest.seedVersion, authorization.datasetVersion);
  assertExact('marker ID', manifest.seedRegistryId, authorization.markerId);
  assertExact('manifest hash', manifest.manifestHash, authorization.manifestHash);
  assertExact('recomputed manifest hash', recomputeManifestHash(operations), authorization.manifestHash);
  assertExact(
    'identity fingerprint',
    manifest.identityMapFingerprint,
    authorization.identityMapFingerprint,
  );
  assertExact(
    'ownership fingerprint',
    manifest.rowOwnershipFingerprint,
    authorization.ownershipFingerprint,
  );
  assertExact(
    'recomputed ownership fingerprint',
    recomputeOwnershipFingerprint(operations, manifest.seedKey),
    authorization.ownershipFingerprint,
  );
  assertExact('base rows', summary.counts.baseRows, authorization.baseRows);
  assertExact('marker rows', summary.counts.markerRows, authorization.markerRows);
  assertExact('total rows', summary.counts.totalRows, authorization.totalRows);
  assertExact('tables', summary.counts.tables, authorization.tables);
  assertExact('marker resource ID', marker?.resource_id, authorization.markerId);
  validateLegacyV3Marker(marker, authorization);

  const events = rowsFor(manifest, 'tournament_match_events');
  const suspensions = rowsFor(manifest, 'tournament_player_suspensions');
  const ledgers = rowsFor(manifest, 'tournament_discipline_ledgers');
  const redEvent = events.find((row) => row.event_type === 'red_card');
  const redSuspension = suspensions.find((row) => row.source_type === 'direct_red');
  const redLedger = ledgers.find((row) => row.roster_player_id === redEvent?.roster_player_id);
  if (
    events.filter((row) => row.event_type === 'red_card').length !== 1
    || !redSuspension
    || redSuspension.roster_player_id !== redEvent?.roster_player_id
    || redSuspension.total_matches !== 2
    || redSuspension.served_matches !== 0
    || redSuspension.status !== 'active'
    || redLedger?.direct_reds !== 1
    || redLedger?.automatic_suspensions !== 0
  ) {
    throw new Error('Frozen V3 known direct-red inconsistency changed.');
  }
  return {
    ...summary,
    legacy: true,
    knownHistoricalInconsistency: 'direct-red automatic_suspensions is 0',
    reusableForNewDatasets: false,
  };
}

export function validateLegacyV3Marker(marker, authorization = V3_LEGACY_AUTHORIZATION) {
  const metadata = marker?.metadata || {};
  const checks = [
    ['resource ID', marker?.resource_id, authorization.markerId],
    ['seed key', metadata.seed_key, authorization.seedKey],
    ['dataset version', metadata.dataset_version, authorization.datasetVersion],
    ['manifest hash', metadata.manifest_hash, authorization.manifestHash],
    ['identity fingerprint', metadata.identity_map_fingerprint, authorization.identityMapFingerprint],
    ['ownership fingerprint', metadata.ownership_fingerprint, authorization.ownershipFingerprint],
    ['row count', metadata.expected_row_count, authorization.totalRows],
    ['table count', metadata.expected_table_count, authorization.tables],
  ];
  checks.forEach(([label, actual, expected]) => assertExact(`marker ${label}`, actual, expected));
  return true;
}

export function legacyV3OwnershipProof(manifest) {
  validateLegacyV3Manifest(manifest);
  return Object.freeze({
    seedKey: manifest.seedKey,
    organizationId: manifest.organizationId,
    organizationSlug: manifest.organizationSlug,
    creationKey: manifest.organizationCreationKey,
    markerId: manifest.seedRegistryId,
    manifestHash: manifest.manifestHash,
    identityMapFingerprint: manifest.identityMapFingerprint,
    ownershipFingerprint: manifest.rowOwnershipFingerprint,
    expectedRowCount: manifest.expectedRowCount,
    expectedTableCount: manifest.expectedTableCount,
  });
}
