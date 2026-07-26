#!/usr/bin/env node

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
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

async function publishOfficialProjection(admin, scope) {
  const match = (
    await admin.query(
      `select match_row.*, home.team_entry_id home_entry_id,
        away.team_entry_id away_entry_id
       from public.tournament_matches match_row
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

  const homeIndex = scope.entries.indexOf(match.home_entry_id);
  const awayIndex = scope.entries.indexOf(match.away_entry_id);
  const playerRows = [
    [match.home_entry_id, scope.rosterPlayers[homeIndex][0], 'Jugador Napoli'],
    [match.away_entry_id, scope.rosterPlayers[awayIndex][0], 'Jugador Belgrano'],
  ];
  for (const [teamEntryId, rosterPlayerId, displayName] of playerRows) {
    await admin.query(
      `insert into public.tournament_match_operation_players(
        organization_id,match_operation_id,match_id,team_entry_id,roster_player_id,
        display_name_snapshot,shirt_number_snapshot,position_snapshot,
        lineup_status,attendance_status,is_goalkeeper
      ) values ($1,$2,$3,$4,$5,$6,1,'ARQ','starter','present',true)`,
      [
        scope.organizationId,
        operationId,
        scope.matchId,
        teamEntryId,
        rosterPlayerId,
        displayName,
      ],
    );
  }
  await admin.query(
    `insert into public.tournament_match_events(
      organization_id,match_operation_id,match_id,team_entry_id,roster_player_id,
      event_type,minute,period,sequence_number,created_by
    ) values
      ($1,$2,$3,$4,$5,'goal',12,'first_half',1,$8),
      ($1,$2,$3,$4,$5,'yellow_card',37,'second_half',2,$8),
      ($1,$2,$3,$6,$7,'goal',51,'second_half',3,$8)`,
    [
      scope.organizationId,
      operationId,
      scope.matchId,
      match.home_entry_id,
      scope.rosterPlayers[homeIndex][0],
      match.away_entry_id,
      scope.rosterPlayers[awayIndex][0],
      USERS.owner,
    ],
  );
  await admin.query(
    `update public.tournament_match_operations
     set status = 'official', match_status = 'official',
       submitted_by = $2, submitted_at = now(),
       validated_by = $3, validated_at = now(),
       official_by = $2, official_at = now(), closed_at = now()
     where id = $1`,
    [operationId, USERS.owner, USERS.admin],
  );

  const revisionId = await value(
    scope.owner,
    `select public.rebuild_tournament_standings(
      $1,$2,$3,$4,null,'Publicación para participant hub',$5::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      match.phase_id,
      '94000000-0000-4000-8000-000000000001',
    ],
  );
  await value(
    scope.owner,
    'select public.publish_tournament_standings_revision($1,$2)',
    [revisionId, 'Publicación para participant hub'],
  );
  return { operationId, revisionId, match, homeIndex, awayIndex };
}

async function exerciseHub(admin, scope, official) {
  const playerHome = await connect({
    role: 'authenticated',
    userId: USERS.playerHome,
  });
  const playerAway = await connect({
    role: 'authenticated',
    userId: USERS.playerAway,
  });
  const captainHome = await connect({
    role: 'authenticated',
    userId: USERS.captainHome,
  });
  const collaborator = await connect({
    role: 'authenticated',
    userId: USERS.collaborator,
  });
  const outsider = await connect({
    role: 'authenticated',
    userId: USERS.outsider,
  });

  const playerList = await value(
    playerHome,
    'select public.get_my_tournament_memberships(20,0)',
  );
  eq(playerList.items.length, 1, 'Mis torneos devuelve sólo la relación activa del jugador');
  eq(
    playerList.items[0].teamEntryId,
    scope.entries[0],
    'Mis torneos identifica el equipo propio sin confiar en el cliente',
  );
  eq(playerList.items[0].role, 'player', 'Mis torneos distingue el rol jugador');
  ok(
    !JSON.stringify(playerList).match(/email|phone|fingerprint|audit/i),
    'Mis torneos usa un payload allowlistado',
  );

  const captainList = await value(
    captainHome,
    'select public.get_my_tournament_memberships(20,0)',
  );
  eq(captainList.items[0].role, 'captain', 'Mis torneos distingue al capitán');
  const collaboratorList = await value(
    collaborator,
    'select public.get_my_tournament_memberships(20,0)',
  );
  eq(
    collaboratorList.items[0].organizationRole,
    'collaborator',
    'collaborator recibe una experiencia organizativa de lectura',
  );

  const hub = await value(
    playerHome,
    'select public.get_tournament_participant_hub($1,$2)',
    [scope.tournamentId, scope.categoryId],
  );
  eq(hub.activeCategoryId, scope.categoryId, 'portada fija la categoría autorizada');
  eq(hub.audience.isPlayer, true, 'portada compone la audiencia del jugador');
  eq(hub.audience.canManageTournament, false, 'jugador no recibe acciones administrativas');
  eq(hub.myTeam.id, scope.entries[0], 'portada destaca Mi equipo');
  eq(hub.standings.length, 2, 'portada usa únicamente la tabla publicada');
  eq(hub.recentResults.length, 1, 'portada expone sólo el resultado oficial');
  eq(hub.topScorers.length, 2, 'portada deriva goleadores publicados');
  ok(
    hub.myStatistics && hub.myStatistics.appearances === 1,
    'jugador recibe sólo sus estadísticas oficiales',
  );
  ok(
    !JSON.stringify(hub).match(/sourceFingerprint|rebuildReason|notes|actorUserId/i),
    'portada no filtra revisión, notas ni actores internos',
  );

  const matches = await value(
    playerHome,
    `select public.get_published_tournament_matches(
      $1,$2,'results',null,10,0
    )`,
    [scope.tournamentId, scope.categoryId],
  );
  eq(matches.items.length, 1, 'resultados incluye el acta oficial vigente');
  eq(matches.items[0].result.home, 2, 'resultado oficial conserva el score');
  ok(
    !JSON.stringify(matches).match(/comment|manualReason|rivalAvailability|notes/i),
    'partidos no exponen disponibilidad rival ni motivos privados',
  );
  const paged = await value(
    playerHome,
    `select public.get_published_tournament_matches(
      $1,$2,'all',null,1,0
    )`,
    [scope.tournamentId, scope.categoryId],
  );
  eq(paged.pagination.limit, 1, 'partidos respeta paginación acotada');

  const detail = await value(
    playerHome,
    'select public.get_tournament_participant_match($1)',
    [scope.matchId],
  );
  eq(detail.officialEvents.length, 3, 'detalle muestra sólo eventos oficiales publicables');
  eq(detail.officialLineups.length, 2, 'detalle usa la alineación del acta oficial');
  ok(detail.myContext, 'detalle incluye disponibilidad y convocatoria propias');
  ok(
    !JSON.stringify(detail).match(/reasonText|review|audit|createdBy|recordedBy/i),
    'detalle omite deliberaciones y auditoría',
  );

  const teams = await value(
    playerAway,
    'select public.get_published_tournament_teams($1,$2,16,0)',
    [scope.tournamentId, scope.categoryId],
  );
  eq(teams.items.length, 2, 'equipos lista participantes del fixture publicado');
  eq(teams.items[0].roster.length, 6, 'plantel publicado se obtiene en lote');
  ok(
    !JSON.stringify(teams).match(/email|phone|avatarUrl|eligibility|availability/i),
    'plantel público limita identidad, dorsal y posición',
  );

  await expectError(
    () => outsider.query(
      'select public.get_tournament_participant_hub($1,$2)',
      [scope.tournamentId, scope.categoryId],
    ),
    /TORNEOS_HUB_FORBIDDEN/,
    'UUID conocido no concede acceso a un outsider',
  );

  const otherCategoryId = await value(
    admin,
    `insert into public.tournament_categories(
      organization_id,tournament_id,name,slug,status,sort_order
    ) values ($1,$2,'Senior','senior','active',2) returning id`,
    [scope.organizationId, scope.tournamentId],
  );
  await expectError(
    () => playerHome.query(
      'select public.get_tournament_participant_hub($1,$2)',
      [scope.tournamentId, otherCategoryId],
    ),
    /TORNEOS_HUB_FORBIDDEN/,
    'jugador no amplía acceso a otra categoría',
  );
  const collaboratorOtherCategory = await value(
    collaborator,
    'select public.set_my_tournament_hub_category($1,$2)',
    [scope.tournamentId, otherCategoryId],
  );
  eq(
    collaboratorOtherCategory.categoryId,
    otherCategoryId,
    'preferencia de categoría se valida y persiste en backend',
  );

  await admin.query(
    `update public.tournament_organization_members
     set status = 'suspended'
     where organization_id = $1 and user_id = $2`,
    [scope.organizationId, USERS.collaborator],
  );
  await expectError(
    () => collaborator.query(
      'select public.get_tournament_participant_hub($1,$2)',
      [scope.tournamentId, scope.categoryId],
    ),
    /TORNEOS_HUB_FORBIDDEN/,
    'membership suspendida pierde acceso inmediatamente',
  );

  await admin.query(
    `update public.tournament_roster_players
     set status = 'removed', removed_at = now()
     where id = $1`,
    [scope.rosterPlayers[0][0]],
  );
  await expectError(
    () => playerHome.query(
      'select public.get_tournament_participant_hub($1,$2)',
      [scope.tournamentId, scope.categoryId],
    ),
    /TORNEOS_HUB_FORBIDDEN/,
    'roster player removido pierde el participant hub',
  );
  await admin.query(
    `update public.tournament_roster_players
     set status = 'active', removed_at = null
     where id = $1`,
    [scope.rosterPlayers[0][0]],
  );

  await admin.query(
    `update public.tournament_standings_revisions
     set status = 'draft', published_by = null, published_at = null
     where id = $1`,
    [official.revisionId],
  );
  const hubWithoutPublished = await value(
    captainHome,
    'select public.get_tournament_participant_hub($1,$2)',
    [scope.tournamentId, scope.categoryId],
  );
  eq(hubWithoutPublished.standings.length, 0, 'tabla draft nunca entra al participant hub');
  eq(hubWithoutPublished.topScorers.length, 0, 'estadísticas draft tampoco se publican');
  await admin.query(
    `update public.tournament_standings_revisions
     set status = 'published', published_by = $2, published_at = now()
     where id = $1`,
    [official.revisionId, USERS.owner],
  );

  await admin.query(
    `update public.tournaments
     set status = 'archived', archived_at = now()
     where id = $1`,
    [scope.tournamentId],
  );
  const archivedHub = await value(
    captainHome,
    'select public.get_tournament_participant_hub($1,$2)',
    [scope.tournamentId, scope.categoryId],
  );
  eq(archivedHub.tournament.readOnly, true, 'torneo archivado queda histórico y read-only');
}

async function run() {
  console.log('Arma2 Torneos · participant hub PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
    ]);
    const preferenceRls = await value(
      admin,
      `select relrowsecurity from pg_class
       where oid = 'public.tournament_participant_hub_preferences'::regclass`,
    );
    eq(preferenceRls, true, 'preferencia de categoría tiene RLS');
    const directGrants = Number(await value(
      admin,
      `select count(*)
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'tournament_participant_hub_preferences'
         and grantee in ('anon','authenticated')`,
    ));
    eq(directGrants, 0, 'preferencia privada no admite lectura o escritura directa');
    const publicExecute = Number(await value(
      admin,
      `select count(*)
       from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name = any($1::text[])
         and grantee = 'PUBLIC'`,
      [[
        'can_read_tournament_participant_hub',
        'set_my_tournament_hub_category',
        'get_my_tournament_memberships',
        'get_tournament_participant_hub',
        'get_published_tournament_matches',
        'get_tournament_participant_match',
        'get_published_tournament_teams',
      ]],
    ));
    eq(publicExecute, 0, 'PUBLIC no ejecuta RPCs del participant hub');
    const helperExecute = Number(await value(
      admin,
      `select count(*)
       from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name = 'can_read_tournament_participant_hub'
         and grantee = 'authenticated'`,
    ));
    eq(helperExecute, 0, 'helper de autorización no es ejecutable por cliente');
    const securityDefiners = Number(await value(
      admin,
      `select count(*)
       from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname = any($1::text[])
         and prosecdef
         and proconfig @> array['search_path=""']`,
      [[
        'can_read_tournament_participant_hub',
        'set_my_tournament_hub_category',
        'get_my_tournament_memberships',
        'get_tournament_participant_hub',
        'get_published_tournament_matches',
        'get_tournament_participant_match',
        'get_published_tournament_teams',
      ]],
    ));
    eq(securityDefiners, 7, 'RPCs fijan search_path y usan autoridad backend');
    const indexes = Number(await value(
      admin,
      `select count(*) from pg_indexes
       where schemaname = 'public'
         and indexname = any($1::text[])`,
      [[
        'tournament_roster_players_user_active_idx',
        'tournament_matches_participant_feed_idx',
      ]],
    ));
    eq(indexes, 2, 'consultas reales del hub tienen índices dedicados');

    const anonymous = await connect({ role: 'anon' });
    await expectError(
      () => anonymous.query('select public.get_my_tournament_memberships()'),
      /permission denied/,
      'anon no abre Mis torneos',
    );
    const unauthenticated = await connect({ role: 'authenticated' });
    await expectError(
      () => unauthenticated.query('select public.get_my_tournament_memberships()'),
      /TORNEOS_AUTH_REQUIRED/,
      'sesión expirada falla de forma cerrada',
    );

    const scope = await seedOperationalMatch(admin);
    const official = await publishOfficialProjection(admin, scope);
    await exerciseHub(admin, scope, official);
  } catch (error) {
    failures += 1;
    console.error(error);
  } finally {
    await cleanupMatchOperationsHarness();
  }
  console.log(`\n${checks - failures}/${checks} verificaciones aprobadas`);
  if (failures) process.exitCode = 1;
}

await run();
