#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import productionGuard from './production-guard.js';
import {
  buildIdempotentSeedPlan,
  buildTorneosDemoDataset,
} from './torneos-demo-dataset.mjs';

const { assertSafeSeedTarget } = productionGuard;

export function validateDemoDataset(dataset) {
  const matches = dataset.rounds.flatMap((round) => round.matches);
  const allPlayers = dataset.teams.flatMap((team) => team.roster);
  const outcomes = new Set([
    ...matches.map((match) => match.outcome),
    ...dataset.playoffs.semifinals.map((match) => match.outcome),
    dataset.playoffs.final.outcome,
  ]);
  const states = new Set(matches.map((match) => match.state));

  const assertions = [
    [dataset.teams.length === 8, 'exactly 8 teams'],
    [dataset.teams.every((team) => team.roster.length >= 8), 'complete rosters'],
    [dataset.rounds.length === 7, 'seven league rounds'],
    [dataset.playoffs.semifinals.length === 2, 'two semifinals'],
    [Boolean(dataset.playoffs.final), 'one final'],
    [outcomes.has('draw'), 'a draw'],
    [outcomes.has('penalties'), 'a penalty shootout'],
    [outcomes.has('walkover'), 'a walkover'],
    [states.has('suspended'), 'a suspended match'],
    [states.has('postponed'), 'a postponed match'],
    [states.has('under_review'), 'a result under review'],
    [dataset.events.some((event) => event.type === 'goal'), 'goals'],
    [dataset.events.some((event) => event.assistPlayerId), 'assists'],
    [dataset.events.some((event) => event.type.includes('card')), 'cards'],
    [dataset.sanctions.length >= 2, 'sanctions'],
    [dataset.teams.some((team) => !team.shieldPath), 'teams without shields'],
    [allPlayers.some((player) => !player.avatarUrl), 'players without avatars'],
    [
      dataset.teams.some((team) => team.name.length > 35)
      && allPlayers.some((player) => player.displayName.length > 35),
      'long names',
    ],
    [
      new Set(dataset.tournaments.map((item) => item.status)).size >= 4,
      'multiple tournament states',
    ],
    [
      dataset.manualIdealTeam.selectionMode === 'manual',
      'explicitly manual ideal-team selection',
    ],
  ];

  const missing = assertions.filter(([passes]) => !passes).map(([, label]) => label);
  if (missing.length > 0) {
    throw new Error(`Demo dataset is incomplete: ${missing.join(', ')}.`);
  }
  return {
    teams: dataset.teams.length,
    players: allPlayers.length,
    rounds: dataset.rounds.length,
    leagueMatches: matches.length,
    playoffMatches: dataset.playoffs.semifinals.length + 1,
    events: dataset.events.length,
    sanctions: dataset.sanctions.length,
  };
}

export function dryRun() {
  const dataset = buildTorneosDemoDataset();
  const summary = validateDemoDataset(dataset);
  const plan = buildIdempotentSeedPlan(dataset);
  const operations = plan.map(({ entity, conflictTarget, records }) => ({
    entity,
    operation: 'upsert',
    conflictTarget,
    records: records.length,
  }));
  return {
    mode: 'dry-run',
    seedKey: dataset.seedKey,
    summary,
    operations,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const wantsApply = args.has('--apply') || args.has('--execute');
  assertSafeSeedTarget({ dryRun: !wantsApply });

  if (wantsApply) {
    throw new Error(
      'Seed execution is intentionally disabled in QA Foundation. '
      + 'Only the idempotent dry-run plan is authorized in this stage.',
    );
  }
  if (args.size > 0 && !args.has('--dry-run')) {
    throw new Error('Unknown arguments. Use --dry-run.');
  }

  console.log(JSON.stringify(dryRun(), null, 2));
}
