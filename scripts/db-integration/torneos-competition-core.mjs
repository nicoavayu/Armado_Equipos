#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = [
  '20260724233000_tournament_organization_workspaces.sql',
  '20260725120000_tournament_competition_core.sql',
].map((name) => path.join(ROOT, 'supabase', 'migrations_history', name));
const PORT = 55300 + Math.floor(Math.random() * 400);
const DATABASE = 'arma2_torneos_competition';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-competition-pg-'));

const USERS = {
  ownerA: '41000000-0000-4000-8000-000000000001',
  ownerB: '41000000-0000-4000-8000-000000000002',
  adminA: '41000000-0000-4000-8000-000000000003',
  collaboratorA: '41000000-0000-4000-8000-000000000004',
  outsider: '41000000-0000-4000-8000-000000000005',
  race: '41000000-0000-4000-8000-000000000006',
};
const COMPETITION_CAPABILITIES = [
  'seasons.read',
  'seasons.create',
  'seasons.update',
  'seasons.archive',
  'tournaments.read',
  'tournaments.create',
  'tournaments.update',
  'tournaments.change_status',
  'tournaments.archive',
  'categories.read',
  'categories.create',
  'categories.update',
  'categories.archive',
  'competition_rules.read',
  'competition_rules.update',
];

const postgres = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'password',
  port: PORT,
  persistent: false,
  onLog: () => {},
  onError: () => {},
});

const clients = [];
let checks = 0;
let failures = 0;

function ok(condition, label, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
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
    const value = String(error?.message || error);
    ok(pattern.test(value), label, `error inesperado: ${value}`);
  }
}

async function connect({ role = null, userId = null } = {}) {
  const client = new pg.Client({
    host: '127.0.0.1',
    port: PORT,
    user: 'postgres',
    password: 'password',
    database: DATABASE,
  });
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

async function createOrganization(client, name, slug, key) {
  return value(
    client,
    'select public.create_tournament_organization($1, $2, $3::uuid)',
    [name, slug, key],
  );
}

async function createSeason(client, organizationId, name, slug, key, dates = {}) {
  return value(
    client,
    `select public.create_tournament_season(
      $1, $2, $3, $4::date, $5::date, $6::uuid
    )`,
    [
      organizationId,
      name,
      slug,
      dates.start ?? null,
      dates.end ?? null,
      key,
    ],
  );
}

async function createTournament(
  client,
  organizationId,
  seasonId,
  name,
  slug,
  key,
  modality = 'football_7',
  format = 'league',
) {
  return value(
    client,
    `select public.create_tournament_with_defaults(
      $1, $2, $3, $4, null, $5, $6, 'open', null, null, $7::uuid
    )`,
    [organizationId, seasonId, name, slug, modality, format, key],
  );
}

async function setup() {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DATABASE);

  const admin = await connect();
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    set search_path = ''
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);

  for (const [name, id] of Object.entries(USERS)) {
    await admin.query(
      'insert into auth.users (id, email) values ($1, $2)',
      [id, `${name}@competition.local`],
    );
  }
  for (const migration of MIGRATIONS) {
    await admin.query(fs.readFileSync(migration, 'utf8'));
  }
  return admin;
}

async function main() {
  console.log('Arma2 Torneos · competition core/RLS integration');
  const admin = await setup();
  const ownerA = await connect({ role: 'authenticated', userId: USERS.ownerA });
  const ownerB = await connect({ role: 'authenticated', userId: USERS.ownerB });
  const adminA = await connect({ role: 'authenticated', userId: USERS.adminA });
  const collaboratorA = await connect({
    role: 'authenticated',
    userId: USERS.collaboratorA,
  });
  const outsider = await connect({ role: 'authenticated', userId: USERS.outsider });
  const anonymous = await connect({ role: 'anon' });

  console.log('\nEsquema, catálogos y permisos mínimos');
  eq(
    await count(
      admin,
      `select count(*) from public.tournament_sport_modalities`,
    ),
    6,
    'el catálogo contiene las seis modalidades iniciales',
  );
  eq(
    await count(
      admin,
      `select count(*) from public.tournament_competition_formats`,
    ),
    5,
    'el catálogo contiene los cinco formatos iniciales',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'tournament_sport_modalities',
           'tournament_competition_formats',
           'tournament_seasons',
           'tournaments',
           'tournament_categories',
           'tournament_scoring_rules',
           'tournament_tiebreak_rules',
           'tournament_discipline_rules',
           'user_tournament_context_preferences'
         )
         and table_type = 'BASE TABLE'`,
    ),
    9,
    'las nueve tablas del núcleo se aplican desde cero',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from pg_class relation
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'public'
         and relation.relname in (
           'tournament_sport_modalities',
           'tournament_competition_formats',
           'tournament_seasons',
           'tournaments',
           'tournament_categories',
           'tournament_scoring_rules',
           'tournament_tiebreak_rules',
           'tournament_discipline_rules',
           'user_tournament_context_preferences'
         )
         and relation.relrowsecurity`,
    ),
    9,
    'todas las tablas nuevas tienen RLS habilitado',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from information_schema.table_privileges
       where table_schema = 'public'
         and table_name in (
           'tournament_sport_modalities',
           'tournament_competition_formats',
           'tournament_seasons',
           'tournaments',
           'tournament_categories',
           'tournament_scoring_rules',
           'tournament_tiebreak_rules',
           'tournament_discipline_rules',
           'user_tournament_context_preferences'
         )
         and (
           grantee = 'anon'
           or (grantee = 'authenticated' and privilege_type <> 'SELECT')
         )`,
    ),
    0,
    'anon no recibe grants y authenticated conserva sólo lectura directa',
  );
  await expectError(
    () => value(
      anonymous,
      'select public.get_tournament_competition_context($1)',
      ['42000000-0000-4000-8000-000000000099'],
    ),
    /permission denied|TORNEOS_AUTH_REQUIRED/i,
    'anon no puede ejecutar el contexto competitivo',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from information_schema.routine_privileges
       where specific_schema = 'public'
         and routine_name in (
           'normalize_tournament_competition_slug',
           'is_valid_tournament_format_settings',
           'protect_tournament_competition_scope',
           'tournament_registration_checklist',
           'create_tournament_season',
           'update_tournament_season',
           'create_tournament_with_defaults',
           'update_tournament_configuration',
           'save_tournament_category',
           'change_tournament_status',
           'set_active_tournament_context',
           'get_tournament_competition_context'
         )
         and grantee = 'PUBLIC'`,
    ),
    0,
    'todas las funciones competitivas revocan EXECUTE a PUBLIC',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname in (
           'tournament_registration_checklist',
           'create_tournament_season',
           'update_tournament_season',
           'create_tournament_with_defaults',
           'update_tournament_configuration',
           'save_tournament_category',
           'change_tournament_status',
           'set_active_tournament_context',
           'get_tournament_competition_context'
         )
         and procedure.prosecdef
         and 'search_path=""' = any(procedure.proconfig)
         and procedure.prosrc like '%auth.uid()%'
         and procedure.prosrc !~* '\\mexecute\\M'`,
    ),
    9,
    'las nueve SECURITY DEFINER fijan search_path, validan auth.uid y no usan SQL dinámico',
  );
  eq(
    await value(
      admin,
      `select public.is_valid_tournament_format_settings(
        'league',
        '{"rounds":"single","qualifiers":0}'::jsonb
      )`,
    ),
    true,
    'liga acepta únicamente su configuración completa',
  );
  eq(
    await value(
      admin,
      `select public.is_valid_tournament_format_settings(
        'league',
        '{"rounds":"single","qualifiers":0,"groupCount":2}'::jsonb
      )`,
    ),
    false,
    'liga rechaza opciones pertenecientes a otro formato',
  );
  eq(
    await value(
      admin,
      `select public.is_valid_tournament_format_settings(
        'groups',
        '{"groupCount":2,"qualifiersPerGroup":1}'::jsonb
      )`,
    ),
    false,
    'grupos rechaza una configuración incompleta',
  );
  eq(
    await value(
      admin,
      `select public.is_valid_tournament_format_settings(
        'groups',
        '{"groupCount":"dos","qualifiersPerGroup":1,"rounds":"single"}'::jsonb
      )`,
    ),
    false,
    'los tipos inválidos de formato fallan de forma cerrada',
  );
  await expectError(
    () => anonymous.query(
      `update public.tournament_sport_modalities
       set team_size = 11
       where code = 'football_7'`,
    ),
    /permission denied/i,
    'los catálogos no se pueden modificar desde el cliente',
  );
  for (const role of ['owner', 'admin']) {
    const roleCapabilities = await value(
      admin,
      'select public.tournament_role_capabilities($1)',
      [role],
    );
    eq(
      JSON.stringify(roleCapabilities.filter(
        (capability) => COMPETITION_CAPABILITIES.includes(capability),
      ).sort()),
      JSON.stringify([...COMPETITION_CAPABILITIES].sort()),
      `${role} conserva el contrato competitivo completo y exacto`,
    );
  }
  const collaboratorCapabilities = await value(
    admin,
    "select public.tournament_role_capabilities('collaborator')",
  );
  eq(
    JSON.stringify(collaboratorCapabilities.filter(
      (capability) => COMPETITION_CAPABILITIES.includes(capability),
    ).sort()),
    JSON.stringify([
      'seasons.read',
      'tournaments.read',
      'categories.read',
      'competition_rules.read',
    ].sort()),
    'collaborator conserva sólo las capabilities competitivas de lectura',
  );
  eq(
    JSON.stringify(await value(
      admin,
      "select public.tournament_role_capabilities('unknown')",
    )),
    JSON.stringify([]),
    'un rol desconocido falla de forma cerrada en SQL',
  );

  console.log('\nTenants, temporadas y capabilities');
  const createdA = await createOrganization(
    ownerA,
    'Liga Devoto',
    'liga-devoto-core',
    '42000000-0000-4000-8000-000000000001',
  );
  const createdB = await createOrganization(
    ownerB,
    'Copa Potrero',
    'copa-potrero-core',
    '42000000-0000-4000-8000-000000000002',
  );
  const organizationA = createdA.organization.id;
  const organizationB = createdB.organization.id;

  await admin.query(
    `insert into public.tournament_organization_members (
      organization_id, user_id, role, status, joined_at
    ) values
      ($1, $2, 'admin', 'active', now()),
      ($1, $3, 'collaborator', 'active', now())`,
    [organizationA, USERS.adminA, USERS.collaboratorA],
  );

  const seasonA = await createSeason(
    ownerA,
    organizationA,
    'Apertura 2027',
    'apertura-2027',
    '42000000-0000-4000-8000-000000000010',
    { start: '2027-03-01', end: '2027-07-30' },
  );
  const seasonB = await createSeason(
    ownerB,
    organizationB,
    'Apertura 2027',
    'apertura-2027',
    '42000000-0000-4000-8000-000000000011',
  );
  eq(seasonA.slug, seasonB.slug, 'el mismo slug se permite en organizaciones distintas');
  const repeatedSeason = await createSeason(
    ownerA,
    organizationA,
    'Nombre ignorado',
    'otro-slug',
    '42000000-0000-4000-8000-000000000010',
  );
  eq(repeatedSeason.id, seasonA.id, 'crear temporada es idempotente');
  await expectError(
    () => createSeason(
      ownerA,
      organizationA,
      'Otro Apertura',
      'apertura-2027',
      '42000000-0000-4000-8000-000000000012',
    ),
    /TORNEOS_SEASON_SLUG_TAKEN/,
    'un slug repetido se rechaza dentro de la organización',
  );
  await expectError(
    () => createSeason(
      ownerA,
      organizationA,
      'Fechas imposibles',
      'fechas-imposibles',
      '42000000-0000-4000-8000-000000000013',
      { start: '2027-08-01', end: '2027-07-01' },
    ),
    /TORNEOS_INVALID_DATES/,
    'la fecha final no puede preceder a la inicial',
  );
  await expectError(
    () => createSeason(
      collaboratorA,
      organizationA,
      'Clausura 2027',
      'clausura-2027',
      '42000000-0000-4000-8000-000000000014',
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'collaborator no puede crear temporadas',
  );
  const adminSeason = await createSeason(
    adminA,
    organizationA,
    'Clausura 2027',
    'clausura-2027',
    '42000000-0000-4000-8000-000000000015',
  );
  ok(Boolean(adminSeason.id), 'admin puede crear temporadas en su organización');
  await value(
    ownerA,
    `select public.update_tournament_season(
      $1, $2, null, null, null, null, null, true, false
    )`,
    [organizationA, seasonA.id],
  );
  eq(
    await value(
      admin,
      'select start_date is null from public.tournament_seasons where id = $1',
      [seasonA.id],
    ),
    true,
    'una fecha opcional de temporada se puede limpiar explícitamente',
  );
  await value(
    ownerA,
    `select public.update_tournament_season(
      $1, $2, null, null, '2027-03-01', null, null, false, false
    )`,
    [organizationA, seasonA.id],
  );

  console.log('\nCreación atómica y configuración');
  await admin.query(`
    create function public.reject_competition_default_for_test()
    returns trigger
    language plpgsql
    set search_path = ''
    as $$
    begin
      raise exception 'TEST_DEFAULT_FAILURE';
    end;
    $$;
    create trigger reject_competition_default_for_test
    before insert on public.tournament_scoring_rules
    for each row execute function public.reject_competition_default_for_test();
  `);
  await expectError(
    () => createTournament(
      ownerA,
      organizationA,
      seasonA.id,
      'Rollback puntuación',
      'rollback-puntuacion',
      '42000000-0000-4000-8000-000000000018',
    ),
    /TEST_DEFAULT_FAILURE/,
    'un fallo al crear puntuación revierte el torneo completo',
  );
  await admin.query(`
    drop trigger reject_competition_default_for_test
      on public.tournament_scoring_rules;
    drop function public.reject_competition_default_for_test();
  `);
  eq(
    await count(
      admin,
      `select count(*) from public.tournaments
       where organization_id = $1
         and creation_key = $2`,
      [organizationA, '42000000-0000-4000-8000-000000000018'],
    ),
    0,
    'el fallo temprano no deja torneo parcial',
  );

  await admin.query(`
    create function public.reject_competition_context_for_test()
    returns trigger
    language plpgsql
    set search_path = ''
    as $$
    begin
      raise exception 'TEST_CONTEXT_FAILURE';
    end;
    $$;
    create trigger reject_competition_context_for_test
    before insert or update on public.user_tournament_context_preferences
    for each row execute function public.reject_competition_context_for_test();
  `);
  await expectError(
    () => createTournament(
      ownerA,
      organizationA,
      seasonA.id,
      'Rollback contexto',
      'rollback-contexto',
      '42000000-0000-4000-8000-000000000019',
    ),
    /TEST_CONTEXT_FAILURE/,
    'un fallo final al seleccionar contexto revierte torneo y defaults',
  );
  await admin.query(`
    drop trigger reject_competition_context_for_test
      on public.user_tournament_context_preferences;
    drop function public.reject_competition_context_for_test();
  `);
  eq(
    await count(
      admin,
      `select count(*) from public.tournaments
       where organization_id = $1
         and creation_key = $2`,
      [organizationA, '42000000-0000-4000-8000-000000000019'],
    ),
    0,
    'el fallo tardío tampoco deja datos parciales',
  );

  await expectError(
    () => createTournament(
      ownerA,
      organizationA,
      seasonA.id,
      'Modalidad inexistente',
      'modalidad-inexistente',
      '42000000-0000-4000-8000-000000000017',
      'football_10',
    ),
    /TORNEOS_INVALID_MODALITY/,
    'una modalidad fuera del catálogo sigue siendo rechazada',
  );

  const tournamentA = await createTournament(
    ownerA,
    organizationA,
    seasonA.id,
    'Copa Apertura',
    'copa-apertura',
    '42000000-0000-4000-8000-000000000020',
  );
  eq(
    await count(
      admin,
      'select count(*) from public.tournament_scoring_rules where tournament_id = $1',
      [tournamentA.id],
    ),
    1,
    'la creación atómica incluye puntuación',
  );
  eq(
    await count(
      admin,
      'select count(*) from public.tournament_tiebreak_rules where tournament_id = $1',
      [tournamentA.id],
    ),
    4,
    'la creación atómica incluye desempates ordenados',
  );
  eq(
    await count(
      admin,
      'select count(*) from public.tournament_discipline_rules where tournament_id = $1',
      [tournamentA.id],
    ),
    1,
    'la creación atómica incluye disciplina',
  );
  const repeatedTournament = await createTournament(
    ownerA,
    organizationA,
    seasonA.id,
    'Nombre ignorado',
    'otro-slug',
    '42000000-0000-4000-8000-000000000020',
  );
  eq(repeatedTournament.id, tournamentA.id, 'crear torneo es idempotente');
  await expectError(
    () => createTournament(
      ownerA,
      organizationA,
      seasonB.id,
      'Cruce forjado',
      'cruce-forjado',
      '42000000-0000-4000-8000-000000000021',
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'una temporada de otro tenant no puede vincularse',
  );
  await expectError(
    () => value(
      collaboratorA,
      'select public.update_tournament_configuration($1, $2, $3::jsonb)',
      [organizationA, tournamentA.id, JSON.stringify({ name: 'Alterado' })],
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'collaborator no puede editar configuración',
  );
  await value(
    ownerA,
    'select public.update_tournament_configuration($1, $2, $3::jsonb)',
    [
      organizationA,
      tournamentA.id,
      JSON.stringify({
        scoring: { pointsWin: 2, pointsDraw: 1, pointsLoss: 0 },
        tiebreaks: ['head_to_head', 'goal_difference', 'goals_for'],
        discipline: {
          yellowsForSuspension: 3,
          suspensionMatches: 1,
          fairPlayEnabled: true,
          yellowFairPlayPoints: 1,
          redFairPlayPoints: 4,
        },
      }),
    ],
  );
  eq(
    await value(
      admin,
      'select points_win from public.tournament_scoring_rules where tournament_id = $1',
      [tournamentA.id],
    ),
    2,
    'las reglas se actualizan atómicamente',
  );
  eq(
    await value(
      admin,
      `select string_agg(criterion, ',' order by sort_order)
       from public.tournament_tiebreak_rules where tournament_id = $1`,
      [tournamentA.id],
    ),
    'head_to_head,goal_difference,goals_for',
    'el orden de desempate se persiste exactamente',
  );
  await expectError(
    () => value(
      ownerA,
      'select public.update_tournament_configuration($1, $2, $3::jsonb)',
      [
        organizationA,
        tournamentA.id,
        JSON.stringify({ tiebreaks: ['goals_for', 'goals_for'] }),
      ],
    ),
    /TORNEOS_INVALID_TIEBREAKS/,
    'los desempates duplicados se rechazan',
  );
  await expectError(
    () => value(
      ownerA,
      'select public.update_tournament_configuration($1, $2, $3::jsonb)',
      [
        organizationA,
        tournamentA.id,
        JSON.stringify({
          competitionFormat: 'league',
          formatSettings: {
            rounds: 'single',
            qualifiers: 0,
            groupCount: 2,
          },
        }),
      ],
    ),
    /TORNEOS_INVALID_TOURNAMENT/,
    'cada formato rechaza opciones incompatibles o antiguas',
  );
  await expectError(
    () => value(
      ownerA,
      'select public.update_tournament_configuration($1, $2, $3::jsonb)',
      [
        organizationA,
        tournamentA.id,
        JSON.stringify({ scoring: { futurePoints: 99 } }),
      ],
    ),
    /TORNEOS_INVALID_SCORING/,
    'puntuación rechaza claves desconocidas',
  );
  await expectError(
    () => value(
      ownerA,
      'select public.update_tournament_configuration($1, $2, $3::jsonb)',
      [
        organizationA,
        tournamentA.id,
        JSON.stringify({ discipline: { futureSanction: true } }),
      ],
    ),
    /TORNEOS_INVALID_DISCIPLINE/,
    'disciplina rechaza configuraciones desconocidas',
  );

  console.log('\nCategorías y apertura controlada');
  await expectError(
    () => value(
      ownerA,
      'select public.change_tournament_status($1, $2, $3)',
      [organizationA, tournamentA.id, 'registration'],
    ),
    /TORNEOS_REGISTRATION_INCOMPLETE/,
    'no abre inscripciones sin una categoría activa',
  );
  const categoryA = await value(
    ownerA,
    `select public.save_tournament_category(
      $1, $2, null, 'Primera', 'primera', null, 0,
      null, null, null, null, null, 'active'
    )`,
    [organizationA, tournamentA.id],
  );
  ok(Boolean(categoryA.id), 'owner crea una categoría activa');
  await expectError(
    () => value(
      ownerA,
      `select public.save_tournament_category(
        $1, $2, null, 'Primera duplicada', 'primera', null, 1,
        null, null, null, null, null, 'active'
      )`,
      [organizationA, tournamentA.id],
    ),
    /TORNEOS_CATEGORY_SLUG_TAKEN/,
    'el slug de categoría es único dentro del torneo',
  );
  const tournamentB = await createTournament(
    ownerB,
    organizationB,
    seasonB.id,
    'Copa B',
    'copa-b',
    '42000000-0000-4000-8000-000000000022',
  );
  await expectError(
    () => value(
      ownerA,
      `select public.save_tournament_category(
        $1, $2, null, 'Ajena', 'ajena', null, 0,
        null, null, null, null, null, 'active'
      )`,
      [organizationA, tournamentB.id],
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'cambiar tournament_id no concede acceso cross-tenant',
  );
  const categoryB1 = await value(
    ownerB,
    `select public.save_tournament_category(
      $1, $2, null, 'Primera B', 'primera-b', null, 0,
      null, null, null, null, null, 'active'
    )`,
    [organizationB, tournamentB.id],
  );
  await value(
    ownerB,
    `select public.save_tournament_category(
      $1, $2, null, 'Segunda B', 'segunda-b', null, 1,
      null, null, null, null, null, 'active'
    )`,
    [organizationB, tournamentB.id],
  );
  const categoryB3 = await value(
    ownerB,
    `select public.save_tournament_category(
      $1, $2, null, 'Tercera B', 'tercera-b', null, 2,
      null, null, null, null, null, 'active'
    )`,
    [organizationB, tournamentB.id],
  );
  await value(
    ownerB,
    `select public.save_tournament_category(
      $1, $2, $3, 'Tercera B', 'tercera-b', null, 0,
      null, null, null, null, null, 'active'
    )`,
    [organizationB, tournamentB.id, categoryB3.id],
  );
  eq(
    await value(
      admin,
      `select string_agg(name || ':' || sort_order, ',' order by sort_order)
       from public.tournament_categories
       where tournament_id = $1 and status = 'active'`,
      [tournamentB.id],
    ),
    'Tercera B:0,Primera B:1,Segunda B:2',
    'reordenar una categoría es una sola operación continua y transaccional',
  );
  ok(Boolean(categoryB1.id), 'las categorías del segundo tenant permanecen aisladas');

  await value(
    ownerA,
    'select public.update_tournament_configuration($1, $2, $3::jsonb)',
    [
      organizationA,
      tournamentA.id,
      JSON.stringify({
        tiebreaks: ['goal_difference', 'goals_for', 'fair_play'],
        discipline: { fairPlayEnabled: false },
      }),
    ],
  );
  await expectError(
    () => value(
      ownerA,
      'select public.change_tournament_status($1, $2, $3)',
      [organizationA, tournamentA.id, 'registration'],
    ),
    /TORNEOS_REGISTRATION_INCOMPLETE/,
    'fair play no puede usarse como desempate si su regla está deshabilitada',
  );
  await value(
    ownerA,
    'select public.update_tournament_configuration($1, $2, $3::jsonb)',
    [
      organizationA,
      tournamentA.id,
      JSON.stringify({ discipline: { fairPlayEnabled: true } }),
    ],
  );

  await admin.query(
    `update public.tournament_tiebreak_rules
     set sort_order = 4
     where tournament_id = $1 and sort_order = 3`,
    [tournamentA.id],
  );
  eq(
    (await value(
      ownerA,
      'select public.tournament_registration_checklist($1, $2)',
      [organizationA, tournamentA.id],
    )).ready,
    false,
    'el checklist rechaza una secuencia de desempates con huecos',
  );
  await admin.query(
    `update public.tournament_tiebreak_rules
     set sort_order = 3
     where tournament_id = $1 and sort_order = 4`,
    [tournamentA.id],
  );

  const opened = await value(
    ownerA,
    'select public.change_tournament_status($1, $2, $3)',
    [organizationA, tournamentA.id, 'registration'],
  );
  eq(opened.status, 'registration', 'un torneo completo pasa a registration');
  await expectError(
    () => value(
      ownerA,
      `select public.save_tournament_category(
        $1, $2, $3, 'Primera', 'primera', null, 0,
        null, null, null, null, null, 'archived'
      )`,
      [organizationA, tournamentA.id, categoryA.id],
    ),
    /TORNEOS_CATEGORY_REQUIRED/,
    'no se archiva la última categoría durante registration',
  );
  const drafted = await value(
    ownerA,
    'select public.change_tournament_status($1, $2, $3)',
    [organizationA, tournamentA.id, 'draft'],
  );
  eq(drafted.status, 'draft', 'registration puede volver a draft en esta fase');
  await expectError(
    () => value(
      ownerA,
      'select public.change_tournament_status($1, $2, $3)',
      [organizationA, tournamentA.id, 'active'],
    ),
    /TORNEOS_INVALID_TOURNAMENT_TRANSITION/,
    'active y completed no se habilitan manualmente',
  );

  console.log('\nContexto autoritativo y RLS cross-tenant');
  const collaboratorContext = await value(
    collaboratorA,
    'select public.get_tournament_competition_context($1)',
    [organizationA],
  );
  eq(collaboratorContext.tournaments.length, 1, 'collaborator puede consultar su tenant');
  await expectError(
    () => value(
      outsider,
      'select public.get_tournament_competition_context($1)',
      [organizationA],
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'un outsider no puede resolver el contexto',
  );
  eq(
    await count(
      ownerA,
      'select count(*) from public.tournaments where organization_id = $1',
      [organizationB],
    ),
    0,
    'RLS oculta torneos de otra organización',
  );
  await expectError(
    () => value(
      ownerA,
      'select public.set_active_tournament_context($1, $2, $3)',
      [
        organizationA,
        seasonA.id,
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ],
    ),
    /TORNEOS_CONTEXT_FORBIDDEN/,
    'una preferencia no puede señalar un torneo inexistente o ajeno',
  );
  await value(
    ownerA,
    'select public.set_active_tournament_context($1, $2, $3)',
    [organizationA, seasonA.id, tournamentA.id],
  );
  const restoredContext = await value(
    ownerA,
    'select public.get_tournament_competition_context($1)',
    [organizationA],
  );
  eq(
    restoredContext.preference.activeTournamentId,
    tournamentA.id,
    'el contexto válido se restaura desde backend',
  );

  console.log('\nArchivo, revocación y concurrencia');
  await value(
    ownerA,
    'select public.change_tournament_status($1, $2, $3)',
    [organizationA, tournamentA.id, 'archived'],
  );
  eq(
    await value(
      admin,
      `select active_tournament_id is null
       from public.user_tournament_context_preferences
       where user_id = $1 and organization_id = $2`,
      [USERS.ownerA, organizationA],
    ),
    true,
    'archivar limpia el torneo activo',
  );
  await expectError(
    () => createTournament(
      ownerA,
      organizationA,
      seasonA.id,
      'Nombre reintentado',
      'slug-reintentado',
      '42000000-0000-4000-8000-000000000020',
    ),
    /TORNEOS_IDEMPOTENCY_CONFLICT/,
    'reintentar una clave archivada no reactiva el torneo en contexto',
  );
  eq(
    await value(
      admin,
      `select active_tournament_id is null
       from public.user_tournament_context_preferences
       where user_id = $1 and organization_id = $2`,
      [USERS.ownerA, organizationA],
    ),
    true,
    'el reintento archivado conserva el contexto sin torneo',
  );
  const afterArchive = await value(
    ownerA,
    'select public.get_tournament_competition_context($1)',
    [organizationA],
  );
  eq(afterArchive.tournaments.length, 0, 'el contexto no devuelve torneos archivados');

  await value(
    ownerA,
    `select public.update_tournament_season(
      $1, $2, null, null, null, null, 'archived'
    )`,
    [organizationA, adminSeason.id],
  );
  await expectError(
    () => createSeason(
      adminA,
      organizationA,
      'Clausura reintentada',
      'clausura-reintentada',
      '42000000-0000-4000-8000-000000000015',
    ),
    /TORNEOS_IDEMPOTENCY_CONFLICT/,
    'reintentar una temporada archivada no la vuelve a seleccionar',
  );
  await expectError(
    () => createTournament(
      ownerA,
      organizationA,
      adminSeason.id,
      'Torneo tardío',
      'torneo-tardio',
      '42000000-0000-4000-8000-000000000023',
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'una temporada archivada no recibe torneos',
  );

  const raceOrganization = await createOrganization(
    await connect({ role: 'authenticated', userId: USERS.race }),
    'Liga Race',
    'liga-race-core',
    '42000000-0000-4000-8000-000000000030',
  );
  const raceClients = await Promise.all([
    connect({ role: 'authenticated', userId: USERS.race }),
    connect({ role: 'authenticated', userId: USERS.race }),
  ]);
  const raceResults = await Promise.all(raceClients.map((client) => createSeason(
    client,
    raceOrganization.organization.id,
    'Temporada Concurrente',
    'temporada-concurrente',
    '42000000-0000-4000-8000-000000000031',
  )));
  eq(raceResults[0].id, raceResults[1].id, 'la idempotencia resiste dos envíos concurrentes');
  eq(
    await count(
      admin,
      `select count(*) from public.tournament_seasons
       where organization_id = $1 and slug = 'temporada-concurrente'`,
      [raceOrganization.organization.id],
    ),
    1,
    'la concurrencia no crea temporadas parciales o duplicadas',
  );
  const concurrentTournamentResults = await Promise.all(
    raceClients.map((client) => createTournament(
      client,
      raceOrganization.organization.id,
      raceResults[0].id,
      'Copa Concurrente',
      'copa-concurrente',
      '42000000-0000-4000-8000-000000000032',
    )),
  );
  eq(
    concurrentTournamentResults[0].id,
    concurrentTournamentResults[1].id,
    'la creación atómica de torneo resiste doble envío concurrente',
  );
  eq(
    await count(
      admin,
      `select count(*) from public.tournaments
       where organization_id = $1 and slug = 'copa-concurrente'`,
      [raceOrganization.organization.id],
    ),
    1,
    'el doble envío conserva un solo torneo',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from public.tournament_tiebreak_rules
       where tournament_id = $1`,
      [concurrentTournamentResults[0].id],
    ),
    4,
    'el torneo concurrente conserva un único set completo de defaults',
  );

  const ownerBContextRace = await connect({
    role: 'authenticated',
    userId: USERS.ownerB,
  });
  await ownerB.query('begin');
  await value(
    ownerB,
    'select public.change_tournament_status($1, $2, $3)',
    [organizationB, tournamentB.id, 'archived'],
  );
  let contextRaceSettled = false;
  const contextRace = value(
    ownerBContextRace,
    'select public.set_active_tournament_context($1, $2, $3)',
    [organizationB, seasonB.id, tournamentB.id],
  )
    .then(() => null, (error) => error)
    .finally(() => {
      contextRaceSettled = true;
    });
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  eq(
    contextRaceSettled,
    false,
    'seleccionar contexto espera una transición de archivo concurrente',
  );
  await ownerB.query('commit');
  const contextRaceError = await contextRace;
  ok(
    /TORNEOS_CONTEXT_FORBIDDEN/.test(String(contextRaceError?.message || '')),
    'el archivo concurrente gana y el contexto no apunta al torneo archivado',
  );

  await admin.query(
    `update public.tournament_organization_members
     set status = 'removed'
     where organization_id = $1 and user_id = $2`,
    [organizationA, USERS.collaboratorA],
  );
  await expectError(
    () => value(
      collaboratorA,
      'select public.get_tournament_competition_context($1)',
      [organizationA],
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'un miembro removido pierde acceso inmediatamente',
  );
  await admin.query(
    `update public.tournament_organization_members
     set status = 'suspended'
     where organization_id = $1 and user_id = $2`,
    [organizationA, USERS.adminA],
  );
  await expectError(
    () => value(
      adminA,
      'select public.get_tournament_competition_context($1)',
      [organizationA],
    ),
    /TORNEOS_RESOURCE_FORBIDDEN/,
    'una membership suspendida también pierde acceso inmediatamente',
  );

  console.log(`\n${checks - failures}/${checks} verificaciones aprobadas.`);
  if (failures > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  await postgres.stop().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
