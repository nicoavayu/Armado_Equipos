import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCanonicalManifest as buildV4Manifest } from './torneos-demo-manifest.mjs';
import {
  V3_LEGACY_AUTHORIZATION,
  buildLegacyV3Manifest,
  validateLegacyV3Manifest,
} from './torneos-demo-v3-contract.mjs';
import { V4_CURRENT_AUTHORIZATION, validateCurrentV4Manifest } from './torneos-demo-v4-contract.mjs';
import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
  QA_IDENTITY_ROLES,
  loadQAIdentityMap,
} from './torneos-qa-identity-map.mjs';
import { validateTransitionArtifacts } from './transition-torneos-demo-v3-to-v4.mjs';

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

function localAuthorization(manifest) {
  return {
    seedKey: manifest.seedKey,
    datasetVersion: manifest.seedVersion,
    markerId: manifest.seedRegistryId,
    manifestHash: manifest.manifestHash,
    identityMapFingerprint: manifest.identityMapFingerprint,
    ownershipFingerprint: manifest.rowOwnershipFingerprint,
    baseRows: 586,
    markerRows: 1,
    totalRows: 587,
    tables: 32,
  };
}

test('frozen V3 authorization pins the installed legacy contract exactly', () => {
  assert.deepEqual(V3_LEGACY_AUTHORIZATION, {
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
});

test('current V4 authorization pins the corrected contract exactly', () => {
  assert.deepEqual(V4_CURRENT_AUTHORIZATION, {
    seedKey: 'torneos-demo-v4',
    datasetVersion: 4,
    markerId: '909f1a27-71b4-5797-a229-75f7a91fa7e8',
    manifestHash: 'dcc0be5bedefafddd795e3d91b8feb48c0cd1121bcca0ab77f5c84db2b3678c0',
    identityMapFingerprint: 'd13bf642667c8a02c79a6f7b6db3325be3a2196c1569cfb655d67a72a3ab4cdd',
    ownershipFingerprint: '313fb9b527e8fbd591b795d6a19184aec5e8d264b16cbe336e22746387f7050a',
    baseRows: 586,
    markerRows: 1,
    totalRows: 587,
    tables: 32,
  });
});

test('V4 corrects discipline plus the five unprovisioned legacy QA shields', () => {
  const identityMap = fixtureIdentityMap();
  const v3Manifest = buildLegacyV3Manifest({ identityMap });
  const v4Manifest = buildV4Manifest({ identityMap });
  const v3Authorization = localAuthorization(v3Manifest);
  const v4Authorization = localAuthorization(v4Manifest);
  const transition = validateTransitionArtifacts({
    v3Manifest,
    v4Manifest,
    v3Authorization,
    v4Authorization,
  });
  assert.equal(transition.differences.length, 11);
  const discipline = transition.differences.find(
    (difference) => difference.table === 'tournament_discipline_ledgers',
  );
  assert.deepEqual(
    {
      table: discipline.table,
      column: discipline.column,
      before: discipline.before,
      after: discipline.after,
    },
    {
      table: 'tournament_discipline_ledgers',
      column: 'automatic_suspensions',
      before: 0,
      after: 1,
    },
  );
  assert.equal(transition.differences.filter(
    (difference) => difference.table === 'tournament_team_entries'
      && difference.column === 'shield_path' && difference.after === null,
  ).length, 5);
  assert.equal(transition.differences.filter(
    (difference) => difference.table === 'tournament_competition_participants'
      && difference.column === 'snapshot_shield_path' && difference.after === null,
  ).length, 5);
  const legacy = validateLegacyV3Manifest(v3Manifest, v3Authorization);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.reusableForNewDatasets, false);
  validateCurrentV4Manifest(v4Manifest, v4Authorization);

  const changedV3 = structuredClone(v3Manifest);
  changedV3.operations.find(
    (operation) => operation.table === 'tournament_discipline_ledgers',
  ).rows.find((row) => row.direct_reds === 1).automatic_suspensions = 1;
  assert.throws(
    () => validateLegacyV3Manifest(changedV3, v3Authorization),
    /recomputed manifest hash changed|known direct-red inconsistency changed/,
  );
});

test('ignored normalized identity map reconstructs the exact V3 and V4 contracts', {
  skip: !process.env.QA_IDENTITY_MAP_FILE,
}, async () => {
  const identityMap = await loadQAIdentityMap();
  validateLegacyV3Manifest(buildLegacyV3Manifest({ identityMap }));
  validateCurrentV4Manifest(buildV4Manifest({ identityMap }));
});
