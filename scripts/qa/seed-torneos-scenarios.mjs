#!/usr/bin/env node

import process from 'node:process';

import pg from 'pg';

import productionGuard from './production-guard.js';
import { stableUuid } from './torneos-demo-dataset.mjs';

const { assertLocalDatabaseTarget } = productionGuard;

export const QA_SCENARIO_SEED = '20260812';
export const EDGE_KEY = 'qa.scenarios.edge.v1';
export const VOLUME_KEY = 'qa.scenarios.volume.v1';
export const REFERENCE_NOW = '2026-08-12T15:00:00-03:00';

const PROFILE_KEYS = Object.freeze({ edge: EDGE_KEY, volume: VOLUME_KEY });

function uuid(key, label) {
  return stableUuid(`${key}:${label}`);
}

function normalizeName(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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

async function resetRole(client) {
  await client.query('reset role');
  await client.query(
    "select set_config('request.jwt.claim.role','',true), set_config('request.jwt.claim.sub','',true)",
  );
}

async function baselineScope(client) {
  const result = await client.query(
    `select organization.id organization_id,tournament.id tournament_id,
            tournament.season_id,owner_user.id owner_user_id
     from public.tournament_organizations organization
     join public.tournaments tournament
       on tournament.organization_id=organization.id
      and tournament.name='Torneo Apertura QA 2026'
     join lateral (
       select id from auth.users
       where raw_app_meta_data->>'qa_role'='owner'
         and raw_app_meta_data->>'qa_seed_key' in
           ('torneos-demo-v2','torneos-demo-v3','torneos-demo-v4')
       order by created_at limit 1
     ) owner_user on true
     where organization.slug='qa-metropolitana'`,
  );
  if (result.rowCount !== 1) {
    throw new Error('Expected torneos-demo-v4 and exactly one existing QA owner.');
  }
  return result.rows[0];
}

async function restoreBaselineContext(client, scope) {
  await assumeRole(client, 'authenticated', scope.owner_user_id);
  await value(
    client,
    'select public.set_active_tournament_context($1,$2,$3)',
    [scope.organization_id, scope.season_id, scope.tournament_id],
  );
  await resetRole(client);
}

async function markerExists(client, key) {
  return Boolean(await value(
    client,
    `select exists(
       select 1 from public.tournament_audit_log
       where action='qa.scenario_fixture.applied' and resource_id=$1
     )`,
    [uuid(key, 'marker')],
  ));
}

async function createOrganization(client, key, ownerId, spec) {
  const id = uuid(key, `organization:${spec.slug}`);
  await client.query(
    `insert into public.tournament_organizations(
       id,name,slug,status,created_by,creation_key,archived_at
     ) values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      spec.name,
      spec.slug,
      spec.status || 'active',
      ownerId,
      uuid(key, `organization-creation:${spec.slug}`),
      spec.status === 'archived' ? REFERENCE_NOW : null,
    ],
  );
  await client.query(
    `insert into public.tournament_organization_members(
       id,organization_id,user_id,role,status,invited_by,joined_at
     ) values ($1,$2,$3,'owner','active',null,$4)`,
    [uuid(key, `membership:${spec.slug}:owner`), id, ownerId, REFERENCE_NOW],
  );
  return id;
}

async function createSeason(client, key, ownerId, organizationId, spec) {
  const id = uuid(key, `season:${spec.slug}`);
  await client.query(
    `insert into public.tournament_seasons(
       id,organization_id,name,slug,status,start_date,end_date,created_by,
       creation_key,archived_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id, organizationId, spec.name, spec.slug, spec.status,
      spec.startDate || null, spec.endDate || null, ownerId,
      uuid(key, `season-creation:${spec.slug}`),
      spec.status === 'archived' ? REFERENCE_NOW : null,
    ],
  );
  return id;
}

async function createTournament(client, key, ownerId, organizationId, seasonId, spec) {
  const id = uuid(key, `tournament:${spec.slug}`);
  const categoryId = uuid(key, `category:${spec.slug}:open`);
  await client.query(
    `insert into public.tournaments(
       id,organization_id,season_id,name,slug,description,status,
       sport_modality,competition_format,gender_category,team_size,
       substitutes_limit,start_date,end_date,format_settings,created_by,
       creation_key,archived_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,'football_5','league','open',5,30,$8,$9,
       '{}'::jsonb,$10,$11,$12
     )`,
    [
      id, organizationId, seasonId, spec.name, spec.slug,
      spec.description || null, spec.status || 'draft', spec.startDate || null,
      spec.endDate || null, ownerId, uuid(key, `tournament-creation:${spec.slug}`),
      spec.status === 'archived' ? REFERENCE_NOW : null,
    ],
  );
  await client.query(
    `insert into public.tournament_categories(
       id,organization_id,tournament_id,name,slug,status,sort_order,
       gender_category,sport_modality,team_size
     ) values ($1,$2,$3,'Primera','primera','active',0,'open','football_5',5)`,
    [categoryId, organizationId, id],
  );
  return { tournamentId: id, categoryId };
}

async function createTeam(client, key, ownerId, scope, spec) {
  const entryId = uuid(key, `team:${scope.tournamentId}:${spec.slug}`);
  await client.query(
    `insert into public.tournament_team_entries(
       id,organization_id,season_id,tournament_id,category_id,name,slug,
       short_name,primary_color,secondary_color,status,registration_source,
       created_by,reviewed_by,reviewed_at,approved_at,idempotency_key
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'provisional',$12,
       case when $11::text='approved' then $12::uuid else null::uuid end,
       case when $11::text='approved' then $13::timestamptz else null::timestamptz end,
       case when $11::text='approved' then $13::timestamptz else null::timestamptz end,$14::uuid
     )`,
    [
      entryId, scope.organizationId, scope.seasonId, scope.tournamentId,
      scope.categoryId, spec.name, spec.slug, spec.shortName || null,
      spec.primaryColor || '#3757FF', spec.secondaryColor || '#101827',
      spec.status || 'approved', ownerId, REFERENCE_NOW,
      uuid(key, `team-idempotency:${scope.tournamentId}:${spec.slug}`),
    ],
  );
  if (spec.withRoster === false) return { entryId, rosterId: null };
  const rosterId = uuid(key, `roster:${scope.tournamentId}:${spec.slug}`);
  const rosterStatus = spec.rosterStatus || 'approved';
  await client.query(
    `insert into public.tournament_rosters(
       id,organization_id,team_entry_id,status,submitted_at,approved_at,created_by
     ) values ($1,$2,$3,$4,
       case when $4 in ('submitted','changes_requested','approved','locked','superseded')
         then $5::timestamptz else null end,
       case when $4 in ('approved','locked','superseded')
         then $5::timestamptz else null end,$6)`,
    [rosterId, scope.organizationId, entryId, rosterStatus, REFERENCE_NOW, ownerId],
  );
  return { entryId, rosterId };
}

async function addPlayers(client, key, ownerId, organizationId, team, spec) {
  const names = spec.names || [];
  for (let index = 0; index < spec.count; index += 1) {
    const displayName = names[index] || `Jugador QA ${spec.teamCode} ${String(index + 1).padStart(2, '0')}`;
    const provisionalId = uuid(key, `provisional:${team.entryId}:${index + 1}`);
    await client.query(
      `insert into public.tournament_provisional_players(
         id,organization_id,display_name,normalized_name,contact_email,
         contact_phone,created_by
       ) values ($1,$2,$3,$4,null,null,$5)`,
      [provisionalId, organizationId, displayName, normalizeName(displayName), ownerId],
    );
    await client.query(
      `insert into public.tournament_roster_players(
         id,organization_id,team_entry_id,roster_id,provisional_player_id,
         display_name,avatar_url,shirt_number,primary_position,secondary_position,
         is_goalkeeper,status,eligibility_status,added_by
       ) values ($1,$2,$3,$4,$5,$6,null,$7,$8,null,$9,'active',$10,$11)`,
      [
        uuid(key, `roster-player:${team.entryId}:${index + 1}`), organizationId,
        team.entryId, team.rosterId, provisionalId, displayName,
        index === 0 && spec.nullShirt ? null : ((index + 1) % 100),
        index === 1 && spec.nullPosition ? null : (index === 0 ? 'ARQ' : ['DEF', 'MED', 'DEL'][index % 3]),
        index === 0,
        spec.eligibility || 'eligible', ownerId,
      ],
    );
  }
}

async function freezeAndGenerate(client, key, ownerId, scope, label, publish = false) {
  await assumeRole(client, 'authenticated', ownerId);
  const frozen = await value(
    client,
    'select public.freeze_tournament_participants($1,$2,$3,$4::uuid)',
    [
      scope.organizationId, scope.tournamentId, scope.categoryId,
      uuid(key, `freeze:${label}`),
    ],
  );
  const generated = await value(
    client,
    `select public.generate_tournament_fixture($1,$2,$3,$4,'{}'::jsonb,$5::uuid)`,
    [
      scope.organizationId, scope.tournamentId, scope.categoryId,
      `${label}-${QA_SCENARIO_SEED}`, uuid(key, `fixture:${label}`),
    ],
  );
  if (publish) {
    await value(
      client,
      'select public.publish_tournament_fixture($1,$2)',
      [scope.organizationId, generated.fixtureVersionId],
    );
  }
  await resetRole(client);
  return { frozen, generated };
}

async function addMarker(client, key, organizationId, ownerId, tournamentId, metadata) {
  await client.query(
    `insert into public.tournament_audit_log(
       organization_id,actor_user_id,actor_type,action,resource_type,
       resource_id,tournament_id,metadata
     ) values ($1,$2,'user','qa.scenario_fixture.applied','qa_scenario_fixture',$3,$4,$5::jsonb)`,
    [organizationId, ownerId, uuid(key, 'marker'), tournamentId, JSON.stringify(metadata)],
  );
}

async function seedEdge(client, baseline) {
  const key = EDGE_KEY;
  if (await markerExists(client, key)) return { profile: 'edge', status: 'skip' };
  const ownerId = baseline.owner_user_id;
  const organizationId = await createOrganization(client, key, ownerId, {
    name: 'QA Escenarios Deterministas',
    slug: 'qa-escenarios-deterministas',
  });
  await createOrganization(client, key, ownerId, {
    name: 'QA Organización Archivada',
    slug: 'qa-organizacion-archivada',
    status: 'archived',
  });

  const activeSeasonId = await createSeason(client, key, ownerId, organizationId, {
    name: 'Temporada QA Edge 2026', slug: 'temporada-qa-edge-2026', status: 'active',
    startDate: '2026-01-01', endDate: '2026-12-31',
  });
  await createSeason(client, key, ownerId, organizationId, {
    name: 'Temporada QA Sin Competencias', slug: 'temporada-qa-sin-competencias', status: 'draft',
    startDate: '2027-01-01', endDate: '2027-12-31',
  });
  await createSeason(client, key, ownerId, organizationId, {
    name: 'Temporada QA Completada', slug: 'temporada-qa-completada', status: 'completed',
    startDate: '2025-01-01', endDate: '2025-12-31',
  });

  const fresh = await createTournament(client, key, ownerId, organizationId, activeSeasonId, {
    name: 'Copa QA Recién Creada', slug: 'copa-qa-recien-creada', status: 'draft',
  });
  const one = await createTournament(client, key, ownerId, organizationId, activeSeasonId, {
    name: 'Copa QA Un Equipo', slug: 'copa-qa-un-equipo', status: 'registration',
  });
  const two = await createTournament(client, key, ownerId, organizationId, activeSeasonId, {
    name: 'Copa QA Dos Equipos', slug: 'copa-qa-dos-equipos', status: 'registration',
  });
  const odd = await createTournament(client, key, ownerId, organizationId, activeSeasonId, {
    name: 'Copa QA Cinco Equipos', slug: 'copa-qa-cinco-equipos', status: 'registration',
  });
  const temporal = await createTournament(client, key, ownerId, organizationId, activeSeasonId, {
    name: 'Copa QA Temporal Ocho', slug: 'copa-qa-temporal-ocho', status: 'registration',
  });

  const baseScope = { organizationId, seasonId: activeSeasonId };
  await createTeam(client, key, ownerId, { ...baseScope, ...one }, {
    name: 'QA Sin Plantel', slug: 'qa-sin-plantel', shortName: 'QSP', withRoster: false,
  });
  for (let index = 1; index <= 2; index += 1) {
    await createTeam(client, key, ownerId, { ...baseScope, ...two }, {
      name: `QA Dos ${index}`, slug: `qa-dos-${index}`, shortName: `QD${index}`,
    });
  }

  const oddCounts = [0, 4, 5, 6, 18];
  const oddNames = [
    ['Ál'],
    ["D'Ángelo", 'Íñigo Ñuñez', 'João Pérez', 'Li'],
    [], [],
    ['Nombre Extremadamente Largo Con Tildes y Apóstrofe D’Avila Cerca del Máximo Permitido'],
  ];
  for (let index = 0; index < oddCounts.length; index += 1) {
    const team = await createTeam(client, key, ownerId, { ...baseScope, ...odd }, {
      name: index === 4
        ? 'Asociación Deportiva del Barrio Norte con Nombre Muy Largo QA'
        : `QA Impar ${index + 1}`,
      slug: `qa-impar-${index + 1}`,
      shortName: `QI${index + 1}`,
    });
    await addPlayers(client, key, ownerId, organizationId, team, {
      count: oddCounts[index], teamCode: `I${index + 1}`, names: oddNames[index],
      nullShirt: index === 1, nullPosition: index === 1,
    });
  }
  const oddFixture = await freezeAndGenerate(
    client, key, ownerId, { ...baseScope, ...odd }, 'odd-five', false,
  );
  const phaseId = await value(
    client,
    'select id from public.tournament_phases where fixture_version_id=$1 order by sequence_number limit 1',
    [oddFixture.generated.fixtureVersionId],
  );
  await client.query(
    `insert into public.tournament_rounds(
       id,organization_id,tournament_id,category_id,fixture_version_id,phase_id,
       round_number,name,status,sort_order
     ) values ($1,$2,$3,$4,$5,$6,99,'Jornada vacía QA','draft',99)`,
    [
      uuid(key, 'round:empty'), organizationId, odd.tournamentId, odd.categoryId,
      oddFixture.generated.fixtureVersionId, phaseId,
    ],
  );

  const temporalTeams = [];
  for (let index = 1; index <= 8; index += 1) {
    temporalTeams.push(await createTeam(client, key, ownerId, { ...baseScope, ...temporal }, {
      name: `QA Temporal ${index}`, slug: `qa-temporal-${index}`, shortName: `QT${index}`,
    }));
  }
  const temporalFixture = await freezeAndGenerate(
    client, key, ownerId, { ...baseScope, ...temporal }, 'temporal-eight', false,
  );
  const venueId = uuid(key, 'venue:temporal');
  const courtId = uuid(key, 'court:temporal');
  await client.query(
    `insert into public.tournament_venues(
       id,organization_id,name,address,locality,timezone,status
     ) values ($1,$2,'Complejo Temporal QA','Calle QA 812','Buenos Aires',
       'America/Argentina/Buenos_Aires','active')`,
    [venueId, organizationId],
  );
  await client.query(
    `insert into public.tournament_courts(
       id,organization_id,venue_id,name,sport_modality,status
     ) values ($1,$2,$3,'Cancha Temporal QA','football_5','active')`,
    [courtId, organizationId, venueId],
  );
  const temporalDates = [
    '2026-08-11T20:30:00-03:00',
    '2026-08-12T00:05:00-03:00',
    '2026-08-12T15:05:00-03:00',
    '2026-08-12T23:30:00-03:00',
    '2026-08-13T09:00:00-03:00',
    '2026-08-31T23:59:00-03:00',
    '2026-09-01T00:01:00-03:00',
    '2026-12-31T23:59:00-03:00',
    '2027-01-01T00:01:00-03:00',
  ];
  const matchRows = (await client.query(
    `select id from public.tournament_matches
     where fixture_version_id=$1 order by match_number`,
    [temporalFixture.generated.fixtureVersionId],
  )).rows;
  for (let index = 0; index < temporalDates.length; index += 1) {
    await client.query(
      `update public.tournament_matches set status=$1,scheduled_at=$2,
         venue_id=$3,court_id=$4,duration_minutes=60,
         postponed_at=case when $1='postponed' then $5::timestamptz else null end,
         cancelled_at=case when $1='cancelled' then $5::timestamptz else null end
       where id=$6`,
      [
        index === 0 ? 'postponed' : (index === 1 ? 'cancelled' : 'scheduled'),
        temporalDates[index], venueId, courtId, REFERENCE_NOW, matchRows[index].id,
      ],
    );
  }
  await assumeRole(client, 'authenticated', ownerId);
  await value(
    client,
    'select public.publish_tournament_fixture($1,$2)',
    [organizationId, temporalFixture.generated.fixtureVersionId],
  );
  await resetRole(client);

  await addMarker(client, key, organizationId, ownerId, fresh.tournamentId, {
    fixtureKey: key, scenarioSeed: QA_SCENARIO_SEED, referenceNow: REFERENCE_NOW,
    localOnly: true, organizations: 2, tournaments: 5,
  });
  return { profile: 'edge', status: 'created' };
}

async function seedVolume(client, baseline) {
  const key = VOLUME_KEY;
  if (await markerExists(client, key)) return { profile: 'volume', status: 'skip' };
  const ownerId = baseline.owner_user_id;
  const organizationId = await createOrganization(client, key, ownerId, {
    name: 'QA Volumen Local 20 Equipos', slug: 'qa-volumen-local-20',
  });
  const seasonId = await createSeason(client, key, ownerId, organizationId, {
    name: 'Temporada QA Volumen 2026', slug: 'temporada-qa-volumen-2026', status: 'active',
    startDate: '2026-01-01', endDate: '2026-12-31',
  });
  const tournament = await createTournament(client, key, ownerId, organizationId, seasonId, {
    name: 'Liga QA Volumen 20 Equipos', slug: 'liga-qa-volumen-20', status: 'registration',
  });
  const scope = { organizationId, seasonId, ...tournament };
  for (let teamIndex = 1; teamIndex <= 20; teamIndex += 1) {
    const team = await createTeam(client, key, ownerId, scope, {
      name: `Volumen QA Equipo ${String(teamIndex).padStart(2, '0')}`,
      slug: `volumen-qa-equipo-${String(teamIndex).padStart(2, '0')}`,
      shortName: `V${String(teamIndex).padStart(2, '0')}`,
    });
    await addPlayers(client, key, ownerId, organizationId, team, {
      count: 12, teamCode: `V${String(teamIndex).padStart(2, '0')}`,
    });
  }
  const fixture = await freezeAndGenerate(client, key, ownerId, scope, 'volume-20', false);
  await addMarker(client, key, organizationId, ownerId, tournament.tournamentId, {
    fixtureKey: key, scenarioSeed: QA_SCENARIO_SEED, localOnly: true,
    teams: 20, players: 240, expectedMatches: 190,
    fixtureVersionId: fixture.generated.fixtureVersionId,
  });
  return { profile: 'volume', status: 'created' };
}

async function profileReport(client, key) {
  const organizationIds = key === EDGE_KEY
    ? [uuid(key, 'organization:qa-escenarios-deterministas'), uuid(key, 'organization:qa-organizacion-archivada')]
    : [uuid(key, 'organization:qa-volumen-local-20')];
  const result = await client.query(
    `select
       (select count(*)::integer from public.tournament_organizations where id=any($1)) organizations,
       (select count(*)::integer from public.tournament_seasons where organization_id=any($1)) seasons,
       (select count(*)::integer from public.tournaments where organization_id=any($1)) tournaments,
       (select count(*)::integer from public.tournament_team_entries where organization_id=any($1)) teams,
       (select count(*)::integer from public.tournament_roster_players where organization_id=any($1)) players,
       (select count(*)::integer from public.tournament_matches where organization_id=any($1)) matches,
       (select count(*)::integer from public.tournament_rounds where organization_id=any($1)) rounds`,
    [organizationIds],
  );
  return result.rows[0];
}

async function cleanup(client, profiles) {
  const keys = profiles.map((profile) => PROFILE_KEYS[profile]);
  const organizationIds = keys.flatMap((key) => (
    key === EDGE_KEY
      ? [uuid(key, 'organization:qa-escenarios-deterministas'), uuid(key, 'organization:qa-organizacion-archivada')]
      : [uuid(key, 'organization:qa-volumen-local-20')]
  ));
  const owned = Number(await value(
    client,
    `select count(*) from public.tournament_organizations
     where id=any($1) and creation_key=any($2)`,
    [
      organizationIds,
      keys.flatMap((key) => (
        key === EDGE_KEY
          ? [uuid(key, 'organization-creation:qa-escenarios-deterministas'), uuid(key, 'organization-creation:qa-organizacion-archivada')]
          : [uuid(key, 'organization-creation:qa-volumen-local-20')]
      )),
    ],
  ));
  if (owned !== organizationIds.length) throw new Error('Cleanup ownership proof failed.');
  const triggers = (await client.query(
    `select format('%I.%I',namespace.nspname,table_row.relname) table_name,
            trigger_row.tgname
     from pg_trigger trigger_row
     join pg_class table_row on table_row.oid=trigger_row.tgrelid
     join pg_namespace namespace on namespace.oid=table_row.relnamespace
     where namespace.nspname='public' and not trigger_row.tgisinternal
       and (trigger_row.tgtype & 8)=8 and trigger_row.tgenabled <> 'D'
       and table_row.relname like 'tournament_%'
     order by 1,2`,
  )).rows;
  for (const trigger of triggers) {
    await client.query(`alter table ${trigger.table_name} disable trigger "${trigger.tgname.replaceAll('"', '""')}"`);
  }
  try {
    await client.query('delete from public.tournament_organizations where id=any($1)', [organizationIds]);
  } finally {
    for (const trigger of triggers.reverse()) {
      await client.query(`alter table ${trigger.table_name} enable trigger "${trigger.tgname.replaceAll('"', '""')}"`);
    }
  }
  return { status: 'cleaned', profiles, organizations: organizationIds.length };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply-local');
  const clean = args.has('--cleanup-local');
  const profileArg = [...args].find((arg) => arg.startsWith('--profile=')) || '--profile=all';
  const profileValue = profileArg.split('=')[1];
  const profiles = profileValue === 'all' ? ['edge', 'volume'] : [profileValue];
  if (profiles.some((profile) => !PROFILE_KEYS[profile]) || (apply && clean)) {
    throw new Error('Use exactly one of --apply-local/--cleanup-local and --profile=edge|volume|all.');
  }
  if (!apply && !clean) {
    console.log(JSON.stringify({
      status: 'plan', writes: false, profiles, scenarioSeed: QA_SCENARIO_SEED,
      referenceNow: REFERENCE_NOW,
      apply: 'QA_ALLOW_LOCAL_SCENARIOS=true node scripts/qa/seed-torneos-scenarios.mjs --apply-local --profile=all',
      cleanup: 'QA_ALLOW_LOCAL_SCENARIO_CLEANUP=true QA_CONFIRM_SCENARIO_FIXTURES=true node scripts/qa/seed-torneos-scenarios.mjs --cleanup-local --profile=all',
    }, null, 2));
    return;
  }
  if (apply && process.env.QA_ALLOW_LOCAL_SCENARIOS !== 'true') {
    throw new Error('QA_ALLOW_LOCAL_SCENARIOS=true is required.');
  }
  if (clean && (
    process.env.QA_ALLOW_LOCAL_SCENARIO_CLEANUP !== 'true'
    || process.env.QA_CONFIRM_SCENARIO_FIXTURES !== 'true'
  )) {
    throw new Error('Cleanup requires both explicit local cleanup confirmations.');
  }
  const target = assertLocalDatabaseTarget(process.env);
  const client = new pg.Client({ connectionString: target.databaseUrl });
  await client.connect();
  try {
    await client.query('begin isolation level serializable');
    const baseline = await baselineScope(client);
    const results = [];
    if (clean) {
      results.push(await cleanup(client, profiles));
    } else {
      for (const profile of profiles) {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [PROFILE_KEYS[profile]]);
        results.push(profile === 'edge'
          ? await seedEdge(client, baseline)
          : await seedVolume(client, baseline));
      }
      await restoreBaselineContext(client, baseline);
    }
    const reports = {};
    for (const profile of profiles) reports[profile] = await profileReport(client, PROFILE_KEYS[profile]);
    await client.query('commit');
    console.log(JSON.stringify({ results, reports, scenarioSeed: QA_SCENARIO_SEED }, null, 2));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, code: error.code || null }, null, 2));
  process.exitCode = 1;
});
