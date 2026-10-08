// Personal data of public.usuarios as seen by an unrelated, brand-new account.
// usuarios_select_authenticated is USING (true): any signed-in account (sign-up is open)
// reads every row. 20261010135000 takes the VALUES out of the shared row instead of
// revoking the columns (installed apps read the profile with select('*')): email,
// telefono, fecha_nacimiento and location_accuracy_m are NULL there, latitud/longitud hold
// a ~1 km approximation, and the real values live in app_private.usuarios_private, read by
// the owner through get_my_profile() and by the server functions that need them.
// Every write here rolls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const ORGANIZER = qa.ids.organizador;

const asRole = (role, userId = null) => `
  ${userId ? `set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}';` : ''}
  set local role ${role};`;

// The organizer gets a phone, a birth date and an exact location (written like any app
// would), then the statements run.
const withPrivateData = (statements) => sqlTry(`
  begin;
  ${asRole('authenticated', ORGANIZER)}
  update public.usuarios set telefono = '+54 9 11 5555-0000', fecha_nacimiento = '1990-05-01',
    latitud = -34.58123, longitud = -58.43456, location_accuracy_m = 12 where id = '${ORGANIZER}';
  reset role;
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

test('installed apps keep reading select(*) of any row, and no row carries private values', () => {
  for (const reader of [ORGANIZER, qa.ids.nuevo]) {
    assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', reader)}
      select count(*) filter (where email is not null or telefono is not null or fecha_nacimiento is not null
        or location_accuracy_m is not null) || '|' || count(*)
      from (select * from public.usuarios) u;`))[0].split('|')[0], '0');
  }
});

for (const column of ['email', 'telefono', 'fecha_nacimiento', 'location_accuracy_m']) {
  test(`an unrelated account reads ${column} of another user as NULL (no error, no value)`, () => {
    assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
      select coalesce(${column}::text, 'null') from public.usuarios where id = '${ORGANIZER}';`)), ['null']);
  });
}

test('the shared row only holds the location rounded to ~1 km', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select latitud || '|' || longitud from public.usuarios where id = '${ORGANIZER}';`)), ['-34.58|-58.43']);
});

test('the public profile stays readable (name, avatar, stats) by any account', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select nombre is not null and partidos_jugados is not null from public.usuarios where id = '${ORGANIZER}';`)), ['t']);
});

test('the owner reads their own private data through get_my_profile()', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
    select concat_ws('|', email, telefono, fecha_nacimiento, latitud, longitud, location_accuracy_m) from public.get_my_profile();`)),
  ['organizador@arma2.lab|+54 9 11 5555-0000|1990-05-01|-34.58123|-58.43456|12']);
});

test('get_my_profile() only ever returns the caller\'s row', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select count(*) || '|' || coalesce(max(telefono), 'null') from public.get_my_profile() where id = '${ORGANIZER}';`)), ['0|null']);
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
  for (const call of ['select count(*) from public.get_my_profile();', "select public.clear_my_profile_fields(array['telefono']);"]) {
    const result = withPrivateData(`${asRole('anon')} ${call}`);
    assert.equal(result.ok, false);
    assert.match(result.error, /permission denied/);
  }
});

test('the private table is not reachable through the API roles', () => {
  for (const role of ['anon', 'authenticated']) {
    const result = withPrivateData(`${asRole(role, role === 'authenticated' ? ORGANIZER : null)}
      select count(*) from app_private.usuarios_private;`);
    assert.equal(result.ok, false, `readable as ${role}: ${result.out}`);
    assert.match(result.error, /permission denied/);
  }
});

test('the owner edits their data: one coordinate changed keeps the other one exact', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
    update public.usuarios set fecha_nacimiento = '1991-01-02', latitud = -34.6 where id = '${ORGANIZER}';
    select concat_ws('|', fecha_nacimiento, latitud, longitud) from public.get_my_profile();`)), ['1991-01-02|-34.6|-58.43456']);
});

test('an old app re-saving the masked form (blank phone, approximate location) changes nothing', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
    update public.usuarios set telefono = '', fecha_nacimiento = null, latitud = -34.58, longitud = -58.43, nombre = 'Lucía O.'
      where id = '${ORGANIZER}';
    select concat_ws('|', nombre, telefono, fecha_nacimiento, latitud, longitud) from public.get_my_profile();`)),
  ['Lucía O.|+54 9 11 5555-0000|1990-05-01|-34.58123|-58.43456']);
});

test('an old app\'s bootstrap upsert (email, nulls) keeps the stored values and masks the row', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
    insert into public.usuarios (id, nombre, email, fecha_nacimiento, latitud, longitud)
    values ('${ORGANIZER}', 'Lucía', 'organizador@arma2.lab', null, null, null)
    on conflict (id) do update set nombre = excluded.nombre, email = excluded.email,
      fecha_nacimiento = excluded.fecha_nacimiento, latitud = excluded.latitud, longitud = excluded.longitud
    returning coalesce(email, 'null') || '|' || coalesce(fecha_nacimiento::text, 'null');
    select concat_ws('|', email, telefono, fecha_nacimiento, latitud, longitud) from public.get_my_profile();`)),
  ['null|null', 'organizador@arma2.lab|+54 9 11 5555-0000|1990-05-01|-34.58123|-58.43456']);
});

test('the owner clears a value explicitly (and only their own)', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
    select public.clear_my_profile_fields(array['telefono', 'ubicacion']);
    select concat_ws('|', coalesce(telefono, 'null'), fecha_nacimiento, coalesce(latitud::text, 'null')) from public.get_my_profile();
    select coalesce(latitud::text, 'null') from public.usuarios where id = '${ORGANIZER}';`)),
  ['null|1990-05-01|null', 'null']);
  const bad = withPrivateData(`${asRole('authenticated', ORGANIZER)} select public.clear_my_profile_fields(array['email']);`);
  assert.equal(bad.ok, false);
});

test('the legacy profiles table never holds a phone (moved to the private table)', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', ORGANIZER)}
    insert into public.profiles (id, nombre, telefono) values ('${ORGANIZER}', 'Lucía', '+54 9 11 7777-0000')
      on conflict (id) do update set telefono = excluded.telefono;
    reset role; ${asRole('authenticated', qa.ids.nuevo)}
    select count(*) from public.profiles where telefono is not null;
    reset role; ${asRole('authenticated', ORGANIZER)}
    select coalesce(telefono, 'null') from public.get_my_profile();`)), ['0', '+54 9 11 7777-0000']);
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

// 20261010139000: who inserted a roster row lives in app_private.jugadores_added_by.
test('who added a roster row is recorded by the server, outside the shared row', () => {
  assert.deepEqual(lines(withPrivateData(`${PHONE_MATCH}
    ${asRole('authenticated', qa.ids.ajeno)}
    insert into public.jugadores (partido_id, nombre, usuario_id) values (990501, 'Ramiro', '${qa.ids.ajeno}');
    reset role; ${asRole('authenticated', ORGANIZER)}
    insert into public.jugadores (partido_id, nombre, usuario_id) values (990501, 'Sofía Ruiz', '${qa.ids.jugador2}');
    reset role;
    select j.nombre || ':' || (a.added_by = j.usuario_id)::text || ':' || (a.added_by = '${ORGANIZER}')::text
    from public.jugadores j join app_private.jugadores_added_by a on a.jugador_id = j.id
    where j.partido_id = 990501 order by j.nombre;`)),
  ['Ramiro:true:false', 'Sofía Ruiz:false:true']);
});

test('no client can write or read who added whom', () => {
  const write = withPrivateData(`${PHONE_MATCH} ${asRole('authenticated', ORGANIZER)}
    insert into public.jugadores (partido_id, nombre, usuario_id, added_by) values (990501, 'Ramiro', '${qa.ids.ajeno}', '${qa.ids.ajeno}');`);
  assert.equal(write.ok, false);
  assert.match(write.error, /column "added_by" .* does not exist/);
  for (const who of [ORGANIZER, qa.ids.ajeno, qa.ids.jugador2]) {
    const read = withPrivateData(`${PHONE_MATCH} ${asRole('authenticated', who)} select count(*) from app_private.jugadores_added_by;`);
    assert.equal(read.ok, false, who);
    assert.match(read.error, /permission denied/);
  }
  const anon = withPrivateData(`${PHONE_MATCH} ${asRole('anon')} select count(*) from app_private.jugadores_added_by;`);
  assert.equal(anon.ok, false);
  assert.match(anon.error, /permission denied/);
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

test('the legacy profiles table keeps working with select(*) and no phone in it', () => {
  assert.deepEqual(lines(withPrivateData(`${asRole('authenticated', qa.ids.nuevo)}
    select count(*) filter (where telefono is not null) from (select * from public.profiles) p;`)), ['0']);
});
