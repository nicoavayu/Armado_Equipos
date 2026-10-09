// 20261010121000: public voting accepts only the voters the voting screen offers (guest
// starters of the match). Self-rating keeps its previous behavior (the screen leaves the
// voter out; the RPCs accept it) — a product decision, not part of this fix. Runs against the Core lab as `anon`,
// exactly like the RPCs PostgREST exposes; every fixture lives in a rolled-back transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlTry } from '../lab.mjs';

const CODE = 'VOTELAB1';

// A match with public voting open (call_to_vote sent) and room for two starters: two
// guest starters, then a guest and a registered player that the substitute trigger
// places on the bench; then the given statements run as anon.
const asAnonOnOpenVoting = (statements) => sqlTry(`
  begin;
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
  select 990001, 'Votación lab', '${CODE}', current_date + 1, '21:00', 'Cancha lab', 'F5', 2, 'activo', id, id
  from auth.users where email = 'organizador@arma2.lab';
  insert into public.jugadores (id, partido_id, nombre, usuario_id, is_substitute) values
    (990101, 990001, 'Invitado Uno', null, false),
    (990102, 990001, 'Invitado Dos', null, false),
    (990103, 990001, 'Suplente Tres', null, false),
    (990104, 990001, 'Martín Gómez', (select id from auth.users where email = 'jugador1@arma2.lab'), false);
  insert into public.notifications (user_id, partido_id, type, title, message, data)
  select creado_por, 990001, 'call_to_vote', 'A votar', 'Votá', jsonb_build_object('match_id', 990001) from public.partidos where id = 990001;
  set local role anon;
  ${statements}
  rollback;`);

const rate = (voter, playerId, score = 8) =>
  `select public.public_submit_player_rating(990001, '${CODE}', '${voter}', ${playerId}, ${score});`;
const unknown = (voter, playerId) =>
  `select public.public_submit_no_lo_conozco(990001, '${CODE}', '${voter}', ${playerId});`;
const complete = (voter) =>
  `select public.public_mark_voter_completed(990001, '${CODE}', '${voter}');`;

const outputs = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n');
};

test('a guest starter of the match votes as before', () => {
  assert.deepEqual(outputs(asAnonOnOpenVoting(`${rate('Invitado Uno', 990102)} ${unknown('Invitado Uno', 990104)} ${complete('Invitado Uno')}`)),
    ['ok', 'ok', 'ok']);
});

test('the guest name is matched like the screen sends it (case and spacing)', () => {
  assert.deepEqual(outputs(asAnonOnOpenVoting(rate('  invitado   uno ', 990102))), ['ok']);
});

test('a name that is not on the roster cannot vote (no fictitious voters)', () => {
  assert.deepEqual(outputs(asAnonOnOpenVoting(`${rate('Votante Falso 1', 990101)} ${rate('Votante Falso 2', 990101)}
    ${unknown('Votante Falso 3', 990101)} ${complete('Votante Falso 4')}
    reset role; select count(*) from public.public_voters where partido_id = 990001;
    select count(*) from public.votos_publicos where partido_id = 990001;`)),
  ['invalid', 'invalid', 'invalid', 'invalid', '0', '0']);
});

test('a substitute or a player with an account is not a public voter', () => {
  assert.deepEqual(outputs(asAnonOnOpenVoting(`reset role; select string_agg(id || ':' || is_substitute, ',' order by id) from public.jugadores where partido_id = 990001;`)),
    ['990101:false,990102:false,990103:true,990104:true']);
  assert.deepEqual(outputs(asAnonOnOpenVoting(`${rate('Suplente Tres', 990101)} ${rate('Martín Gómez', 990101)}`)),
    ['invalid', 'invalid']);
});

test('self-rating keeps its previous server behavior (only the screen leaves the voter out)', () => {
  assert.deepEqual(outputs(asAnonOnOpenVoting(`${rate('Invitado Uno', 990101)} ${unknown('Invitado Dos', 990102)}`)),
    ['ok', 'ok']);
});

test('a double click or a retry never stores a second vote for the same player', () => {
  assert.deepEqual(outputs(asAnonOnOpenVoting(`${rate('Invitado Uno', 990102)} ${rate('Invitado Uno', 990102, 3)}
    ${unknown('Invitado Uno', 990102)} ${complete('Invitado Uno')} ${rate('Invitado Uno', 990104)}
    reset role; select count(*) || ':' || max(puntaje) from public.votos_publicos where partido_id = 990001;`)),
  ['ok', 'already_voted_for_player', 'already_voted_for_player', 'ok', 'already_voted_for_match', '1:8']);
});

test('the code still gates everything', () => {
  const result = asAnonOnOpenVoting(`select public.public_submit_player_rating(990001, 'WRONG', 'Invitado Uno', 990102, 8);`);
  assert.deepEqual(outputs(result), ['invalid']);
});
