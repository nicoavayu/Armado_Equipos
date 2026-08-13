#!/usr/bin/env node
//
// Contrato del ciclo de vida de la competencia contra Supabase LOCAL.
//
// A diferencia del resto de scripts de esta carpeta, este no levanta un
// PostgreSQL embebido: corre contra la instancia LOCAL real, que ya tiene el
// esquema canónico completo, RLS y el dataset QA. Cada escenario vive en su
// propia transacción y termina en ROLLBACK, así que el dataset QA canónico
// queda exactamente como estaba.
//
// Uso: node scripts/db-integration/torneos-competition-lifecycle.mjs
//
import assert from 'node:assert/strict';
import process from 'node:process';

import pg from 'pg';

const CONNECTION = process.env.TORNEOS_LOCAL_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';

const ORG = 'a5627c00-6b91-59b8-a366-455261e6e8de';
const TOURNAMENT = '439fd0cf-ce9d-53b7-9d6d-d64d680dafd0';
const CATEGORY = '6e91bbd4-db52-514e-a0b7-db44b6c91aa7';
const ARCHIVED_TOURNAMENT = 'fd083bc4-29ad-5a00-b9ad-441df5358a1e';
const COMPLETED_TOURNAMENT = '1b8663d4-a2bd-5740-b109-d5576493a444';
const LEAGUE_PHASE = 'a05ccc3d-7ce4-5a01-9bae-844ccce0b87a';

const USERS = {
  owner: 'e2811418-066f-4fe6-b9a4-a513f9cd86bc',
  admin: '9bfd3b70-735b-4eed-b341-848e999cd2c0',
  collaborator: 'ca306695-edfe-42cb-a2ee-9266b4bdecd1',
  delegate: '77416879-84d1-46c3-bfe9-9f746459addb',
  player: 'd1bd72e8-946a-4bc6-bc0f-554733699eb8',
  outsider: '4ddc94b9-94b7-4e8d-ba32-8ae305aedda5',
};

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

// --- helpers ---------------------------------------------------------------

let inTransaction = false;

async function beginTransaction() {
  await client.query('begin');
  inTransaction = true;
}

async function endTransaction(command = 'rollback') {
  await client.query(command);
  inTransaction = false;
}

async function clearIdentity() {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims', null, false)");
}

// Todo paso corre dentro de un savepoint: un fallo esperado no puede abortar el
// escenario completo, y `rollback to savepoint` devuelve también el rol y los
// claims al estado anterior.
async function runStep(userId, sql, values) {
  if (!inTransaction) {
    if (!userId) return { result: await client.query(sql, values), error: null };
    try {
      await client.query(
        `select set_config(
          'request.jwt.claims',
          json_build_object('sub', $1::text, 'role', 'authenticated')::text,
          false
        )`,
        [userId],
      );
      await client.query('set role authenticated');
      const result = await client.query(sql, values);
      await clearIdentity();
      return { result, error: null };
    } catch (error) {
      await clearIdentity();
      return { result: null, error };
    }
  }
  await client.query('savepoint step');
  try {
    if (userId) {
      await client.query(
        `select set_config(
          'request.jwt.claims',
          json_build_object('sub', $1::text, 'role', 'authenticated')::text,
          false
        )`,
        [userId],
      );
      await client.query('set role authenticated');
    }
    const result = await client.query(sql, values);
    if (userId) await clearIdentity();
    await client.query('release savepoint step');
    return { result, error: null };
  } catch (error) {
    await client.query('rollback to savepoint step');
    await client.query('release savepoint step');
    return { result: null, error };
  }
}

async function asService(sql, values = []) {
  const { result, error } = await runStep(null, sql, values);
  if (error) throw error;
  return result;
}

async function asUser(userId, sql, values = []) {
  const { result, error } = await runStep(userId, sql, values);
  if (error) throw error;
  return result;
}

// Ejecuta algo que se espera que falle sin abortar la transacción del escenario.
async function expectFailure(userId, sql, values = []) {
  const { error } = await runStep(userId, sql, values);
  return error;
}

async function scenario(name, run) {
  console.log(`\n${name}`);
  await beginTransaction();
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.error(`  ✘ escenario abortado — ${error.message}`);
  } finally {
    await endTransaction('rollback');
    await client.query('reset role');
    await client.query("select set_config('request.jwt.claims', null, false)");
  }
}

const START = 'select public.start_tournament_competition($1, $2) as result';
const FINISH = 'select public.finish_tournament_competition($1, $2) as result';
const REOPEN = 'select public.reopen_tournament_competition($1, $2, $3) as result';
const WITHDRAW = `select public.withdraw_tournament_competition_participant(
  $1, $2, $3, $4, $5
) as result`;

// Deja la competencia QA en "Lista para comenzar" sin tocar su historia.
async function resetToScheduled() {
  await asService(
    `update public.tournaments
     set status = 'scheduled', started_at = null, completed_at = null,
         reopened_at = null, reopen_count = 0
     where id = $1`,
    [TOURNAMENT],
  );
}

// Cierra todos los compromisos abiertos del dataset QA para poder finalizar.
async function resolveEveryCommitment() {
  await asService(
    `update public.tournament_match_reviews
     set status = 'approved', resolved_by = $1, resolved_at = now(),
         resolution = 'Cierre QA de revisiones abiertas'
     where status = 'open'`,
    [USERS.owner],
  );
  await asService(
    `update public.tournament_match_operations set status = 'voided'
     where status in ('draft', 'submitted', 'under_review', 'validated', 'correction_requested')`,
  );
  await asService(
    `update public.tournament_matches
     set status = 'cancelled', cancelled_at = now(),
         cancellation_reason_code = 'manual_cancellation',
         cancellation_reason_text = 'Cierre de fixture QA'
     where tournament_id = $1
       and status <> 'cancelled'
       and not exists (
         select 1 from public.tournament_match_operations operation
         where operation.match_id = tournament_matches.id
           and operation.status = 'official'
       )`,
    [TOURNAMENT],
  );
}

// El dataset QA no trae reglas de puntuación para esta competencia y sin ellas
// `rebuild_tournament_standings` no puede correr. Se agregan sólo dentro de la
// transacción del escenario.
async function ensureScoringRules() {
  await asService(
    `insert into public.tournament_scoring_rules (
       tournament_id, organization_id, points_win, points_draw, points_loss
     ) values ($1, $2, 3, 1, 0)
     on conflict (tournament_id) do nothing`,
    [TOURNAMENT, ORG],
  );
  await asService(
    `insert into public.tournament_tiebreak_rules (
       organization_id, tournament_id, criterion, sort_order
     ) values ($1, $2, 'goal_difference', 1)
     on conflict do nothing`,
    [ORG, TOURNAMENT],
  );
}

// Permite preparar estados que los guards de historia protegen. Sólo dentro de
// la transacción del escenario, que después se descarta.
async function withoutHistoryGuards(run) {
  await asService(
    'alter table public.tournament_match_outcomes disable trigger tournament_match_outcomes_history_guard',
  );
  try {
    await run();
  } finally {
    await asService(
      'alter table public.tournament_match_outcomes enable trigger tournament_match_outcomes_history_guard',
    );
  }
}

// Corre con la identidad del usuario pero sin bajar a `authenticated`, para
// poder invocar helpers internos que el cliente no tiene permitido ejecutar.
async function asInternal(userId, sql, values = []) {
  await client.query('savepoint internal');
  try {
    await client.query(
      `select set_config(
        'request.jwt.claims',
        json_build_object('sub', $1::text, 'role', 'authenticated')::text,
        false
      )`,
      [userId],
    );
    const result = await client.query(sql, values);
    await client.query("select set_config('request.jwt.claims', null, false)");
    await client.query('release savepoint internal');
    return result;
  } catch (error) {
    await client.query('rollback to savepoint internal');
    await client.query('release savepoint internal');
    throw error;
  }
}

async function openCommitmentCount() {
  const result = await asService(
    'select count(*)::int as count from public.tournament_competition_open_commitments($1, $2)',
    [ORG, TOURNAMENT],
  );
  return result.rows[0].count;
}

async function tournamentRow(id = TOURNAMENT) {
  const result = await asService('select * from public.tournaments where id = $1', [id]);
  return result.rows[0];
}

async function auditRows(action) {
  const result = await asService(
    `select * from public.tournament_audit_log
     where action = $1 and tournament_id = $2
     order by id desc`,
    [action, TOURNAMENT],
  );
  return result.rows;
}

async function ensureAssistantManager(teamEntryId) {
  await asService(
    `insert into public.tournament_team_managers (
       organization_id, team_entry_id, user_id, display_name, role, status,
       invited_by, accepted_at
     ) values ($1, $2, $3, 'QA Assistant', 'assistant', 'active', $4, now())`,
    [ORG, teamEntryId, USERS.player, USERS.owner],
  );
}

async function voidOpenOperationsFor(participantId) {
  await asService(
    `update public.tournament_match_operations set status = 'voided'
     where id in (
       select operation.id from public.tournament_match_operations operation
       join public.tournament_matches match_row on match_row.id = operation.match_id
       where match_row.tournament_id = $1
         and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)
         and operation.status in (
           'draft','submitted','under_review','validated','correction_requested'
         )
     )`,
    [TOURNAMENT, participantId],
  );
}

async function participantByName(name) {
  const result = await asService(
    `select participant.*
     from public.tournament_competition_participants participant
     where participant.tournament_id = $1 and participant.snapshot_name = $2`,
    [TOURNAMENT, name],
  );
  return result.rows[0];
}

// --- escenarios ------------------------------------------------------------

async function scenarioStartPermissions() {
  await scenario('Iniciar competencia — permisos', async () => {
    await resetToScheduled();
    const forbidden = [
      ['collaborator', USERS.collaborator],
      ['delegate/manager', USERS.delegate],
      ['player', USERS.player],
      ['outsider', USERS.outsider],
    ];
    for (const [label, userId] of forbidden) {
      const error = await expectFailure(userId, START, [ORG, TOURNAMENT]);
      check(
        error?.code === '42501',
        `${label} no puede iniciar la competencia`,
        error ? `${error.code} ${error.message}` : 'no falló',
      );
    }

    const teamEntry = await asService(
      'select id from public.tournament_team_entries where tournament_id = $1 limit 1',
      [TOURNAMENT],
    );
    await ensureAssistantManager(teamEntry.rows[0].id);
    const assistantError = await expectFailure(USERS.player, START, [ORG, TOURNAMENT]);
    check(
      assistantError?.code === '42501',
      'assistant no puede iniciar la competencia',
      assistantError ? assistantError.code : 'no falló',
    );

    const adminResult = await asUser(USERS.admin, START, [ORG, TOURNAMENT]);
    check(
      adminResult.rows[0].result.status === 'active'
        && adminResult.rows[0].result.alreadyStarted === false,
      'administrador puede iniciar la competencia',
    );
  });

  await scenario('Iniciar competencia — propietario y estado persistido', async () => {
    await resetToScheduled();
    const result = await asUser(USERS.owner, START, [ORG, TOURNAMENT]);
    const payload = result.rows[0].result;
    check(payload.status === 'active', 'propietario deja la competencia En juego');
    const row = await tournamentRow();
    check(row.status === 'active' && row.started_at !== null, 'started_at queda persistido');
    const audit = await auditRows('tournament.started');
    check(
      audit.length > 0
        && audit[0].metadata.previousStatus === 'scheduled'
        && audit[0].metadata.nextStatus === 'active'
        && audit[0].actor_user_id === USERS.owner,
      'la transición queda auditada con actor y estados',
    );
  });
}

async function scenarioStartPreconditions() {
  await scenario('Iniciar competencia — precondiciones', async () => {
    await resetToScheduled();

    // Partidos sin horario no bloquean.
    await asService(
      `update public.tournament_matches
       set status = 'unscheduled', scheduled_at = null, venue_id = null,
           court_id = null, duration_minutes = null
       where id in (
         select match_row.id from public.tournament_matches match_row
         where match_row.tournament_id = $1
           and match_row.status in ('ready', 'scheduled')
           and not exists (
             select 1 from public.tournament_match_operations operation
             where operation.match_id = match_row.id
               and operation.status not in ('superseded', 'voided')
           )
         order by match_row.match_number desc limit 5
       )`,
      [TOURNAMENT],
    );
    const unscheduled = await asUser(USERS.owner, START, [ORG, TOURNAMENT]);
    check(
      unscheduled.rows[0].result.status === 'active'
        && unscheduled.rows[0].result.unscheduledMatches >= 5,
      'los partidos sin horario no impiden iniciar y se informan',
    );

    // Doble inicio: idempotente.
    const again = await asUser(USERS.owner, START, [ORG, TOURNAMENT]);
    check(
      again.rows[0].result.alreadyStarted === true
        && again.rows[0].result.status === 'active',
      'iniciar dos veces devuelve un resultado coherente y no vuelve a auditar',
    );
    const audit = await auditRows('tournament.started');
    check(audit.length === 1, 'el doble inicio no duplica la auditoría');
  });

  await scenario('Iniciar competencia — estados incorrectos', async () => {
    await asService(
      "update public.tournaments set status = 'draft' where id = $1",
      [TOURNAMENT],
    );
    const draftError = await expectFailure(USERS.owner, START, [ORG, TOURNAMENT]);
    check(draftError?.code === '22023', 'no se puede iniciar desde Borrador');

    const archivedError = await expectFailure(
      USERS.owner, START, [ORG, ARCHIVED_TOURNAMENT],
    );
    check(
      archivedError?.code === '22023',
      'no se puede iniciar una competencia archivada',
      archivedError ? archivedError.code : 'no falló',
    );

    const completedError = await expectFailure(
      USERS.owner, START, [ORG, COMPLETED_TOURNAMENT],
    );
    check(completedError?.code === '22023', 'no se puede iniciar una competencia finalizada');
  });

  await scenario('Iniciar competencia — fixture publicado obligatorio', async () => {
    await resetToScheduled();
    await asService(
      `update public.tournament_fixture_versions set invalidated_at = now()
       where tournament_id = $1 and status = 'published'`,
      [TOURNAMENT],
    );
    const error = await expectFailure(USERS.owner, START, [ORG, TOURNAMENT]);
    check(
      error?.message === 'TORNEOS_COMPETITION_FIXTURE_NOT_PUBLISHED',
      'sin fixture publicado la competencia no puede comenzar',
      error ? error.message : 'no falló',
    );
  });

  await scenario('Iniciar competencia — toda categoría activa necesita fixture', async () => {
    await resetToScheduled();
    await asService(
      `insert into public.tournament_categories (
         organization_id, tournament_id, name, slug, sort_order, status
       )
       select organization_id, id, 'Categoría QA sin fixture',
              'categoria-qa-sin-fixture', 99, 'active'
       from public.tournaments where id = $1`,
      [TOURNAMENT],
    );
    const error = await expectFailure(USERS.owner, START, [ORG, TOURNAMENT]);
    check(
      error?.message === 'TORNEOS_COMPETITION_FIXTURE_NOT_PUBLISHED',
      'una categoría activa sin fixture publicado bloquea el inicio',
      error ? error.message : 'no falló',
    );
  });
}

async function scenarioStartConcurrency(second) {
  console.log('\nIniciar competencia — concurrencia');
  await beginTransaction();
  try {
    await resetToScheduled();
    await endTransaction('commit');
  } catch (error) {
    await endTransaction('rollback');
    failures += 1;
    console.error(`  ✘ preparación de concurrencia — ${error.message}`);
    return;
  }

  try {
    await beginTransaction();
    await asUser(USERS.owner, START, [ORG, TOURNAMENT]);

    await second.query('begin');
    await second.query("set local statement_timeout = '900ms'");
    await second.query(
      `select set_config(
        'request.jwt.claims',
        json_build_object('sub', $1::text, 'role', 'authenticated')::text,
        true
      )`,
      [USERS.owner],
    );
    await second.query('set local role authenticated');
    let concurrent = null;
    try {
      await second.query(START, [ORG, TOURNAMENT]);
    } catch (error) {
      concurrent = error;
    }
    await second.query('rollback');
    check(
      concurrent?.code === '57014',
      'dos inicios simultáneos se serializan en el lock de la competencia',
      concurrent ? `${concurrent.code} ${concurrent.message}` : 'la segunda no esperó',
    );
  } finally {
    await endTransaction('rollback');
    await client.query('reset role');
    // Restaura el estado original del dataset QA.
    await beginTransaction();
    await asService(
      `update public.tournaments
       set status = 'active', started_at = null, completed_at = null,
           reopened_at = null, reopen_count = 0
       where id = $1`,
      [TOURNAMENT],
    );
    await endTransaction('commit');
  }
}

async function scenarioFinish() {
  await scenario('Finalizar competencia — compromisos pendientes', async () => {
    const pendingBefore = await openCommitmentCount();
    check(pendingBefore > 0, 'el dataset QA tiene compromisos abiertos reales');
    const error = await expectFailure(USERS.owner, FINISH, [ORG, TOURNAMENT]);
    check(
      error?.message === 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
      'no se puede finalizar con compromisos abiertos',
      error ? error.message : 'no falló',
    );
    check(
      Number(error?.detail) === pendingBefore,
      'el error informa cuántos compromisos siguen abiertos',
      `detail=${error?.detail} esperado=${pendingBefore}`,
    );
  });

  await scenario('Finalizar competencia — permisos y transición', async () => {
    await resolveEveryCommitment();
    check(await openCommitmentCount() === 0, 'los compromisos quedaron resueltos');

    for (const [label, userId] of [
      ['collaborator', USERS.collaborator],
      ['delegate/manager', USERS.delegate],
      ['outsider', USERS.outsider],
    ]) {
      const error = await expectFailure(userId, FINISH, [ORG, TOURNAMENT]);
      check(error?.code === '42501', `${label} no puede finalizar la competencia`);
    }

    const result = await asUser(USERS.admin, FINISH, [ORG, TOURNAMENT]);
    check(
      result.rows[0].result.status === 'completed'
        && result.rows[0].result.alreadyCompleted === false,
      'administrador puede finalizar la competencia',
    );
    const row = await tournamentRow();
    check(row.completed_at !== null, 'completed_at queda persistido');

    const again = await asUser(USERS.admin, FINISH, [ORG, TOURNAMENT]);
    check(
      again.rows[0].result.alreadyCompleted === true,
      'finalizar dos veces es idempotente',
    );
    const audit = await auditRows('tournament.finished');
    check(audit.length === 1, 'la finalización queda auditada una sola vez');
  });

  await scenario('Finalizar competencia — cancelados, fecha libre y administrativos', async () => {
    await resolveEveryCommitment();
    // Fecha libre por retiro: terminal, no bloquea.
    const bye = await asService(
      `update public.tournament_matches
       set cancellation_reason_code = 'withdrawal_bye',
           cancellation_reason_text = 'Retiro QA'
       where tournament_id = $1 and status = 'cancelled'
       returning id`,
      [TOURNAMENT],
    );
    check(bye.rowCount > 0, 'hay partidos representados como fecha libre');
    check(
      await openCommitmentCount() === 0,
      'una fecha libre por retiro no bloquea la finalización',
    );

    await withoutHistoryGuards(async () => {
      // Un resultado terminal no deportivo tampoco bloquea.
      await asService(
        `update public.tournament_match_outcomes
         set outcome_type = 'not_played', counts_for_standings = false,
             counts_for_player_stats = false, requires_resolution = false,
             reason_text = 'QA not played'
         where match_operation_id = (
           select operation.id from public.tournament_match_operations operation
           join public.tournament_matches match_row on match_row.id = operation.match_id
           where match_row.tournament_id = $1 and operation.status = 'official'
           order by match_row.match_number limit 1
         )`,
        [TOURNAMENT],
      );
      check(
        await openCommitmentCount() === 0,
        'un resultado `not_played` resuelto se trata igual que un partido cancelado',
      );

      // Un resultado que anuncia continuación sí bloquea.
      await asService(
        `update public.tournament_match_outcomes
         set outcome_type = 'postponed_before_start'
         where match_operation_id = (
           select operation.id from public.tournament_match_operations operation
           join public.tournament_matches match_row on match_row.id = operation.match_id
           where match_row.tournament_id = $1 and operation.status = 'official'
           order by match_row.match_number limit 1
         )`,
        [TOURNAMENT],
      );
      check(
        await openCommitmentCount() === 1,
        'un partido postergado antes de empezar sigue siendo un compromiso abierto',
      );
    });
  });

  await scenario('Finalizar competencia — estado incorrecto', async () => {
    await resetToScheduled();
    const error = await expectFailure(USERS.owner, FINISH, [ORG, TOURNAMENT]);
    check(
      error?.code === '22023',
      'no se puede finalizar una competencia que todavía no comenzó',
    );
  });
}

async function scenarioReopen() {
  await scenario('Reabrir competencia — sólo propietario', async () => {
    await resolveEveryCommitment();
    await asUser(USERS.owner, FINISH, [ORG, TOURNAMENT]);

    const adminError = await expectFailure(
      USERS.admin, REOPEN, [ORG, TOURNAMENT, 'Corrección administrativa'],
    );
    check(
      adminError?.code === '42501',
      'el administrador no puede reabrir la competencia',
      adminError ? adminError.code : 'no falló',
    );
    for (const [label, userId] of [
      ['collaborator', USERS.collaborator],
      ['outsider', USERS.outsider],
    ]) {
      const error = await expectFailure(
        userId, REOPEN, [ORG, TOURNAMENT, 'Corrección administrativa'],
      );
      check(error?.code === '42501', `${label} no puede reabrir la competencia`);
    }

    const missingReason = await expectFailure(USERS.owner, REOPEN, [ORG, TOURNAMENT, '  ']);
    check(
      missingReason?.message === 'TORNEOS_REASON_REQUIRED',
      'reabrir exige un motivo',
      missingReason ? missingReason.message : 'no falló',
    );

    const beforeMatches = await asService(
      'select count(*)::int as count from public.tournament_matches where tournament_id = $1',
      [TOURNAMENT],
    );
    const beforeOfficial = await asService(
      `select count(*)::int as count
       from public.tournament_match_operations operation
       join public.tournament_matches match_row on match_row.id = operation.match_id
       where match_row.tournament_id = $1 and operation.status = 'official'`,
      [TOURNAMENT],
    );
    const completedAtBefore = (await tournamentRow()).completed_at;

    const result = await asUser(
      USERS.owner, REOPEN, [ORG, TOURNAMENT, 'Se cargó mal un resultado de la última fecha'],
    );
    check(
      result.rows[0].result.status === 'active'
        && result.rows[0].result.reopenCount === 1,
      'el propietario reabre la competencia y queda En juego',
    );

    const row = await tournamentRow();
    check(
      row.completed_at !== null
        && row.completed_at.getTime() === completedAtBefore.getTime(),
      'reabrir no borra cuándo fue finalizada',
    );
    check(row.reopened_at !== null, 'reopened_at queda persistido');

    const afterMatches = await asService(
      'select count(*)::int as count from public.tournament_matches where tournament_id = $1',
      [TOURNAMENT],
    );
    const afterOfficial = await asService(
      `select count(*)::int as count
       from public.tournament_match_operations operation
       join public.tournament_matches match_row on match_row.id = operation.match_id
       where match_row.tournament_id = $1 and operation.status = 'official'`,
      [TOURNAMENT],
    );
    check(
      afterMatches.rows[0].count === beforeMatches.rows[0].count
        && afterOfficial.rows[0].count === beforeOfficial.rows[0].count,
      'reabrir no reconstruye el fixture ni toca los resultados',
    );

    const audit = await auditRows('tournament.reopened');
    check(
      audit.length === 1
        && audit[0].actor_user_id === USERS.owner
        && audit[0].metadata.reason.startsWith('Se cargó mal')
        && audit[0].metadata.previousStatus === 'completed'
        && audit[0].metadata.nextStatus === 'active',
      'la reapertura audita actor, motivo y estados',
    );

    const idempotent = await asUser(
      USERS.owner, REOPEN, [ORG, TOURNAMENT, 'Reintento del mismo pedido'],
    );
    check(
      idempotent.rows[0].result.alreadyActive === true,
      'reabrir una competencia ya En juego es idempotente',
    );
  });

  await scenario('Reabrir competencia — estado incorrecto', async () => {
    await resetToScheduled();
    const error = await expectFailure(
      USERS.owner, REOPEN, [ORG, TOURNAMENT, 'Motivo válido'],
    );
    check(error?.code === '22023', 'no se puede reabrir algo que no está finalizado');
  });
}

async function scenarioReadOnly() {
  await scenario('Finalizada — read-only operacional', async () => {
    await ensureScoringRules();
    await resolveEveryCommitment();
    await asUser(USERS.owner, FINISH, [ORG, TOURNAMENT]);

    const match = await asService(
      `select id from public.tournament_matches
       where tournament_id = $1 and status = 'cancelled' limit 1`,
      [TOURNAMENT],
    );
    const scheduleError = await expectFailure(
      USERS.owner,
      `select public.restore_tournament_match_unscheduled($1, $2, 'QA')`,
      [ORG, match.rows[0].id],
    );
    check(Boolean(scheduleError), 'no se puede reprogramar en una competencia finalizada');

    const clientWrite = await asUser(
      USERS.owner,
      'update public.tournament_matches set duration_minutes = 90 where id = $1',
      [match.rows[0].id],
    );
    check(
      clientWrite.rowCount === 0,
      'el cliente autenticado no escribe partidos directamente: sólo lee',
      `rowCount=${clientWrite.rowCount}`,
    );

    const serviceWriteError = await (async () => {
      await client.query('savepoint svc');
      try {
        await asService(
          'update public.tournament_matches set duration_minutes = 90 where id = $1',
          [match.rows[0].id],
        );
        await client.query('release savepoint svc');
        return null;
      } catch (error) {
        await client.query('rollback to savepoint svc');
        await client.query('release savepoint svc');
        return error;
      }
    })();
    check(
      serviceWriteError?.message === 'TORNEOS_COMPETITION_READ_ONLY',
      'el guard es del servidor: ni siquiera un write directo lo evita',
      serviceWriteError ? serviceWriteError.message : 'no falló',
    );

    // Los derivados sí siguen recalculables.
    const rebuild = await (async () => {
      await client.query('savepoint rb');
      try {
        const result = await asUser(
          USERS.owner,
          `select public.rebuild_tournament_standings(
             $1, $2, $3, $4, null, 'Recalculo posterior al cierre', gen_random_uuid()
           ) as revision`,
          [ORG, TOURNAMENT, CATEGORY, LEAGUE_PHASE],
        );
        await client.query('release savepoint rb');
        return result;
      } catch (error) {
        await client.query('rollback to savepoint rb');
        await client.query('release savepoint rb');
        return error;
      }
    })();
    check(
      rebuild?.rows?.[0]?.revision != null,
      'la tabla se puede recalcular con la competencia finalizada',
      rebuild instanceof Error ? rebuild.message : '',
    );
  });
}

async function scenarioWithdraw() {
  await scenario('Retirar equipo — permisos', async () => {
    const participant = await participantByName('Estrella del Sur');
    for (const [label, userId] of [
      ['collaborator', USERS.collaborator],
      ['delegate/manager', USERS.delegate],
      ['player', USERS.player],
      ['outsider', USERS.outsider],
    ]) {
      const error = await expectFailure(
        userId, WITHDRAW,
        [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
      );
      check(error?.code === '42501', `${label} no puede retirar un equipo`);
    }
    await ensureAssistantManager(participant.team_entry_id);
    const assistantError = await expectFailure(
      USERS.player, WITHDRAW,
      [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
    );
    check(
      assistantError?.code === '42501',
      'assistant no puede retirar un equipo',
      assistantError ? assistantError.code : 'no falló',
    );
  });

  await scenario('Retirar equipo — motivo estructurado', async () => {
    const participant = await participantByName('Estrella del Sur');
    await voidOpenOperationsFor(participant.id);
    const invalid = await expectFailure(
      USERS.owner, WITHDRAW, [ORG, TOURNAMENT, participant.team_entry_id, 'porque si', null],
    );
    check(
      invalid?.message === 'TORNEOS_WITHDRAWAL_REASON_INVALID',
      'el motivo tiene que ser uno de los códigos estables',
    );
    const missingNote = await expectFailure(
      USERS.owner, WITHDRAW, [ORG, TOURNAMENT, participant.team_entry_id, 'other', '  '],
    );
    check(
      missingNote?.message === 'TORNEOS_WITHDRAWAL_NOTE_REQUIRED',
      '“Otro” exige observación',
    );
    const okWithoutNote = await asUser(
      USERS.admin, WITHDRAW,
      [ORG, TOURNAMENT, participant.team_entry_id, 'sanction_exclusion', null],
    );
    check(
      okWithoutNote.rows[0].result.reasonCode === 'sanction_exclusion',
      'los otros motivos aceptan observación vacía y el administrador puede ejecutarlos',
    );
  });

  await scenario('Retirar equipo — historial intacto y fecha libre', async () => {
    const participant = await participantByName('Estrella del Sur');

    const officialBefore = await asService(
      `select match_row.id, match_row.status
       from public.tournament_matches match_row
       join public.tournament_match_operations operation
         on operation.match_id = match_row.id and operation.status = 'official'
       where match_row.tournament_id = $1
         and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)`,
      [TOURNAMENT, participant.id],
    );
    check(officialBefore.rowCount > 0, 'el equipo elegido tiene partidos ya disputados');

    const openOps = await asService(
      `select count(*)::int as count
       from public.tournament_match_operations operation
       join public.tournament_matches match_row on match_row.id = operation.match_id
       where match_row.tournament_id = $1
         and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)
         and operation.status in ('draft','submitted','under_review','validated','correction_requested')`,
      [TOURNAMENT, participant.id],
    );
    if (openOps.rows[0].count > 0) {
      const blocked = await expectFailure(
        USERS.owner, WITHDRAW,
        [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
      );
      check(
        blocked?.message === 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS',
        'un acta abierta bloquea el retiro en lugar de destruirla',
      );
      const untouched = await asService(
        `select count(*)::int as count from public.tournament_matches
         where tournament_id = $1 and cancellation_reason_code = 'withdrawal_bye'`,
        [TOURNAMENT],
      );
      check(
        untouched.rows[0].count === 0 && (await participantByName('Estrella del Sur')).status === 'active',
        'el rechazo no deja partidos cerrados ni el equipo a medio retirar',
      );
      await asService(
        `update public.tournament_match_operations set status = 'voided'
         where id in (
           select operation.id from public.tournament_match_operations operation
           join public.tournament_matches match_row on match_row.id = operation.match_id
           where match_row.tournament_id = $1
             and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)
             and operation.status in ('draft','submitted','under_review','validated','correction_requested')
         )`,
        [TOURNAMENT, participant.id],
      );
    }

    // Deja compromisos futuros en varios estados, incluido uno sin horario.
    await asService(
      `update public.tournament_matches
       set status = 'unscheduled', scheduled_at = null, venue_id = null,
           court_id = null, duration_minutes = null
       where id = (
         select match_row.id from public.tournament_matches match_row
         where match_row.tournament_id = $1
           and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)
           and match_row.status in ('ready','scheduled','postponed')
           and not exists (
             select 1 from public.tournament_match_operations operation
             where operation.match_id = match_row.id
               and operation.status not in ('superseded','voided')
           )
         order by match_row.match_number limit 1
       )`,
      [TOURNAMENT, participant.id],
    );

    const futureBefore = await asService(
      `select match_row.id, match_row.status from public.tournament_matches match_row
       where match_row.tournament_id = $1
         and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)
         and match_row.status <> 'cancelled'
         and not exists (
           select 1 from public.tournament_match_operations operation
           where operation.match_id = match_row.id
             and operation.status not in ('superseded','voided')
         )`,
      [TOURNAMENT, participant.id],
    );
    check(
      futureBefore.rows.some((row) => row.status === 'unscheduled'),
      'hay al menos un compromiso futuro sin horario',
    );

    const result = await asUser(
      USERS.owner, WITHDRAW,
      [ORG, TOURNAMENT, participant.team_entry_id, 'regulatory_breach', 'No presentó la documentación'],
    );
    const payload = result.rows[0].result;
    check(
      payload.status === 'withdrawn' && payload.byeMatchCount === futureBefore.rowCount,
      'se resuelven todos los compromisos futuros elegibles, con o sin horario',
      `bye=${payload.byeMatchCount} esperado=${futureBefore.rowCount}`,
    );

    const byes = await asService(
      `select id, status, cancellation_reason_code, withdrawn_participant_id,
              home_participant_id, away_participant_id
       from public.tournament_matches
       where id = any($1::uuid[])`,
      [futureBefore.rows.map((row) => row.id)],
    );
    check(
      byes.rows.every((row) => (
        row.status === 'cancelled'
        && row.cancellation_reason_code === 'withdrawal_bye'
        && row.withdrawn_participant_id === participant.id
        && row.home_participant_id !== null
        && row.away_participant_id !== null
      )),
      'la fecha libre conserva el enfrentamiento original y registra la razón',
    );

    const officialAfter = await asService(
      `select match_row.id, match_row.status from public.tournament_matches match_row
       where match_row.id = any($1::uuid[])`,
      [officialBefore.rows.map((row) => row.id)],
    );
    check(
      officialAfter.rows.every((row) => row.status !== 'cancelled'),
      'los partidos ya disputados no se convierten en fecha libre',
    );

    const audit = await auditRows('participant.withdrawn');
    check(
      audit.length === 1
        && audit[0].metadata.reasonCode === 'regulatory_breach'
        && audit[0].metadata.reasonText === 'No presentó la documentación'
        && audit[0].metadata.affectedMatchCount === payload.byeMatchCount
        && audit[0].metadata.teamEntryId === participant.team_entry_id
        && audit[0].actor_user_id === USERS.owner,
      'el retiro audita equipo, motivo, observación y partidos afectados',
    );

    const stored = await participantByName('Estrella del Sur');
    check(
      stored.status === 'withdrawn'
        && stored.withdrawal_reason_code === 'regulatory_breach'
        && stored.withdrawn_by === USERS.owner
        && stored.withdrawn_at !== null,
      'el participante guarda motivo, actor y momento del retiro',
    );

    const doubleWithdraw = await expectFailure(
      USERS.owner, WITHDRAW,
      [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
    );
    check(
      doubleWithdraw?.message === 'TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN',
      'no se puede retirar dos veces al mismo equipo',
    );
  });

  await scenario('Retirar equipo — tabla, estadísticas y sanciones', async () => {
    const participant = await participantByName('Estrella del Sur');
    await ensureScoringRules();

    const statsBefore = await asService(
      `select count(*)::int as count from public.tournament_player_statistics
       where tournament_id = $1`,
      [TOURNAMENT],
    );
    const suspensionsBefore = await asService(
      `select count(*)::int as count from public.tournament_player_suspensions
       where tournament_id = $1`,
      [TOURNAMENT],
    );

    await asService(
      `update public.tournament_match_operations set status = 'voided'
       where id in (
         select operation.id from public.tournament_match_operations operation
         join public.tournament_matches match_row on match_row.id = operation.match_id
         where match_row.tournament_id = $1
           and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)
           and operation.status in ('draft','submitted','under_review','validated','correction_requested')
       )`,
      [TOURNAMENT, participant.id],
    );
    await asUser(
      USERS.owner, WITHDRAW,
      [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
    );

    // Medido antes de recalcular: el recálculo de disciplina es un proceso
    // derivado aparte y no forma parte del contrato del retiro.
    const suspensionsAfterWithdrawal = await asService(
      `select count(*)::int as count from public.tournament_player_suspensions
       where tournament_id = $1`,
      [TOURNAMENT],
    );
    check(
      suspensionsAfterWithdrawal.rows[0].count === suspensionsBefore.rows[0].count,
      'el retiro no inventa ni borra sanciones',
      `antes=${suspensionsBefore.rows[0].count} después=${suspensionsAfterWithdrawal.rows[0].count}`,
    );

    const revision = await asUser(
      USERS.owner,
      `select public.rebuild_tournament_standings(
         $1, $2, $3, $4, null, 'Recalculo tras el retiro', gen_random_uuid()
       ) as revision`,
      [ORG, TOURNAMENT, CATEGORY, LEAGUE_PHASE],
    );
    const standings = await asService(
      `select standing.participant_id, standing.played, standing.points,
              standing.goals_for, standing.goals_against
       from public.tournament_team_standings standing
       where standing.revision_id = $1`,
      [revision.rows[0].revision],
    );
    const retired = standings.rows.find((row) => row.participant_id === participant.id);
    check(Boolean(retired), 'el equipo retirado sigue apareciendo en la tabla');

    const byeMatchIds = await asService(
      `select id from public.tournament_matches
       where tournament_id = $1 and cancellation_reason_code = 'withdrawal_bye'`,
      [TOURNAMENT],
    );
    const rivalsPlayed = standings.rows.reduce((total, row) => total + Number(row.played), 0);
    const officialCount = await asService(
      `select count(*)::int as count
       from public.tournament_match_operations operation
       join public.tournament_matches match_row on match_row.id = operation.match_id
       join public.tournament_match_outcomes outcome
         on outcome.match_operation_id = operation.id and outcome.counts_for_standings
       where match_row.tournament_id = $1 and operation.status = 'official'
         and match_row.phase_id = $2`,
      [TOURNAMENT, LEAGUE_PHASE],
    );
    check(
      byeMatchIds.rowCount > 0 && rivalsPlayed === officialCount.rows[0].count * 2,
      'las fechas libres no suman partidos jugados a nadie',
      `played=${rivalsPlayed} oficiales=${officialCount.rows[0].count}`,
    );

    const statsAfter = await asService(
      `select count(*)::int as count from public.tournament_player_statistics
       where tournament_id = $1`,
      [TOURNAMENT],
    );
    check(
      statsAfter.rows[0].count >= statsBefore.rows[0].count,
      'el retiro no borra estadísticas individuales',
    );

    const goalEvents = await asService(
      `select count(*)::int as count from public.tournament_match_events event
       where event.match_id = any($1::uuid[])`,
      [byeMatchIds.rows.map((row) => row.id)],
    );
    check(
      goalEvents.rows[0].count === 0,
      'una fecha libre no genera eventos individuales',
    );
  });

  await scenario('Retirar equipo — la competencia puede terminar después', async () => {
    const participant = await participantByName('Estrella del Sur');
    await asService(
      `update public.tournament_match_operations set status = 'voided'
       where status in ('draft','submitted','under_review','validated','correction_requested')`,
    );
    await asUser(
      USERS.owner, WITHDRAW,
      [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
    );
    await resolveEveryCommitment();
    const finished = await asUser(USERS.owner, FINISH, [ORG, TOURNAMENT]);
    check(
      finished.rows[0].result.status === 'completed',
      'con las fechas libres resueltas la competencia se puede finalizar',
    );
  });

  await scenario('Retirar equipo — estado de la competencia', async () => {
    await asService(
      "update public.tournaments set status = 'registration' where id = $1",
      [TOURNAMENT],
    );
    const participant = await participantByName('Estrella del Sur');
    const error = await expectFailure(
      USERS.owner, WITHDRAW,
      [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
    );
    check(
      error?.code === '22023',
      'el retiro estructural pertenece a una competencia ya consolidada',
    );
  });
}

async function scenarioWithdrawConcurrency(second) {
  console.log('\nRetirar equipo — concurrencia');
  await beginTransaction();
  try {
    const participant = await participantByName('Estrella del Sur');
    await asService(
      `update public.tournament_match_operations set status = 'voided'
       where id in (
         select operation.id from public.tournament_match_operations operation
         join public.tournament_matches match_row on match_row.id = operation.match_id
         where match_row.tournament_id = $1
           and (match_row.home_participant_id = $2 or match_row.away_participant_id = $2)
           and operation.status in ('draft','submitted','under_review','validated','correction_requested')
       )`,
      [TOURNAMENT, participant.id],
    );
    await asUser(
      USERS.owner, WITHDRAW,
      [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
    );

    await second.query('begin');
    await second.query("set local statement_timeout = '900ms'");
    await second.query(
      `select set_config(
        'request.jwt.claims',
        json_build_object('sub', $1::text, 'role', 'authenticated')::text,
        true
      )`,
      [USERS.admin],
    );
    await second.query('set local role authenticated');
    let concurrent = null;
    try {
      await second.query(
        WITHDRAW,
        [ORG, TOURNAMENT, participant.team_entry_id, 'voluntary_resignation', null],
      );
    } catch (error) {
      concurrent = error;
    }
    await second.query('rollback');
    check(
      concurrent?.code === '57014',
      'dos retiros simultáneos del mismo equipo se serializan',
      concurrent ? `${concurrent.code} ${concurrent.message}` : 'la segunda no esperó',
    );
  } catch (error) {
    failures += 1;
    console.error(`  ✘ escenario abortado — ${error.message}`);
  } finally {
    await endTransaction('rollback');
    await client.query('reset role');
  }
}

async function scenarioAdministrativeResult() {
  await scenario('administrative_result — sin estadísticas individuales ficticias', async () => {
    const operation = await asService(
      `select operation.id, operation.match_id, operation.home_team_entry_id
       from public.tournament_match_operations operation
       where operation.status = 'draft' limit 1`,
    );
    check(operation.rowCount === 1, 'hay un acta en borrador para probar el contrato');
    const operationId = operation.rows[0].id;

    await asService(
      `insert into public.tournament_match_outcomes (
         match_operation_id, organization_id, match_id, outcome_type,
         reason_text, administrative_home_score, administrative_away_score,
         counts_for_standings, counts_for_player_stats, requires_resolution,
         resolved_by, resolved_at
       )
       select $1, operation.organization_id, operation.match_id, 'administrative_result',
              'Fallo del tribunal', 3, 0, true, true, false, $2, now()
       from public.tournament_match_operations operation where operation.id = $1
       on conflict (match_operation_id) do update set
         outcome_type = 'administrative_result',
         counts_for_player_stats = true,
         counts_for_standings = true,
         administrative_home_score = 3,
         administrative_away_score = 0,
         reason_text = 'Fallo del tribunal'`,
      [operationId, USERS.owner],
    );

    const validation = await asInternal(
      USERS.owner,
      'select public.validate_tournament_match_operation_payload($1) as payload',
      [operationId],
    );
    const errors = validation.rows[0].payload.errors || [];
    check(
      errors.includes('walkover_player_stats_forbidden'),
      'un `administrative_result` no puede contar para estadísticas individuales',
      JSON.stringify(errors),
    );

    await asService(
      `update public.tournament_match_outcomes set counts_for_player_stats = false
       where match_operation_id = $1`,
      [operationId],
    );
    const rosterPlayer = await asService(
      `select player.roster_player_id, player.team_entry_id
       from public.tournament_match_operation_players player
       where player.match_operation_id = $1 limit 1`,
      [operationId],
    );
    if (rosterPlayer.rowCount === 1) {
      await asService(
        `insert into public.tournament_match_events (
           organization_id, match_operation_id, match_id, team_entry_id,
           roster_player_id, event_type, minute, period, sequence_number, created_by
         )
         select operation.organization_id, operation.id, operation.match_id, $2, $3,
                'goal', 10, 'first_half', 1, $4
         from public.tournament_match_operations operation where operation.id = $1`,
        [operationId, rosterPlayer.rows[0].team_entry_id, rosterPlayer.rows[0].roster_player_id, USERS.owner],
      );
      const withEvents = await asInternal(
        USERS.owner,
        'select public.validate_tournament_match_operation_payload($1) as payload',
        [operationId],
      );
      const eventErrors = withEvents.rows[0].payload.errors || [];
      check(
        eventErrors.includes('events_not_allowed_for_outcome'),
        'un `administrative_result` no admite eventos individuales',
        JSON.stringify(eventErrors),
      );
    } else {
      check(true, 'sin jugadores convocados en el acta borrador: evento no aplicable');
    }
  });
}

async function scenarioEntryWithdrawalHardening() {
  await scenario('Baja de inscripción — etapa y roles', async () => {
    const entry = await asService(
      `select entry.id from public.tournament_team_entries entry
       where entry.tournament_id = $1 limit 1`,
      [TOURNAMENT],
    );
    const activeError = await expectFailure(
      USERS.owner,
      'select public.withdraw_tournament_team_entry($1, $2, $3)',
      [ORG, entry.rows[0].id, 'Baja aislada durante la competencia'],
    );
    check(
      activeError?.code === '42501',
      'la baja aislada ya no funciona con la competencia en juego',
      activeError ? activeError.code : 'no falló',
    );

    await ensureAssistantManager(entry.rows[0].id);
    await asService(
      "update public.tournaments set status = 'registration' where id = $1",
      [TOURNAMENT],
    );
    const assistantError = await expectFailure(
      USERS.player,
      'select public.withdraw_tournament_team_entry($1, $2, $3)',
      [ORG, entry.rows[0].id, 'Baja pedida por el assistant'],
    );
    check(
      assistantError?.code === '42501',
      'un assistant no puede dar de baja la inscripción',
      assistantError ? assistantError.code : 'no falló',
    );

    const ownerOk = await asUser(
      USERS.owner,
      'select public.withdraw_tournament_team_entry($1, $2, $3) as result',
      [ORG, entry.rows[0].id, 'Baja durante la preparación'],
    );
    check(
      ownerOk.rows[0].result.status === 'withdrawn',
      'durante la preparación la baja de inscripción sigue disponible',
    );
  });
}

// --- runner ----------------------------------------------------------------

async function main() {
  await client.connect();
  const second = new pg.Client({ connectionString: CONNECTION });
  await second.connect();

  console.log('\nCiclo de vida de la competencia — Supabase LOCAL\n');

  const baseline = await tournamentRow();
  if (!baseline || baseline.status !== 'active') {
    console.error(
      `El dataset QA LOCAL no tiene la competencia ${TOURNAMENT} En juego; `
      + `estado actual: ${baseline ? baseline.status : 'inexistente'}.`,
    );
    process.exitCode = 1;
    await client.end();
    await second.end();
    return;
  }

  try {
    await scenarioStartPermissions();
    await scenarioStartPreconditions();
    await scenarioStartConcurrency(second);
    await scenarioFinish();
    await scenarioReopen();
    await scenarioReadOnly();
    await scenarioWithdraw();
    await scenarioWithdrawConcurrency(second);
    await scenarioAdministrativeResult();
    await scenarioEntryWithdrawalHardening();
  } finally {
    const finalState = await tournamentRow();
    assert.equal(
      finalState.status,
      'active',
      'el dataset QA canónico quedó modificado; revisar los ROLLBACK',
    );
    console.log(`\n${checks - failures}/${checks} verificaciones`);
    await client.end();
    await second.end();
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
