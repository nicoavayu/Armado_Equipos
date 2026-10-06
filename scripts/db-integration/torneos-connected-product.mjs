#!/usr/bin/env node
//
// CONNECTED-V1 — certificación en Postgres real de la composición LOCAL (legacy-local):
// catálogo público, solicitudes de inscripción, perfil de Torneos y bandeja de avisos.
//
// Corre contra un CLON DESCARTABLE de la base QA LOCAL, nunca contra la base que usan las
// apps (`postgres`): el destino tiene que ser loopback y la base tiene que llamarse
// `torneos_connected_test*`. Cada corrida crea sus propias identidades y datos con una
// etiqueta única, así que puede repetirse sobre el mismo clon.
//
//   docker exec supabase_db_arma2-torneos-qa-seed createdb -U postgres torneos_connected_test
//   docker exec supabase_db_arma2-torneos-qa-seed pg_dump -U postgres -d postgres > dump.sql
//   docker exec -i supabase_db_arma2-torneos-qa-seed psql -U postgres -d torneos_connected_test < dump.sql
//   CONNECTED_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:57322/torneos_connected_test \
//     node scripts/db-integration/torneos-connected-product.mjs
//
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261006120000_torneos_connected_product_v1.sql');
const DATABASE_URL = process.env.CONNECTED_TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/torneos_connected_test';
const TAG = randomUUID().slice(0, 8);

function assertDisposableTarget(raw) {
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error(`Destino no loopback: ${url.hostname}`);
  }
  if (!/^\/torneos_connected_test[a-z0-9_]*$/.test(url.pathname)) {
    throw new Error('La base tiene que ser un clon descartable torneos_connected_test*.');
  }
}

let checks = 0;
let failures = 0;
const clients = [];

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
    JSON.stringify(actual) === JSON.stringify(expected),
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

async function connect() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  clients.push(client);
  return client;
}

async function as(userId) {
  const client = await connect();
  if (userId) {
    await client.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
    ]);
    await client.query('set role authenticated');
  } else {
    await client.query('set role anon');
  }
  return client;
}

async function rpc(client, sql, params = []) {
  const row = (await client.query(`select ${sql} as result`, params)).rows[0];
  return row ? row.result : null;
}

function collectKeysAndValues(value, keys = new Set(), values = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeysAndValues(item, keys, values));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeysAndValues(child, keys, values);
    }
  } else if (typeof value === 'string') {
    values.push(value);
  }
  return { keys, values };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function createUser(admin, name) {
  const id = randomUUID();
  await admin.query(
    `insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(),
       '{"provider":"email","qa_role":"connected-test"}'::jsonb, jsonb_build_object('full_name', $3::text), now(), now())`,
    [id, `connected-${name}-${TAG}@localhost.invalid`, `Core ${name} ${TAG}`],
  );
  return id;
}

async function createCoreTeam(admin, ownerId, name) {
  return (await admin.query(
    'insert into public.teams (owner_user_id, name, format, color_primary, color_secondary) values ($1, $2, 5, $3, $4) returning id',
    [ownerId, name, '#112233', '#ddeeff'],
  )).rows[0].id;
}

async function addValidRoster(client, organizationId, teamEntryId) {
  const registration = await rpc(client, 'public.get_team_registration_context($1, $2)', [organizationId, teamEntryId]);
  const rosterId = registration?.roster?.id || registration?.rosterId || registration?.currentRoster?.id;
  if (!rosterId) throw new Error(`Sin roster en el contexto de inscripción: ${JSON.stringify(Object.keys(registration || {}))}`);
  for (let index = 1; index <= 5; index += 1) {
    const provisional = await rpc(
      client,
      'public.create_tournament_provisional_player($1, $2, $3)',
      [organizationId, teamEntryId, `Jugador ${index} ${TAG} ${teamEntryId.slice(0, 4)}`],
    );
    const provisionalId = provisional?.id || provisional?.provisionalPlayerId || provisional?.playerId;
    await rpc(
      client,
      'public.add_tournament_roster_player($1, $2, $3, null, $4, $5, null, $6::smallint, $7, null, $8)',
      [organizationId, teamEntryId, rosterId, provisionalId, `Jugador ${index}`, index, index === 1 ? 'ARQ' : 'MED', index === 1],
    );
  }
  return rosterId;
}

async function main() {
  assertDisposableTarget(DATABASE_URL);
  const admin = await connect();
  const database = (await admin.query('select current_database() db')).rows[0].db;
  if (!/^torneos_connected_test/.test(database)) throw new Error(`Base inesperada: ${database}`);

  const applied = (await admin.query("select to_regclass('public.tournament_catalog_listings') is not null applied")).rows[0].applied;
  if (!applied) {
    console.log('Aplicando la migración CONNECTED-V1 al clon…');
    await admin.query(fs.readFileSync(MIGRATION, 'utf8'));
  }

  console.log(`\nCONNECTED-V1 LOCAL · clon ${database} · corrida ${TAG}`);

  // ------------------------------------------------------------------ identidades
  const USERS = {};
  for (const name of ['organizer', 'reviewer', 'collaborator', 'applicant', 'applicant2', 'player', 'outsider', 'serial']) {
    USERS[name] = await createUser(admin, name);
  }
  const organizer = await as(USERS.organizer);
  const anon = await as(null);

  // ------------------------------------------------------------------ organización y torneo
  const organization = await rpc(organizer, 'public.create_tournament_organization($1, $2, $3::uuid)',
    [`Liga Conectada ${TAG}`, `liga-conectada-${TAG}`, randomUUID()]);
  const organizationId = organization.organization?.id || organization.id;
  const season = await rpc(organizer, 'public.create_tournament_season($1, $2, $3, null, null, $4::uuid)',
    [organizationId, `Temporada ${TAG}`, `temporada-${TAG}`, randomUUID()]);
  const seasonId = season.id || season.season?.id;
  await rpc(organizer,
    "public.update_tournament_season($1, $2, $3, $4, null, null, 'active', false, false)",
    [organizationId, seasonId, `Temporada ${TAG}`, `temporada-${TAG}`]);
  const tournament = await rpc(organizer,
    `public.create_tournament_with_defaults($1, $2, $3, $4, null, 'football_5', 'league', 'open', current_date + 30, current_date + 90, $5::uuid)`,
    [organizationId, seasonId, `Copa Abierta ${TAG}`, `copa-abierta-${TAG}`, randomUUID()]);
  const tournamentId = tournament.id || tournament.tournament?.id;
  const category = await rpc(organizer,
    "public.save_tournament_category($1, $2, null, 'Primera', 'primera', null, 0, 18::smallint, null, null, 'football_5', 5::smallint, 'active')",
    [organizationId, tournamentId]);
  const categoryId = category.id || category.category?.id;
  const category2 = await rpc(organizer,
    "public.save_tournament_category($1, $2, null, 'Senior', 'senior', null, 1, 35::smallint, null, null, 'football_5', 5::smallint, 'active')",
    [organizationId, tournamentId]);
  const category2Id = category2.id || category2.category?.id;
  await rpc(organizer, "public.change_tournament_status($1, $2, 'registration')", [organizationId, tournamentId]);
  const publicPage = await rpc(organizer, 'public.set_tournament_public_page_published($1, $2, true)', [organizationId, tournamentId]);
  const publicSlug = publicPage.publicSlug || publicPage.public_slug || publicPage.page?.publicSlug;
  ok(Boolean(publicSlug), 'la página pública del torneo QA quedó publicada');

  // Miembros: un admin con asiento en la temporada (revisa) y un colaborador (sólo lectura).
  for (const [name, role] of [['reviewer', 'admin'], ['collaborator', 'collaborator']]) {
    const membershipId = (await admin.query(
      `insert into public.tournament_organization_members (organization_id, user_id, role, status, invited_by, joined_at)
       values ($1, $2, $3, 'active', $4, now()) returning id`,
      [organizationId, USERS[name], role, USERS.organizer],
    )).rows[0].id;
    // El plan FREE admite un solo asiento de colaboración por temporada: lo ocupa el admin que revisa.
    if (role === 'admin') {
      await admin.query(
        'insert into public.tournament_season_member_assignments (organization_id, season_id, membership_id) values ($1, $2, $3)',
        [organizationId, seasonId, membershipId],
      );
    }
  }

  const coreTeamA = await createCoreTeam(admin, USERS.applicant, `Halcones ${TAG}`);
  const coreTeamB = await createCoreTeam(admin, USERS.applicant2, `Pumas ${TAG}`);
  const foreignTeam = await createCoreTeam(admin, USERS.outsider, `Ajeno ${TAG}`);

  // ------------------------------------------------------------------ 1. tres conceptos separados
  console.log('\n1. Página pública, catálogo y solicitudes son tres decisiones explícitas');
  const searchAll = async (filters = {}) => rpc(anon,
    'public.search_tournament_catalog($1, null, null, null, $2, null, null, null, null)',
    [filters.query ?? TAG, filters.scope ?? 'all']);
  eq((await searchAll()).total, 0, 'un torneo con página pública pero sin convocatoria no aparece en el catálogo');
  eq(await rpc(anon, 'public.get_tournament_catalog_entry($1)', [publicSlug]), null, 'ni tiene ficha de convocatoria');

  const collaborator = await as(USERS.collaborator);
  await expectError(() => rpc(collaborator,
    "public.save_tournament_catalog_listing($1, $2, 'Resumen colaborador', 'Palermo', null, null, null, null, null, null)",
    [organizationId, tournamentId]), /TORNEOS_RESOURCE_FORBIDDEN/, 'un colaborador no puede editar la convocatoria');
  const outsider = await as(USERS.outsider);
  await expectError(() => rpc(outsider, 'public.get_tournament_catalog_listing_settings($1, $2)', [organizationId, tournamentId]),
    /TORNEOS_RESOURCE_FORBIDDEN/, 'alguien ajeno no lee la configuración de la convocatoria');
  await expectError(() => rpc(anon, 'public.get_tournament_catalog_listing_settings($1, $2)', [organizationId, tournamentId]),
    /permission denied/, 'anon no puede ejecutar RPC de gestión');

  await expectError(() => rpc(organizer, 'public.set_tournament_catalog_listing_status($1, $2, true)', [organizationId, tournamentId]),
    /TORNEOS_CATALOG_LISTING_INCOMPLETE/, 'no se publica una convocatoria sin datos mínimos');
  await rpc(organizer,
    `public.save_tournament_catalog_listing($1, $2, 'Torneo de fútbol 5 los sábados en Palermo.', '  Palermo,   CABA ', null,
      1500000, 'Árbitro, pelota y seguro', 'Se coordina con la organización; Arma2 no cobra.', 'DNI de cada jugador', 'Reglamento FIFA adaptado.')`,
    [organizationId, tournamentId]);
  eq((await searchAll()).total, 0, 'guardar la convocatoria no la publica');

  await rpc(organizer, 'public.set_tournament_public_page_published($1, $2, false)', [organizationId, tournamentId]);
  await expectError(() => rpc(organizer, 'public.set_tournament_catalog_listing_status($1, $2, true)', [organizationId, tournamentId]),
    /TORNEOS_CATALOG_LISTING_NOT_READY/, 'sin página pública publicada no hay convocatoria en el catálogo');
  await rpc(organizer, 'public.set_tournament_public_page_published($1, $2, true)', [organizationId, tournamentId]);
  await rpc(organizer, 'public.set_tournament_catalog_listing_status($1, $2, true)', [organizationId, tournamentId]);
  let listed = await searchAll();
  eq(listed.total, 1, 'publicada, aparece una sola vez');
  eq(listed.items[0]?.state, 'closed', 'publicar en el catálogo no abre solicitudes');
  eq(listed.items[0]?.locality, 'Palermo, CABA', 'la localidad se normaliza al guardar');
  eq((await searchAll({ scope: 'open' })).total, 0, 'con «sólo abiertas» no aparece todavía');

  await rpc(organizer, "public.set_tournament_applications_state($1, $2, 'open')", [organizationId, tournamentId]);
  listed = await searchAll({ scope: 'open' });
  eq(listed.items[0]?.state, 'open', 'abrir solicitudes es la tercera decisión explícita');
  const entry = await rpc(anon, 'public.get_tournament_catalog_entry($1)', [publicSlug]);
  eq(entry.categories.map((item) => item.slug), ['primera', 'senior'], 'la ficha lista las categorías activas en orden');
  eq(entry.entryFee?.amountCents, 1500000, 'el costo se publica como dato, no como checkout');

  const { keys: publicKeys, values: publicValues } = collectKeysAndValues([listed, entry,
    await rpc(anon, 'public.get_tournament_catalog_facets()')]);
  const forbiddenKeys = ['email', 'roster', 'players', 'userId', 'organizationId', 'tournamentId', 'teamEntryId',
    'audit', 'createdBy', 'updatedBy', 'listedBy', 'phone', 'manager'];
  eq(forbiddenKeys.filter((key) => publicKeys.has(key)), [], 'la proyección pública no tiene claves privadas');
  eq(publicValues.filter((item) => UUID.test(item)), [], 'la proyección pública no expone identificadores internos');

  await rpc(organizer, 'public.set_tournament_public_page_published($1, $2, false)', [organizationId, tournamentId]);
  eq((await searchAll()).total, 0, 'despublicar la página saca la convocatoria del catálogo');
  await rpc(organizer, 'public.set_tournament_public_page_published($1, $2, true)', [organizationId, tournamentId]);
  eq((await searchAll()).total, 1, 'y vuelve con la página');

  await expectError(() => rpc(anon,
    "public.search_tournament_catalog(null, null, 'football_5; drop', null, null, null, null, null, null)"),
  /TORNEOS_CATALOG_INVALID_FILTER/, 'un filtro inválido se rechaza');
  await expectError(() => rpc(anon,
    "public.search_tournament_catalog(null, null, null, null, null, '2026-02-31', null, null, null)"),
  /TORNEOS_CATALOG_INVALID_FILTER/, 'una fecha inexistente se rechaza');

  // ------------------------------------------------------------------ 2. perfil de Torneos
  console.log('\n2. Perfil de Torneos: persistencia propia, sin escribir en Core');
  const applicant = await as(USERS.applicant);
  const coreNameBefore = (await admin.query('select nombre from public.usuarios where id = $1', [USERS.applicant])).rows[0]?.nombre ?? null;
  await expectError(() => rpc(applicant,
    'public.start_tournament_application($1, $2, $3, null, null, true, $4::uuid)',
    [publicSlug, 'primera', coreTeamA, randomUUID()]),
  /TORNEOS_PROFILE_NAME_REQUIRED/, 'pedir una inscripción exige un nombre de presentación de Torneos');
  const profile = await rpc(applicant, "public.update_my_torneos_profile('  Capi   Halcones ', true)");
  eq(profile.displayName, 'Capi Halcones', 'el nombre de Torneos se guarda normalizado');
  eq([profile.channels?.inbox, profile.channels?.push, profile.channels?.email], [true, false, false],
    'el perfil declara los canales que existen de verdad');
  const reloaded = await rpc(await as(USERS.applicant), 'public.get_my_torneos_profile()');
  eq(reloaded.displayName, 'Capi Halcones', 'recargar desde otra sesión conserva el perfil');
  const coreNameAfter = (await admin.query('select nombre from public.usuarios where id = $1', [USERS.applicant])).rows[0]?.nombre ?? null;
  eq(coreNameAfter, coreNameBefore, 'el nombre de Core no cambia');
  await expectError(() => rpc(applicant, "public.update_my_torneos_profile('x', true)"), /TORNEOS_PROFILE_INVALID/, 'un nombre de 1 letra se rechaza');
  await expectError(() => rpc(anon, "public.update_my_torneos_profile('Anon', true)"), /permission denied/, 'anon no tiene perfil');

  // ------------------------------------------------------------------ 3. solicitud con equipo autorizado
  console.log('\n3. Solicitud de inscripción con autoridad real sobre el equipo');
  await expectError(() => rpc(applicant,
    'public.start_tournament_application($1, $2, $3, null, null, false, $4::uuid)',
    [publicSlug, 'primera', coreTeamA, randomUUID()]),
  /TORNEOS_APPLICATION_CONDITIONS_REQUIRED/, 'sin aceptar las condiciones no se crea la solicitud');
  await expectError(() => rpc(applicant,
    'public.start_tournament_application($1, $2, $3, null, null, true, $4::uuid)',
    [publicSlug, 'primera', foreignTeam, randomUUID()]),
  /TORNEOS_TEAM_NOT_AUTHORIZED/, 'un equipo de Core ajeno no se puede inscribir (el teamId del cliente no autoriza)');
  const teams = await rpc(applicant, 'public.search_my_applicable_core_teams($1, $2, 8)', [publicSlug, TAG]);
  eq(teams.items.map((item) => item.id), [coreTeamA], 'la búsqueda sólo devuelve equipos de Core que la persona administra');

  const key = randomUUID();
  const started = await rpc(applicant,
    "public.start_tournament_application($1, $2, $3, null, 'Jugamos los sábados', true, $4::uuid)",
    [publicSlug, 'primera', coreTeamA, key]);
  eq(started.status, 'in_progress', 'la solicitud nace en preparación');
  const teamEntryId = started.teamEntryId;
  const replay = await rpc(applicant,
    "public.start_tournament_application($1, $2, $3, null, 'Jugamos los sábados', true, $4::uuid)",
    [publicSlug, 'primera', coreTeamA, key]);
  eq([replay.teamEntryId, replay.replayed], [teamEntryId, true], 'un reintento con la misma clave devuelve la misma solicitud');
  await expectError(() => rpc(applicant,
    'public.start_tournament_application($1, $2, $3, null, null, true, $4::uuid)',
    [publicSlug, 'primera', coreTeamA, randomUUID()]),
  /TORNEOS_TEAM_ALREADY_REGISTERED/, 'el mismo equipo no puede pedir dos veces la misma categoría');
  await expectError(() => rpc(applicant,
    'public.start_tournament_application($1, $2, null, $3, null, true, $4::uuid)',
    [publicSlug, 'primera', `halcones ${TAG}`, randomUUID()]),
  /TORNEOS_TEAM_NAME_TAKEN/, 'un equipo nuevo no puede repetir el nombre de otro de la categoría');

  const manager = (await admin.query(
    'select role, status, display_name from public.tournament_team_managers where team_entry_id = $1 and user_id = $2',
    [teamEntryId, USERS.applicant],
  )).rows[0];
  eq([manager.role, manager.status, manager.display_name], ['captain', 'active', 'Capi Halcones'],
    'el solicitante es capitán de esa inscripción, con su nombre de Torneos');
  eq(await rpc(applicant, "public.has_tournament_organization_capability($1, 'tournaments.read')", [organizationId]), false,
    'y no se convierte en miembro de la organización');
  const coreMembers = (await admin.query('select count(*)::int total from public.team_members where team_id = $1', [coreTeamA])).rows[0].total;
  eq(coreMembers, 0, 'importar el equipo no toca los miembros de Core');
  const rosterBefore = (await admin.query(
    "select count(*)::int total from public.tournament_roster_players where team_entry_id = $1", [teamEntryId])).rows[0].total;
  eq(rosterBefore, 0, 'nadie queda inscripto en el plantel automáticamente');

  const myRegistrations = await rpc(applicant, 'public.get_my_tournament_registrations(20, 0)');
  const mine = myRegistrations.items.find((item) => item.teamEntryId === teamEntryId);
  eq([mine?.status, mine?.source, mine?.publicSlug], ['in_progress', 'application', publicSlug], 'el solicitante sigue su solicitud');
  const memberships = await rpc(applicant, 'public.get_my_tournament_memberships(50, 0)');
  eq((memberships.items || []).some((item) => item.tournamentId === tournamentId), false,
    'una solicitud no es un torneo confirmado (no aparece en Mis torneos)');
  await expectError(() => rpc(applicant, 'public.get_tournament_participant_hub($1, null)', [tournamentId]),
    /TORNEOS_|permission|forbidden/i, 'ni da acceso al centro privado del torneo');

  await expectError(() => rpc(applicant, 'public.submit_tournament_team_entry($1, $2)', [organizationId, teamEntryId]),
    /TORNEOS_ROSTER_INCOMPLETE/, 'enviar exige completar los requisitos del plantel actuales');
  await addValidRoster(applicant, organizationId, teamEntryId);

  // ------------------------------------------------------------------ 4. cierres
  console.log('\n4. Solicitudes pausadas, cerradas o retiradas dejan de aceptar envíos');
  await rpc(organizer, "public.set_tournament_applications_state($1, $2, 'paused')", [organizationId, tournamentId]);
  await expectError(() => rpc(applicant, 'public.submit_tournament_team_entry($1, $2)', [organizationId, teamEntryId]),
    /TORNEOS_APPLICATIONS_CLOSED/, 'con solicitudes pausadas no se puede enviar (también por la RPC existente)');
  const applicant2 = await as(USERS.applicant2);
  await rpc(applicant2, "public.update_my_torneos_profile('Capi Pumas', true)");
  await expectError(() => rpc(applicant2,
    'public.start_tournament_application($1, $2, $3, null, null, true, $4::uuid)',
    [publicSlug, 'primera', coreTeamB, randomUUID()]),
  /TORNEOS_APPLICATIONS_CLOSED/, 'ni iniciar una nueva');
  await rpc(organizer, "public.set_tournament_applications_state($1, $2, 'open')", [organizationId, tournamentId]);
  await rpc(organizer, 'public.set_tournament_catalog_listing_status($1, $2, false)', [organizationId, tournamentId]);
  eq((await searchAll()).total, 0, 'retirar la convocatoria la saca del catálogo');
  await expectError(() => rpc(applicant, 'public.submit_tournament_team_entry($1, $2)', [organizationId, teamEntryId]),
    /TORNEOS_APPLICATIONS_CLOSED/, 'y bloquea los envíos');
  await rpc(organizer, 'public.set_tournament_catalog_listing_status($1, $2, true)', [organizationId, tournamentId]);
  eq((await searchAll()).items[0]?.state, 'paused', 'volver a publicar no reabre solicitudes solo');
  await rpc(organizer, "public.set_tournament_applications_state($1, $2, 'open')", [organizationId, tournamentId]);

  // ------------------------------------------------------------------ 5. envío y avisos
  console.log('\n5. Envío, bandeja del organizador y avisos de Torneos');
  const submitted = await rpc(applicant, 'public.submit_tournament_team_entry($1, $2)', [organizationId, teamEntryId]);
  eq(submitted.status, 'submitted', 'con requisitos completos la solicitud se envía');
  const reviewer = await as(USERS.reviewer);
  const organizerInbox = await rpc(organizer, 'public.get_my_torneos_notifications(false, 20, 0)');
  eq(organizerInbox.items.map((item) => item.kind), ['registration.submitted'], 'el organizador recibe «nueva solicitud»');
  const reviewerInbox = await rpc(reviewer, 'public.get_my_torneos_notifications(false, 20, 0)');
  eq(reviewerInbox.items.map((item) => item.kind), ['registration.submitted'], 'el admin con asiento en la temporada también');
  const collaboratorInbox = await rpc(collaborator, 'public.get_my_torneos_notifications(false, 20, 0)');
  eq(collaboratorInbox.items.length, 0, 'el colaborador sin permiso de revisión no');
  const applicantInbox = await rpc(applicant, 'public.get_my_torneos_notifications(false, 20, 0)');
  eq(applicantInbox.items.map((item) => item.kind), ['registration.received'], 'el solicitante recibe la confirmación');
  ok(/no confirma un cupo/.test(applicantInbox.items[0]?.body || ''), 'la confirmación aclara que no garantiza una plaza');

  const applicationInbox = await rpc(organizer, "public.get_tournament_application_inbox($1, $2, 'submitted', 20, 0)", [organizationId, tournamentId]);
  const inboxItem = applicationInbox.items[0];
  eq([inboxItem?.teamName, inboxItem?.categoryName, inboxItem?.responsible?.displayName, inboxItem?.roster?.valid],
    [`Halcones ${TAG}`, 'Primera', 'Capi Halcones', true], 'la bandeja muestra equipo, categoría, responsable y requisitos');
  eq(applicationInbox.counts.submitted, 1, 'con contador por estado');
  await rpc(applicant, "public.update_my_torneos_profile('Capi Halcones Rojo', true)");
  const renamedInbox = await rpc(organizer, "public.get_tournament_application_inbox($1, $2, 'submitted', 20, 0)", [organizationId, tournamentId]);
  eq(renamedInbox.items[0]?.responsible?.displayName, 'Capi Halcones Rojo', 'la bandeja muestra el nombre de Torneos vigente del responsable');
  await rpc(applicant, "public.update_my_torneos_profile('Capi Halcones', true)");
  await expectError(() => rpc(outsider, "public.get_tournament_application_inbox($1, $2, 'submitted', 20, 0)", [organizationId, tournamentId]),
    /TORNEOS_RESOURCE_FORBIDDEN/, 'alguien ajeno no lee la bandeja de solicitudes');

  // ------------------------------------------------------------------ 6. revisión
  console.log('\n6. Revisión: cambios, aprobación, cupo y acceso privado');
  await expectError(() => rpc(collaborator,
    "public.review_tournament_team_entry($1, $2, 'approved', 'Aprobado por colaborador', '[]'::jsonb)", [organizationId, teamEntryId]),
  /TORNEOS_RESOURCE_FORBIDDEN/, 'un colaborador no puede aprobar');
  await rpc(reviewer, "public.review_tournament_team_entry($1, $2, 'changes_requested', 'Falta el DNI del arquero', '[]'::jsonb)",
    [organizationId, teamEntryId]);
  const changes = await rpc(applicant, 'public.get_my_torneos_notifications(true, 20, 0)');
  eq(changes.items[0]?.kind, 'registration.changes_requested', 'el solicitante recibe el pedido de cambios');
  eq(changes.items[0]?.message, 'Falta el DNI del arquero', 'con el mensaje de la organización');
  await expectError(() => rpc(reviewer,
    "public.review_tournament_team_entry($1, $2, 'approved', 'Doble click', '[]'::jsonb)", [organizationId, teamEntryId]),
  /TORNEOS_RESOURCE_FORBIDDEN/, 'una decisión repetida sobre una solicitud ya respondida se rechaza');
  await rpc(applicant, 'public.submit_tournament_team_entry($1, $2)', [organizationId, teamEntryId]);
  await rpc(reviewer, "public.review_tournament_team_entry($1, $2, 'approved', 'Bienvenidos al torneo', '[]'::jsonb)",
    [organizationId, teamEntryId]);
  const approvedNotice = await rpc(applicant, 'public.get_my_torneos_notifications(true, 1, 0)');
  eq(approvedNotice.items[0]?.kind, 'registration.approved', 'el solicitante recibe la aprobación');
  const membershipsAfter = await rpc(applicant, 'public.get_my_tournament_memberships(50, 0)');
  eq((membershipsAfter.items || []).some((item) => item.tournamentId === tournamentId), true,
    'aprobada, el torneo aparece en Mis torneos del responsable');

  const playerClient = await as(USERS.player);
  eq(((await rpc(playerClient, 'public.get_my_tournament_memberships(50, 0)')).items || [])
    .some((item) => item.tournamentId === tournamentId), false, 'una persona fuera del plantel no ve el torneo aprobado');
  await expectError(() => rpc(playerClient, 'public.get_tournament_participant_hub($1, null)', [tournamentId]),
    /TORNEOS_|permission|forbidden/i, 'ni accede a su centro privado');

  // Cupo: lo consume una inscripción aprobada; la última plaza se disputa con dos aprobaciones simultáneas.
  await expectError(() => rpc(organizer, 'public.save_tournament_category_capacity($1, $2, $3, 1)', [organizationId, tournamentId, categoryId]),
    /TORNEOS_CATALOG_LISTING_INVALID/, 'un cupo menor a 2 equipos se rechaza');
  await rpc(organizer, 'public.save_tournament_category_capacity($1, $2, $3, 2)', [organizationId, tournamentId, categoryId]);
  const entryState = await rpc(anon, 'public.get_tournament_catalog_entry($1)', [publicSlug]);
  const primera = entryState.categories.find((item) => item.slug === 'primera');
  eq([primera.capacity, primera.approvedTeams, primera.accepting], [2, 1, true], 'la ficha muestra el cupo real: 1 de 2 ocupado');

  const pumas = await rpc(applicant2, 'public.start_tournament_application($1, $2, $3, null, null, true, $4::uuid)',
    [publicSlug, 'primera', coreTeamB, randomUUID()]);
  const serial = await as(USERS.serial);
  await rpc(serial, "public.update_my_torneos_profile('Capi Nuevo', true)");
  const nuevo = await rpc(serial, 'public.start_tournament_application($1, $2, null, $3, null, true, $4::uuid)',
    [publicSlug, 'primera', `Nuevo Equipo ${TAG}`, randomUUID()]);
  eq(nuevo.status, 'in_progress', 'un equipo nuevo también puede pedir inscripción (flujo explícito)');
  await addValidRoster(applicant2, organizationId, pumas.teamEntryId);
  await addValidRoster(serial, organizationId, nuevo.teamEntryId);
  await rpc(applicant2, 'public.submit_tournament_team_entry($1, $2)', [organizationId, pumas.teamEntryId]);
  await rpc(serial, 'public.submit_tournament_team_entry($1, $2)', [organizationId, nuevo.teamEntryId]);

  const organizerB = await as(USERS.organizer);
  const results = await Promise.allSettled([
    rpc(reviewer, "public.review_tournament_team_entry($1, $2, 'approved', 'Última plaza A', '[]'::jsonb)", [organizationId, pumas.teamEntryId]),
    rpc(organizerB, "public.review_tournament_team_entry($1, $2, 'approved', 'Última plaza B', '[]'::jsonb)", [organizationId, nuevo.teamEntryId]),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled').length;
  const fullRejections = results.filter((result) => result.status === 'rejected'
    && /TORNEOS_CATEGORY_FULL/.test(result.reason?.message)).length;
  eq([fulfilled, fullRejections], [1, 1], 'dos aprobaciones simultáneas por la última plaza: una entra, la otra recibe «cupo completo»');
  const approvedCount = (await admin.query(
    "select count(*)::int total from public.tournament_team_entries where tournament_id = $1 and category_id = $2 and status = 'approved'",
    [tournamentId, categoryId])).rows[0].total;
  eq(approvedCount, 2, 'nunca se aprueban más equipos que el cupo');
  const raceLoser = results[0].status === 'rejected' ? pumas.teamEntryId : nuevo.teamEntryId;
  eq((await admin.query('select status from public.tournament_team_entries where id = $1', [raceLoser])).rows[0].status,
    'submitted', 'la solicitud que perdió la carrera sigue pendiente, sin cupo');
  const outsiderApplicant = await as(USERS.outsider);
  await rpc(outsiderApplicant, "public.update_my_torneos_profile('Capi Tarde', true)");
  await expectError(() => rpc(outsiderApplicant, 'public.start_tournament_application($1, $2, null, $3, null, true, $4::uuid)',
    [publicSlug, 'primera', `Tarde ${TAG}`, randomUUID()]),
  /TORNEOS_CATEGORY_FULL/, 'con el cupo completo no se inician solicitudes en esa categoría');
  const senior = await rpc(outsiderApplicant, 'public.start_tournament_application($1, $2, null, $3, null, true, $4::uuid)',
    [publicSlug, 'senior', `Tarde ${TAG}`, randomUUID()]);
  eq(senior.status, 'in_progress', 'pero sí en otra categoría con lugar');

  // Sin cupo, la pendiente se aprueba; después, un cupo por debajo de las aprobadas se rechaza.
  await rpc(organizer, 'public.save_tournament_category_capacity($1, $2, $3, null)', [organizationId, tournamentId, categoryId]);
  await rpc(organizer, "public.review_tournament_team_entry($1, $2, 'approved', 'Ampliamos el cupo', '[]'::jsonb)",
    [organizationId, raceLoser]);
  await expectError(() => rpc(organizer, 'public.save_tournament_category_capacity($1, $2, $3, 2)', [organizationId, tournamentId, categoryId]),
    /TORNEOS_CAPACITY_BELOW_APPROVED/, 'un cupo menor que los equipos ya aprobados se rechaza');

  // Duplicados simultáneos del mismo equipo de Core: el lock por torneo serializa y el índice único decide.
  const applicant2b = await as(USERS.applicant2);
  const duplicateRace = await Promise.allSettled([
    rpc(applicant2, 'public.start_tournament_application($1, $2, $3, null, null, true, $4::uuid)', [publicSlug, 'senior', coreTeamB, randomUUID()]),
    rpc(applicant2b, 'public.start_tournament_application($1, $2, $3, null, null, true, $4::uuid)', [publicSlug, 'senior', coreTeamB, randomUUID()]),
  ]);
  eq([
    duplicateRace.filter((result) => result.status === 'fulfilled').length,
    duplicateRace.filter((result) => result.status === 'rejected' && /TORNEOS_TEAM_ALREADY_REGISTERED/.test(result.reason?.message)).length,
  ], [1, 1], 'dos solicitudes simultáneas del mismo equipo: sólo una se crea');

  const openOf = async () => (await admin.query(
    `select count(*)::int total from public.tournament_team_applications application
     join public.tournament_team_entries entry on entry.id = application.team_entry_id
     where application.applicant_user_id = $1 and application.tournament_id = $2
       and entry.status in ('draft', 'invited', 'in_progress', 'submitted', 'changes_requested')`,
    [USERS.serial, tournamentId])).rows[0].total;
  for (let index = await openOf(); index < 3; index += 1) {
    await rpc(serial, 'public.start_tournament_application($1, $2, null, $3, null, true, $4::uuid)',
      [publicSlug, 'senior', `Serial ${index} ${TAG}`, randomUUID()]);
  }
  eq(await openOf(), 3, 'una persona puede tener hasta 3 solicitudes abiertas por torneo');
  await expectError(() => rpc(serial, 'public.start_tournament_application($1, $2, null, $3, null, true, $4::uuid)',
    [publicSlug, 'senior', `Serial extra ${TAG}`, randomUUID()]),
  /TORNEOS_APPLICATION_LIMIT_REACHED/, 'la cuarta se rechaza');

  // ------------------------------------------------------------------ 7. permisos revocados y preferencias
  console.log('\n7. Permisos revocados, preferencias y lectura');
  await rpc(organizer, "public.update_my_torneos_profile('Organizadora', false)");
  const totalOf = async (client) => (await rpc(client, 'public.get_my_torneos_notifications(false, 50, 0)')).pagination.total;
  const organizerBefore = await totalOf(organizer);
  const reviewerBefore = await totalOf(reviewer);
  await addValidRoster(outsiderApplicant, organizationId, senior.teamEntryId);
  eq((await rpc(outsiderApplicant, 'public.submit_tournament_team_entry($1, $2)', [organizationId, senior.teamEntryId])).status,
    'submitted', 'otra solicitud se envía');
  eq(await totalOf(organizer), organizerBefore, 'con el aviso de nuevas solicitudes apagado, el organizador no recibe nuevos');
  eq(await totalOf(reviewer), reviewerBefore + 1, 'quien lo tiene encendido sí');

  const reviewerSummary = await rpc(reviewer, 'public.get_my_torneos_inbox_summary()');
  ok(reviewerSummary.notificationsUnread > 0, 'el admin tiene avisos de solicitudes sin leer');
  await admin.query(
    `delete from public.tournament_season_member_assignments assignment
     using public.tournament_organization_members membership
     where membership.id = assignment.membership_id and membership.user_id = $1 and assignment.season_id = $2`,
    [USERS.reviewer, seasonId]);
  const revokedSummary = await rpc(reviewer, 'public.get_my_torneos_inbox_summary()');
  eq(revokedSummary.notificationsUnread, 0, 'al perder el acceso a la temporada, sus avisos de la organización dejan de verse');
  await expectError(() => rpc(reviewer, "public.get_tournament_application_inbox($1, $2, 'all', 20, 0)", [organizationId, tournamentId]),
    /TORNEOS_RESOURCE_FORBIDDEN/, 'y no puede abrir la bandeja de solicitudes');

  await admin.query("update public.tournament_team_managers set status = 'revoked', revoked_at = now() where team_entry_id = $1 and user_id = $2",
    [pumas.teamEntryId, USERS.applicant2]);
  const revokedRegistrations = await rpc(applicant2, 'public.get_my_tournament_registrations(20, 0)');
  eq(revokedRegistrations.items.some((item) => item.teamEntryId === pumas.teamEntryId), false,
    'un responsable revocado deja de ver esa inscripción');

  const unread = await rpc(applicant, 'public.get_my_torneos_inbox_summary()');
  const marked = await rpc(applicant, 'public.mark_my_torneos_notifications_read(null)');
  eq([marked.updated, marked.summary.notificationsUnread], [unread.notificationsUnread, 0], 'marcar todo como leído vacía el contador de actividad');
  const foreignMark = await rpc(outsider, 'public.mark_my_torneos_notifications_read($1::uuid[])', [[approvedNotice.items[0].id]]);
  eq(foreignMark.updated, 0, 'nadie puede marcar avisos ajenos');

  // ------------------------------------------------------------------ 8. palanca de plataforma y ACL
  console.log('\n8. Retiro por la plataforma y ACL');
  await expectError(() => rpc(organizer, "public.platform_remove_tournament_catalog_listing($1, 'abuso')", [tournamentId]),
    /permission denied/, 'un organizador no puede usar la palanca de plataforma');
  const service = await connect();
  await service.query('set role service_role');
  await rpc(service, "public.platform_remove_tournament_catalog_listing($1, 'Publicación abusiva (QA)')", [tournamentId]);
  eq((await searchAll()).total, 0, 'una publicación retirada por la plataforma desaparece del catálogo');
  await expectError(() => rpc(organizer, 'public.set_tournament_catalog_listing_status($1, $2, true)', [organizationId, tournamentId]),
    /TORNEOS_CATALOG_LISTING_REMOVED/, 'y el organizador no puede volver a publicarla');
  for (const table of ['tournament_catalog_listings', 'tournament_user_profiles', 'tournament_user_notifications', 'tournament_team_applications']) {
    await expectError(() => applicant.query(`select * from public.${table} limit 1`), /permission denied/,
      `authenticated no lee ${table} directamente`);
    await expectError(() => anon.query(`select * from public.${table} limit 1`), /permission denied/, `anon no lee ${table}`);
  }

  console.log(`\n${checks - failures}/${checks} checks OK`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(clients.map((client) => client.end()));
  });
