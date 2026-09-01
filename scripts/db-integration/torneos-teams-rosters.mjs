#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = [
  '20260724233000_tournament_organization_workspaces.sql',
  '20260725120000_tournament_competition_core.sql',
  '20260725210000_tournament_teams_rosters.sql',
];
const PORT = 55850 + Math.floor(Math.random() * 300);
const DATABASE = 'arma2_torneos_teams_rosters';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-teams-rosters-pg-'));
const USERS = {
  ownerA: '61000000-0000-4000-8000-000000000001',
  ownerB: '61000000-0000-4000-8000-000000000002',
  captain: '61000000-0000-4000-8000-000000000003',
  collaborator: '61000000-0000-4000-8000-000000000004',
  adminA: '61000000-0000-4000-8000-000000000005',
  captain2: '61000000-0000-4000-8000-000000000006',
  outsider: '61000000-0000-4000-8000-000000000007',
};
const PHASE_FUNCTIONS = [
  'normalize_tournament_person_name',
  'tournament_role_capabilities',
  'is_tournament_team_manager',
  'can_read_tournament_team_entry',
  'can_edit_tournament_team_entry',
  'append_tournament_audit',
  'validate_tournament_roster',
  'create_tournament_team_entry',
  'update_tournament_team_entry',
  'create_tournament_provisional_player',
  'add_tournament_roster_player',
  'update_tournament_roster_player',
  'remove_tournament_roster_player',
  'submit_tournament_team_entry',
  'review_tournament_team_entry',
  'approve_tournament_team_entry',
  'reject_tournament_team_entry',
  'withdraw_tournament_team_entry',
  'archive_tournament_team_entry',
  'lock_tournament_roster',
  'invite_tournament_team_manager',
  'accept_tournament_team_invitation',
  'revoke_tournament_team_invitation',
  'search_tournament_players',
  'search_tournament_arma2_teams',
  'get_tournament_teams_context',
  'get_team_registration_context',
  'protect_tournament_registration_scope',
  'reject_tournament_audit_mutation',
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
  } else {
    failures += 1;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
}

async function expectError(action, pattern, label) {
  try {
    await action();
    ok(false, label, 'la operación no fue rechazada');
  } catch (error) {
    ok(pattern.test(String(error?.message || error)), label, String(error?.message || error));
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
  if (userId) await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  if (role) await client.query(`set role ${role}`);
  return client;
}

async function value(client, text, params = []) {
  const row = (await client.query(text, params)).rows[0];
  return row ? Object.values(row)[0] : null;
}

async function count(client, text, params = []) {
  return Number(await value(client, text, params));
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
      email text unique,
      email_confirmed_at timestamptz
    );
    create or replace function auth.uid()
    returns uuid language sql stable set search_path = ''
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  for (const [name, id] of Object.entries(USERS)) {
    await admin.query(
      'insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())',
      [id, `${name}@rosters.local`],
    );
  }
  for (const name of MIGRATIONS.slice(0, 2)) {
    await admin.query(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations_history', name), 'utf8'));
  }
  await admin.query(`
    create table public.usuarios (
      id uuid primary key references auth.users(id),
      nombre text,
      avatar_url text,
      posiciones text[] not null default '{}'::text[],
      is_active boolean not null default true
    );
    create table public.teams (
      id uuid primary key default gen_random_uuid(),
      owner_user_id uuid not null references auth.users(id),
      name text not null,
      crest_url text,
      color_primary text,
      color_secondary text,
      format smallint not null default 5,
      is_active boolean not null default true
    );
    create table public.jugadores (
      id bigint generated by default as identity primary key,
      usuario_id uuid references public.usuarios(id)
    );
    create table public.team_members (
      id uuid primary key default gen_random_uuid(),
      team_id uuid references public.teams(id),
      jugador_id bigint references public.jugadores(id)
    );
    create or replace function public.team_user_is_admin_or_owner(
      p_team_id uuid,
      p_user_id uuid
    )
    returns boolean language sql stable security definer set search_path = ''
    as $$
      select exists (
        select 1 from public.teams
        where id = p_team_id and owner_user_id = p_user_id
      );
    $$;
  `);
  await admin.query(
    fs.readFileSync(path.join(ROOT, 'supabase', 'migrations_history', MIGRATIONS[2]), 'utf8'),
  );
  return admin;
}

async function createCompetition(client, suffix) {
  const organization = await value(
    client,
    'select public.create_tournament_organization($1,$2,$3::uuid)',
    [`Liga ${suffix}`, `liga-${suffix.toLowerCase()}`, `62000000-0000-4000-8000-0000000000${suffix === 'A' ? '01' : '02'}`],
  );
  const organizationId = organization.organization.id;
  const season = await value(
    client,
    'select public.create_tournament_season($1,$2,$3,null,null,$4::uuid)',
    [organizationId, `Temporada ${suffix}`, `temporada-${suffix.toLowerCase()}`, `63000000-0000-4000-8000-0000000000${suffix === 'A' ? '01' : '02'}`],
  );
  const tournament = await value(
    client,
    `select public.create_tournament_with_defaults(
      $1,$2,$3,$4,null,'football_5','league','open',null,null,$5::uuid
    )`,
    [organizationId, season.id, `Copa ${suffix}`, `copa-${suffix.toLowerCase()}`, `64000000-0000-4000-8000-0000000000${suffix === 'A' ? '01' : '02'}`],
  );
  const category = await value(
    client,
    `select public.save_tournament_category(
      $1,$2,null,'Primera','primera',null,0,null,null,null,null,null,'active'
    )`,
    [organizationId, tournament.id],
  );
  const checklist = await value(
    client,
    'select public.tournament_registration_checklist($1,$2)',
    [organizationId, tournament.id],
  );
  if (!checklist.ready) {
    throw new Error(`unexpected incomplete competition: ${JSON.stringify(checklist)}`);
  }
  await value(
    client,
    'select public.change_tournament_status($1,$2,$3)',
    [organizationId, tournament.id, 'registration'],
  );
  const categoryId = category.id;
  return { organizationId, seasonId: season.id, tournamentId: tournament.id, categoryId };
}

async function createAdditionalTournament(client, scope, suffix) {
  const tournament = await value(
    client,
    `select public.create_tournament_with_defaults(
      $1,$2,$3,$4,null,'football_5','league','open',null,null,$5::uuid
    )`,
    [
      scope.organizationId,
      scope.seasonId,
      `Copa ${suffix}`,
      `copa-${suffix.toLowerCase()}`,
      `64000000-0000-4000-8000-0000000000${suffix === 'A2' ? '11' : '12'}`,
    ],
  );
  const category = await value(
    client,
    `select public.save_tournament_category(
      $1,$2,null,'Primera','primera',null,0,null,null,null,null,null,'active'
    )`,
    [scope.organizationId, tournament.id],
  );
  await value(
    client,
    'select public.change_tournament_status($1,$2,$3)',
    [scope.organizationId, tournament.id, 'registration'],
  );
  return { ...scope, tournamentId: tournament.id, categoryId: category.id };
}

async function createEntry(client, scope, key, managerUserId = USERS.captain) {
  return value(
    client,
    `select public.create_tournament_team_entry(
      $1,$2,$3,null,$4,null,'#5575FF','#111827','provisional',
      null,$5,$6,$7::uuid
    )`,
    [
      scope.organizationId,
      scope.tournamentId,
      scope.categoryId,
      `Equipo ${key.slice(-2)}`,
      managerUserId ? `${Object.entries(USERS).find(([, id]) => id === managerUserId)?.[0]}@rosters.local` : null,
      managerUserId ? 'Capitán QA' : null,
      key,
    ],
  );
}

async function inviteAndAccept(owner, manager, scope, entryId, managerName = 'captain') {
  const invitation = await value(
    owner,
    'select public.invite_tournament_team_manager($1,$2,$3,$4,$5)',
    [
      scope.organizationId,
      entryId,
      `${managerName}@rosters.local`,
      'Capitán invitado',
      'captain',
    ],
  );
  const accepted = await value(
    manager,
    'select public.accept_tournament_team_invitation($1)',
    [invitation.token],
  );
  return { invitation, accepted };
}

async function main() {
  console.log('Arma2 Torneos · teams/rosters/RLS integration');
  const admin = await setup();
  const ownerA = await connect({ role: 'authenticated', userId: USERS.ownerA });
  const ownerB = await connect({ role: 'authenticated', userId: USERS.ownerB });
  const captain = await connect({ role: 'authenticated', userId: USERS.captain });
  const captain2 = await connect({ role: 'authenticated', userId: USERS.captain2 });
  const collaborator = await connect({ role: 'authenticated', userId: USERS.collaborator });
  const adminA = await connect({ role: 'authenticated', userId: USERS.adminA });
  const outsider = await connect({ role: 'authenticated', userId: USERS.outsider });
  const anon = await connect({ role: 'anon' });

  console.log('\nEsquema y privilegios');
  eq(
    await count(admin, `select count(*) from information_schema.tables
      where table_schema='public' and table_name in (
        'tournament_roster_settings','tournament_team_entries',
        'tournament_team_managers','tournament_team_invitations',
        'tournament_provisional_players','tournament_rosters',
        'tournament_roster_players','tournament_team_reviews',
        'tournament_audit_log'
      )`),
    9,
    'aplica las nueve tablas de la fase',
  );
  eq(
    await count(admin, `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname like 'tournament_%'
        and c.relname in (
          'tournament_roster_settings','tournament_team_entries',
          'tournament_team_managers','tournament_team_invitations',
          'tournament_provisional_players','tournament_rosters',
          'tournament_roster_players','tournament_team_reviews',
          'tournament_audit_log'
        ) and c.relrowsecurity`),
    9,
    'todas las tablas de la fase tienen RLS',
  );
  eq(
    await count(admin, `select count(*) from information_schema.table_privileges
      where table_schema='public' and table_name like 'tournament_%'
        and grantee='authenticated' and privilege_type <> 'SELECT'
        and table_name in (
          'tournament_roster_settings','tournament_team_entries',
          'tournament_team_managers','tournament_team_invitations',
          'tournament_provisional_players','tournament_rosters',
          'tournament_roster_players','tournament_team_reviews',
          'tournament_audit_log'
        )`),
    0,
    'authenticated no recibe escrituras directas',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from information_schema.routine_privileges
       where specific_schema='public'
         and routine_name=any($1::text[])
         and grantee='PUBLIC'`,
      [PHASE_FUNCTIONS],
    ),
    0,
    'las 29 funciones de la fase revocan EXECUTE a PUBLIC',
  );
  eq(
    await count(
      admin,
      `select count(*)
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid=procedure.pronamespace
       where namespace.nspname='public'
         and procedure.proname=any($1::text[])
         and procedure.prosecdef
         and 'search_path=""'=any(procedure.proconfig)
         and procedure.prosrc like '%auth.uid()%'
         and procedure.prosrc !~* '\\mexecute\\M'`,
      [PHASE_FUNCTIONS],
    ),
    25,
    'las 25 SECURITY DEFINER fijan search_path, validan auth.uid y no usan SQL dinámico',
  );
  await expectError(
    () => value(anon, 'select public.get_tournament_teams_context($1,$2)', [
      '65000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000002',
    ]),
    /permission denied|AUTH_REQUIRED/i,
    'anon no ejecuta contextos privados',
  );

  console.log('\nFlujo completo y aislamiento');
  const scopeA = await createCompetition(ownerA, 'A');
  const scopeB = await createCompetition(ownerB, 'B');
  await admin.query(
    `insert into public.tournament_organization_members(
      organization_id,user_id,role,status,joined_at,invited_by
    ) values ($1,$2,'collaborator','active',now(),$3)`,
    [scopeA.organizationId, USERS.collaborator, USERS.ownerA],
  );
  await admin.query(
    `insert into public.tournament_organization_members(
      organization_id,user_id,role,status,joined_at,invited_by
    ) values ($1,$2,'admin','active',now(),$3)`,
    [scopeA.organizationId, USERS.adminA, USERS.ownerA],
  );
  const created = await createEntry(
    ownerA,
    scopeA,
    '66000000-0000-4000-8000-000000000001',
  );
  eq(created.status, 'draft', 'crea la inscripción y responsable pendiente de forma atómica');
  const repeated = await createEntry(
    ownerA,
    scopeA,
    '66000000-0000-4000-8000-000000000001',
  );
  eq(repeated.entryId, created.entryId, 'la creación es idempotente');
  await inviteAndAccept(ownerA, captain, scopeA, created.entryId);
  eq(
    await count(captain, 'select count(*) from public.tournament_team_entries where id=$1', [created.entryId]),
    1,
    'el capitán ve únicamente su inscripción relacionada',
  );
  eq(
    await count(ownerB, 'select count(*) from public.tournament_team_entries where id=$1', [created.entryId]),
    0,
    'otra organización no ve una inscripción por UUID conocido',
  );
  await expectError(
    () => value(ownerB, 'select public.get_team_registration_context($1,$2)', [scopeA.organizationId, created.entryId]),
    /RESOURCE_FORBIDDEN/i,
    'el contexto fail-closed no filtra datos cross-tenant',
  );
  await expectError(
    () => createEntry(
      collaborator,
      scopeA,
      '66000000-0000-4000-8000-000000000099',
    ),
    /RESOURCE_FORBIDDEN/i,
    'collaborator no crea inscripciones',
  );

  await value(captain, 'select public.update_tournament_team_entry($1,$2,$3::jsonb)', [
    scopeA.organizationId,
    created.entryId,
    JSON.stringify({ shortName: 'EQA' }),
  ]);
  for (let index = 1; index <= 5; index += 1) {
    const provisional = await value(
      captain,
      'select public.create_tournament_provisional_player($1,$2,$3)',
      [scopeA.organizationId, created.entryId, `Jugador ${index}`],
    );
    await value(
      captain,
      `select public.add_tournament_roster_player(
        $1,$2,$3,null,$4,$5,null,$6,'ARQ',null,$7
      )`,
      [
        scopeA.organizationId,
        created.entryId,
        created.rosterId,
        provisional.id,
        provisional.displayName,
        index,
        index === 1,
      ],
    );
  }
  await expectError(
    () => value(captain, `select public.add_tournament_roster_player(
      $1,$2,$3,$4,null,'Duplicado',null,8,'DEF',null,false
    )`, [scopeA.organizationId, created.entryId, created.rosterId, USERS.ownerA]),
    /does not exist|RESOURCE_FORBIDDEN|foreign key/i,
    'una identidad no autorizada no se inventa desde el cliente',
  );
  const submitted = await value(
    captain,
    'select public.submit_tournament_team_entry($1,$2)',
    [scopeA.organizationId, created.entryId],
  );
  eq(submitted.status, 'submitted', 'capitán presenta un plantel completo');
  await expectError(
    () => value(captain, 'select public.review_tournament_team_entry($1,$2,$3,$4,$5::jsonb)', [
      scopeA.organizationId, created.entryId, 'approved', 'Autoaprobación', '[]',
    ]),
    /RESOURCE_FORBIDDEN/i,
    'capitán no puede autoaprobarse',
  );
  const observed = await value(
    ownerA,
    'select public.review_tournament_team_entry($1,$2,$3,$4,$5::jsonb)',
    [scopeA.organizationId, created.entryId, 'changes_requested', 'Confirmar dorsales.', '["shirt_number"]'],
  );
  eq(observed.status, 'changes_requested', 'organizador solicita cambios con motivo');
  await value(
    captain,
    'select public.submit_tournament_team_entry($1,$2)',
    [scopeA.organizationId, created.entryId],
  );
  const approved = await value(
    ownerA,
    'select public.approve_tournament_team_entry($1,$2,$3)',
    [scopeA.organizationId, created.entryId, 'Plantel verificado.'],
  );
  eq(approved.status, 'approved', 'aprobación revalida y habilita el plantel');
  eq(
    await count(admin, `select count(*) from public.tournament_roster_players
      where roster_id=$1 and eligibility_status='eligible'`, [created.rosterId]),
    5,
    'jugadores aprobados quedan habilitados',
  );
  ok(
    await count(admin, 'select count(*) from public.tournament_audit_log where team_entry_id=$1', [created.entryId]) >= 10,
    'operaciones sensibles dejan auditoría',
  );
  await expectError(
    () => admin.query('update public.tournament_audit_log set action=$1 where team_entry_id=$2', ['tampered', created.entryId]),
    /AUDIT_APPEND_ONLY/i,
    'la auditoría rechaza modificaciones incluso por acceso directo',
  );

  console.log('\nInvitaciones tokenizadas');
  const inviteEntry = await createEntry(
    ownerA,
    scopeA,
    '66000000-0000-4000-8000-000000000002',
    null,
  );
  const invitation = await value(
    ownerA,
    'select public.invite_tournament_team_manager($1,$2,$3,$4,$5)',
    [scopeA.organizationId, inviteEntry.entryId, 'captain@rosters.local', 'Capitán invitado', 'captain'],
  );
  eq(invitation.environment, 'test-only', 'el enlace se marca como exclusivo de QA');
  eq(
    await count(admin, `select count(*) from public.tournament_team_invitations
      where id=$1 and token_hash <> $2`, [invitation.invitationId, invitation.token]),
    1,
    'la base guarda hash y no el token plano',
  );
  const accepted = await value(
    captain,
    'select public.accept_tournament_team_invitation($1)',
    [invitation.token],
  );
  eq(accepted.status, 'accepted', 'destinatario autenticado acepta una sola vez');
  await expectError(
    () => value(captain, 'select public.accept_tournament_team_invitation($1)', [invitation.token]),
    /INVITATION_INVALID/i,
    'el token no puede reutilizarse',
  );

  console.log('\nInvitaciones verificadas, revocación y privacidad');
  const secondCaptainEntry = await createEntry(
    ownerA,
    scopeA,
    '66000000-0000-4000-8000-000000000003',
    USERS.captain2,
  );
  eq(
    await count(captain2, 'select count(*) from public.tournament_team_entries where id=$1', [secondCaptainEntry.entryId]),
    0,
    'un responsable pendiente todavía no obtiene acceso',
  );
  const secondCaptainInvitation = await value(
    ownerA,
    'select public.invite_tournament_team_manager($1,$2,$3,$4,$5)',
    [scopeA.organizationId, secondCaptainEntry.entryId, 'CAPTAIN2@ROSTERS.LOCAL', 'Capitán dos', 'captain'],
  );
  ok(
    /^[a-f0-9]{64}$/.test(secondCaptainInvitation.token),
    'el token contiene exactamente 32 bytes criptográficos codificados en hex',
  );
  await expectError(
    () => value(outsider, 'select public.accept_tournament_team_invitation($1)', [secondCaptainInvitation.token]),
    /INVITATION_INVALID/i,
    'un email distinto recibe el mismo error seguro',
  );
  await admin.query(
    'update auth.users set email_confirmed_at=null where id=$1',
    [USERS.captain2],
  );
  await expectError(
    () => value(captain2, 'select public.accept_tournament_team_invitation($1)', [secondCaptainInvitation.token]),
    /INVITATION_INVALID/i,
    'un email no verificado no acepta la invitación',
  );
  await admin.query(
    "update auth.users set email=$1,email_confirmed_at=now() where id=$2",
    [' captain2@rosters.local ', USERS.captain2],
  );
  await expectError(
    () => value(captain2, 'select public.accept_tournament_team_invitation($1)', [secondCaptainInvitation.token]),
    /INVITATION_INVALID/i,
    'un email de sesión alterado con espacios se rechaza',
  );
  await admin.query(
    "update auth.users set email=$1,email_confirmed_at=now() where id=$2",
    ['captain2@rosters.local', USERS.captain2],
  );
  const captain2Race = await connect({ role: 'authenticated', userId: USERS.captain2 });
  const acceptanceRace = await Promise.allSettled([
    value(captain2, 'select public.accept_tournament_team_invitation($1)', [secondCaptainInvitation.token]),
    value(captain2Race, 'select public.accept_tournament_team_invitation($1)', [secondCaptainInvitation.token]),
  ]);
  eq(
    acceptanceRace.filter((result) => result.status === 'fulfilled').length,
    1,
    'dos aceptaciones concurrentes producen un solo ganador',
  );
  eq(
    await count(admin, `select count(*) from public.tournament_team_managers
      where team_entry_id=$1 and user_id=$2 and status='active'`, [
      secondCaptainEntry.entryId,
      USERS.captain2,
    ]),
    1,
    'la aceptación concurrente deja una sola membresía activa',
  );
  eq(
    await count(captain, 'select count(*) from public.tournament_team_entries where id=$1', [secondCaptainEntry.entryId]),
    0,
    'el capitán A1 no puede abrir la inscripción A2',
  );
  eq(
    await count(captain2, 'select count(*) from public.tournament_team_entries where id=$1', [created.entryId]),
    0,
    'el capitán A2 no puede abrir la inscripción A1',
  );
  const captainSearch = await value(
    captain2,
    'select public.search_tournament_players($1,$2,$3,$4,$5)',
    [scopeA.organizationId, scopeA.tournamentId, 'ca', 8, secondCaptainEntry.entryId],
  );
  ok(Array.isArray(captainSearch), 'el capitán busca jugadores sólo desde su inscripción editable');
  await expectError(
    () => value(captain2, 'select public.search_tournament_players($1,$2,$3,$4,$5)', [
      scopeA.organizationId, scopeA.tournamentId, 'ca', 8, created.entryId,
    ]),
    /RESOURCE_FORBIDDEN/i,
    'el capitán no usa otra inscripción para ampliar la búsqueda',
  );
  await expectError(
    () => captain2.query(
      'select email_normalized from public.tournament_team_managers where team_entry_id=$1',
      [secondCaptainEntry.entryId],
    ),
    /permission denied/i,
    'el email destinatario no se expone por SELECT directo',
  );
  await expectError(
    () => captain2.query(
      'select token_hash from public.tournament_team_invitations where id=$1',
      [secondCaptainInvitation.invitationId],
    ),
    /permission denied/i,
    'ni siquiera el hash del token se expone al cliente',
  );
  eq(
    await count(admin, `select count(*) from public.tournament_audit_log
      where metadata::text like '%' || $1 || '%'
        or metadata::text ilike '%captain2@rosters.local%'`, [secondCaptainInvitation.token]),
    0,
    'auditoría no conserva token ni email completo',
  );
  await value(
    ownerA,
    'select public.revoke_tournament_team_invitation($1,$2)',
    [scopeA.organizationId, secondCaptainInvitation.invitationId],
  );
  eq(
    await count(captain2, 'select count(*) from public.tournament_team_entries where id=$1', [secondCaptainEntry.entryId]),
    0,
    'revocar un responsable aceptado elimina el acceso inmediatamente',
  );

  const invitationLifecycleEntry = await createEntry(
    ownerA,
    scopeA,
    '66000000-0000-4000-8000-000000000004',
    null,
  );
  const oldInvitation = await value(
    ownerA,
    'select public.invite_tournament_team_manager($1,$2,$3,$4,$5)',
    [scopeA.organizationId, invitationLifecycleEntry.entryId, 'outsider@rosters.local', 'Invitado QA', 'captain'],
  );
  const resentInvitation = await value(
    ownerA,
    'select public.invite_tournament_team_manager($1,$2,$3,$4,$5)',
    [scopeA.organizationId, invitationLifecycleEntry.entryId, 'OUTSIDER@ROSTERS.LOCAL', 'Invitado QA', 'captain'],
  );
  await expectError(
    () => value(outsider, 'select public.accept_tournament_team_invitation($1)', [oldInvitation.token]),
    /INVITATION_INVALID/i,
    'reenviar invalida claramente el enlace anterior',
  );
  await value(
    ownerA,
    'select public.revoke_tournament_team_invitation($1,$2)',
    [scopeA.organizationId, resentInvitation.invitationId],
  );
  await expectError(
    () => value(outsider, 'select public.accept_tournament_team_invitation($1)', [resentInvitation.token]),
    /INVITATION_INVALID/i,
    'una invitación revocada no se acepta',
  );
  const expiringInvitation = await value(
    ownerA,
    'select public.invite_tournament_team_manager($1,$2,$3,$4,$5)',
    [scopeA.organizationId, invitationLifecycleEntry.entryId, 'outsider@rosters.local', 'Invitado QA', 'captain'],
  );
  await admin.query(
    `update public.tournament_team_invitations
      set created_at=now()-interval '8 days', expires_at=now()-interval '1 second'
      where id=$1`,
    [expiringInvitation.invitationId],
  );
  await expectError(
    () => value(outsider, 'select public.accept_tournament_team_invitation($1)', [expiringInvitation.token]),
    /INVITATION_EXPIRED/i,
    'una invitación vencida no se acepta',
  );
  const manipulatedToken = `${expiringInvitation.token.slice(0, -1)}${expiringInvitation.token.endsWith('0') ? '1' : '0'}`;
  await expectError(
    () => value(outsider, 'select public.accept_tournament_team_invitation($1)', [manipulatedToken]),
    /INVITATION_INVALID/i,
    'un token manipulado no filtra la invitación original',
  );

  console.log('\nConstraints compuestas y auditoría append-only');
  const provisionalId = await value(
    admin,
    'select provisional_player_id from public.tournament_roster_players where roster_id=$1 limit 1',
    [created.rosterId],
  );
  await admin.query(
    'update public.tournament_provisional_players set contact_email=$1,contact_phone=$2 where id=$3',
    ['privado@example.test', '+5491100000000', provisionalId],
  );
  await expectError(
    () => captain.query(
      'select contact_email,contact_phone from public.tournament_provisional_players where id=$1',
      [provisionalId],
    ),
    /permission denied/i,
    'los contactos opcionales del provisional permanecen privados',
  );
  await expectError(
    () => admin.query(
      `insert into public.tournament_roster_players(
        organization_id,team_entry_id,roster_id,provisional_player_id,
        display_name,added_by
      ) values ($1,$2,$3,$4,'Scope inválido',$5)`,
      [
        scopeA.organizationId,
        created.entryId,
        inviteEntry.rosterId,
        provisionalId,
        USERS.ownerA,
      ],
    ),
    /foreign key/i,
    'un jugador no puede apuntar a un roster de otra inscripción',
  );
  await expectError(
    () => admin.query(
      `insert into public.tournament_team_reviews(
        organization_id,team_entry_id,roster_id,decision,reason,issues,created_by
      ) values ($1,$2,$3,'approved','Scope inválido','[]',$4)`,
      [scopeA.organizationId, created.entryId, inviteEntry.rosterId, USERS.ownerA],
    ),
    /foreign key/i,
    'una review no puede usar el roster de otra inscripción',
  );
  const createdManagerId = await value(
    admin,
    'select id from public.tournament_team_managers where team_entry_id=$1 limit 1',
    [created.entryId],
  );
  await expectError(
    () => admin.query(
      `insert into public.tournament_team_invitations(
        organization_id,tournament_id,team_entry_id,manager_id,email_normalized,
        role,token_hash,expires_at,created_by
      ) values ($1,$2,$3,$4,'scope@example.test','captain',$5,now()+interval '1 day',$6)`,
      [
        scopeA.organizationId,
        scopeA.tournamentId,
        inviteEntry.entryId,
        createdManagerId,
        'f'.repeat(64),
        USERS.ownerA,
      ],
    ),
    /foreign key/i,
    'una invitación no puede reutilizar un manager de otra inscripción',
  );
  await expectError(
    () => admin.query(
      `insert into public.tournament_team_entries(
        organization_id,season_id,tournament_id,category_id,name,slug,status,
        registration_source,created_by,idempotency_key
      ) values ($1,$2,$3,$4,'Categoría ajena','categoria-ajena','draft',
        'provisional',$5,$6)`,
      [
        scopeA.organizationId,
        scopeA.seasonId,
        scopeA.tournamentId,
        scopeB.categoryId,
        USERS.ownerA,
        '66000000-0000-4000-8000-000000000090',
      ],
    ),
    /foreign key/i,
    'una categoría ajena no puede vincularse por acceso privilegiado',
  );
  await expectError(
    () => admin.query(
      `insert into public.tournament_audit_log(
        organization_id,actor_user_id,actor_type,action,resource_type,
        resource_id,team_entry_id,tournament_id
      ) values ($1,$2,'user','team_entry.tampered','team_entry',$3,$3,$4)`,
      [scopeB.organizationId, USERS.ownerA, created.entryId, scopeA.tournamentId],
    ),
    /foreign key/i,
    'auditoría no puede registrar un recurso de otro tenant',
  );
  await expectError(
    () => captain.query(
      `insert into public.tournament_audit_log(
        organization_id,actor_user_id,actor_type,action,resource_type,resource_id
      ) values ($1,$2,'user','audit.forged','team_entry',$3)`,
      [scopeA.organizationId, USERS.ownerB, created.entryId],
    ),
    /permission denied|row-level security/i,
    'el cliente no inserta auditoría ni falsifica actor',
  );
  await expectError(
    () => admin.query('delete from public.tournament_audit_log where team_entry_id=$1', [created.entryId]),
    /AUDIT_APPEND_ONLY/i,
    'la auditoría rechaza eliminaciones incluso privilegiadas',
  );
  const rosterPlayerId = await value(
    admin,
    'select id from public.tournament_roster_players where roster_id=$1 limit 1',
    [created.rosterId],
  );
  await expectError(
    () => admin.query(
      'update public.tournament_roster_players set roster_id=$1 where id=$2',
      [inviteEntry.rosterId, rosterPlayerId],
    ),
    /SCOPE_IMMUTABLE/i,
    'un jugador no puede cambiar de roster silenciosamente',
  );

  console.log('\nIdentidad permanente y snapshots competitivos');
  const arma2TeamId = await value(
    admin,
    `insert into public.teams(
      owner_user_id,name,color_primary,color_secondary,format,is_active
    ) values ($1,'Equipo Permanente','#123456','#654321',5,true) returning id`,
    [USERS.ownerA],
  );
  const ownerSearch = await value(
    ownerA,
    'select public.search_tournament_arma2_teams($1,$2,$3,$4)',
    [scopeA.organizationId, scopeA.tournamentId, 'permanente', 8],
  );
  eq(ownerSearch.length, 1, 'el buscador devuelve únicamente equipos permanentes administrables');
  const foreignOwnerSearch = await value(
    ownerB,
    'select public.search_tournament_arma2_teams($1,$2,$3,$4)',
    [scopeB.organizationId, scopeB.tournamentId, 'permanente', 8],
  );
  eq(foreignOwnerSearch.length, 0, 'otra organización no enumera el equipo permanente por nombre');
  const linkedEntry = await value(
    ownerA,
    `select public.create_tournament_team_entry(
      $1,$2,$3,$4,'Nombre manipulado',null,'#FFFFFF','#000000','arma2_team',
      null,null,null,$5::uuid
    )`,
    [
      scopeA.organizationId,
      scopeA.tournamentId,
      scopeA.categoryId,
      arma2TeamId,
      '66000000-0000-4000-8000-000000000005',
    ],
  );
  const linkedSnapshot = (await admin.query(
    'select name,primary_color,secondary_color from public.tournament_team_entries where id=$1',
    [linkedEntry.entryId],
  )).rows[0];
  eq(linkedSnapshot.name, 'Equipo Permanente', 'el snapshot ignora un nombre cliente manipulado');
  eq(linkedSnapshot.primary_color, '#123456', 'el snapshot copia el color autoritativo');
  await expectError(
    () => value(ownerB, `select public.create_tournament_team_entry(
      $1,$2,$3,$4,'Equipo Permanente',null,null,null,'arma2_team',
      null,null,null,$5::uuid
    )`, [
      scopeB.organizationId,
      scopeB.tournamentId,
      scopeB.categoryId,
      arma2TeamId,
      '66000000-0000-4000-8000-000000000006',
    ]),
    /RESOURCE_FORBIDDEN/i,
    'manipular el ID no vincula un equipo permanente ajeno',
  );
  await expectError(
    () => value(ownerA, `select public.create_tournament_team_entry(
      $1,$2,$3,$4,'Equipo Permanente',null,null,null,'arma2_team',
      null,null,null,$5::uuid
    )`, [
      scopeA.organizationId,
      scopeA.tournamentId,
      scopeA.categoryId,
      arma2TeamId,
      '66000000-0000-4000-8000-000000000007',
    ]),
    /TEAM_ALREADY_REGISTERED/i,
    'el mismo equipo no se duplica activamente en la categoría',
  );
  const secondTournament = await createAdditionalTournament(ownerA, scopeA, 'A2');
  const linkedAgain = await value(
    ownerA,
    `select public.create_tournament_team_entry(
      $1,$2,$3,$4,'Ignorado',null,null,null,'arma2_team',
      null,null,null,$5::uuid
    )`,
    [
      secondTournament.organizationId,
      secondTournament.tournamentId,
      secondTournament.categoryId,
      arma2TeamId,
      '66000000-0000-4000-8000-000000000008',
    ],
  );
  ok(Boolean(linkedAgain.entryId), 'el mismo equipo permanente participa en otro torneo');
  await admin.query(
    "update public.teams set name='Equipo Renombrado',is_active=true where id=$1",
    [arma2TeamId],
  );
  eq(
    await value(admin, 'select name from public.tournament_team_entries where id=$1', [linkedEntry.entryId]),
    'Equipo Permanente',
    'cambiar el equipo general no altera el snapshot competitivo',
  );
  await value(
    ownerA,
    'select public.archive_tournament_team_entry($1,$2,$3)',
    [scopeA.organizationId, linkedEntry.entryId, 'Cierre de prueba'],
  );
  eq(
    await value(admin, 'select is_active from public.teams where id=$1', [arma2TeamId]),
    true,
    'archivar la inscripción no archiva el equipo permanente',
  );
  eq(
    await count(ownerA, 'select count(*) from public.tournament_team_entries where id=$1', [linkedEntry.entryId]),
    0,
    'una inscripción archivada sale del acceso operativo',
  );

  console.log('\nAtomicidad, carreras de estado y bloqueo de roster');
  const atomicEntry = await createEntry(
    ownerA,
    scopeA,
    '66000000-0000-4000-8000-000000000012',
    USERS.captain,
  );
  await inviteAndAccept(ownerA, captain, scopeA, atomicEntry.entryId);
  await value(captain, 'select public.update_tournament_team_entry($1,$2,$3::jsonb)', [
    scopeA.organizationId,
    atomicEntry.entryId,
    JSON.stringify({ shortName: 'ATM' }),
  ]);
  for (let index = 1; index <= 4; index += 1) {
    const provisional = await value(
      captain,
      'select public.create_tournament_provisional_player($1,$2,$3)',
      [scopeA.organizationId, atomicEntry.entryId, `Atómico ${index}`],
    );
    await value(
      captain,
      `select public.add_tournament_roster_player(
        $1,$2,$3,null,$4,$5,null,$6,$7,null,$8
      )`,
      [
        scopeA.organizationId,
        atomicEntry.entryId,
        atomicEntry.rosterId,
        provisional.id,
        provisional.displayName,
        index,
        index === 1 ? 'ARQ' : 'DEF',
        index === 1,
      ],
    );
  }
  await expectError(
    () => value(captain, 'select public.submit_tournament_team_entry($1,$2)', [
      scopeA.organizationId, atomicEntry.entryId,
    ]),
    /ROSTER_INCOMPLETE/i,
    'un fallo temprano de validación rechaza la presentación',
  );
  eq(
    await value(admin, 'select status from public.tournament_team_entries where id=$1', [atomicEntry.entryId]),
    'in_progress',
    'el fallo temprano conserva la inscripción editable',
  );
  const finalAtomicPlayer = await value(
    captain,
    'select public.create_tournament_provisional_player($1,$2,$3)',
    [scopeA.organizationId, atomicEntry.entryId, 'Atómico 5'],
  );
  await value(
    captain,
    `select public.add_tournament_roster_player(
      $1,$2,$3,null,$4,$5,null,5::smallint,'DEF',null,false
    )`,
    [
      scopeA.organizationId,
      atomicEntry.entryId,
      atomicEntry.rosterId,
      finalAtomicPlayer.id,
      finalAtomicPlayer.displayName,
    ],
  );
  await admin.query(`
    create or replace function public.fail_tournament_audit_for_test()
    returns trigger language plpgsql set search_path = ''
    as $$
    begin
      if current_setting('test.fail_audit_action', true) = new.action then
        raise exception 'TEST_AUDIT_FAILURE';
      end if;
      return new;
    end;
    $$;
    create trigger fail_tournament_audit_for_test
    before insert on public.tournament_audit_log
    for each row execute function public.fail_tournament_audit_for_test();
  `);
  await value(
    captain,
    "select set_config('test.fail_audit_action','team_entry.submitted',false)",
  );
  await expectError(
    () => value(captain, 'select public.submit_tournament_team_entry($1,$2)', [
      scopeA.organizationId, atomicEntry.entryId,
    ]),
    /TEST_AUDIT_FAILURE/i,
    'un fallo tardío de auditoría revierte la presentación completa',
  );
  eq(
    await value(admin, 'select status from public.tournament_team_entries where id=$1', [atomicEntry.entryId]),
    'in_progress',
    'la inscripción no queda parcialmente submitted tras el fallo tardío',
  );
  eq(
    await value(admin, 'select status from public.tournament_rosters where id=$1', [atomicEntry.rosterId]),
    'draft',
    'el roster tampoco queda parcialmente submitted',
  );
  await value(captain, "select set_config('test.fail_audit_action','',false)");
  const captainRace = await connect({ role: 'authenticated', userId: USERS.captain });
  const submitRace = await Promise.allSettled([
    value(captain, 'select public.submit_tournament_team_entry($1,$2)', [
      scopeA.organizationId, atomicEntry.entryId,
    ]),
    value(captainRace, 'select public.submit_tournament_team_entry($1,$2)', [
      scopeA.organizationId, atomicEntry.entryId,
    ]),
  ]);
  eq(
    submitRace.filter((result) => result.status === 'fulfilled').length,
    1,
    'la presentación duplicada produce un solo cambio de estado',
  );
  await value(
    ownerA,
    "select set_config('test.fail_audit_action','team_entry.approved',false)",
  );
  await expectError(
    () => value(ownerA, 'select public.approve_tournament_team_entry($1,$2,$3)', [
      scopeA.organizationId, atomicEntry.entryId, 'Aprobación atómica.',
    ]),
    /TEST_AUDIT_FAILURE/i,
    'un fallo tardío revierte aprobación, review y elegibilidad',
  );
  eq(
    await value(admin, 'select status from public.tournament_team_entries where id=$1', [atomicEntry.entryId]),
    'submitted',
    'la aprobación fallida conserva la inscripción submitted',
  );
  eq(
    await count(admin, 'select count(*) from public.tournament_team_reviews where team_entry_id=$1', [atomicEntry.entryId]),
    0,
    'la aprobación fallida no deja una review parcial',
  );
  await value(ownerA, "select set_config('test.fail_audit_action','',false)");
  const decisionRace = await Promise.allSettled([
    value(ownerA, 'select public.review_tournament_team_entry($1,$2,$3,$4,$5::jsonb)', [
      scopeA.organizationId, atomicEntry.entryId, 'approved', 'Aprobación concurrente.', '[]',
    ]),
    value(adminA, 'select public.review_tournament_team_entry($1,$2,$3,$4,$5::jsonb)', [
      scopeA.organizationId, atomicEntry.entryId, 'changes_requested', 'Corrección concurrente.', '[]',
    ]),
  ]);
  eq(
    decisionRace.filter((result) => result.status === 'fulfilled').length,
    1,
    'aprobar y solicitar cambios simultáneamente produce una sola decisión',
  );
  eq(
    await count(admin, 'select count(*) from public.tournament_team_reviews where team_entry_id=$1', [atomicEntry.entryId]),
    1,
    'la carrera de revisión deja exactamente una review',
  );
  if (await value(admin, 'select status from public.tournament_team_entries where id=$1', [atomicEntry.entryId]) === 'changes_requested') {
    await value(captain, 'select public.submit_tournament_team_entry($1,$2)', [
      scopeA.organizationId, atomicEntry.entryId,
    ]);
    await value(ownerA, 'select public.approve_tournament_team_entry($1,$2,$3)', [
      scopeA.organizationId, atomicEntry.entryId, 'Aprobación posterior.',
    ]);
  }
  const locked = await value(
    ownerA,
    'select public.lock_tournament_roster($1,$2,$3)',
    [scopeA.organizationId, atomicEntry.entryId, atomicEntry.rosterId],
  );
  eq(locked.status, 'locked', 'approved pasa explícitamente a locked');
  await expectError(
    () => value(captain, `select public.add_tournament_roster_player(
      $1,$2,$3,$4,null,'No permitido',null,20::smallint,'DEF',null,false
    )`, [
      scopeA.organizationId,
      atomicEntry.entryId,
      atomicEntry.rosterId,
      USERS.outsider,
    ]),
    /RESOURCE_FORBIDDEN/i,
    'un roster locked no recibe jugadores',
  );
  await admin.query('drop trigger fail_tournament_audit_for_test on public.tournament_audit_log');
  await admin.query('drop function public.fail_tournament_audit_for_test()');

  const revokeSubmitEntry = await createEntry(
    ownerA,
    scopeA,
    '66000000-0000-4000-8000-000000000013',
    null,
  );
  const revokeSubmitManager = await inviteAndAccept(
    ownerA,
    captain,
    scopeA,
    revokeSubmitEntry.entryId,
  );
  for (let index = 1; index <= 5; index += 1) {
    const provisional = await value(
      captain,
      'select public.create_tournament_provisional_player($1,$2,$3)',
      [scopeA.organizationId, revokeSubmitEntry.entryId, `Revocación ${index}`],
    );
    await value(
      captain,
      `select public.add_tournament_roster_player(
        $1,$2,$3,null,$4,$5,null,$6,$7,null,$8
      )`,
      [
        scopeA.organizationId,
        revokeSubmitEntry.entryId,
        revokeSubmitEntry.rosterId,
        provisional.id,
        provisional.displayName,
        30 + index,
        index === 1 ? 'ARQ' : 'DEF',
        index === 1,
      ],
    );
  }
  await admin.query(`
    create or replace function public.pause_manager_revoke_for_test()
    returns trigger language plpgsql set search_path = ''
    as $$
    begin
      if current_setting('test.pause_manager_revoke', true) = 'on'
        and old.status = 'accepted'
        and new.status = 'revoked'
      then
        perform pg_sleep(0.25);
      end if;
      return new;
    end;
    $$;
    create trigger pause_manager_revoke_for_test
    before update on public.tournament_team_invitations
    for each row execute function public.pause_manager_revoke_for_test();
  `);
  await value(ownerA, "select set_config('test.pause_manager_revoke','on',false)");
  const revokePromise = value(
    ownerA,
    'select public.revoke_tournament_team_invitation($1,$2)',
    [scopeA.organizationId, revokeSubmitManager.invitation.invitationId],
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const submitPromise = value(
    captain,
    'select public.submit_tournament_team_entry($1,$2)',
    [scopeA.organizationId, revokeSubmitEntry.entryId],
  );
  const revokeSubmitRace = await Promise.allSettled([revokePromise, submitPromise]);
  eq(
    revokeSubmitRace.filter((result) => result.status === 'fulfilled').length,
    1,
    'revocar responsable y presentar se serializan con un único ganador',
  );
  eq(
    await value(admin, 'select status from public.tournament_team_entries where id=$1', [revokeSubmitEntry.entryId]),
    'in_progress',
    'la revocación ganadora no deja una inscripción presentada sin responsable',
  );
  await value(ownerA, "select set_config('test.pause_manager_revoke','',false)");
  await admin.query('drop trigger pause_manager_revoke_for_test on public.tournament_team_invitations');
  await admin.query('drop function public.pause_manager_revoke_for_test()');

  console.log('\nRLS por rol, suspensión y ventanas');
  ok(
    await count(adminA, 'select count(*) from public.tournament_team_entries where organization_id=$1', [scopeA.organizationId]) > 0,
    'admin A puede leer su organización',
  );
  ok(
    await count(collaborator, 'select count(*) from public.tournament_team_entries where organization_id=$1', [scopeA.organizationId]) > 0,
    'collaborator A conserva lectura',
  );
  await expectError(
    () => value(collaborator, 'select public.update_tournament_team_entry($1,$2,$3::jsonb)', [
      scopeA.organizationId, invitationLifecycleEntry.entryId, JSON.stringify({ name: 'No permitido' }),
    ]),
    /RESOURCE_FORBIDDEN/i,
    'collaborator no escribe aunque manipule el frontend',
  );
  eq(
    await count(outsider, 'select count(*) from public.tournament_team_entries'),
    0,
    'outsider no enumera inscripciones',
  );
  await admin.query(
    `update public.tournament_organization_members
      set status='suspended' where organization_id=$1 and user_id=$2`,
    [scopeA.organizationId, USERS.collaborator],
  );
  eq(
    await count(collaborator, 'select count(*) from public.tournament_team_entries where organization_id=$1', [scopeA.organizationId]),
    0,
    'una membership suspendida pierde acceso inmediatamente',
  );
  await admin.query(
    `update public.tournament_organization_members
      set status='active' where organization_id=$1 and user_id=$2`,
    [scopeA.organizationId, USERS.collaborator],
  );
  const closedEntry = await createEntry(
    ownerB,
    scopeB,
    '66000000-0000-4000-8000-000000000009',
    null,
  );
  await expectError(
    () => value(ownerB, `select public.add_tournament_roster_player(
      $1,$2,$3,null,$4,'Provisional ajeno',null,1::smallint,'ARQ',null,true
    )`, [
      scopeB.organizationId,
      closedEntry.entryId,
      closedEntry.rosterId,
      provisionalId,
    ]),
    /RESOURCE_FORBIDDEN/i,
    'un provisional de A no puede utilizarse en B',
  );
  await admin.query(
    `update public.tournaments
      set registration_closes_at=now()-interval '1 second'
      where id=$1`,
    [scopeB.tournamentId],
  );
  await expectError(
    () => value(ownerB, 'select public.update_tournament_team_entry($1,$2,$3::jsonb)', [
      scopeB.organizationId, closedEntry.entryId, JSON.stringify({ name: 'Fuera de ventana' }),
    ]),
    /RESOURCE_FORBIDDEN/i,
    'el cierre temporal bloquea escrituras aunque el estado siga en registration',
  );
  await expectError(
    () => createEntry(
      ownerB,
      scopeB,
      '66000000-0000-4000-8000-000000000010',
      null,
    ),
    /REGISTRATION_CLOSED/i,
    'el cierre temporal bloquea nuevas inscripciones',
  );

  console.log('\nIdempotencia y concurrencia focalizada');
  const ownerARace = await connect({ role: 'authenticated', userId: USERS.ownerA });
  const raceKey = '66000000-0000-4000-8000-000000000011';
  const creationRace = await Promise.all([
    createEntry(ownerA, scopeA, raceKey, null),
    createEntry(ownerARace, scopeA, raceKey, null),
  ]);
  eq(creationRace[0].entryId, creationRace[1].entryId, 'doble click devuelve la misma inscripción');
  eq(
    await count(admin, `select count(*) from public.tournament_team_entries
      where organization_id=$1 and idempotency_key=$2`, [scopeA.organizationId, raceKey]),
    1,
    'la idempotencia concurrente no deja duplicados',
  );
  await value(
    ownerA,
    `select public.add_tournament_roster_player(
      $1,$2,$3,$4,null,'Usuario único',null,7::smallint,'DEF',null,false
    )`,
    [
      scopeA.organizationId,
      creationRace[0].entryId,
      creationRace[0].rosterId,
      USERS.ownerA,
    ],
  );
  await expectError(
    () => value(ownerA, `select public.add_tournament_roster_player(
      $1,$2,$3,$4,null,'Usuario duplicado',null,8::smallint,'DEF',null,false
    )`, [
      scopeA.organizationId,
      creationRace[0].entryId,
      creationRace[0].rosterId,
      USERS.ownerA,
    ]),
    /DUPLICATE_PLAYER/i,
    'el mismo usuario no se duplica en el roster',
  );
  const dorsalPlayer = await value(
    ownerA,
    'select public.create_tournament_provisional_player($1,$2,$3)',
    [scopeA.organizationId, creationRace[0].entryId, 'Dorsal repetido'],
  );
  await expectError(
    () => value(ownerA, `select public.add_tournament_roster_player(
      $1,$2,$3,null,$4,$5,null,7::smallint,'DEF',null,false
    )`, [
      scopeA.organizationId,
      creationRace[0].entryId,
      creationRace[0].rosterId,
      dorsalPlayer.id,
      dorsalPlayer.displayName,
    ]),
    /DUPLICATE_SHIRT_NUMBER/i,
    'la unicidad configurada bloquea un dorsal repetido',
  );

  // Ensure scope B remained physically and logically untouched.
  eq(await count(admin, `select count(*) from public.tournament_team_entries
    where organization_id=$1 and id<>$2`, [scopeB.organizationId, closedEntry.entryId]), 0,
  'las operaciones de A no escriben inscripciones adicionales en B');

  for (const client of clients.reverse()) await client.end().catch(() => {});
  await postgres.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(`\n${checks - failures}/${checks} checks aprobados`);
  if (failures) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  for (const client of clients.reverse()) await client.end().catch(() => {});
  await postgres.stop().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exitCode = 1;
});
