#!/usr/bin/env node
//
// Fixtures QA LOCAL de CONNECTED-V1 (Torneos como producto conectado): catálogo «Explorar torneos»,
// solicitudes de inscripción, bandeja del organizador y los perfiles que la revisión necesita y el
// dataset QA existente no tiene.
//
// Sólo contra el stack canónico `arma2-torneos-qa-seed` (loopback). Nada de esto existe en Production
// ni se parece a un torneo real: todo lleva el prefijo «QA», las identidades son
// `qa-connected-<rol>@localhost.invalid` con `qa_seed_key = torneos-connected-v1`, y los datos se crean
// con las RPC del producto actuando como cada identidad (las mismas reglas que la UI), no con inserts
// que las salteen. Las únicas escrituras directas son las que la UI no ofrece: el equipo de Core de
// cada capitán (la tabla de Core, como lo haría la app de Core) y la membresía revocada.
//
// No toca a las seis identidades QA existentes ni sus relaciones proyectadas. Los datos se escriben en una
// sola transacción: si algo falla no queda nada a medias (las identidades de Auth sí quedan, y se reutilizan).
// El dominio no permite borrar una organización (auditoría append-only), así que no hay «cleanup»: `--retire-local`
// retira las convocatorias y despublica las páginas QA con las mismas RPC que usaría el organizador.
//
//   node scripts/qa/seed-torneos-connected-fixtures.mjs                 (plan, no escribe)
//   QA_ALLOW_CONNECTED_FIXTURES=true node scripts/qa/seed-torneos-connected-fixtures.mjs --apply-local
//   QA_ALLOW_CONNECTED_FIXTURES=true node scripts/qa/seed-torneos-connected-fixtures.mjs --retire-local
//
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

import pg from 'pg';

import productionGuard from './production-guard.js';

const { assertLocalDatabaseTarget, assertSafeQaValue } = productionGuard;

const STACK_PROJECT = 'arma2-torneos-qa-seed';
const API_ORIGIN = 'http://127.0.0.1:57321';
const DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
export const CONNECTED_SEED_KEY = 'torneos-connected-v1';
const DOCKER_CANDIDATES = ['docker', '/Applications/Docker.app/Contents/Resources/bin/docker'];

export const CONNECTED_QA_IDENTITIES = Object.freeze({
  organizer: 'QA Organizador Conectado',
  applicant: 'QA Capitán Solicitante',
  dual: 'QA Dual Organiza y Juega',
  revoked: 'QA Acceso Revocado',
});

const ORGANIZATION = { name: 'QA Liga Conectada', slug: 'qa-liga-conectada' };
const DUAL_ORGANIZATION = { name: 'QA Club Dual', slug: 'qa-club-dual' };
const CORE_TEAMS = {
  applicant: ['QA Visitantes FC', 'QA Visitantes Senior'],
  dual: ['QA Dual FC', 'QA Dual Reserva'],
};

function resolveDocker() {
  for (const candidate of DOCKER_CANDIDATES) {
    try {
      execFileSync(candidate, ['version', '--format', '{{.Server.Version}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
      return candidate;
    } catch {
      // siguiente candidato
    }
  }
  throw new Error('No hay un Docker con daemon activo.');
}

// La service key del stack LOCAL vive en su propio container. No se imprime: sólo viaja al header de Auth Admin.
function resolveServiceKey() {
  const key = execFileSync(resolveDocker(), ['exec', `supabase_storage_${STACK_PROJECT}`, 'printenv', 'SERVICE_KEY'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (!key) throw new Error('El stack LOCAL no expone la service key.');
  return key;
}

function assertTarget() {
  const target = assertLocalDatabaseTarget({
    QA_SEED_ENV: 'local',
    QA_SEED_PROJECT_REF: 'local',
    QA_SEED_DATABASE_URL: DATABASE_URL,
  });
  assertSafeQaValue(API_ORIGIN, 'Auth LOCAL');
  for (const key of ['DATABASE_URL', 'SUPABASE_DB_URL', 'ARMA2_TARGET_DATABASE_URL']) {
    if (process.env[key] && process.env[key] !== DATABASE_URL) {
      throw new Error(`${key} declara otro destino; este seed sólo escribe en el stack QA LOCAL.`);
    }
  }
  return target;
}

const email = (role) => `qa-connected-${role}@localhost.invalid`;

async function ensureIdentity(admin, serviceKey, role) {
  const existing = await admin.query('select id, raw_app_meta_data from auth.users where lower(email) = $1', [email(role)]);
  if (existing.rowCount) {
    const meta = existing.rows[0].raw_app_meta_data || {};
    if (meta.qa_seed_key !== CONNECTED_SEED_KEY || meta.qa_role !== role) {
      throw new Error(`El email QA de ${role} pertenece a otra identidad: no se reutiliza.`);
    }
    return existing.rows[0].id;
  }
  const response = await fetch(`${API_ORIGIN}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: email(role),
      email_confirm: true,
      app_metadata: { qa_seed_key: CONNECTED_SEED_KEY, qa_role: role },
      user_metadata: { full_name: CONNECTED_QA_IDENTITIES[role] },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.id) throw new Error(`Auth LOCAL no creó la identidad ${role} (${response.status}).`);
  return body.id;
}

// Una sola conexión y una sola transacción: cada llamada se hace como la identidad que corresponde
// (claims + rol `authenticated` locales a la transacción) y las escrituras de Core vuelven al rol del dueño.
function session(client) {
  const actAs = async (userId) => {
    await client.query('reset role');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
  };
  return {
    as: (userId) => ({
      rpc: async (sql, params = []) => {
        await actAs(userId);
        try {
          return (await client.query(`select ${sql} as result`, params)).rows[0]?.result ?? null;
        } finally {
          await client.query('reset role');
        }
      },
    }),
    owner: (sql, params = []) => client.query(sql, params),
  };
}

async function createTournament(actor, organizationId, seasonId, spec) {
  const tournament = await actor.rpc(
    `public.create_tournament_with_defaults($1, $2, $3, $4, null, $5, 'league', $6, current_date + $7::int, current_date + $8::int, $9::uuid)`,
    [organizationId, seasonId, spec.name, spec.slug, spec.modality, spec.gender, spec.startsIn, spec.endsIn, randomUUID()]);
  const tournamentId = tournament.id || tournament.tournament?.id;
  const categories = {};
  for (const [index, category] of spec.categories.entries()) {
    const saved = await actor.rpc(
      "public.save_tournament_category($1, $2, null, $3, $4, null, $5, 18::smallint, null, null, $6, $7::smallint, 'active')",
      [organizationId, tournamentId, category.name, category.slug, index, spec.modality, spec.teamSize]);
    categories[category.slug] = saved.id || saved.category?.id;
  }
  await actor.rpc( 'public.update_tournament_configuration($1, $2, $3::jsonb)', [organizationId, tournamentId, JSON.stringify({
    registrationClosesAt: new Date(Date.now() + spec.registrationClosesInDays * 86_400_000).toISOString(),
  })]);
  await actor.rpc( "public.change_tournament_status($1, $2, 'registration')", [organizationId, tournamentId]);
  return { tournamentId, categories };
}

async function addRoster(actor, organizationId, teamEntryId, label) {
  const registration = await actor.rpc( 'public.get_team_registration_context($1, $2)', [organizationId, teamEntryId]);
  const rosterId = registration?.roster?.id || registration?.rosterId || registration?.currentRoster?.id;
  if (!rosterId) throw new Error('La inscripción no tiene plantel.');
  const names = ['Arquero', 'Defensor', 'Volante', 'Enganche', 'Delantero', 'Suplente'];
  for (const [index, role] of names.entries()) {
    const provisional = await actor.rpc( 'public.create_tournament_provisional_player($1, $2, $3)',
      [organizationId, teamEntryId, `QA ${role} ${label}`]);
    const provisionalId = provisional?.id || provisional?.provisionalPlayerId || provisional?.playerId;
    await actor.rpc(
      'public.add_tournament_roster_player($1, $2, $3, null, $4, $5, null, $6::smallint, $7, null, $8)',
      [organizationId, teamEntryId, rosterId, provisionalId, `QA ${role}`, index + 1, index === 0 ? 'ARQ' : 'MED', index === 0]);
  }
}

async function seed() {
  assertTarget();
  if (process.env.QA_ALLOW_CONNECTED_FIXTURES !== 'true') throw new Error('QA_ALLOW_CONNECTED_FIXTURES=true es obligatorio.');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const ready = (await client.query("select to_regclass('public.tournament_catalog_listings') is not null ready")).rows[0].ready;
    if (!ready) throw new Error('La migración CONNECTED-V1 (20261006120000) no está aplicada en el stack QA LOCAL.');
    const existing = await client.query('select id from public.tournament_organizations where slug = $1', [ORGANIZATION.slug]);
    if (existing.rowCount) return { status: 'already_seeded', organization: ORGANIZATION.slug };

    const serviceKey = resolveServiceKey();
    const ids = {};
    for (const role of Object.keys(CONNECTED_QA_IDENTITIES)) ids[role] = await ensureIdentity(client, serviceKey, role);

    await client.query('begin');
    const db = session(client);
    const organizer = db.as(ids.organizer);
    const dual = db.as(ids.dual);

    // Perfiles de Torneos: el organizador no tiene perfil deportivo en Core, sólo su nombre de Torneos.
    await organizer.rpc("public.update_my_torneos_profile('QA Organización Liga Conectada', true)");
    await dual.rpc("public.update_my_torneos_profile('QA Dual (capitán y organizador)', true)");

    // Organización principal, temporada activa y tres torneos con decisiones de publicación distintas.
    const organization = await organizer.rpc('public.create_tournament_organization($1, $2, $3::uuid)',
      [ORGANIZATION.name, ORGANIZATION.slug, randomUUID()]);
    const organizationId = organization.organization?.id || organization.id;
    const season = await organizer.rpc('public.create_tournament_season($1, $2, $3, null, null, $4::uuid)',
      [organizationId, 'QA Temporada Conectada', 'qa-temporada-conectada', randomUUID()]);
    const seasonId = season.id || season.season?.id;
    await organizer.rpc("public.update_tournament_season($1, $2, $3, $4, null, null, 'active', false, false)",
      [organizationId, seasonId, 'QA Temporada Conectada', 'qa-temporada-conectada']);

    const open = await createTournament(organizer, organizationId, seasonId, {
      name: 'QA Copa Abierta Palermo', slug: 'qa-copa-abierta-palermo', modality: 'football_5', gender: 'open', teamSize: 5,
      startsIn: 21, endsIn: 90, registrationClosesInDays: 14,
      categories: [{ name: 'Primera', slug: 'primera' }, { name: 'Intermedia', slug: 'intermedia' }],
    });
    const closed = await createTournament(organizer, organizationId, seasonId, {
      name: 'QA Nocturno Belgrano', slug: 'qa-nocturno-belgrano', modality: 'football_7', gender: 'male', teamSize: 7,
      startsIn: 10, endsIn: 60, registrationClosesInDays: 5,
      categories: [{ name: 'Libre', slug: 'libre' }],
    });
    const unlisted = await createTournament(organizer, organizationId, seasonId, {
      name: 'QA Torneo Sin Convocatoria', slug: 'qa-torneo-sin-convocatoria', modality: 'football_5', gender: 'open', teamSize: 5,
      startsIn: 30, endsIn: 80, registrationClosesInDays: 20,
      categories: [{ name: 'Única', slug: 'unica' }],
    });

    const pages = {};
    for (const [key, item] of Object.entries({ open, closed, unlisted })) {
      const page = await organizer.rpc('public.set_tournament_public_page_published($1, $2, true)', [organizationId, item.tournamentId]);
      pages[key] = page.publicSlug || page.public_slug || page.page?.publicSlug;
    }

    await organizer.rpc(
      "public.save_tournament_catalog_listing($1, $2, $3, 'Palermo, CABA', null, 1500000, $4, $5, $6, $7, 'team', null, null)",
      [organizationId, open.tournamentId,
        'QA · Torneo de fútbol 5 los sábados por la tarde. Fixture todos contra todos y final por categoría.',
        'Árbitro, pelota y seguro de la cancha',
        'QA · Se coordina con la organización. Arma2 no cobra la inscripción.',
        'DNI de cada jugador y una camiseta numerada por equipo.',
        'QA · Reglamento de fútbol 5 adaptado: 2 tiempos de 20 minutos, cambios ilimitados.']);
    await organizer.rpc('public.set_tournament_catalog_listing_status($1, $2, true)', [organizationId, open.tournamentId]);
    await organizer.rpc("public.set_tournament_applications_state($1, $2, 'open')", [organizationId, open.tournamentId]);
    await organizer.rpc('public.save_tournament_category_capacity($1, $2, $3, 8)', [organizationId, open.tournamentId, open.categories.primera]);
    await organizer.rpc('public.save_tournament_category_capacity($1, $2, $3, 4)', [organizationId, open.tournamentId, open.categories.intermedia]);

    await organizer.rpc(
      "public.save_tournament_catalog_listing($1, $2, $3, 'Belgrano, CABA', null, null, null, null, null, null, 'team', null, null)",
      [organizationId, closed.tournamentId, 'QA · Fútbol 7 nocturno de los miércoles. La organización todavía no recibe solicitudes.']);
    await organizer.rpc('public.set_tournament_catalog_listing_status($1, $2, true)', [organizationId, closed.tournamentId]);

    // Equipos de Core: los administran el capitán solicitante y el dual. La tabla es la de Core, como la crea su app.
    const coreTeams = {};
    for (const [role, names] of Object.entries(CORE_TEAMS)) {
      for (const name of names) {
        coreTeams[name] = (await db.owner(
          'insert into public.teams (owner_user_id, name, format, color_primary, color_secondary) values ($1, $2, 5, $3, $4) returning id',
          [ids[role], name, role === 'dual' ? '#0f766e' : '#1d4ed8', '#f8fafc'],
        )).rows[0].id;
      }
    }

    // El dual pide inscripción con sus equipos: una aprobada (Primera) y otra pendiente (Intermedia).
    const approved = await dual.rpc("public.start_tournament_application($1, 'primera', $2, null, $3, true, $4::uuid)",
      [pages.open, coreTeams['QA Dual FC'], 'QA · Jugamos juntos hace tres temporadas.', randomUUID()]);
    await addRoster(dual, organizationId, approved.teamEntryId, 'Dual FC');
    await dual.rpc('public.submit_tournament_team_entry($1, $2)', [organizationId, approved.teamEntryId]);
    await organizer.rpc("public.review_tournament_team_entry($1, $2, 'approved', 'QA · Bienvenidos a la Copa Abierta.', '[]'::jsonb)",
      [organizationId, approved.teamEntryId]);
    const pending = await dual.rpc("public.start_tournament_application($1, 'intermedia', $2, null, null, true, $3::uuid)",
      [pages.open, coreTeams['QA Dual Reserva'], randomUUID()]);
    await addRoster(dual, organizationId, pending.teamEntryId, 'Dual Reserva');
    await dual.rpc('public.submit_tournament_team_entry($1, $2)', [organizationId, pending.teamEntryId]);

    // El dual también organiza: su propio club, con un torneo en borrador y sin convocatoria.
    const dualOrganization = await dual.rpc('public.create_tournament_organization($1, $2, $3::uuid)',
      [DUAL_ORGANIZATION.name, DUAL_ORGANIZATION.slug, randomUUID()]);
    const dualOrganizationId = dualOrganization.organization?.id || dualOrganization.id;
    const dualSeason = await dual.rpc('public.create_tournament_season($1, $2, $3, null, null, $4::uuid)',
      [dualOrganizationId, 'QA Temporada Club Dual', 'qa-temporada-club-dual', randomUUID()]);
    const dualSeasonId = dualSeason.id || dualSeason.season?.id;
    await dual.rpc("public.update_tournament_season($1, $2, $3, $4, null, null, 'active', false, false)",
      [dualOrganizationId, dualSeasonId, 'QA Temporada Club Dual', 'qa-temporada-club-dual']);
    await dual.rpc(
      "public.create_tournament_with_defaults($1, $2, 'QA Torneo Interno Club Dual', 'qa-torneo-interno-club-dual', null, 'football_5', 'league', 'open', current_date + 40, current_date + 100, $3::uuid)",
      [dualOrganizationId, dualSeasonId, randomUUID()]);

    // Acceso perdido: fue colaborador de la organización principal y la organización lo quitó.
    await db.owner(
      `insert into public.tournament_organization_members (organization_id, user_id, role, status, invited_by, joined_at)
       values ($1, $2, 'collaborator', 'removed', $3, now() - interval '20 days')`,
      [organizationId, ids.revoked, ids.organizer],
    );

    await client.query('commit');
    return {
      status: 'seeded',
      seedKey: CONNECTED_SEED_KEY,
      roles: Object.keys(ids),
      organizations: [ORGANIZATION.slug, DUAL_ORGANIZATION.slug],
      catalog: { open: pages.open, closed: pages.closed, publicPageOnly: pages.unlisted },
      requests: { approved: 'QA Dual FC · Primera', pending: 'QA Dual Reserva · Intermedia' },
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------- etapa 2
// Lo que el cierre de #182 necesita reproducir: logo con y sin imagen, precio informado / no informado / gratuito,
// WhatsApp presente y ausente, y los equipos de Core del capitán solicitante que no puede inscribir (sólo integra uno;
// en otro fue administrador y lo bajaron a integrante). Idempotente: se marca con la convocatoria gratuita.
const FREE_CALL = { name: 'QA Liga Gratuita Caballito', slug: 'qa-liga-gratuita-caballito' };
// Formato válido, ninguna persona real detrás: wa.me responde que el número no usa WhatsApp.
const QA_WHATSAPP = '+54 9 11 0000 0000';

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

// Un escudo QA de 160×160 (círculo violeta con banda clara), PNG RGBA sin dependencias.
function qaCrestPng(size = 160) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const inside = dx * dx + dy * dy <= (size / 2 - 4) ** 2;
      const band = Math.abs(dy) < size / 10;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      const [r, g, b] = band ? [242, 238, 255] : [124, 77, 255];
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b; raw[offset + 3] = inside ? 255 : 0;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function uploadQaCrest(serviceKey, path) {
  const response = await fetch(`${API_ORIGIN}/storage/v1/object/tournament-branding/${path}`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'image/png', 'x-upsert': 'true' },
    body: qaCrestPng(),
  });
  if (!response.ok) throw new Error(`Storage LOCAL no aceptó el escudo QA (${response.status}).`);
}

async function seedStage2() {
  assertTarget();
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    if ((await client.query('select 1 from public.tournaments where slug = $1', [FREE_CALL.slug])).rowCount) {
      return { status: 'already_seeded' };
    }
    const ids = Object.fromEntries((await client.query(
      "select raw_app_meta_data->>'qa_role' role, id from auth.users where raw_app_meta_data->>'qa_seed_key' = $1",
      [CONNECTED_SEED_KEY],
    )).rows.map((row) => [row.role, row.id]));
    const organizationId = (await client.query('select id from public.tournament_organizations where slug = $1', [ORGANIZATION.slug])).rows[0]?.id;
    if (!organizationId || !ids.organizer || !ids.applicant || !ids.dual) throw new Error('Falta la etapa 1 de los fixtures.');
    const tournament = async (slug) => (await client.query('select id, season_id from public.tournaments where slug = $1 and organization_id = $2', [slug, organizationId])).rows[0];
    const open = await tournament('qa-copa-abierta-palermo');
    const serviceKey = resolveServiceKey();

    // El escudo se sube antes de la transacción (Storage no participa de ella); la referencia la asigna el organizador.
    const crestPath = `${organizationId}/tournaments/${open.id}/${randomUUID()}.png`;
    await uploadQaCrest(serviceKey, crestPath);

    await client.query('begin');
    const db = session(client);
    const organizer = db.as(ids.organizer);
    await organizer.rpc("public.set_tournament_branding_reference($1, 'tournament', $2, $3)", [organizationId, open.id, crestPath]);

    // Copa Abierta: precio por equipo + WhatsApp publicado con confirmación explícita.
    await organizer.rpc(
      "public.save_tournament_catalog_listing($1, $2, $3, 'Palermo, CABA', null, 1500000, $4, $5, $6, $7, 'team', $8, true)",
      [organizationId, open.id,
        'QA · Torneo de fútbol 5 los sábados por la tarde. Fixture todos contra todos y final por categoría.',
        'Árbitro, pelota y seguro de la cancha',
        'QA · Se coordina con la organización. Arma2 no cobra la inscripción.',
        'DNI de cada jugador y una camiseta numerada por equipo.',
        'QA · Reglamento de fútbol 5 adaptado: 2 tiempos de 20 minutos, cambios ilimitados.', QA_WHATSAPP]);

    // Una convocatoria gratuita, sin logo propio (usa las iniciales), abierta.
    const free = await createTournament(organizer, organizationId, open.season_id, {
      name: FREE_CALL.name, slug: FREE_CALL.slug, modality: 'football_5', gender: 'mixed', teamSize: 5,
      startsIn: 28, endsIn: 84, registrationClosesInDays: 18,
      categories: [{ name: 'Libre', slug: 'libre' }],
    });
    await organizer.rpc('public.set_tournament_public_page_published($1, $2, true)', [organizationId, free.tournamentId]);
    await organizer.rpc(
      "public.save_tournament_catalog_listing($1, $2, $3, 'Caballito, CABA', null, 0, null, null, null, null, 'team', null, null)",
      [organizationId, free.tournamentId, 'QA · Liga mixta de fútbol 5 los domingos. Participación gratuita, cupos limitados.']);
    await organizer.rpc('public.set_tournament_catalog_listing_status($1, $2, true)', [organizationId, free.tournamentId]);
    await organizer.rpc("public.set_tournament_applications_state($1, $2, 'open')", [organizationId, free.tournamentId]);
    await organizer.rpc('public.save_tournament_category_capacity($1, $2, $3, 6)', [organizationId, free.tournamentId, free.categories.libre]);

    // Equipos de Core del capitán solicitante que NO puede inscribir, como los crea la app de Core (dueño = dual).
    const coreMember = async (teamName, permissionsRole) => {
      const team = (await db.owner(
        "insert into public.teams (owner_user_id, name, format, color_primary, color_secondary) values ($1, $2, 5, '#0f766e', '#f8fafc') returning id",
        [ids.dual, teamName],
      )).rows[0].id;
      const partido = (await db.owner('insert into public.partidos default values returning id')).rows[0].id;
      const jugador = (await db.owner('insert into public.jugadores (partido_id, nombre, usuario_id) values ($1, $2, $3) returning id',
        [partido, CONNECTED_QA_IDENTITIES.applicant, ids.applicant])).rows[0].id;
      await db.owner("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.dual, role: 'authenticated' })]);
      const member = (await db.owner(
        'insert into public.team_members (team_id, jugador_id, user_id, permissions_role) values ($1, $2, $3, $4) returning id',
        [team, jugador, ids.applicant, permissionsRole],
      )).rows[0].id;
      return member;
    };
    await coreMember('QA Vecinos FC', 'member');
    const demoted = await coreMember('QA Ex Capitanía', 'admin');
    await db.owner("update public.team_members set permissions_role = 'member' where id = $1", [demoted]);

    await client.query('commit');
    return {
      status: 'seeded',
      crest: 'QA Copa Abierta Palermo (escudo QA); QA Nocturno Belgrano y la gratuita sin logo',
      prices: { informed: 'Copa Abierta · $15.000 por equipo', notInformed: 'Nocturno Belgrano', free: FREE_CALL.name },
      whatsapp: { present: 'Copa Abierta', absent: 'Nocturno Belgrano / gratuita' },
      applicantTeams: { canRegister: CORE_TEAMS.applicant, memberOnly: 'QA Vecinos FC', lostAuthority: 'QA Ex Capitanía' },
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

// Retira lo que es visible fuera de la organización (convocatorias y páginas públicas QA) con las RPC del
// organizador. Las identidades y la organización quedan: el dominio no borra organizaciones.
async function retire() {
  assertTarget();
  if (process.env.QA_ALLOW_CONNECTED_FIXTURES !== 'true') throw new Error('QA_ALLOW_CONNECTED_FIXTURES=true es obligatorio.');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const rows = (await client.query(
      `select tournament.organization_id, tournament.id, tournament.slug, organization.created_by
         from public.tournaments tournament
         join public.tournament_organizations organization on organization.id = tournament.organization_id
         join auth.users owner on owner.id = organization.created_by
        where organization.slug = any($1) and owner.raw_app_meta_data->>'qa_seed_key' = $2`,
      [[ORGANIZATION.slug, DUAL_ORGANIZATION.slug], CONNECTED_SEED_KEY],
    )).rows;
    await client.query('begin');
    const db = session(client);
    const retired = [];
    for (const row of rows) {
      const owner = db.as(row.created_by);
      const listed = (await client.query("select 1 from public.tournament_catalog_listings where tournament_id = $1 and status = 'listed'", [row.id])).rowCount;
      if (listed) await owner.rpc('public.set_tournament_catalog_listing_status($1, $2, false)', [row.organization_id, row.id]);
      const published = (await client.query("select 1 from public.tournament_public_pages where tournament_id = $1 and status = 'published'", [row.id])).rowCount;
      if (published) await owner.rpc('public.set_tournament_public_page_published($1, $2, false)', [row.organization_id, row.id]);
      if (listed || published) retired.push(row.slug);
    }
    await client.query('commit');
    return { status: 'retired', tournaments: retired };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--apply-local')) {
    if (process.env.QA_ALLOW_CONNECTED_FIXTURES !== 'true') throw new Error('QA_ALLOW_CONNECTED_FIXTURES=true es obligatorio.');
    return console.log(JSON.stringify({ stage1: await seed(), stage2: await seedStage2() }, null, 2));
  }
  if (args.has('--retire-local')) return console.log(JSON.stringify(await retire(), null, 2));
  console.log(JSON.stringify({
    status: 'plan', writes: false,
    target: `${STACK_PROJECT} (${API_ORIGIN})`,
    seedKey: CONNECTED_SEED_KEY,
    identities: Object.fromEntries(Object.entries(CONNECTED_QA_IDENTITIES).map(([role, name]) => [role, { email: email(role), name }])),
    organizations: [ORGANIZATION, DUAL_ORGANIZATION],
    usage: 'QA_ALLOW_CONNECTED_FIXTURES=true node scripts/qa/seed-torneos-connected-fixtures.mjs --apply-local | --retire-local',
  }, null, 2));
  return undefined;
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
