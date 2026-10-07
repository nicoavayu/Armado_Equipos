// Personal data of public.usuarios as seen by an unrelated, brand-new account.
// Policy usuarios_select_authenticated is USING (true) with every column granted, so any
// signed-in account (sign-up is open) reads everyone's email, phone, birth date and
// coordinates — while Perfil labels the phone "sólo visible para admins". Closing it needs
// a public profile projection plus client changes (select('*') reads), so the expected
// behavior is recorded as `todo`; the anon check is the part that already holds.
// Every write rolls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));

const readOrganizerAs = (role, userId = null) => sqlTry(`
  begin;
  update public.usuarios set telefono = '+54 9 11 5555-0000', fecha_nacimiento = '1990-05-01',
    latitud = -34.5800, longitud = -58.4300 where id = '${qa.ids.organizador}';
  ${userId ? `set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}';` : ''}
  set local role ${role};
  select concat_ws('|', email, telefono, fecha_nacimiento, latitud, longitud) from public.usuarios where id = '${qa.ids.organizador}';
  rollback;`);

test('anon cannot read anyone\'s profile row', () => {
  const result = readOrganizerAs('anon');
  assert.equal(result.ok, true, result.error);
  assert.equal(result.out.trim(), '');
});

test('an unrelated account cannot read another user\'s email, phone, birth date or coordinates',
  { todo: 'needs a public profile projection (see the Core security report)' }, () => {
    const result = readOrganizerAs('authenticated', qa.ids.nuevo);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.out.trim(), '', `readable today: ${result.out.trim()}`);
  });
