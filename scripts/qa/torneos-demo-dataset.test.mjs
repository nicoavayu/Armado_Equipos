import assert from 'node:assert/strict';
import test from 'node:test';

import { dryRun } from './seed-torneos-demo.mjs';
import {
  buildCanonicalManifest,
  validateCanonicalManifest,
} from './torneos-demo-manifest.mjs';
import { buildTorneosDemoDataset } from './torneos-demo-dataset.mjs';

test('canonical manifest covers the requested QA edge cases', () => {
  const summary = validateCanonicalManifest(buildCanonicalManifest());
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
    tables: 32,
  });
});

test('stable IDs and manifest hash make repeated plans deterministic', () => {
  const first = buildCanonicalManifest();
  const second = buildCanonicalManifest();
  assert.deepEqual(first, second);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(
    dryRun().operations.every((item) => item.operation === 'insert-only-after-preflight'),
    true,
  );
});

test('red-card event and sanction identify the same roster player', () => {
  const manifest = buildCanonicalManifest();
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
