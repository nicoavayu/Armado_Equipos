// 20261010136000: who reads a match and its roster, through the real API with each
// account's own session, and every read of partidos/jugadores/partidos_view/
// partidos_jugadores that app version 1.1.21 makes (extracted from dad2a0b9) replayed as a
// member and as an unrelated account: no new error, and nothing of a private match leaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { API, config, root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const c = await config();
const PRIVATE_MATCH = 990701;
const OPEN_MATCH = 990702;
const DELETED_MATCH = 990703;
const TEAM_PLAYER = 990799;
const ORG = qa.ids.organizador;

const LEGACY_SELECTS = {
  "jugadores": [
    "*",
    "id",
    "id,nombre,created_at",
    "id,nombre,usuario_id,partido_id",
    "id,partido_id",
    "id,partido_id,usuario_id",
    "id,usuario_id",
    "id,usuario_id,avatar_url",
    "id,usuario_id,nombre",
    "id,usuario_id,nombre,avatar_url,score",
    "id,usuario_id,nombre,avatar_url,score,created_at",
    "id,usuario_id,nombre,avatar_url,score,is_goalkeeper",
    "id,usuario_id,nombre,avatar_url,score,uuid",
    "id,usuario_id,uuid,nombre,is_substitute",
    "id,uuid,usuario_id",
    "id,uuid,usuario_id,nombre",
    "id,uuid,usuario_id,nombre,avatar_url",
    "id,uuid,usuario_id,nombre,avatar_url,foto_url,score,is_goalkeeper",
    "id,uuid,usuario_id,nombre,avatar_url,score,is_goalkeeper",
    "id,uuid,usuario_id,nombre,is_goalkeeper",
    "id,uuid,usuario_id,nombre,is_goalkeeper,is_substitute",
    "is_substitute",
    "nombre,usuario_id",
    "partido_id",
    "partido_id,id,uuid,usuario_id",
    "partido_id,nombre,usuario_id",
    "partido_id,usuario_id",
    "usuario_id",
    "usuario_id,nombre,avatar_url",
    "usuario_id,partido_id",
    "uuid",
    "uuid,nombre"
  ],
  "partidos": [
    "*",
    "*,jugadores(count)",
    "*,jugadores(is_substitute)",
    "codigo",
    "creado_por",
    "creado_por,nombre",
    "equipos_json",
    "equipos_json,equipos",
    "equipos_json,equipos,survey_team_a,survey_team_b,final_team_a,final_team_b",
    "estado,survey_status,survey_closes_at,result_status",
    "fecha,hora",
    "id",
    "id,estado,equipos_json",
    "id,estado,fecha",
    "id,estado,survey_status,result_status,finished_at",
    "id,fecha,hora",
    "id,fecha,hora,estado,survey_status,survey_closes_at,survey_expected_voters,result_status,awards_status,finished_at",
    "id,fecha,hora,estado,survey_status,survey_opened_at,survey_closes_at,result_status,finished_at,survey_team_a,survey_team_b,final_team_a,final_team_b",
    "id,nombre",
    "id,nombre,creado_por",
    "id,nombre,fecha,hora,creado_por,precio_cancha_por_persona",
    "id,nombre,fecha,hora,estado,surveys_processed,jugadores:jugadores(usuario_id)",
    "id,nombre,fecha,hora,sede,creado_por,cupo_jugadores,estado,survey_status,result_status,finished_at",
    "id,nombre,fecha,hora,sede,estado",
    "id,nombre,fecha,hora,sede,estado,from_frequent_match_id",
    "id,nombre,fecha,hora,sede,estado,template_id",
    "id,nombre,fecha,hora,sede,modalidad,cupo_jugadores,tipo_partido,creado_por,codigo,estado,deleted_at,survey_status,result_status,finished_at,player_invites_enabled,falta_jugadores",
    "id,nombre,fecha,hora,sede,modalidad,cupo_jugadores,tipo_partido,creado_por,estado,deleted_at,survey_status,result_status,finished_at,player_invites_enabled",
    "id,nombre,fecha,hora,survey_closes_at",
    "id,precio_cancha_por_persona",
    "id,result_status,winner_team,finished_at",
    "id,winner_team,result_status,finished_at,final_team_a,final_team_b,survey_status",
    "id,winner_team,result_status,finished_at,survey_status",
    "id,winner_team,result_status,finished_at,survey_team_a,survey_team_b,final_team_a,final_team_b,survey_status",
    "nombre",
    "nombre,fecha,hora,sede",
    "player_invites_enabled,busca_arquero,falta_jugadores",
    "survey_status,result_status",
    "survey_status,survey_opened_at,survey_closes_at,result_status,finished_at,fecha,hora",
    "survey_status,survey_opened_at,survey_closes_at,survey_expected_voters,result_status,winner_team,finished_at,awards_status,fecha,hora,survey_team_a,survey_team_b,final_team_a,final_team_b",
    "surveys_processed",
    "teams_confirmed",
    "teams_confirmed,from_frequent_match_id",
    "teams_confirmed,teams_locked,teams_source,teams_locked_by_user_id,teams_locked_at,survey_team_a,survey_team_b,final_team_a,final_team_b,equipos_json,equipos,survey_status,survey_opened_at,survey_closes_at,result_status,finished_at",
    "teams_confirmed,teams_source,survey_team_a,survey_team_b,final_team_a,final_team_b",
    "teams_confirmed,teams_source,survey_team_a,survey_team_b,teams_locked_by_user_id,teams_locked_at,final_team_a,final_team_b,final_teams_updated_at,final_teams_updated_by",
    "teams_confirmed,template_id",
    "teams_locked,teams_source,teams_locked_by_user_id,teams_locked_at,survey_team_a,survey_team_b,final_team_a,final_team_b"
  ],
  "partidos_view": [
    "*",
    "id",
    "jugadores"
  ],
  "partidos_jugadores": [
    "jugador_id"
  ]
};

const sql = (statements) => {
  const r = sqlTry(statements);
  assert.equal(r.ok, true, r.error);
  return r.out.trim();
};

test.before(() => {
  sql(`
    delete from public.partidos where id in (${PRIVATE_MATCH}, ${OPEN_MATCH}, ${DELETED_MATCH});
    delete from public.jugadores where id = ${TEAM_PLAYER};
    insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id, falta_jugadores, deleted_at) values
      (${PRIVATE_MATCH}, 'Privado lab', 'PRIVLAB1', current_date + 2, '21:00', 'Cancha lab', 'F5', 10, 'activo', '${ORG}', '${ORG}', false, null),
      (${OPEN_MATCH}, 'Abierto lab', 'OPENLAB1', current_date + 2, '21:00', 'Cancha lab', 'F5', 10, 'activo', '${ORG}', '${ORG}', true, null),
      (${DELETED_MATCH}, 'Borrado lab', 'DELLAB01', current_date + 2, '21:00', 'Cancha lab', 'F5', 10, 'activo', '${ORG}', '${ORG}', false, now());
    insert into public.jugadores (partido_id, nombre, usuario_id) values
      (${PRIVATE_MATCH}, 'Martín (lab)', '${qa.ids.jugador1}'),
      (${PRIVATE_MATCH}, 'Invitado lab', null),
      (${OPEN_MATCH}, 'Sofía (lab)', '${qa.ids.jugador2}');
    insert into public.jugadores (id, partido_id, nombre) values (${TEAM_PLAYER}, null, 'Jugador de equipo lab');
    insert into public.notifications (user_id, partido_id, type, title, message, data)
      values ('${qa.ids.jugador3}', ${PRIVATE_MATCH}, 'match_invite', 'Invitación', 'Te invitaron', jsonb_build_object('match_id', ${PRIVATE_MATCH}));
    insert into public.match_join_requests (match_id, user_id, status) values (${PRIVATE_MATCH}, '${qa.ids.jugador4}', 'pending');
  `);
});

test.after(() => {
  sqlTry(`delete from public.partidos where id in (${PRIVATE_MATCH}, ${OPEN_MATCH}, ${DELETED_MATCH});
    delete from public.jugadores where id = ${TEAM_PLAYER};
    delete from public.notifications where partido_id = ${PRIVATE_MATCH};`);
});

const signIn = async (key) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: c.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${key}@arma2.lab`, password: qa.passwords[key] }),
  });
  if (!r.ok) throw new Error(`sign-in ${key}: ${r.status}`);
  return (await r.json()).access_token;
};
const api = (token) => async (method, path, body) => {
  const headers = { apikey: c.anonKey, 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const as = {
  organizer: api(await signIn('organizador')),
  member: api(await signIn('jugador1')),
  openMember: api(await signIn('jugador2')),
  invited: api(await signIn('jugador3')),
  requester: api(await signIn('jugador4')),
  stranger: api(await signIn('jugador9')),
  anon: api(null),
};
const ids = async (who, path) => {
  const r = await as[who]('GET', path);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.map((row) => row.id ?? row.partido_id).sort();
};

for (const who of ['organizer', 'member', 'invited', 'requester']) {
  test(`a private match and its roster are visible to the ${who}`, async () => {
    assert.deepEqual(await ids(who, `partidos?select=id&id=eq.${PRIVATE_MATCH}`), [PRIVATE_MATCH]);
    const roster = await as[who]('GET', `jugadores?select=nombre&partido_id=eq.${PRIVATE_MATCH}&order=nombre`);
    assert.deepEqual(roster.body.map((row) => row.nombre), ['Invitado lab', 'Martín (lab)']);
  });
}

test('an unrelated account gets nothing of a private match: row, code, roster, view', async () => {
  assert.deepEqual(await ids('stranger', `partidos?select=id,codigo&id=eq.${PRIVATE_MATCH}`), []);
  assert.deepEqual(await ids('stranger', `jugadores?select=id&partido_id=eq.${PRIVATE_MATCH}`), []);
  assert.deepEqual(await ids('stranger', `partidos_view?select=id&id=eq.${PRIVATE_MATCH}`), []);
  assert.deepEqual(await ids('stranger', `partidos_jugadores?select=partido_id&partido_id=eq.${PRIVATE_MATCH}`), []);
});

test('an unrelated account can no longer list the codes of every match', async () => {
  const r = await as.stranger('GET', 'partidos?select=id,codigo&limit=1000');
  assert.equal(r.status, 200);
  const visible = r.body.map((row) => row.id);
  assert.ok(!visible.includes(PRIVATE_MATCH));
  // Everything still listed is published looking for players (or involves the account).
  const listed = sql(`select coalesce(string_agg(id::text, ',' order by id), '') from public.partidos p
    where p.id = any(array[${visible.join(',') || 'null'}]::bigint[])
      and not public.partido_is_operationally_open(p.estado, p.deleted_at, p.survey_status, p.result_status, p.finished_at,
        p.fecha, p.hora, coalesce(p.falta_jugadores, false) or coalesce(p.busca_arquero, false), now())
      and not app_private.match_involves_user(p.id, '${qa.ids.jugador9}')`);
  assert.equal(listed, '');
});

test('an unrelated account no longer reads every roster (only open matches and team players)', async () => {
  const r = await as.stranger('GET', 'jugadores?select=id,partido_id&limit=2000');
  assert.equal(r.status, 200);
  const leaked = r.body.filter((row) => row.partido_id !== null).map((row) => row.partido_id);
  assert.ok(!leaked.includes(PRIVATE_MATCH));
  assert.ok(r.body.some((row) => row.id === TEAM_PLAYER), 'team players (no match) stay visible');
});

test('a match published looking for players stays visible with its roster (installed apps open it from the table)', async () => {
  assert.deepEqual(await ids('stranger', `partidos?select=id&id=eq.${OPEN_MATCH}`), [OPEN_MATCH]);
  const roster = await as.stranger('GET', `jugadores?select=nombre&partido_id=eq.${OPEN_MATCH}`);
  assert.deepEqual(roster.body.map((row) => row.nombre), ['Sofía (lab)']);
  // Through the view the code stays masked for non-members (20261010133000).
  const view = await as.stranger('GET', `partidos_view?select=id,codigo&id=eq.${OPEN_MATCH}`);
  assert.deepEqual(view.body, [{ id: OPEN_MATCH, codigo: null }]);
});

test('residual, recorded: the code of a match published looking for players is readable from the table', async () => {
  const r = await as.stranger('GET', `partidos?select=codigo&id=eq.${OPEN_MATCH}`);
  assert.deepEqual(r.body, [{ codigo: 'OPENLAB1' }]);
});

test('a deleted match is only visible to its admin', async () => {
  assert.deepEqual(await ids('organizer', `partidos?select=id&id=eq.${DELETED_MATCH}`), [DELETED_MATCH]);
  assert.deepEqual(await ids('stranger', `partidos?select=id&id=eq.${DELETED_MATCH}`), []);
});

test('anon still reads no rows, and the link flows (RPCs) keep working with the code', async () => {
  assert.deepEqual((await as.anon('GET', `partidos?select=id&id=eq.${PRIVATE_MATCH}`)).body, []);
  assert.deepEqual((await as.anon('GET', `jugadores?select=id&partido_id=eq.${PRIVATE_MATCH}`)).body, []);
  const byCode = await as.anon('POST', 'rpc/public_get_match_by_code', { p_codigo: 'PRIVLAB1', p_partido_id: PRIVATE_MATCH });
  assert.equal(byCode.status, 200, JSON.stringify(byCode.body));
  const resolved = await as.stranger('POST', 'rpc/resolve_match_by_code', { p_codigo: 'PRIVLAB1' });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  assert.equal(Number(resolved.body), PRIVATE_MATCH);
});

const columnExists = (table, column) => sql(`select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = '${table}' and column_name = '${column}';`) === '1';

for (const [table, selects] of Object.entries(LEGACY_SELECTS)) {
  const key = table === 'jugadores' || table === 'partidos_jugadores' ? 'partido_id' : 'id';
  for (const select of selects) {
    for (const who of ['member', 'stranger']) {
      test(`1.1.21 read ${table}?select=${select.slice(0, 50)} as ${who}: no new error, nothing private leaks`, async () => {
        const r = await as[who]('GET', `${table}?select=${encodeURIComponent(select)}&${key}=in.(${PRIVATE_MATCH},${OPEN_MATCH})`);
        if (r.status === 400 && r.body?.code === '42703') {
          // 1.1.21 asks for a column this schema never had: it fails the same way today.
          const missing = /column \w+\.(\w+) does not exist/.exec(r.body.message)?.[1];
          assert.ok(missing && !columnExists(table, missing), `unexpected 42703: ${r.body.message}`);
          return;
        }
        assert.equal(r.status, 200, JSON.stringify(r.body));
        if (who === 'stranger' && Array.isArray(r.body) && r.body.length && Object.hasOwn(r.body[0], key)) {
          assert.ok(!r.body.some((row) => Number(row[key]) === PRIVATE_MATCH), 'a private match leaked');
        }
      });
    }
  }
}

// Writes with RETURNING (insert().select(), update().select()) evaluate the read policy on
// the new row: every app creates matches and adds players this way.
const write = (who) => async (method, path, body) => {
  const token = await signIn(who);
  const r = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: { apikey: c.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

test('1.1.21 writes with RETURNING keep working: create a match, add a guest, join, edit', async () => {
  const created = await write('organizador')('POST', 'partidos?select=*', {
    nombre: 'Creado lab', codigo: `CL${Date.now().toString(16).slice(-6)}`, fecha: '2026-12-10', hora: '21:00', sede: 'Cancha lab',
    modalidad: 'F5', cupo_jugadores: 10, tipo_partido: 'Masculino', creado_por: ORG,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const matchId = created.body[0].id;
  try {
    const guest = await write('organizador')('POST', 'jugadores?select=*', { partido_id: matchId, nombre: 'Invitado creado' });
    assert.equal(guest.status, 201, JSON.stringify(guest.body));
    const joined = await write('jugador5')('POST', 'jugadores?select=*', { partido_id: matchId, nombre: 'Jugador 5', usuario_id: qa.ids.jugador5 });
    assert.equal(joined.status, 201, JSON.stringify(joined.body));
    const edited = await write('organizador')('PATCH', `partidos?id=eq.${matchId}&select=id,nombre`, { nombre: 'Creado lab (editado)' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.deepEqual(edited.body, [{ id: matchId, nombre: 'Creado lab (editado)' }]);
    // Once the player joined, the match is theirs to see too.
    const seen = await write('jugador5')('PATCH', `jugadores?partido_id=eq.${matchId}&usuario_id=eq.${qa.ids.jugador5}&select=id`, { nombre: 'Jugador Cinco' });
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
  } finally {
    sqlTry(`delete from public.partidos where id = ${matchId};`);
  }
});
