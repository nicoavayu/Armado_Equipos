// 20261010140000: accounts not involved in a published match (and anon) get no usuario_id
// and no score of its roster from anywhere; the organizer and the roster keep everything.
// What an installed app can DO is enforced in SQL whatever it shows: no over-cupo (also
// under concurrency), no duplicate or self-approved request, no self-insert without an
// invitation / approved request / valid invite link, no self-promotion. Link voting by
// name keeps working. Fixtures are committed with their own ids and removed at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { API, config, root, sql, sqlAsync, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const c = await config();
const ORG = qa.ids.organizador;
const OPEN = 992001; // published, cupo 2: organizer + jugador1 starters, then substitutes
const SECOND = 992002; // published, one slot left, two invited accounts
const VOTE = 992003; // link voting open
const LINK = 992004; // published, room, guest invite link
const ALL = [OPEN, SECOND, VOTE, LINK];

const cleanup = `
  delete from app_private.match_link_access where partido_id in (${ALL});
  delete from public.guest_match_invites where partido_id in (${ALL});
  delete from public.votos_publicos where partido_id in (${ALL});
  delete from public.public_voters where partido_id in (${ALL});
  delete from public.notifications where partido_id in (${ALL});
  delete from public.match_join_requests where match_id in (${ALL});
  delete from public.jugadores where partido_id in (${ALL});
  delete from public.partidos where id in (${ALL});`;

const match = (id, name, code, cupo) => `
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, falta_jugadores, creado_por, admin_id, tipo_partido)
  values (${id}, '${name}', '${code}', current_date + 2, '21:00', 'Cancha lab', 'F5', ${cupo}, 'activo', true, '${ORG}', '${ORG}', 'Masculino');`;

test.before(() => {
  sqlTry(cleanup);
  sql(`
    ${match(OPEN, 'Publicado lab', 'PUBLAB01', 2)}
    ${match(SECOND, 'Segundo lab', 'PUBLAB02', 1)}
    ${match(LINK, 'Link lab', 'PUBLAB04', 10)}
    insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
    values (${VOTE}, 'Votación pub lab', 'VOTEPUB1', current_date + 1, '21:00', 'Cancha lab', 'F5', 3, 'activo', '${ORG}', '${ORG}');
    insert into public.jugadores (partido_id, nombre, usuario_id) values
      (${OPEN}, 'Lucía', '${ORG}'), (${OPEN}, 'Martín', '${qa.ids.jugador1}'),
      (${OPEN}, 'Suplente A', null), (${OPEN}, 'Suplente B', null), (${OPEN}, 'Suplente C', null),
      (${SECOND}, 'Lucía', '${ORG}'), (${SECOND}, 'Suplente 1', null), (${SECOND}, 'Suplente 2', null), (${SECOND}, 'Suplente 3', null),
      (${VOTE}, 'Invitado Uno', null), (${VOTE}, 'Invitado Dos', null), (${VOTE}, 'Martín', '${qa.ids.jugador1}'),
      (${LINK}, 'Lucía', '${ORG}');
    insert into public.notifications (user_id, partido_id, type, title, message, data) values
      ('${ORG}', ${VOTE}, 'call_to_vote', 'A votar', 'Votá', jsonb_build_object('match_id', ${VOTE})),
      ('${qa.ids.jugador8}', ${SECOND}, 'match_invite', 'Invitación', 'Vení', jsonb_build_object('match_id', ${SECOND}, 'status', 'pending')),
      ('${qa.ids.nuevo}', ${SECOND}, 'match_invite', 'Invitación', 'Vení', jsonb_build_object('match_id', ${SECOND}, 'status', 'pending'));
    insert into public.guest_match_invites (partido_id, token, created_by, expires_at, max_uses, uses_count)
    values (${LINK}, 'link-lab-token-1', '${ORG}', now() + interval '1 day', 20, 0);`);
});
test.after(() => { sqlTry(cleanup); });

const signIn = async (key) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: c.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${key}@arma2.lab`, password: qa.passwords[key] }),
  });
  if (!r.ok) throw new Error(`sign-in ${key}: ${r.status}`);
  return (await r.json()).access_token;
};
const client = (token) => async (method, path, body, headers = {}) => {
  const h = { apikey: c.anonKey, 'content-type': 'application/json', prefer: 'return=representation', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, range: r.headers.get('content-range') };
};
const as = {
  organizer: client(await signIn('organizador')),
  member: client(await signIn('jugador1')),
  stranger: client(await signIn('jugador9')),
  requesterA: client(await signIn('jugador6')),
  requesterB: client(await signIn('jugador7')),
  invitedA: client(await signIn('jugador8')),
  invitedB: client(await signIn('nuevo')),
  linkUser: client(await signIn('ajeno')),
  anon: client(null),
};
const entry = (row) => [row.nombre, 'usuario_id' in row, 'score' in row, row.has_account];

// ---------- reads ----------
test('outsider: no roster from the table, realtime source or partidos_jugadores; entries elsewhere carry no usuario_id/score', async () => {
  assert.deepEqual((await as.stranger('GET', `jugadores?select=*&partido_id=eq.${OPEN}`)).body, []);
  assert.deepEqual((await as.stranger('GET', `partidos_jugadores?select=*&partido_id=eq.${OPEN}`)).body, []);
  for (const view of ['partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2']) {
    const r = await as.stranger('GET', `${view}?select=id,jugadores,jugadores_count&id=eq.${OPEN}`);
    assert.equal(r.status, 200, view);
    assert.equal(r.body[0].jugadores_count, 5, view);
    assert.ok(r.body[0].jugadores.every((p) => !('usuario_id' in p) && !('score' in p) && typeof p.has_account === 'boolean'), view);
  }
  const rpc = await as.stranger('POST', 'rpc/get_open_matches_for_quiero_jugar_v2', { p_user_lat: null, p_user_lng: null, p_max_distance_km: 200 });
  const listed = rpc.body.find((row) => row.id === OPEN);
  assert.ok(listed, 'listed in Quiero jugar');
  assert.ok(listed.jugadores.every((p) => !('usuario_id' in p) && !('score' in p)));
  const roster = await as.stranger('POST', 'rpc/get_public_match_roster', { p_partido_id: OPEN });
  assert.deepEqual(roster.body.map(entry), [
    ['Lucía', false, false, true], ['Martín', false, false, true],
    ['Suplente A', false, false, false], ['Suplente B', false, false, false], ['Suplente C', false, false, false]]);
  const byCode = await as.stranger('POST', 'rpc/public_get_match_by_code', { p_codigo: 'PUBLAB01', p_partido_id: OPEN });
  assert.ok(byCode.body.jugadores.every((p) => !('usuario_id' in p) && !('score' in p)));
});

test('member and organizer keep usuario_id and score everywhere', async () => {
  for (const who of ['member', 'organizer']) {
    const table = await as[who]('GET', `jugadores?select=usuario_id,score&partido_id=eq.${OPEN}`);
    assert.equal(table.body.length, 5, who);
    const view = await as[who]('GET', `partidos_abiertos_operativos_v2?select=jugadores&id=eq.${OPEN}`);
    assert.ok(view.body[0].jugadores.every((p) => 'usuario_id' in p && 'score' in p), who);
    const roster = await as[who]('POST', 'rpc/get_public_match_roster', { p_partido_id: OPEN });
    assert.ok(roster.body.every((p) => 'usuario_id' in p && 'score' in p), who);
    const byCode = await as[who]('POST', 'rpc/public_get_match_by_code', { p_codigo: 'PUBLAB01', p_partido_id: OPEN });
    assert.ok(byCode.body.jugadores.every((p) => 'usuario_id' in p), who);
  }
  const mine = await as.member('POST', 'rpc/get_public_match_roster', { p_partido_id: OPEN });
  assert.equal(mine.body.find((p) => p.nombre === 'Martín').is_me, true);
});

test('anon: nothing from table or views; the code gives the match with entries without usuario_id/score; no roster RPC', async () => {
  assert.deepEqual((await as.anon('GET', `jugadores?select=*&partido_id=eq.${OPEN}`)).body, []);
  assert.deepEqual((await as.anon('GET', `partidos_abiertos_operativos?select=id&id=eq.${OPEN}`)).body, []);
  const byCode = await as.anon('POST', 'rpc/public_get_match_by_code', { p_codigo: 'PUBLAB01', p_partido_id: OPEN });
  assert.equal(byCode.status, 200);
  assert.equal(byCode.body.jugadores.length, 5);
  assert.ok(byCode.body.jugadores.every((p) => !('usuario_id' in p) && !('score' in p)));
  const roster = await as.anon('POST', 'rpc/get_public_match_roster', { p_partido_id: OPEN });
  assert.ok(roster.status === 401 || roster.status === 403 || roster.status === 404, String(roster.status));
});

// ---------- 1.1.21 replay: Quiero jugar → open match → pedir sumarse ----------
test('1.1.21 replay as an outsider: sees the match with an empty roster, requests to join once, cannot shortcut', async () => {
  const me = qa.ids.jugador6;
  const list = await as.requesterA('POST', 'rpc/get_open_matches_for_quiero_jugar_v2', { p_user_lat: null, p_user_lng: null, p_max_distance_km: 200 });
  assert.ok(list.body.some((row) => row.id === OPEN));
  const view = await as.requesterA('GET', `partidos_view?select=*&id=eq.${OPEN}`);
  assert.equal(view.body.length, 1);
  assert.equal(view.body[0].codigo, null);
  const roster = await as.requesterA('GET', `jugadores?select=*&partido_id=eq.${OPEN}`, null, { prefer: 'count=exact' });
  assert.deepEqual([roster.status, roster.body, roster.range], [200, [], '*/0']);
  const positions = await as.requesterA('GET', `usuarios?select=posiciones&id=eq.${me}`);
  assert.equal(positions.status, 200);
  // Pedir sumarse (handleSolicitarUnirme)
  const request = await as.requesterA('POST', 'match_join_requests?select=id', { match_id: OPEN, user_id: me, status: 'pending', role: 'player' });
  assert.equal(request.status, 201, JSON.stringify(request.body));
  // Second tap / retry: 23505, which 1.1.21 turns into reopen_own_match_join_request.
  const again = await as.requesterA('POST', 'match_join_requests?select=id', { match_id: OPEN, user_id: me, status: 'pending', role: 'player' });
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(again.body.code, '23505');
  const reopen = await as.requesterA('POST', 'rpc/reopen_own_match_join_request', { p_match_id: OPEN, p_role: 'player' });
  assert.equal(reopen.body.status, 'pending');
  assert.equal(Number(sql(`select count(*) from public.match_join_requests where match_id = ${OPEN} and user_id = '${me}'`).trim()), 1);
  // Shortcuts a modified client could try:
  const selfApproved = await as.requesterB('POST', 'match_join_requests?select=id', { match_id: OPEN, user_id: qa.ids.jugador7, status: 'approved', role: 'player' });
  assert.equal(selfApproved.status, 403, JSON.stringify(selfApproved.body));
  const selfInsert = await as.requesterA('POST', 'jugadores?select=id', { partido_id: OPEN, usuario_id: me, nombre: 'Colado' });
  assert.equal(selfInsert.status, 403, JSON.stringify(selfInsert.body));
  sql(`update public.partidos set deleted_at = now() where id = ${LINK};`);
  const deleted = await as.requesterB('POST', 'match_join_requests?select=id', { match_id: LINK, user_id: qa.ids.jugador7, status: 'pending', role: 'player' });
  sql(`update public.partidos set deleted_at = null where id = ${LINK};`);
  assert.ok(deleted.status >= 400, String(deleted.status));
});

// ---------- capacity ----------
const tokens = {
  organizer: await signIn('organizador'),
  member: await signIn('jugador1'),
};
const edgeApprove = async (token, requestId) => {
  const r = await fetch(`${API}/functions/v1/approve-join-request`, {
    method: 'POST',
    headers: { apikey: c.anonKey, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ request_id: requestId }),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

// 20261010141000: the organizer approves through the real approve-join-request function.
test('approving through approve-join-request: anon and a non-admin are refused; two concurrent approvals for the last slot → exactly one', async () => {
  // OPEN: 2 starters + 3 substitutes → one substitute slot left (cupo + 4).
  const pending = await as.requesterB('POST', 'match_join_requests?select=id', { match_id: OPEN, user_id: qa.ids.jugador7, status: 'pending', role: 'player' });
  assert.equal(pending.status, 201, JSON.stringify(pending.body));
  const ids = sql(`select string_agg(id::text, ',' order by id) from public.match_join_requests where match_id = ${OPEN} and status = 'pending'`).trim().split(',').map(Number);
  assert.equal(ids.length, 2);

  const anon = await edgeApprove(null, ids[0]);
  assert.equal(anon.status, 401, JSON.stringify(anon.body));
  const notAdmin = await edgeApprove(tokens.member, ids[0]);
  assert.deepEqual([notAdmin.status, notAdmin.body?.message], [403, 'forbidden']);
  const direct = await as.member('POST', 'rpc/approve_join_request', { p_request_id: ids[0] });
  assert.equal(direct.status, 403, JSON.stringify(direct.body));
  const anonDirect = await as.anon('POST', 'rpc/approve_join_request', { p_request_id: ids[0] });
  assert.ok(anonDirect.status === 401 || anonDirect.status === 403, String(anonDirect.status));

  const results = await Promise.all(ids.map((id) => edgeApprove(tokens.organizer, id)));
  const approved = results.filter((r) => r.status === 200 && r.body?.ok === true);
  const full = results.filter((r) => r.body?.ok === false);
  assert.equal(approved.length, 1, JSON.stringify(results));
  assert.equal(full.length, 1, JSON.stringify(results));
  assert.match(full[0].body.message, /El partido está completo/);
  const counts = sql(`select count(*) filter (where not coalesce(is_substitute, false)) || ':' || count(*) from public.jugadores where partido_id = ${OPEN}`).trim();
  assert.equal(counts, '2:6');
  assert.equal(sql(`select count(*) from public.match_join_requests where match_id = ${OPEN} and status = 'approved'`).trim(), '1');
});

test('invited accounts joining themselves: two at once for the last slot → exactly one gets in', async () => {
  // SECOND: cupo 1 (organizer) + 3 substitutes → one slot left.
  const results = await Promise.all([
    as.invitedA('POST', 'jugadores?select=id,is_substitute', { partido_id: SECOND, usuario_id: qa.ids.jugador8, nombre: 'Invitado A' }),
    as.invitedB('POST', 'jugadores?select=id,is_substitute', { partido_id: SECOND, usuario_id: qa.ids.nuevo, nombre: 'Invitado B' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400], JSON.stringify(results.map((r) => r.body)));
  assert.match(JSON.stringify(results.find((r) => r.status === 400).body), /MATCH_FULL/);
  assert.equal(sql(`select count(*) from public.jugadores where partido_id = ${SECOND}`).trim(), '5');
});

test('approve_join_request itself: two overlapping database sessions for the same last slot never overfill', async () => {
  // SECOND after the invited joins: cupo 1 + 4 substitutes = full; one more request must be refused
  // whatever the interleaving. Two requests, two sessions holding their transaction open.
  sql(`insert into public.match_join_requests (match_id, user_id, status, role) values
    (${SECOND}, '${qa.ids.jugador6}', 'pending', 'player'), (${SECOND}, '${qa.ids.jugador7}', 'pending', 'player');`);
  const ids = sql(`select string_agg(id::text, ',' order by id) from public.match_join_requests where match_id = ${SECOND} and status = 'pending'`).trim().split(',').map(Number);
  const approve = (id) => sqlAsync(`begin;
    select set_config('request.jwt.claims', '{"sub":"${ORG}","role":"authenticated"}', true);
    select public.approve_join_request(${id})::text;
    select pg_sleep(0.5);
    commit;`);
  const results = await Promise.all(ids.map(approve));
  assert.ok(results.every((r) => !r.ok && /completo|FULL/i.test(r.error)), JSON.stringify(results));
  assert.equal(sql(`select count(*) from public.jugadores where partido_id = ${SECOND}`).trim(), '5');
});

test('a player cannot promote, move or re-score their own row; renaming it still works', async () => {
  // Whichever invited account won the slot in the previous test.
  const me = sql(`select usuario_id from public.jugadores where partido_id = ${SECOND} and usuario_id in ('${qa.ids.jugador8}', '${qa.ids.nuevo}')`).trim();
  const player = me === qa.ids.jugador8 ? as.invitedA : as.invitedB;
  const row = `jugadores?partido_id=eq.${SECOND}&usuario_id=eq.${me}&select=id`;
  for (const patch of [{ is_substitute: false }, { substitute_order: null }, { partido_id: OPEN }, { score: 10 }]) {
    const r = await player('PATCH', row, patch);
    assert.equal(r.status, 403, `${JSON.stringify(patch)}: ${JSON.stringify(r.body)}`);
  }
  const renamed = await player('PATCH', row, { nombre: 'Invitado (editado)' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  const promoted = await as.organizer('PATCH', `jugadores?partido_id=eq.${SECOND}&usuario_id=eq.${me}&select=id`, { score: 7 });
  assert.equal(promoted.status, 200, 'the organizer still edits the roster');
});

// ---------- links ----------
test('a signed-in account joins through a valid guest invite link, never without it', async () => {
  const me = qa.ids.ajeno;
  const before = await as.linkUser('POST', 'jugadores?select=id', { partido_id: LINK, usuario_id: me, nombre: 'Ramiro' });
  assert.equal(before.status, 403);
  const wrong = await as.linkUser('POST', 'rpc/validate_guest_match_invite', { p_partido_id: LINK, p_codigo: 'PUBLAB04', p_token: 'otro-token' });
  assert.equal(wrong.body[0].ok, false);
  assert.equal((await as.linkUser('POST', 'jugadores?select=id', { partido_id: LINK, usuario_id: me, nombre: 'Ramiro' })).status, 403);
  const valid = await as.linkUser('POST', 'rpc/validate_guest_match_invite', { p_partido_id: LINK, p_codigo: 'PUBLAB04', p_token: 'link-lab-token-1' });
  assert.equal(valid.body[0].ok, true);
  const joined = await as.linkUser('POST', 'jugadores?select=id', { partido_id: LINK, usuario_id: me, nombre: 'Ramiro' });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
});

test('link voting by name: the "¿Quién sos?" guests come with has_account false and their vote counts', async () => {
  const byCode = await as.anon('POST', 'rpc/public_get_match_by_code', { p_codigo: 'VOTEPUB1', p_partido_id: VOTE });
  const guests = byCode.body.jugadores.filter((p) => p.has_account === false).map((p) => p.nombre).sort();
  assert.deepEqual(guests, ['Invitado Dos', 'Invitado Uno']);
  assert.ok(byCode.body.jugadores.every((p) => !('usuario_id' in p) && !('score' in p)));
  const target = byCode.body.jugadores.find((p) => p.nombre === 'Invitado Dos').id;
  const vote = await as.anon('POST', 'rpc/public_submit_player_rating', {
    p_partido_id: VOTE, p_codigo: 'VOTEPUB1', p_votante_nombre: 'Invitado Uno', p_votado_jugador_id: target, p_puntaje: 8,
  });
  assert.equal(vote.body, 'ok');
  const registered = await as.anon('POST', 'rpc/public_submit_player_rating', {
    p_partido_id: VOTE, p_codigo: 'VOTEPUB1', p_votante_nombre: 'Martín', p_votado_jugador_id: target, p_puntaje: 8,
  });
  assert.equal(registered.body, 'invalid');
});

test('a starter leaving still promotes the first substitute (server trigger, not blocked by the self-update guard)', async () => {
  // OPEN is full: 2 starters (organizer, jugador1) + 4 substitutes.
  const left = await as.member('DELETE', `jugadores?partido_id=eq.${OPEN}&usuario_id=eq.${qa.ids.jugador1}&select=id`);
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.equal(left.body.length, 1);
  const counts = sql(`select count(*) filter (where not coalesce(is_substitute, false)) || ':' || count(*) from public.jugadores where partido_id = ${OPEN}`).trim();
  assert.equal(counts, '2:5');
});
