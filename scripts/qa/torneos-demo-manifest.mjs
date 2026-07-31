import { createHash } from 'node:crypto';

import {
  buildTorneosDemoDataset,
  stableUuid,
} from './torneos-demo-dataset.mjs';
import {
  QAIdentityMap,
  QA_IDENTITY_RELATIONS,
  QA_IDENTITY_ROLES,
} from './torneos-qa-identity-map.mjs';

export const SEED_KEY = 'torneos-demo-v3';
export const PREVIOUS_SEED_KEY = 'torneos-demo-v2';
export const SEED_VERSION = 3;
export const SEED_ORGANIZATION_SLUG = 'qa-metropolitana';
export const FIXED_NOW = '2026-07-30T12:00:00.000Z';

export const QA_USER_ROLES = QA_IDENTITY_ROLES;

const ROLE_DISPLAY_NAMES = Object.freeze({
  owner: 'QA Owner Torneos',
  admin: 'QA Admin Torneos',
  delegate: 'QA Delegate Torneos',
  player: 'QA Player Torneos',
  collaborator: 'QA Collaborator Torneos',
  outsider: 'QA Outsider Torneos',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function usersFromIdentityMap(identityMap) {
  return Object.fromEntries(QA_USER_ROLES.map((role) => {
    const identity = identityMap.get(role);
    return [role, {
      role,
      id: identity.auth_user_id,
      email: identity.expected_email,
      displayName: ROLE_DISPLAY_NAMES[role],
      projectedRelations: identity.projected_relations,
    }];
  }));
}

function table(name, identity, rows, naturalKeys = []) {
  return { table: name, identity, rows, naturalKeys };
}

function outcomeFor(match) {
  if (match.outcome === 'walkover') return 'walkover_home';
  if (match.outcome === 'postponed') return 'postponed_before_start';
  if (match.outcome === 'suspended') return 'suspended';
  return 'played';
}

function operationState(match) {
  if (match.state === 'suspended') {
    return { status: 'under_review', matchStatus: 'suspended' };
  }
  if (match.state === 'under_review') {
    return { status: 'under_review', matchStatus: 'awaiting_validation' };
  }
  if (match.state === 'postponed') {
    return { status: 'draft', matchStatus: 'ready' };
  }
  if (match.outcome === 'walkover') {
    return { status: 'official', matchStatus: 'administrative' };
  }
  return { status: 'official', matchStatus: 'official' };
}

function isOfficialForProjection(match) {
  return match.state === 'official';
}

function calculateLeagueTable(teams, leagueMatches) {
  const rows = new Map(teams.map((team) => [team.id, {
    team,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    walkovers: 0,
    administrativeResults: 0,
    fairPlayPoints: 0,
    recent: [],
  }]));
  for (const match of leagueMatches.filter(isOfficialForProjection)) {
    const home = rows.get(match.homeTeamId);
    const away = rows.get(match.awayTeamId);
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.outcome === 'walkover') {
      home.walkovers += 1;
      away.walkovers += 1;
      home.administrativeResults += 1;
      away.administrativeResults += 1;
    }
    if (match.homeScore > match.awayScore) {
      home.won += 1;
      away.lost += 1;
      home.recent.push('W');
      away.recent.push('L');
    } else if (match.homeScore < match.awayScore) {
      away.won += 1;
      home.lost += 1;
      away.recent.push('W');
      home.recent.push('L');
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.recent.push('D');
      away.recent.push('D');
    }
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
      points: row.won * 3 + row.drawn,
    }))
    .sort((left, right) => (
      right.points - left.points
      || right.goalDifference - left.goalDifference
      || right.goalsFor - left.goalsFor
      || left.team.shortName.localeCompare(right.team.shortName)
    ));
}

function buildCanonicalEvents(dataset, matchById, operationIdByMatch) {
  const rows = [];
  const sequenceByOperation = new Map();
  const nextSequence = (operationId) => {
    const value = (sequenceByOperation.get(operationId) || 0) + 1;
    sequenceByOperation.set(operationId, value);
    return value;
  };
  const teamByPlayer = new Map(dataset.teams.flatMap(
    (team) => team.roster.map((player) => [player.id, team.id]),
  ));

  for (const event of dataset.events) {
    const operationId = operationIdByMatch.get(event.matchId);
    const base = {
      id: event.id,
      organization_id: dataset.organization.id,
      match_operation_id: operationId,
      match_id: event.matchId,
      team_entry_id: teamByPlayer.get(event.playerId),
      roster_player_id: event.playerId,
      related_roster_player_id: null,
      related_event_id: null,
      event_type: event.type.replace('_card', '_card'),
      minute: event.minute,
      period: 'second_half',
      sequence_number: nextSequence(operationId),
      unidentified_player_reason: null,
      metadata: { seedKey: SEED_KEY },
      created_by: null,
    };
    rows.push(base);
    if (event.type === 'goal' && event.assistPlayerId) {
      rows.push({
        ...base,
        id: stableUuid(`assist:${event.id}`),
        roster_player_id: event.assistPlayerId,
        related_roster_player_id: event.playerId,
        related_event_id: event.id,
        event_type: 'assist',
        sequence_number: nextSequence(operationId),
      });
    }
  }

  const servedPlayer = dataset.teams[4].roster[2];
  const matchesForServedPlayer = [...matchById.values()]
    .filter((match) => (
      match.stage === 'league'
      && isOfficialForProjection(match)
      && [match.homeTeamId, match.awayTeamId].includes(servedPlayer.teamId)
    ))
    .sort((left, right) => left.round - right.round);
  const yellowEvents = matchesForServedPlayer.slice(0, 5).map((match, index) => {
    const operationId = operationIdByMatch.get(match.id);
    return {
      id: stableUuid(`event:yellow-accumulation:${index + 1}`),
      organization_id: dataset.organization.id,
      match_operation_id: operationId,
      match_id: match.id,
      team_entry_id: servedPlayer.teamId,
      roster_player_id: servedPlayer.id,
      related_roster_player_id: null,
      related_event_id: null,
      event_type: 'yellow_card',
      minute: 15 + index * 7,
      period: index < 3 ? 'first_half' : 'second_half',
      sequence_number: nextSequence(operationId),
      unidentified_player_reason: null,
      metadata: { seedKey: SEED_KEY, accumulationOrdinal: index + 1 },
      created_by: null,
    };
  });
  rows.push(...yellowEvents);
  return {
    rows,
    servedSuspensionSourceEventId: yellowEvents.at(-1).id,
    servedSuspensionMatchId: matchesForServedPlayer[5]?.id
      || matchesForServedPlayer.at(-1).id,
  };
}

function buildManifestTemplate({ users }) {
  const dataset = buildTorneosDemoDataset();
  const owner = users.owner.id;
  const activeTournament = dataset.tournaments.find((item) => item.isPrimaryDataset);
  const seasonId = stableUuid('season:2026');
  const categoryId = stableUuid('category:open');
  const participantSetId = stableUuid('participant-set:v1');
  const fixtureVersionId = stableUuid('fixture-version:v1');
  const leaguePhaseId = stableUuid('phase:league');
  const semifinalPhaseId = stableUuid('phase:semifinal');
  const finalPhaseId = stableUuid('phase:final');
  const semifinalRoundId = stableUuid('round:semifinal');
  const finalRoundId = stableUuid('round:final');
  const revisionId = stableUuid('standings-revision:league:v1');
  const seedRegistryId = stableUuid(`seed-registry:${SEED_KEY}`);
  const creationKey = stableUuid(`seed-key:${SEED_KEY}`);
  const participantFingerprint = sha256(
    dataset.teams.map((team) => team.id).sort().join(':'),
  );

  const participants = dataset.teams.map((team, index) => ({
    id: stableUuid(`participant:${team.shortName}`),
    organization_id: dataset.organization.id,
    season_id: seasonId,
    tournament_id: activeTournament.id,
    category_id: categoryId,
    participant_set_id: participantSetId,
    team_entry_id: team.id,
    seed_number: index + 1,
    pot_number: null,
    status: 'active',
    snapshot_name: team.name,
    snapshot_short_name: team.shortName,
    snapshot_shield_path: team.shieldPath?.replace(/^\//, '') || null,
    snapshot_primary_color: '#5575FF',
    snapshot_secondary_color: '#111827',
    frozen_at: FIXED_NOW,
  }));
  const participantByTeam = new Map(participants.map((row) => [row.team_entry_id, row]));

  const leagueMatches = dataset.rounds.flatMap((round) => round.matches);
  const playoffMatches = [...dataset.playoffs.semifinals, dataset.playoffs.final];
  const allMatches = [...leagueMatches, ...playoffMatches];
  const matchById = new Map(allMatches.map((match) => [match.id, match]));
  const operationIdByMatch = new Map(allMatches.map(
    (match) => [match.id, stableUuid(`operation:${match.id}`)],
  ));
  const canonicalEvents = buildCanonicalEvents(dataset, matchById, operationIdByMatch);
  canonicalEvents.rows.forEach((event) => { event.created_by = owner; });

  const rosterIdByTeam = new Map(dataset.teams.map(
    (team) => [team.id, stableUuid(`roster:${team.shortName}:v1`)],
  ));
  const provisionalRows = dataset.teams.flatMap((team) => team.roster)
    .filter((player) => player.source === 'provisional')
    .map((player) => ({
      id: stableUuid(`provisional:${player.id}`),
      organization_id: dataset.organization.id,
      display_name: player.displayName,
      normalized_name: player.displayName.toLocaleLowerCase('es-AR'),
      contact_email: null,
      contact_phone: null,
      created_by: owner,
      claimed_by_user_id: null,
      claim_status: 'unclaimed',
    }));
  const provisionalIdFor = (player) => stableUuid(`provisional:${player.id}`);

  const rosterRows = dataset.teams.flatMap((team) => team.roster.map((player) => ({
    id: player.id,
    organization_id: dataset.organization.id,
    team_entry_id: team.id,
    roster_id: rosterIdByTeam.get(team.id),
    arma2_user_id: player.qaRole ? users[player.qaRole].id : null,
    provisional_player_id: player.qaRole ? null : provisionalIdFor(player),
    display_name: player.displayName,
    avatar_url: player.avatarUrl,
    shirt_number: player.shirtNumber,
    primary_position: player.position === 'goalkeeper'
      ? 'ARQ'
      : (player.shirtNumber % 3 === 0 ? 'MED' : (player.shirtNumber % 2 === 0 ? 'DEF' : 'DEL')),
    secondary_position: null,
    is_goalkeeper: player.position === 'goalkeeper',
    status: 'active',
    eligibility_status: player.eligibility === 'pending_review' ? 'under_review' : 'eligible',
    added_by: owner,
  })));

  const rounds = [
    ...dataset.rounds.map((round) => ({
      id: round.id,
      organization_id: dataset.organization.id,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      fixture_version_id: fixtureVersionId,
      phase_id: leaguePhaseId,
      group_id: null,
      round_number: round.number,
      name: round.label,
      status: 'scheduled',
      starts_at: null,
      ends_at: null,
      sort_order: round.number,
    })),
    {
      id: semifinalRoundId,
      organization_id: dataset.organization.id,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      fixture_version_id: fixtureVersionId,
      phase_id: semifinalPhaseId,
      group_id: null,
      round_number: 1,
      name: 'Semifinales',
      status: 'scheduled',
      starts_at: null,
      ends_at: null,
      sort_order: 8,
    },
    {
      id: finalRoundId,
      organization_id: dataset.organization.id,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      fixture_version_id: fixtureVersionId,
      phase_id: finalPhaseId,
      group_id: null,
      round_number: 1,
      name: 'Final',
      status: 'scheduled',
      starts_at: null,
      ends_at: null,
      sort_order: 9,
    },
  ];

  const matchRows = allMatches.map((match, index) => ({
    id: match.id,
    organization_id: dataset.organization.id,
    season_id: seasonId,
    tournament_id: activeTournament.id,
    category_id: categoryId,
    participant_set_id: participantSetId,
    fixture_version_id: fixtureVersionId,
    phase_id: match.stage === 'league'
      ? leaguePhaseId
      : (match.stage === 'semifinal' ? semifinalPhaseId : finalPhaseId),
    group_id: null,
    round_id: match.stage === 'league'
      ? dataset.rounds[match.round - 1].id
      : (match.stage === 'semifinal' ? semifinalRoundId : finalRoundId),
    match_number: index + 1,
    leg_number: 1,
    tie_key: match.stage === 'league' ? null : `${match.stage}-${match.order}`,
    home_participant_id: participantByTeam.get(match.homeTeamId).id,
    away_participant_id: participantByTeam.get(match.awayTeamId).id,
    status: match.state === 'postponed' ? 'postponed' : 'ready',
    scheduled_at: null,
    venue_id: null,
    court_id: null,
    duration_minutes: null,
    created_by: owner,
    postponed_at: match.state === 'postponed' ? FIXED_NOW : null,
    cancelled_at: null,
  }));

  const operationRows = allMatches.map((match) => {
    const state = operationState(match);
    const lifecycle = state.status === 'official'
      ? {
        submitted_by: owner,
        submitted_at: FIXED_NOW,
        validated_by: users.admin.id,
        validated_at: FIXED_NOW,
        official_by: owner,
        official_at: FIXED_NOW,
        closed_at: FIXED_NOW,
      }
      : (state.status === 'under_review'
        ? {
          submitted_by: owner,
          submitted_at: FIXED_NOW,
          validated_by: null,
          validated_at: null,
          official_by: null,
          official_at: null,
          closed_at: null,
        }
        : {
          submitted_by: null,
          submitted_at: null,
          validated_by: null,
          validated_at: null,
          official_by: null,
          official_at: null,
          closed_at: null,
        });
    return {
      id: operationIdByMatch.get(match.id),
      organization_id: dataset.organization.id,
      season_id: seasonId,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      fixture_version_id: fixtureVersionId,
      phase_id: match.stage === 'league'
        ? leaguePhaseId
        : (match.stage === 'semifinal' ? semifinalPhaseId : finalPhaseId),
      round_id: match.stage === 'league'
        ? dataset.rounds[match.round - 1].id
        : (match.stage === 'semifinal' ? semifinalRoundId : finalRoundId),
      match_id: match.id,
      home_team_entry_id: match.homeTeamId,
      away_team_entry_id: match.awayTeamId,
      status: state.status,
      match_status: state.matchStatus,
      operation_version: 1,
      source_operation_id: null,
      match_snapshot: { seedKey: SEED_KEY, state: match.state, outcome: match.outcome },
      home_team_snapshot: {
        id: match.homeTeamId,
        name: dataset.teams.find((team) => team.id === match.homeTeamId).name,
      },
      away_team_snapshot: {
        id: match.awayTeamId,
        name: dataset.teams.find((team) => team.id === match.awayTeamId).name,
      },
      notes: `QA ${match.state}/${match.outcome}`,
      opened_by: owner,
      opened_at: FIXED_NOW,
      ...lifecycle,
    };
  });

  const scoreRows = allMatches.filter((match) => match.homeScore !== null).map((match) => ({
    match_operation_id: operationIdByMatch.get(match.id),
    organization_id: dataset.organization.id,
    match_id: match.id,
    home_score: match.homeScore,
    away_score: match.awayScore,
    home_score_first_half: null,
    away_score_first_half: null,
    home_penalties: match.homePenalties,
    away_penalties: match.awayPenalties,
    score_type: match.outcome === 'walkover'
      ? 'walkover'
      : (match.outcome === 'penalties' ? 'penalty_shootout_future' : 'played'),
  }));
  const outcomeRows = allMatches.map((match) => ({
    match_operation_id: operationIdByMatch.get(match.id),
    organization_id: dataset.organization.id,
    match_id: match.id,
    outcome_type: outcomeFor(match),
    started_at: match.state === 'postponed' ? null : FIXED_NOW,
    ended_at: isOfficialForProjection(match) ? FIXED_NOW : null,
    suspension_minute: match.suspendedMinute || null,
    suspension_period: match.state === 'suspended' ? 'second_half' : null,
    events_remain_valid: match.state !== 'postponed',
    reason_code: match.outcome === 'walkover'
      ? 'away_no_show'
      : (match.state === 'suspended' ? 'weather' : null),
    reason_text: match.state === 'suspended'
      ? 'Suspendido por tormenta eléctrica en el minuto 63.'
      : null,
    administrative_home_score: match.outcome === 'walkover' ? match.homeScore : null,
    administrative_away_score: match.outcome === 'walkover' ? match.awayScore : null,
    counts_for_standings: isOfficialForProjection(match),
    counts_for_player_stats: isOfficialForProjection(match) && match.outcome !== 'walkover',
    requires_resolution: ['suspended', 'under_review'].includes(match.state),
    resolved_by: null,
    resolved_at: null,
  }));

  const reviewMatches = allMatches.filter(
    (match) => ['suspended', 'under_review'].includes(match.state),
  );
  const firstMatch = leagueMatches[0];
  const firstMatchTeams = new Set([firstMatch.homeTeamId, firstMatch.awayTeamId]);
  const operationPlayerRows = rosterRows.filter(
    (player) => firstMatchTeams.has(player.team_entry_id),
  ).map((player) => ({
    id: stableUuid(`operation-player:${firstMatch.id}:${player.id}`),
    organization_id: dataset.organization.id,
    match_operation_id: operationIdByMatch.get(firstMatch.id),
    match_id: firstMatch.id,
    team_entry_id: player.team_entry_id,
    roster_player_id: player.id,
    display_name_snapshot: player.display_name,
    avatar_url_snapshot: player.avatar_url,
    shirt_number_snapshot: player.shirt_number,
    position_snapshot: player.primary_position,
    is_goalkeeper: player.is_goalkeeper,
    is_captain: player.shirt_number === 1,
    lineup_status: player.shirt_number <= 5 ? 'starter' : 'substitute',
    attendance_status: 'present',
  }));
  const rosterById = new Map(rosterRows.map((player) => [player.id, player]));
  const representedOperationPlayers = new Set(operationPlayerRows.map(
    (player) => `${player.match_operation_id}:${player.roster_player_id}`,
  ));
  canonicalEvents.rows.forEach((event) => {
    const key = `${event.match_operation_id}:${event.roster_player_id}`;
    if (representedOperationPlayers.has(key)) return;
    const player = rosterById.get(event.roster_player_id);
    operationPlayerRows.push({
      id: stableUuid(`operation-player:${event.match_id}:${player.id}`),
      organization_id: dataset.organization.id,
      match_operation_id: event.match_operation_id,
      match_id: event.match_id,
      team_entry_id: player.team_entry_id,
      roster_player_id: player.id,
      display_name_snapshot: player.display_name,
      avatar_url_snapshot: player.avatar_url,
      shirt_number_snapshot: player.shirt_number,
      position_snapshot: player.primary_position,
      is_goalkeeper: player.is_goalkeeper,
      is_captain: false,
      lineup_status: 'starter',
      attendance_status: 'present',
    });
    representedOperationPlayers.add(key);
  });

  const leagueTable = calculateLeagueTable(dataset.teams, leagueMatches);
  leagueTable.forEach((standing) => {
    standing.fairPlayPoints = canonicalEvents.rows.reduce((points, event) => {
      if (event.team_entry_id !== standing.team.id) return points;
      if (event.event_type === 'yellow_card') return points + 1;
      if (event.event_type === 'red_card') return points + 3;
      return points;
    }, 0);
  });
  const statsByPlayer = new Map(rosterRows.map((player) => [player.id, {
    goals: 0,
    assists: 0,
    yellow: 0,
    red: 0,
  }]));
  canonicalEvents.rows.forEach((event) => {
    const stats = statsByPlayer.get(event.roster_player_id);
    if (!stats) return;
    if (event.event_type === 'goal') stats.goals += 1;
    if (event.event_type === 'assist') stats.assists += 1;
    if (event.event_type === 'yellow_card') stats.yellow += 1;
    if (event.event_type === 'red_card') stats.red += 1;
  });
  const directRedEvent = canonicalEvents.rows.find((event) => event.event_type === 'red_card');
  const servedPlayer = dataset.teams[4].roster[2];
  const suspensionRows = [
    {
      id: stableUuid('sanction:red-card'),
      revision_id: revisionId,
      organization_id: dataset.organization.id,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      phase_id: leaguePhaseId,
      group_id: null,
      roster_player_id: directRedEvent.roster_player_id,
      team_entry_id: directRedEvent.team_entry_id,
      source_type: 'direct_red',
      source_key: `event:${directRedEvent.id}`,
      source_event_id: directRedEvent.id,
      source_match_id: directRedEvent.match_id,
      rule_snapshot: { criterion: 'direct_red', suggestedMatches: 2, seedKey: SEED_KEY },
      total_matches: 2,
      served_matches: 0,
      status: 'active',
      reason: 'Tarjeta roja directa.',
    },
    {
      id: stableUuid('sanction:accumulated-yellow'),
      revision_id: revisionId,
      organization_id: dataset.organization.id,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      phase_id: leaguePhaseId,
      group_id: null,
      roster_player_id: servedPlayer.id,
      team_entry_id: servedPlayer.teamId,
      source_type: 'yellow_accumulation',
      source_key: 'yellow-accumulation:5',
      source_event_id: canonicalEvents.servedSuspensionSourceEventId,
      source_match_id: matchById.get(
        canonicalEvents.rows.find(
          (event) => event.id === canonicalEvents.servedSuspensionSourceEventId,
        ).match_id,
      ).id,
      rule_snapshot: { yellowsForSuspension: 5, suspensionMatches: 1, seedKey: SEED_KEY },
      total_matches: 1,
      served_matches: 1,
      status: 'served',
      reason: 'Acumulación de cinco tarjetas amarillas.',
    },
  ];

  const idealSelection = dataset.manualIdealTeam;
  const idealPlayers = idealSelection.playerIds.map(
    (id) => rosterRows.find((player) => player.id === id),
  );
  if (
    idealSelection.criterion !== 'manual_curated'
    || idealPlayers.some((player) => !player)
    || new Set(idealSelection.playerIds).size !== idealSelection.playerIds.length
    || idealSelection.playerIds.length !== 5
    || idealPlayers.filter((player) => player.is_goalkeeper).length !== 1
    || idealPlayers.some((player) => player.eligibility_status !== 'eligible')
  ) {
    throw new Error('Manual ideal-team selection is invalid.');
  }

  const operations = [
    table('tournament_organizations', ['id'], [{
      id: dataset.organization.id,
      name: dataset.organization.name.slice(0, 80),
      slug: dataset.organization.slug,
      logo_path: null,
      status: 'active',
      created_by: owner,
      creation_key: creationKey,
      archived_at: null,
    }], [['slug'], ['created_by', 'creation_key']]),
    table('tournament_organization_members', ['id'], [
      ['owner', 'owner'],
      ['admin', 'admin'],
      ['collaborator', 'collaborator'],
    ].map(([role, userRole]) => ({
      id: stableUuid(`membership:${role}`),
      organization_id: dataset.organization.id,
      user_id: users[userRole].id,
      role,
      status: 'active',
      invited_by: role === 'owner' ? null : owner,
      joined_at: FIXED_NOW,
    })), [['organization_id', 'user_id']]),
    table('tournament_seasons', ['id'], [{
      id: seasonId,
      organization_id: dataset.organization.id,
      name: 'Temporada QA 2026',
      slug: 'temporada-qa-2026',
      status: 'active',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      created_by: owner,
      creation_key: stableUuid('creation:season:2026'),
      archived_at: null,
    }], [['organization_id', 'slug'], ['organization_id', 'created_by', 'creation_key']]),
    table('tournaments', ['id'], dataset.tournaments.map((tournament) => ({
      id: tournament.id,
      organization_id: dataset.organization.id,
      season_id: seasonId,
      name: tournament.name,
      slug: `qa-${tournament.status.replace('_', '-')}`,
      description: `Dataset ${SEED_KEY}: ${tournament.status}.`,
      status: tournament.status === 'in_progress' ? 'active' : tournament.status,
      sport_modality: 'football_5',
      competition_format: tournament.isPrimaryDataset ? 'league_and_playoffs' : 'league',
      gender_category: 'open',
      team_size: 5,
      substitutes_limit: 5,
      start_date: '2026-02-01',
      end_date: '2026-11-30',
      registration_opens_at: null,
      registration_closes_at: null,
      format_settings: tournament.isPrimaryDataset
        ? { leagueRounds: 'single', qualifiers: 4, knockoutLegs: 'single' }
        : { rounds: 'single', qualifiers: 0 },
      created_by: owner,
      creation_key: stableUuid(`creation:${tournament.id}`),
      archived_at: tournament.status === 'archived' ? FIXED_NOW : null,
    })), [['season_id', 'slug'], ['organization_id', 'created_by', 'creation_key']]),
    table('tournament_categories', ['id'], [{
      id: categoryId,
      organization_id: dataset.organization.id,
      tournament_id: activeTournament.id,
      name: 'Categoría Abierta',
      slug: 'abierta',
      description: `Categoría principal de ${SEED_KEY}.`,
      status: 'active',
      sort_order: 1,
      min_age: 18,
      max_age: null,
      gender_category: 'open',
      sport_modality: 'football_5',
      team_size: 5,
      archived_at: null,
    }], [['tournament_id', 'slug']]),
    table('tournament_team_entries', ['id'], dataset.teams.map((team) => ({
      id: team.id,
      organization_id: dataset.organization.id,
      season_id: seasonId,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      arma2_team_id: null,
      name: team.name,
      slug: `qa-${team.shortName.toLowerCase()}`,
      short_name: team.shortName,
      shield_path: team.shieldPath?.replace(/^\//, '') || null,
      primary_color: '#5575FF',
      secondary_color: '#111827',
      status: 'approved',
      registration_source: 'provisional',
      created_by: owner,
      submitted_by: owner,
      submitted_at: FIXED_NOW,
      reviewed_by: users.admin.id,
      reviewed_at: FIXED_NOW,
      approved_at: FIXED_NOW,
      rejected_at: null,
      withdrawn_at: null,
      archived_at: null,
      idempotency_key: stableUuid(`team-entry:${team.shortName}`),
    })), [['tournament_id', 'slug'], ['organization_id', 'created_by', 'idempotency_key']]),
    table('tournament_team_managers', ['id'], dataset.teams.flatMap((team, index) => {
      const captainRole = index === 1 ? 'admin' : 'owner';
      const managers = [{
        id: stableUuid(`manager:${team.shortName}:captain`),
        organization_id: dataset.organization.id,
        team_entry_id: team.id,
        user_id: users[captainRole].id,
        email_normalized: users[captainRole].email,
        display_name: users[captainRole].displayName,
        role: 'captain',
        status: 'active',
        invited_by: owner,
        invited_at: FIXED_NOW,
        accepted_at: FIXED_NOW,
        revoked_at: null,
      }];
      if (index === 0) {
        managers.push({
          id: stableUuid(`manager:${team.shortName}:delegate`),
          organization_id: dataset.organization.id,
          team_entry_id: team.id,
          user_id: users.delegate.id,
          email_normalized: users.delegate.email,
          display_name: users.delegate.displayName,
          role: 'delegate',
          status: 'active',
          invited_by: owner,
          invited_at: FIXED_NOW,
          accepted_at: FIXED_NOW,
          revoked_at: null,
        });
      }
      return managers;
    })),
    table('tournament_rosters', ['id'], dataset.teams.map((team) => ({
      id: rosterIdByTeam.get(team.id),
      organization_id: dataset.organization.id,
      team_entry_id: team.id,
      version: 1,
      status: 'approved',
      submitted_at: FIXED_NOW,
      approved_at: FIXED_NOW,
      locked_at: null,
      created_by: owner,
    })), [['team_entry_id', 'version']]),
    table('tournament_provisional_players', ['id'], provisionalRows),
    table('tournament_roster_players', ['id'], rosterRows),
    table('tournament_participant_sets', ['id'], [{
      id: participantSetId,
      organization_id: dataset.organization.id,
      season_id: seasonId,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      version_number: 1,
      status: 'frozen',
      participant_fingerprint: participantFingerprint,
      frozen_by: owner,
      frozen_at: FIXED_NOW,
      reopened_by: null,
      reopened_at: null,
      reopen_reason: null,
      invalidated_at: null,
      idempotency_key: stableUuid('participant-set:idempotency:v1'),
    }], [['tournament_id', 'category_id', 'version_number'], ['organization_id', 'frozen_by', 'idempotency_key']]),
    table('tournament_competition_participants', ['id'], participants),
    table('tournament_fixture_versions', ['id'], [{
      id: fixtureVersionId,
      organization_id: dataset.organization.id,
      season_id: seasonId,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      participant_set_id: participantSetId,
      version_number: 1,
      status: 'published',
      generation_method: 'automatic',
      seed: SEED_KEY,
      participant_fingerprint: participantFingerprint,
      configuration_snapshot: {
        competitionFormat: 'league_and_playoffs',
        leagueRounds: 'single',
        qualifiers: 4,
      },
      created_by: owner,
      idempotency_key: stableUuid('fixture-version:idempotency:v1'),
      published_at: FIXED_NOW,
      superseded_at: null,
      archived_at: null,
      invalidated_at: null,
    }], [['tournament_id', 'category_id', 'version_number'], ['organization_id', 'created_by', 'idempotency_key']]),
    table('tournament_phases', ['id'], [
      [leaguePhaseId, 'Liga', 'league', 1, { rounds: 7 }],
      [semifinalPhaseId, 'Semifinales', 'semifinal', 2, { teams: 4 }],
      [finalPhaseId, 'Final', 'final', 3, { teams: 2 }],
    ].map(([id, name, phaseType, sequenceNumber, configuration]) => ({
      id,
      organization_id: dataset.organization.id,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      fixture_version_id: fixtureVersionId,
      name,
      phase_type: phaseType,
      sequence_number: sequenceNumber,
      status: 'scheduled',
      configuration,
      locked_at: null,
    }))),
    table('tournament_rounds', ['id'], rounds),
    table('tournament_matches', ['id'], matchRows),
    table('tournament_match_operations', ['id'], operationRows),
    table('tournament_match_operation_players', ['id'], operationPlayerRows),
    table('tournament_match_scores', ['match_operation_id'], scoreRows),
    table('tournament_match_outcomes', ['match_operation_id'], outcomeRows),
    table('tournament_match_events', ['id'], canonicalEvents.rows),
    table('tournament_match_reviews', ['id'], reviewMatches.map((match) => ({
      id: stableUuid(`review:${match.id}`),
      organization_id: dataset.organization.id,
      match_operation_id: operationIdByMatch.get(match.id),
      review_type: match.state === 'under_review' ? 'validation' : 'administrative_resolution',
      status: 'open',
      reason: match.state === 'under_review'
        ? 'Resultado cargado y pendiente de validación QA.'
        : 'Partido suspendido pendiente de resolución QA.',
      requested_by: owner,
      requested_at: FIXED_NOW,
      resolved_by: null,
      resolved_at: null,
      resolution: null,
    }))),
    table('tournament_standings_revisions', ['id'], [{
      id: revisionId,
      organization_id: dataset.organization.id,
      season_id: seasonId,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      fixture_version_id: fixtureVersionId,
      phase_id: leaguePhaseId,
      group_id: null,
      revision_number: 1,
      status: 'published',
      source_fingerprint: sha256(canonicalJson(
        leagueMatches.filter(isOfficialForProjection).map((match) => ({
          id: match.id,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          outcome: match.outcome,
        })),
      )),
      configuration_snapshot: { pointsWin: 3, pointsDraw: 1, pointsLoss: 0 },
      rebuild_reason: 'Materialización determinística del dataset QA.',
      calculated_by: owner,
      idempotency_key: stableUuid('standings-revision:idempotency:v1'),
      calculated_at: FIXED_NOW,
      published_by: owner,
      published_at: FIXED_NOW,
      superseded_at: null,
      discarded_by: null,
      discarded_at: null,
      discard_reason: null,
    }], [['fixture_version_id', 'phase_id', 'group_id', 'revision_number'], ['organization_id', 'calculated_by', 'idempotency_key']]),
    table('tournament_projection_sources', ['revision_id', 'match_operation_id'],
      leagueMatches.filter(isOfficialForProjection).map((match) => ({
        revision_id: revisionId,
        organization_id: dataset.organization.id,
        match_operation_id: operationIdByMatch.get(match.id),
        match_id: match.id,
        official_at: FIXED_NOW,
      }))),
    table('tournament_team_standings', ['id'], leagueTable.map((standing, index) => ({
      id: stableUuid(`standing:${standing.team.id}`),
      revision_id: revisionId,
      organization_id: dataset.organization.id,
      tournament_id: activeTournament.id,
      category_id: categoryId,
      phase_id: leaguePhaseId,
      group_id: null,
      participant_id: participantByTeam.get(standing.team.id).id,
      team_entry_id: standing.team.id,
      position: index + 1,
      played: standing.played,
      won: standing.won,
      drawn: standing.drawn,
      lost: standing.lost,
      goals_for: standing.goalsFor,
      goals_against: standing.goalsAgainst,
      goal_difference: standing.goalDifference,
      base_points: standing.points,
      points_adjustment: 0,
      points: standing.points,
      walkovers: standing.walkovers,
      administrative_results: standing.administrativeResults,
      fair_play_points: standing.fairPlayPoints,
      classification_status: index < 4 ? 'qualified' : 'eliminated',
      tiebreak_trace: { order: ['points', 'goal_difference', 'goals_for'] },
    }))),
    table('tournament_team_statistics', ['revision_id', 'participant_id'], leagueTable.map((standing) => ({
      revision_id: revisionId,
      organization_id: dataset.organization.id,
      participant_id: participantByTeam.get(standing.team.id).id,
      team_entry_id: standing.team.id,
      goals: standing.goalsFor,
      own_goals_benefited: 0,
      yellow_cards: canonicalEvents.rows.filter(
        (event) => event.team_entry_id === standing.team.id && event.event_type === 'yellow_card',
      ).length,
      second_yellows: 0,
      red_cards: canonicalEvents.rows.filter(
        (event) => event.team_entry_id === standing.team.id && event.event_type === 'red_card',
      ).length,
      home_played: leagueMatches.filter(
        (match) => isOfficialForProjection(match) && match.homeTeamId === standing.team.id,
      ).length,
      away_played: leagueMatches.filter(
        (match) => isOfficialForProjection(match) && match.awayTeamId === standing.team.id,
      ).length,
      suspended_matches: leagueMatches.filter(
        (match) => match.state === 'suspended'
          && [match.homeTeamId, match.awayTeamId].includes(standing.team.id),
      ).length,
      administrative_matches: standing.administrativeResults,
      recent_form: JSON.stringify(standing.recent.slice(-5)),
      streak_type: null,
      streak_count: 0,
    }))),
    table('tournament_player_statistics', ['revision_id', 'roster_player_id'], rosterRows.map((player) => {
      const stats = statsByPlayer.get(player.id);
      const playerOperations = operationPlayerRows.filter(
        (operationPlayer) => operationPlayer.roster_player_id === player.id,
      );
      return {
        revision_id: revisionId,
        organization_id: dataset.organization.id,
        tournament_id: activeTournament.id,
        category_id: categoryId,
        roster_player_id: player.id,
        team_entry_id: player.team_entry_id,
        squad_calls: playerOperations.length,
        appearances: playerOperations.length,
        starts: playerOperations.filter((item) => item.lineup_status === 'starter').length,
        substitute_appearances: playerOperations.filter(
          (item) => item.lineup_status === 'substitute',
        ).length,
        minutes_played: null,
        goals: stats.goals,
        own_goals: 0,
        assists: stats.assists,
        penalty_goals: 0,
        penalties_missed: 0,
        yellow_cards: stats.yellow,
        second_yellows: 0,
        red_cards: stats.red,
        captaincies: playerOperations.filter((item) => item.is_captain).length,
      };
    })),
    table('tournament_discipline_rules', ['tournament_id'], [{
      tournament_id: activeTournament.id,
      organization_id: dataset.organization.id,
      yellows_for_suspension: 5,
      suspension_matches: 1,
      direct_red_suggested_matches: 2,
      double_yellow_counts_as_red: true,
      reset_yellows_each_stage: false,
      fair_play_enabled: true,
      yellow_fair_play_points: 1,
      red_fair_play_points: 3,
    }]),
    table('tournament_discipline_ledgers', ['revision_id', 'roster_player_id'], rosterRows.map((player) => {
      const stats = statsByPlayer.get(player.id);
      return {
        revision_id: revisionId,
        organization_id: dataset.organization.id,
        tournament_id: activeTournament.id,
        category_id: categoryId,
        phase_id: leaguePhaseId,
        group_id: null,
        roster_player_id: player.id,
        team_entry_id: player.team_entry_id,
        yellow_cards: stats.yellow,
        second_yellows: 0,
        direct_reds: stats.red,
        fair_play_points: stats.yellow + stats.red * 3,
        automatic_suspensions: player.id === servedPlayer.id ? 1 : 0,
      };
    })),
    table('tournament_player_suspensions', ['id'], suspensionRows),
    table('tournament_suspension_served_matches', ['suspension_id', 'match_id'], [{
      suspension_id: suspensionRows[1].id,
      organization_id: dataset.organization.id,
      match_id: canonicalEvents.servedSuspensionMatchId,
      marked_by: owner,
      marked_at: FIXED_NOW,
      note: 'Cumplida en el siguiente partido oficial disponible.',
    }]),
    table('tournament_audit_log', ['resource_type', 'resource_id', 'action'], [{
      organization_id: dataset.organization.id,
      actor_user_id: owner,
      actor_type: 'user',
      action: 'qa.team_of_round.manual_curated',
      resource_type: 'manual_curated_team',
      resource_id: idealSelection.id,
      team_entry_id: null,
      tournament_id: activeTournament.id,
      metadata: {
        seedKey: SEED_KEY,
        criterion: 'manual_curated',
        selectedByRole: 'owner',
        roundId: dataset.rounds[0].id,
        formation: idealSelection.formation,
        playerIds: idealSelection.playerIds,
        automaticSelection: false,
      },
      created_at: FIXED_NOW,
    }]),
  ];

  const hashInput = operations.map((operation) => ({
    table: operation.table,
    identity: operation.identity,
    rows: operation.rows,
  }));
  const manifestHash = sha256(canonicalJson(hashInput));
  operations.push(table('tournament_audit_log', ['resource_type', 'resource_id', 'action'], [{
    organization_id: dataset.organization.id,
    actor_user_id: owner,
    actor_type: 'user',
    action: 'qa.seed.applied',
    resource_type: 'qa_seed_execution',
    resource_id: seedRegistryId,
    team_entry_id: null,
    tournament_id: activeTournament.id,
    metadata: {
      seedKey: SEED_KEY,
      seedVersion: SEED_VERSION,
      manifestHash,
      organizationCreationKey: creationKey,
      rollbackSource: 'persistent-marker-and-deterministic-manifest',
    },
    created_at: FIXED_NOW,
  }]));

  return {
    seedKey: SEED_KEY,
    seedVersion: SEED_VERSION,
    manifestHash,
    organizationId: dataset.organization.id,
    organizationSlug: dataset.organization.slug,
    organizationCreationKey: creationKey,
    seedRegistryId,
    activeTournamentId: activeTournament.id,
    users,
    operations,
    summary: {
      teams: dataset.teams.length,
      rosterPlayers: rosterRows.length,
      arma2Players: rosterRows.filter((row) => row.arma2_user_id).length,
      provisionalPlayers: provisionalRows.length,
      rounds: rounds.length,
      matches: matchRows.length,
      operations: operationRows.length,
      events: canonicalEvents.rows.length,
      suspensions: suspensionRows.length,
    },
  };
}

const PLACEHOLDER_USERS = Object.freeze(Object.fromEntries(QA_USER_ROLES.map((role) => [
  role,
  Object.freeze({
    role,
    id: stableUuid(`qa-identity-placeholder:${role}`),
    email: `unresolved-${role}@qa.invalid`,
    displayName: ROLE_DISPLAY_NAMES[role],
    projectedRelations: QA_IDENTITY_RELATIONS[role],
  }),
])));

function isSeedMarkerOperation(operation) {
  return operation.table === 'tournament_audit_log'
    && operation.rows.length === 1
    && operation.rows[0].resource_type === 'qa_seed_execution';
}

function replaceIdentityPlaceholders(value, replacements) {
  if (Array.isArray(value)) {
    return value.map((entry) => replaceIdentityPlaceholders(entry, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      replaceIdentityPlaceholders(entry, replacements),
    ]));
  }
  return replacements.get(value) || value;
}

function manifestHashInput(operations) {
  return operations.map((operation) => ({
    table: operation.table,
    identity: operation.identity,
    rows: operation.rows,
  }));
}

function ownershipFingerprint(operations, seedKey) {
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

function tableRows(manifest) {
  const byTable = new Map();
  for (const operation of manifest.operations) {
    byTable.set(operation.table, [
      ...(byTable.get(operation.table) || []),
      ...operation.rows,
    ]);
  }
  return byTable;
}

function addUniqueRelation(relations, seen, role, relation, identity) {
  const key = `${role}:${identity}`;
  if (seen.has(key)) {
    throw new Error(`Duplicate QA identity relation for ${role}: ${identity}.`);
  }
  seen.add(key);
  relations[role].push(relation);
}

function assertUniqueRelationIdentity(seen, role, identity) {
  const key = `${role}:${identity}`;
  if (seen.has(key)) {
    throw new Error(`Duplicate QA identity relation for ${role}: ${identity}.`);
  }
  seen.add(key);
}

export function deriveQAIdentityRelations(manifest) {
  const roleByUserId = new Map(QA_USER_ROLES.map((role) => [
    manifest.users[role].id,
    role,
  ]));
  if (roleByUserId.size !== QA_USER_ROLES.length) {
    throw new Error('QA identity relation derivation requires six unique users.');
  }
  const relations = Object.fromEntries(QA_USER_ROLES.map((role) => [role, []]));
  const referenceCounts = Object.fromEntries(QA_USER_ROLES.map((role) => [role, new Map()]));
  const byTable = tableRows(manifest);
  for (const operation of manifest.operations) {
    for (const row of operation.rows) {
      for (const [column, value] of Object.entries(row)) {
        const role = roleByUserId.get(value);
        if (!role) continue;
        const reference = `${operation.table}.${column}`;
        referenceCounts[role].set(reference, (referenceCounts[role].get(reference) || 0) + 1);
      }
    }
  }
  for (const role of QA_USER_ROLES) {
    for (const [reference, count] of referenceCounts[role]) {
      relations[role].push(`reference:${reference}:${count}`);
    }
  }

  const seen = new Set();
  const teamShortName = new Map((byTable.get('tournament_team_entries') || []).map(
    (row) => [row.id, row.short_name],
  ));
  for (const row of byTable.get('tournament_organizations') || []) {
    const role = roleByUserId.get(row.created_by);
    if (!role) throw new Error('Dataset creator is not a declared QA identity.');
    addUniqueRelation(
      relations,
      seen,
      role,
      'dataset_creator:tournament_organizations:1',
      `dataset_creator:${row.id}`,
    );
  }
  for (const row of byTable.get('tournament_organization_members') || []) {
    const role = roleByUserId.get(row.user_id);
    if (!role) throw new Error('Organization membership references an undeclared QA identity.');
    addUniqueRelation(
      relations,
      seen,
      role,
      `organization_membership:${row.role}:${row.status}:1`,
      `organization_membership:${row.organization_id}:${row.user_id}`,
    );
  }
  for (const row of byTable.get('tournament_team_managers') || []) {
    const role = roleByUserId.get(row.user_id);
    if (!role) throw new Error('Team manager references an undeclared QA identity.');
    const shortName = teamShortName.get(row.team_entry_id);
    if (!shortName) throw new Error('Team manager references an unknown team.');
    addUniqueRelation(
      relations,
      seen,
      role,
      `team_manager:${shortName}:${row.role}:${row.status}`,
      `team_manager:${row.team_entry_id}:${row.user_id}`,
    );
  }
  for (const row of (byTable.get('tournament_roster_players') || []).filter(
    (player) => player.arma2_user_id,
  )) {
    const role = roleByUserId.get(row.arma2_user_id);
    if (!role) throw new Error('Roster link references an undeclared QA identity.');
    const shortName = teamShortName.get(row.team_entry_id);
    if (!shortName) throw new Error('Roster link references an unknown team.');
    addUniqueRelation(
      relations,
      seen,
      role,
      `roster_link:${shortName}:${row.status}`,
      `roster_link:${row.team_entry_id}:${row.arma2_user_id}`,
    );
  }
  const validatorsByRoleAndStatus = new Map();
  for (const row of byTable.get('tournament_match_operations') || []) {
    if (!row.validated_by) continue;
    const role = roleByUserId.get(row.validated_by);
    if (!role) throw new Error('Match validator references an undeclared QA identity.');
    const key = `${role}:${row.status}`;
    validatorsByRoleAndStatus.set(key, (validatorsByRoleAndStatus.get(key) || 0) + 1);
    assertUniqueRelationIdentity(
      seen,
      role,
      `match_operation_validator:${row.id}:${row.validated_by}`,
    );
  }
  for (const [key, count] of validatorsByRoleAndStatus) {
    const [role, status] = key.split(':');
    relations[role].push(`match_operation_validator:${status}:${count}`);
  }
  return Object.freeze(Object.fromEntries(QA_USER_ROLES.map((role) => [
    role,
    Object.freeze(relations[role].sort()),
  ])));
}

export function validateQAIdentityRelations(manifest) {
  const actual = deriveQAIdentityRelations(manifest);
  for (const role of QA_USER_ROLES) {
    const expected = [...QA_IDENTITY_RELATIONS[role]].sort();
    if (canonicalJson(actual[role]) !== canonicalJson(expected)) {
      const expectedSet = new Set(expected);
      const actualSet = new Set(actual[role]);
      const missing = expected.filter((relation) => !actualSet.has(relation));
      const unexpected = actual[role].filter((relation) => !expectedSet.has(relation));
      throw new Error(
        `QA identity relations mismatch for ${role} `
        + `(missing: ${missing.join(', ') || 'none'}; `
        + `unexpected: ${unexpected.join(', ') || 'none'}).`,
      );
    }
  }
  return actual;
}

export function buildBaseManifest() {
  const template = buildManifestTemplate({ users: PLACEHOLDER_USERS });
  const operations = template.operations.filter((operation) => !isSeedMarkerOperation(operation));
  return {
    manifestKind: 'auth-independent-base',
    seedKey: template.seedKey,
    seedVersion: template.seedVersion,
    datasetVersion: template.seedVersion,
    baseManifestHash: sha256(canonicalJson(manifestHashInput(operations))),
    organizationId: template.organizationId,
    organizationSlug: template.organizationSlug,
    organizationCreationKey: template.organizationCreationKey,
    seedRegistryId: template.seedRegistryId,
    activeTournamentId: template.activeTournamentId,
    acceptedAuthSeedKeys: Object.freeze([template.seedKey, PREVIOUS_SEED_KEY]),
    identityPlaceholders: Object.fromEntries(QA_USER_ROLES.map((role) => [
      role,
      PLACEHOLDER_USERS[role].id,
    ])),
    operations,
    summary: template.summary,
  };
}

export function resolveCanonicalManifest({
  baseManifest = buildBaseManifest(),
  identityMap,
  createdAt = new Date().toISOString(),
} = {}) {
  const resolvedIdentityMap = identityMap instanceof QAIdentityMap
    ? identityMap
    : new QAIdentityMap(identityMap);
  const replacements = new Map(QA_USER_ROLES.map((role) => [
    baseManifest.identityPlaceholders[role],
    resolvedIdentityMap.get(role).auth_user_id,
  ]));
  const operations = replaceIdentityPlaceholders(baseManifest.operations, replacements);
  const users = usersFromIdentityMap(resolvedIdentityMap);
  const manifestHash = sha256(canonicalJson(manifestHashInput(operations)));
  const identityMapFingerprint = resolvedIdentityMap.fingerprint();
  const rowOwnershipFingerprint = ownershipFingerprint(operations, baseManifest.seedKey);
  const expectedRowCount = operations.reduce((sum, operation) => sum + operation.rows.length, 0) + 1;
  const expectedTableCount = new Set([
    ...operations.map((operation) => operation.table),
    'tournament_audit_log',
  ]).size;
  operations.push(table('tournament_audit_log', ['resource_type', 'resource_id', 'action'], [{
    organization_id: baseManifest.organizationId,
    actor_user_id: users.owner.id,
    actor_type: 'user',
    action: 'qa.seed.applied',
    resource_type: 'qa_seed_execution',
    resource_id: baseManifest.seedRegistryId,
    team_entry_id: null,
    tournament_id: baseManifest.activeTournamentId,
    metadata: {
      seed_key: baseManifest.seedKey,
      manifest_hash: manifestHash,
      dataset_version: baseManifest.datasetVersion,
      identity_map_fingerprint: identityMapFingerprint,
      created_at: createdAt,
      creation_key: baseManifest.organizationCreationKey,
      ownership_fingerprint: rowOwnershipFingerprint,
      expected_row_count: expectedRowCount,
      expected_table_count: expectedTableCount,
      rollback_source: 'persistent-marker-and-resolved-manifest',
    },
    created_at: createdAt,
  }]));
  return {
    ...baseManifest,
    manifestKind: 'auth-resolved',
    manifestHash,
    identityMapFingerprint,
    rowOwnershipFingerprint,
    expectedRowCount,
    expectedTableCount,
    createdAt,
    users,
    identityReport: resolvedIdentityMap.report(),
    operations,
  };
}

export function buildCanonicalManifest({
  identityMap,
  createdAt = FIXED_NOW,
} = {}) {
  if (!identityMap) {
    throw new Error('buildCanonicalManifest requires a resolved QAIdentityMap.');
  }
  return resolveCanonicalManifest({ identityMap, createdAt });
}

export function validateCanonicalManifest(manifest) {
  if (!manifest || manifest.manifestKind !== 'auth-resolved') {
    throw new Error('validateCanonicalManifest requires an Auth-resolved manifest.');
  }
  const totalRows = manifest.operations.reduce(
    (sum, operation) => sum + operation.rows.length,
    0,
  );
  const markerRows = manifest.operations.reduce((count, operation) => (
    count + (
      operation.table === 'tournament_audit_log'
        ? operation.rows.filter((row) => row.resource_type === 'qa_seed_execution').length
        : 0
    )
  ), 0);
  const baseRows = totalRows - markerRows;
  const tables = new Set(manifest.operations.map((operation) => operation.table)).size;
  const counts = Object.freeze({
    baseRows,
    markerRows,
    totalRows,
    tables,
  });
  if (baseRows !== 586 || markerRows !== 1 || totalRows !== 587 || tables !== 32) {
    throw new Error(
      'Resolved manifest contract changed: expected '
      + '586 base rows + 1 marker = 587 total rows/32 tables, got '
      + `${baseRows} base rows + ${markerRows} marker = ${totalRows} total rows/`
      + `${tables} tables.`,
    );
  }
  if (!Object.hasOwn(manifest, 'expectedRowCount')) {
    throw new Error('Resolved manifest contract is missing expectedRowCount.');
  }
  if (!Object.hasOwn(manifest, 'expectedTableCount')) {
    throw new Error('Resolved manifest contract is missing expectedTableCount.');
  }
  if (manifest.expectedRowCount !== totalRows || manifest.expectedTableCount !== tables) {
    throw new Error(
      'Resolved manifest declared counts do not match validated counts: '
      + `${manifest.expectedRowCount} rows/${manifest.expectedTableCount} tables declared, `
      + `${totalRows} rows/${tables} tables validated.`,
    );
  }
  const identityRelations = validateQAIdentityRelations(manifest);
  const byTable = new Map();
  manifest.operations.forEach((operation) => {
    byTable.set(operation.table, [
      ...(byTable.get(operation.table) || []),
      ...operation.rows,
    ]);
  });
  const events = byTable.get('tournament_match_events') || [];
  const scores = new Map((byTable.get('tournament_match_scores') || []).map(
    (row) => [row.match_id, row],
  ));
  const outcomes = new Map((byTable.get('tournament_match_outcomes') || []).map(
    (row) => [row.match_id, row],
  ));
  const operations = byTable.get('tournament_match_operations') || [];
  const operationByMatch = new Map(operations.map((row) => [row.match_id, row]));
  const goalCounts = new Map();
  events.filter((event) => event.event_type === 'goal').forEach((event) => {
    const key = `${event.match_id}:${event.team_entry_id}`;
    goalCounts.set(key, (goalCounts.get(key) || 0) + 1);
  });
  const firstScoredMatch = [...scores.values()].find((score) => (
    goalCounts.has(`${score.match_id}:${operationByMatch.get(score.match_id).home_team_entry_id}`)
  ));
  if (!firstScoredMatch) throw new Error('No event-backed scored match exists.');
  const firstOperation = operationByMatch.get(firstScoredMatch.match_id);
  if (
    goalCounts.get(`${firstScoredMatch.match_id}:${firstOperation.home_team_entry_id}`)
      !== firstScoredMatch.home_score
    || goalCounts.get(`${firstScoredMatch.match_id}:${firstOperation.away_team_entry_id}`)
      !== firstScoredMatch.away_score
  ) {
    throw new Error('Goal events do not match the event-backed score.');
  }
  for (const score of scores.values()) {
    if ((score.home_penalties === null) !== (score.away_penalties === null)) {
      throw new Error(`Incomplete penalty score for match ${score.match_id}.`);
    }
    if (
      score.home_penalties !== null
      && score.home_score !== score.away_score
    ) {
      throw new Error(`Penalty shootout must follow a drawn score: ${score.match_id}.`);
    }
    if (
      score.home_penalties !== null
      && score.home_penalties === score.away_penalties
    ) {
      throw new Error(`Penalty shootout has no winner: ${score.match_id}.`);
    }
  }
  for (const outcome of outcomes.values()) {
    const operation = operationByMatch.get(outcome.match_id);
    if (outcome.outcome_type === 'postponed_before_start' && scores.has(outcome.match_id)) {
      throw new Error(`Postponed match has a score: ${outcome.match_id}.`);
    }
    if (outcome.outcome_type === 'suspended' && operation.match_status !== 'suspended') {
      throw new Error(`Suspended outcome and operation disagree: ${outcome.match_id}.`);
    }
    if (outcome.requires_resolution && operation.status !== 'under_review') {
      throw new Error(`Review-required outcome is not under review: ${outcome.match_id}.`);
    }
  }
  const redEvent = events.find((event) => event.event_type === 'red_card');
  const activeRed = (byTable.get('tournament_player_suspensions') || []).find(
    (suspension) => suspension.source_type === 'direct_red',
  );
  if (
    !redEvent
    || !activeRed
    || activeRed.roster_player_id !== redEvent.roster_player_id
    || activeRed.source_event_id !== redEvent.id
  ) {
    throw new Error('The direct-red event and active suspension identify different players.');
  }
  const walkover = [...outcomes.values()].find(
    (outcome) => outcome.outcome_type === 'walkover_home',
  );
  const walkoverScore = walkover && scores.get(walkover.match_id);
  if (
    !walkover
    || walkoverScore?.home_score !== 3
    || walkoverScore?.away_score !== 0
    || !walkover.counts_for_standings
    || walkover.counts_for_player_stats
  ) {
    throw new Error('Walkover score, outcome, or projection flags are incoherent.');
  }
  const suspensions = byTable.get('tournament_player_suspensions') || [];
  const served = suspensions.find((suspension) => suspension.status === 'served');
  const servedLinks = byTable.get('tournament_suspension_served_matches') || [];
  const servedYellowCount = events.filter((event) => (
    event.roster_player_id === served?.roster_player_id
    && event.event_type === 'yellow_card'
  )).length;
  if (
    !served
    || served.served_matches !== served.total_matches
    || servedYellowCount !== 5
    || !servedLinks.some((link) => link.suspension_id === served.id)
  ) {
    throw new Error('Served yellow-accumulation suspension is incoherent.');
  }
  const projected = byTable.get('tournament_projection_sources') || [];
  if (
    projected.length !== 25
    || projected.some((source) => {
      const outcome = outcomes.get(source.match_id);
      return !outcome?.counts_for_standings || operationByMatch.get(source.match_id)?.status !== 'official';
    })
  ) {
    throw new Error('Published projection includes a non-official or review-required match.');
  }
  return {
    ...manifest.summary,
    manifestHash: manifest.manifestHash,
    identityRelations,
    counts,
  };
}
