// 20261010130000: evidence for privacy phase B. Clients report their build; operators read
// app_private.privacy_phase_b_readiness(). Every write rolls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const as = (userId) => `reset role; set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}'; set local role authenticated;`;
const lines = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n').filter(Boolean);
};

test('a signed-in client reports its build; one row per account and platform', () => {
  assert.deepEqual(lines(sqlTry(`begin;
    ${as(qa.ids.jugador1)}
    select public.report_client_build('android', '1.1.22', 43);
    select public.report_client_build('android', '1.1.23', 45);
    select public.report_client_build('web');
    select public.report_client_build('windows-phone', 'x', 1);
    reset role;
    select platform || ':' || coalesce(app_version, '-') || ':' || coalesce(app_build::text, '-')
    from app_private.client_build_reports where user_id = '${qa.ids.jugador1}' order by platform;
    rollback;`)), ['android:1.1.23:45', 'web:-:-']);
});

test('nobody reads the reports through the API, and anon cannot report', () => {
  const read = sqlTry(`begin; ${as(qa.ids.jugador1)} select count(*) from app_private.client_build_reports; rollback;`);
  assert.equal(read.ok, false);
  assert.match(read.error, /permission denied/);
  const anon = sqlTry(`begin; set local role anon; select public.report_client_build('web'); rollback;`);
  assert.equal(anon.ok, false);
  assert.match(anon.error, /permission denied/);
  const readiness = sqlTry(`begin; ${as(qa.ids.jugador1)} select count(*) from app_private.privacy_phase_b_readiness(45, 42, 30); rollback;`);
  assert.equal(readiness.ok, false);
});

test('readiness: below-minimum builds and active accounts without any report are counted', () => {
  const rows = lines(sqlTry(`begin;
    insert into app_private.client_build_reports (user_id, platform, app_version, app_build) values
      ('${qa.ids.jugador1}', 'android', '1.1.22', 43),
      ('${qa.ids.jugador2}', 'ios', '1.1.23', 42),
      ('${qa.ids.jugador3}', 'web', null, null);
    insert into auth.sessions (id, user_id, created_at, updated_at)
    select gen_random_uuid(), id, now(), now() from auth.users where id in ('${qa.ids.jugador1}', '${qa.ids.jugador2}', '${qa.ids.jugador3}', '${qa.ids.jugador4}');
    select metric || '=' || accounts from app_private.privacy_phase_b_readiness(45, 42, 30)
    where metric in ('native_on_minimum_or_newer', 'native_below_minimum');
    select (accounts >= 1)::text from app_private.privacy_phase_b_readiness(45, 42, 30) where metric = 'active_without_any_report';
    select count(*) from app_private.privacy_phase_b_readiness(45, 42, 30) r
    where r.metric = 'active_without_any_report' and r.accounts >= (
      select count(distinct s.user_id) from auth.sessions s
      where s.user_id = '${qa.ids.jugador4}');
    rollback;`));
  assert.deepEqual(rows, ['native_on_minimum_or_newer=1', 'native_below_minimum=1', 'true', '1']);
});
