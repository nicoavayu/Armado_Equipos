// 20261010123000: the organizer's "Resetear votación" really lets everyone vote again.
// A match with an app vote and a public (link) voter who already confirmed; the organizer
// resets; then the same people vote again. Every fixture lives in a rolled-back transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const CODE = 'RESETLAB';
const as = (userId) => `reset role; set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}'; set local role authenticated;`;
const asAnon = 'reset role; set local "request.jwt.claims" to \'{"role":"anon"}\'; set local role anon;';

const onVotedMatch = (statements) => sqlTry(`
  begin;
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
  values (990002, 'Reset lab', '${CODE}', current_date + 1, '21:00', 'Cancha lab', 'F5', 10, 'votacion',
          '${qa.ids.organizador}', '${qa.ids.organizador}');
  insert into public.jugadores (id, partido_id, nombre, usuario_id) values
    (990201, 990002, 'Invitado Uno', null),
    (990202, 990002, 'Invitado Dos', null),
    (990203, 990002, 'Martín Gómez', '${qa.ids.jugador1}');
  insert into public.notifications (user_id, partido_id, type, title, message, data)
  values ('${qa.ids.jugador1}', 990002, 'call_to_vote', 'A votar', 'Votá', jsonb_build_object('match_id', '990002'));
  insert into public.votos (partido_id, votante_id, votado_id, puntaje)
  values (990002, '${qa.ids.jugador1}', '990201', 7);
  ${asAnon}
  select public.public_submit_player_rating(990002, '${CODE}', 'Invitado Uno', 990203, 9);
  select public.public_mark_voter_completed(990002, '${CODE}', 'Invitado Uno');
  ${statements}
  rollback;`);

const outputs = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n');
};

const counts = `reset role; select (select count(*) from public.votos where partido_id = 990002) || ':' ||
  (select count(*) from public.votos_publicos where partido_id = 990002) || ':' ||
  (select count(*) from public.public_voters where partido_id = 990002);`;

test('before the reset the link voter is locked out (control)', () => {
  assert.deepEqual(outputs(onVotedMatch(`${counts}
    ${asAnon} select public.public_submit_player_rating(990002, '${CODE}', 'Invitado Uno', 990202, 6);`)),
  ['ok', 'ok', '1:1:1', 'already_voted_for_match']);
});

test('the organizer\'s reset clears app votes, link votes and who already voted, and both can vote again', () => {
  assert.deepEqual(outputs(onVotedMatch(`${as(qa.ids.organizador)} select public.reset_votacion(990002);
    ${counts}
    reset role; select count(*) from public.jugadores where partido_id = 990002 and score is not distinct from (select score from public.jugadores where id = 990201);
    ${asAnon} select public.public_submit_player_rating(990002, '${CODE}', 'Invitado Uno', 990202, 6);
    ${as(qa.ids.jugador1)} insert into public.votos (partido_id, votante_id, votado_id, puntaje) values (990002, '${qa.ids.jugador1}', '990201', 8) returning puntaje;`)),
  ['ok', 'ok', '', '0:0:0', '3', 'ok', '8']);
});

test('only the organizer can reset', () => {
  const result = onVotedMatch(`${as(qa.ids.jugador1)} select public.reset_votacion(990002);`);
  assert.equal(result.ok, false);
  assert.match(result.error, /not_authorized/);
});
