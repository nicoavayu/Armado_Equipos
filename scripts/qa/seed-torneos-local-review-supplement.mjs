#!/usr/bin/env node

import process from 'node:process';

import pg from 'pg';

import productionGuard from './production-guard.js';
import { stableUuid } from './torneos-demo-dataset.mjs';

const { assertLocalDatabaseTarget } = productionGuard;

const SUPPLEMENT_KEY = 'qa.local_review.supplement.v1';
const SUPPLEMENT_MARKER_ID = stableUuid(SUPPLEMENT_KEY);
const ACTIVE_TOURNAMENT_NAME = 'Torneo Apertura QA 2026';

function uuid(label) {
  return stableUuid(`${SUPPLEMENT_KEY}:${label}`);
}

async function value(client, text, values = []) {
  const result = await client.query(text, values);
  const row = result.rows[0] || {};
  return row[Object.keys(row)[0]];
}

async function assumeRole(client, role, userId = null) {
  await client.query(`set local role ${role}`);
  await client.query(
    "select set_config('request.jwt.claim.role',$1,true), set_config('request.jwt.claim.sub',$2,true)",
    [role, userId || ''],
  );
}

async function currentScope(client) {
  const result = await client.query(
    `select organization.id as organization_id,
            tournament.id as tournament_id,
            tournament.season_id,
            category.id as category_id,
            owner_user.id as owner_user_id
     from public.tournament_organizations organization
     join public.tournaments tournament
       on tournament.organization_id = organization.id
      and tournament.name = $1
     join lateral (
       select id from public.tournament_categories
       where tournament_id = tournament.id and status = 'active'
       order by created_at limit 1
     ) category on true
     join lateral (
       select id from auth.users
       where raw_app_meta_data->>'qa_role' = 'owner'
         and raw_app_meta_data->>'qa_seed_key' in (
           'torneos-demo-v2','torneos-demo-v3','torneos-demo-v4'
         )
       order by created_at limit 1
     ) owner_user on true
     where organization.slug = 'qa-metropolitana'`,
    [ACTIVE_TOURNAMENT_NAME],
  );
  if (result.rowCount !== 1) {
    throw new Error('Expected exactly one local torneos-demo scope and QA owner.');
  }
  return result.rows[0];
}

async function markerExists(client, organizationId) {
  return Boolean(await value(
    client,
    `select exists(
       select 1 from public.tournament_audit_log
       where organization_id = $1
         and action = 'qa.local_review.supplement_applied'
         and resource_id = $2
     )`,
    [organizationId, SUPPLEMENT_MARKER_ID],
  ));
}

async function restorePrimaryReviewContext(client, scope) {
  await assumeRole(client, 'authenticated', scope.owner_user_id);
  await value(
    client,
    'select public.set_active_tournament_context($1,$2,$3)',
    [scope.organization_id, scope.season_id, scope.tournament_id],
  );
  await client.query('reset role');
}

async function createSeason(client, organizationId, spec) {
  return value(
    client,
    `select public.create_tournament_season($1,$2,$3,$4,$5,$6::uuid)`,
    [
      organizationId,
      spec.name,
      spec.slug,
      spec.startDate,
      spec.endDate,
      uuid(`season:${spec.slug}`),
    ],
  );
}

async function createTournament(client, organizationId, seasonId, spec) {
  return value(
    client,
    `select public.create_tournament_with_defaults(
       $1,$2,$3,$4,$5,'football_5','league','open',$6,$7,$8::uuid
     )`,
    [
      organizationId,
      seasonId,
      spec.name,
      spec.slug,
      spec.description,
      spec.startDate,
      spec.endDate,
      uuid(`tournament:${spec.slug}`),
    ],
  );
}

async function createAnnouncement(client, scope, spec) {
  const id = await value(
    client,
    `select public.create_tournament_announcement_draft(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,null,null,null,$10::uuid
     )`,
    [
      scope.organization_id,
      scope.tournament_id,
      scope.category_id,
      spec.type,
      spec.title,
      spec.summary,
      spec.body,
      spec.priority,
      spec.acknowledgementMode,
      uuid(`announcement:${spec.key}`),
    ],
  );
  await value(
    client,
    `select public.set_tournament_announcement_audience($1,$2,null,null,null,null)`,
    [id, spec.audience],
  );
  if (spec.publish) {
    const preview = await value(
      client,
      'select public.preview_tournament_announcement_audience($1)',
      [id],
    );
    await value(
      client,
      'select public.publish_tournament_announcement($1,$2)',
      [id, preview.estimatedRecipients],
    );
  }
  return id;
}

async function report(client, scope) {
  const result = await client.query(
    `select
       (select count(*)::integer from public.tournament_organizations) organizations,
       (select count(*)::integer from public.tournament_seasons where organization_id=$1) seasons,
       (select count(*)::integer from public.tournaments where organization_id=$1) tournaments,
       (select count(*)::integer from public.tournament_team_entries where organization_id=$1) teams,
       (select count(*)::integer from public.tournament_roster_players where organization_id=$1) players,
       (select count(*)::integer from public.tournament_matches where organization_id=$1) matches,
       (select count(*)::integer from public.tournament_match_scores where organization_id=$1) results,
       (select count(*)::integer from public.tournament_venues where organization_id=$1) venues,
       (select count(*)::integer from public.tournament_courts where organization_id=$1) courts,
       (select count(*)::integer from public.tournament_schedule_windows where organization_id=$1 and status='active') schedule_windows,
       (select count(*)::integer from public.tournament_matches where organization_id=$1 and scheduled_at is not null) scheduled_matches,
       (select count(*)::integer from public.tournament_announcements where organization_id=$1) announcements,
       (select count(*)::integer from public.tournament_media_galleries where organization_id=$1) galleries,
       (select count(*)::integer from public.tournament_player_suspensions where organization_id=$1) suspensions,
       (select count(*)::integer from public.tournament_public_pages where organization_id=$1 and status='published') public_pages,
       (select count(*)::integer from public.tournament_organization_subscriptions where organization_id=$1 and status='active') active_subscriptions`,
    [scope.organization_id],
  );
  return result.rows[0];
}

async function applySupplement(client) {
  await client.query('begin isolation level serializable');
  try {
    const scope = await currentScope(client);
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1,0))",
      [SUPPLEMENT_KEY],
    );
    if (await markerExists(client, scope.organization_id)) {
      await restorePrimaryReviewContext(client, scope);
      const counts = await report(client, scope);
      await client.query('commit');
      return { status: 'skip', supplementKey: SUPPLEMENT_KEY, counts };
    }

    await assumeRole(client, 'authenticated', scope.owner_user_id);

    const pastSeason = await createSeason(client, scope.organization_id, {
      name: 'Temporada QA 2025 Finalizada',
      slug: 'temporada-qa-2025-finalizada',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    const pastTournament = await createTournament(
      client,
      scope.organization_id,
      pastSeason.id,
      {
        name: 'Liga Metropolitana QA 2025',
        slug: 'liga-metropolitana-qa-2025',
        description: 'Competencia histórica local para revisión visual.',
        startDate: '2025-03-01',
        endDate: '2025-11-30',
      },
    );
    await value(
      client,
      "select public.change_tournament_status($1,$2,'archived')",
      [scope.organization_id, pastTournament.id],
    );
    await value(
      client,
      `select public.update_tournament_season($1,$2,null,null,null,null,'archived',false,false)`,
      [scope.organization_id, pastSeason.id],
    );

    const futureSeason = await createSeason(client, scope.organization_id, {
      name: 'Temporada QA 2027 Próxima',
      slug: 'temporada-qa-2027-proxima',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
    });
    await createTournament(client, scope.organization_id, futureSeason.id, {
      name: 'Apertura Metropolitano QA 2027',
      slug: 'apertura-metropolitano-qa-2027',
      description: 'Competencia futura en preparación, exclusiva de QA local.',
      startDate: '2027-02-01',
      endDate: '2027-07-31',
    });

    const venueNorth = await value(
      client,
      `select public.create_tournament_venue(
        $1,'Complejo Deportivo Norte QA','Av. del Libertador 4200',null,
        -34.5671,-58.4362,'Palermo','America/Argentina/Buenos_Aires',
        'Sede principal del dataset local de revisión.'
      )`,
      [scope.organization_id],
    );
    const venueSouth = await value(
      client,
      `select public.create_tournament_venue(
        $1,'Polideportivo Sur QA','Av. Caseros 3100',null,
        -34.6419,-58.4165,'Parque Patricios','America/Argentina/Buenos_Aires',
        'Sede alternativa del dataset local de revisión.'
      )`,
      [scope.organization_id],
    );
    const courtNorthA = await value(
      client,
      "select public.create_tournament_court($1,$2,'Cancha Norte 1','football_5','Césped sintético')",
      [scope.organization_id, venueNorth.id],
    );
    const courtNorthB = await value(
      client,
      "select public.create_tournament_court($1,$2,'Cancha Norte 2','football_5','Cancha auxiliar')",
      [scope.organization_id, venueNorth.id],
    );
    const courtSouth = await value(
      client,
      "select public.create_tournament_court($1,$2,'Cancha Sur Central','football_5','Techada')",
      [scope.organization_id, venueSouth.id],
    );
    const windows = [
      { categoryId: scope.category_id, venueId: venueNorth.id, courtId: courtNorthA.id, dayOfWeek: 6, startsAt: '09:00', endsAt: '22:00', slotDurationMinutes: 60, bufferMinutes: 0, windowType: 'availability', notes: 'Sábados Norte 1' },
      { categoryId: scope.category_id, venueId: venueNorth.id, courtId: courtNorthB.id, dayOfWeek: 6, startsAt: '10:00', endsAt: '21:00', slotDurationMinutes: 60, bufferMinutes: 0, windowType: 'availability', notes: 'Sábados Norte 2' },
      { categoryId: scope.category_id, venueId: venueSouth.id, courtId: courtSouth.id, dayOfWeek: 7, startsAt: '09:00', endsAt: '20:00', slotDurationMinutes: 60, bufferMinutes: 0, windowType: 'availability', notes: 'Domingos Sur' },
    ];
    await value(
      client,
      'select public.save_tournament_schedule_windows($1,$2,$3::jsonb)',
      [scope.organization_id, scope.tournament_id, JSON.stringify(windows)],
    );

    await client.query('reset role');
    const historicalAssignments = [
      [1, '2026-06-06T17:00:00Z', venueNorth.id, courtNorthA.id],
      [2, '2026-06-06T18:00:00Z', venueNorth.id, courtNorthB.id],
      [3, '2026-06-07T16:00:00Z', venueSouth.id, courtSouth.id],
      [4, '2026-06-07T17:00:00Z', venueSouth.id, courtSouth.id],
      [6, '2026-06-13T17:00:00Z', venueNorth.id, courtNorthA.id],
      [7, '2026-06-13T18:00:00Z', venueNorth.id, courtNorthB.id],
      [8, '2026-06-14T16:00:00Z', venueSouth.id, courtSouth.id],
      [9, '2026-06-20T17:00:00Z', venueNorth.id, courtNorthA.id],
      [10, '2026-06-20T18:00:00Z', venueNorth.id, courtNorthB.id],
      [11, '2026-06-21T16:00:00Z', venueSouth.id, courtSouth.id],
      [12, '2026-06-21T17:00:00Z', venueSouth.id, courtSouth.id],
      [5, '2026-09-05T20:00:00Z', venueNorth.id, courtNorthA.id],
    ];
    for (const [matchNumber, scheduledAt, venueId, courtId] of historicalAssignments) {
      await client.query(
        `update public.tournament_matches
         set scheduled_at=$1,venue_id=$2,court_id=$3,duration_minutes=60,updated_at=now()
         where organization_id=$4 and tournament_id=$5 and match_number=$6
           and scheduled_at is null`,
        [scheduledAt, venueId, courtId, scope.organization_id, scope.tournament_id, matchNumber],
      );
    }

    await assumeRole(client, 'authenticated', scope.owner_user_id);

    await createAnnouncement(client, scope, {
      key: 'published-fixture-update',
      type: 'match_update',
      title: 'Programación confirmada para las próximas fechas',
      summary: 'Ya están disponibles las sedes y horarios de la agenda QA.',
      body: 'Consultá la programación actualizada y presentate treinta minutos antes del inicio.',
      priority: 'urgent',
      acknowledgementMode: 'read',
      audience: 'tournament',
      publish: true,
    });
    await createAnnouncement(client, scope, {
      key: 'draft-captains-meeting',
      type: 'general',
      title: 'Borrador: reunión de delegados',
      summary: 'Agenda preliminar para capitanes y delegados.',
      body: 'Este comunicado permanece en borrador para validar estados editoriales.',
      priority: 'normal',
      acknowledgementMode: 'none',
      audience: 'captains',
      publish: false,
    });

    const mediaScope = await client.query(
      `select match_row.id match_id,match_row.round_id
       from public.tournament_matches match_row
       join public.tournament_fixture_versions fixture
         on fixture.id=match_row.fixture_version_id and fixture.status='published'
       where match_row.organization_id=$1 and match_row.tournament_id=$2
       order by match_row.match_number limit 1`,
      [scope.organization_id, scope.tournament_id],
    );
    await value(
      client,
      `select public.create_tournament_media_gallery($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid)`,
      [
        scope.organization_id,
        scope.tournament_id,
        scope.category_id,
        mediaScope.rows[0].round_id,
        mediaScope.rows[0].match_id,
        'Fecha 1 · Selección QA local',
        'Galería en borrador sin dependencias externas ni datos personales nuevos.',
        'tournament_participants',
        uuid('media-gallery:fecha-1'),
      ],
    );

    await client.query('reset role');
    await assumeRole(client, 'service_role');
    await value(
      client,
      `select public.set_tournament_organization_subscription(
        $1,'active','2026-08-01T00:00:00Z','2026-09-30T23:59:59Z',null,null,90
      )`,
      [scope.organization_id],
    );

    await client.query('reset role');
    await client.query(
      `insert into public.tournament_audit_log (
        organization_id,actor_user_id,actor_type,action,resource_type,
        resource_id,team_entry_id,tournament_id,metadata
      ) values (
        $1,$2,'user','qa.local_review.supplement_applied','qa_local_review',
        $3,null,$4,$5::jsonb
      )`,
      [
        scope.organization_id,
        scope.owner_user_id,
        SUPPLEMENT_MARKER_ID,
        scope.tournament_id,
        JSON.stringify({
          supplementKey: SUPPLEMENT_KEY,
          localOnly: true,
          canonicalSeed: 'torneos-demo-v4',
          historicalScheduleBackfill: 12,
        }),
      ],
    );

    await restorePrimaryReviewContext(client, scope);
    await client.query('reset role');
    const counts = await report(client, scope);
    await client.query('commit');
    return { status: 'created', supplementKey: SUPPLEMENT_KEY, counts };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has('--apply-local') || args.size !== 1) {
    console.log(JSON.stringify({
      status: 'plan',
      writes: false,
      supplementKey: SUPPLEMENT_KEY,
      usage: 'QA_ALLOW_LOCAL_REVIEW_SEED=true node scripts/qa/seed-torneos-local-review-supplement.mjs --apply-local',
    }, null, 2));
    return;
  }
  if (process.env.QA_ALLOW_LOCAL_REVIEW_SEED !== 'true') {
    throw new Error('QA_ALLOW_LOCAL_REVIEW_SEED=true is required.');
  }
  const target = assertLocalDatabaseTarget(process.env);
  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    console.log(JSON.stringify(await applySupplement(client), null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
