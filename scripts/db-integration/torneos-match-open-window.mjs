#!/usr/bin/env node
//
// La ventana de apertura del acta y su excepción.
//
// `open_tournament_match_operation` permite abrir el acta hasta seis horas antes
// del horario del partido; más temprano exige un motivo en `p_override_reason`.
// Esa regla es correcta, pero se comunicaba con `55000`, que PostgREST traduce a
// HTTP 500: al organizador le llegaba como una falla del servidor una condición
// que él mismo podía resolver escribiendo el motivo.
//
// Este contrato fija las cuatro esquinas del comportamiento y el hecho de que la
// negativa sea un error del cliente. Todo corre en transacciones que terminan en
// ROLLBACK: el dataset QA canónico queda exactamente como estaba.
//
// Los partidos del dataset canónico ya tienen su acta cerrada, así que la
// apertura permitida se comprueba por lo que corresponde a esta regla: que la
// ventana deje de ser el motivo del rechazo. Que la apertura efectiva funciona
// se verifica en el recorrido por interfaz y en `torneosMatchOperationsFlow`.
//
// Uso: node scripts/db-integration/torneos-match-open-window.mjs
//
import process from 'node:process';

import pg from 'pg';

const CONNECTION = process.env.TORNEOS_LOCAL_AUTHENTICATOR_URL
  || 'postgresql://authenticator:postgres@127.0.0.1:57322/postgres';

const ORG = 'a5627c00-6b91-59b8-a366-455261e6e8de';
const MATCH = '74db14eb-e6cd-5009-ad24-4ae627fba042';
const OWNER = 'e2811418-066f-4fe6-b9a4-a513f9cd86bc';

// PostgREST devuelve 4xx para esta clase de SQLSTATE y 500 para la clase 55.
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

async function withRollback(client, run) {
  await client.query('begin');
  try {
    return await run();
  } finally {
    await client.query('rollback').catch(() => {});
  }
}

/** Coloca el partido a `hours` horas de ahora y deja la sesión como el owner. */
async function scenario(client, hours) {
  await client.query('set local role service_role');
  await client.query(
    "update public.tournament_matches set scheduled_at = now() + make_interval(hours => $2) where id = $1",
    [MATCH, hours],
  );
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: OWNER, role: 'authenticated' }),
  ]);
  await client.query('set local role authenticated');
}

async function open(client, reason) {
  return client.query(
    'select public.open_tournament_match_operation($1, $2, $3) as context',
    [ORG, MATCH, reason],
  );
}

async function main() {
  const client = new pg.Client({ connectionString: CONNECTION });
  try {
    await client.connect();

    console.log('\nDentro de la ventana el acta se abre sin explicaciones');
    await withRollback(client, async () => {
      await scenario(client, 1);
      let failure = null;
      try {
        await open(client, null);
      } catch (error) {
        failure = error;
      }
      check(
        failure?.message !== 'TORNEOS_MATCH_OPEN_WINDOW',
        'abrir el acta una hora antes del partido no pide ningún motivo',
        failure ? `${failure.code} ${failure.message}` : '',
      );
    });

    console.log('\nFuera de la ventana, sin motivo, se rechaza');
    await withRollback(client, async () => {
      await scenario(client, 48);
      let failure = null;
      try {
        await open(client, null);
      } catch (error) {
        failure = error;
      }
      check(failure !== null, 'abrir el acta dos días antes sin motivo no se permite');
      check(
        failure?.message === 'TORNEOS_MATCH_OPEN_WINDOW',
        'y lo dice con el código de contrato que la interfaz sabe traducir',
        failure?.message,
      );
      check(
        CLIENT_ERROR_CLASSES.includes(String(failure?.code || '').slice(0, 2)),
        'es un error del cliente, no una falla del servidor',
        `SQLSTATE ${failure?.code}`,
      );
      check(
        String(failure?.code || '').slice(0, 2) !== '55',
        'ya no usa la clase 55, que PostgREST devuelve como 500',
        `SQLSTATE ${failure?.code}`,
      );
    });

    console.log('\nUn motivo demasiado corto no alcanza');
    await withRollback(client, async () => {
      await scenario(client, 48);
      let failure = null;
      try {
        await open(client, '  x  ');
      } catch (error) {
        failure = error;
      }
      check(
        failure?.message === 'TORNEOS_MATCH_OPEN_WINDOW',
        'un motivo en blanco o de menos de tres caracteres sigue siendo insuficiente',
        failure?.message,
      );
    });

    console.log('\nCon un motivo real, el acta se abre y queda registrado');
    await withRollback(client, async () => {
      await scenario(client, 48);
      const reason = 'Se adelantó el partido por lluvia anunciada';
      let failure = null;
      try {
        await open(client, reason);
      } catch (error) {
        failure = error;
      }
      check(
        failure?.message !== 'TORNEOS_MATCH_OPEN_WINDOW',
        'con un motivo suficiente la ventana deja de bloquear la apertura',
        failure ? `${failure.code} ${failure.message}` : '',
      );
    });
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
