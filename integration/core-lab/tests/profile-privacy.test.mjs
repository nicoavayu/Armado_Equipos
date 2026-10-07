// Personal data of public.usuarios as seen by an unrelated, brand-new account.
// usuarios_select_authenticated is USING (true) with every column granted: any signed-in
// account (sign-up is open) reads everyone's email, birth date and coordinates.
// The fix ships in two phases (installed apps read their own profile with select('*')):
//   A — 20261010124000: get_my_profile / get_public_profiles / approx location / search;
//   B — docs/database/core-review/phase-b-usuarios-private-columns.sql: the column revoke,
//       applied by hand once no app version still reads select('*').
// Phase B is applied here inside each rolled-back transaction. Every write rolls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repo, root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const phaseB = await readFile(`${repo}docs/database/core-review/phase-b-usuarios-private-columns.sql`, 'utf8');
const ORGANIZER = qa.ids.organizador;

const asRole = (role, userId = null) => `
  ${userId ? `set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}';` : ''}
  set local role ${role};`;

// The organizer gets a phone, a birth date and an exact location, then (optionally phase B
// and) the statements run.
const withPrivateData = (statements, { withPhaseB = true } = {}) => sqlTry(`
  begin;
  update public.usuarios set telefono = '+54 9 11 5555-0000', fecha_nacimiento = '1990-05-01',
    latitud = -34.58123, longitud = -58.43456 where id = '${ORGANIZER}';
  ${withPhaseB ? phaseB : ''}
  ${statements}
  rollback;`);

const lines = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n').filter(Boolean);
};

test('anon cannot read anyone\'s profile row', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('anon')}
    select count(*) from public.usuarios where id = '${ORGANIZER}';`)), ['0']);
});

test('phase A keeps installed apps working: the owner still reads select(*) of their own row', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
    select email from public.usuarios where id = '${ORGANIZER}';`, { withPhaseB: false })), ['organizador@arma2.lab']);
});

test('phase A alone does not close the exposure yet (recorded until phase B is applied)', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select email from public.usuarios where id = '${ORGANIZER}';`, { withPhaseB: false })), ['organizador@arma2.lab']);
});

for (const column of ['email', 'telefono', 'fecha_nacimiento', 'latitud', 'longitud']) {
  test(`phase B: an unrelated account cannot read another user's ${column}`, () => {
    const result = withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
      select ${column} from public.usuarios where id = '${ORGANIZER}';`);
    assert.equal(result.ok, false, `readable: ${result.out}`);
    assert.match(result.error, /permission denied/);
  });
}

test('phase B: the public profile stays readable (name, avatar, stats) by any account', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select nombre is not null and partidos_jugados is not null from public.usuarios where id = '${ORGANIZER}';`)), ['t']);
});

test('the owner reads their own private data through get_my_profile() (both phases)', () => {
  for (const withPhaseB of [false, true]) {
    assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
      select concat_ws('|', email, fecha_nacimiento, latitud, longitud) from public.get_my_profile();`, { withPhaseB })),
    ['organizador@arma2.lab|1990-05-01|-34.58123|-58.43456']);
  }
});

test('others get the public profile without the private keys', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select (p ? 'nombre')::text || (p ? 'email')::text || (p ? 'telefono')::text || (p ? 'fecha_nacimiento')::text || (p ? 'latitud')::text
    from public.get_public_profiles(array['${ORGANIZER}'::uuid]) p;`)), ['truefalsefalsefalsefalse']);
});

test('others only get coordinates rounded to ~1 km', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select latitud || '|' || longitud from public.get_usuarios_approx_location(array['${ORGANIZER}'::uuid]);`)),
  ['-34.58|-58.43']);
});

test('search finds by name or by the exact email, never by part of an email, and never returns it', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select count(*) from public.search_usuarios('organizador@arma2.lab');
    select count(*) from public.search_usuarios('@arma2.lab');
    select count(*) from public.search_usuarios('organizador@');`)), ['1', '0', '0']);
  const columns = lines(sqlTry(`select string_agg(parameter_name, ',' order by ordinal_position) from information_schema.parameters
    where specific_name like 'search_usuarios%' and parameter_mode = 'OUT';`));
  assert.ok(!columns[0].includes('email'), columns[0]);
});

test('anon cannot call the profile RPCs', () => {
  const result = withPrivateData(`${asRole('anon')} select count(*) from public.get_my_profile();`);
  assert.equal(result.ok, false);
  assert.match(result.error, /permission denied/);
});

test('phase B: the owner still edits their own private data', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
    update public.usuarios set fecha_nacimiento = '1991-01-02', latitud = -34.6 where id = '${ORGANIZER}';
    select fecha_nacimiento || '|' || latitud from public.get_my_profile();`)), ['1991-01-02|-34.6']);
});

// 20261010128000: the phone is a contact for a match organizer, and only when the player
// acted toward that match (asked to join, or accepted the invitation). Creating a match,
// adding someone to its roster or inviting them is something the organizer does alone: it
// must not reveal anyone's phone.
const PHONE_MATCH = `
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
  values (990501, 'Contacto lab', 'PHONELAB', current_date + 1, '21:00', 'Cancha lab', 'F5', 10, 'activo', '${ORGANIZER}', '${ORGANIZER}');
  update public.usuarios set telefono = '+54 9 11 4444-1111' where id = '${qa.ids.jugador1}';
  update public.usuarios set telefono = '+54 9 11 4444-2222' where id = '${qa.ids.ajeno}';`;
const phoneOf = (userId) => `select coalesce(public.get_match_contact_phone(990501, '${userId}'), 'null');`;
const invite = (userId, status) => `insert into public.notifications (user_id, partido_id, type, title, message, data)
  values ('${userId}', 990501, 'match_invite', 'Invitación', 'Te invitaron', jsonb_build_object('match_id', '990501', 'status', '${status}'));`;
const deniedFor = (statements) => {
  const result = withPrivateData(statements);
  assert.equal(result.ok, false, `phone readable: ${result.out}`);
  assert.match(result.error, /not_authorized/);
};

test('the owner always reads their own phone', () => {
  assert.deepEqual(lines(withPrivateData(`${PHONE_MATCH}
    ${asRole('authenticated', qa.ids.jugador1)} ${phoneOf(qa.ids.jugador1)}`)), ['+54 9 11 4444-1111']);
});

test('the organizer reads it when the player asked to join (pending or approved)', () => {
  for (const status of ['pending', 'approved']) {
    assert.deepEqual(lines(withPrivateData(`${PHONE_MATCH}
      insert into public.match_join_requests (match_id, user_id, status) values (990501, '${qa.ids.ajeno}', '${status}');
      ${asRole('authenticated', ORGANIZER)} ${phoneOf(qa.ids.ajeno)}`)), ['+54 9 11 4444-2222']);
  }
});

test('the organizer reads it when the player accepted the invitation', () => {
  assert.deepEqual(lines(withPrivateData(`${PHONE_MATCH} ${invite(qa.ids.jugador1, 'accepted')}
    ${asRole('authenticated', ORGANIZER)} ${phoneOf(qa.ids.jugador1)}`)), ['+54 9 11 4444-1111']);
});

test('abuse: a match of my own + a pending invitation I sent does not reveal the phone', () => {
  deniedFor(`${PHONE_MATCH} ${asRole('authenticated', ORGANIZER)}
    select public.send_match_invite('${qa.ids.ajeno}', 990501, 'Invitación', 'Vení', 'direct');
    ${phoneOf(qa.ids.ajeno)}`);
});

test('the organizer reads it when the player joined the match themselves (their own roster row)', () => {
  assert.deepEqual(lines(withPrivateData(`${PHONE_MATCH}
    ${asRole('authenticated', qa.ids.ajeno)}
    insert into public.jugadores (partido_id, nombre, usuario_id) values (990501, 'Ramiro', '${qa.ids.ajeno}');
    reset role; ${asRole('authenticated', ORGANIZER)} ${phoneOf(qa.ids.ajeno)}`)), ['+54 9 11 4444-2222']);
});

test('added_by is set by the server, never by the client, and cannot be rewritten', () => {
  assert.deepEqual(lines(withPrivateData(`${PHONE_MATCH} ${asRole('authenticated', ORGANIZER)}
    insert into public.jugadores (partido_id, nombre, usuario_id, added_by) values (990501, 'Ramiro', '${qa.ids.ajeno}', '${qa.ids.ajeno}');
    update public.jugadores set added_by = '${qa.ids.ajeno}' where partido_id = 990501 and usuario_id = '${qa.ids.ajeno}';
    select (added_by = '${ORGANIZER}')::text from public.jugadores where partido_id = 990501 and usuario_id = '${qa.ids.ajeno}';`)),
  ['true']);
});

test('abuse: re-pointing someone else\'s join request to the target account is rejected', () => {
  const result = withPrivateData(`${PHONE_MATCH}
    insert into public.match_join_requests (match_id, user_id, status) values (990501, '${qa.ids.jugador3}', 'pending');
    ${asRole('authenticated', ORGANIZER)}
    update public.match_join_requests set user_id = '${qa.ids.ajeno}', status = 'approved'
    where match_id = 990501 and user_id = '${qa.ids.jugador3}';
    ${phoneOf(qa.ids.ajeno)}`);
  assert.equal(result.ok, false, `rewrite accepted: ${result.out}`);
  assert.match(result.error, /cannot change|not_authorized/);
});

test('abuse: adding the account to my roster myself does not reveal the phone', () => {
  deniedFor(`${PHONE_MATCH} ${asRole('authenticated', ORGANIZER)}
    insert into public.jugadores (partido_id, nombre, usuario_id) values (990501, 'Ramiro', '${qa.ids.ajeno}');
    ${phoneOf(qa.ids.ajeno)}`);
});

test('a rejected or cancelled request, or a declined invitation, does not count', () => {
  deniedFor(`${PHONE_MATCH}
    insert into public.match_join_requests (match_id, user_id, status) values (990501, '${qa.ids.ajeno}', 'rejected');
    ${invite(qa.ids.ajeno, 'declined')}
    ${asRole('authenticated', ORGANIZER)} ${phoneOf(qa.ids.ajeno)}`);
});

test('another player of the same match never reads a teammate\'s phone', () => {
  deniedFor(`${PHONE_MATCH}
    insert into public.match_join_requests (match_id, user_id, status) values (990501, '${qa.ids.jugador1}', 'approved');
    insert into public.jugadores (partido_id, nombre, usuario_id) values (990501, 'Sofía Ruiz', '${qa.ids.jugador2}');
    ${asRole('authenticated', qa.ids.jugador2)} ${phoneOf(qa.ids.jugador1)}`);
});

test('an organizer of another match cannot use a request made to a different match', () => {
  deniedFor(`${PHONE_MATCH}
    insert into public.match_join_requests (match_id, user_id, status) values (990501, '${qa.ids.ajeno}', 'pending');
    insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
    values (990502, 'Otro lab', 'OTROLAB', current_date + 1, '21:00', 'Cancha lab', 'F5', 10, 'activo', '${qa.ids.jugador3}', '${qa.ids.jugador3}');
    ${asRole('authenticated', qa.ids.jugador3)}
    select coalesce(public.get_match_contact_phone(990502, '${qa.ids.ajeno}'), 'null');`);
});

test('phase B: the legacy profiles table no longer exposes telefono', () => {
  const result = withPrivateData(`${asRole('authenticated', qa.ids.nuevo)} select telefono from public.profiles limit 1;`);
  assert.equal(result.ok, false);
  assert.match(result.error, /permission denied/);
});
