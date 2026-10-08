// 20261010129000: which surveys are due for the organizer, so any screen of their app can
// finish them (closure, results, awards) when the screen that saved the last answer did not.
// Only the match admin can close a survey (players' apps cannot update partidos), so only
// the admin gets them.
// The window is derived like the app does: stored survey_closes_at, or kickoff (Buenos Aires)
// + 1 h opening + 24 h. Every fixture lives in a rolled-back transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const as = (userId) => `reset role; set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}'; set local role authenticated;`;
const MATCH = 990601;
const list = (userId) => `${as(userId)} select coalesce(string_agg(partido_id || ':' || reason, ',' order by partido_id), 'none')
  from public.list_my_pending_survey_finalizations(20) where partido_id = ${MATCH};`;

// Kickoff `hoursAgo` hours ago (Buenos Aires wall-clock); roster: organizer, jugador1,
// jugador2 (registered) and a guest; `voters` answered the survey.
const onMatch = ({ hoursAgo, voters = [], extra = '' }, statements) => sqlTry(`
  begin;
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
  select ${MATCH}, 'Cierre lab', 'CIERRELAB', (kickoff)::date, to_char(kickoff, 'HH24:MI'), 'Cancha lab', 'F5', 10, 'activo',
    '${qa.ids.organizador}', '${qa.ids.organizador}'
  from (select (now() at time zone 'America/Argentina/Buenos_Aires') - interval '${hoursAgo} hours' as kickoff) slot;
  insert into public.jugadores (id, partido_id, nombre, usuario_id) values
    (990611, ${MATCH}, 'Lucía Organizadora', '${qa.ids.organizador}'),
    (990612, ${MATCH}, 'Martín Gómez', '${qa.ids.jugador1}'),
    (990613, ${MATCH}, 'Sofía Ruiz', '${qa.ids.jugador2}'),
    (990614, ${MATCH}, 'Invitado', null);
  ${voters.map((jugadorId) => `insert into public.post_match_surveys (partido_id, votante_id, se_jugo) values (${MATCH}, ${jugadorId}, true);`).join('\n')}
  ${extra}
  ${statements}
  rollback;`);

const lines = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n').filter(Boolean);
};

test('every registered player answered: the closure is due for the organizer', () => {
  const result = onMatch({ hoursAgo: 3, voters: [990611, 990612, 990613] }, list(qa.ids.organizador));
  assert.deepEqual(lines(result), [`${MATCH}:closure_due`]);
});

test('players (who cannot close it) and accounts outside the match never get it', () => {
  const result = onMatch({ hoursAgo: 3, voters: [990611, 990612, 990613] },
    `${list(qa.ids.jugador1)} ${list(qa.ids.ajeno)}`);
  assert.deepEqual(lines(result), ['none', 'none']);
});

test('answers still missing and the window still open: not due', () => {
  const result = onMatch({ hoursAgo: 3, voters: [990612] }, list(qa.ids.organizador));
  assert.deepEqual(lines(result), ['none']);
});

test('no organizer stored the window: the kickoff deadline (+25 h) makes it due', () => {
  const result = onMatch({ hoursAgo: 26, voters: [990612] }, list(qa.ids.organizador));
  assert.deepEqual(lines(result), [`${MATCH}:closure_due`]);
});

test('a stored survey_closes_at wins over the kickoff estimate', () => {
  const result = onMatch({
    hoursAgo: 26,
    voters: [990612],
    extra: `update public.partidos set survey_opened_at = now() - interval '2 hours', survey_closes_at = now() + interval '1 hour' where id = ${MATCH};`,
  }, list(qa.ids.organizador));
  assert.deepEqual(lines(result), ['none']);
});

test('closed with results but awards still pending: results/awards due; complete: not listed', () => {
  const closed = `update public.partidos set survey_status = 'closed', finished_at = now(), awards_status = 'pending' where id = ${MATCH};
    insert into public.survey_results (partido_id, results_ready) values (${MATCH}, true);`;
  assert.deepEqual(lines(onMatch({ hoursAgo: 4, voters: [990611, 990612, 990613], extra: closed }, list(qa.ids.organizador))),
    [`${MATCH}:results_or_awards_due`]);
  assert.deepEqual(lines(onMatch({
    hoursAgo: 4,
    voters: [990611, 990612, 990613],
    extra: `${closed} update public.partidos set awards_status = 'ready' where id = ${MATCH};`,
  }, list(qa.ids.organizador))), ['none']);
});

test('anon cannot list anything', () => {
  const result = sqlTry(`begin; set local role anon; select count(*) from public.list_my_pending_survey_finalizations(5); rollback;`);
  assert.equal(result.ok, false);
  assert.match(result.error, /permission denied/);
});
