#!/usr/bin/env node

import process from 'node:process';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const requiredEnvironment = [
  'TORNEOS_LOCAL_SUPABASE_URL',
  'TORNEOS_LOCAL_SUPABASE_ANON_KEY',
  'TORNEOS_LOCAL_SUPABASE_SECRET_KEY',
  'TORNEOS_LOCAL_DATABASE_URL',
  'TORNEOS_LOCAL_FIXTURE_PASSWORD',
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const apiUrl = process.env.TORNEOS_LOCAL_SUPABASE_URL;
const anonKey = process.env.TORNEOS_LOCAL_SUPABASE_ANON_KEY;
const secretKey = process.env.TORNEOS_LOCAL_SUPABASE_SECRET_KEY;
const databaseUrl = process.env.TORNEOS_LOCAL_DATABASE_URL;
const password = process.env.TORNEOS_LOCAL_FIXTURE_PASSWORD;
const identities = {
  owner: '71000000-0000-4000-8000-000000000001',
  admin: '71000000-0000-4000-8000-000000000002',
  collaborator: '71000000-0000-4000-8000-000000000003',
  delegate: '71000000-0000-4000-8000-000000000004',
  player: '71000000-0000-4000-8000-000000000005',
  outsider: '71000000-0000-4000-8000-000000000006',
};

let checks = 0;
let failures = 0;
let http500 = 0;

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

function client() {
  return createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function recordError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status >= 500) http500 += 1;
  return error;
}

async function rpc(supabase, name, args = undefined) {
  const result = await supabase.rpc(name, args);
  if (result.error) throw recordError(result.error);
  return result.data;
}

async function main() {
  console.log('Arma2 Torneos · authenticated local app/API smoke');
  const fixtureAdmin = createClient(apiUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();

  for (const [role, id] of Object.entries(identities)) {
    const { error } = await fixtureAdmin.auth.admin.createUser({
      id,
      email: `${role}@torneos-pure-context.local`,
      password,
      email_confirm: true,
      user_metadata: { nombre: `QA local ${role}` },
    });
    if (error && !/already.*registered|already.*exists/i.test(error.message)) {
      throw error;
    }
  }

  const clients = {};
  for (const role of Object.keys(identities)) {
    const supabase = client();
    const { error } = await supabase.auth.signInWithPassword({
      email: `${role}@torneos-pure-context.local`,
      password,
    });
    if (error) throw error;
    clients[role] = supabase;
  }

  const organization = await rpc(
    clients.owner,
    'create_tournament_organization',
    {
      p_name: 'Liga Smoke Local',
      p_slug: 'liga-smoke-local',
      p_idempotency_key: '72000000-0000-4000-8000-000000000001',
    },
  );
  const organizationId = organization.organization.id;
  await database.query(
    `insert into public.tournament_organization_members (
       organization_id, user_id, role, status, joined_at
     ) values
       ($1, $2, 'admin', 'active', now()),
       ($1, $3, 'collaborator', 'active', now())
     on conflict (organization_id, user_id) do nothing`,
    [organizationId, identities.admin, identities.collaborator],
  );
  const season = await rpc(clients.owner, 'create_tournament_season', {
    p_organization_id: organizationId,
    p_name: 'Temporada Smoke',
    p_slug: 'temporada-smoke',
    p_start_date: null,
    p_end_date: null,
    p_idempotency_key: '72000000-0000-4000-8000-000000000002',
  });
  const tournament = await rpc(
    clients.owner,
    'create_tournament_with_defaults',
    {
      p_organization_id: organizationId,
      p_season_id: season.id,
      p_name: 'Copa Smoke',
      p_slug: 'copa-smoke',
      p_description: null,
      p_sport_modality: 'football_7',
      p_competition_format: 'league',
      p_gender_category: 'open',
      p_start_date: null,
      p_end_date: null,
      p_idempotency_key: '72000000-0000-4000-8000-000000000003',
    },
  );

  const snapshot = async () => JSON.stringify((await database.query(
    `select jsonb_build_object(
       'workspace', coalesce((
         select jsonb_agg(to_jsonb(preference) order by preference.user_id)
         from public.user_workspace_preferences preference
       ), '[]'::jsonb),
       'competition', coalesce((
         select jsonb_agg(to_jsonb(preference)
           order by preference.user_id, preference.organization_id)
         from public.user_tournament_context_preferences preference
       ), '[]'::jsonb)
     ) as value`,
  )).rows[0].value);

  const beforeReadOnlyNavigation = await snapshot();
  const workspaces = {};
  for (const role of Object.keys(identities)) {
    workspaces[role] = await rpc(
      clients[role],
      'get_tournament_workspace_context',
    );
  }
  eq(
    workspaces.owner.preference.activeOrganizationId,
    organizationId,
    'owner navega su workspace existente',
  );
  for (const role of ['admin', 'collaborator']) {
    ok(
      workspaces[role].organizations.some((item) => item.id === organizationId),
      `${role} navega el workspace autorizado`,
    );
  }
  for (const role of ['delegate', 'player', 'outsider']) {
    eq(
      workspaces[role].preference.workspaceType,
      'personal',
      `${role} recibe el contexto personal efectivo`,
    );
    eq(
      workspaces[role].organizations.length,
      0,
      `${role} no recibe organizaciones privadas`,
    );
  }

  const competitionContexts = {};
  for (const role of ['owner', 'admin', 'collaborator']) {
    competitionContexts[role] = await rpc(
      clients[role],
      'get_tournament_competition_context',
      { p_organization_id: organizationId },
    );
    eq(
      competitionContexts[role].preference.activeTournamentId,
      tournament.id,
      `${role} recibe el torneo efectivo`,
    );
  }
  const collaboratorCapabilities = workspaces.collaborator.organizations
    .find((item) => item.id === organizationId)?.capabilities || [];
  const managerCapabilities = [
    'organization.update',
    'members.manage',
    'seasons.create',
    'seasons.update',
    'seasons.archive',
    'tournaments.create',
    'tournaments.update',
    'tournaments.change_status',
    'tournaments.archive',
    'team_entries.review',
    'fixture.generate',
    'matches.manage',
    'standings.calculate',
  ];
  ok(
    managerCapabilities.every(
      (capability) => !collaboratorCapabilities.includes(capability),
    ),
    'collaborator no recibe herramientas/capabilities de manager',
  );
  const managedMatches = await rpc(
    clients.collaborator,
    'get_managed_tournament_matches',
  );
  eq(managedMatches.length, 0, 'collaborator conserva 0 partidos administrados');
  const managerRows = await clients.collaborator
    .from('tournament_team_managers')
    .select('id', { count: 'exact', head: true });
  if (managerRows.error) throw recordError(managerRows.error);
  eq(managerRows.count, 0, 'collaborator conserva 0 asignaciones de manager');
  const rosterRows = await clients.collaborator
    .from('tournament_roster_players')
    .select('id', { count: 'exact', head: true });
  if (rosterRows.error) throw recordError(rosterRows.error);
  eq(rosterRows.count, 0, 'collaborator conserva 0 filas de roster administrable');

  const outsiderCompetition = await clients.outsider.rpc(
    'get_tournament_competition_context',
    { p_organization_id: organizationId },
  );
  ok(Boolean(outsiderCompetition.error), 'outsider no accede al contexto privado');
  if (outsiderCompetition.error) recordError(outsiderCompetition.error);

  const afterReadOnlyNavigation = await snapshot();
  eq(
    afterReadOnlyNavigation,
    beforeReadOnlyNavigation,
    'ambas tablas de preferencias quedan byte-idénticas tras la navegación read-only',
  );

  await rpc(clients.admin, 'set_tournament_workspace_preference', {
    p_workspace_type: 'tournament_organization',
    p_organization_id: organizationId,
  });
  await rpc(clients.admin, 'set_active_tournament_context', {
    p_organization_id: organizationId,
    p_season_id: season.id,
    p_tournament_id: tournament.id,
  });
  const explicitRows = await database.query(
    `select
       (select count(*) from public.user_workspace_preferences
        where user_id = $1) as workspace_count,
       (select count(*) from public.user_tournament_context_preferences
        where user_id = $1 and organization_id = $2) as competition_count`,
    [identities.admin, organizationId],
  );
  eq(Number(explicitRows.rows[0].workspace_count), 1, 'el setter workspace persiste una sola fila');
  eq(Number(explicitRows.rows[0].competition_count), 1, 'el setter competitivo persiste una sola fila');
  eq(http500, 0, 'HTTP 500 durante el smoke: 0');

  await database.end();
  console.log(`\n${checks - failures}/${checks} verificaciones aprobadas.`);
  if (failures > 0) process.exitCode = 1;
}

await main();
