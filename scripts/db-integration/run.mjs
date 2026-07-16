#!/usr/bin/env node
// Harness de integración real para la gestación automática de partidos.
// Levanta un Postgres embebido, aplica el stub de Supabase + las migraciones
// de auto-match en orden y ejecuta escenarios con conexiones concurrentes
// (una por usuario) llamando a los mismos RPCs que usa la app.
//
// Uso: npm run test:db

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
  '20260710101500_availability_auto_match_mvp.sql',
  '20260710113000_create_auto_match_proposal_rpc.sql',
  '20260711034500_auto_match_gestation_mvp.sql',
  '20260711150000_fix_auto_match_gestation_sync.sql',
  '20260711210000_auto_match_organizer_flow.sql',
  '20260712120000_auto_match_proposal_chat.sql',
  '20260712220000_auto_match_overbooking_confirmation_order.sql',
  '20260712230000_auto_match_substitutes.sql',
  '20260713120000_auto_match_roster_cap_and_promotion.sql',
  '20260713190000_auto_match_progressive_cohorts.sql',
  '20260714030000_auto_match_backend_initial_sweep.sql',
  '20260714223000_auto_match_response_and_real_overlap_fix.sql',
  '20260715003000_auto_match_materialization_schedule_fix.sql',
  '20260716120000_auto_match_real_conflict_slots_and_invite_capacity_race.sql',
];

const PORT = 54300 + Math.floor(Math.random() * 500);
const DB_NAME = 'arma2_auto_match';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-embedded-pg-'));

// 100 usuarios: alcanzan para el escenario de cohortes progresivas (100
// compatibles para el mismo slot) y para F11 (capacity 33) en los de plantel.
const USERS = Array.from({ length: 100 }, (_, index) => ({
  id: `00000000-0000-4000-8000-000000000${String(index + 1).padStart(3, '0')}`,
  nombre: `Jugador ${index + 1}`,
}));

let failures = 0;
let checks = 0;
const clients = [];

// Día ISO usado por los escenarios de cohortes. Se fija en main() a un día
// SIEMPRE ≥2 días en el futuro (independiente de cuándo corra la suite) para que
// el slot no caiga en la ventana de 90 min–2 h donde auto_match_invite_deadline
// (kickoff − 2 h) ya venció. Equivale al "mismo lunes 20:00" del pedido.
let COHORT_DAYS = [1];

const ok = (condition, label, extra = '') => {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

const eq = (actual, expected, label) => {
  ok(actual === expected, label, `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
};

const expectError = async (promise, pattern, label) => {
  try {
    await promise;
    ok(false, label, 'no lanzó error');
    return null;
  } catch (error) {
    const message = String(error?.message || error);
    ok(pattern.test(message), label, `error inesperado: ${message}`);
    return error;
  }
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

async function connect(uid = null) {
  const client = new pg.Client({
    host: '127.0.0.1',
    port: PORT,
    user: 'postgres',
    password: 'password',
    database: DB_NAME,
  });
  await client.connect();
  clients.push(client);
  if (uid) {
    await client.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await client.query('set role authenticated');
  }
  return client;
}

let admin;
const userClients = new Map();
const asUser = async (uid) => {
  if (!userClients.has(uid)) userClients.set(uid, await connect(uid));
  return userClients.get(uid);
};

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0] || null;
const val = async (client, sql, params = []) => {
  const row = await one(client, sql, params);
  return row ? Object.values(row)[0] : null;
};
const num = async (client, sql, params = []) => Number(await val(client, sql, params));

const FIXTURE_TIMEZONE = 'America/Argentina/Buenos_Aires';
const fixtureFutureSlotAt20 = (referenceInstant = null) => val(
  admin,
  `select (
     ((coalesce($1::timestamptz, now()) at time zone $2)::date + 3)
     + time '20:00'
   ) at time zone $2`,
  [referenceInstant, FIXTURE_TIMEZONE],
);

// Por defecto la disponibilidad es de UN día (sábado): así los escenarios que
// asumen "un solo slot" siguen valiendo. El sync multi-día se prueba aparte
// pasando `days` con varias jornadas.
const activate = async (uid, {
  canOrganize = false,
  formats = ['F5'],
  days = [6],
  lat = -34.60,
  lng = -58.40,
  maxKm = 8,
} = {}) => {
  const client = await asUser(uid);
  return one(
    client,
    `select * from public.upsert_my_availability(
       $1::smallint[], $2::time, $3::time, $4::text[], $5, $6, $7, $8::boolean)`,
    [days, '20:00', '23:00', formats, maxKm, lat, lng, canOrganize],
  );
};

const respond = async (uid, proposalId, response, canOrganize = false) => {
  const client = await asUser(uid);
  return one(
    client,
    'select * from public.respond_to_auto_match_proposal($1, $2, $3)',
    [proposalId, response, canOrganize],
  );
};

const sync = async (uid) => {
  const client = await asUser(uid);
  return (await client.query('select * from public.sync_my_auto_match_gestations()')).rows;
};

const respondSub = async (uid, proposalId, response) => {
  const client = await asUser(uid);
  return val(client, 'select public.respond_to_auto_match_substitute($1, $2)', [proposalId, response]);
};

const claim = async (uid, proposalId) => {
  const client = await asUser(uid);
  return one(client, 'select * from public.claim_auto_match_organizer($1)', [proposalId]);
};

const finalize = async (uid, proposalId, overrides = {}) => {
  const client = await asUser(uid);
  return one(
    client,
    `select * from public.finalize_auto_match_proposal(
       $1, $2, null, $3, 'Masculino', $4, $5, $6, $7, $8, $9)`,
    [
      proposalId,
      overrides.nombre ?? 'Partido harness F5',
      overrides.hora ?? null,
      overrides.precio ?? 8000,
      overrides.sede ?? 'Cancha Test',
      overrides.sedePlaceId ?? 'place-test-1',
      overrides.sedeDireccion ?? 'Av. Siempre Viva 742',
      overrides.lat ?? -34.6,
      overrides.lng ?? -58.4,
    ],
  );
};

// Siembra una propuesta 'ready' con N confirmados (orden de confirmación
// determinista) y opcionalmente algunos pendientes, lista para materializar.
// El organizador es USERS[0] (confirmado #1). Se usa para probar el tope del
// plantel (required + 4) sin la danza de activaciones reales.
const seedReadyProposal = async (format, acceptedCount, { pending = 0 } = {}) => {
  await resetData();
  const required = Number(format.slice(1)) * 2;
  const slot = await fixtureFutureSlotAt20();
  const slotDow = await num(
    admin,
    "select extract(isodow from ($1::timestamptz at time zone 'America/Argentina/Buenos_Aires'))",
    [slot],
  );
  const pid = await val(
    admin,
    `insert into public.auto_match_proposals
       (format, proposed_starts_at, max_players, status, expires_at, gestation_started_at, gestation_threshold, organizer_id)
     values ($1, $2, $3, 'ready', $2::timestamptz - interval '30 minutes', now(), 4, $4) returning id`,
    [format, slot, required, USERS[0].id],
  );
  for (let i = 0; i < acceptedCount + pending; i += 1) {
    const availId = await val(
      admin,
      "insert into public.player_availability (user_id, days_of_week, time_start, time_end, formats, latitude, longitude, status) values ($1, $2::smallint[], '00:00', '23:59', $3, -34.60, -58.40, 'active') returning id",
      [USERS[i].id, [slotDow], `{${format}}`],
    );
    if (i < acceptedCount) {
      await admin.query(
        `insert into public.auto_match_proposal_members (proposal_id, availability_id, user_id, response, responded_at, confirmed_at, can_organize)
         values ($1, $2, $3, 'accepted', now(), now() + make_interval(secs => $4::double precision), $5)`,
        [pid, availId, USERS[i].id, i * 0.01, i === 0],
      );
    } else {
      await admin.query(
        `insert into public.auto_match_proposal_members (proposal_id, availability_id, user_id, response, invite_expires_at)
         values ($1, $2, $3, 'pending', now() + interval '5 hours')`,
        [pid, availId, USERS[i].id],
      );
    }
  }
  return { pid, slot, required };
};

const activeProposal = () => one(
  admin,
  "select * from public.auto_match_proposals where status in ('collecting','ready') order by id desc limit 1",
);

const members = (proposalId) => admin
  .query('select * from public.auto_match_proposal_members where proposal_id = $1 order by user_id', [proposalId])
  .then((res) => res.rows);

const notifCount = (type, userId = null) => num(
  admin,
  `select count(*) from public.notifications where type = $1 and ($2::uuid is null or user_id = $2)`,
  [type, userId],
);

const eventCount = (proposalId, keyPattern) => num(
  admin,
  'select count(*) from public.auto_match_proposal_events where proposal_id = $1 and event_key like $2',
  [proposalId, keyPattern],
);

const resetData = async () => {
  await admin.query(`
    truncate table
      public.auto_match_proposal_events,
      public.auto_match_proposal_members,
      public.auto_match_proposals,
      public.player_availability,
      public.jugadores,
      public.notifications,
      public.notification_delivery_log,
      public.partidos
    restart identity cascade
  `);
};

// ---------------------------------------------------------------------------
// Escenario 1: activaciones simultáneas => exactamente una gestación, sin
// propuestas ni miembros duplicados.
// ---------------------------------------------------------------------------
async function scenarioConcurrentActivation() {
  console.log('\nEscenario 1: activaciones simultáneas');
  await resetData();

  for (const user of USERS.slice(0, 3)) await activate(user.id);
  eq(await num(admin, 'select count(*) from public.auto_match_proposals'), 0, 'bajo el umbral (3 activos) no se crea gestación');

  await Promise.all(USERS.slice(3, 10).map((user) => activate(user.id)));

  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready')"),
    1,
    '7 activaciones concurrentes producen exactamente 1 propuesta activa',
  );

  const proposal = await activeProposal();
  eq(proposal.format, 'F5', 'formato F5');
  eq(Number(proposal.max_players), 10, 'cupo 10');
  ok(proposal.latitude === null && proposal.longitude === null, 'la propuesta no guarda coordenadas');

  const rows = await members(proposal.id);
  ok(rows.length <= 10, `miembros ≤ cupo (${rows.length})`);
  eq(new Set(rows.map((row) => row.user_id)).size, rows.length, 'sin miembros duplicados');

  await Promise.all(USERS.slice(0, 10).map((user) => sync(user.id)));
  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready')"),
    1,
    're-sync masivo no duplica propuestas',
  );
  const rowsAfter = await members(proposal.id);
  eq(new Set(rowsAfter.map((row) => row.user_id)).size, rowsAfter.length, 're-sync no duplica miembros');
  eq(await eventCount(proposal.id, 'gestation_created'), 1, 'notificación de creación registrada una sola vez');
}

// ---------------------------------------------------------------------------
// Escenario 2: rechazo saca solo a esa persona + reemplazo + cupo completo sin
// organizador + claim concurrente + finalize concurrente + superposición.
// ---------------------------------------------------------------------------
async function scenarioFullLifecycle() {
  console.log('\nEscenario 2: ciclo completo (rechazo, reemplazo, claim, partido)');
  await resetData();

  for (const user of USERS.slice(0, 4)) await activate(user.id);
  await Promise.all(USERS.slice(4, 10).map((user) => activate(user.id)));

  const proposal = await activeProposal();
  const roster = await members(proposal.id);
  eq(roster.length, 10, 'roster convocado completo (10)');

  const creatorId = roster.find((row) => row.response === 'accepted')?.user_id;
  ok(Boolean(creatorId), 'quien creó la gestación quedó confirmado');
  const pendings = roster.filter((row) => row.response === 'pending').map((row) => row.user_id);
  eq(pendings.length, 9, '9 pendientes');

  // Aceptan 8 de los 9 pendientes (9 confirmados en total).
  for (const uid of pendings.slice(0, 8)) await respond(uid, proposal.id, 'accepted');
  const holdout = pendings[8];

  // Sobreconvocatoria: con capacity 15 (>10 titulares), un 11.º compatible SÍ
  // entra como convocado pendiente.
  await activate(USERS[10].id);
  eq(
    await num(admin, 'select count(*) from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, USERS[10].id]),
    1,
    'sobreconvocatoria: un 11.º compatible entra como convocado',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, USERS[10].id]),
    'pending',
    'el 11.º entra como pendiente',
  );

  // Rechazo: sale solo esa persona, entra el reemplazo, la propuesta sigue.
  await respond(holdout, proposal.id, 'declined');
  const afterDecline = await one(admin, 'select * from public.auto_match_proposals where id=$1', [proposal.id]);
  eq(afterDecline.status, 'collecting', 'rechazar NO cancela la propuesta');
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, holdout]),
    'declined',
    'solo quien rechazó figura como declined',
  );
  eq(
    await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='accepted'", [proposal.id]),
    9,
    'los 9 confirmados siguen intactos',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, USERS[10].id]),
    'pending',
    'el 11.º convocado sigue pendiente tras el rechazo',
  );
  eq(await notifCount('auto_match_gestating', USERS[10].id), 1, 'el 11.º convocado tiene una sola notificación de convocatoria');

  // El rechazo pertenece solo a esta gestación; no bloquea otras ocurrencias.
  const slot = afterDecline.proposed_starts_at;
  eq(
    await val(admin, "select public.user_declined_auto_match_slot($1,'F5',$2::timestamptz)", [holdout, slot]),
    false,
    'rechazar una gestación no consume esa ocurrencia',
  );
  eq(
    await val(admin, "select public.user_declined_auto_match_slot($1,'F5',$2::timestamptz + interval '7 days')", [holdout, slot]),
    false,
    'el bloqueo no alcanza a otra fecha (slot + 7 días)',
  );
  await sync(holdout);
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, holdout]),
    'declined',
    'el sync no re-invita a quien rechazó ese slot',
  );

  // Cupo completo sin voluntarios => ready + reserva de organización.
  await respond(USERS[10].id, proposal.id, 'accepted');
  const full = await one(admin, 'select * from public.auto_match_proposals where id=$1', [proposal.id]);
  eq(full.status, 'ready', 'cupo completo => ready');
  ok(full.organizer_id === null, 'sin voluntarios no se fuerza organizador');
  ok(full.organizer_deadline_at !== null, 'reserva de organización seteada');
  {
    const deadline = new Date(full.organizer_deadline_at).getTime();
    const expires = new Date(full.expires_at).getTime();
    const expected = Math.min(Date.now() + 12 * 3600 * 1000, expires);
    ok(Math.abs(deadline - expected) < 90 * 1000, 'deadline = least(now()+12h, expires_at)');
  }
  eq(await eventCount(proposal.id, 'ready_awaiting_organizer'), 1, 'aviso "falta organizador" registrado una vez');
  eq(await notifCount('auto_match_ready'), 10, 'los 10 confirmados fueron avisados');
  eq(await notifCount('auto_match_ready', holdout), 0, 'quien rechazó no recibe más avisos');

  // Claim concurrente: exactamente un organizador.
  const [claimA, claimB] = await Promise.allSettled([
    claim(USERS[1].id, proposal.id),
    claim(USERS[2].id, proposal.id),
  ]);
  const wins = [claimA, claimB].filter((result) => result.status === 'fulfilled');
  const losses = [claimA, claimB].filter((result) => result.status === 'rejected');
  eq(wins.length, 1, 'claim concurrente: exactamente 1 gana');
  eq(losses.length, 1, 'claim concurrente: exactamente 1 pierde');
  ok(/organizer_already_assigned/.test(String(losses[0]?.reason?.message || '')), 'el perdedor recibe organizer_already_assigned');

  const organizerId = wins[0].value.organizer_id;
  eq(
    await val(admin, 'select organizer_id from public.auto_match_proposals where id=$1', [proposal.id]),
    organizerId,
    'organizer_id persistido',
  );
  eq(await eventCount(proposal.id, 'organizer_assigned:%'), 1, 'notificación de organización registrada una vez');
  const organizingBefore = await notifCount('auto_match_organizing');

  // Re-claim del ganador es idempotente y no re-notifica.
  await claim(organizerId, proposal.id);
  eq(await notifCount('auto_match_organizing'), organizingBefore, 're-claim no duplica notificaciones');

  // Finalize concurrente: un único partido, doble toque devuelve el mismo.
  const [finalA, finalB] = await Promise.all([
    finalize(organizerId, proposal.id),
    finalize(organizerId, proposal.id),
  ]);
  ok(Boolean(finalA.partido_id) && String(finalA.partido_id) === String(finalB.partido_id), 'ambas llamadas devuelven el mismo partido');
  eq(await num(admin, 'select count(*) from public.partidos'), 1, 'se creó exactamente 1 partido');

  const partido = await one(admin, 'select * from public.partidos limit 1');
  eq(partido.creado_por, organizerId, 'el organizador es el creador/admin del partido');
  eq(partido.modalidad, 'F5', 'modalidad precompletada');
  eq(Number(partido.cupo_jugadores), 10, 'cupo precompletado');
  eq(partido.falta_jugadores, false, 'partido nace con cupo cerrado');
  ok(/^[A-Z0-9]{6}$/.test(partido.codigo || ''), 'código de partido generado');
  ok(Boolean(partido.sede) && Boolean(partido.sede_place_id), 'sede y place_id guardados');

  eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1', [partido.id]), 10, 'los 10 confirmados entraron como jugadores');
  eq(
    await num(admin, 'select count(distinct usuario_id) from public.jugadores where partido_id=$1', [partido.id]),
    10,
    'sin jugadores duplicados',
  );
  eq(
    await num(admin, 'select count(*) from public.jugadores where partido_id=$1 and usuario_id=$2', [partido.id, holdout]),
    0,
    'quien rechazó no entra al partido',
  );

  const finalProposal = await one(admin, 'select * from public.auto_match_proposals where id=$1', [proposal.id]);
  eq(finalProposal.status, 'created', 'propuesta en estado final created');
  eq(String(finalProposal.partido_id), String(partido.id), 'partido_id completado en la propuesta');
  eq(await eventCount(proposal.id, 'created'), 1, 'notificación de partido creado registrada una vez');
  eq(await notifCount('auto_match_created'), 10, 'los 10 jugadores avisados del partido definitivo');
  eq(
    await val(admin, "select data->>'route' from public.notifications where type='auto_match_created' limit 1"),
    `/partido-publico/${partido.id}`,
    'la notificación de creado deep-linkea al partido',
  );

  // Un partido real no consume disponibilidad ni impide otras gestaciones.
  await Promise.all(USERS.slice(0, 10).map((user) => sync(user.id)));
  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready')"),
    1,
    'sync posterior puede crear otra gestación aunque exista el partido real',
  );
  eq(
    await val(admin, 'select public.user_has_overlapping_auto_match($1, $2::timestamptz, null)', [USERS[1].id, slot]),
    false,
    'el helper de gestación no trata al partido real como reserva anticipada',
  );

  // Constraint de exclusión: dos propuestas activas en el mismo bucket es
  // imposible incluso salteando los RPCs.
  await admin.query(
    `insert into public.auto_match_proposals (format, proposed_starts_at, max_players, status, expires_at)
     values ('F5', $1::timestamptz + interval '2 days', 10, 'collecting', $1::timestamptz + interval '2 days' - interval '30 minutes')`,
    [slot],
  );
  await expectError(
    admin.query(
      `insert into public.auto_match_proposals (format, proposed_starts_at, max_players, status, expires_at)
       values ('F5', $1::timestamptz + interval '2 days' + interval '5 minutes', 10, 'collecting', $1::timestamptz + interval '2 days')`,
      [slot],
    ),
    /auto_match_proposals_slot_bucket_excl/,
    'la constraint de exclusión bloquea el mismo bucket horario',
  );
}

// ---------------------------------------------------------------------------
// Escenario 3: voluntario hereda intención desde la disponibilidad, el primer
// voluntario queda como organizador, y vencimientos notifican una sola vez.
// ---------------------------------------------------------------------------
async function scenarioVolunteersAndExpiry() {
  console.log('\nEscenario 3: voluntarios y vencimientos');
  await resetData();

  // user2 marca "puedo organizar" al activar su disponibilidad.
  await activate(USERS[0].id);
  await activate(USERS[1].id, { canOrganize: true });
  await activate(USERS[2].id);
  for (const user of USERS.slice(3, 10)) await activate(user.id);

  const proposal = await activeProposal();
  eq(
    await val(admin, 'select can_organize from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, USERS[1].id]),
    true,
    'la intención de organizar viaja de la disponibilidad al miembro',
  );

  const roster = await members(proposal.id);
  const creatorId = roster.find((row) => row.response === 'accepted').user_id;
  const pendings = roster.filter((row) => row.response === 'pending').map((row) => row.user_id);

  // user2 acepta con "Me sumo" plano: su intención heredada NO se pisa.
  if (pendings.includes(USERS[1].id)) {
    await respond(USERS[1].id, proposal.id, 'accepted', false);
    eq(
      await val(admin, 'select can_organize from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, USERS[1].id]),
      true,
      '"Me sumo" plano conserva la intención previa de organizar',
    );
  }

  // user6 acepta con "Me sumo y puedo organizar" (después de user2).
  const others = pendings.filter((uid) => uid !== USERS[1].id);
  await respond(others[0], proposal.id, 'accepted', true);
  for (const uid of others.slice(1)) await respond(uid, proposal.id, 'accepted', false);

  const full = await one(admin, 'select * from public.auto_match_proposals where id=$1', [proposal.id]);
  eq(full.status, 'ready', 'cupo completo => ready');
  ok(full.organizer_id === USERS[1].id, 'el PRIMER voluntario queda como organizador', `organizer=${full.organizer_id}`);
  ok(full.organizer_id !== creatorId || creatorId === USERS[1].id, 'nadie es organizador a la fuerza');
  eq(await eventCount(proposal.id, 'organizer_assigned:%'), 1, 'asignación notificada una sola vez');

  // Vencimiento de reserva de organización => cancelada con motivo específico.
  await resetData();
  for (const user of USERS.slice(0, 4)) await activate(user.id);
  const small = await activeProposal();
  await admin.query(
    "update public.auto_match_proposals set status='ready', organizer_deadline_at = now() - interval '1 minute' where id=$1",
    [small.id],
  );
  await sync(USERS[0].id);
  const cancelled = await one(admin, 'select * from public.auto_match_proposals where id=$1', [small.id]);
  eq(cancelled.status, 'cancelled', 'reserva vencida => cancelada');
  eq(cancelled.cancelled_reason, 'no_organizer', 'motivo específico no_organizer');
  eq(await eventCount(small.id, 'cancelled_no_organizer'), 1, 'cancelación notificada una vez');
  await Promise.all(USERS.slice(0, 4).map((user) => sync(user.id)));
  eq(await eventCount(small.id, 'cancelled_no_organizer'), 1, 'sweeps repetidos no duplican la notificación');

  // Vencimiento por expires_at => expirada y notificada una vez.
  const revived = await activeProposal();
  if (revived) {
    await admin.query("update public.auto_match_proposals set expires_at = now() - interval '1 minute' where id=$1", [revived.id]);
    await sync(USERS[1].id);
    eq(
      await val(admin, 'select status from public.auto_match_proposals where id=$1', [revived.id]),
      'expired',
      'propuesta vencida => expired',
    );
    eq(await eventCount(revived.id, 'expired'), 1, 'vencimiento notificado una vez');
  }
}

// ---------------------------------------------------------------------------
// Escenario 4: privacidad y RLS.
// ---------------------------------------------------------------------------
async function scenarioPrivacy() {
  console.log('\nEscenario 4: privacidad y RLS');
  await resetData();

  for (const user of USERS.slice(0, 4)) await activate(user.id);
  const proposal = await activeProposal();

  const member = await asUser(USERS[0].id);
  const outsider = await asUser(USERS[11].id);

  eq(
    await num(member, 'select count(*) from public.player_availability'),
    1,
    'RLS: cada usuario ve solo su propia disponibilidad',
  );
  eq(
    await num(outsider, 'select count(*) from public.auto_match_proposals'),
    0,
    'RLS: un no-miembro no ve la propuesta',
  );
  eq(
    await num(outsider, 'select count(*) from public.get_auto_match_proposal_members($1)', [proposal.id]),
    0,
    'roster invisible para no-miembros',
  );
  eq(
    await num(member, 'select count(*) from public.auto_match_proposal_events'),
    0,
    'el registro de eventos no es legible por clientes',
  );

  const mine = (await member.query('select * from public.get_my_auto_match_proposals()')).rows;
  eq(mine.length, 1, 'el miembro ve su gestación');
  const columns = Object.keys(mine[0]);
  ok(!columns.some((name) => /lat|lng|longitude|latitude/i.test(name)), 'el listado no expone coordenadas');

  const rosterRows = (await member.query('select * from public.get_auto_match_proposal_members($1)', [proposal.id])).rows;
  ok(rosterRows.length >= 4, 'el miembro ve el roster');
  ok(
    !Object.keys(rosterRows[0]).some((name) => /lat|lng|longitude|latitude|distance/i.test(name)),
    'el roster no expone ubicación de nadie',
  );
}

// ---------------------------------------------------------------------------
// Escenario 5: chat de la gestación. Confirmados, pendientes y organizador
// (miembros no declinados) leen (RLS) y escriben (RPC); rechazados y ajenos no.
// Al pasar de pendiente a rechazado se pierde el acceso al instante. Una
// gestación cerrada (cancelada/vencida) conserva el historial pero corta el
// envío. El partido regular sigue legible.
// ---------------------------------------------------------------------------
async function scenarioProposalChat() {
  console.log('\nEscenario 5: chat de la gestación (RLS + RPC)');
  await resetData();

  for (const user of USERS.slice(0, 6)) await activate(user.id);
  const proposal = await activeProposal();
  const roster = await members(proposal.id);
  const memberA = roster.find((row) => row.response === 'accepted').user_id;
  const memberB = roster.find((row) => row.response === 'pending').user_id;
  const outsiderId = USERS[11].id;

  const aClient = await asUser(memberA);
  const bClient = await asUser(memberB);
  const outsider = await asUser(outsiderId);

  await aClient.query(
    'select public.send_auto_match_proposal_chat_message($1, $2, $3)',
    [proposal.id, 'Jugador A', 'Hola equipo'],
  );
  eq(
    await num(aClient, 'select count(*) from public.mensajes_partido where proposal_id=$1', [proposal.id]),
    1,
    'un miembro escribe y lee el chat de su gestación',
  );
  eq(
    await num(bClient, 'select count(*) from public.mensajes_partido where proposal_id=$1', [proposal.id]),
    1,
    'otro miembro ve el mismo mensaje',
  );
  eq(
    await num(outsider, 'select count(*) from public.mensajes_partido where proposal_id=$1', [proposal.id]),
    0,
    'RLS: un no-miembro no ve el chat de la gestación',
  );
  await expectError(
    outsider.query('select public.send_auto_match_proposal_chat_message($1,$2,$3)', [proposal.id, 'Intruso', 'déjenme entrar']),
    /Sin permiso para enviar mensajes en esta gestación/i,
    'RPC: un no-miembro no puede escribir',
  );

  // Un pendiente (todavía sin responder) también forma parte: lee y escribe.
  await bClient.query(
    'select public.send_auto_match_proposal_chat_message($1, $2, $3)',
    [proposal.id, 'Jugador B', '¿A qué hora jugamos?'],
  );
  eq(
    await num(bClient, 'select count(*) from public.mensajes_partido where proposal_id=$1', [proposal.id]),
    2,
    'un miembro pendiente puede escribir en el chat',
  );
  eq(
    await num(aClient, 'select count(*) from public.mensajes_partido where proposal_id=$1', [proposal.id]),
    2,
    'los demás miembros reciben el mensaje del pendiente',
  );

  // Quien rechaza pierde acceso de lectura y escritura al instante.
  await respond(memberB, proposal.id, 'declined');
  eq(
    await num(bClient, 'select count(*) from public.mensajes_partido where proposal_id=$1', [proposal.id]),
    0,
    'quien rechazó deja de ver el chat',
  );
  await expectError(
    bClient.query('select public.send_auto_match_proposal_chat_message($1,$2,$3)', [proposal.id, 'Jugador B', '¿sigo?']),
    /Sin permiso para enviar mensajes en esta gestación/i,
    'quien rechazó no puede escribir',
  );

  // Gestación cerrada = solo lectura: se conserva el historial para los
  // miembros vivos, pero se corta el envío de mensajes nuevos.
  await admin.query("update public.auto_match_proposals set status='cancelled' where id=$1", [proposal.id]);
  eq(
    await num(aClient, 'select count(*) from public.mensajes_partido where proposal_id=$1', [proposal.id]),
    2,
    'una gestación cancelada conserva el historial para sus miembros',
  );
  await expectError(
    aClient.query('select public.send_auto_match_proposal_chat_message($1,$2,$3)', [proposal.id, 'Jugador A', '¿seguimos?']),
    /ya no admite mensajes nuevos/i,
    'RPC: una gestación cancelada no admite mensajes nuevos',
  );

  // Vencida (status 'expired') o pasada la ventana expires_at: mismo bloqueo.
  await admin.query("update public.auto_match_proposals set status='expired' where id=$1", [proposal.id]);
  await expectError(
    aClient.query('select public.send_auto_match_proposal_chat_message($1,$2,$3)', [proposal.id, 'Jugador A', 'último intento']),
    /ya no admite mensajes nuevos/i,
    'RPC: una gestación vencida no admite mensajes nuevos',
  );
  await admin.query("update public.auto_match_proposals set status='collecting', expires_at=now() - interval '1 minute' where id=$1", [proposal.id]);
  await expectError(
    aClient.query('select public.send_auto_match_proposal_chat_message($1,$2,$3)', [proposal.id, 'Jugador A', 'fuera de hora']),
    /ya no admite mensajes nuevos/i,
    'RPC: pasado expires_at no se envía aunque el estado siga collecting',
  );
  eq(
    await num(aClient, 'select count(*) from public.mensajes_partido where proposal_id=$1', [proposal.id]),
    2,
    'el historial permanece legible para el miembro en la gestación cerrada',
  );

  // El chat de partido regular (proposal_id + team_match_id en NULL) sigue legible.
  await admin.query(
    "insert into public.mensajes_partido (partido_id, autor, mensaje) values (999, 'Sistema', 'partido regular')",
  );
  ok(
    (await num(outsider, 'select count(*) from public.mensajes_partido where partido_id=999')) >= 1,
    'los mensajes de partido regular siguen siendo legibles',
  );
}

// ---------------------------------------------------------------------------
// Escenario 6: VARIAS gestaciones simultáneas. Una disponibilidad sáb+dom
// genera una gestación el sábado Y otra el domingo; el mismo jugador está en
// ambas. Una propuesta no bloquea la otra (causa concreta del bug anterior).
// ---------------------------------------------------------------------------
async function scenarioMultipleProposals() {
  console.log('\nEscenario 6: varias gestaciones simultáneas (multi-día)');
  await resetData();

  for (const user of USERS.slice(0, 6)) await activate(user.id, { days: [6, 7] });

  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready')"),
    2,
    'una disponibilidad sáb+dom produce exactamente 2 gestaciones (una por día)',
  );
  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready') and extract(isodow from (proposed_starts_at at time zone 'America/Argentina/Buenos_Aires')) = 6"),
    1,
    'exactamente una gestación el sábado (sin duplicar la sala)',
  );
  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready') and extract(isodow from (proposed_starts_at at time zone 'America/Argentina/Buenos_Aires')) = 7"),
    1,
    'exactamente una gestación el domingo',
  );
  eq(
    await num(admin, 'select count(distinct proposal_id) from public.auto_match_proposal_members where user_id=$1 and response<>$2', [USERS[0].id, 'declined']),
    2,
    'el mismo jugador participa de las 2 gestaciones (una no bloquea la otra)',
  );

  // Distinto FORMATO tampoco se bloquea entre sí: agrego F7 a la disponibilidad.
  await resetData();
  for (const user of USERS.slice(0, 6)) await activate(user.id, { days: [6], formats: ['F5', 'F7'] });
  const formatsSeen = (await admin.query(
    "select distinct format from public.auto_match_proposals where status in ('collecting','ready') order by format",
  )).rows.map((row) => row.format);
  ok(formatsSeen.includes('F5') && formatsSeen.includes('F7'), 'se gestan F5 y F7 en paralelo (distinto formato no bloquea)', JSON.stringify(formatsSeen));
}

// ---------------------------------------------------------------------------
// Escenario 7: sobreconvocatoria (capacity 15 para F5) + orden de confirmación
// (primeros 10 titulares, resto suplentes) por confirmed_at del servidor.
// ---------------------------------------------------------------------------
async function scenarioOverbookingAndOrder() {
  console.log('\nEscenario 7: sobreconvocatoria + orden de confirmación');
  await resetData();

  eq(await num(admin, "select public.auto_match_invitation_capacity('F5')"), 15, 'capacity F5 = ceil(10*1.5) = 15');
  eq(await num(admin, "select public.auto_match_invitation_capacity('F7')"), 21, 'capacity F7 = ceil(14*1.5) = 21');

  for (const user of USERS.slice(0, 15)) await activate(user.id);
  const proposal = await activeProposal();
  eq(
    await num(admin, 'select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response<>$2', [proposal.id, 'declined']),
    15,
    'la sala convoca hasta 15 (capacity), no se corta en 10',
  );

  // El 16.º compatible ya no entra: la sala llegó a su capacidad.
  await activate(USERS[15].id);
  eq(
    await num(admin, 'select count(*) from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, USERS[15].id]),
    0,
    'un 16.º compatible no entra: capacity llena',
  );

  // Confirman todos, en orden. El creador ya estaba confirmado (rank 1).
  const roster = await members(proposal.id);
  const creatorId = roster.find((row) => row.response === 'accepted').user_id;
  const pendings = roster.filter((row) => row.response === 'pending').map((row) => row.user_id);
  const confirmOrder = [creatorId];
  for (const uid of pendings) { await respond(uid, proposal.id, 'accepted'); confirmOrder.push(uid); }

  const memberClient = await asUser(creatorId);
  const seatRows = (await memberClient.query(
    'select user_id, seat, confirmed_at from public.get_auto_match_proposal_members($1) where response=$2 order by confirmed_at asc nulls last, user_id',
    [proposal.id, 'accepted'],
  )).rows;
  eq(seatRows.filter((row) => row.seat === 'titular').length, 10, 'exactamente 10 titulares (formato*2)');
  eq(seatRows.filter((row) => row.seat === 'suplente').length, 5, 'los otros 5 confirmados son suplentes');
  eq(String(seatRows[0].user_id), String(creatorId), 'el primero en confirmar (creador) es titular #1');
  eq(seatRows[9].seat, 'titular', 'la confirmación 10 es titular');
  eq(seatRows[10].seat, 'suplente', 'la confirmación 11 pasa a suplente');
}

// ---------------------------------------------------------------------------
// Escenario 8: confirmaciones simultáneas nunca producen 11 titulares.
// ---------------------------------------------------------------------------
async function scenarioConcurrentConfirmations() {
  console.log('\nEscenario 8: confirmaciones simultáneas');
  await resetData();

  for (const user of USERS.slice(0, 12)) await activate(user.id);
  const proposal = await activeProposal();
  const roster = await members(proposal.id);
  const creatorId = roster.find((row) => row.response === 'accepted').user_id;
  const pendings = roster.filter((row) => row.response === 'pending').map((row) => row.user_id);

  // Llega a 9 confirmados (creador + 8).
  for (const uid of pendings.slice(0, 8)) await respond(uid, proposal.id, 'accepted');
  eq(
    await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='accepted'", [proposal.id]),
    9,
    '9 confirmados antes de la carrera',
  );

  // Dos confirman EXACTAMENTE a la vez: el 10.º y el 11.º.
  const [c1, c2] = await Promise.allSettled([
    respond(pendings[8], proposal.id, 'accepted'),
    respond(pendings[9], proposal.id, 'accepted'),
  ]);
  ok(c1.status === 'fulfilled' && c2.status === 'fulfilled', 'ninguna confirmación simultánea falla con error genérico');
  eq(
    await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='accepted'", [proposal.id]),
    11,
    'quedan 11 confirmados',
  );

  const memberClient = await asUser(creatorId);
  const seats = (await memberClient.query(
    "select seat, count(*)::int as n from public.get_auto_match_proposal_members($1) where response='accepted' group by seat",
    [proposal.id],
  )).rows;
  const titulares = Number(seats.find((row) => row.seat === 'titular')?.n || 0);
  const suplentes = Number(seats.find((row) => row.seat === 'suplente')?.n || 0);
  eq(titulares, 10, 'nunca hay 11 titulares: exactamente 10');
  eq(suplentes, 1, 'el 11.º confirmado queda suplente');
}

// ---------------------------------------------------------------------------
// Escenario 9: vencimiento individual de la invitación (backend, sin app).
// ---------------------------------------------------------------------------
async function scenarioInviteExpiry() {
  console.log('\nEscenario 9: vencimiento individual de invitaciones');
  await resetData();

  // La fecha límite es min(invited+10h, kickoff-2h).
  {
    const farKickoff = await one(admin, "select public.auto_match_invite_deadline(now(), now() + interval '20 hours') as d, now() + interval '10 hours' as ref");
    ok(Math.abs(new Date(farKickoff.d).getTime() - new Date(farKickoff.ref).getTime()) < 90 * 1000, 'partido lejano => vence a las 10 h de invitado');
    const soonKickoff = await one(admin, "select public.auto_match_invite_deadline(now(), now() + interval '5 hours') as d, now() + interval '3 hours' as ref");
    ok(Math.abs(new Date(soonKickoff.d).getTime() - new Date(soonKickoff.ref).getTime()) < 90 * 1000, 'partido próximo => vence 2 h antes del comienzo (límite menor)');
  }

  for (const user of USERS.slice(0, 5)) await activate(user.id);
  const proposal = await activeProposal();
  const roster = await members(proposal.id);
  const pending = roster.find((row) => row.response === 'pending').user_id;

  // Una invitación vigente permite confirmar; se comprueba antes de vencer.
  const stillValid = roster.filter((row) => row.response === 'pending').map((row) => row.user_id)[1];
  await respond(stillValid, proposal.id, 'accepted');
  eq(
    await val(admin, "select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2", [proposal.id, stillValid]),
    'accepted',
    'invitación vigente permite confirmar',
  );

  // Vence la invitación de `pending` (sin pantalla abierta: barrido backend).
  await admin.query(
    "update public.auto_match_proposal_members set invite_expires_at = now() - interval '1 minute' where proposal_id=$1 and user_id=$2",
    [proposal.id, pending],
  );
  const expiredCount = await num(admin, 'select public.expire_stale_auto_match_invites()');
  ok(expiredCount >= 1, 'el barrido backend vence al menos una invitación');
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, pending]),
    'expired',
    'la invitación vencida queda en estado expired (no declined)',
  );
  eq(
    await val(admin, 'select public.user_declined_auto_match_slot($1, $2, $3::timestamptz)', [pending, 'F5', proposal.proposed_starts_at]),
    false,
    'un vencimiento no cuenta como rechazo voluntario (no bloquea el slot)',
  );
  eq(
    await val(admin, 'select public.auto_match_user_in_proposal($1, $2)', [proposal.id, pending]),
    false,
    'el vencido pierde acceso al chat de la gestación',
  );
  await expectError(
    (await asUser(pending)).query('select * from public.respond_to_auto_match_proposal($1,$2,$3)', [proposal.id, 'accepted', false]),
    /proposal_member_expired/,
    'una invitación vencida no permite confirmar después',
  );
  eq(await notifCount('auto_match_invite_expired', pending), 1, 'el vencido recibe una única notificación de vencimiento');
}

// ---------------------------------------------------------------------------
// Escenario 10: un jugador pendiente en dos propuestas que se pisan puede
// confirmar una sin que la respuesta modifique la otra.
// ---------------------------------------------------------------------------
async function scenarioOverlapWithdrawal({
  referenceInstant = null,
  title = 'Escenario 10: gestaciones superpuestas independientes al confirmar',
} = {}) {
  console.log(`\n${title}`);
  await resetData();

  const slot = await fixtureFutureSlotAt20(referenceInstant);
  const slotDow = await num(
    admin,
    "select extract(isodow from ($1::timestamptz at time zone 'America/Argentina/Buenos_Aires'))",
    [slot],
  );

  if (referenceInstant) {
    const boundary = await one(
      admin,
      `select
         to_char($1::timestamptz at time zone $3, 'HH24:MI') as local_start,
         extract(epoch from (
           time '23:59' - ($1::timestamptz at time zone $3)::time
         )) / 60 as available_minutes,
         $1::timestamptz > $2::timestamptz as remains_future`,
      [slot, referenceInstant, FIXTURE_TIMEZONE],
    );
    eq(boundary.local_start, '20:00', 'el fixture fija el inicio a las 20:00 de Argentina');
    ok(Number(boundary.available_minutes) > 60, 'el fixture conserva más de 60 minutos disponibles');
    eq(boundary.remains_future, true, 'el slot sigue en el futuro al simular una ejecución a medianoche');
  }

  const avail = {};
  for (const user of USERS.slice(0, 6)) {
    avail[user.id] = await val(
      admin,
      "insert into public.player_availability (user_id, days_of_week, time_start, time_end, formats, latitude, longitude, status) values ($1, $2::smallint[], '00:00', '23:59', '{F5,F7}', -34.60, -58.40, 'active') returning id",
      [user.id, [slotDow]],
    );
  }

  const p1 = await val(
    admin,
    "insert into public.auto_match_proposals (format, proposed_starts_at, max_players, status, expires_at, gestation_started_at, gestation_threshold) values ('F5', $1, 10, 'collecting', $1::timestamptz - interval '30 minutes', now(), 4) returning id",
    [slot],
  );
  const p2 = await val(
    admin,
    "insert into public.auto_match_proposals (format, proposed_starts_at, max_players, status, expires_at, gestation_started_at, gestation_threshold) values ('F7', $1, 14, 'collecting', $1::timestamptz - interval '30 minutes', now(), 4) returning id",
    [slot],
  );

  // USERS[0] pendiente en ambas; USERS[1..4] confirmados en ambas (para que P2
  // siga por encima del umbral cuando USERS[0] se retire).
  for (const pid of [p1, p2]) {
    await admin.query(
      "insert into public.auto_match_proposal_members (proposal_id, availability_id, user_id, response, invite_expires_at) values ($1, $2, $3, 'pending', now() + interval '9 hours')",
      [pid, avail[USERS[0].id], USERS[0].id],
    );
    for (const user of USERS.slice(1, 5)) {
      await admin.query(
        "insert into public.auto_match_proposal_members (proposal_id, availability_id, user_id, response, confirmed_at) values ($1, $2, $3, 'accepted', now())",
        [pid, avail[user.id], user.id],
      );
    }
  }

  await respond(USERS[0].id, p1, 'accepted');
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [p1, USERS[0].id]),
    'accepted',
    'confirma la propuesta elegida',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [p2, USERS[0].id]),
    'pending',
    'permanece en la propuesta superpuesta',
  );
  eq(
    await val(admin, 'select status from public.auto_match_proposals where id=$1', [p2]),
    'collecting',
    'la propuesta superpuesta sigue viva para el resto',
  );
}

// ---------------------------------------------------------------------------
// Regresion 14-jul: una ventana 20-23 con F5/F7 admite todas las gestaciones;
// ninguna respuesta consume disponibilidad ni emite cancelaciones falsas.
// ---------------------------------------------------------------------------
async function scenarioConcreteScheduleOverlapAndIdempotency() {
  console.log('\nEscenario 10b: horarios concretos, snapshots e idempotencia');
  await resetData();

  const localDate = await val(
    admin,
    "select (current_date + 3)::date",
  );
  const localDow = await num(admin, 'select extract(isodow from $1::date)', [localDate]);
  const slot20 = await val(
    admin,
    "select ($1::date + time '20:00') at time zone 'America/Argentina/Buenos_Aires'",
    [localDate],
  );

  const availability = {};
  for (const user of USERS.slice(0, 16)) {
    availability[user.id] = await seedAvailability(user.id, {
      days: [localDow], formats: ['F5', 'F7'], start: '20:00', end: '23:00',
    });
  }

  const insertProposal = async (format, offset) => val(
    admin,
    `insert into public.auto_match_proposals
       (format, proposed_starts_at, max_players, status, expires_at, gestation_started_at, gestation_threshold)
     values ($1, $2::timestamptz + $3::interval, $4, 'collecting',
             $2::timestamptz + $3::interval - interval '30 minutes', now(), 4)
     returning id`,
    [format, slot20, offset, Number(format.slice(1)) * 2],
  );

  const f5At20 = await insertProposal('F5', '0 minutes');
  const f7At22 = await insertProposal('F7', '120 minutes');
  const f7At21 = await insertProposal('F7', '60 minutes');

  const addMember = (proposalId, uid, response) => admin.query(
    `insert into public.auto_match_proposal_members
       (proposal_id, availability_id, user_id, response, responded_at, confirmed_at, invite_expires_at)
     values ($1, $2, $3, $4,
             case when $4='accepted' then now() else null end,
             case when $4='accepted' then now() else null end,
             case when $4='pending' then now() + interval '8 hours' else null end)`,
    [proposalId, availability[uid], uid, response],
  );

  await addMember(f5At20, USERS[0].id, 'pending');
  await addMember(f7At22, USERS[0].id, 'pending');
  await addMember(f7At21, USERS[0].id, 'pending');
  for (const user of USERS.slice(1, 5)) await addMember(f5At20, user.id, 'accepted');
  for (const user of USERS.slice(5, 9)) await addMember(f7At22, user.id, 'accepted');
  for (const user of USERS.slice(9, 13)) await addMember(f7At21, user.id, 'accepted');

  // Segundo usuario: ya acepto 20:00 y prueba una propuesta realmente
  // superpuesta a las 21:00. Debe rechazarse el intento, no cambiar la previa.
  await addMember(f5At20, USERS[14].id, 'accepted');
  await addMember(f7At21, USERS[14].id, 'pending');

  const first = await respond(USERS[0].id, f5At20, 'accepted');
  const firstConfirmedAt = String(first.confirmed_at);
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [f7At22, USERS[0].id]),
    'pending',
    'confirmar F5 20:00 conserva F7 22:00 (partidos consecutivos)',
  );
  eq(
    await val(admin, 'select response_reason from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [f7At21, USERS[0].id]),
    null,
    'F7 21:00 no se marca como conflicto mientras siga en gestación',
  );
  eq(
    await val(admin, 'select status from public.auto_match_proposals where id=$1', [f7At21]),
    'collecting',
    'la baja conflictiva no cancela toda la gestacion',
  );
  eq(
    await num(admin, 'select count(*) from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2 and response=$3', [f7At21, USERS[13].id, 'pending']),
    0,
    'sin salida por agenda no se abre una vacante artificial',
  );
  eq(await notifCount('auto_match_cancelled'), 0, 'no se encolan pushes de cancelacion falsos');

  const duplicate = await respond(USERS[0].id, f5At20, 'accepted');
  eq(String(duplicate.confirmed_at), firstConfirmedAt, 'repetir la misma respuesta es idempotente');
  eq(
    await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2 and response='accepted'", [f5At20, USERS[0].id]),
    1,
    'el retry no duplica la membresia confirmada',
  );

  await respond(USERS[0].id, f7At22, 'accepted');
  eq(
    await num(admin, "select count(*) from public.auto_match_proposal_members where user_id=$1 and response='accepted' and proposal_id in ($2,$3)", [USERS[0].id, f5At20, f7At22]),
    2,
    'el usuario confirma los dos partidos consecutivos',
  );
  eq(
    await val(admin, 'select status from public.player_availability where id=$1', [availability[USERS[0].id]]),
    'active',
    'aceptar un formato no desactiva la disponibilidad ni los demas formatos',
  );

  await respond(USERS[14].id, f7At21, 'accepted');
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [f5At20, USERS[14].id]),
    'accepted',
    'la segunda confirmacion no revoca la confirmacion previa valida',
  );

  // Dos taps concurrentes sobre salas distintas son independientes.
  availability[USERS[16].id] = await seedAvailability(USERS[16].id, {
    days: [localDow], formats: ['F5', 'F7'], start: '20:00', end: '23:00',
  });
  await addMember(f5At20, USERS[16].id, 'pending');
  await addMember(f7At21, USERS[16].id, 'pending');
  const concurrentResponses = await Promise.allSettled([
    respond(USERS[16].id, f5At20, 'accepted'),
    respond(USERS[16].id, f7At21, 'accepted'),
  ]);
  eq(
    concurrentResponses.filter(({ status }) => status === 'fulfilled').length,
    2,
    'dos confirmaciones superpuestas simultaneas pueden aceptarse',
  );
  eq(
    await num(
      admin,
      "select count(*) from public.auto_match_proposal_members where user_id=$1 and proposal_id in ($2,$3) and response='accepted'",
      [USERS[16].id, f5At20, f7At21],
    ),
    2,
    'dos gestaciones aceptadas no constituyen una doble reserva',
  );

  // Reproduce la cuenta real: otra persona aceptada conserva una fila historica
  // que dejo de estar activa. Antes, ese snapshot ajeno hacia fallar al usuario
  // pendiente con auto_match_location_or_account_ineligible.
  await resetData();
  const staleAvailability = {};
  for (const user of USERS.slice(0, 5)) {
    staleAvailability[user.id] = await seedAvailability(user.id, {
      days: [localDow], formats: ['F5', 'F7'], start: '20:00', end: '23:00',
    });
  }
  const realCase = await insertProposal('F5', '0 minutes');
  await admin.query(
    `insert into public.auto_match_proposal_members
       (proposal_id, availability_id, user_id, response, invite_expires_at)
     values ($1,$2,$3,'pending',now()+interval '8 hours')`,
    [realCase, staleAvailability[USERS[0].id], USERS[0].id],
  );
  for (const user of USERS.slice(1, 4)) {
    await admin.query(
      `insert into public.auto_match_proposal_members
         (proposal_id, availability_id, user_id, response, responded_at, confirmed_at)
       values ($1,$2,$3,'accepted',now(),now())`,
      [realCase, staleAvailability[user.id], user.id],
    );
  }
  await admin.query("update public.player_availability set status='cancelled' where id=$1", [staleAvailability[USERS[1].id]]);

  const repairedResponse = await respond(USERS[0].id, realCase, 'accepted');
  eq(repairedResponse.response, 'accepted', 'el error especifico de la cuenta real queda reproducido y corregido');
  const repairedConfirmedAt = String(repairedResponse.confirmed_at);
  eq(
    String((await respond(USERS[0].id, realCase, 'accepted')).confirmed_at),
    repairedConfirmedAt,
    'el caso real tambien conserva confirmed_at en un retry',
  );
  await val(admin, 'select public.prune_ineligible_auto_match_members()');
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [realCase, USERS[1].id]),
    'accepted',
    'el sweep no expira un compromiso por una disponibilidad historica cancelada',
  );

  const immutableBefore = await one(
    admin,
    `select availability_id, source_availability_id, snapshot_latitude,
            snapshot_longitude, snapshot_max_distance_km, snapshot_formats,
            snapshot_taken_at
     from public.auto_match_proposal_members
     where proposal_id=$1 and user_id=$2`,
    [realCase, USERS[1].id],
  );
  const replacementAvailability = await seedAvailability(USERS[1].id, {
    days: [localDow], formats: ['F5', 'F7'], start: '20:00', end: '23:00',
  });
  eq(
    Number(await val(admin, 'select availability_id from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [realCase, USERS[1].id])),
    Number(staleAvailability[USERS[1].id]),
    're-guardar no religa ni muta la membresia existente',
  );
  const immutableAfter = await one(
    admin,
    `select source_availability_id, snapshot_latitude, snapshot_longitude,
            snapshot_max_distance_km, snapshot_formats, snapshot_taken_at
     from public.auto_match_proposal_members
     where proposal_id=$1 and user_id=$2`,
    [realCase, USERS[1].id],
  );
  eq(JSON.stringify(immutableAfter), JSON.stringify({
    source_availability_id: immutableBefore.source_availability_id,
    snapshot_latitude: immutableBefore.snapshot_latitude,
    snapshot_longitude: immutableBefore.snapshot_longitude,
    snapshot_max_distance_km: immutableBefore.snapshot_max_distance_km,
    snapshot_formats: immutableBefore.snapshot_formats,
    snapshot_taken_at: immutableBefore.snapshot_taken_at,
  }), 're-guardar conserva el snapshot byte por byte');
  ok(Number(replacementAvailability) !== Number(immutableBefore.availability_id), 'la nueva busqueda tiene otro id');

  await (await asUser(USERS[1].id)).query(
    'delete from public.player_availability where id=$1',
    [staleAvailability[USERS[1].id]],
  );
  eq(
    await val(admin, 'select availability_id from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [realCase, USERS[1].id]),
    null,
    'eliminar la disponibilidad aplica ON DELETE SET NULL',
  );
  eq(
    Number(await val(admin, 'select source_availability_id from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [realCase, USERS[1].id])),
    Number(staleAvailability[USERS[1].id]),
    'el identificador de origen desacoplado sobrevive al DELETE',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [realCase, USERS[1].id]),
    'accepted',
    'eliminar la busqueda no borra ni expira la confirmacion',
  );

  // Estados esperables: vencida, cerrada y capacidad final completa.
  await resetData();
  const capacityAvailability = {};
  for (const user of USERS.slice(0, 17)) {
    capacityAvailability[user.id] = await seedAvailability(user.id, {
      days: [localDow], formats: ['F5'], start: '20:00', end: '23:00',
    });
  }
  const fullProposal = await insertProposal('F5', '0 minutes');
  for (const user of USERS.slice(0, 14)) {
    await admin.query(
      `insert into public.auto_match_proposal_members
         (proposal_id, availability_id, user_id, response, responded_at, confirmed_at)
       values ($1,$2,$3,'accepted',now(),now())`,
      [fullProposal, capacityAvailability[user.id], user.id],
    );
  }
  await admin.query(
    `insert into public.auto_match_proposal_members
       (proposal_id, availability_id, user_id, response, invite_expires_at)
     values ($1,$2,$3,'pending',now()+interval '8 hours')`,
    [fullProposal, capacityAvailability[USERS[14].id], USERS[14].id],
  );
  await respond(USERS[14].id, fullProposal, 'accepted');
  eq(
    await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='accepted'" , [fullProposal]),
    15,
    'los 15 sobreconvocados pueden responder sin error generico',
  );
  await val(admin, 'select public.backfill_auto_match_proposal_members($1)', [fullProposal]);
  eq(
    await num(admin, 'select count(*) from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [fullProposal, USERS[15].id]),
    0,
    'capacidad completa: un 16.o no entra y el plantel final sigue topeado a titulares + 4',
  );

  // Libera la exclusion de sala recolectando del mismo bucket: esta sala ya
  // alcanzo titulares y queda latcheada como en el flujo real.
  await admin.query(
    "update public.auto_match_proposals set status='ready', titulares_completed_at=now() where id=$1",
    [fullProposal],
  );

  const expiredProposal = await insertProposal('F5', '0 minutes');
  await admin.query(
    `insert into public.auto_match_proposal_members
       (proposal_id, availability_id, user_id, response, responded_at)
     values ($1,$2,$3,'expired',now())`,
    [expiredProposal, capacityAvailability[USERS[15].id], USERS[15].id],
  );
  await expectError(
    respond(USERS[15].id, expiredProposal, 'accepted'),
    /proposal_member_expired/,
    'una invitacion vencida conserva un estado especifico',
  );

  await admin.query("update public.auto_match_proposals set status='cancelled' where id=$1", [expiredProposal]);

  const closedProposal = await insertProposal('F5', '0 minutes');
  await admin.query("update public.auto_match_proposals set status='cancelled' where id=$1", [closedProposal]);
  await admin.query(
    `insert into public.auto_match_proposal_members
       (proposal_id, availability_id, user_id, response, invite_expires_at)
     values ($1,$2,$3,'pending',now()+interval '8 hours')`,
    [closedProposal, capacityAvailability[USERS[16].id], USERS[16].id],
  );
  await expectError(
    respond(USERS[16].id, closedProposal, 'accepted'),
    /proposal_not_open/,
    'una propuesta cerrada conserva un estado especifico',
  );

  await expectError(
    admin.query('select * from public.respond_to_auto_match_proposal($1,$2,$3)', [fullProposal, 'accepted', false]),
    /not_authenticated/,
    'autenticacion sigue siendo obligatoria',
  );
  eq(
    await val(admin, "select has_function_privilege('anon', 'public.respond_to_auto_match_proposal(bigint,text,boolean)', 'EXECUTE')"),
    false,
    'anon no puede ejecutar el RPC',
  );
  eq(
    await val(admin, "select has_function_privilege('authenticated', 'public.respond_to_auto_match_proposal(bigint,text,boolean)', 'EXECUTE')"),
    true,
    'authenticated conserva el permiso minimo del RPC',
  );
  eq(
    await val(admin, "select has_function_privilege('authenticated', 'public.reconcile_auto_match_proposal_members(bigint)', 'EXECUTE')"),
    false,
    'authenticated no puede ejecutar la reconciliacion interna',
  );
  eq(
    await val(admin, "select has_function_privilege('authenticated', 'public.capture_auto_match_member_snapshot()', 'EXECUTE')"),
    false,
    'authenticated no puede ejecutar directamente el capturador de snapshots',
  );
  eq(
    await val(admin, "select relrowsecurity from pg_class where oid='public.auto_match_proposal_members'::regclass"),
    true,
    'RLS sigue habilitada en membresias',
  );
}

// ---------------------------------------------------------------------------
// Escenario 10c: forma exacta de la propuesta #5 observada en produccion.
// Accepted (#49/#51) forman el nucleo, #55 conserva confirmed_at tras el bug,
// #52 es pending compatible y #57 esta ~13,1 km fuera de radios de 8 km.
// ---------------------------------------------------------------------------
async function scenarioProposalFiveDeterministicReconciliation() {
  console.log('\nEscenario 10c: reconciliacion determinista de la propuesta #5');
  await resetData();

  const localDate = await val(admin, 'select (current_date + 3)::date');
  const localDow = await num(admin, 'select extract(isodow from $1::date)', [localDate]);
  const slot = await val(
    admin,
    "select ($1::date + time '20:00') at time zone 'America/Argentina/Buenos_Aires'",
    [localDate],
  );

  const availabilitySeeds = [
    [49, USERS[0].id, -34.600, -58.400, 8],
    [51, USERS[1].id, -34.602, -58.400, 8],
    [52, USERS[2].id, -34.604, -58.400, 8],
    [55, USERS[3].id, -34.722, -58.400, 19],
    [56, USERS[7].id, -34.606, -58.400, 8],
    [57, USERS[4].id, -34.722, -58.395, 18],
    [58, USERS[5].id, -34.730, -58.400, 8],
    [59, USERS[6].id, -34.608, -58.400, 8],
  ];
  for (const [id, uid, lat, lng, radius] of availabilitySeeds) {
    await admin.query(
      `insert into public.player_availability
         (id, user_id, days_of_week, time_start, time_end, timezone, formats,
          max_distance_km, latitude, longitude, status)
       values ($1,$2,$3::smallint[],'20:00','23:00','America/Argentina/Buenos_Aires',
               '{F5,F7}',$4,$5,$6,'active')`,
      [id, uid, [localDow], radius, lat, lng],
    );
  }

  await admin.query(
    `insert into public.auto_match_proposals
       (id, format, proposed_starts_at, max_players, status, expires_at,
        gestation_started_at, gestation_threshold)
     values (5,'F5',$1,10,'collecting',$1::timestamptz - interval '30 minutes',now(),4)`,
    [slot],
  );

  // Se desactiva solamente la defensa geografica para sembrar la corrupcion
  // historica; el trigger de snapshot permanece activo.
  await admin.query('alter table public.auto_match_proposal_members disable trigger enforce_auto_match_member_eligibility_trigger');
  try {
    for (const [availabilityId, uid, response] of [
      [49, USERS[0].id, 'accepted'],
      [51, USERS[1].id, 'accepted'],
      [52, USERS[2].id, 'pending'],
      [55, USERS[3].id, 'expired'],
      [56, USERS[7].id, 'expired'],
      [57, USERS[4].id, 'pending'],
    ]) {
      await admin.query(
        `insert into public.auto_match_proposal_members
           (proposal_id, availability_id, user_id, response, responded_at,
            confirmed_at, invite_expires_at)
         values (5,$1,$2,$3,
                 case when $3 in ('accepted','expired') then now() else null end,
                 case when $3 in ('accepted','expired') then now() else null end,
                 case when $3='pending' then now()+interval '8 hours' else null end)`,
        [availabilityId, uid, response],
      );
    }
  } finally {
    await admin.query('alter table public.auto_match_proposal_members enable trigger enforce_auto_match_member_eligibility_trigger');
  }
  await admin.query(
    "update public.auto_match_proposal_members set response_reason='availability_ineligible' where proposal_id=5 and source_availability_id=56",
  );
  await admin.query("update public.player_availability set status='cancelled' where id=55");

  const reconciliation = await one(admin, 'select * from public.reconcile_auto_match_proposal_members(5)');
  eq(Number(reconciliation.restored_count), 1,
    'la confirmación compatible expirada por re-guardar disponibilidad se restaura');
  eq(Number(reconciliation.removed_count), 1, '#57 es el unico pending retirado por incompatibilidad');
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=49'),
    'accepted',
    '#49 permanece accepted',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=51'),
    'accepted',
    '#51 permanece accepted',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=52'),
    'pending',
    '#52 permanece pending compatible y no es bloqueado por #57',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=55'),
    'expired',
    '#55 permanece expired: confirmed_at no permite violar la regla geografica simetrica',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=56'),
    'accepted',
    '#56 demuestra la restauración automática cuando la única causa fue el bug de re-guardado',
  );
  eq(
    await val(admin, 'select response_reason from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=57'),
    'geographic_incompatibility',
    '#57 queda retirado con causa geografica especifica',
  );
  eq(await val(admin, 'select status from public.auto_match_proposals where id=5'), 'collecting',
    'la propuesta #5 continua collecting');
  eq(
    await num(admin, 'select count(*) from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=58'),
    0,
    'el backfill no invita al candidato lejano',
  );
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=59'),
    'pending',
    'el backfill invita solamente al reemplazo compatible',
  );
  eq(await val(admin, "select status from public.player_availability where id=57"), 'active',
    '#57 conserva su busqueda activa para otra cohorte');

  const accepted52 = await respond(USERS[2].id, 5, 'accepted');
  eq(accepted52.response, 'accepted', '#52 puede guardar su respuesta');
  const incompatible57 = await respond(USERS[4].id, 5, 'accepted');
  eq(incompatible57.response_reason, 'geographic_incompatibility',
    '#57 recibe una causa persistida que la UI traduce sin mensaje generico');

  // Un rechazo voluntario sigue siendo definitivo y no entra en la regla de
  // restauracion de confirmed_at.
  await admin.query(
    `insert into public.player_availability
       (id,user_id,days_of_week,time_start,time_end,timezone,formats,max_distance_km,latitude,longitude,status)
     values (60,$1,$2::smallint[],'20:00','23:00','America/Argentina/Buenos_Aires','{F5}',8,-34.609,-58.4,'active')`,
    [USERS[8].id, [localDow]],
  );
  await admin.query(
    `insert into public.auto_match_proposal_members
       (proposal_id,availability_id,user_id,response,invite_expires_at)
     values (5,60,$1,'pending',now()+interval '8 hours')`,
    [USERS[8].id],
  );
  await respond(USERS[8].id, 5, 'declined');
  await one(admin, 'select * from public.reconcile_auto_match_proposal_members(5)');
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=5 and source_availability_id=60'),
    'declined',
    'una cancelacion explicita sigue respetandose',
  );
}

// ---------------------------------------------------------------------------
// Escenario 10d: dos usuarios aceptan propuestas cruzadas simultaneamente sin
// locks cruzados ni cambios sobre la otra sala.
// ---------------------------------------------------------------------------
async function scenarioCrossedProposalConcurrency() {
  console.log('\nEscenario 10d: concurrencia cruzada sin deadlock');
  await resetData();

  const slot = await fixtureFutureSlotAt20();
  const slotDow = await num(
    admin,
    "select extract(isodow from ($1::timestamptz at time zone 'America/Argentina/Buenos_Aires'))",
    [slot],
  );
  const avail = {};
  for (const user of USERS.slice(0, 6)) {
    avail[user.id] = await val(
      admin,
      `insert into public.player_availability
         (user_id,days_of_week,time_start,time_end,formats,latitude,longitude,status)
       values ($1,$2::smallint[],'00:00','23:59','{F5,F7}',-34.60,-58.40,'active') returning id`,
      [user.id, [slotDow]],
    );
  }
  const p1 = await val(
    admin,
    `insert into public.auto_match_proposals
       (format,proposed_starts_at,max_players,status,expires_at,gestation_started_at,gestation_threshold)
     values ('F5',$1,10,'collecting',$1::timestamptz-interval '30 minutes',now(),4) returning id`,
    [slot],
  );
  const p2 = await val(
    admin,
    `insert into public.auto_match_proposals
       (format,proposed_starts_at,max_players,status,expires_at,gestation_started_at,gestation_threshold)
     values ('F7',$1,14,'collecting',$1::timestamptz-interval '30 minutes',now(),4) returning id`,
    [slot],
  );

  for (const pid of [p1, p2]) {
    for (const user of USERS.slice(0, 2)) {
      await admin.query(
        `insert into public.auto_match_proposal_members
           (proposal_id,availability_id,user_id,response,invite_expires_at)
         values ($1,$2,$3,'pending',now()+interval '8 hours')`,
        [pid, avail[user.id], user.id],
      );
    }
    for (const user of USERS.slice(2, 6)) {
      await admin.query(
        `insert into public.auto_match_proposal_members
           (proposal_id,availability_id,user_id,response,responded_at,confirmed_at)
         values ($1,$2,$3,'accepted',now(),now())`,
        [pid, avail[user.id], user.id],
      );
    }
  }

  const clientA = await asUser(USERS[0].id);
  const clientB = await asUser(USERS[1].id);
  await clientA.query("set statement_timeout='5s'; set lock_timeout='4s'");
  await clientB.query("set statement_timeout='5s'; set lock_timeout='4s'");

  const [aResult, bResult] = await Promise.allSettled([
    respond(USERS[0].id, p1, 'accepted'),
    respond(USERS[1].id, p2, 'accepted'),
  ]);
  ok(aResult.status === 'fulfilled' && bResult.status === 'fulfilled',
    'las dos operaciones simultaneas terminan sin deadlock ni timeout',
    `${aResult.reason?.message || ''} ${bResult.reason?.message || ''}`);
  eq(await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [p1, USERS[0].id]),
    'accepted', 'A acepta propuesta 1');
  eq(await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [p2, USERS[0].id]),
    'pending', 'A permanece en propuesta 2');
  eq(await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [p2, USERS[1].id]),
    'accepted', 'B acepta propuesta 2');
  eq(await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [p1, USERS[1].id]),
    'pending', 'B permanece en propuesta 1');

  const countsBeforeRetry = await one(
    admin,
    `select
       (select count(*) from public.auto_match_proposal_members) as memberships,
       (select count(*) from public.notifications) as notifications,
       (select count(*) from public.notification_delivery_log) as deliveries,
       (select count(*) from public.auto_match_proposal_events) as events`,
  );
  await respond(USERS[0].id, p1, 'accepted');
  await respond(USERS[1].id, p2, 'accepted');
  const countsAfterRetry = await one(
    admin,
    `select
       (select count(*) from public.auto_match_proposal_members) as memberships,
       (select count(*) from public.notifications) as notifications,
       (select count(*) from public.notification_delivery_log) as deliveries,
       (select count(*) from public.auto_match_proposal_events) as events`,
  );
  eq(JSON.stringify(countsAfterRetry), JSON.stringify(countsBeforeRetry),
    'retries no duplican membresias, pushes ni event keys');
  eq(
    await num(admin, 'select count(*) from public.auto_match_proposal_members'),
    await num(admin, 'select count(distinct (proposal_id,user_id)) from public.auto_match_proposal_members'),
    'no hay filas de respuesta/membresia duplicadas',
  );

  await clientA.query('reset statement_timeout; reset lock_timeout');
  await clientB.query('reset statement_timeout; reset lock_timeout');
}

// ---------------------------------------------------------------------------
// Escenario 10e: la agenda se resuelve exclusivamente al materializar. Se
// prueban alternativa consecutiva, ausencia de horario y dos materializaciones
// simultáneas con jugadores compartidos.
// ---------------------------------------------------------------------------
async function scenarioFinalMaterializationSchedule() {
  console.log('\nEscenario 10e: selección final de horario al materializar');

  const seedReadyRooms = async ({ rooms = 1, end = '23:59' } = {}) => {
    await resetData();
    const localDate = await val(admin, 'select (current_date + 3)::date');
    const localDow = await num(admin, 'select extract(isodow from $1::date)', [localDate]);
    const slot20 = await val(
      admin,
      "select ($1::date + time '20:00') at time zone 'America/Argentina/Buenos_Aires'",
      [localDate],
    );
    const availabilities = [];
    for (const user of USERS.slice(0, 10)) {
      availabilities.push(await seedAvailability(user.id, {
        days: [localDow], formats: ['F5'], start: '20:00', end,
      }));
    }
    const proposalIds = [];
    for (let roomIndex = 0; roomIndex < rooms; roomIndex += 1) {
      const proposalId = await val(
        admin,
        `insert into public.auto_match_proposals
           (format, proposed_starts_at, max_players, status, expires_at,
            gestation_started_at, gestation_threshold, organizer_id, titulares_completed_at)
         values ('F5',$1,10,'ready',$1::timestamptz-interval '30 minutes',now(),4,$2,now())
         returning id`,
        [slot20, USERS[0].id],
      );
      proposalIds.push(proposalId);
      for (let i = 0; i < 10; i += 1) {
        await admin.query(
          `insert into public.auto_match_proposal_members
             (proposal_id,availability_id,user_id,response,responded_at,confirmed_at,can_organize)
           values ($1,$2,$3,'accepted',now(),now()+make_interval(secs=>$4::double precision),$5)`,
          [proposalId, availabilities[i], USERS[i].id, i * 0.01, i === 0],
        );
      }
    }
    return { localDate, slot20, proposalIds };
  };

  const seedRealMatchAt20 = async (localDate, userId = USERS[0].id) => {
    const partidoId = await val(
      admin,
      `insert into public.partidos
         (nombre,fecha,hora,modalidad,cupo_jugadores,creado_por,estado)
       values ('Partido real 20',$1,'20:00','F5',10,$2,'activo') returning id`,
      [localDate, userId],
    );
    await admin.query(
      'insert into public.jugadores (partido_id,usuario_id,nombre) values ($1,$2,$3)',
      [partidoId, userId, 'Jugador ocupado'],
    );
    return partidoId;
  };

  // El horario pedido 21:00 se superpone con [20:00,22:00); se descarta y la
  // misma transacción elige 22:00, permitido por el rango semiabierto.
  {
    const seeded = await seedReadyRooms();
    await seedRealMatchAt20(seeded.localDate);
    const materialized = await finalize(USERS[0].id, seeded.proposalIds[0], { hora: '21:00' });
    ok(Boolean(materialized.partido_id), 'un conflicto inicial busca otra hora en vez de cancelar');
    eq(
      await val(admin, 'select hora from public.partidos where id=$1', [materialized.partido_id]),
      '22:00',
      '20:00–22:00 permite el nuevo partido exactamente a las 22:00',
    );
    eq(
      await val(admin, 'select status from public.auto_match_proposals where id=$1', [seeded.proposalIds[0]]),
      'created',
      'la propuesta se materializa sólo después de hallar horario compatible',
    );
    eq(await notifCount('auto_match_cancelled'), 0, 'no hay push de cancelación por agenda');
  }

  // La ventana termina a las 22:00: con la regla vigente de al menos 60 min
  // restantes, el último comienzo posible es 21:00 y todos se superponen.
  {
    const seeded = await seedReadyRooms({ end: '22:00' });
    await seedRealMatchAt20(seeded.localDate);
    await expectError(
      finalize(USERS[0].id, seeded.proposalIds[0], { hora: '21:00' }),
      /no_compatible_final_time/,
      'sin alternativa no se crea un partido',
    );
    eq(await num(admin, 'select count(*) from public.partidos'), 1,
      'permanece solamente el partido real preexistente');
    eq(
      await val(admin, 'select status from public.auto_match_proposals where id=$1', [seeded.proposalIds[0]]),
      'ready',
      'sin horario compatible la gestación permanece ready',
    );
    eq(
      await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='accepted'", [seeded.proposalIds[0]]),
      10,
      'sin horario compatible conserva todas las membresías accepted',
    );
  }

  // Dos salas listas con los mismos jugadores intentan 20:00 a la vez. Los
  // locks por jugador serializan la elección: una queda 20:00 y la otra 22:00.
  {
    const seeded = await seedReadyRooms({ rooms: 2 });
    const call = (client, proposalId) => one(
      client,
      `select * from public.finalize_auto_match_proposal(
         $1,'Partido concurrente',null,'20:00','Masculino',8000,
         'Cancha Test','place-test','Calle Test',-34.6,-58.4)`,
      [proposalId],
    );
    const clientA = await connect(USERS[0].id);
    const clientB = await connect(USERS[0].id);
    const [first, second] = await Promise.allSettled([
      call(clientA, seeded.proposalIds[0]),
      call(clientB, seeded.proposalIds[1]),
    ]);
    ok(first.status === 'fulfilled' && second.status === 'fulfilled',
      'dos materializaciones simultáneas terminan sin error ni deadlock',
      `${first.reason?.message || ''} ${second.reason?.message || ''}`);
    const hours = (await admin.query('select hora from public.partidos order by fecha,hora,id')).rows.map((row) => row.hora);
    eq(JSON.stringify(hours), JSON.stringify(['20:00', '22:00']),
      'la segunda materialización recalcula y elige el siguiente horario compatible');
    eq(
      await num(
        admin,
        `select count(*)
         from public.partidos a
         join public.partidos b on a.id < b.id
         where public.auto_match_play_range(public.partido_kickoff_at(a.fecha,a.hora),a.modalidad)
               && public.auto_match_play_range(public.partido_kickoff_at(b.fecha,b.hora),b.modalidad)`,
      ),
      0,
      'dos materializaciones simultáneas no producen partidos reales superpuestos',
    );
  }
}

// ---------------------------------------------------------------------------
// Escenario 11: §10 convocados pendientes al materializar reciben invitación de
// suplente (no entran solos); §12 reapertura de vacante del partido creado.
// ---------------------------------------------------------------------------
async function scenarioSubstitutes() {
  console.log('\nEscenario 11: pendientes → suplentes + reapertura de vacante');
  await resetData();

  for (const user of USERS.slice(0, 12)) await activate(user.id, { canOrganize: true });
  const proposal = await activeProposal();
  const roster = await members(proposal.id);
  const creatorId = roster.find((row) => row.response === 'accepted').user_id;
  const pendings = roster.filter((row) => row.response === 'pending').map((row) => row.user_id);

  // 9 confirman => 10 titulares (creador + 9). Quedan 2 pendientes.
  for (const uid of pendings.slice(0, 9)) await respond(uid, proposal.id, 'accepted');
  const leftPending = pendings.slice(9);
  eq(leftPending.length, 2, 'quedan 2 convocados pendientes');

  const ready = await one(admin, 'select * from public.auto_match_proposals where id=$1', [proposal.id]);
  eq(ready.status, 'ready', 'con 10 confirmados => ready');
  eq(String(ready.organizer_id), String(creatorId), 'el creador (voluntario, titular #1) organiza');

  // Materializa.
  const done = await finalize(creatorId, proposal.id);
  const partidoId = Number(done.partido_id);
  ok(Boolean(partidoId), 'se creó el partido');
  eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1', [partidoId]), 10, 'entran solo los 10 titulares confirmados');
  for (const uid of leftPending) {
    eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, uid]), 0, 'un pendiente NO se vuelve suplente automático');
    eq(await notifCount('auto_match_substitute_invite', uid), 1, 'el pendiente recibe la invitación de suplente');
  }

  // §10: aceptar la invitación de suplente => entra al partido.
  const subA = leftPending[0];
  const subB = leftPending[1];
  const returned = await respondSub(subA, proposal.id, 'accepted');
  eq(String(returned), String(partidoId), 'aceptar suplente devuelve el partido');
  eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1', [partidoId]), 11, 'el suplente que aceptó entra al partido');
  eq(await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, subA]), 'accepted', 'su membresía queda accepted');
  eq(await notifCount('auto_match_substitute_joined', creatorId), 1, 'el organizador es avisado del suplente');

  // Rechazar => no entra y no puede reconfirmar.
  await respondSub(subB, proposal.id, 'declined');
  eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, subB]), 0, 'el que rechaza no entra al partido');
  await expectError(
    (await asUser(subB)).query('select public.respond_to_auto_match_substitute($1,$2)', [proposal.id, 'accepted']),
    /substitute_invite_closed/,
    'un suplente que rechazó no puede reconfirmar',
  );

  // §12: se abre una vacante (bajan un suplente y un titular => 9 < cupo 10) y
  // no quedan pendientes => la reapertura invita un compatible NUEVO.
  await admin.query('delete from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, subA]);
  await admin.query('delete from public.jugadores where id = (select id from public.jugadores where partido_id=$1 order by created_at asc limit 1)', [partidoId]);
  eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1', [partidoId]), 9, 'quedó una vacante (9 < cupo 10)');

  // Compatible nuevo insertado directo (sin gestar su propia propuesta).
  await admin.query(
    "insert into public.player_availability (user_id, days_of_week, time_start, time_end, formats, latitude, longitude, status) values ($1, '{6}', '20:00', '23:00', '{F5}', -34.60, -58.40, 'active')",
    [USERS[12].id],
  );
  await val(admin, 'select public.reopen_auto_match_vacancies()');
  eq(
    await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, USERS[12].id]),
    'pending',
    'la reapertura invita un compatible nuevo',
  );
  // La vacante es de TITULAR (9 < cupo 10): la invitación se diferencia como
  // "hay un lugar en el partido" (starter_invite), no "sumate de suplente".
  eq(await notifCount('auto_match_starter_invite', USERS[12].id), 1, 'el nuevo compatible recibe la invitación de titular (vacante de titular)');
  eq(await notifCount('auto_match_substitute_invite', USERS[12].id), 0, 'no se le ofrece de suplente: es una vacante de titular');
  eq(await notifCount('auto_match_vacancy_reopened', creatorId), 1, 'el organizador es avisado de la reapertura');

  await respondSub(USERS[12].id, proposal.id, 'accepted');
  eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, USERS[12].id]), 1, 'el nuevo suplente cubre la vacante');
}

// ---------------------------------------------------------------------------
// Escenario 12: plantel final acotado a required + 4. Los confirmados que
// exceden quedan en lista de espera (waitlisted): no entran al partido ni al
// chat, no se marcan como rechazados y siguen disponibles. F5/F7/F11.
// ---------------------------------------------------------------------------
async function scenarioRosterCap() {
  console.log('\nEscenario 12: plantel final = required + 4 + lista de espera');

  eq(await num(admin, "select public.auto_match_final_roster_capacity('F5')"), 14, 'final_roster_capacity F5 = 10 + 4');
  eq(await num(admin, "select public.auto_match_final_roster_capacity('F7')"), 18, 'final_roster_capacity F7 = 14 + 4');
  eq(await num(admin, "select public.auto_match_final_roster_capacity('F11')"), 26, 'final_roster_capacity F11 = 22 + 4');

  for (const [format, confirmed, roster, waitlisted] of [
    ['F5', 15, 14, 1],
    ['F7', 21, 18, 3],
    ['F11', 33, 26, 7],
  ]) {
    const { pid } = await seedReadyProposal(format, confirmed);
    const done = await finalize(USERS[0].id, pid);
    const partidoId = Number(done.partido_id);
    const required = Number(format.slice(1)) * 2;

    eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1', [partidoId]), roster,
      `${format}: ${confirmed} confirmados => ${roster} jugadores (${required} titulares + 4 suplentes)`);
    eq(await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='waitlisted'", [pid]), waitlisted,
      `${format}: ${waitlisted} confirmados excedentes en lista de espera`);

    // El último en confirmar (mayor confirmed_at) es el primero que queda afuera.
    const lastConfirmed = USERS[confirmed - 1].id;
    eq(await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [pid, lastConfirmed]), 'waitlisted',
      `${format}: el último en confirmar queda en lista de espera`);
    eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, lastConfirmed]), 0,
      `${format}: el excedente NO entra al partido`);
    eq(await val(admin, 'select public.auto_match_user_in_proposal($1,$2)', [pid, lastConfirmed]), false,
      `${format}: el excedente no accede al chat del partido/gestación`);
    eq(await val(admin, 'select public.user_declined_auto_match_slot($1,$2,(select proposed_starts_at from public.auto_match_proposals where id=$3))', [lastConfirmed, format, pid]), false,
      `${format}: el excedente sigue disponible (la lista de espera no bloquea)`);
    eq(await num(admin, "select count(*) from public.player_availability where user_id=$1 and status='active'", [lastConfirmed]), 1,
      `${format}: el excedente mantiene su disponibilidad activa`);
    eq(await notifCount('auto_match_waitlisted', lastConfirmed), 1, `${format}: el excedente recibe "el plantel se completó"`);
    eq(await notifCount('auto_match_created', lastConfirmed), 0, `${format}: el excedente NO recibe "partido confirmado"`);

    const wlClient = await asUser(lastConfirmed);
    eq((await wlClient.query('select * from public.get_my_auto_match_proposals()')).rows.length, 0,
      `${format}: el excedente no queda con card de gestación`);
  }

  // Pendientes al materializar con banco lleno => lista de espera, sin
  // invitación de suplente imposible de aceptar.
  {
    const { pid } = await seedReadyProposal('F5', 14, { pending: 2 });
    const done = await finalize(USERS[0].id, pid);
    eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1', [Number(done.partido_id)]), 14, 'banco lleno: 14 jugadores');
    eq(await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='pending'", [pid]), 0, 'no quedan pendientes con una invitación imposible');
    eq(await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='waitlisted'", [pid]), 2, 'los pendientes van a lista de espera cuando el banco está lleno');
    eq(await notifCount('auto_match_substitute_invite', USERS[15].id), 0, 'un pendiente con banco lleno NO recibe invitación de suplente');
  }
}

// ---------------------------------------------------------------------------
// Escenario 13: promoción de suplente a titular (§5). Bajar un titular por
// CUALQUIER camino (delete directo) asciende al primer suplente y avisa al
// promovido y al organizador. Bajar un suplente no promueve.
// ---------------------------------------------------------------------------
async function scenarioPromotion() {
  console.log('\nEscenario 13: promoción de suplente a titular + aviso');

  const { pid } = await seedReadyProposal('F5', 12); // 10 titulares + 2 suplentes
  const done = await finalize(USERS[0].id, pid);
  const partidoId = Number(done.partido_id);
  eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1', [partidoId]), 12, '12 confirmados => 12 jugadores (10 titulares + 2 suplentes)');

  const firstSub = USERS[10].id; // confirmó 11.º => primer suplente
  eq(await num(admin, 'select count(*) from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, firstSub]), 1, 'el primer suplente está en el partido');

  // Baja un TITULAR distinto del organizador (USERS[1], asiento 2).
  await admin.query('delete from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, USERS[1].id]);
  eq(await notifCount('auto_match_promoted', firstSub), 1, 'el primer suplente recibe "pasaste a titular"');
  eq(await notifCount('auto_match_promoted', USERS[0].id), 1, 'el organizador es avisado de la promoción');
  eq(
    await val(admin, "select data->>'route' from public.notifications where type='auto_match_promoted' and user_id=$1 limit 1", [firstSub]),
    `/partido-publico/${partidoId}`,
    'el aviso de promoción deep-linkea al partido real',
  );

  // Bajar un SUPLENTE (el último) no genera una nueva promoción del mismo.
  await admin.query('delete from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, USERS[11].id]);
  eq(await notifCount('auto_match_promoted', firstSub), 1, 'bajar un suplente no vuelve a notificar la promoción');

  // Idempotencia: un partido cancelado no promueve al bajar jugadores.
  await admin.query("update public.partidos set estado='cancelado' where id=$1", [partidoId]);
  const before = await notifCount('auto_match_promoted');
  await admin.query('delete from public.jugadores where partido_id=$1 and usuario_id=$2', [partidoId, USERS[2].id]);
  eq(await notifCount('auto_match_promoted'), before, 'un partido cancelado no dispara promociones');
}

// ---------------------------------------------------------------------------
// Escenario 14: sin throttle por formato. Una sola corrida de sync (una
// activación) suma al jugador a TODAS las combinaciones día×formato, sin
// depender de reabrir la pantalla ni reactivar la disponibilidad.
// ---------------------------------------------------------------------------
async function scenarioNoThrottle() {
  console.log('\nEscenario 14: una activación gesta varios días/formatos (sin throttle)');
  await resetData();

  for (const user of USERS.slice(0, 6)) await activate(user.id, { days: [6, 7], formats: ['F5', 'F7'] });

  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready')"),
    4,
    '6 disponibles sáb+dom para F5+F7 gestan 4 salas (2 días × 2 formatos)',
  );
  // La última activación se sumó a las 4 salas en su ÚNICA corrida de sync.
  eq(
    await num(admin, 'select count(distinct proposal_id) from public.auto_match_proposal_members where user_id=$1 and response not in ($2,$3,$4)', [USERS[5].id, 'declined', 'expired', 'waitlisted']),
    4,
    'la última activación participa de las 4 gestaciones sin intervención adicional',
  );
  // Y un sync explícito posterior no duplica salas equivalentes.
  await sync(USERS[5].id);
  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready')"),
    4,
    're-sync no duplica salas equivalentes',
  );
}

// ---------------------------------------------------------------------------
// Helpers de cohortes progresivas.
// ---------------------------------------------------------------------------

// Siembra una disponibilidad activa directa (rápida, sin correr sync). Sin
// Por defecto todos usan un punto válido común. Los escenarios de ubicación
// incompleta pasan null explícitamente.
const seedAvailability = async (uid, {
  formats = ['F5'], days = [1], start = '20:00', end = '23:00',
  lat = -34.60, lng = -58.40, maxKm = 8, canOrganize = false,
} = {}) => val(
  admin,
  `insert into public.player_availability
     (user_id, days_of_week, time_start, time_end, formats, max_distance_km, latitude, longitude, can_organize, status)
   values ($1, $2::smallint[], $3::time, $4::time, $5::text[], $6, $7, $8, $9, 'active')
   returning id`,
  [uid, days, start, end, formats, maxKm, lat, lng, canOrganize],
);

const activeRooms = (format = null) => admin
  .query(
    `select * from public.auto_match_proposals
     where status in ('collecting','ready') and ($1::text is null or format = $1)
     order by id asc`,
    [format],
  )
  .then((res) => res.rows);

// Convocados vivos de una sala (los que cuentan para capacity y para el chat).
const activeMembers = (pid) => admin
  .query(
    `select * from public.auto_match_proposal_members
     where proposal_id = $1 and response not in ('declined','expired','waitlisted')
     order by user_id`,
    [pid],
  )
  .then((res) => res.rows);

// ---------------------------------------------------------------------------
// Escenario 15: elegibilidad por ubicación/cuenta y radios simétricos.
// ---------------------------------------------------------------------------
async function scenarioStrictLocationAndAccountEligibility() {
  console.log('\nEscenario 15: ubicación obligatoria, radios simétricos y cuentas vigentes');

  // 3 válidos + 1 sin latitud: el incompleto no cuenta para el mínimo.
  await resetData();
  for (const user of USERS.slice(0, 3)) await seedAvailability(user.id, { days: COHORT_DAYS });
  const missingLatId = await seedAvailability(USERS[3].id, {
    days: COHORT_DAYS, lat: null, lng: -58.40,
  });
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  eq((await activeRooms('F5')).length, 0, '3 válidos + 1 sin latitud no alcanzan el mínimo');
  eq(await val(admin, 'select public.auto_match_availability_is_eligible($1)', [missingLatId]), false,
    'una disponibilidad sin latitud queda incompleta');
  eq(await notifCount('auto_match_gestating', USERS[3].id), 0,
    'la disponibilidad incompleta no recibe push de propuesta');

  // Sin longitud y 0,0 también son incompletos; cuatro incompletos no crean.
  await resetData();
  const invalidIds = [
    await seedAvailability(USERS[0].id, { days: COHORT_DAYS, lat: -34.60, lng: null }),
    await seedAvailability(USERS[1].id, { days: COHORT_DAYS, lat: 0, lng: 0 }),
    await seedAvailability(USERS[2].id, { days: COHORT_DAYS, lat: null, lng: null }),
    await seedAvailability(USERS[3].id, { days: COHORT_DAYS, lat: null, lng: null }),
  ];
  const incompleteSweep = await one(admin, 'select * from public.sync_active_auto_match_gestations()');
  eq(Number(incompleteSweep.processed_count), 0, 'cuatro incompletos son ignorados por el barrido');
  eq(Number(incompleteSweep.failed_count), 0, 'filas incompletas no abortan ni cuentan como fallas');
  eq((await activeRooms('F5')).length, 0, 'cuatro búsquedas sin coordenadas válidas no crean sala');
  for (const availabilityId of invalidIds) {
    eq(await val(admin, 'select public.auto_match_availability_is_eligible($1)', [availabilityId]), false,
      'cada variante de coordenada incompleta queda fuera del matcher');
  }

  const invalidClient = await asUser(USERS[4].id);
  await expectError(
    invalidClient.query(
      `select * from public.upsert_my_availability(
        $1::smallint[], '20:00'::time, '23:00'::time, '{F5}'::text[], 8, 91, -58.4, false)`,
      [COHORT_DAYS],
    ),
    /invalid_coordinates/,
    'una latitud fuera de rango es rechazada',
  );
  await expectError(
    invalidClient.query(
      `select * from public.upsert_my_availability(
        $1::smallint[], '20:00'::time, '23:00'::time, '{F5}'::text[], 8, 'NaN'::double precision, -58.4, false)`,
      [COHORT_DAYS],
    ),
    /invalid_coordinates/,
    'NaN es rechazado antes de guardar',
  );

  // A acepta 10 km, B sólo 3 km y están a ~7 km: incompatible en ambos
  // órdenes y no se crea una sala con tres cercanos + B.
  await resetData();
  const nearIds = [];
  for (const user of USERS.slice(0, 3)) {
    nearIds.push(await seedAvailability(user.id, {
      days: COHORT_DAYS, lat: -34.60, lng: -58.40, maxKm: 10,
    }));
  }
  const shortRadiusId = await seedAvailability(USERS[3].id, {
    days: COHORT_DAYS, lat: -34.663, lng: -58.40, maxKm: 3,
  });
  eq(await val(admin, 'select public.auto_match_availabilities_are_compatible($1,$2)', [nearIds[0], shortRadiusId]), false,
    'A→B respeta también el radio corto de B');
  eq(await val(admin, 'select public.auto_match_availabilities_are_compatible($1,$2)', [shortRadiusId, nearIds[0]]), false,
    'B→A produce el mismo resultado simétrico');
  await sync(USERS[0].id);
  await sync(USERS[3].id);
  eq((await activeRooms('F5')).length, 0, 'el orden de sync no convierte radios incompatibles en una sala');

  // usuarios.is_active=false es presencia, no lifecycle: sigue siendo válido.
  // Una cuenta realmente suspendida (auth.users.banned_until) sí queda fuera.
  await resetData();
  const validPresenceFalseIds = [];
  for (const user of USERS.slice(0, 3)) {
    validPresenceFalseIds.push(await seedAvailability(user.id, { days: COHORT_DAYS }));
  }
  await admin.query("update auth.users set banned_until = now() + interval '1 day' where id=$1", [USERS[3].id]);
  const bannedAvailability = await seedAvailability(USERS[3].id, { days: COHORT_DAYS });
  eq(await val(admin, 'select is_active from public.usuarios where id=$1', [USERS[0].id]), false,
    'usuarios.is_active=false conserva su significado de presencia');
  eq(await val(admin, 'select public.auto_match_availability_is_eligible($1)', [validPresenceFalseIds[0]]), true,
    'usuarios.is_active=false no excluye una cuenta válida');
  eq(await val(admin, 'select public.auto_match_availability_is_eligible($1)', [bannedAvailability]), false,
    'una cuenta suspendida en auth.users no es elegible');
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  eq((await activeRooms('F5')).length, 0, '3 vigentes + 1 suspendida no alcanzan el mínimo');
  eq(await notifCount('auto_match_gestating', USERS[3].id), 0, 'la cuenta suspendida no recibe push');
  await admin.query('update auth.users set banned_until = null where id=$1', [USERS[3].id]);

  // Completar ubicación actualiza la MISMA fila activa y ejecuta el sync.
  await resetData();
  for (const user of USERS.slice(0, 3)) await seedAvailability(user.id, { days: COHORT_DAYS });
  const incompleteId = await seedAvailability(USERS[3].id, {
    days: COHORT_DAYS, lat: null, lng: null,
  });
  await admin.query(
    'update public.usuarios set latitud=-34.60, longitud=-58.40 where id=$1',
    [USERS[3].id],
  );
  const completed = await one(
    await asUser(USERS[3].id),
    'select * from public.sync_my_auto_match_location_from_profile()',
  );
  eq(Number(completed.id), Number(incompleteId), 'completar ubicación conserva el id de la búsqueda activa');
  eq(await num(admin, "select count(*) from public.player_availability where user_id=$1 and status='active'", [USERS[3].id]), 1,
    'completar ubicación no duplica la búsqueda');
  eq((await activeRooms('F5')).length, 1, 'al completar ubicación, cuatro válidos crean la gestación');

  // Una incompleta no aborta el cron: procesa las cuatro válidas y la excluye.
  await resetData();
  for (const user of USERS.slice(0, 4)) await seedAvailability(user.id, { days: COHORT_DAYS });
  await seedAvailability(USERS[4].id, { days: COHORT_DAYS, lat: null, lng: null });
  const mixedSweep = await one(admin, 'select * from public.sync_active_auto_match_gestations()');
  eq(Number(mixedSweep.processed_count), 4, 'el barrido procesa sólo las cuatro búsquedas elegibles');
  eq(Number(mixedSweep.failed_count), 0, 'la incompleta no aborta el barrido');
  const mixedRoom = (await activeRooms('F5'))[0];
  eq((await activeMembers(mixedRoom.id)).length, 4, 'la sala cuenta únicamente a los cuatro válidos');
  eq(await notifCount('auto_match_gestating', USERS[4].id), 0, 'la incompleta no es invitada ni notificada');

  // Regresión #621: un partido real no bloquea la creación de una gestación.
  await resetData();
  for (const user of USERS.slice(0, 4)) await seedAvailability(user.id, { days: COHORT_DAYS });
  const overlapDate = await val(
    admin,
    `select d::date
     from generate_series(current_date + 2, current_date + 14, interval '1 day') d
     where extract(isodow from d)::integer = $1
     order by d limit 1`,
    [COHORT_DAYS[0]],
  );
  const partido621 = await val(
    admin,
    `insert into public.partidos (nombre, fecha, hora, modalidad, cupo_jugadores, creado_por, estado)
     values ('Partido real #621', $1, '20:00', 'F5', 10, $2, 'activo') returning id`,
    [overlapDate, USERS[0].id],
  );
  for (const user of USERS.slice(0, 4)) {
    await admin.query(
      'insert into public.jugadores (partido_id, usuario_id, nombre) values ($1,$2,$3)',
      [partido621, user.id, user.nombre],
    );
  }
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  eq((await activeRooms('F5')).length, 1, 'los usuarios del partido #621 siguen disponibles para gestar');
}

// ---------------------------------------------------------------------------
// Escenario 16: el cron inicia la PRIMERA gestación sin ningún sync de cliente.
// También verifica capacidad, destinatarios e idempotencia de barridos repetidos.
// ---------------------------------------------------------------------------
async function scenarioBackendInitialSweep() {
  console.log('\nEscenario 16: barrido backend inicia la primera gestación');
  await resetData();

  for (const user of USERS.slice(0, 20)) {
    await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS });
  }

  eq(await num(admin, 'select count(*) from public.auto_match_proposals'), 0,
    'sin frontend todavía no existe ninguna propuesta');

  await val(admin, 'select public.auto_match_scheduled_sweep()');

  const rooms = await activeRooms('F5');
  eq(rooms.length, 1, 'el backend creó exactamente la primera sala');
  const room = rooms[0];
  eq((await activeMembers(room.id)).length, 15, 'la convocatoria respeta el máximo F5 de 15');
  eq(await num(admin, "select count(distinct user_id) from public.notifications where type='auto_match_gestating'"), 15,
    'se notificó sólo a los 15 convocados, no a las 20 búsquedas');

  const membersBefore = await num(admin, 'select count(*) from public.auto_match_proposal_members');
  const notificationsBefore = await num(admin, 'select count(*) from public.notifications');
  const deliveriesBefore = await num(admin, 'select count(*) from public.notification_delivery_log');
  const sweepResult = await one(admin, 'select * from public.sync_active_auto_match_gestations()');
  eq(Number(sweepResult.processed_count), 20, 'el backend recorrió las 20 búsquedas activas');
  eq(Number(sweepResult.failed_count), 0, 'ninguna búsqueda falló durante el barrido');
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  eq((await activeRooms('F5')).length, 1, 'barridos repetidos no duplican la sala');
  eq(await num(admin, 'select count(*) from public.auto_match_proposal_members'), membersBefore,
    'barridos repetidos no duplican miembros');
  eq(await num(admin, 'select count(*) from public.notifications'), notificationsBefore,
    'barridos repetidos no duplican notificaciones');
  eq(await num(admin, 'select count(*) from public.notification_delivery_log'), deliveriesBefore,
    'barridos repetidos no duplican pushes encolados');
}

// ---------------------------------------------------------------------------
// Escenario 17: COHORTES PROGRESIVAS. 100 compatibles para F5, lunes 20:00. La
// primera sala convoca 15; al completar sus 10 titulares se habilita SOLA la
// segunda con otros 15; al completar esa, la tercera. Sin organizador, sin sync
// manual, sin duplicar usuarios ni salas, sin 100 pushes juntos.
// ---------------------------------------------------------------------------
async function scenarioProgressiveCohorts() {
  console.log('\nEscenario 17: cohortes progresivas (100 compatibles, F5 lunes 20:00)');
  await resetData();

  // 100 disponibles idénticos (nadie organiza: la sala 1 quedará "falta
  // organizador", que NO debe frenar la cascada).
  for (const user of USERS) await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS });

  // Un solo sync arma la sala 1 (convoca hasta invitation_capacity = 15).
  await sync(USERS[0].id);
  const cap = await num(admin, "select public.auto_match_invitation_capacity('F5')");
  eq(cap, 15, 'invitation_capacity F5 = 15');

  let rooms = await activeRooms('F5');
  eq(rooms.length, 1, '1) al principio existe UNA sola sala buscando titulares');
  const room1 = rooms[0];
  const room1Members = await activeMembers(room1.id);
  eq(room1Members.length, 15, '2) esa sala tiene como máximo 15 convocados');
  eq(await num(admin, "select count(distinct user_id) from public.notifications where type='auto_match_gestating'"), 15,
    '3) solamente esos 15 reciben notificación');
  eq(await num(admin, "select count(*) from public.player_availability where status='active'"), 100,
    '4) los otros 85 continúan disponibles');
  eq(await num(admin, 'select count(distinct user_id) from public.auto_match_proposal_members'), 15,
    'nadie más fue convocado todavía');

  // Confirman 9 de los 14 pendientes => con el creador, 10 titulares.
  const pend1 = room1Members.filter((m) => m.response === 'pending').map((m) => m.user_id);
  eq(pend1.length, 14, 'la sala 1 tiene 1 creador confirmado + 14 pendientes');
  for (const uid of pend1.slice(0, 9)) await respond(uid, room1.id, 'accepted');

  // 5) la segunda sala quedó habilitada AUTOMÁTICAMENTE (sin sync manual: solo
  // corrieron confirmaciones).
  rooms = await activeRooms('F5');
  eq(rooms.length, 2, '5) al confirmar 10 titulares se habilita automáticamente la segunda sala');
  const room1After = await one(admin, 'select * from public.auto_match_proposals where id=$1', [room1.id]);
  eq(room1After.status, 'ready', 'la sala 1 quedó ready (titulares completos)');
  ok(room1After.titulares_completed_at !== null, 'la sala 1 quedó latcheada (titulares completos)');
  ok(room1After.organizer_id === null, '13) la sala 1 sin organizador no bloquea la siguiente');
  eq(await num(admin, "select public.auto_match_final_roster_capacity('F5')"), 14,
    '8) el plantel final de la sala 1 se topea en 14 (10 titulares + 4 suplentes)');

  const room2 = rooms.find((r) => String(r.id) !== String(room1.id));
  const room2Members = await activeMembers(room2.id);
  eq(room2Members.length, 15, '9) la segunda sala convoca como máximo a 15');
  const dupRoom2 = room2Members.filter((m) => room1Members.some((x) => x.user_id === m.user_id));
  eq(dupRoom2.length, 0, '6) la segunda sala usa candidatos diferentes (0 solapados con la primera)');
  eq(room2Members.filter((m) => m.response === 'accepted').length, 0,
    '7) la segunda sala nace sin miembro auto-confirmado: sus 15 entran pendientes');
  eq(await num(admin, "select count(distinct user_id) from public.notifications where type='auto_match_gestating'"), 30,
    '16) no se generan 100 pushes: 30 en total (15 + 15), uno por convocado');

  // 10) al completar la segunda (10 confirmaciones), se habilita la tercera.
  const pend2 = room2Members.map((m) => m.user_id);
  for (const uid of pend2.slice(0, 10)) await respond(uid, room2.id, 'accepted');
  rooms = await activeRooms('F5');
  eq(rooms.length, 3, '10) al completar la segunda se habilita la tercera');
  const room3 = rooms.find((r) => String(r.id) !== String(room1.id) && String(r.id) !== String(room2.id));
  eq((await activeMembers(room3.id)).length, 15, 'la tercera vuelve a convocar hasta 15');

  // 11) el proceso continúa sin duplicar usuarios ni salas.
  const memberRows = await num(admin, 'select count(*) from public.auto_match_proposal_members');
  const distinctMembers = await num(admin, 'select count(distinct user_id) from public.auto_match_proposal_members');
  eq(memberRows, distinctMembers, '11) ningún usuario aparece en dos salas (filas = usuarios distintos)');
  eq(distinctMembers, 45, '11) exactamente 45 convocados (15 × 3 salas) sin duplicar');
  eq(await num(admin, "select count(distinct user_id) from public.notifications where type='auto_match_gestating'"), 45,
    'cada convocado recibió exactamente un push de convocatoria');
}

// ---------------------------------------------------------------------------
// Escenario 18: la cascada es a prueba de carreras. Dos confirmaciones que
// cruzan el umbral a la vez NO crean dos "segundas salas". (Punto 12.)
// ---------------------------------------------------------------------------
async function scenarioCohortConcurrency() {
  console.log('\nEscenario 18: dos confirmaciones concurrentes no duplican la segunda sala');
  await resetData();

  for (const user of USERS.slice(0, 40)) await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS });
  await sync(USERS[0].id);
  const room1 = (await activeRooms('F5'))[0];
  const pend = (await activeMembers(room1.id)).filter((m) => m.response === 'pending').map((m) => m.user_id);

  // Creador + 8 confirmados = 9. Faltando uno para el umbral.
  for (const uid of pend.slice(0, 8)) await respond(uid, room1.id, 'accepted');
  eq(await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='accepted'", [room1.id]), 9,
    '9 confirmados antes de la carrera');

  // El 10.º y el 11.º confirman EXACTAMENTE a la vez: ambos cruzan el umbral.
  const [c1, c2] = await Promise.allSettled([
    respond(pend[8], room1.id, 'accepted'),
    respond(pend[9], room1.id, 'accepted'),
  ]);
  ok(c1.status === 'fulfilled' && c2.status === 'fulfilled', 'ninguna confirmación concurrente falla');

  const rooms = await activeRooms('F5');
  eq(rooms.length, 2, '12) dos confirmaciones concurrentes crean EXACTAMENTE una segunda sala (no dos)');
  const room2 = rooms.find((r) => String(r.id) !== String(room1.id));
  eq((await activeMembers(room2.id)).length, 15, 'la única segunda sala convoca 15');
}

// ---------------------------------------------------------------------------
// Escenario 19: rechazos y vencimientos liberan capacidad y suman reemplazos,
// sin re-invitar al que se fue ni mandarle una invitación equivalente inmediata
// (nada de spam). El que rechazó tampoco entra a la segunda sala. (Punto 15.)
// ---------------------------------------------------------------------------
async function scenarioCohortReplacements() {
  console.log('\nEscenario 19: rechazo/vencimiento libera capacidad y suma reemplazo (sin spam)');
  await resetData();

  for (const user of USERS.slice(0, 40)) await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS });
  await sync(USERS[0].id);
  const room1 = (await activeRooms('F5'))[0];
  const before = await activeMembers(room1.id);
  const decliner = before.find((m) => m.response === 'pending').user_id;

  // Rechaza: sale solo esa persona y entra un reemplazo compatible nuevo.
  await respond(decliner, room1.id, 'declined');
  const after = await activeMembers(room1.id);
  eq(after.length, 15, 'la sala vuelve a 15 convocados: el reemplazo cubrió la vacante');
  ok(!after.some((m) => m.user_id === decliner), 'quien rechazó no sigue como convocado vivo');
  const replacement = after.find((m) => !before.some((b) => b.user_id === m.user_id));
  ok(Boolean(replacement), 'entró un reemplazo compatible que no estaba antes');
  eq(await notifCount('auto_match_gestating', decliner), 1,
    'al que rechazó no se le reenvía la convocatoria de esa sala (una sola, la original)');

  // Vencimiento de otro pendiente: mismo comportamiento por vía del barrido.
  const toExpire = after.find((m) => m.response === 'pending' && m.user_id !== replacement.user_id).user_id;
  await admin.query(
    "update public.auto_match_proposal_members set invite_expires_at = now() - interval '1 minute' where proposal_id=$1 and user_id=$2",
    [room1.id, toExpire],
  );
  await val(admin, 'select public.expire_stale_auto_match_invites()');
  eq(await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [room1.id, toExpire]), 'expired',
    'el vencido queda expired');
  eq((await activeMembers(room1.id)).length, 15, 'el vencimiento también se reemplaza (sigue en 15)');

  // Completa titulares => segunda sala. Ni el que rechazó ni el que venció son
  // re-invitados a una sala equivalente inmediata.
  const pend = (await activeMembers(room1.id)).filter((m) => m.response === 'pending').map((m) => m.user_id);
  const accepted = await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='accepted'", [room1.id]);
  for (const uid of pend.slice(0, Math.max(0, 10 - accepted))) await respond(uid, room1.id, 'accepted');
  const room2 = (await activeRooms('F5')).find((r) => String(r.id) !== String(room1.id));
  ok(Boolean(room2), 'se habilitó la segunda sala');
  const room2Ids = (await activeMembers(room2.id)).map((m) => m.user_id);
  ok(!room2Ids.includes(decliner), 'el que rechazó NO recibe una invitación equivalente inmediata (excluido de la 2.ª sala)');
  ok(!room2Ids.includes(toExpire), 'el que venció tampoco recibe una invitación equivalente inmediata');
}

// ---------------------------------------------------------------------------
// Escenario 20: variantes. F7 (cap 21) y F11 (cap 33); distintos horarios del
// mismo día y misma hora con formatos distintos = cohortes independientes; el
// umbral de 4 compatibles corta la cascada; sync repetido es idempotente.
// ---------------------------------------------------------------------------
async function scenarioCohortVariants() {
  console.log('\nEscenario 20: variantes de cohorte (F7/F11, horarios/formatos, umbral, idempotencia)');

  // F7 => invitation_capacity 21.
  await resetData();
  for (const user of USERS.slice(0, 60)) await seedAvailability(user.id, { formats: ['F7'], days: COHORT_DAYS });
  await sync(USERS[0].id);
  eq(await num(admin, "select public.auto_match_invitation_capacity('F7')"), 21, 'invitation_capacity F7 = 21');
  let room = (await activeRooms('F7'))[0];
  eq((await activeMembers(room.id)).length, 21, 'F7: la primera sala convoca 21');
  let pend = (await activeMembers(room.id)).filter((m) => m.response === 'pending').map((m) => m.user_id);
  for (const uid of pend.slice(0, 13)) await respond(uid, room.id, 'accepted'); // +13 => 14 titulares
  eq((await activeRooms('F7')).length, 2, 'F7: al completar 14 titulares se habilita la segunda sala');
  eq((await activeMembers((await activeRooms('F7')).find((r) => String(r.id) !== String(room.id)).id)).length, 21,
    'F7: la segunda sala también convoca 21');

  // F11 => invitation_capacity 33.
  await resetData();
  for (const user of USERS.slice(0, 80)) await seedAvailability(user.id, { formats: ['F11'], days: COHORT_DAYS });
  await sync(USERS[0].id);
  eq(await num(admin, "select public.auto_match_invitation_capacity('F11')"), 33, 'invitation_capacity F11 = 33');
  room = (await activeRooms('F11'))[0];
  eq((await activeMembers(room.id)).length, 33, 'F11: la primera sala convoca 33');
  pend = (await activeMembers(room.id)).filter((m) => m.response === 'pending').map((m) => m.user_id);
  for (const uid of pend.slice(0, 21)) await respond(uid, room.id, 'accepted'); // +21 => 22 titulares
  eq((await activeRooms('F11')).length, 2, 'F11: al completar 22 titulares se habilita la segunda sala');

  // Distintos horarios del mismo día = cohortes INDEPENDIENTES (no se pisan).
  await resetData();
  for (const user of USERS.slice(0, 8)) await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS, start: '18:00', end: '20:00' });
  for (const user of USERS.slice(8, 16)) await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS, start: '21:00', end: '23:00' });
  await sync(USERS[0].id);
  await sync(USERS[8].id);
  eq((await activeRooms('F5')).length, 2, 'distintos horarios del mismo día gestan 2 salas independientes (no dedup)');

  // Misma hora, formatos distintos = cohortes INDEPENDIENTES (grupos disjuntos).
  await resetData();
  for (const user of USERS.slice(0, 8)) await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS });
  for (const user of USERS.slice(8, 16)) await seedAvailability(user.id, { formats: ['F7'], days: COHORT_DAYS });
  await sync(USERS[0].id);
  await sync(USERS[8].id);
  const formatsSeen = (await admin.query("select distinct format from public.auto_match_proposals where status in ('collecting','ready') order by format")).rows.map((r) => r.format);
  ok(formatsSeen.includes('F5') && formatsSeen.includes('F7'), 'misma hora con formatos distintos = cohortes separadas (F5 y F7)');
  eq((await activeRooms()).length, 2, 'misma hora, formatos distintos: 2 salas independientes');

  // Umbral de 4 compatibles: 18 disponibles => sala 1 (15) + 3 sobran (<4) => NO
  // hay segunda sala. 19 => sala 1 (15) + 4 => SÍ hay segunda (con 4).
  for (const [total, expectRooms, label] of [[18, 1, '18 => 3 sobran (<4): no hay segunda sala'], [19, 2, '19 => 4 sobran: sí hay segunda sala']]) {
    await resetData();
    for (const user of USERS.slice(0, total)) await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS });
    await sync(USERS[0].id);
    const r1 = (await activeRooms('F5'))[0];
    const p1 = (await activeMembers(r1.id)).filter((m) => m.response === 'pending').map((m) => m.user_id);
    for (const uid of p1.slice(0, 9)) await respond(uid, r1.id, 'accepted');
    eq((await activeRooms('F5')).length, expectRooms, label);
    if (expectRooms === 2) {
      const r2 = (await activeRooms('F5')).find((r) => String(r.id) !== String(r1.id));
      eq((await activeMembers(r2.id)).length, 4, 'la segunda sala del borde convoca a los 4 restantes');
    }
  }

  // Idempotencia: repetir el sync/backfill no duplica salas ni convocados.
  await resetData();
  for (const user of USERS.slice(0, 30)) await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS });
  await sync(USERS[0].id);
  const r1 = (await activeRooms('F5'))[0];
  const p1 = (await activeMembers(r1.id)).filter((m) => m.response === 'pending').map((m) => m.user_id);
  for (const uid of p1.slice(0, 9)) await respond(uid, r1.id, 'accepted');
  const roomsAfterFirst = (await activeRooms('F5')).length;
  const membersAfterFirst = await num(admin, 'select count(*) from public.auto_match_proposal_members');
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  eq((await activeRooms('F5')).length, roomsAfterFirst, 'el barrido repetido no duplica salas de la cohorte');
  eq(await num(admin, 'select count(*) from public.auto_match_proposal_members'), membersAfterFirst,
    'el barrido repetido no re-convoca ni duplica miembros');
}

// ---------------------------------------------------------------------------
// Escenario 21: la distancia se respeta al formar la sala. Un compatible fuera
// del radio NO es convocado. (Variante "distintos radios de distancia".)
// ---------------------------------------------------------------------------
async function scenarioCohortDistance() {
  console.log('\nEscenario 21: la distancia excluye a los que están fuera del radio');
  await resetData();

  // 6 cerca (mismo punto) + 1 lejos (~15 km, fuera del radio de 8 km).
  for (const user of USERS.slice(0, 6)) {
    await seedAvailability(user.id, { formats: ['F5'], days: COHORT_DAYS, lat: -34.60, lng: -58.40, maxKm: 8 });
  }
  const farUser = USERS[6].id;
  await seedAvailability(farUser, { formats: ['F5'], days: COHORT_DAYS, lat: -34.73, lng: -58.40, maxKm: 8 });

  await sync(USERS[0].id);
  const room = (await activeRooms('F5'))[0];
  ok(Boolean(room), 'se gestó la sala con los compatibles cercanos');
  eq(await num(admin, 'select count(*) from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [room.id, farUser]), 0,
    'el compatible fuera del radio NO es convocado a la sala');
}

// ---------------------------------------------------------------------------
// Escenario 22 (auditoría A2): un partido real confirmado excluye únicamente a
// las oportunidades cuyos horarios candidatos están TODOS ocupados; nunca
// desactiva la búsqueda ni bloquea otros días/horarios. La aceptación vuelve a
// validar y la vacante se repone por backfill.
// ---------------------------------------------------------------------------
const seedRealMatch = async (fecha, hora, userId) => {
  const partidoId = await val(
    admin,
    `insert into public.partidos (nombre, fecha, hora, modalidad, cupo_jugadores, creado_por, estado)
     values ('Partido real A2', $1, $2, 'F5', 10, $3, 'activo') returning id`,
    [fecha, hora, userId],
  );
  await admin.query(
    'insert into public.jugadores (partido_id, usuario_id, nombre) values ($1,$2,$3)',
    [partidoId, userId, 'Jugador ocupado'],
  );
  return partidoId;
};

const futureDates = async () => {
  const dateA = await val(admin, 'select (current_date + 3)::date');
  const dowA = await num(admin, 'select extract(isodow from $1::date)', [dateA]);
  const dateB = await val(admin, 'select (current_date + 4)::date');
  const dowB = await num(admin, 'select extract(isodow from $1::date)', [dateB]);
  return { dateA, dowA, dateB, dowB };
};

async function scenarioRealMatchConflictGating() {
  console.log('\nEscenario 22: A2 — conflicto total con partidos reales por oportunidad');

  // Caso 1: la única franja candidata (22:00) está ocupada => no se lo invita,
  // sin push, la búsqueda sigue activa y otro día sí procede.
  {
    await resetData();
    const { dateA, dowA, dowB } = await futureDates();
    for (const user of USERS.slice(0, 5)) {
      await seedAvailability(user.id, { days: [dowA], start: '22:00', end: '23:00' });
    }
    await seedRealMatch(dateA, '22:00', USERS[0].id);
    await val(admin, 'select public.auto_match_scheduled_sweep()');

    const rooms = await activeRooms('F5');
    eq(rooms.length, 1, 'los 4 libres gestan igual (el ocupado no bloquea la sala)');
    const roomMembers = await activeMembers(rooms[0].id);
    eq(roomMembers.length, 4, 'la sala convoca exactamente a los 4 sin conflicto');
    eq(roomMembers.some((row) => row.user_id === USERS[0].id), false,
      'conflicto total => el ocupado no es invitado');
    eq(await notifCount('auto_match_gestating', USERS[0].id), 0,
      'el ocupado no recibe push por una oportunidad imposible');
    eq(
      await val(admin, "select status from public.player_availability where user_id=$1", [USERS[0].id]),
      'active',
      'una oportunidad incompatible no desactiva la búsqueda',
    );

    const membersBefore = await num(admin, 'select count(*) from public.auto_match_proposal_members');
    const notifsBefore = await num(admin, 'select count(*) from public.notifications');
    await val(admin, 'select public.auto_match_scheduled_sweep()');
    await val(admin, 'select public.auto_match_scheduled_sweep()');
    eq(await num(admin, 'select count(*) from public.auto_match_proposal_members'), membersBefore,
      'sweeps repetidos no re-invitan al ocupado a la oportunidad imposible');
    eq(await num(admin, 'select count(*) from public.notifications'), notifsBefore,
      'sweeps repetidos no duplican notificaciones');

    // Mismo usuario, otro día sin conflicto: la oportunidad sí procede.
    for (const user of USERS.slice(5, 9)) {
      await seedAvailability(user.id, { days: [dowB], start: '22:00', end: '23:00' });
    }
    await activate(USERS[0].id, { days: [dowB] });
    const roomsAfter = await activeRooms('F5');
    eq(roomsAfter.length, 2, 'el mismo usuario gesta normalmente otro día');
    const roomB = roomsAfter.find((row) => String(row.id) !== String(rooms[0].id));
    const roomBMembers = await activeMembers(roomB.id);
    eq(roomBMembers.some((row) => row.user_id === USERS[0].id), true,
      'sigue elegible para oportunidades con horario libre');
  }

  // Caso 2: partido real a las 20:00 pero candidato libre a las 22:00 =>
  // la oportunidad se permite (la materialización elegirá la alternativa).
  {
    await resetData();
    const { dateA, dowA } = await futureDates();
    for (const user of USERS.slice(0, 5)) {
      await seedAvailability(user.id, { days: [dowA], start: '20:00', end: '23:59' });
    }
    await seedRealMatch(dateA, '20:00', USERS[0].id);
    await val(admin, 'select public.auto_match_scheduled_sweep()');

    const rooms = await activeRooms('F5');
    eq(rooms.length, 1, 'con alternativa horaria la gestación procede');
    const roomMembers = await activeMembers(rooms[0].id);
    eq(roomMembers.length, 5, 'participan los 5 (incluido el del partido 20:00)');
    eq(roomMembers.some((row) => row.user_id === USERS[0].id), true,
      'partido real 20:00 + candidato libre 22:00 => sigue permitido');
  }

  // Caso 3: partido creado DESPUÉS de la invitación y ANTES de aceptar. La
  // aceptación revalida, expira con motivo terminal y el backfill repone.
  {
    await resetData();
    const { dateA, dowA } = await futureDates();
    for (const user of USERS.slice(0, 16)) {
      await seedAvailability(user.id, { days: [dowA], start: '20:00', end: '22:00' });
    }
    await val(admin, 'select public.auto_match_scheduled_sweep()');
    const rooms = await activeRooms('F5');
    eq(rooms.length, 1, 'una sola sala F5 con 16 compatibles');
    const room = rooms[0];
    const invited = await activeMembers(room.id);
    eq(invited.length, 15, 'convocatoria completa (15) deja un compatible afuera');
    const pendingUser = invited.find((row) => row.response === 'pending').user_id;
    const outsider = USERS.slice(0, 16)
      .map((user) => user.id)
      .find((uid) => !invited.some((row) => row.user_id === uid));

    // La ventana 20:00–22:00 sólo admite candidatos 20:00–21:00; el partido
    // real [20:00,22:00) los ocupa todos.
    await seedRealMatch(dateA, '20:00', pendingUser);

    const outcome = await respond(pendingUser, room.id, 'accepted');
    eq(outcome.response, 'expired', 'la aceptación tardía no lo confirma');
    eq(outcome.response_reason, 'schedule_conflict', 'motivo terminal: schedule_conflict');

    const after = await activeMembers(room.id);
    eq(after.length, 15, 'el backfill repone el lugar en la misma transacción');
    eq(after.some((row) => row.user_id === pendingUser), false,
      'el conflictuado no conserva el lugar');
    eq(after.some((row) => row.user_id === outsider), true,
      'el compatible que había quedado afuera entra por backfill');
    eq(await notifCount('auto_match_gestating', outsider), 1,
      'el reemplazo recibe un único push');
    await expectError(
      (await asUser(pendingUser)).query(
        'select * from public.respond_to_auto_match_proposal($1,$2,$3)',
        [room.id, 'accepted', false],
      ),
      /proposal_member_expired/,
      'el estado es terminal: el reintento no lo deja pendiente',
    );

    const membersBefore = await num(admin, 'select count(*) from public.auto_match_proposal_members');
    const notifsBefore = await num(admin, 'select count(*) from public.notifications');
    await val(admin, 'select public.auto_match_scheduled_sweep()');
    await val(admin, 'select public.auto_match_scheduled_sweep()');
    eq(await num(admin, 'select count(*) from public.auto_match_proposal_members'), membersBefore,
      'los sweeps posteriores no re-invitan al expirado por agenda');
    eq(await num(admin, 'select count(*) from public.notifications'), notifsBefore,
      'los sweeps posteriores no duplican pushes');
    eq(
      await val(admin, 'select response from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [room.id, pendingUser]),
      'expired',
      'el expirado por agenda permanece terminal tras los sweeps',
    );
  }

  // Caso 4: borde de medianoche. Ventana 22:30–23:59 => candidatos 22:30 y
  // 22:45 del MISMO día local; un partido 22:00 los cubre a ambos, uno 20:00 no.
  {
    await resetData();
    const { dateA, dowA } = await futureDates();
    for (const user of USERS.slice(0, 6)) {
      await seedAvailability(user.id, { days: [dowA], start: '22:30', end: '23:59' });
    }
    await seedRealMatch(dateA, '22:00', USERS[0].id);
    await seedRealMatch(dateA, '20:00', USERS[1].id);
    await val(admin, 'select public.auto_match_scheduled_sweep()');

    const rooms = await activeRooms('F5');
    eq(rooms.length, 1, 'cerca de medianoche la sala se crea igual');
    const roomMembers = await activeMembers(rooms[0].id);
    eq(roomMembers.length, 5, 'cinco compatibles: el bloqueado a las 22:00 queda fuera');
    eq(roomMembers.some((row) => row.user_id === USERS[0].id), false,
      'sin candidato libre antes de medianoche queda excluido');
    eq(roomMembers.some((row) => row.user_id === USERS[1].id), true,
      'el partido 20:00 no bloquea el candidato de las 22:30');
  }
}

// ---------------------------------------------------------------------------
// Escenario 23 (auditoría A3): dos incorporaciones concurrentes al último lugar
// de convocatoria nunca dejan capacity + 1 pendientes. Concurrencia real con
// una conexión por usuario; el re-conteo post-lock de la Fase A es el guard.
// ---------------------------------------------------------------------------
async function scenarioInviteCapacityRace() {
  console.log('\nEscenario 23: A3 — carrera por el último lugar de convocatoria');

  const seedNearFullRoom = async () => {
    await resetData();
    const { dateA, dowA } = await futureDates();
    const slot = await val(
      admin,
      "select ($1::date + time '20:00') at time zone 'America/Argentina/Buenos_Aires'",
      [dateA],
    );
    const avail = {};
    for (const user of USERS.slice(0, 16)) {
      avail[user.id] = await seedAvailability(user.id, { days: [dowA], start: '20:00', end: '23:00' });
    }
    const pid = await val(
      admin,
      `insert into public.auto_match_proposals
         (format, proposed_starts_at, max_players, status, expires_at, gestation_started_at, gestation_threshold)
       values ('F5', $1, 10, 'collecting', $1::timestamptz - interval '30 minutes', now(), 4) returning id`,
      [slot],
    );
    for (let i = 0; i < 14; i += 1) {
      const response = i === 0 ? 'accepted' : 'pending';
      await admin.query(
        `insert into public.auto_match_proposal_members
           (proposal_id, availability_id, user_id, response, responded_at, confirmed_at, invite_expires_at)
         values ($1,$2,$3,$4,
                 case when $4='accepted' then now() else null end,
                 case when $4='accepted' then now() else null end,
                 case when $4='pending' then now() + interval '8 hours' else null end)`,
        [pid, avail[USERS[i].id], USERS[i].id, response],
      );
    }
    return { pid };
  };

  // Varias rondas para darle chances reales a la carrera del snapshot viejo.
  const ROUNDS = 6;
  let lastPid = null;
  for (let round = 1; round <= ROUNDS; round += 1) {
    const { pid } = await seedNearFullRoom();
    lastPid = pid;
    const [r1, r2] = await Promise.allSettled([sync(USERS[14].id), sync(USERS[15].id)]);
    ok(
      r1.status === 'fulfilled' && r2.status === 'fulfilled',
      `ronda ${round}: dos syncs concurrentes terminan sin error ni deadlock`,
      `${r1.reason?.message || ''} ${r2.reason?.message || ''}`,
    );
    const active = await activeMembers(pid);
    eq(active.length, 15, `ronda ${round}: la convocatoria nunca supera 15 (capacity F5)`);
    const racers = active.filter((row) => [USERS[14].id, USERS[15].id].includes(row.user_id));
    eq(racers.length, 1, `ronda ${round}: exactamente uno de los dos toma el último lugar`);
    const winner = racers[0].user_id;
    const loser = winner === USERS[14].id ? USERS[15].id : USERS[14].id;
    eq(await notifCount('auto_match_gestating', winner), 1, `ronda ${round}: sólo el ganador recibe push`);
    eq(await notifCount('auto_match_gestating', loser), 0, `ronda ${round}: el perdedor no recibe push`);
  }

  // Reintentos y sweeps sobre el estado final: idempotentes, sin duplicados.
  const membersBefore = await num(admin, 'select count(*) from public.auto_match_proposal_members');
  const notifsBefore = await num(admin, 'select count(*) from public.notifications');
  await Promise.allSettled([sync(USERS[14].id), sync(USERS[15].id)]);
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  await val(admin, 'select public.auto_match_scheduled_sweep()');
  eq(await num(admin, 'select count(*) from public.auto_match_proposal_members'), membersBefore,
    'reintentos y sweeps repetidos no agregan miembros');
  eq(await num(admin, 'select count(*) from public.notifications'), notifsBefore,
    'reintentos y sweeps repetidos no duplican pushes');
  eq((await activeMembers(lastPid)).length, 15, 'la sala queda estable en 15 convocados');

  // El cupo de titulares (10 confirmados) sigue protegido con la sala llena.
  const pendings = (await activeMembers(lastPid))
    .filter((row) => row.response === 'pending')
    .map((row) => row.user_id);
  for (const uid of pendings) await respond(uid, lastPid, 'accepted');
  eq(
    await num(admin, "select count(*) from public.auto_match_proposal_members where proposal_id=$1 and response='accepted'", [lastPid]),
    15,
    'los 15 convocados pueden confirmar (sobreconvocatoria intacta)',
  );
  const seatRows = (await (await asUser(USERS[0].id)).query(
    "select seat, count(*)::int as n from public.get_auto_match_proposal_members($1) where response='accepted' group by seat",
    [lastPid],
  )).rows;
  eq(Number(seatRows.find((row) => row.seat === 'titular')?.n || 0), 10,
    'nunca hay más de 10 titulares');
  eq(Number(seatRows.find((row) => row.seat === 'suplente')?.n || 0), 5,
    'los excedentes quedan suplentes');
}

async function main() {
  console.log(`Iniciando Postgres embebido en :${PORT} (${DATA_DIR})`);
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DB_NAME);

  admin = await connect();
  await admin.query(fs.readFileSync(path.join(__dirname, 'stub-schema.sql'), 'utf8'));
  for (const file of MIGRATIONS) {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8');
    try {
      await admin.query(sql);
      console.log(`  migración aplicada: ${file}`);
    } catch (error) {
      console.error(`  ✘ migración FALLÓ: ${file}\n    ${error.message}`);
      throw error;
    }
  }

  const authSeed = USERS.map((user) => `('${user.id}')`).join(',');
  await admin.query(`insert into auth.users (id) values ${authSeed}`);
  const adminSeed = USERS.map((user) => `('${user.id}', '${user.nombre}')`).join(',');
  await admin.query(`insert into public.usuarios (id, nombre) values ${adminSeed}`);

  await scenarioConcurrentActivation();
  await scenarioFullLifecycle();
  await scenarioVolunteersAndExpiry();
  await scenarioPrivacy();
  await scenarioProposalChat();
  await scenarioMultipleProposals();
  await scenarioOverbookingAndOrder();
  await scenarioConcurrentConfirmations();
  await scenarioInviteExpiry();
  await scenarioOverlapWithdrawal();
  const nearMidnightArgentina = await val(
    admin,
    `select (
       (now() at time zone $1)::date + time '23:59'
     ) at time zone $1`,
    [FIXTURE_TIMEZONE],
  );
  await scenarioOverlapWithdrawal({
    referenceInstant: nearMidnightArgentina,
    title: 'Escenario 10a: fixture estable al ejecutar cerca de medianoche',
  });
  await scenarioConcreteScheduleOverlapAndIdempotency();
  await scenarioProposalFiveDeterministicReconciliation();
  await scenarioCrossedProposalConcurrency();
  await scenarioFinalMaterializationSchedule();
  await scenarioSubstitutes();
  await scenarioRosterCap();
  await scenarioPromotion();
  await scenarioNoThrottle();

  // Día de cohortes: siempre ≥2 días adelante (evita la ventana de vencimiento
  // inmediato de invitaciones cuando el slot cae hoy dentro de 90 min–2 h).
  const nowDow = await num(admin, 'select extract(isodow from now())');
  COHORT_DAYS = [((nowDow + 1) % 7) + 1];

  await scenarioStrictLocationAndAccountEligibility();
  await scenarioBackendInitialSweep();
  await scenarioProgressiveCohorts();
  await scenarioCohortConcurrency();
  await scenarioCohortReplacements();
  await scenarioCohortVariants();
  await scenarioCohortDistance();
  await scenarioRealMatchConflictGating();
  await scenarioInviteCapacityRace();

  console.log(`\n${checks} chequeos, ${failures} fallas`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('\nHarness abortado:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const client of clients) {
      try { await client.end(); } catch (_error) { /* noop */ }
    }
    try { await postgres.stop(); } catch (_error) { /* noop */ }
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    process.exit(process.exitCode || 0);
  });
