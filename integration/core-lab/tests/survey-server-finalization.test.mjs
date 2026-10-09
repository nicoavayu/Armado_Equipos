// 20261010131000: surveys close, get results, awards and notices from the server job —
// nobody has to open the app. Same rules as the app's finalizeIfComplete; idempotent.
// Every fixture lives in a rolled-back transaction (the real cron cannot see it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const M = 990701;
const ORG = qa.ids.organizador;
const [J1, J2, J3] = [qa.ids.jugador1, qa.ids.jugador2, qa.ids.jugador3];
// Roster rows: organizer 11, jugador1 12, jugador2 13, jugador3 14, guest 15.
const P = { org: 990711, j1: 990712, j2: 990713, j3: 990714, guest: 990715 };

const fixture = (hoursAgo) => `
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
  select ${M}, 'Cierre servidor lab', 'SERVERLAB', (kickoff)::date, to_char(kickoff, 'HH24:MI'), 'Cancha lab', 'F5', 10, 'activo', '${ORG}', '${ORG}'
  from (select (now() at time zone 'America/Argentina/Buenos_Aires') - interval '${hoursAgo} hours' as kickoff) slot;
  insert into public.jugadores (id, partido_id, nombre, usuario_id) values
    (${P.org}, ${M}, 'Lucía Organizadora', '${ORG}'), (${P.j1}, ${M}, 'Martín Gómez', '${J1}'),
    (${P.j2}, ${M}, 'Sofía Ruiz', '${J2}'), (${P.j3}, ${M}, 'Diego Sosa', '${J3}'), (${P.guest}, ${M}, 'Invitado', null);`;
const vote = (voter, { played = true, winner = 'A', mvp = null, gk = null, dirty = [], absent = [], resultado = null } = {}) => `
  insert into public.post_match_surveys (partido_id, votante_id, se_jugo, ganador, resultado, mejor_jugador_eq_a, mejor_jugador_eq_b, jugadores_violentos, jugadores_ausentes)
  values (${M}, ${voter}, ${played}, ${winner ? `'${winner}'` : 'null'}, ${resultado ? `'${resultado}'` : 'null'}, ${mvp ?? 'null'}, ${gk ?? 'null'},
          '{${dirty.join(',')}}', '{${absent.join(',')}}');`;
// Runs the job for this match only (the shared lab may hold other due matches) and fails
// the statement if the match could not be finished.
const run = `do $run$ declare r jsonb; begin
  r := app_private.finalize_survey_backend(${M});
  if r ->> 'outcome' not in ('completed', 'not_ready', 'skipped') then raise exception 'job: %', r; end if;
end $run$;`;
const batch = 'select public.process_survey_finalizations_backend(200) is not null;';
// One line describing everything the pipeline writes for the match.
const state = `select concat_ws('|',
  (select survey_status || ',' || estado || ',' || coalesce(result_status, '-') || ',' || coalesce(winner_team, '-') || ',' || coalesce(awards_status, '-') from public.partidos where id = ${M}),
  (select coalesce(results_ready, false) || ',' || coalesce(resultados_encuesta_listos, false) || ',' || coalesce(snapshot_participantes_listo, false) from public.survey_results where partido_id = ${M}),
  'awards=' || (select coalesce(string_agg(award_type, ',' order by award_type), '-') from public.player_awards where partido_id = ${M}),
  'finished=' || (select count(*) from public.notifications where partido_id = ${M} and type = 'survey_finished'),
  'won=' || (select count(*) from public.notifications where partido_id = ${M} and type = 'award_won'),
  'mvps=' || (select mvps from public.usuarios where id = '${J1}'),
  'gloves=' || (select guantes_dorados from public.usuarios where id = '${J3}'));`;
const baseline = `select (select mvps from public.usuarios where id = '${J1}') || ',' || (select guantes_dorados from public.usuarios where id = '${J3}');`;

const lines = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n').filter(Boolean);
};
const counters = lines(sqlTry(baseline))[0].split(',').map(Number);
const plus = (field, n) => `${field}=${counters[field === 'mvps' ? 0 : 1] + n}`;

const allVoted = [
  vote(P.org, { mvp: P.j1, gk: P.j3, dirty: [P.guest] }),
  vote(P.j1, { mvp: P.j2, gk: P.j3, dirty: [P.guest] }),
  vote(P.j2, { mvp: P.j1, gk: P.j3 }),
  vote(P.j3, { mvp: P.j1, gk: P.j3 }),
].join('\n');

test('every eligible player answered and nobody opened the app: the job closes, scores, awards and notifies', () => {
  const [after] = lines(sqlTry(`begin; ${fixture(3)} ${allVoted} ${run} ${state} rollback;`));
  assert.equal(after, [
    'closed,finalizado,finished,A,ready',
    'true,true,true',
    'awards=best_gk,mvp',
    'finished=4',
    'won=2',
    plus('mvps', 1),
    plus('gloves', 1),
  ].join('|'));
});

test('running the job again changes nothing: no second award, counter or notice', () => {
  const out = lines(sqlTry(`begin; ${fixture(3)} ${allVoted} ${run} ${state} ${run} ${run} ${state} rollback;`));
  assert.equal(out.length, 2);
  assert.equal(out[0], out[1]);
});

test('the guest who got the red card has no award row, and survey_results keeps its ref', () => {
  const out = lines(sqlTry(`begin; ${fixture(3)} ${allVoted} ${run}
    select (awards -> 'red_card' ->> 'player_id') = (select uuid::text from public.jugadores where id = ${P.guest}),
      red_cards = array[(select uuid from public.jugadores where id = ${P.guest})]
    from public.survey_results where partido_id = ${M};
    rollback;`));
  assert.deepEqual(out, ['t|t']);
});

test('answers still missing and the deadline not reached: the survey stays open, nothing is written', () => {
  const [after] = lines(sqlTry(`begin; ${fixture(3)} ${vote(P.j1, { mvp: P.j2 })} ${run} ${state} rollback;`));
  assert.match(after, /^open,activo,pending,-,pending\|/);
  assert.match(after, /awards=-\|finished=0\|won=0/);
});

test('deadline passed with 2 voters: closed, results, notices; awards not eligible (fewer than 3)', () => {
  const [after] = lines(sqlTry(`begin; ${fixture(26)}
    ${vote(P.j1, { mvp: P.j2, gk: P.j3 })} ${vote(P.j2, { mvp: P.j2, gk: P.j3 })} ${run} ${state}
    select coalesce(mvp::text, 'none') || ',' || awards::text from public.survey_results where partido_id = ${M};
    rollback;`));
  assert.match(after, /^closed,finalizado,finished,A,not_eligible\|true,true,true\|awards=-\|finished=4\|won=0/);
});

test('most answers say it was not played: cancelled, no awards', () => {
  const [after] = lines(sqlTry(`begin; ${fixture(3)}
    ${vote(P.org, { played: false, winner: null, mvp: P.j1 })} ${vote(P.j1, { played: false, winner: null })}
    ${vote(P.j2, { played: false, winner: null })} ${vote(P.j3, { mvp: P.j1 })} ${run} ${state} rollback;`));
  assert.match(after, /^closed,cancelado,not_played,-,not_eligible\|true,true,true\|awards=-\|/);
});

test('a match backed by a team challenge keeps its survey disabled: the job skips it', () => {
  // (Creating the team match runs the challenge triggers on the match itself.)
  const out = lines(sqlTry(`begin; ${fixture(3)} ${allVoted}
    insert into public.teams (id, owner_user_id, name, format, is_active) values
      ('00000000-0000-4000-8000-0000009907a1', '${ORG}', 'Lab A', 5, true), ('00000000-0000-4000-8000-0000009907b1', '${J1}', 'Lab B', 5, true);
    insert into public.team_matches (partido_id, origin_type, status, team_a_id, team_b_id, format)
    values (${M}, 'challenge', 'pending', '00000000-0000-4000-8000-0000009907a1', '00000000-0000-4000-8000-0000009907b1', 5);
    select app_private.finalize_survey_backend(${M}) ->> 'reason';
    select (select count(*) from public.player_awards where partido_id = ${M}) || ',' ||
      (select count(*) from public.notifications where partido_id = ${M} and type in ('survey_finished', 'award_won'));
    rollback;`));
  assert.deepEqual(out, ['surveys_disabled_for_challenges', '0,0']);
});

test('the app closed it but died before awards and snapshot: the job completes the rest, once', () => {
  const [after] = lines(sqlTry(`begin; ${fixture(3)} ${allVoted}
    update public.partidos set survey_status = 'closed', estado = 'finalizado', result_status = 'finished', winner_team = 'A', finished_at = now() where id = ${M};
    insert into public.survey_results (partido_id, results_ready, result_status, winner_team) values (${M}, true, 'finished', 'A');
    ${run} ${run} ${state} rollback;`));
  assert.equal(after, ['closed,finalizado,finished,A,ready', 'true,true,true', 'awards=best_gk,mvp', 'finished=4', 'won=2',
    plus('mvps', 1), plus('gloves', 1)].join('|'));
});

test('MVP tie: the player of the winning team wins it, as in the app', () => {
  const out = lines(sqlTry(`begin; ${fixture(3)}
    update public.partidos set survey_team_a = jsonb_build_array('${J2}', '${ORG}'), survey_team_b = jsonb_build_array('${J1}', '${J3}') where id = ${M};
    ${vote(P.org, { mvp: P.j1 })} ${vote(P.j1, { mvp: P.j2 })} ${vote(P.j2, { mvp: P.j1 })} ${vote(P.j3, { mvp: P.j2 })}
    select (app_private.compute_survey_results(${M}) ->> 'mvp') = '${J2}';
    rollback;`));
  assert.deepEqual(out, ['t']);
});

test('accounts cannot run the job or its pieces', () => {
  for (const role of ['anon', 'authenticated']) {
    for (const call of [batch, `select app_private.finalize_survey_backend(${M});`, `select app_private.compute_survey_results(${M});`]) {
      const result = sqlTry(`begin; set local role ${role}; ${call} rollback;`);
      assert.equal(result.ok, false, `${role} ran ${call}`);
      assert.match(result.error, /permission denied/);
    }
  }
});

test('the job is scheduled every 5 minutes', () => {
  assert.deepEqual(lines(sqlTry(`select schedule || ' ' || command from cron.job where jobname = 'survey_finalization_backend_scheduler';`)),
    ['*/5 * * * * select public.process_survey_finalizations_backend(25);']);
});
