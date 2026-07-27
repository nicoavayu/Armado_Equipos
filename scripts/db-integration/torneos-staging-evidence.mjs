#!/usr/bin/env node

import {
  USERS,
  cleanupMatchOperationsHarness,
  count,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';

const EXTRAS = [
  '20260726200000_tournament_standings_discipline.sql',
  '20260726230000_tournament_participant_hub.sql',
  '20260727010000_tournament_communications.sql',
  '20260727060000_tournament_media_galleries.sql',
];

let checks = 0;
let failures = 0;

function assert(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const admin = await setup(EXTRAS);
try {
  const scope = await seedOperationalMatch(admin);
  const match = (
    await admin.query(
      `select match_row.*, phase.id phase_id, round_row.id round_id,
        home.team_entry_id home_entry_id, away.team_entry_id away_entry_id
       from public.tournament_matches match_row
       join public.tournament_phases phase on phase.id = match_row.phase_id
       join public.tournament_rounds round_row on round_row.id = match_row.round_id
       join public.tournament_competition_participants home
         on home.id = match_row.home_participant_id
       join public.tournament_competition_participants away
         on away.id = match_row.away_participant_id
       where match_row.id = $1`,
      [scope.matchId],
    )
  ).rows[0];
  const operationId = await value(
    admin,
    `insert into public.tournament_match_operations(
      organization_id,season_id,tournament_id,category_id,fixture_version_id,
      phase_id,round_id,match_id,home_team_entry_id,away_team_entry_id,
      status,match_status,operation_version,match_snapshot,home_team_snapshot,
      away_team_snapshot,opened_by,submitted_by,submitted_at,validated_by,
      validated_at,official_by,official_at,closed_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      'draft','ready',1,'{}','{}','{}',$11,null,null,null,null,null,null,null
    ) returning id`,
    [
      scope.organizationId,
      match.season_id,
      scope.tournamentId,
      scope.categoryId,
      match.fixture_version_id,
      match.phase_id,
      match.round_id,
      scope.matchId,
      match.home_entry_id,
      match.away_entry_id,
      USERS.owner,
    ],
  );
  await admin.query(
    `insert into public.tournament_match_outcomes(
      match_operation_id,organization_id,match_id,outcome_type,reason_code,reason_text,
      administrative_home_score,administrative_away_score,counts_for_standings,
      counts_for_player_stats,resolved_by,resolved_at
    ) values (
      $1,$2,$3,'walkover_home','away_no_show','Ausencia sintética verificada',
      3,0,true,false,$4,now()
    )`,
    [operationId, scope.organizationId, scope.matchId, USERS.owner],
  );
  await admin.query(
    `insert into public.tournament_match_scores(
      match_operation_id,organization_id,match_id,home_score,away_score,score_type
    ) values ($1,$2,$3,3,0,'walkover')`,
    [operationId, scope.organizationId, scope.matchId],
  );
  await admin.query(
    `update public.tournament_match_operations
        set status='official', match_status='official',
            submitted_by=$2, submitted_at=now(),
            validated_by=$3, validated_at=now(),
            official_by=$2, official_at=now(), closed_at=now()
      where id=$1`,
    [operationId, USERS.owner, USERS.admin],
  );

  await admin.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [USERS.owner],
  );
  const validation = await value(
    admin,
    'select public.validate_tournament_match_operation_payload($1)',
    [operationId],
  );
  assert(validation.valid, 'el walkover sintético cumple el contrato del acta');

  await admin.query(
    `update public.tournament_scoring_rules
        set allow_manual_points_adjustment = true
      where tournament_id = $1`,
    [scope.tournamentId],
  );
  const firstRevision = await value(
    scope.owner,
    `select public.rebuild_tournament_standings(
      $1,$2,$3,$4,null,$5,$6::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      match.phase_id,
      'Escenario staging: walkover',
      '97000000-0000-4000-8000-000000000101',
    ],
  );
  await value(
    scope.owner,
    'select public.publish_tournament_standings_revision($1,$2)',
    [firstRevision, 'Publicación sintética verificada'],
  );
  assert(
    await count(
      admin,
      `select count(*) from public.tournament_team_standings
        where revision_id=$1 and participant_id=$2 and walkovers=1 and points=3`,
      [firstRevision, match.home_participant_id],
    ) === 1,
    'el walkover impacta una vez en la tabla publicada',
  );
  const firstLeader = await value(
    admin,
    `select participant_id from public.tournament_team_standings
      where revision_id=$1 order by position limit 1`,
    [firstRevision],
  );
  assert(firstLeader === match.home_participant_id, 'la tabla resuelve un campeón candidato inicial');

  await value(
    scope.owner,
    `select public.create_tournament_points_adjustment(
      $1,$2,$3,null,$4,-4,$5,$6::uuid
    )`,
    [
      scope.organizationId,
      match.fixture_version_id,
      match.phase_id,
      match.home_participant_id,
      'Sanción sintética que cambia la clasificación',
      '97000000-0000-4000-8000-000000000102',
    ],
  );
  const secondRevision = await value(
    scope.owner,
    `select public.rebuild_tournament_standings(
      $1,$2,$3,$4,null,$5,$6::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      match.phase_id,
      'Escenario staging: clasificación corregida',
      '97000000-0000-4000-8000-000000000103',
    ],
  );
  await value(
    scope.owner,
    'select public.publish_tournament_standings_revision($1,$2)',
    [secondRevision, 'Clasificación corregida publicada'],
  );
  const correctedLeader = await value(
    admin,
    `select participant_id from public.tournament_team_standings
      where revision_id=$1 order by position limit 1`,
    [secondRevision],
  );
  assert(
    correctedLeader === match.away_participant_id && correctedLeader !== firstLeader,
    'un ajuste oficial cambia el clasificado/campeón candidato',
  );
  assert(
    await count(
      admin,
      `select count(*) from public.tournament_standings_revisions
        where tournament_id=$1 and status='published'`,
      [scope.tournamentId],
    ) === 1,
    'la publicación reemplaza atómicamente la tabla anterior',
  );
} catch (error) {
  failures += 1;
  console.error(error);
} finally {
  await cleanupMatchOperationsHarness();
}

console.log(`\n${checks - failures}/${checks} evidencias integradas aprobadas.`);
if (failures) process.exit(1);
