#!/usr/bin/env node

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  count,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';

let checks = 0;
let failures = 0;

function ok(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(actual, expected, label) {
  ok(
    actual === expected,
    label,
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
  );
}

async function expectError(action, pattern, label) {
  try {
    await action();
    ok(false, label, 'la operación no fue rechazada');
  } catch (error) {
    const message = String(error?.message || error);
    ok(pattern.test(message), label, message);
  }
}

async function makeOfficialMatch(admin, scope) {
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
  const homeIndex = scope.entries.indexOf(match.home_entry_id);
  const awayIndex = scope.entries.indexOf(match.away_entry_id);
  const operationId = await value(
    admin,
    `insert into public.tournament_match_operations(
      organization_id,season_id,tournament_id,category_id,fixture_version_id,
      phase_id,round_id,match_id,home_team_entry_id,away_team_entry_id,
      status,match_status,operation_version,match_snapshot,home_team_snapshot,
      away_team_snapshot,opened_by
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      'draft','ready',1,'{}','{}','{}',$11
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
      match_operation_id,organization_id,match_id,outcome_type,started_at,ended_at,
      counts_for_standings,counts_for_player_stats
    ) values ($1,$2,$3,'played',now() - interval '1 hour',now(),true,true)`,
    [operationId, scope.organizationId, scope.matchId],
  );
  await admin.query(
    `insert into public.tournament_match_scores(
      match_operation_id,organization_id,match_id,home_score,away_score,score_type
    ) values ($1,$2,$3,2,1,'played')`,
    [operationId, scope.organizationId, scope.matchId],
  );

  const operationPlayers = [
    [match.home_entry_id, scope.rosterPlayers[homeIndex][0], true],
    [match.home_entry_id, scope.rosterPlayers[homeIndex][1], false],
    [match.away_entry_id, scope.rosterPlayers[awayIndex][0], true],
  ];
  for (const [teamEntryId, rosterPlayerId, captain] of operationPlayers) {
    await admin.query(
      `insert into public.tournament_match_operation_players(
        organization_id,match_operation_id,match_id,team_entry_id,roster_player_id,
        display_name_snapshot,lineup_status,attendance_status,is_captain
      )
      select $1,$2,$3,$4,player.id,player.display_name,'starter','present',$6
      from public.tournament_roster_players player where player.id = $5`,
      [
        scope.organizationId,
        operationId,
        scope.matchId,
        teamEntryId,
        rosterPlayerId,
        captain,
      ],
    );
  }

  const eventRows = [
    [match.home_entry_id, scope.rosterPlayers[homeIndex][0], 'goal'],
    [match.home_entry_id, scope.rosterPlayers[homeIndex][1], 'goal'],
    [match.away_entry_id, scope.rosterPlayers[awayIndex][0], 'goal'],
    ...Array.from({ length: 5 }, () => [
      match.home_entry_id,
      scope.rosterPlayers[homeIndex][0],
      'yellow_card',
    ]),
    [match.home_entry_id, scope.rosterPlayers[homeIndex][1], 'red_card'],
  ];
  let sequence = 0;
  for (const [teamEntryId, rosterPlayerId, eventType] of eventRows) {
    sequence += 1;
    await admin.query(
      `insert into public.tournament_match_events(
        organization_id,match_operation_id,match_id,team_entry_id,roster_player_id,
        event_type,minute,period,sequence_number,created_by
      ) values ($1,$2,$3,$4,$5,$6,$7,'second_half',$8,$9)`,
      [
        scope.organizationId,
        operationId,
        scope.matchId,
        teamEntryId,
        rosterPlayerId,
        eventType,
        40 + sequence,
        sequence,
        USERS.owner,
      ],
    );
  }
  await admin.query(
    `update public.tournament_match_operations
     set status = 'official', match_status = 'official',
       submitted_by = $2, submitted_at = now(),
       validated_by = $3, validated_at = now(),
       official_by = $2, official_at = now(), closed_at = now()
     where id = $1`,
    [operationId, USERS.owner, USERS.admin],
  );
  return {
    operationId,
    match,
    homeIndex,
    awayIndex,
    homeCardedPlayerId: scope.rosterPlayers[homeIndex][0],
    homeRedPlayerId: scope.rosterPlayers[homeIndex][1],
  };
}

async function exerciseProjection(admin, scope) {
  const owner = scope.owner;
  const adminUser = await connect({ role: 'authenticated', userId: USERS.admin });
  const collaborator = await connect({
    role: 'authenticated',
    userId: USERS.collaborator,
  });
  const playerHome = await connect({
    role: 'authenticated',
    userId: USERS.playerHome,
  });
  const outsider = await connect({ role: 'authenticated', userId: USERS.outsider });
  const operation = await makeOfficialMatch(admin, scope);
  await admin.query(
    `update public.tournament_roster_players
     set arma2_user_id = $1
     where arma2_user_id = $2`,
    [USERS.admin, USERS.playerHome],
  );
  await admin.query(
    `update public.tournament_roster_players
     set arma2_user_id = $1, provisional_player_id = null
     where id = $2`,
    [USERS.playerHome, operation.homeCardedPlayerId],
  );
  const fixtureId = operation.match.fixture_version_id;
  const phaseId = operation.match.phase_id;

  await admin.query(
    `update public.tournament_scoring_rules
     set allow_manual_points_adjustment = true
     where tournament_id = $1`,
    [scope.tournamentId],
  );
  const adjustmentKey = '93000000-0000-4000-8000-000000000000';
  const adjustmentId = await value(
    owner,
    `select public.create_tournament_points_adjustment(
      $1,$2,$3,null,$4,-1,$5,$6::uuid
    )`,
    [
      scope.organizationId,
      fixtureId,
      phaseId,
      operation.match.away_participant_id,
      'Sanción administrativa verificada',
      adjustmentKey,
    ],
  );
  eq(
    await value(
      owner,
      `select public.create_tournament_points_adjustment(
        $1,$2,$3,null,$4,-1,$5,$6::uuid
      )`,
      [
        scope.organizationId,
        fixtureId,
        phaseId,
        operation.match.away_participant_id,
        'Sanción administrativa verificada',
        adjustmentKey,
      ],
    ),
    adjustmentId,
    'ajuste de puntos es idempotente y scope-aware',
  );
  await expectError(
    () => value(
      collaborator,
      `select public.create_tournament_points_adjustment(
        $1,$2,$3,null,$4,-1,$5,$6::uuid
      )`,
      [
        scope.organizationId,
        fixtureId,
        phaseId,
        operation.match.away_participant_id,
        'Intento sin capability',
        '93000000-0000-4000-8000-000000000099',
      ],
    ),
    /TORNEOS_STANDINGS_FORBIDDEN/,
    'collaborator no aplica penalizaciones de puntos',
  );

  const revisionKey = '93000000-0000-4000-8000-000000000001';
  const revisionId = await value(
    owner,
    `select public.rebuild_tournament_standings(
      $1,$2,$3,$4,null,$5,$6::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      phaseId,
      'Primera reconstrucción oficial',
      revisionKey,
    ],
  );
  ok(Boolean(revisionId), 'rebuild crea una revisión draft');
  eq(
    await value(
      owner,
      `select public.rebuild_tournament_standings(
        $1,$2,$3,$4,null,$5,$6::uuid
      )`,
      [
        scope.organizationId,
        scope.tournamentId,
        scope.categoryId,
        phaseId,
        'Primera reconstrucción oficial',
        revisionKey,
      ],
    ),
    revisionId,
    'rebuild reintentado con la misma clave es idempotente',
  );
  eq(
    await count(
      admin,
      'select count(*) from public.tournament_projection_sources where revision_id = $1',
      [revisionId],
    ),
    1,
    'la revisión conserva exactamente el acta oficial fuente',
  );
  eq(
    await count(
      admin,
      'select count(*) from public.tournament_team_standings where revision_id = $1',
      [revisionId],
    ),
    2,
    'la tabla no mezcla participantes fuera de la fase',
  );
  const leader = (
    await admin.query(
      `select standing.*, participant.team_entry_id
       from public.tournament_team_standings standing
       join public.tournament_competition_participants participant
         on participant.id = standing.participant_id
       where standing.revision_id = $1 order by standing.position`,
      [revisionId],
    )
  ).rows[0];
  eq(leader.points, 3, 'aplica la regla configurada de puntos por victoria');
  eq(leader.goals_for, 2, 'calcula goles a favor desde el score oficial');
  eq(leader.goal_difference, 1, 'calcula diferencia de gol');
  eq(leader.played, 1, 'calcula partidos jugados');
  eq(
    await value(
      admin,
      `select points_adjustment from public.tournament_team_standings
       where revision_id = $1 and participant_id = $2`,
      [revisionId, operation.match.away_participant_id],
    ),
    -1,
    'aplica penalizaciones explícitas sin alterar el puntaje base',
  );
  eq(
    await value(
      admin,
      `select recent_form->>0 from public.tournament_team_statistics
       where revision_id = $1 and participant_id = $2`,
      [revisionId, operation.match.home_participant_id],
    ),
    'W',
    'forma reciente usa sólo el acta oficial',
  );

  eq(
    await count(
      admin,
      `select count(*) from public.tournament_player_statistics
       where revision_id = $1 and goals > 0`,
      [revisionId],
    ),
    3,
    'deriva goleadores sólo desde eventos oficiales',
  );
  eq(
    await value(
      admin,
      `select minutes_played is null from public.tournament_player_statistics
       where revision_id = $1 limit 1`,
      [revisionId],
    ),
    true,
    'no inventa minutos cuando el acta no los determina',
  );
  eq(
    await count(
      admin,
      `select count(*) from public.tournament_player_suspensions
       where revision_id = $1`,
      [revisionId],
    ),
    2,
    'genera sanciones explicables por amarillas y roja',
  );
  eq(
    await count(
      playerHome,
      'select count(*) from public.tournament_team_standings',
    ),
    0,
    'jugador no lee la tabla draft por RLS',
  );
  eq(
    await count(
      collaborator,
      'select count(*) from public.tournament_player_statistics',
    ),
    0,
    'collaborator tampoco ve estadísticas draft',
  );
  const managerDraftContext = await value(
    owner,
    'select public.get_tournament_standings_context($1,$2,$3,$4,null)',
    [scope.organizationId, scope.tournamentId, scope.categoryId, phaseId],
  );
  eq(
    managerDraftContext.revision.status,
    'draft',
    'organizador ve la revisión pendiente sin confundirla con publicada',
  );
  await expectError(
    () => value(
      outsider,
      'select public.get_tournament_standings_context($1,$2,$3,$4,null)',
      [scope.organizationId, scope.tournamentId, scope.categoryId, phaseId],
    ),
    /TORNEOS_STANDINGS_FORBIDDEN/,
    'UUID conocido no revela proyecciones cross-tenant',
  );
  await expectError(
    () => value(
      collaborator,
      'select public.publish_tournament_standings_revision($1,$2)',
      [revisionId, 'Intento sin capability'],
    ),
    /TORNEOS_STANDINGS_FORBIDDEN/,
    'collaborator no publica una revisión',
  );

  await value(
    owner,
    'select public.publish_tournament_standings_revision($1,$2)',
    [revisionId, 'Publicación inicial verificada'],
  );
  const qualification = await value(
    owner,
    'select public.resolve_tournament_qualification($1,$2)',
    [revisionId, 'Fase oficial completa'],
  );
  eq(
    qualification.resolved,
    0,
    'clasificación sin fuentes futuras no inventa cruces',
  );
  eq(
    await value(
      admin,
      'select status from public.tournament_standings_revisions where id = $1',
      [revisionId],
    ),
    'published',
    'publicación activa la revisión de forma atómica',
  );
  eq(
    await count(
      playerHome,
      'select count(*) from public.tournament_team_standings',
    ),
    2,
    'jugador relacionado lee la tabla publicada',
  );
  const playerContext = await value(
    playerHome,
    'select public.get_tournament_standings_context($1,$2,$3,$4,null)',
    [scope.organizationId, scope.tournamentId, scope.categoryId, phaseId],
  );
  eq(
    playerContext.revision.status,
    'published',
    'contexto del jugador nunca devuelve un draft',
  );
  eq(
    (await value(
      playerHome,
      'select public.get_player_tournament_statistics($1)',
      [scope.tournamentId],
    )).length,
    1,
    'jugador consulta sólo sus estadísticas vinculadas',
  );
  eq(
    (await value(
      playerHome,
      'select public.get_player_tournament_suspensions($1)',
      [scope.tournamentId],
    )).length,
    1,
    'jugador recibe su sanción publicada con explicación',
  );

  const activeSuspension = await value(
    admin,
    `select id from public.tournament_player_suspensions
     where revision_id = $1 and roster_player_id = $2 and status = 'active'
     order by source_type limit 1`,
    [revisionId, operation.homeCardedPlayerId],
  );
  await expectError(
    () => value(
      adminUser,
      'select public.mark_tournament_suspension_served($1,$2,$3)',
      [activeSuspension, scope.matchId, 'El jugador estuvo presente'],
    ),
    /TORNEOS_SUSPENSION_MATCH_INVALID/,
    'una presencia oficial no puede computarse como sanción cumplida',
  );
  const squadId = await value(
    admin,
    `insert into public.tournament_match_squads(
      organization_id,match_id,team_entry_id,roster_id,status,created_by
    ) values ($1,$2,$3,$4,'draft',$5) returning id`,
    [
      scope.organizationId,
      scope.matchId,
      scope.entries[operation.homeIndex],
      scope.rosters[operation.homeIndex],
      USERS.owner,
    ],
  );
  await expectError(
    () => admin.query(
      `insert into public.tournament_match_squad_players(
        organization_id,match_squad_id,match_id,roster_player_id,team_entry_id,
        availability_status,callup_status,lineup_status,display_name_snapshot,
        is_goalkeeper,is_captain,attendance_status
      )
      select $1,$2,$3,player.id,$4,'available','called_up','starter',
        player.display_name,player.is_goalkeeper,false,'present'
      from public.tournament_roster_players player where player.id = $5`,
      [
        scope.organizationId,
        squadId,
        scope.matchId,
        scope.entries[operation.homeIndex],
        operation.homeCardedPlayerId,
      ],
    ),
    /TORNEOS_PLAYER_SUSPENDED/,
    'jugador suspendido no puede incorporarse a una convocatoria',
  );

  const overrideId = await value(
    adminUser,
    `select public.create_tournament_disciplinary_override(
      $1,'revoke',null,$2,$3::uuid
    )`,
    [
      activeSuspension,
      'Resolución de prueba auditada',
      '93000000-0000-4000-8000-000000000002',
    ],
  );
  ok(Boolean(overrideId), 'override disciplinario crea una resolución explícita');
  eq(
    await value(
      admin,
      'select status from public.tournament_player_suspensions where id = $1',
      [activeSuspension],
    ),
    'revoked',
    'revocación no borra la sanción histórica',
  );
  eq(
    await count(
      admin,
      `select count(*) from public.tournament_audit_log
       where resource_id = $1 and action = 'discipline.override'`,
      [activeSuspension],
    ),
    1,
    'override disciplinario deja auditoría append-only',
  );

  const secondRevision = await value(
    owner,
    `select public.rebuild_tournament_standings(
      $1,$2,$3,$4,null,$5,$6::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      phaseId,
      'Reconstrucción determinista',
      '93000000-0000-4000-8000-000000000003',
    ],
  );
  const firstTable = await value(
    admin,
    `select jsonb_agg(to_jsonb(row_data) order by position)
     from (
       select position,participant_id,played,won,drawn,lost,goals_for,
         goals_against,goal_difference,points,fair_play_points
       from public.tournament_team_standings where revision_id = $1
     ) row_data`,
    [revisionId],
  );
  const secondTable = await value(
    admin,
    `select jsonb_agg(to_jsonb(row_data) order by position)
     from (
       select position,participant_id,played,won,drawn,lost,goals_for,
         goals_against,goal_difference,points,fair_play_points
       from public.tournament_team_standings where revision_id = $1
     ) row_data`,
    [secondRevision],
  );
  eq(
    JSON.stringify(secondTable),
    JSON.stringify(firstTable),
    'rebuild desde cero es determinista',
  );
  await value(
    owner,
    'select public.publish_tournament_standings_revision($1,$2)',
    [secondRevision, 'Reemplazo atómico de la tabla'],
  );
  eq(
    await value(
      admin,
      'select status from public.tournament_standings_revisions where id = $1',
      [revisionId],
    ),
    'superseded',
    'la publicación nueva conserva la revisión histórica',
  );
  eq(
    await count(
      admin,
      `select count(*) from public.tournament_standings_revisions
       where fixture_version_id = $1 and phase_id = $2 and status = 'published'`,
      [fixtureId, phaseId],
    ),
    1,
    'sólo existe una revisión publicada por fase y grupo',
  );

  const race = await Promise.allSettled([
    value(
      owner,
      `select public.rebuild_tournament_standings(
        $1,$2,$3,$4,null,$5,$6::uuid
      )`,
      [
        scope.organizationId,
        scope.tournamentId,
        scope.categoryId,
        phaseId,
        'Carrera A',
        '93000000-0000-4000-8000-000000000004',
      ],
    ),
    value(
      adminUser,
      `select public.rebuild_tournament_standings(
        $1,$2,$3,$4,null,$5,$6::uuid
      )`,
      [
        scope.organizationId,
        scope.tournamentId,
        scope.categoryId,
        phaseId,
        'Carrera B',
        '93000000-0000-4000-8000-000000000005',
      ],
    ),
  ]);
  eq(
    race.filter((result) => result.status === 'fulfilled').length,
    1,
    'dos rebuilds concurrentes producen un único draft',
  );
  eq(
    await count(
      admin,
      `select count(*) from public.tournament_standings_revisions
       where fixture_version_id = $1 and phase_id = $2 and status = 'draft'`,
      [fixtureId, phaseId],
    ),
    1,
    'la carrera no deja proyecciones parciales duplicadas',
  );
}

async function run() {
  console.log('Arma2 Torneos · standings/statistics/discipline PostgreSQL/RLS');
  try {
    const admin = await setup(['20260726200000_tournament_standings_discipline.sql']);
    eq(
      await count(
        admin,
        `select count(*) from information_schema.tables
         where table_schema = 'public' and table_name = any($1::text[])`,
        [[
          'tournament_standings_revisions',
          'tournament_projection_sources',
          'tournament_team_standings',
          'tournament_team_statistics',
          'tournament_player_statistics',
          'tournament_discipline_ledgers',
          'tournament_player_suspensions',
          'tournament_suspension_served_matches',
          'tournament_disciplinary_overrides',
          'tournament_points_adjustments',
          'tournament_qualification_slots',
          'tournament_qualification_resolutions',
        ]],
      ),
      12,
      'aplica las doce entidades derivadas desde cero',
    );
    eq(
      await count(
        admin,
        `select count(*) from pg_class
         where relnamespace = 'public'::regnamespace
           and relname = any($1::text[]) and relrowsecurity`,
        [[
          'tournament_standings_revisions',
          'tournament_projection_sources',
          'tournament_team_standings',
          'tournament_team_statistics',
          'tournament_player_statistics',
          'tournament_discipline_ledgers',
          'tournament_player_suspensions',
          'tournament_suspension_served_matches',
          'tournament_disciplinary_overrides',
          'tournament_points_adjustments',
          'tournament_qualification_slots',
          'tournament_qualification_resolutions',
        ]],
      ),
      12,
      'todas las entidades derivadas habilitan RLS',
    );
    eq(
      await count(
        admin,
        `select count(*) from information_schema.role_table_grants
         where table_schema = 'public' and grantee = 'authenticated'
           and table_name like 'tournament_%'
           and privilege_type in ('INSERT','UPDATE','DELETE')
           and table_name = any($1::text[])`,
        [[
          'tournament_standings_revisions',
          'tournament_team_standings',
          'tournament_player_statistics',
          'tournament_player_suspensions',
        ]],
      ),
      0,
      'authenticated no recibe escrituras directas sobre datos oficiales',
    );
    eq(
      await value(
        admin,
        `select public.tournament_role_capabilities('owner') @>
          array['standings.rebuild','qualification.resolve','discipline.override',
            'suspensions.mark_served']`,
      ),
      true,
      'owner recibe las capabilities de la fase',
    );
    eq(
      await value(
        admin,
        `select public.tournament_role_capabilities('collaborator') @>
          array['standings.read','statistics.read','discipline.read']
          and not ('standings.rebuild' =
            any(public.tournament_role_capabilities('collaborator')))`,
      ),
      true,
      'collaborator conserva lectura sin mutaciones',
    );
    const scope = await seedOperationalMatch(admin);
    await exerciseProjection(admin, scope);
  } catch (error) {
    failures += 1;
    console.error(error);
  } finally {
    await cleanupMatchOperationsHarness();
  }
  console.log(`\n${checks - failures}/${checks} verificaciones aprobadas.`);
  if (failures) process.exitCode = 1;
}

await run();
