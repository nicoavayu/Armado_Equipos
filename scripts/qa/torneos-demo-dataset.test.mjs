import assert from 'node:assert/strict';
import test from 'node:test';

import { dryRun, validateDemoDataset } from './seed-torneos-demo.mjs';
import {
  buildIdempotentSeedPlan,
  buildTorneosDemoDataset,
} from './torneos-demo-dataset.mjs';

test('demo dataset covers every authorized QA edge case', () => {
  const summary = validateDemoDataset(buildTorneosDemoDataset());
  assert.deepEqual(summary, {
    teams: 8,
    players: 80,
    rounds: 7,
    leagueMatches: 28,
    playoffMatches: 3,
    events: 6,
    sanctions: 2,
  });
});

test('stable IDs and upsert plan make repeated dry-runs deterministic', () => {
  const first = buildTorneosDemoDataset();
  const second = buildTorneosDemoDataset();
  assert.deepEqual(first, second);
  assert.deepEqual(buildIdempotentSeedPlan(first), buildIdempotentSeedPlan(second));
  assert.equal(dryRun().operations.every((item) => item.operation === 'upsert'), true);
});

test('ideal team is explicitly manual and never ranked automatically', () => {
  const dataset = buildTorneosDemoDataset();
  assert.equal(dataset.manualIdealTeam.selectionMode, 'manual');
  assert.equal('rankingWeights' in dataset.manualIdealTeam, false);
  assert.equal('votes' in dataset.manualIdealTeam, false);
});
