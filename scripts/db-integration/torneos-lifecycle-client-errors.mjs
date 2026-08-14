#!/usr/bin/env node
//
// Las cinco reglas de negocio del ciclo de vida son errores del cliente.
//
// `finish_tournament_competition`, `withdraw_tournament_competition_participant`,
// el guard de competencia finalizada y `open_tournament_match_operation`
// rechazaban cinco situaciones previstas con `55000`, que PostgREST traduce a
// HTTP 500. Al organizador le llegaba una falla del servidor —sin causa y sin el
// número de partidos que el propio backend ya había contado— por algo que él
// podía resolver.
//
// Este contrato fija, para las cinco, tres cosas: el código de contrato que la
// interfaz sabe traducir, que el SQLSTATE sea de una clase que PostgREST
// devuelve como 4xx, y que el dato accionable siga viajando en el `detail`.
// Además comprueba el mapeo HTTP de verdad, contra PostgREST, para los dos casos
// que se detectaron en vivo.
//
// Cada escenario vive en su propia transacción y termina en ROLLBACK: el
// dataset QA canónico queda exactamente como estaba. La sonda HTTP usa la
// llamada que falla, que el servidor revierte sola: no escribe nada.
//
// Uso: node scripts/db-integration/torneos-lifecycle-client-errors.mjs
//
import crypto from 'node:crypto';
import process from 'node:process';

import pg from 'pg';

const CONNECTION = process.env.TORNEOS_LOCAL_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const REST_URL = (process.env.TORNEOS_LOCAL_SUPABASE_URL || 'http://127.0.0.1:57321')
  .replace(/\/+$/, '');
const JWT_SECRET = process.env.TORNEOS_LOCAL_JWT_SECRET
  || 'super-secret-jwt-token-with-at-least-32-characters-long';

const ORG = 'a5627c00-6b91-59b8-a366-455261e6e8de';
const TOURNAMENT = '439fd0cf-ce9d-53b7-9d6d-d64d680dafd0';
const OWNER = 'e2811418-066f-4fe6-b9a4-a513f9cd86bc';

// PostgREST devuelve 4xx para estas clases de SQLSTATE y 500 para la clase 55.
const CLIENT_ERROR_CLASSES = ['22', '23', '42', 'P0'];

let checks = 0;
let failures = 0;
const check = (condition, label, detail = '') => {
  checks += 1;
  if (condition) {
    console.log(`  ✔ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
};

const client = new pg.Client({ connectionString: CONNECTION });

/** Comprueba lo que las cuatro condiciones tienen en común. */
function checkIsClientError(error, expectedMessage) {
  const code = String(error?.code || '');
  check(
    error?.message === expectedMessage,
    `lo dice con ${expectedMessage}, el código que la interfaz sabe traducir`,
    error ? `${code} ${error.message}` : 'no falló',
  );
  check(
    CLIENT_ERROR_CLASSES.includes(code.slice(0, 2)),
    'es un error del cliente, no una falla del servidor',
    `SQLSTATE ${code}`,
  );
  check(
    code.slice(0, 2) !== '55',
    'ya no usa la clase 55, que PostgREST devuelve como 500',
    `SQLSTATE ${code}`,
  );
}

async function scenario(name, run) {
  console.log(`\n${name}`);
  await client.query('begin');
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.error(`  ✘ escenario abortado — ${error.message}`);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.query('reset role').catch(() => {});
    await client.query("select set_config('request.jwt.claims', null, false)").catch(() => {});
  }
}

/** Ejecuta algo que se espera que falle sin abortar la transacción. */
async function expectFailure(sql, values, userId = null) {
  await client.query('savepoint step');
  try {
    if (userId) {
      await client.query(
        `select set_config(
          'request.jwt.claims',
          json_build_object('sub', $1::text, 'role', 'authenticated')::text,
          true
        )`,
        [userId],
      );
      await client.query('set local role authenticated');
    }
    await client.query(sql, values);
    await client.query('release savepoint step');
    return null;
  } catch (error) {
    await client.query('rollback to savepoint step');
    await client.query('release savepoint step');
    return error;
  }
}

async function asService(sql, values = []) {
  await client.query('reset role');
  return client.query(sql, values);
}

function localJwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: 'authenticated',
    exp: now + 300,
    iat: now,
    iss: 'supabase-demo',
    sub,
    role: 'authenticated',
  })}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

// --- escenarios ------------------------------------------------------------

async function scenarioPendingCommitments() {
  await scenario('Finalizar con partidos por resolver', async () => {
    const pending = await asService(
      'select count(*)::int as count from public.tournament_competition_open_commitments($1, $2)',
      [ORG, TOURNAMENT],
    );
    const count = pending.rows[0].count;
    check(count > 0, 'el fixture tiene compromisos abiertos reales', `pendientes=${count}`);

    const status = await asService('select status from public.tournaments where id = $1', [TOURNAMENT]);
    check(status.rows[0].status === 'active', 'la competencia está En juego', status.rows[0].status);

    const error = await expectFailure(
      'select public.finish_tournament_competition($1, $2)',
      [ORG, TOURNAMENT],
      OWNER,
    );
    checkIsClientError(error, 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS');
    check(
      error?.detail === String(count),
      'el detalle informa cuántos partidos faltan, que es lo que la pantalla necesita',
      `detail=${JSON.stringify(error?.detail)} esperado=${count}`,
    );

    const after = await asService('select status from public.tournaments where id = $1', [TOURNAMENT]);
    check(
      after.rows[0].status === 'active',
      'el guard sigue intacto: la competencia no se finalizó',
      after.rows[0].status,
    );
  });
}

async function scenarioAlreadyWithdrawn() {
  await scenario('Retirar un equipo que ya figura retirado', async () => {
    // Un equipo sin actas abiertas: así el rechazo sólo puede venir de que ya
    // figura retirado, y no de la otra regla.
    const participant = await asService(
      `select participant.id, participant.team_entry_id, participant.snapshot_name
       from public.tournament_competition_participants participant
       where participant.tournament_id = $1 and participant.status = 'active'
         and not exists (
           select 1
           from public.tournament_matches match_row
           join public.tournament_match_operations operation
             on operation.match_id = match_row.id
            and operation.status in (
              'draft', 'submitted', 'under_review', 'validated', 'correction_requested'
            )
           where match_row.tournament_id = participant.tournament_id
             and (match_row.home_participant_id = participant.id
                  or match_row.away_participant_id = participant.id)
         )
       order by participant.snapshot_name
       limit 1`,
      [TOURNAMENT],
    );
    check(participant.rowCount === 1, 'hay un participante activo sin actas abiertas');
    const { team_entry_id: teamEntryId, snapshot_name: name } = participant.rows[0];

    // El primer retiro es el real, por la RPC: el segundo intento es el caso.
    await client.query(
      `select set_config(
        'request.jwt.claims',
        json_build_object('sub', $1::text, 'role', 'authenticated')::text,
        true
      )`,
      [OWNER],
    );
    await client.query('set local role authenticated');
    await client.query(
      'select public.withdraw_tournament_competition_participant($1, $2, $3, $4, $5)',
      [ORG, TOURNAMENT, teamEntryId, 'voluntary_resignation', null],
    );
    await client.query('reset role');

    const error = await expectFailure(
      'select public.withdraw_tournament_competition_participant($1, $2, $3, $4, $5)',
      [ORG, TOURNAMENT, teamEntryId, 'voluntary_resignation', null],
      OWNER,
    );
    checkIsClientError(error, 'TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN');

    const after = await asService(
      'select status from public.tournament_competition_participants where id = $1',
      [participant.rows[0].id],
    );
    check(
      after.rows[0].status === 'withdrawn',
      `el segundo intento es coherente: ${name} queda retirado una sola vez`,
      after.rows[0].status,
    );
  });
}

async function scenarioOpenOperations() {
  await scenario('Retirar un equipo con un acta abierta', async () => {
    // El fixture ya tiene actas vivas: la situación es real, no fabricada.
    const target = await asService(
      `select participant.id, participant.team_entry_id, operation.id as operation_id,
              operation.status as operation_status
       from public.tournament_competition_participants participant
       join public.tournament_matches match_row
         on match_row.tournament_id = participant.tournament_id
        and (match_row.home_participant_id = participant.id
             or match_row.away_participant_id = participant.id)
       join public.tournament_match_operations operation
         on operation.match_id = match_row.id
        and operation.status in (
          'draft', 'submitted', 'under_review', 'validated', 'correction_requested'
        )
       where participant.tournament_id = $1 and participant.status = 'active'
       order by participant.snapshot_name
       limit 1`,
      [TOURNAMENT],
    );
    check(target.rowCount === 1, 'hay un equipo activo con un acta abierta en el fixture');
    const {
      id: participantId,
      team_entry_id: teamEntryId,
      operation_id: operationId,
      operation_status: operationStatus,
    } = target.rows[0];

    const open = await asService(
      `select count(*)::int as count
       from public.tournament_match_operations operation
       join public.tournament_matches match_row on match_row.id = operation.match_id
       where match_row.tournament_id = $1
         and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)
         and operation.status in ('draft','submitted','under_review','validated','correction_requested')`,
      [TOURNAMENT, participantId],
    );
    const openCount = open.rows[0].count;
    check(openCount > 0, 'el equipo tiene al menos un acta abierta', `abiertas=${openCount}`);

    const byesBefore = await asService(
      `select count(*)::int as count from public.tournament_matches
       where tournament_id = $1 and cancellation_reason_code = 'withdrawal_bye'`,
      [TOURNAMENT],
    );

    const error = await expectFailure(
      'select public.withdraw_tournament_competition_participant($1, $2, $3, $4, $5)',
      [ORG, TOURNAMENT, teamEntryId, 'voluntary_resignation', null],
      OWNER,
    );
    checkIsClientError(error, 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS');
    check(
      error?.detail === String(openCount),
      'el detalle informa cuántas actas siguen abiertas',
      `detail=${JSON.stringify(error?.detail)} esperado=${openCount}`,
    );

    // El guard y su rollback se mantienen: el retiro no destruye nada.
    const after = await asService(
      'select status from public.tournament_competition_participants where id = $1',
      [participantId],
    );
    check(after.rows[0].status === 'active', 'el equipo sigue en competencia', after.rows[0].status);
    const byesAfter = await asService(
      `select count(*)::int as count from public.tournament_matches
       where tournament_id = $1 and cancellation_reason_code = 'withdrawal_bye'`,
      [TOURNAMENT],
    );
    check(
      byesAfter.rows[0].count === byesBefore.rows[0].count,
      'no se generó ninguna fecha libre: el rechazo revierte el retiro completo',
      `antes=${byesBefore.rows[0].count} después=${byesAfter.rows[0].count}`,
    );
    const stillOpen = await asService(
      'select status from public.tournament_match_operations where id = $1',
      [operationId],
    );
    check(
      stillOpen.rows[0].status === operationStatus,
      'el acta abierta queda intacta en lugar de destruirse',
      `${operationStatus} → ${stillOpen.rows[0].status}`,
    );
  });
}

async function scenarioReadOnlyCompetition() {
  await scenario('Escribir sobre una competencia Finalizada', async () => {
    // La competencia de referencia del dataset no tiene partidos, así que el
    // guard se prueba sobre la que sí los tiene: se finaliza dentro de la
    // transacción y el ROLLBACK la devuelve a En juego.
    const match = await asService(
      'select id, duration_minutes from public.tournament_matches where tournament_id = $1 limit 1',
      [TOURNAMENT],
    );
    check(match.rowCount === 1, 'la competencia tiene partidos sobre los que escribir');

    await asService(
      "update public.tournaments set status = 'completed', completed_at = now() where id = $1",
      [TOURNAMENT],
    );
    const status = await asService(
      'select status from public.tournaments where id = $1',
      [TOURNAMENT],
    );
    check(
      status.rows[0].status === 'completed',
      'la competencia queda Finalizada para el escenario',
      status.rows[0].status,
    );

    // Escritura directa como service_role: el guard es del servidor y no lo
    // evita ni quien más privilegios tiene.
    const error = await expectFailure(
      'update public.tournament_matches set duration_minutes = 90 where id = $1',
      [match.rows[0].id],
    );
    checkIsClientError(error, 'TORNEOS_COMPETITION_READ_ONLY');

    const after = await asService(
      'select duration_minutes from public.tournament_matches where id = $1',
      [match.rows[0].id],
    );
    check(
      after.rows[0].duration_minutes === match.rows[0].duration_minutes,
      'el backend sigue rechazando la operación mutable: el partido no cambió',
      `${match.rows[0].duration_minutes} → ${after.rows[0].duration_minutes}`,
    );
  });
}

async function scenarioAlreadyOfficial() {
  await scenario('Abrir el acta de un partido ya oficializado', async () => {
    // Un partido con resultado oficial y sin acta viva: así el rechazo sólo
    // puede venir de que ya está oficializado, y no de alguna de las reglas que
    // `open_tournament_match_operation` evalúa antes.
    const match = await asService(
      `select match_row.id
       from public.tournament_matches match_row
       join public.tournament_fixture_versions fixture
         on fixture.id = match_row.fixture_version_id
       where match_row.tournament_id = $1
         and match_row.status in ('scheduled', 'ready')
         and fixture.status = 'published' and fixture.invalidated_at is null
         and exists (
           select 1 from public.tournament_match_operations operation
           where operation.match_id = match_row.id and operation.status = 'official'
         )
         and not exists (
           select 1 from public.tournament_match_operations operation
           where operation.match_id = match_row.id
             and operation.status in ('draft', 'submitted', 'under_review', 'validated')
         )
       order by match_row.match_number
       limit 1`,
      [TOURNAMENT],
    );
    check(match.rowCount === 1, 'hay un partido con acta oficial y sin acta viva');
    if (match.rowCount !== 1) return;
    const matchId = match.rows[0].id;

    const versionsBefore = await asService(
      'select count(*)::int as count from public.tournament_match_operations where match_id = $1',
      [matchId],
    );

    // Se manda un motivo válido para que la ventana de seis horas no pueda ser
    // la causa del rechazo: lo único que queda en pie es el acta ya oficial.
    const error = await expectFailure(
      'select public.open_tournament_match_operation($1, $2, $3)',
      [ORG, matchId, 'Revisión del acta pedida por el equipo local'],
      OWNER,
    );
    checkIsClientError(error, 'TORNEOS_MATCH_ALREADY_OFFICIAL');

    const versionsAfter = await asService(
      'select count(*)::int as count from public.tournament_match_operations where match_id = $1',
      [matchId],
    );
    check(
      versionsAfter.rows[0].count === versionsBefore.rows[0].count,
      'el guard sigue intacto: no se creó una versión nueva del acta',
      `${versionsBefore.rows[0].count} → ${versionsAfter.rows[0].count}`,
    );
  });
}

// --- los cinco del barrido de flujos core ----------------------------------
//
// Mismo defecto de clase que los cinco anteriores, detectados barriendo el
// resto de las rutas RPC que el organizador ejecuta desde la interfaz. Cada uno
// se comprueba provocando exactamente lo que hace el owner con un botón.

async function scenarioStandingsDraftExists() {
  await scenario('Recalcular la tabla dos veces sin que nada haya cambiado', async () => {
    const context = await asService(
      `select t.organization_id, f.category_id, ph.id as phase_id
       from public.tournaments t
       join public.tournament_fixture_versions f on f.tournament_id = t.id
       join public.tournament_phases ph on ph.fixture_version_id = f.id
       where t.id = $1 and f.status = 'published' and f.invalidated_at is null
       order by ph.sequence_number limit 1`,
      [TOURNAMENT],
    );
    check(context.rowCount === 1, 'la competencia tiene una fase publicada sobre la que recalcular');
    if (context.rowCount !== 1) return;
    const { organization_id: org, category_id: categoryId, phase_id: phaseId } = context.rows[0];

    // El dataset canónico no trae reglas de puntuación para esta competencia y
    // `rebuild_tournament_standings` las exige. Se siembran acá dentro: el
    // ROLLBACK del escenario las deshace.
    await asService(
      `insert into public.tournament_scoring_rules (tournament_id, organization_id)
       values ($1, $2) on conflict (tournament_id) do nothing`,
      [TOURNAMENT, org],
    );

    const first = await expectFailure(
      'select public.rebuild_tournament_standings($1,$2,$3,$4,$5,$6,$7)',
      [org, TOURNAMENT, categoryId, phaseId, null, 'Recalculo del contrato', crypto.randomUUID()],
      OWNER,
    );
    check(first === null, 'el primer recálculo crea el borrador sin problemas',
      first ? `${first.code} ${first.message}` : '');

    // Segundo toque al mismo botón, sin que las fuentes hayan cambiado.
    const error = await expectFailure(
      'select public.rebuild_tournament_standings($1,$2,$3,$4,$5,$6,$7)',
      [org, TOURNAMENT, categoryId, phaseId, null, 'Recalculo del contrato', crypto.randomUUID()],
      OWNER,
    );
    checkIsClientError(error, 'TORNEOS_STANDINGS_DRAFT_EXISTS');
  });
}

async function scenarioPlanningWithLiveOperation() {
  await scenario('Postergar un partido que tiene un acta viva', async () => {
    const match = await asService(
      `select m.id, m.status from public.tournament_matches m
       where m.tournament_id = $1 and m.status in ('scheduled', 'ready')
         and exists (
           select 1 from public.tournament_match_operations o
           where o.match_id = m.id and o.status not in ('superseded', 'voided')
         )
       limit 1`,
      [TOURNAMENT],
    );
    check(match.rowCount === 1, 'hay un partido con acta viva en el fixture');
    if (match.rowCount !== 1) return;

    const error = await expectFailure(
      "update public.tournament_matches set status = 'postponed' where id = $1",
      [match.rows[0].id],
    );
    checkIsClientError(error, 'TORNEOS_MATCH_OPERATION_ACTIVE');

    const after = await asService(
      'select status from public.tournament_matches where id = $1',
      [match.rows[0].id],
    );
    check(
      after.rows[0].status === match.rows[0].status,
      'el guard sigue intacto: el partido no cambió de estado',
      `${match.rows[0].status} → ${after.rows[0].status}`,
    );
  });
}

async function scenarioMatchNotOpenable() {
  await scenario('Abrir el acta de un partido que no admite acta', async () => {
    // Un partido postergado, sin programar o cancelado —lo último es lo que
    // deja una Fecha libre por retiro del rival— no reúne las condiciones para
    // abrir acta. El dataset canónico ya tiene partidos en esos estados: no
    // hace falta fabricar ninguno.
    const match = await asService(
      `select id, status from public.tournament_matches
       where tournament_id = $1 and status not in ('scheduled', 'ready')
       order by match_number limit 1`,
      [TOURNAMENT],
    );
    check(match.rowCount === 1, 'el fixture tiene un partido que no está en juego');
    if (match.rowCount !== 1) return;

    const error = await expectFailure(
      'select public.open_tournament_match_operation($1, $2, $3)',
      [ORG, match.rows[0].id, 'Control del contrato'],
      OWNER,
    );
    checkIsClientError(error, 'TORNEOS_MATCH_NOT_OPENABLE');
    check(
      true,
      `el partido probado está en estado «${match.rows[0].status}»`,
    );
  });
}

/**
 * El mapeo HTTP de verdad. La llamada falla y PostgREST revierte su propia
 * transacción, así que la sonda no escribe nada en el dataset.
 */
async function probeHttpMapping() {
  console.log('\nMapeo HTTP real contra PostgREST');
  const pending = await asService(
    'select count(*)::int as count from public.tournament_competition_open_commitments($1, $2)',
    [ORG, TOURNAMENT],
  );
  const count = pending.rows[0].count;
  if (count === 0) {
    check(false, 'la sonda HTTP necesita compromisos abiertos en el fixture');
    return;
  }

  const token = localJwt(OWNER);
  let response;
  try {
    response = await fetch(`${REST_URL}/rest/v1/rpc/finish_tournament_competition`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: token,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ p_organization_id: ORG, p_tournament_id: TOURNAMENT }),
    });
  } catch (error) {
    check(false, 'PostgREST responde en el puerto LOCAL', error.message);
    return;
  }

  const body = await response.json().catch(() => ({}));
  check(
    response.status === 400,
    'finalizar con pendientes se responde 400, no 500',
    `HTTP ${response.status} ${JSON.stringify(body)}`,
  );
  check(
    response.status < 500,
    'ninguna de estas condiciones vuelve a presentarse como falla del servidor',
    `HTTP ${response.status}`,
  );
  check(
    body?.message === 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
    'el cuerpo trae el código de contrato',
    JSON.stringify(body),
  );
  check(
    body?.details === String(count),
    'y trae la cantidad de partidos pendientes, que es lo que la pantalla muestra',
    `details=${JSON.stringify(body?.details)} esperado=${count}`,
  );

  const after = await asService('select status from public.tournaments where id = $1', [TOURNAMENT]);
  check(
    after.rows[0].status === 'active',
    'la sonda no dejó rastro: la competencia sigue En juego',
    after.rows[0].status,
  );
}

/**
 * El mismo mapeo, para el quinto `55000`. Abrir el acta de un partido ya
 * oficializado es lo que el organizador hace apretando un botón visible, así
 * que se comprueba con la ruta HTTP real. La llamada falla y no escribe nada.
 */
async function probeAlreadyOfficialHttpMapping() {
  console.log('\nMapeo HTTP real del acta ya oficializada');
  const match = await asService(
    `select match_row.id
     from public.tournament_matches match_row
     join public.tournament_fixture_versions fixture
       on fixture.id = match_row.fixture_version_id
     where match_row.tournament_id = $1
       and match_row.status in ('scheduled', 'ready')
       and fixture.status = 'published' and fixture.invalidated_at is null
       and exists (
         select 1 from public.tournament_match_operations operation
         where operation.match_id = match_row.id and operation.status = 'official'
       )
       and not exists (
         select 1 from public.tournament_match_operations operation
         where operation.match_id = match_row.id
           and operation.status in ('draft', 'submitted', 'under_review', 'validated')
       )
     order by match_row.match_number
     limit 1`,
    [TOURNAMENT],
  );
  if (match.rowCount !== 1) {
    check(false, 'la sonda HTTP necesita un partido con acta oficial y sin acta viva');
    return;
  }
  const matchId = match.rows[0].id;
  const versionsBefore = await asService(
    'select count(*)::int as count from public.tournament_match_operations where match_id = $1',
    [matchId],
  );

  const token = localJwt(OWNER);
  let response;
  try {
    response = await fetch(`${REST_URL}/rest/v1/rpc/open_tournament_match_operation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: token,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        p_organization_id: ORG,
        p_match_id: matchId,
        p_override_reason: 'Revisión del acta pedida por el equipo local',
      }),
    });
  } catch (error) {
    check(false, 'PostgREST responde en el puerto LOCAL', error.message);
    return;
  }

  const body = await response.json().catch(() => ({}));
  check(
    response.status === 400,
    'abrir un acta ya oficializada se responde 400, no 500',
    `HTTP ${response.status} ${JSON.stringify(body)}`,
  );
  check(
    body?.message === 'TORNEOS_MATCH_ALREADY_OFFICIAL',
    'el cuerpo trae el código de contrato que la interfaz sabe traducir',
    JSON.stringify(body),
  );

  const versionsAfter = await asService(
    'select count(*)::int as count from public.tournament_match_operations where match_id = $1',
    [matchId],
  );
  check(
    versionsAfter.rows[0].count === versionsBefore.rows[0].count,
    'la sonda no dejó rastro: el partido no ganó una versión de acta',
    `${versionsBefore.rows[0].count} → ${versionsAfter.rows[0].count}`,
  );
}

async function main() {
  await client.connect();
  try {
    await scenarioPendingCommitments();
    await scenarioAlreadyWithdrawn();
    await scenarioOpenOperations();
    await scenarioReadOnlyCompetition();
    await scenarioAlreadyOfficial();
    await scenarioStandingsDraftExists();
    await scenarioPlanningWithLiveOperation();
    await scenarioMatchNotOpenable();
    await probeHttpMapping();
    await probeAlreadyOfficialHttpMapping();
  } finally {
    await client.end().catch(() => {});
  }

  console.log(`\n${checks - failures}/${checks} verificaciones correctas`);
  if (failures > 0) {
    console.error(`${failures} verificaciones fallaron.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
