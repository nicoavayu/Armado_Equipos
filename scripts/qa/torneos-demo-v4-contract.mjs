import { createHash } from 'node:crypto';

import * as v4 from './torneos-demo-manifest.mjs';
import { canonicalJson } from './torneos-qa-identity-map.mjs';

export const V4_CURRENT_AUTHORIZATION = Object.freeze({
  seedKey: 'torneos-demo-v4',
  datasetVersion: 4,
  markerId: '909f1a27-71b4-5797-a229-75f7a91fa7e8',
  manifestHash: 'ba26b0b199e212025a15b6b8b8aeedbe97d617f720088fb3bd32fa3b99f0c19d',
  identityMapFingerprint: 'd13bf642667c8a02c79a6f7b6db3325be3a2196c1569cfb655d67a72a3ab4cdd',
  ownershipFingerprint: '313fb9b527e8fbd591b795d6a19184aec5e8d264b16cbe336e22746387f7050a',
  baseRows: 586,
  markerRows: 1,
  totalRows: 587,
  tables: 32,
});

function assertExact(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`V4 ${label} changed: expected ${expected}, got ${actual}.`);
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

export function validateCurrentV4Manifest(
  manifest,
  authorization = V4_CURRENT_AUTHORIZATION,
) {
  const summary = v4.validateCanonicalManifest(manifest);
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
  assertExact('marker seed key', marker?.metadata?.seed_key, authorization.seedKey);
  assertExact('marker dataset version', marker?.metadata?.dataset_version, authorization.datasetVersion);
  assertExact('marker manifest hash', marker?.metadata?.manifest_hash, authorization.manifestHash);
  assertExact(
    'marker identity fingerprint',
    marker?.metadata?.identity_map_fingerprint,
    authorization.identityMapFingerprint,
  );
  assertExact(
    'marker ownership fingerprint',
    marker?.metadata?.ownership_fingerprint,
    authorization.ownershipFingerprint,
  );
  assertExact('marker row count', marker?.metadata?.expected_row_count, authorization.totalRows);
  assertExact('marker table count', marker?.metadata?.expected_table_count, authorization.tables);
  return summary;
}
