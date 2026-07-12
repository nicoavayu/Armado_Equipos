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
];

const PORT = 54300 + Math.floor(Math.random() * 500);
const DB_NAME = 'arma2_auto_match';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arma2-embedded-pg-'));

const USERS = Array.from({ length: 12 }, (_, index) => ({
  id: `00000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}`,
  nombre: `Jugador ${index + 1}`,
}));

let failures = 0;
let checks = 0;
const clients = [];

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

const activate = async (uid, { canOrganize = false, formats = ['F5'] } = {}) => {
  const client = await asUser(uid);
  return one(
    client,
    `select * from public.upsert_my_availability(
       $1::smallint[], $2::time, $3::time, $4::text[], 8, null, null, $5::boolean)`,
    [[1, 2, 3, 4, 5, 6, 7], '20:00', '23:00', formats, canOrganize],
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

  // user11 compatible: con el cupo convocado lleno no puede entrar todavía.
  await activate(USERS[10].id);
  eq(
    await num(admin, 'select count(*) from public.auto_match_proposal_members where proposal_id=$1 and user_id=$2', [proposal.id, USERS[10].id]),
    0,
    'un 11.º compatible no entra mientras el roster está lleno',
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
    'el reemplazo compatible fue invitado automáticamente',
  );
  eq(await notifCount('auto_match_gestating', USERS[10].id), 1, 'el reemplazo recibió exactamente 1 notificación');

  // Bloqueo por ocurrencia: mismo slot bloqueado hasta que pase; otro día no.
  const slot = afterDecline.proposed_starts_at;
  eq(
    await val(admin, "select public.user_declined_auto_match_slot($1,'F5',$2::timestamptz)", [holdout, slot]),
    true,
    'quien rechazó queda bloqueado para esa ocurrencia',
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

  // Superposición: con el partido real creado, ningún participante vuelve a
  // gestar/joinsear otra propuesta en el mismo slot.
  await Promise.all(USERS.slice(0, 10).map((user) => sync(user.id)));
  eq(
    await num(admin, "select count(*) from public.auto_match_proposals where status in ('collecting','ready')"),
    0,
    'sync posterior no crea propuestas superpuestas con el partido',
  );
  eq(
    await val(admin, 'select public.user_has_overlapping_auto_match($1, $2::timestamptz, null)', [USERS[1].id, slot]),
    true,
    'el partido real cuenta como superposición',
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

  const adminSeed = USERS.map((user) => `('${user.id}', '${user.nombre}')`).join(',');
  await admin.query(`insert into public.usuarios (id, nombre) values ${adminSeed}`);

  await scenarioConcurrentActivation();
  await scenarioFullLifecycle();
  await scenarioVolunteersAndExpiry();
  await scenarioPrivacy();

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
