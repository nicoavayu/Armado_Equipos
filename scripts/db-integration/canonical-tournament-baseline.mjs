#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

import pg from 'pg';

const USERS = {
  owner: '91000000-0000-4000-8000-000000000001',
  otherOwner: '91000000-0000-4000-8000-000000000002',
  memberless: '91000000-0000-4000-8000-000000000003',
};

const FORMATS = [
  {
    code: 'league',
    name: 'Liga',
    description: 'Todos compiten por puntos en una o dos ruedas.',
    teamCount: 2,
    settings: { rounds: 'single', qualifiers: 0 },
  },
  {
    code: 'knockout',
    name: 'Eliminación directa',
    description: 'Cruces eliminatorios a partido único o ida y vuelta.',
    teamCount: 2,
    settings: { legs: 'single', thirdPlace: false },
  },
  {
    code: 'groups',
    name: 'Fase de grupos',
    description: 'Grupos independientes con clasificación por puntos.',
    teamCount: 4,
    settings: { groupCount: 2, qualifiersPerGroup: 1, rounds: 'single' },
  },
  {
    code: 'groups_and_playoffs',
    name: 'Grupos y playoffs',
    description: 'Una fase de grupos clasifica a una etapa eliminatoria.',
    teamCount: 4,
    settings: {
      groupCount: 2,
      qualifiersPerGroup: 1,
      groupRounds: 'single',
      knockoutLegs: 'single',
    },
  },
  {
    code: 'league_and_playoffs',
    name: 'Liga y playoffs',
    description: 'Una liga general clasifica a una etapa eliminatoria.',
    teamCount: 4,
    settings: {
      leagueRounds: 'single',
      qualifiers: 2,
      knockoutLegs: 'single',
    },
  },
];

const clients = [];
let checks = 0;
let failures = 0;
let keySequence = 100;

function check(condition, label, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
}

function equal(actual, expected, label) {
  check(
    isDeepStrictEqual(actual, expected),
    label,
    `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
  );
}

async function expectError(action, pattern, label) {
  try {
    await action();
    check(false, label, 'la operación no fue rechazada');
  } catch (error) {
    const message = String(error?.message || error);
    check(pattern.test(message), label, message);
  }
}

function runReset(label) {
  console.log(`\n${label}`);
  const result = spawnSync(
    'npx',
    ['supabase', 'db', 'reset', '--local', '--no-seed'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`supabase db reset --local --no-seed falló (${result.status})`);
  }
}

function readLocalEnv() {
  const result = spawnSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'supabase status falló');
  }
  const localEnv = Object.fromEntries(
    result.stdout
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
  if (!localEnv.DB_URL) throw new Error('Supabase local no expuso DB_URL.');
  return localEnv;
}

async function connect(connectionString, { role = null, userId = null } = {}) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  clients.push(client);
  if (userId) {
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, false)",
      [userId],
    );
  }
  if (role) await client.query(`set role ${role}`);
  return client;
}

async function one(client, text, params = []) {
  return (await client.query(text, params)).rows[0] || null;
}

async function value(client, text, params = []) {
  const row = await one(client, text, params);
  return row ? Object.values(row)[0] : null;
}

async function count(client, text, params = []) {
  return Number(await value(client, text, params));
}

function requestKey() {
  keySequence += 1;
  return `92000000-0000-4000-8000-${String(keySequence).padStart(12, '0')}`;
}

async function readFormats(client) {
  return client.query(
    `select code, name, description
     from public.tournament_competition_formats
     order by case code
       when 'league' then 1
       when 'knockout' then 2
       when 'groups' then 3
       when 'groups_and_playoffs' then 4
       when 'league_and_playoffs' then 5
     end`,
  ).then(({ rows }) => rows);
}

async function createOrganization(client, name, slug) {
  return value(
    client,
    'select public.create_tournament_organization($1,$2,$3::uuid)',
    [name, slug, requestKey()],
  );
}

async function createSeason(client, organizationId, name, slug) {
  return value(
    client,
    `select public.create_tournament_season(
      $1,$2,$3,null,null,$4::uuid
    )`,
    [organizationId, name, slug, requestKey()],
  );
}

async function createTournament(
  client,
  organizationId,
  seasonId,
  format,
  suffix,
) {
  return value(
    client,
    `select public.create_tournament_with_defaults(
      $1,$2,$3,$4,null,'football_5',$5,'open',null,null,$6::uuid
    )`,
    [
      organizationId,
      seasonId,
      `Copa Baseline ${format}`,
      `copa-baseline-${suffix}`,
      format,
      requestKey(),
    ],
  );
}

async function createCategory(client, organizationId, tournamentId, suffix) {
  return value(
    client,
    `select public.save_tournament_category(
      $1,$2,null,$3,$4,null,0,null,null,null,null,null,'active'
    )`,
    [
      organizationId,
      tournamentId,
      `Primera ${suffix}`,
      `primera-${suffix}`,
    ],
  );
}

async function createApprovedTeam(
  owner,
  admin,
  scope,
  formatCode,
  index,
) {
  const suffix = `${formatCode}-${index}`;
  const created = await value(
    owner,
    `select public.create_tournament_team_entry(
      $1,$2,$3,null,$4,null,'#5575FF','#111827','provisional',
      null,null,null,$5::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      `Equipo ${suffix}`,
      requestKey(),
    ],
  );
  await admin.query(
    `update public.tournament_team_entries
     set status='approved', reviewed_by=$2, reviewed_at=now(), approved_at=now()
     where id=$1`,
    [created.entryId, USERS.owner],
  );
  await admin.query(
    `update public.tournament_rosters
     set status='approved', submitted_at=now(), approved_at=now()
     where id=$1`,
    [created.rosterId],
  );
  return created.entryId;
}

async function main() {
  console.log('\nArma2 Torneos · baseline canónica sin fixtures auxiliares\n');

  runReset('Reset limpio 1/2');
  const firstEnv = readLocalEnv();
  const firstAdmin = await connect(firstEnv.DB_URL);
  const firstSnapshot = await readFormats(firstAdmin);

  equal(
    firstSnapshot,
    FORMATS.map(({ code, name, description }) => ({ code, name, description })),
    'la baseline fresca contiene los cinco formatos históricos exactos',
  );
  equal(
    await count(firstAdmin, 'select count(*) from public.tournament_sport_modalities'),
    6,
    'la baseline fresca conserva las seis modalidades históricas',
  );
  equal(
    await firstAdmin.query(
      `select table_name
       from information_schema.tables
       where table_schema='public'
         and table_type='BASE TABLE'
         and table_name ~ '(catalog|lookup|type|status|format|modalit)'
       order by table_name`,
    ).then(({ rows }) => rows.map((row) => row.table_name)),
    ['tournament_competition_formats', 'tournament_sport_modalities'],
    'la auditoría preventiva identifica sólo dos tablas catálogo de Torneos',
  );
  equal(
    await count(
      firstAdmin,
      `select count(*)
       from information_schema.columns
       where table_schema='public'
         and table_name='tournament_competition_formats'
         and column_name in ('id','uuid','slug','sort_order','is_active','active')`,
    ),
    0,
    'el catálogo no inventa UUID, slug separado, orden ni flag activo',
  );
  equal(
    await firstAdmin.query(
      `select source.relname as source_table,
              target.relname as target_table
       from pg_constraint constraint_row
       join pg_class source on source.oid=constraint_row.conrelid
       join pg_class target on target.oid=constraint_row.confrelid
       join pg_namespace namespace on namespace.oid=source.relnamespace
       where constraint_row.contype='f'
         and namespace.nspname='public'
         and source.relname in ('tournaments','tournament_categories')
         and target.relname in (
           'tournament_competition_formats',
           'tournament_sport_modalities'
         )
       order by source.relname, target.relname`,
    ).then(({ rows }) => rows),
    [
      {
        source_table: 'tournament_categories',
        target_table: 'tournament_sport_modalities',
      },
      {
        source_table: 'tournaments',
        target_table: 'tournament_competition_formats',
      },
      {
        source_table: 'tournaments',
        target_table: 'tournament_sport_modalities',
      },
    ],
    'las FKs obligatorias de torneo y categoría apuntan a catálogos poblados',
  );

  await firstAdmin.query(
    `insert into public.tournament_competition_formats(code,name,description)
     values
       ('league','Liga','Todos compiten por puntos en una o dos ruedas.'),
       ('knockout','Eliminación directa','Cruces eliminatorios a partido único o ida y vuelta.'),
       ('groups','Fase de grupos','Grupos independientes con clasificación por puntos.'),
       ('groups_and_playoffs','Grupos y playoffs','Una fase de grupos clasifica a una etapa eliminatoria.'),
       ('league_and_playoffs','Liga y playoffs','Una liga general clasifica a una etapa eliminatoria.')
     on conflict (code) do update
     set name=excluded.name, description=excluded.description`,
  );
  equal(
    await count(firstAdmin, 'select count(*) from public.tournament_competition_formats'),
    5,
    'repetir el seed no duplica formatos',
  );
  await firstAdmin.end();

  runReset('Reset limpio 2/2');
  const localEnv = readLocalEnv();
  const admin = await connect(localEnv.DB_URL);
  equal(
    await readFormats(admin),
    firstSnapshot,
    'un reset repetido conserva los mismos códigos y metadatos',
  );

  for (const [name, id] of Object.entries(USERS)) {
    await admin.query(
      `insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
       values ($1,$2,now(),$3::jsonb)`,
      [id, `${name}@baseline.local`, JSON.stringify({ full_name: name })],
    );
  }

  const owner = await connect(localEnv.DB_URL, {
    role: 'authenticated',
    userId: USERS.owner,
  });
  const otherOwner = await connect(localEnv.DB_URL, {
    role: 'authenticated',
    userId: USERS.otherOwner,
  });
  const memberless = await connect(localEnv.DB_URL, {
    role: 'authenticated',
    userId: USERS.memberless,
  });

  const ownerOrganization = await createOrganization(
    owner,
    'Liga Baseline A',
    'liga-baseline-a',
  );
  const organizationId = ownerOrganization.organization.id;
  const season = await createSeason(
    owner,
    organizationId,
    'Temporada Baseline',
    'temporada-baseline',
  );
  check(
    Boolean(organizationId && season.id),
    'usuario, organización, owner membership y temporada se crean por RPC real',
  );

  const otherOrganization = await createOrganization(
    otherOwner,
    'Liga Baseline B',
    'liga-baseline-b',
  );
  check(
    otherOrganization.membership.role === 'owner',
    'el segundo tenant queda aislado con su propia membresía',
  );

  await expectError(
    () => createTournament(
      owner,
      organizationId,
      season.id,
      'not_a_format',
      'invalid-format',
    ),
    /TORNEOS_INVALID_TOURNAMENT/,
    'un formato inexistente es rechazado',
  );
  await expectError(
    () => createTournament(
      otherOwner,
      organizationId,
      season.id,
      'league',
      'cross-tenant',
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'el owner de otro tenant no crea torneos cross-tenant',
  );
  await expectError(
    () => createTournament(
      memberless,
      organizationId,
      season.id,
      'league',
      'without-membership',
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'un usuario sin membresía no crea torneos',
  );

  for (const [formatIndex, format] of FORMATS.entries()) {
    const suffix = format.code.replaceAll('_', '-');
    const tournament = await createTournament(
      owner,
      organizationId,
      season.id,
      format.code,
      suffix,
    );
    const tournamentRow = await one(
      admin,
      `select id::text, organization_id::text, slug, competition_format,
              format_settings
       from public.tournaments
       where id=$1`,
      [tournament.id],
    );
    check(
      /^[0-9a-f-]{36}$/.test(tournamentRow.id),
      `${format.code} crea un ID UUID válido`,
    );
    equal(
      {
        organizationId: tournamentRow.organization_id,
        slug: tournamentRow.slug,
        competitionFormat: tournamentRow.competition_format,
        settings: tournamentRow.format_settings,
      },
      {
        organizationId,
        slug: `copa-baseline-${suffix}`,
        competitionFormat: format.code,
        settings: format.settings,
      },
      `${format.code} conserva código, slug, tenant y reglas mínimas`,
    );
    equal(
      await count(
        admin,
        `select
           (select count(*) from public.tournament_scoring_rules where tournament_id=$1)
           + (select count(*) from public.tournament_tiebreak_rules where tournament_id=$1)
           + (select count(*) from public.tournament_discipline_rules where tournament_id=$1)`,
        [tournament.id],
      ),
      6,
      `${format.code} crea scoring, cuatro desempates y disciplina`,
    );

    const category = await createCategory(
      owner,
      organizationId,
      tournament.id,
      suffix,
    );
    await value(
      owner,
      'select public.change_tournament_status($1,$2,$3)',
      [organizationId, tournament.id, 'registration'],
    );
    const scope = {
      organizationId,
      seasonId: season.id,
      tournamentId: tournament.id,
      categoryId: category.id,
    };
    for (let index = 1; index <= format.teamCount; index += 1) {
      await createApprovedTeam(owner, admin, scope, format.code, index);
    }
    const frozen = await value(
      owner,
      'select public.freeze_tournament_participants($1,$2,$3,$4::uuid)',
      [organizationId, tournament.id, category.id, requestKey()],
    );
    const fixtureSeed = `baseline-${suffix}`;
    if (format.code.startsWith('groups')) {
      await value(
        owner,
        'select public.execute_tournament_group_draw($1,$2,$3,2,$4,true)',
        [organizationId, tournament.id, category.id, fixtureSeed],
      );
    }
    const fixture = await value(
      owner,
      `select public.generate_tournament_fixture(
        $1,$2,$3,$4,'{}'::jsonb,$5::uuid
      )`,
      [organizationId, tournament.id, category.id, fixtureSeed, requestKey()],
    );
    const validation = await value(
      owner,
      'select public.validate_tournament_fixture($1,$2)',
      [organizationId, fixture.fixtureVersionId],
    );
    equal(
      validation.valid,
      true,
      `${format.code} genera un fixture mínimo compatible y válido`,
    );
    check(
      await count(
        admin,
        'select count(*) from public.tournament_matches where fixture_version_id=$1',
        [fixture.fixtureVersionId],
      ) > 0,
      `${format.code} materializa partidos sin violar foreign keys`,
    );
    equal(
      await count(
        admin,
        `select count(*)
         from public.tournament_competition_participants
         where participant_set_id=$1`,
        [frozen.participantSetId],
      ),
      format.teamCount,
      `${format.code} conserva el snapshot de equipos del tenant`,
    );
    if (formatIndex === 0) {
      await expectError(
        () => value(
          otherOwner,
          'select public.validate_tournament_fixture($1,$2)',
          [organizationId, fixture.fixtureVersionId],
        ),
        /TORNEOS_RESOURCE_FORBIDDEN/,
        'otro tenant no valida el fixture por UUID conocido',
      );
    }
  }

  equal(
    await count(owner, 'select count(*) from public.tournaments'),
    5,
    'el owner ve los cinco torneos históricos creados desde cero',
  );
  equal(
    await count(otherOwner, 'select count(*) from public.tournaments'),
    0,
    'RLS oculta los torneos a otro tenant',
  );
  equal(
    await count(memberless, 'select count(*) from public.tournaments'),
    0,
    'RLS oculta los torneos al usuario sin membresía',
  );
  equal(
    await count(
      admin,
      `select count(*)
       from (
         select 'tournament_sport_modalities'
         where not exists (select 1 from public.tournament_sport_modalities)
         union all
         select 'tournament_competition_formats'
         where not exists (select 1 from public.tournament_competition_formats)
       ) empty_catalogs`,
    ),
    0,
    'no quedan catálogos obligatorios vacíos',
  );

  console.log(`\nResultado baseline Torneos: ${checks - failures}/${checks} checks pasaron.\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(
      clients
        .filter((client) => !client.ended)
        .map((client) => client.end()),
    );
  });
