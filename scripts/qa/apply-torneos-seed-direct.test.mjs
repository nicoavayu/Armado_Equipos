import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAuthorizedManifest,
  validateRunnerPreflight,
} from './apply-torneos-seed-direct.mjs';
import {
  buildCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
  QA_IDENTITY_ROLES,
} from './torneos-qa-identity-map.mjs';

function fixtureIdentityMap() {
  return new QAIdentityMap(Object.fromEntries(QA_IDENTITY_ROLES.map((role, index) => [
    role,
    {
      auth_user_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      expected_email: `qa-${role}@localhost.invalid`,
      logical_role: role,
      projected_relations: QA_IDENTITY_RELATIONS[role],
    },
  ])));
}

function fixture() {
  const manifest = buildCanonicalManifest({ identityMap: fixtureIdentityMap() });
  return {
    manifest,
    authorization: {
      seedKey: manifest.seedKey,
      manifestHash: manifest.manifestHash,
      identityMapFingerprint: manifest.identityMapFingerprint,
      ownershipFingerprint: manifest.rowOwnershipFingerprint,
      baseRows: 586,
      markerRows: 1,
      totalRows: 587,
      tables: 32,
    },
  };
}

function manifestWithRowDelta(manifest, delta) {
  const changed = structuredClone(manifest);
  const operation = changed.operations.find((item) => (
    item.table !== 'tournament_audit_log' && item.rows.length > 1
  ));
  if (delta === -1) operation.rows.pop();
  if (delta === 1) operation.rows.push(structuredClone(operation.rows[0]));
  return changed;
}

function manifestWithTableCount(manifest, tables) {
  const changed = structuredClone(manifest);
  if (tables === 31) {
    const removed = changed.operations.findIndex((operation) => (
      operation.table !== 'tournament_audit_log' && operation.rows.length > 0
    ));
    const [operation] = changed.operations.splice(removed, 1);
    changed.operations[0].rows.push(...operation.rows);
    return changed;
  }
  changed.operations.push({
    table: 'qa_unexpected_table',
    identity: ['id'],
    rows: [],
    naturalKeys: [],
  });
  return changed;
}

test('direct runner preflight accepts only the exact validated manifest contract', () => {
  const { manifest, authorization } = fixture();
  const validation = validateRunnerPreflight(manifest, authorization);
  assert.deepEqual(validation, validateCanonicalManifest(manifest));
  assert.deepEqual(validation.counts, {
    baseRows: 586,
    markerRows: 1,
    totalRows: 587,
    tables: 32,
  });
});

test('direct runner preflight rejects a missing validated total-row property explicitly', () => {
  const { manifest, authorization } = fixture();
  const validation = structuredClone(validateCanonicalManifest(manifest));
  delete validation.counts.totalRows;
  assert.throws(
    () => assertAuthorizedManifest(manifest, validation, authorization),
    /validation\.counts\.totalRows/,
  );
});

test('direct runner preflight rejects 586 or 588 total rows', () => {
  const { manifest, authorization } = fixture();
  for (const delta of [-1, 1]) {
    assert.throws(
      () => validateRunnerPreflight(
        manifestWithRowDelta(manifest, delta),
        authorization,
      ),
      new RegExp(`${587 + delta} total rows`),
    );
  }
});

test('direct runner preflight rejects 31 or 33 tables', () => {
  const { manifest, authorization } = fixture();
  for (const tables of [31, 33]) {
    assert.throws(
      () => validateRunnerPreflight(
        manifestWithTableCount(manifest, tables),
        authorization,
      ),
      new RegExp(`${tables} tables`),
    );
  }
});

test('direct runner preflight rejects an incorrect manifest hash or fingerprint', () => {
  const { manifest, authorization } = fixture();
  for (const property of [
    'manifestHash',
    'identityMapFingerprint',
    'rowOwnershipFingerprint',
  ]) {
    const changed = structuredClone(manifest);
    changed[property] = '0'.repeat(64);
    assert.throws(
      () => validateRunnerPreflight(changed, authorization),
      /does not match the remote authorization/,
    );
  }
});

test('direct runner preflight requires exactly one seed marker', () => {
  const { manifest, authorization } = fixture();
  const changed = structuredClone(manifest);
  const marker = changed.operations
    .flatMap((operation) => operation.rows)
    .find((row) => row.resource_type === 'qa_seed_execution');
  marker.resource_type = 'not_a_seed_execution';
  assert.throws(
    () => validateRunnerPreflight(changed, authorization),
    /0 marker/,
  );
});
