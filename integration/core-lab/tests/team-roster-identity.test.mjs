// Team membership is anchored to a MATCH row of `jugadores` (the user's latest one):
// rpc_accept_team_invitation and the client's ensureRosterCandidateByUserId() both pick
// it, and team_members.jugador_id cascades on delete. Two consequences, reproduced here
// against the Core lab with the real RPCs and RLS (every step rolls back):
//   1. a user who never played a match cannot accept a team invitation
//      (jugadores.partido_id is NOT NULL, also in Production's dump);
//   2. leaving a match deletes that row and, through the cascade, the team membership.
// Fixing it needs a roster identity that is not a match row (backend design + client
// readers that assume partido_id is set), so both cases are recorded as `todo`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const claims = (userId) => `set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}'; set local role authenticated;`;
const TEAM = `(select id from public.teams where name = 'Los Pibes FC')`;

test('a brand-new account can accept a team invitation', { todo: 'needs a roster identity that is not a match row' }, () => {
  const result = sqlTry(`
    begin;
    ${claims(qa.ids.organizador)}
    select public.rpc_send_team_invitation(${TEAM}, '${qa.ids.nuevo}') is not null;
    reset role;
    ${claims(qa.ids.nuevo)}
    select count(*) from public.rpc_accept_team_invitation((select id from public.team_invitations where invited_user_id = '${qa.ids.nuevo}' and status = 'pending'));
    rollback;`);
  assert.equal(result.ok, true, result.error);
});

test('leaving a match keeps the player in their team', { todo: 'needs a roster identity that is not a match row' }, () => {
  const result = sqlTry(`
    begin;
    insert into public.partidos (id, nombre, codigo, fecha, hora, estado, cupo_jugadores, creado_por, admin_id)
    values (990201, 'Partido que Valentina deja', 'TEAMLAB1', current_date + 5, '20:00', 'activo', 10, '${qa.ids.organizador}', '${qa.ids.organizador}');
    insert into public.jugadores (partido_id, nombre, usuario_id) values (990201, 'Valentina Paz', '${qa.ids.jugador4}');
    ${claims(qa.ids.organizador)}
    select public.rpc_send_team_invitation(${TEAM}, '${qa.ids.jugador4}') is not null;
    reset role;
    ${claims(qa.ids.jugador4)}
    select count(*) from public.rpc_accept_team_invitation((select id from public.team_invitations where invited_user_id = '${qa.ids.jugador4}' and status = 'pending'));
    select 'members_before=' || count(*) from public.team_members where team_id = ${TEAM} and user_id = '${qa.ids.jugador4}';
    delete from public.jugadores where partido_id = 990201 and usuario_id = '${qa.ids.jugador4}';
    select 'members_after=' || count(*) from public.team_members where team_id = ${TEAM} and user_id = '${qa.ids.jugador4}';
    rollback;`);
  assert.equal(result.ok, true, result.error);
  assert.match(result.out, /members_before=1/);
  assert.match(result.out, /members_after=1/);
});
