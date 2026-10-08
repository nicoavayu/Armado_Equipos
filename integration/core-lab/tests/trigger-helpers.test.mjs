// 20261010120000: invoker triggers on usuarios/challenges call pure helpers that the
// canonical EXECUTE allowlist had closed to `authenticated`. Runs against the Core lab
// (node integration/core-lab/lab.mjs up && seed). Every statement rolls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const organizer = qa.ids.organizador;
const newcomer = qa.ids.nuevo;

const asUser = (userId, body, { revokeHelpers = false } = {}) => sqlTry(`
  begin;
  ${revokeHelpers ? `revoke execute on function public.normalize_posicion_token(text) from authenticated;
  revoke execute on function public.resolve_challenge_squad_limits(smallint) from authenticated;` : ''}
  set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}';
  set local role authenticated;
  ${body}
  rollback;`);

const updateOwnProfile = (userId) => `update public.usuarios set bio = 'hola', posiciones = array['DEF'] where id = '${userId}' returning posicion;`;
const createChallenge = (userId) => `
  insert into public.challenges (challenger_team_id, created_by_user_id, mode, format, status)
  select id, '${userId}', mode, format, 'open' from public.teams where owner_user_id = '${userId}' limit 1
  returning max_starters_per_team, max_substitutes_per_team;`;

test('without the helper grants, a user cannot save their own profile (the defect)', () => {
  const result = asUser(organizer, updateOwnProfile(organizer), { revokeHelpers: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /permission denied for function normalize_posicion_token/);
});

test('a user saves their own profile; positions are normalized by the trigger', () => {
  for (const userId of [organizer, newcomer]) {
    const result = asUser(userId, updateOwnProfile(userId));
    assert.equal(result.ok, true, result.error);
    assert.equal(result.out.trim(), 'DEF');
  }
});

test('the grant does not let a user write someone else\'s profile', () => {
  const result = asUser(newcomer, `update public.usuarios set bio = 'x' where id = '${organizer}' returning id;`);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.out.trim(), '', 'RLS must still filter the foreign row');
});

test('without the helper grants, a team owner cannot create a challenge (the defect)', () => {
  const result = asUser(organizer, createChallenge(organizer), { revokeHelpers: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /permission denied for function resolve_challenge_squad_limits/);
});

test('a team owner creates a challenge; squad limits come from the format', () => {
  const result = asUser(organizer, createChallenge(organizer));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.out.trim(), '5|3');
});

test('anon still cannot execute the helpers', () => {
  const result = sqlTry(`begin; set local role anon; select public.normalize_posicion_token('DEF'); rollback;`);
  assert.equal(result.ok, false);
  assert.match(result.error, /permission denied/);
});
