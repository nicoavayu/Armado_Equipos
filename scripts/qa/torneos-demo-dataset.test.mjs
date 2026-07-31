import assert from 'node:assert/strict';
import test from 'node:test';

import { dryRun } from './seed-torneos-demo.mjs';
import {
  buildCanonicalManifest,
  deriveQAIdentityRelations,
  validateCanonicalManifest,
  validateQAIdentityRelations,
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
    identityRelations: summary.identityRelations,
    counts: {
      baseRows: 586,
      markerRows: 1,
      totalRows: 587,
      tables: 32,
    },
  });
});

test('identity relations are derived exactly and collaborator has no manager or roster link', () => {
  const manifest = buildCanonicalManifest({ identityMap: fixtureIdentityMap() });
  const actual = deriveQAIdentityRelations(manifest);
  assert.deepEqual(actual, QA_IDENTITY_RELATIONS);
  assert.deepEqual(actual.collaborator, [
    'organization_membership:collaborator:active:1',
    'reference:tournament_organization_members.user_id:1',
  ]);
  assert.equal(actual.outsider.length, 0);
  assert.equal(actual.delegate.filter((relation) => relation.startsWith('team_manager:')).length, 1);
  assert.equal(actual.delegate.filter((relation) => relation.startsWith('roster_link:')).length, 1);
  assert.equal(actual.player.filter((relation) => relation.startsWith('roster_link:')).length, 1);
  assert.equal(actual.owner.filter((relation) => relation.includes(':captain:active')).length, 7);
  assert.equal(actual.admin.filter((relation) => relation.includes(':captain:active')).length, 1);
});

test('identity relation validation rejects missing, unexpected, incorrect and duplicate relations', () => {
  const manifest = buildCanonicalManifest({ identityMap: fixtureIdentityMap() });
  const managers = manifest.operations.find(
    (operation) => operation.table === 'tournament_team_managers',
  ).rows;

  const missing = structuredClone(manifest);
  missing.operations.find(
    (operation) => operation.table === 'tournament_team_managers',
  ).rows.pop();
  assert.throws(() => validateQAIdentityRelations(missing), /missing:|unexpected:/);

  const unexpected = structuredClone(manifest);
  unexpected.operations.find(
    (operation) => operation.table === 'tournament_team_managers',
  ).rows[2].user_id = manifest.users.collaborator.id;
  assert.throws(() => validateQAIdentityRelations(unexpected), /missing:|unexpected:/);

  for (const [field, value] of [['role', 'delegate'], ['status', 'revoked']]) {
    const incorrect = structuredClone(manifest);
    incorrect.operations.find(
      (operation) => operation.table === 'tournament_team_managers',
    ).rows[0][field] = value;
    assert.throws(() => validateQAIdentityRelations(incorrect), /missing:|unexpected:/);
  }

  const duplicate = structuredClone(manifest);
  duplicate.operations.find(
    (operation) => operation.table === 'tournament_team_managers',
  ).rows.push(structuredClone(managers[0]));
  assert.throws(() => validateQAIdentityRelations(duplicate), /Duplicate QA identity relation/);
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
  assert.notEqual(marker.resource_id, 'b66dc982-e959-5780-8b72-ab70761e2bec');
  assert.notEqual(
    manifest.manifestHash,
    '48b413d1c6673ad96d3ce5bb30fecc89bd2c432b465a00447eb6f2cb51befb2f',
  );
  assert.notEqual(
    manifest.identityMapFingerprint,
    '77d95cb8caee567de1e8275b81c1e8c850eb59dcf6025504cab93c634ff3657c',
  );
  assert.notEqual(
    manifest.rowOwnershipFingerprint,
    '9375b59f2f908aec4b0d5b32b79514491e2ebbd648c4d9e7c245064c772ebe8d',
  );
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
