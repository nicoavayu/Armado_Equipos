#!/usr/bin/env node
//
// La tabla de posiciones tiene que poder recalcularse por la API, no sólo por psql.
//
// Supabase precarga `safeupdate` en el rol `authenticator`, que es el rol con el
// que PostgREST abre todas sus conexiones. Esa librería rechaza cualquier
// `UPDATE`/`DELETE` sin cláusula `where`. `rank_tournament_standings` escribía su
// tabla temporal de trabajo sin filtro, así que `rebuild_tournament_standings`
// funcionaba por psql (rol `postgres`, sin la librería) y fallaba siempre desde
// la aplicación con `21000 UPDATE requires a WHERE clause`: la tabla no se podía
// calcular nunca desde el producto.
//
// Este contrato corre las dos mitades del problema:
//   1. estático: ninguna escritura sobre la tabla temporal puede quedar sin `where`;
//   2. vivo: el recálculo real, ejecutado sobre una conexión `authenticator` —con
//      `safeupdate` activo, igual que PostgREST— tiene que terminar bien, respetar
//      los criterios de desempate configurados y ser determinista.
//
// Todo corre dentro de transacciones que terminan en ROLLBACK: el dataset QA
// canónico queda exactamente como estaba.
//
// Uso: node scripts/db-integration/torneos-standings-safeupdate.mjs
//
import process from 'node:process';

import pg from 'pg';

const ADMIN_CONNECTION = process.env.TORNEOS_LOCAL_DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
// Mismo rol que usa PostgREST: es lo que trae `safeupdate` a la sesión.
const POSTGREST_CONNECTION = process.env.TORNEOS_LOCAL_AUTHENTICATOR_URL
  || 'postgresql://authenticator:postgres@127.0.0.1:57322/postgres';

const ORG = 'a5627c00-6b91-59b8-a366-455261e6e8de';
const TOURNAMENT = '439fd0cf-ce9d-53b7-9d6d-d64d680dafd0';
const CATEGORY = '6e91bbd4-db52-514e-a0b7-db44b6c91aa7';
const LEAGUE_PHASE = 'a05ccc3d-7ce4-5a01-9bae-844ccce0b87a';

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

/** Sentencias `update`/`delete` sobre la tabla temporal de trabajo del ranking. */
function temporaryWrites(definition) {
  const writes = [];
  const pattern = /^[ \t]*(update|delete\s+from)\s+pg_temp\.tournament_rank_work\b/gim;
  let match = pattern.exec(definition);
  while (match !== null) {
    const start = match.index;
    let end = start;
    let inLiteral = false;
    while (end < definition.length) {
      const char = definition[end];
      if (char === "'") inLiteral = !inLiteral;
      if (char === ';' && !inLiteral) break;
      end += 1;
    }
    writes.push(definition.slice(start, end + 1));
    pattern.lastIndex = end;
    match = pattern.exec(definition);
  }
  return writes;
}

async function withRollback(client, run) {
  await client.query('begin');
  try {
    return await run();
  } finally {
    await client.query('rollback').catch(() => {});
  }
}

/**
 * Deja el torneo canónico en condiciones de recalcular, dentro de la transacción
 * que después se descarta: el dataset QA no trae reglas de puntuación propias y
 * el recálculo las exige. Termina dejando la sesión como la deja la aplicación,
 * con el rol `authenticated` y las claims del propietario.
 */
async function prepareScenario(client, ownerId) {
  await client.query('set local role service_role');
  await client.query(
    `insert into public.tournament_scoring_rules (organization_id, tournament_id, points_win, points_draw, points_loss)
     values ($1, $2, 3, 1, 0)
     on conflict do nothing`,
    [ORG, TOURNAMENT],
  );
  // Los cuatro criterios de desempate, para que el ranking recorra todas sus
  // ramas: `head_to_head` es la que más escribe la tabla temporal.
  await client.query(
    `insert into public.tournament_tiebreak_rules (organization_id, tournament_id, criterion, sort_order)
     select $1, $2, criterion, sort_order
       from (values ('goal_difference', 1), ('goals_for', 2), ('head_to_head', 3), ('fair_play', 4))
         as seed(criterion, sort_order)
     on conflict do nothing`,
    [ORG, TOURNAMENT],
  );
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: ownerId, role: 'authenticated' }),
  ]);
  await client.query('set local role authenticated');
}

async function main() {
  const admin = new pg.Client({ connectionString: ADMIN_CONNECTION });
  const postgrest = new pg.Client({ connectionString: POSTGREST_CONNECTION });
  try {
    await admin.connect();

    const { rows: ownerRows } = await admin.query(
      `select user_id
         from public.tournament_organization_members
        where organization_id = $1 and role = 'owner' and status = 'active'`,
      [ORG],
    );
    if (ownerRows.length !== 1) {
      throw new Error(`El fixture QA debe tener exactamente un owner activo; encontrados ${ownerRows.length}.`);
    }
    const ownerId = ownerRows[0].user_id;

    console.log('\nContrato estático de la función de ranking');
    const { rows: definitionRows } = await admin.query(
      `select pg_get_functiondef(p.oid) as definition
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'rank_tournament_standings'`,
    );
    check(definitionRows.length === 1, 'rank_tournament_standings existe en public');
    const writes = temporaryWrites(definitionRows[0]?.definition || '');
    check(writes.length >= 5, `se detectaron las escrituras sobre la tabla temporal (${writes.length})`);
    const unfiltered = writes.filter((statement) => !/\bwhere\b/i.test(statement));
    check(
      unfiltered.length === 0,
      'ninguna escritura sobre pg_temp.tournament_rank_work quedó sin cláusula where',
      unfiltered.map((statement) => statement.split('\n')[0].trim()).join(' | '),
    );

    await postgrest.connect();

    console.log('\nEl entorno de prueba reproduce el de PostgREST');
    await withRollback(postgrest, async () => {
      await postgrest.query('create temporary table safeupdate_probe(id int primary key, v int)');
      await postgrest.query('insert into safeupdate_probe values (1, 1)');
      let code = null;
      await postgrest.query('savepoint probe');
      try {
        await postgrest.query('update safeupdate_probe set v = 2');
      } catch (error) {
        code = error.code;
      }
      await postgrest.query('rollback to savepoint probe');
      check(code === '21000', 'safeupdate está activo: un update sin where es rechazado', String(code));
      let filtered = true;
      try {
        await postgrest.query('update safeupdate_probe set v = 2 where id is not null');
      } catch (error) {
        filtered = false;
      }
      check(filtered, 'el mismo update con `where id is not null` sí se acepta');
    });

    console.log('\nRecálculo completo por la API, con safeupdate activo');
    const runs = [];
    for (const label of ['primera', 'segunda']) {
      await withRollback(postgrest, async () => {
        await prepareScenario(postgrest, ownerId);
        let failure = null;
        let revisionId = null;
        try {
          const { rows } = await postgrest.query(
            'select public.rebuild_tournament_standings($1,$2,$3,$4,null,$5,gen_random_uuid()) as id',
            [ORG, TOURNAMENT, CATEGORY, LEAGUE_PHASE, `Contrato: corrida ${label}.`],
          );
          revisionId = rows[0].id;
        } catch (error) {
          failure = error;
        }
        check(
          failure === null,
          `rebuild_tournament_standings termina bien (corrida ${label})`,
          failure ? `${failure.code} ${failure.message}` : '',
        );
        if (failure) return;

        await postgrest.query('reset role');
        await postgrest.query('set local role service_role');
        const { rows } = await postgrest.query(
          `select participant_id, position, classification_status, tiebreak_trace
             from public.tournament_team_standings
            where revision_id = $1 order by position`,
          [revisionId],
        );

        if (label === 'primera') {
          check(rows.length > 0, `el recálculo produjo una tabla consumible (${rows.length} equipos)`);
          check(
            rows.every((row, index) => row.position === index + 1),
            'con posiciones consecutivas desde 1, listas para mostrar',
            rows.map((row) => row.position).join(','),
          );
          check(
            rows.every((row) => row.classification_status !== null),
            'y con el estado de clasificación resuelto en cada fila',
          );
          check(
            rows.every((row) => row.tiebreak_trace && Object.keys(row.tiebreak_trace).length > 0),
            'cada equipo conserva la traza de los criterios aplicados',
          );
          const criteria = new Set();
          rows.forEach((row) => Object.keys(row.tiebreak_trace || {}).forEach((key) => criteria.add(key)));
          const { rows: rules } = await postgrest.query(
            'select criterion from public.tournament_tiebreak_rules where tournament_id = $1 order by sort_order',
            [TOURNAMENT],
          );
          check(rules.length > 0, `el torneo tiene criterios de desempate configurados (${rules.length})`);
          check(
            rules.every((rule) => (rule.criterion === 'head_to_head'
              ? [...criteria].some((key) => key.startsWith('head_to_head'))
              : criteria.has(rule.criterion))),
            'la traza registra todos los criterios configurados',
            `${rules.map((rule) => rule.criterion).join(',')} vs ${[...criteria].join(',')}`,
          );
          check(criteria.has('deterministicSeed'), 'el desempate final determinista también se aplicó');
        }

        runs.push({
          order: rows.map((row) => row.participant_id).join('>'),
          trace: JSON.stringify(rows.map((row) => row.tiebreak_trace)),
        });
      });
    }

    console.log('\nDeterminismo');
    check(runs.length === 2, 'las dos corridas independientes se completaron');
    check(
      runs.length === 2 && runs[0].order === runs[1].order,
      'dos recálculos independientes producen exactamente el mismo orden',
    );
    check(
      runs.length === 2 && runs[0].trace === runs[1].trace,
      'y exactamente la misma traza de desempates',
    );
  } finally {
    await postgrest.end().catch(() => {});
    await admin.end().catch(() => {});
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
