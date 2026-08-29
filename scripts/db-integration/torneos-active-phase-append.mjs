#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  USERS,
  cleanupMatchOperationsHarness,
  connect,
  count,
  seedOperationalMatch,
  setup,
  value,
} from './torneos-match-operations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = [
  '20260810160355_tournament_entitlements_foundation.sql',
  '20260812120000_tournament_competition_lifecycle.sql',
  '20260821213918_plans_entitlements_foundation_v2.sql',
  '20260821230000_active_tournament_phase_append.sql',
];

let checks = 0;
let failures = 0;

function check(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal(actual, expected, label) {
  check(
    actual === expected,
    label,
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
  );
}

async function expectError(action, pattern, label) {
  try {
    await action();
    check(false, label, 'la operación no fue rechazada');
  } catch (error) {
    check(pattern.test(String(error?.message || error)), label, String(error?.message || error));
  }
}

async function createOrganization(owner, serial) {
  const organization = await value(
    owner,
    'select public.create_tournament_organization($1,$2,$3::uuid)',
    [
      `Liga Append ${serial}`,
      `liga-append-${serial}`,
      `98100000-0000-4000-8000-${String(serial * 10 + 1).padStart(12, '0')}`,
    ],
  );
  return organization.organization.id;
}

async function createSeason(owner, organizationId, serial) {
  return value(
    owner,
    'select public.create_tournament_season($1,$2,$3,null,null,$4::uuid)',
    [
      organizationId,
      `Temporada Append ${serial}`,
      `temporada-append-${serial}`,
      `98100000-0000-4000-8000-${String(serial * 10 + 2).padStart(12, '0')}`,
    ],
  );
}

async function createEdition(owner, organizationId, seasonId, serial) {
  return value(
    owner,
    `select public.create_tournament_with_defaults(
      $1,$2,$3,$4,null,'football_5','league','open',null,null,$5::uuid
    )`,
    [
      organizationId,
      seasonId,
      `Apertura Append ${serial}`,
      `apertura-append-${serial}`,
      `98100000-0000-4000-8000-${String(serial * 10 + 3).padStart(12, '0')}`,
    ],
  );
}

async function prepareLeagueFixture(admin, owner, scope, participantCount, serial) {
  let categoryId = await value(
    admin,
    `select id from public.tournament_categories
     where tournament_id = $1 and status = 'active'
     order by created_at limit 1`,
    [scope.tournamentId],
  );
  if (!categoryId) {
    const category = await value(
      owner,
      `select public.save_tournament_category(
        $1,$2,null,'Primera','primera',null,0,null,null,null,'football_5',5::smallint,'active'
      )`,
      [scope.organizationId, scope.tournamentId],
    );
    categoryId = category.id;
  }
  await value(
    owner,
    'select public.change_tournament_status($1,$2,$3)',
    [scope.organizationId, scope.tournamentId, 'registration'],
  );
  for (let index = 0; index < participantCount; index += 1) {
    const entryId = await value(
      admin,
      `insert into public.tournament_team_entries(
        organization_id,season_id,tournament_id,category_id,name,slug,short_name,
        primary_color,secondary_color,status,registration_source,created_by,
        reviewed_by,reviewed_at,approved_at,idempotency_key
      ) values (
        $1,$2,$3,$4,$5,$6,$7,'#7657FF','#151020','approved','provisional',$8,
        $8,now(),now(),gen_random_uuid()
      ) returning id`,
      [
        scope.organizationId,
        scope.seasonId,
        scope.tournamentId,
        categoryId,
        `Equipo Append ${serial}-${index + 1}`,
        `equipo-append-${serial}-${index + 1}`,
        `A${serial}${index + 1}`,
        USERS.outsider,
      ],
    );
    await admin.query(
      `insert into public.tournament_rosters(
        organization_id,team_entry_id,status,submitted_at,approved_at,created_by
      ) values ($1,$2,'approved',now(),now(),$3)`,
      [scope.organizationId, entryId, USERS.outsider],
    );
  }
  await value(
    owner,
    'select public.freeze_tournament_participants($1,$2,$3,$4::uuid)',
    [
      scope.organizationId,
      scope.tournamentId,
      categoryId,
      `98100000-0000-4000-8000-${String(serial * 10 + 4).padStart(12, '0')}`,
    ],
  );
  const fixture = await value(
    owner,
    `select public.generate_tournament_fixture(
      $1,$2,$3,$4,'{}'::jsonb,$5::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      categoryId,
      `append-seed-${serial}`,
      `98100000-0000-4000-8000-${String(serial * 10 + 5).padStart(12, '0')}`,
    ],
  );
  await value(
    owner,
    'select public.publish_tournament_fixture($1,$2)',
    [scope.organizationId, fixture.fixtureVersionId],
  );
  const phaseId = await value(
    admin,
    `select id from public.tournament_phases
     where fixture_version_id = $1 and phase_type = 'league'`,
    [fixture.fixtureVersionId],
  );
  return { ...scope, categoryId, fixtureVersionId: fixture.fixtureVersionId, phaseId };
}

async function editionCommercialSnapshot(admin, actor, organizationId, tournamentId) {
  const effective = await value(
    actor,
    'select public.get_effective_tournament_entitlements($1,$2)',
    [organizationId, tournamentId],
  );
  return {
    tournamentCount: await count(
      admin,
      'select count(*) from public.tournaments where organization_id = $1',
      [organizationId],
    ),
    grantCount: await count(
      admin,
      'select count(*) from public.tournament_plan_grants where organization_id = $1',
      [organizationId],
    ),
    plan: effective.plan,
    assignmentSource: effective.assignmentSource,
  };
}

async function append(owner, scope, qualifierCount, key) {
  return value(
    owner,
    `select public.append_tournament_playoff_phase(
      $1,$2,$3,$4,$5,false,$6::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      scope.phaseId,
      qualifierCount,
      key,
    ],
  );
}

async function run() {
  console.log('Arma2 Torneos · append Liga → Playoffs PostgreSQL/RLS');
  try {
    const admin = await setup([
      '20260726200000_tournament_standings_discipline.sql',
      '20260726230000_tournament_participant_hub.sql',
      '20260727010000_tournament_communications.sql',
      '20260727060000_tournament_media_galleries.sql',
    ]);
    const premiumScope = await seedOperationalMatch(admin);
    for (const migration of MIGRATIONS) {
      await admin.query(fs.readFileSync(
        path.join(ROOT, 'supabase', 'migrations', migration),
        'utf8',
      ));
    }

    const player = await connect({ role: 'authenticated', userId: USERS.playerHome });

    const premiumFixtureVersionId = await value(
      admin,
      `select id from public.tournament_fixture_versions
       where tournament_id = $1 and status = 'published'`,
      [premiumScope.tournamentId],
    );
    const premiumPhaseId = await value(
      admin,
      `select id from public.tournament_phases
       where fixture_version_id = $1 and phase_type = 'league'`,
      [premiumFixtureVersionId],
    );
    const premium = {
      ...premiumScope,
      fixtureVersionId: premiumFixtureVersionId,
      phaseId: premiumPhaseId,
    };

    const resultOperationId = await value(
      admin,
      `insert into public.tournament_match_operations(
        organization_id,season_id,tournament_id,category_id,fixture_version_id,
        phase_id,round_id,match_id,home_team_entry_id,away_team_entry_id,
        status,match_status,operation_version,match_snapshot,home_team_snapshot,
        away_team_snapshot,opened_by,submitted_by,submitted_at,validated_by,
        validated_at,official_by,official_at,closed_at
      )
      select match_row.organization_id,match_row.season_id,match_row.tournament_id,
        match_row.category_id,match_row.fixture_version_id,match_row.phase_id,
        match_row.round_id,match_row.id,$2,$3,'draft','ready',1,
        jsonb_build_object('matchId',match_row.id),
        jsonb_build_object('teamEntryId',$2::uuid),
        jsonb_build_object('teamEntryId',$3::uuid),
        $4,null,null,null,null,null,null,null
      from public.tournament_matches match_row where match_row.id = $1
      returning id`,
      [premium.matchId, premium.homeEntryId, premium.awayEntryId, USERS.owner],
    );
    await admin.query(
      `insert into public.tournament_match_outcomes(
        match_operation_id,organization_id,match_id,outcome_type,
        counts_for_standings,counts_for_player_stats
      ) values ($1,$2,$3,'played',true,true)`,
      [resultOperationId, premium.organizationId, premium.matchId],
    );
    await admin.query(
      `insert into public.tournament_match_scores(
        match_operation_id,organization_id,match_id,home_score,away_score,score_type
      ) values ($1,$2,$3,3,1,'played')`,
      [resultOperationId, premium.organizationId, premium.matchId],
    );
    await admin.query(
      `update public.tournament_match_operations
       set status = 'official', match_status = 'official',
         submitted_by = $2, submitted_at = now(),
         validated_by = $2, validated_at = now(),
         official_by = $2, official_at = now(), closed_at = now()
       where id = $1`,
      [resultOperationId, USERS.owner],
    );

    const draft = await value(
      premium.owner,
      'select public.supersede_tournament_fixture($1,$2,$3::uuid)',
      [
        premium.organizationId,
        premium.fixtureVersionId,
        '98200000-0000-4000-8000-000000000001',
      ],
    );
    await admin.query(
      "update public.tournaments set status = 'active', started_at = now() where id = $1",
      [premium.tournamentId],
    );
    await expectError(
      () => value(
        premium.owner,
        `select public.update_draft_fixture(
          $1,$2,'create_phase',$3::jsonb
        )`,
        [
          premium.organizationId,
          draft.fixtureVersionId,
          JSON.stringify({ name: 'Draft sin salida', phaseType: 'custom_knockout' }),
        ],
      ),
      /TORNEOS_FIXTURE_DRAFT_READ_ONLY/,
      'active no permite crear una fase dentro de un draft que no puede publicarse',
    );
    await value(
      premium.owner,
      'select public.archive_tournament_fixture($1,$2,$3)',
      [
        premium.organizationId,
        draft.fixtureVersionId,
        'Descartado porque la competencia ya comenzó.',
      ],
    );
    equal(await value(
      admin,
      'select status from public.tournament_fixture_versions where id = $1',
      [draft.fixtureVersionId],
    ), 'archived', 'el draft cerrado conserva una salida explícita y auditable');

    const premiumCommercialBefore = await editionCommercialSnapshot(
      admin, premium.owner, premium.organizationId, premium.tournamentId,
    );
    const premiumPhasesBefore = await count(
      admin,
      'select count(*) from public.tournament_phases where fixture_version_id = $1',
      [premium.fixtureVersionId],
    );
    const premiumRoundsBefore = await count(
      admin,
      'select count(*) from public.tournament_rounds where fixture_version_id = $1',
      [premium.fixtureVersionId],
    );
    const premiumMatchesBefore = await value(
      admin,
      `select jsonb_agg(jsonb_build_object(
        'id',id,'status',status,'scheduledAt',scheduled_at,
        'durationMinutes',duration_minutes,'phaseId',phase_id
      ) order by match_number)
      from public.tournament_matches where fixture_version_id = $1`,
      [premium.fixtureVersionId],
    );
    const scoreBefore = await value(
      admin,
      `select jsonb_build_object('id',match_operation_id,'home',home_score,'away',away_score)
       from public.tournament_match_scores where match_id = $1`,
      [premium.matchId],
    );

    await expectError(
      () => append(player, premium, 2, '98200000-0000-4000-8000-000000000002'),
      /TORNEOS_RESOURCE_FORBIDDEN/,
      'Player no puede agregar Playoffs',
    );
    const appendedPremium = await append(
      premium.owner, premium, 2, '98200000-0000-4000-8000-000000000003',
    );
    equal(appendedPremium.tournamentId, premium.tournamentId,
      'active conserva exactamente el mismo tournament_id');
    equal(appendedPremium.fixtureVersionId, premium.fixtureVersionId,
      'append escribe en la misma versión oficial');
    equal(await count(
      admin,
      'select count(*) from public.tournament_fixture_versions where tournament_id = $1',
      [premium.tournamentId],
    ), 2, 'append no crea otra versión (sólo existe la revisión previa creada por el test)');
    equal(await count(
      admin,
      'select count(*) from public.tournament_phases where fixture_version_id = $1',
      [premium.fixtureVersionId],
    ), premiumPhasesBefore + 1, 'sólo agrega una fase');
    equal(await count(
      admin,
      'select count(*) from public.tournament_rounds where fixture_version_id = $1',
      [premium.fixtureVersionId],
    ), premiumRoundsBefore + 1, 'Top 2 agrega únicamente la Final');
    const previousMatchesAfter = await value(
      admin,
      `select jsonb_agg(jsonb_build_object(
        'id',id,'status',status,'scheduledAt',scheduled_at,
        'durationMinutes',duration_minutes,'phaseId',phase_id
      ) order by match_number)
      from public.tournament_matches
      where fixture_version_id = $1 and phase_id = $2`,
      [premium.fixtureVersionId, premium.phaseId],
    );
    equal(JSON.stringify(previousMatchesAfter), JSON.stringify(premiumMatchesBefore),
      'partidos Liga conservan IDs, estado, horario, duración y phase_id');
    equal(JSON.stringify(await value(
      admin,
      `select jsonb_build_object('id',match_operation_id,'home',home_score,'away',away_score)
       from public.tournament_match_scores where match_id = $1`,
      [premium.matchId],
    )), JSON.stringify(scoreBefore), 'el resultado oficial 3-1 permanece intacto');
    equal(await count(
      admin,
      `select count(*) from public.tournament_match_sources
       where fixture_version_id = $1 and source_type = 'league_position'
         and source_phase_id = $2`,
      [premium.fixtureVersionId, premium.phaseId],
    ), 2, 'la clasificación de Playoffs referencia la fase Liga original');

    const premiumCommercialAfter = await editionCommercialSnapshot(
      admin, premium.owner, premium.organizationId, premium.tournamentId,
    );
    equal(JSON.stringify(premiumCommercialAfter), JSON.stringify(premiumCommercialBefore),
      'PREMIUM conserva tournament count, grant count, tier y origen del grant');

    const phaseCountAfterFirstAppend = await count(
      admin,
      'select count(*) from public.tournament_phases where fixture_version_id = $1',
      [premium.fixtureVersionId],
    );
    const retry = await append(
      premium.owner, premium, 2, '98200000-0000-4000-8000-000000000003',
    );
    equal(retry.phaseId, appendedPremium.phaseId, 'retry idempotente devuelve la misma fase');
    equal(await count(
      admin,
      'select count(*) from public.tournament_phases where fixture_version_id = $1',
      [premium.fixtureVersionId],
    ), phaseCountAfterFirstAppend, 'retry idempotente no duplica filas');

    await admin.query(
      "update public.tournaments set status = 'completed', completed_at = now() where id = $1",
      [premium.tournamentId],
    );
    await expectError(
      () => append(
        premium.owner, premium, 2, '98200000-0000-4000-8000-000000000004',
      ),
      /TORNEOS_COMPETITION_READ_ONLY/,
      'completed permanece cerrado y no se reabre silenciosamente',
    );

    const freeOwner = await connect({ role: 'authenticated', userId: USERS.outsider });
    const freeOrganizationId = await createOrganization(freeOwner, 10);
    const freeSeason = await createSeason(freeOwner, freeOrganizationId, 10);
    const freeTournament = await createEdition(
      freeOwner, freeOrganizationId, freeSeason.id, 10,
    );
    const freeScheduled = await prepareLeagueFixture(
      admin,
      freeOwner,
      {
        organizationId: freeOrganizationId,
        seasonId: freeSeason.id,
        tournamentId: freeTournament.id,
      },
      8,
      10,
    );
    const freeCommercialBefore = await editionCommercialSnapshot(
      admin, freeOwner, freeOrganizationId, freeTournament.id,
    );
    const freeMatchesBefore = await count(
      admin,
      'select count(*) from public.tournament_matches where fixture_version_id = $1',
      [freeScheduled.fixtureVersionId],
    );
    equal(freeCommercialBefore.plan, 'FREE', 'fixture preparado resuelve FREE');
    const appendedFree = await append(
      freeOwner, freeScheduled, 8, '98200000-0000-4000-8000-000000000010',
    );
    equal(appendedFree.matchCount, 7, 'scheduled Top 8 agrega 7 partidos de Playoffs');
    const firstRoundSeeds = await value(
      admin,
      `select jsonb_agg(seed_pair.ranks order by seed_pair.match_number)
       from (
         select match_row.match_number,
           jsonb_agg(source.rank_number order by source.side desc) as ranks
         from public.tournament_matches match_row
         join public.tournament_rounds round_row on round_row.id = match_row.round_id
         join public.tournament_match_sources source on source.match_id = match_row.id
         where match_row.phase_id = $1 and round_row.round_number = 1
           and source.source_type = 'league_position'
         group by match_row.id, match_row.match_number
       ) seed_pair`,
      [appendedFree.phaseId],
    );
    equal(JSON.stringify(firstRoundSeeds), JSON.stringify([
      [1, 8], [2, 7], [3, 6], [4, 5],
    ]), 'Top 8 conserva el seeding 1-8, 2-7, 3-6 y 4-5');
    equal(await count(
      admin,
      'select count(*) from public.tournament_matches where fixture_version_id = $1',
      [freeScheduled.fixtureVersionId],
    ), freeMatchesBefore + 7, 'scheduled preserva Liga y suma sólo el bracket');
    equal(JSON.stringify(await editionCommercialSnapshot(
      admin, freeOwner, freeOrganizationId, freeTournament.id,
    )), JSON.stringify(freeCommercialBefore),
    'FREE agrega Playoffs sin upgrade, compra ni grant');

    const registrationOrganizationId = await createOrganization(freeOwner, 20);
    const registrationSeason = await createSeason(
      freeOwner, registrationOrganizationId, 20,
    );
    const registrationTournament = await createEdition(
      freeOwner, registrationOrganizationId, registrationSeason.id, 20,
    );
    const registrationScope = await prepareLeagueFixture(
      admin,
      freeOwner,
      {
        organizationId: registrationOrganizationId,
        seasonId: registrationSeason.id,
        tournamentId: registrationTournament.id,
      },
      4,
      20,
    );
    await admin.query(
      "update public.tournaments set status = 'registration' where id = $1",
      [registrationTournament.id],
    );
    const registrationAppend = await append(
      freeOwner,
      registrationScope,
      4,
      '98200000-0000-4000-8000-000000000020',
    );
    equal(registrationAppend.matchCount, 3,
      'registration con fixture oficial también admite Top 4');
  } catch (error) {
    failures += 1;
    console.error(error);
  } finally {
    await cleanupMatchOperationsHarness();
  }

  console.log(`\n${checks - failures}/${checks} verificaciones aprobadas`);
  if (failures) process.exitCode = 1;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await run();
}
