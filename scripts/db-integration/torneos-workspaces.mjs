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
  'migrations',
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
      ($1, $3, 'admin', 'active', now())`,
    [organizationA, USERS.collaboratorA, USERS.adminA],
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
    3,
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
