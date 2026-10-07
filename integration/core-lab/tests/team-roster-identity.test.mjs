// 20261010126000: a team is permanent. Before, team membership was anchored to a MATCH row
// of `jugadores` (the user's latest one) and team_members.jugador_id cascades on delete:
//   1. a user who never played a match could not accept a team invitation
//      (jugadores.partido_id NOT NULL);
//   2. leaving a match deleted that row and, through the cascade, the team membership;
//   3. a team admin could not add a player without an account.
// Now the roster identity is a match-less jugadores row. Reproduced against the Core lab
// with the real RPCs, triggers and RLS; every step rolls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const as = (userId) => `reset role; set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}'; set local role authenticated;`;
const TEAM = `(select id from public.teams where name = 'Los Pibes FC')`;
const invite = (userId) => `${as(qa.ids.organizador)}
  select (public.rpc_send_team_invitation(${TEAM}, '${userId}')).id is not null;`;
const accept = (userId) => `${as(userId)}
  select status from public.rpc_accept_team_invitation((select id from public.team_invitations
    where invited_user_id = '${userId}' and team_id = ${TEAM} order by created_at desc limit 1));`;
const membership = (userId, label) => `reset role;
  select '${label}=' || count(*) from public.team_members where team_id = ${TEAM} and user_id = '${userId}';`;

const lines = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n').filter(Boolean);
};

test('a brand-new account (no match ever) accepts a team invitation, and it sticks', () => {
  assert.deepEqual(lines(sqlTry(`begin;
    ${invite(qa.ids.nuevo)}
    ${accept(qa.ids.nuevo)}
    ${membership(qa.ids.nuevo, 'members')}
    select 'roster_row=' || count(*) from public.jugadores where usuario_id = '${qa.ids.nuevo}' and partido_id is null;
    ${as(qa.ids.nuevo)}
    select 'sees_team=' || count(*) from public.team_members where team_id = ${TEAM} and user_id = '${qa.ids.nuevo}';
    rollback;`)), ['t', 'accepted', 'members=1', 'roster_row=1', 'sees_team=1']);
});

test('leaving a match keeps the player in their team (membership anchored to an old match row)', () => {
  // Valentina's membership points at her match row, as rpc_accept_team_invitation used to do.
  assert.deepEqual(lines(sqlTry(`begin;
    insert into public.partidos (id, nombre, codigo, fecha, hora, estado, cupo_jugadores, creado_por, admin_id)
    values (990401, 'Partido que Valentina deja', 'TEAMLAB1', current_date + 5, '20:00', 'activo', 10, '${qa.ids.organizador}', '${qa.ids.organizador}');
    insert into public.jugadores (id, partido_id, nombre, usuario_id) values (990411, 990401, 'Valentina Paz', '${qa.ids.jugador4}');
    insert into public.team_members (team_id, jugador_id, user_id) values (${TEAM}, 990411, '${qa.ids.jugador4}');
    ${membership(qa.ids.jugador4, 'before')}
    ${as(qa.ids.jugador4)}
    delete from public.jugadores where partido_id = 990401 and usuario_id = '${qa.ids.jugador4}';
    ${membership(qa.ids.jugador4, 'after')}
    select 'on_roster_row=' || count(*) from public.team_members tm join public.jugadores j on j.id = tm.jugador_id
      where tm.team_id = ${TEAM} and tm.user_id = '${qa.ids.jugador4}' and j.partido_id is null;
    rollback;`)), ['before=1', 'after=1', 'on_roster_row=1']);
});

test('the organizer removing a player from a match does not remove them from the team either', () => {
  assert.deepEqual(lines(sqlTry(`begin;
    insert into public.partidos (id, nombre, codigo, fecha, hora, estado, cupo_jugadores, creado_por, admin_id)
    values (990402, 'Partido lab', 'TEAMLAB2', current_date + 5, '20:00', 'activo', 10, '${qa.ids.organizador}', '${qa.ids.organizador}');
    insert into public.jugadores (id, partido_id, nombre, usuario_id) values (990412, 990402, 'Valentina Paz', '${qa.ids.jugador4}');
    insert into public.team_members (team_id, jugador_id, user_id) values (${TEAM}, 990412, '${qa.ids.jugador4}');
    ${as(qa.ids.organizador)}
    delete from public.jugadores where id = 990412;
    ${membership(qa.ids.jugador4, 'after')}
    rollback;`)), ['after=1']);
});

test('accepting twice (double tap, retry) keeps one membership and says it was already answered', () => {
  assert.deepEqual(lines(sqlTry(`begin;
    create function pg_temp.try_accept(p_invitation uuid) returns text language plpgsql as $fn$
    begin perform public.rpc_accept_team_invitation(p_invitation); return 'ok';
    exception when others then return sqlerrm; end $fn$;
    ${invite(qa.ids.nuevo)}
    ${as(qa.ids.nuevo)}
    select pg_temp.try_accept((select id from public.team_invitations where invited_user_id = '${qa.ids.nuevo}' order by created_at desc limit 1));
    select pg_temp.try_accept((select id from public.team_invitations where invited_user_id = '${qa.ids.nuevo}' order by created_at desc limit 1));
    ${membership(qa.ids.nuevo, 'members')}
    rollback;`)), ['t', 'ok', 'La invitacion ya fue respondida', 'members=1']);
});

test('an account already in the team cannot be invited again', () => {
  const result = sqlTry(`begin; ${invite(qa.ids.jugador1)} rollback;`);
  assert.equal(result.ok, false);
  assert.match(result.error, /ya forma parte del equipo/);
});

test('a team admin adds a player without an account; anyone else cannot', () => {
  assert.deepEqual(lines(sqlTry(`begin;
    ${as(qa.ids.organizador)}
    select nombre || ':' || (usuario_id is null) from public.rpc_create_team_local_player(${TEAM}, 'Primo de Lucía');
    rollback;`)), ['Primo de Lucía:true']);
  const denied = sqlTry(`begin; ${as(qa.ids.ajeno)} select * from public.rpc_create_team_local_player(${TEAM}, 'Intruso'); rollback;`);
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Solo el owner/);
});
