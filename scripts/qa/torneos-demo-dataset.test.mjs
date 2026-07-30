import assert from 'node:assert/strict';
import test from 'node:test';

import { dryRun } from './seed-torneos-demo.mjs';
import {
  buildCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import { buildTorneosDemoDataset } from './torneos-demo-dataset.mjs';
import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
  QA_IDENTITY_ROLES,
} from './torneos-qa-identity-map.mjs';

function fixtureIdentityMap(suffix = '', idOffset = 0) {
  return new QAIdentityMap(Object.fromEntries(QA_IDENTITY_ROLES.map((role, index) => [
    role,
    {
      auth_user_id: `00000000-0000-4000-8000-${String(index + 1 + idOffset).padStart(12, '0')}`,
      expected_email: `qa-${role}${suffix}@localhost.invalid`,
      logical_role: role,
      projected_relations: QA_IDENTITY_RELATIONS[role],
    },
  ])));
}

test('canonical manifest covers the requested QA edge cases', () => {
  const summary = validateCanonicalManifest(buildCanonicalManifest({
    identityMap: fixtureIdentityMap(),
  }));
  assert.deepEqual(summary, {
    teams: 8,
    rosterPlayers: 80,
    arma2Players: 2,
    provisionalPlayers: 78,
    rounds: 9,
    matches: 31,
    operations: 31,
    events: 14,
    suspensions: 2,
    manifestHash: summary.manifestHash,
    counts: {
      baseRows: 586,
      markerRows: 1,
      totalRows: 587,
      tables: 32,
    },
  });
});

test('stable IDs and manifest hash make repeated plans deterministic', () => {
  const identityMap = fixtureIdentityMap();
  const first = buildCanonicalManifest({ identityMap });
  const second = buildCanonicalManifest({ identityMap });
  assert.deepEqual(first, second);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(
    dryRun({ identityMap }).operations.every(
      (item) => item.operation === 'insert-only-after-preflight',
    ),
    true,
  );
});

test('resolved hash and identity fingerprint change with a real Auth UUID', () => {
  const first = buildCanonicalManifest({ identityMap: fixtureIdentityMap() });
  const changed = fixtureIdentityMap('-changed', 100);
  assert.notEqual(first.identityMapFingerprint, changed.fingerprint());
  assert.notEqual(
    first.manifestHash,
    buildCanonicalManifest({ identityMap: changed }).manifestHash,
  );
});

test('resolved marker persists the complete ownership and identity contract', () => {
  const manifest = buildCanonicalManifest({ identityMap: fixtureIdentityMap() });
  const marker = manifest.operations.flatMap((operation) => operation.rows).find(
    (row) => row.resource_type === 'qa_seed_execution',
  );
  assert.equal(manifest.expectedRowCount, 587);
  assert.equal(manifest.expectedTableCount, 32);
  assert.deepEqual(
    Object.keys(marker.metadata).sort(),
    [
      'created_at',
      'creation_key',
      'dataset_version',
      'expected_row_count',
      'expected_table_count',
      'identity_map_fingerprint',
      'manifest_hash',
      'ownership_fingerprint',
      'rollback_source',
      'seed_key',
    ].sort(),
  );
  assert.equal(JSON.stringify(marker.metadata).includes('@'), false);
});

test('red-card event and sanction identify the same roster player', () => {
  const manifest = buildCanonicalManifest({ identityMap: fixtureIdentityMap() });
  const events = manifest.operations.find(
    (operation) => operation.table === 'tournament_match_events',
  ).rows;
  const suspensions = manifest.operations.find(
    (operation) => operation.table === 'tournament_player_suspensions',
  ).rows;
  const red = events.find((event) => event.event_type === 'red_card');
  const sanction = suspensions.find((item) => item.source_type === 'direct_red');
  assert.equal(sanction.roster_player_id, red.roster_player_id);
  assert.equal(sanction.source_event_id, red.id);
});

test('ideal team is manual_curated, formation-valid, and duplicate-free', () => {
  const dataset = buildTorneosDemoDataset();
  assert.equal(dataset.manualIdealTeam.selectionMode, 'manual');
  assert.equal(dataset.manualIdealTeam.criterion, 'manual_curated');
  assert.equal(dataset.manualIdealTeam.playerIds.length, 5);
  assert.equal(new Set(dataset.manualIdealTeam.playerIds).size, 5);
  assert.deepEqual(dataset.manualIdealTeam.formation, ['ARQ', 'DEF', 'MED', 'DEL', 'DEL']);
  assert.equal('rankingWeights' in dataset.manualIdealTeam, false);
  assert.equal('votes' in dataset.manualIdealTeam, false);
});
