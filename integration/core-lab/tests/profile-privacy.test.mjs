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

for (const column of ['email', 'fecha_nacimiento', 'latitud', 'longitud']) {
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
    select (p ? 'nombre')::text || (p ? 'email')::text || (p ? 'fecha_nacimiento')::text || (p ? 'latitud')::text
    from public.get_public_profiles(array['${ORGANIZER}'::uuid]) p;`)), ['truefalsefalsefalse']);
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
