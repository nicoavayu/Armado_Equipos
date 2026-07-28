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
const MIGRATION = path.join(
  ROOT,
  'supabase',
  'migrations_history',
  '20260724233000_tournament_organization_workspaces.sql',
);
const PORT = 54800 + Math.floor(Math.random() * 500);
const DATABASE = 'arma2_torneos_workspaces';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-torneos-pg-'));

const USERS = {
  ownerA: '10000000-0000-4000-8000-000000000001',
  ownerB: '10000000-0000-4000-8000-000000000002',
  collaboratorA: '10000000-0000-4000-8000-000000000003',
  outsider: '10000000-0000-4000-8000-000000000004',
  adminA: '10000000-0000-4000-8000-000000000005',
  suspendedA: '10000000-0000-4000-8000-000000000006',
  contextRace: '10000000-0000-4000-8000-000000000007',
  idempotencyRace: '10000000-0000-4000-8000-000000000008',
  slugRaceA: '10000000-0000-4000-8000-000000000009',
  slugRaceB: '10000000-0000-4000-8000-000000000010',
  rateLimit: '10000000-0000-4000-8000-000000000011',
};

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
      [id, `${name}@torneos.local`],
    );
  }

  await admin.query(fs.readFileSync(MIGRATION, 'utf8'));
  return admin;
}

async function main() {
  console.log('Arma2 Torneos · workspaces/RLS integration');
  const admin = await setup();
  const anonymous = await connect({ role: 'anon' });
  const ownerA = await connect({ role: 'authenticated', userId: USERS.ownerA });
  const ownerB = await connect({ role: 'authenticated', userId: USERS.ownerB });
  const collaboratorA = await connect({
    role: 'authenticated',
    userId: USERS.collaboratorA,
  });
  const outsider = await connect({
    role: 'authenticated',
    userId: USERS.outsider,
  });
  const adminA = await connect({ role: 'authenticated', userId: USERS.adminA });
  const suspendedA = await connect({
    role: 'authenticated',
    userId: USERS.suspendedA,
  });

  console.log('\nAutenticación y creación atómica');
  await expectError(
    () => createOrganization(
      anonymous,
      'Liga Anónima',
      'liga-anonima',
      '20000000-0000-4000-8000-000000000001',
    ),
    /permission denied|TORNEOS_AUTH_REQUIRED/i,
    'un usuario anónimo no puede crear organizaciones',
  );
  await expectError(
    () => anonymous.query(
      'select public.is_tournament_organization_member($1)',
      ['20000000-0000-4000-8000-000000000099'],
    ),
    /permission denied/i,
    'anon no puede ejecutar helpers SECURITY DEFINER',
  );
  eq(
    await value(
      admin,
      "select has_function_privilege('anon', 'public.get_tournament_workspace_context()', 'execute')",
    ),
    false,
    'los RPCs no conservan EXECUTE público para anon',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from information_schema.table_privileges
       where table_schema = 'public'
         and table_name in (
           'tournament_organizations',
           'tournament_organization_members',
           'user_workspace_preferences'
         )
         and grantee = 'authenticated'
         and privilege_type = 'SELECT'`,
    ),
    3,
    'authenticated recibe únicamente SELECT en las tres tablas',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from information_schema.table_privileges
       where table_schema = 'public'
         and table_name in (
           'tournament_organizations',
           'tournament_organization_members',
           'user_workspace_preferences'
         )
         and (
           grantee = 'anon'
           or (
             grantee = 'authenticated'
             and privilege_type <> 'SELECT'
           )
         )`,
    ),
    0,
    'anon no tiene grants y authenticated no recibe escrituras directas',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from information_schema.routine_privileges
       where specific_schema = 'public'
         and routine_name in (
           'normalize_tournament_organization_slug',
           'tournament_role_capabilities',
           'is_tournament_organization_member',
           'has_tournament_organization_capability',
           'touch_tournament_workspace_updated_at',
           'protect_tournament_organization_owner',
           'create_tournament_organization',
           'is_tournament_organization_slug_available',
           'set_tournament_workspace_preference',
           'get_tournament_workspace_context',
           'update_tournament_organization'
         )
         and grantee = 'PUBLIC'`,
    ),
    0,
    'todas las funciones nuevas revocan el EXECUTE público por defecto',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.proname in (
           'is_tournament_organization_member',
           'has_tournament_organization_capability',
           'create_tournament_organization',
           'is_tournament_organization_slug_available',
           'set_tournament_workspace_preference',
           'get_tournament_workspace_context',
           'update_tournament_organization'
         )
         and procedure.prosecdef
         and 'search_path=""' = any(procedure.proconfig)
         and procedure.prosrc like '%auth.uid()%'
         and procedure.prosrc !~* '\\mexecute\\M'`,
    ),
    7,
    'las siete SECURITY DEFINER fijan search_path, usan auth.uid y no ejecutan SQL dinámico',
  );
  await expectError(
    () => createOrganization(
      ownerA,
      'Li',
      'liga-invalida',
      '20000000-0000-4000-8000-000000000002',
    ),
    /TORNEOS_INVALID_NAME/,
    'el backend rechaza nombres inválidos',
  );
  await expectError(
    () => createOrganization(
      ownerA,
      'Administración',
      'admin',
      '20000000-0000-4000-8000-000000000003',
    ),
    /TORNEOS_INVALID_SLUG/,
    'el backend rechaza slugs reservados',
  );
  eq(
    await value(
      ownerA,
      'select public.normalize_tournament_organization_slug($1)',
      ['Liga Núñez'],
    ),
    'liga-nunez',
    'el backend normaliza acentos de Liga Núñez igual que el frontend',
  );
  eq(
    await value(
      ownerA,
      'select public.normalize_tournament_organization_slug($1)',
      ['Fútbol 5'],
    ),
    'futbol-5',
    'el backend normaliza Fútbol 5 de forma consistente',
  );
  eq(
    await value(
      ownerA,
      'select public.normalize_tournament_organization_slug($1)',
      ['Copa +30'],
    ),
    'copa-30',
    'el backend normaliza caracteres especiales de Copa +30',
  );

  const keyA = '20000000-0000-4000-8000-000000000010';
  const createdA = await createOrganization(ownerA, 'Liga Devoto', 'Liga Devoto', keyA);
  const organizationA = createdA.organization.id;
  eq(createdA.organization.slug, 'liga-devoto', 'el slug se normaliza en backend');
  eq(createdA.membership.role, 'owner', 'el creador recibe el rol owner');
  eq(
    createdA.preference.activeOrganizationId,
    organizationA,
    'la organización creada queda activa',
  );
  eq(
    await count(
      admin,
      'select count(*) from public.tournament_organization_members where organization_id = $1 and role = $2 and status = $3',
      [organizationA, 'owner', 'active'],
    ),
    1,
    'la organización nace con exactamente un owner activo',
  );

  const repeatedA = await createOrganization(
    ownerA,
    'Nombre ignorado por idempotencia',
    'otro-slug',
    keyA,
  );
  eq(repeatedA.organization.id, organizationA, 'reintentar con la misma clave es idempotente');
  eq(
    await count(
      admin,
      'select count(*) from public.tournament_organizations where created_by = $1',
      [USERS.ownerA],
    ),
    1,
    'la idempotencia evita organizaciones duplicadas',
  );
  eq(
    await value(
      ownerA,
      'select public.is_tournament_organization_slug_available($1)',
      ['liga-devoto'],
    ),
    false,
    'la disponibilidad informa que un slug existente está ocupado',
  );
  eq(
    await value(
      ownerA,
      'select public.is_tournament_organization_slug_available($1)',
      ['liga-nueva'],
    ),
    true,
    'la disponibilidad acepta un slug válido libre',
  );

  const createdB = await createOrganization(
    ownerB,
    'Copa El Potrero',
    'copa-el-potrero',
    '20000000-0000-4000-8000-000000000011',
  );
  const organizationB = createdB.organization.id;
  await expectError(
    () => createOrganization(
      ownerA,
      'Copa duplicada',
      'copa-el-potrero',
      '20000000-0000-4000-8000-000000000012',
    ),
    /TORNEOS_SLUG_TAKEN/,
    'un slug duplicado se rechaza con un error controlado',
  );
  eq(
    await count(
      admin,
      'select count(*) from public.tournament_organizations where created_by = $1',
      [USERS.ownerA],
    ),
    1,
    'un error transaccional no deja una organización parcial',
  );

  await admin.query(
    `insert into public.tournament_organization_members
      (organization_id, user_id, role, status, joined_at)
     values
      ($1, $2, 'collaborator', 'active', now()),
      ($1, $3, 'admin', 'active', now()),
      ($1, $4, 'collaborator', 'active', now())`,
    [organizationA, USERS.collaboratorA, USERS.adminA, USERS.suspendedA],
  );

  console.log('\nRLS y aislamiento cross-tenant');
  eq(
    await count(ownerA, 'select count(*) from public.tournament_organizations'),
    1,
    'owner A sólo puede enumerar su organización',
  );
  eq(
    await count(ownerB, 'select count(*) from public.tournament_organizations'),
    1,
    'owner B sólo puede enumerar su organización',
  );
  eq(
    await count(
      ownerA,
      'select count(*) from public.tournament_organizations where id = $1',
      [organizationB],
    ),
    0,
    'conocer el UUID de otra organización no concede lectura',
  );
  eq(
    await count(
      outsider,
      'select count(*) from public.tournament_organizations where id in ($1, $2)',
      [organizationA, organizationB],
    ),
    0,
    'un usuario sin membresía no puede enumerar UUIDs',
  );
  eq(
    await count(
      collaboratorA,
      `select count(*)
       from public.tournament_organizations organization
       join public.tournament_organization_members membership
         on membership.organization_id = organization.id`,
    ),
    4,
    'los joins sólo devuelven miembros del tenant autorizado',
  );
  await expectError(
    () => ownerA.query(
      `insert into public.tournament_organization_members
        (organization_id, user_id, role, status, joined_at)
       values ($1, $2, 'owner', 'active', now())`,
      [organizationB, USERS.ownerA],
    ),
    /permission denied|row-level security/i,
    'el cliente no puede falsificar una membresía',
  );
  await expectError(
    () => collaboratorA.query(
      "update public.tournament_organizations set name = 'Hack' where id = $1",
      [organizationA],
    ),
    /permission denied|row-level security/i,
    'las escrituras directas están cerradas incluso dentro del tenant',
  );
  await expectError(
    () => ownerA.query(
      `insert into public.tournament_organizations
        (name, slug, created_by, creation_key)
       values ('Sin owner', 'sin-owner', $1, $2)`,
      [
        USERS.ownerA,
        '20000000-0000-4000-8000-000000000099',
      ],
    ),
    /permission denied|row-level security/i,
    'el cliente no puede crear una organización sin owner por escritura directa',
  );
  await expectError(
    () => admin.query(
      "update public.tournament_organizations set logo_path = 'data:image/svg+xml,bad' where id = $1",
      [organizationA],
    ),
    /tournament_organizations_logo_path_check/i,
    'logo_path rechaza esquemas y payloads no relativos',
  );
  await admin.query(
    "update public.tournament_organizations set logo_path = 'torneos/logos/organization-a.png' where id = $1",
    [organizationA],
  );
  eq(
    await value(
      admin,
      'select logo_path from public.tournament_organizations where id = $1',
      [organizationA],
    ),
    'torneos/logos/organization-a.png',
    'logo_path acepta una ruta de storage relativa y acotada',
  );

  console.log('\nCapacidades y protección del owner');
  await expectError(
    () => collaboratorA.query(
      'select public.update_tournament_organization($1, $2, null, null)',
      [organizationA, 'Nombre alterado'],
    ),
    /TORNEOS_ORGANIZATION_FORBIDDEN/,
    'collaborator no puede editar la organización',
  );
  const adminUpdate = await value(
    adminA,
    'select public.update_tournament_organization($1, $2, null, null)',
    [organizationA, 'Liga Devoto Renovada'],
  );
  eq(adminUpdate.name, 'Liga Devoto Renovada', 'admin puede editar información operativa');
  await expectError(
    () => adminA.query(
      "select public.update_tournament_organization($1, null, null, 'archived')",
      [organizationA],
    ),
    /TORNEOS_ARCHIVE_FORBIDDEN/,
    'admin no puede archivar la organización',
  );
  await expectError(
    () => admin.query(
      `update public.tournament_organization_members
       set role = 'collaborator'
       where organization_id = $1 and role = 'owner'`,
      [organizationA],
    ),
    /TORNEOS_ACTIVE_OWNER_REQUIRED/,
    'ni una escritura privilegiada puede degradar al owner sin transferencia',
  );
  await expectError(
    () => admin.query(
      `delete from public.tournament_organization_members
       where organization_id = $1 and role = 'owner'`,
      [organizationA],
    ),
    /TORNEOS_ACTIVE_OWNER_REQUIRED/,
    'la organización no puede quedar sin owner',
  );

  console.log('\nPreferencias y revocación');
  const collaboratorPreference = await value(
    collaboratorA,
    "select public.set_tournament_workspace_preference('tournament_organization', $1)",
    [organizationA],
  );
  eq(
    collaboratorPreference.activeOrganizationId,
    organizationA,
    'una membresía activa puede establecer su workspace',
  );
  await expectError(
    () => outsider.query(
      "select public.set_tournament_workspace_preference('tournament_organization', $1)",
      [organizationA],
    ),
    /TORNEOS_WORKSPACE_FORBIDDEN/,
    'un usuario sin membresía no puede activar un workspace ajeno',
  );
  await expectError(
    () => ownerA.query(
      "select public.set_tournament_workspace_preference('tournament_organization', $1)",
      [organizationB],
    ),
    /TORNEOS_WORKSPACE_FORBIDDEN/,
    'reemplazar organization_id en el request no cruza tenants',
  );

  await admin.query(
    `update public.tournament_organization_members
     set status = 'removed'
     where organization_id = $1 and user_id = $2`,
    [organizationA, USERS.collaboratorA],
  );
  const revokedContext = await value(
    collaboratorA,
    'select public.get_tournament_workspace_context()',
  );
  eq(
    revokedContext.preference.workspaceType,
    'personal',
    'una preferencia vieja se descarta tras revocar la membresía',
  );
  eq(
    revokedContext.organizations.length,
    0,
    'el usuario revocado deja de ver la organización',
  );
  eq(
    await count(
      collaboratorA,
      'select count(*) from public.tournament_organization_members where organization_id = $1',
      [organizationA],
    ),
    0,
    'RLS bloquea lecturas posteriores a la revocación',
  );

  await value(
    suspendedA,
    "select public.set_tournament_workspace_preference('tournament_organization', $1)",
    [organizationA],
  );
  await admin.query(
    `update public.tournament_organization_members
     set status = 'suspended'
     where organization_id = $1 and user_id = $2`,
    [organizationA, USERS.suspendedA],
  );
  const suspendedContext = await value(
    suspendedA,
    'select public.get_tournament_workspace_context()',
  );
  eq(
    suspendedContext.preference.workspaceType,
    'personal',
    'una membresía suspendida pierde inmediatamente su workspace',
  );
  eq(
    suspendedContext.organizations.length,
    0,
    'una membresía suspendida no conserva organizaciones visibles',
  );

  const outsiderContext = await value(
    outsider,
    'select public.get_tournament_workspace_context()',
  );
  eq(outsiderContext.organizations.length, 0, 'el usuario D comienza sin organizaciones');
  eq(
    outsiderContext.preference.workspaceType,
    'personal',
    'el fallback seguro es Arma2 personal',
  );

  console.log('\nArchivo de organización');
  const archived = await value(
    ownerB,
    "select public.update_tournament_organization($1, null, null, 'archived')",
    [organizationB],
  );
  eq(archived.status, 'archived', 'owner puede archivar su organización');
  const ownerBContext = await value(
    ownerB,
    'select public.get_tournament_workspace_context()',
  );
  eq(ownerBContext.organizations.length, 0, 'una organización archivada sale del selector');
  eq(
    ownerBContext.preference.workspaceType,
    'personal',
    'archivar restablece la preferencia personal',
  );

  console.log('\nConcurrencia e idempotencia');
  const contextRaceClients = await Promise.all([
    connect({ role: 'authenticated', userId: USERS.contextRace }),
    connect({ role: 'authenticated', userId: USERS.contextRace }),
  ]);
  const contextRaceResults = await Promise.allSettled(
    contextRaceClients.map((client) => value(
      client,
      'select public.get_tournament_workspace_context()',
    )),
  );
  eq(
    contextRaceResults.filter((result) => result.status === 'fulfilled').length,
    2,
    'dos inicializaciones concurrentes de preferencia son idempotentes',
  );

  const idempotencyRaceClients = await Promise.all([
    connect({ role: 'authenticated', userId: USERS.idempotencyRace }),
    connect({ role: 'authenticated', userId: USERS.idempotencyRace }),
  ]);
  const sharedKey = '30000000-0000-4000-8000-000000000001';
  const idempotencyResults = await Promise.allSettled(
    idempotencyRaceClients.map((client) => createOrganization(
      client,
      'Liga Idempotente',
      'liga-idempotente',
      sharedKey,
    )),
  );
  eq(
    idempotencyResults.filter((result) => result.status === 'fulfilled').length,
    2,
    'dos creaciones simultáneas con la misma clave completan sin error',
  );
  eq(
    new Set(
      idempotencyResults
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value.organization.id),
    ).size,
    1,
    'la misma clave concurrente devuelve una única organización',
  );

  const slugRaceClients = await Promise.all([
    connect({ role: 'authenticated', userId: USERS.slugRaceA }),
    connect({ role: 'authenticated', userId: USERS.slugRaceB }),
  ]);
  const slugRaceResults = await Promise.allSettled([
    createOrganization(
      slugRaceClients[0],
      'Copa Concurrente A',
      'copa-concurrente',
      '30000000-0000-4000-8000-000000000002',
    ),
    createOrganization(
      slugRaceClients[1],
      'Copa Concurrente B',
      'copa-concurrente',
      '30000000-0000-4000-8000-000000000003',
    ),
  ]);
  eq(
    slugRaceResults.filter((result) => result.status === 'fulfilled').length,
    1,
    'dos creaciones con el mismo slug producen un único ganador',
  );
  eq(
    slugRaceResults.filter((result) => (
      result.status === 'rejected'
      && /TORNEOS_SLUG_TAKEN/.test(String(result.reason?.message))
    )).length,
    1,
    'la colisión concurrente de slug conserva el error controlado',
  );

  const concurrentOwnerClients = await Promise.all([connect(), connect()]);
  const ownerMutationResults = await Promise.allSettled([
    concurrentOwnerClients[0].query(
      `update public.tournament_organization_members
       set status = 'suspended'
       where organization_id = $1 and role = 'owner'`,
      [organizationA],
    ),
    concurrentOwnerClients[1].query(
      `delete from public.tournament_organization_members
       where organization_id = $1 and role = 'owner'`,
      [organizationA],
    ),
  ]);
  eq(
    ownerMutationResults.filter((result) => (
      result.status === 'rejected'
      && /TORNEOS_ACTIVE_OWNER_REQUIRED/.test(String(result.reason?.message))
    )).length,
    2,
    'dos alteraciones simultáneas del owner son rechazadas',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from public.tournament_organization_members
       where organization_id = $1 and role = 'owner' and status = 'active'`,
      [organizationA],
    ),
    1,
    'la concurrencia conserva exactamente un owner activo',
  );

  const concurrentUpdateClients = await Promise.all([
    connect({ role: 'authenticated', userId: USERS.ownerA }),
    connect({ role: 'authenticated', userId: USERS.ownerA }),
  ]);
  const concurrentUpdateResults = await Promise.allSettled([
    value(
      concurrentUpdateClients[0],
      'select public.update_tournament_organization($1, $2, null, null)',
      [organizationA, 'Liga Concurrente Uno'],
    ),
    value(
      concurrentUpdateClients[1],
      'select public.update_tournament_organization($1, $2, null, null)',
      [organizationA, 'Liga Concurrente Dos'],
    ),
  ]);
  eq(
    concurrentUpdateResults.filter((result) => result.status === 'fulfilled').length,
    2,
    'dos actualizaciones autorizadas se serializan sin estado parcial',
  );
  ok(
    ['Liga Concurrente Uno', 'Liga Concurrente Dos'].includes(
      await value(
        admin,
        'select name from public.tournament_organizations where id = $1',
        [organizationA],
      ),
    ),
    'el resultado final de updates concurrentes es una versión completa',
  );

  const rateLimitClients = await Promise.all(
    Array.from(
      { length: 6 },
      () => connect({ role: 'authenticated', userId: USERS.rateLimit }),
    ),
  );
  const rateLimitResults = await Promise.allSettled(
    rateLimitClients.map((client, index) => createOrganization(
      client,
      `Liga Rate ${index + 1}`,
      `liga-rate-${index + 1}`,
      `30000000-0000-4000-8000-00000000000${index + 4}`,
    )),
  );
  eq(
    rateLimitResults.filter((result) => result.status === 'fulfilled').length,
    5,
    'el límite concurrente permite como máximo cinco creaciones',
  );
  eq(
    rateLimitResults.filter((result) => (
      result.status === 'rejected'
      && /TORNEOS_CREATION_RATE_LIMITED/.test(String(result.reason?.message))
    )).length,
    1,
    'la sexta creación concurrente recibe el error de rate limit',
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
