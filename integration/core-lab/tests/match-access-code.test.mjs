// 20261010133000 + docs/database/core-review/phase-b-partidos-access-code.sql:
// discovery of published matches stays; their codes are for the admin and the roster;
// links that carry the code (WhatsApp) keep working for everyone.
// SQL checks run in rolled-back transactions; the API check applies phase B for real in the
// lab and restores the previous grant at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { API, config, repo, root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const phaseB = await readFile(`${repo}docs/database/core-review/phase-b-partidos-access-code.sql`, 'utf8');
const M = 990801;
const CODE = 'CODELAB1';
const ORG = qa.ids.organizador;
const MEMBER = qa.ids.jugador1;
const OUTSIDER = qa.ids.ajeno;
const as = (userId) => `reset role; set local "request.jwt.claims" to '{"sub":"${userId}","role":"authenticated"}'; set local role authenticated;`;
const asAnon = `reset role; set local "request.jwt.claims" to '{"role":"anon"}'; set local role anon;`;

// A published match (looking for players, kickoff tomorrow) with the member in its roster.
const fixture = `
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, falta_jugadores, creado_por, admin_id)
  values (${M}, 'Codigo lab', '${CODE}', current_date + 1, '21:00', 'Cancha lab', 'F5', 10, 'activo', true, '${ORG}', '${ORG}');
  insert into public.jugadores (partido_id, nombre, usuario_id) values (${M}, 'Lucía', '${ORG}'), (${M}, 'Martín', '${MEMBER}');`;
const inTx = (statements, { withPhaseB = false } = {}) => sqlTry(`begin; ${fixture} ${withPhaseB ? phaseB : ''} ${statements} rollback;`);
const lines = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n').filter(Boolean);
};
const codeSeenBy = (userId, source) => `${as(userId)} select coalesce(codigo, 'null') from ${source} where id = ${M};`;

for (const withPhaseB of [false, true]) {
  const phase = withPhaseB ? 'phase B' : 'phase A';

  test(`${phase}: views show the code to the admin and the roster, NULL to anybody else`, () => {
    for (const view of ['public.partidos_view', 'public.partidos_abiertos_operativos', 'public.partidos_abiertos_operativos_v2']) {
      assert.deepEqual(lines(inTx(`${codeSeenBy(ORG, view)} ${codeSeenBy(MEMBER, view)} ${codeSeenBy(OUTSIDER, view)}`, { withPhaseB })),
        [CODE, CODE, 'null'], view);
    }
  });

  test(`${phase}: "Quiero jugar" still lists the match for an outsider, without its code`, () => {
    assert.deepEqual(lines(inTx(`${as(OUTSIDER)}
      select nombre || ',' || coalesce(codigo, 'null') from public.get_open_matches_for_quiero_jugar_v2(null, null, 200) where id = ${M};`,
    { withPhaseB })), ['Codigo lab,null']);
  });

  test(`${phase}: members get the code from get_match_access_codes; outsiders get nothing; anon cannot call it`, () => {
    assert.deepEqual(lines(inTx(`
      ${as(MEMBER)} select count(*) || ':' || coalesce(max(codigo), '-') from public.get_match_access_codes(array[${M}]::bigint[]);
      ${as(OUTSIDER)} select count(*) || ':' || coalesce(max(codigo), '-') from public.get_match_access_codes(array[${M}]::bigint[]);`,
    { withPhaseB })), [`1:${CODE}`, '0:-']);
    const anon = inTx(`${asAnon} select * from public.get_match_access_codes(array[${M}]::bigint[]);`, { withPhaseB });
    assert.equal(anon.ok, false);
    assert.match(anon.error, /permission denied/);
  });

  test(`${phase}: a link with the code still opens the match, for visitors and outsiders alike`, () => {
    for (const who of [asAnon, as(OUTSIDER)]) {
      assert.deepEqual(lines(inTx(`${who}
        select public.resolve_match_by_code('${CODE.toLowerCase()}');
        select nombre from public.get_partido_by_invite(${M}, '${CODE}');
        select (public.public_get_match_by_code('${CODE}', ${M}) -> 'partido' ->> 'nombre');
        select count(*) from public.get_partido_by_invite(${M}, 'WRONG123');`, { withPhaseB })),
      [String(M), 'Codigo lab', 'Codigo lab', '0']);
    }
  });
}

// 20261010137000: the code is a credential (link voting), so the table returns a published
// match only to those involved; everybody else discovers it through the views, without it.
test('phase A: the table returns the code only to those involved; outsiders discover the match through the views', () => {
  assert.deepEqual(lines(inTx(`${codeSeenBy(ORG, 'public.partidos')} ${codeSeenBy(MEMBER, 'public.partidos')}`)), [CODE, CODE]);
  assert.deepEqual(lines(inTx(`${as(OUTSIDER)} select count(*) from public.partidos where id = ${M};`)), ['0']);
  assert.deepEqual(lines(inTx(`${as(OUTSIDER)} select nombre || ',' || coalesce(codigo, 'null') from public.partidos_view where id = ${M};`)),
    ['Codigo lab,null']);
});

test('phase B: nobody reads partidos.codigo from the table; discovery columns and writes keep working', () => {
  for (const who of [as(OUTSIDER), as(ORG), asAnon]) {
    const read = inTx(`${who} select codigo from public.partidos where id = ${M};`, { withPhaseB: true });
    assert.equal(read.ok, false);
    assert.match(read.error, /permission denied/);
  }
  assert.deepEqual(lines(inTx(`${as(MEMBER)} select nombre from public.partidos where id = ${M};`, { withPhaseB: true })), ['Codigo lab']);
  assert.deepEqual(lines(inTx(`${as(OUTSIDER)} select count(*) from public.partidos where id = ${M};`, { withPhaseB: true })), ['0']);
  assert.deepEqual(lines(inTx(`${as(OUTSIDER)} select nombre from public.partidos_view where id = ${M};`, { withPhaseB: true })), ['Codigo lab']);
  assert.deepEqual(lines(inTx(`${as(ORG)}
    insert into public.partidos (nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
    values ('Nuevo lab', 'NUEVOLAB', current_date + 2, '20:00', 'Cancha', 'F5', 10, 'activo', '${ORG}', '${ORG}') returning nombre;
    update public.partidos set nombre = 'Codigo lab 2' where id = ${M} returning nombre;`, { withPhaseB: true })),
  ['Nuevo lab', 'Codigo lab 2']);
});

// --- Through the real API, phase B applied in the lab and restored afterwards ------
const c = await config();
const token = async (key) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: c.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${key}@arma2.lab`, password: qa.passwords[key] }),
  });
  return (await r.json()).access_token;
};
const call = (bearer) => async (path, init = {}) => {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.anonKey, authorization: `Bearer ${bearer || c.anonKey}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

test('API with phase B: tables, views and RPCs as visitor, outsider and member', async () => {
  const setup = sqlTry(`${fixture}`);
  assert.equal(setup.ok, true, setup.error);
  const applied = sqlTry(phaseB);
  try {
    assert.equal(applied.ok, true, applied.error);
    const anon = call(null);
    const outsider = call(await token('ajeno'));
    const member = call(await token('jugador1'));

    for (const who of [anon, outsider]) {
      const codes = await who(`partidos?select=id,codigo&id=eq.${M}`);
      assert.ok(codes.status >= 400, `codigo readable: ${codes.status}`);
    }
    // 20261010137000: the table no longer returns a published match to an outsider; the
    // views do, without its code.
    const table = await outsider(`partidos?select=id,nombre&id=eq.${M}`);
    assert.deepEqual(table.body, []);
    const memberTable = await member(`partidos?select=id,nombre&id=eq.${M}`);
    assert.deepEqual(memberTable.body, [{ id: M, nombre: 'Codigo lab' }]);
    const view = await outsider(`partidos_view?select=*&id=eq.${M}`);
    assert.equal(view.status, 200);
    assert.equal(view.body[0].nombre, 'Codigo lab');
    assert.equal(view.body[0].codigo, null);
    const anonView = await anon(`partidos_view?select=id&id=eq.${M}`);
    assert.deepEqual([anonView.status, anonView.body], [200, []]);
    const quiero = await outsider('rpc/get_open_matches_for_quiero_jugar_v2', { method: 'POST', body: JSON.stringify({ p_user_lat: null, p_user_lng: null, p_max_distance_km: 200 }) });
    assert.equal(quiero.status, 200, JSON.stringify(quiero.body));
    assert.equal(quiero.body.find((row) => row.id === M)?.codigo, null);
    const memberCode = await member('rpc/get_match_access_codes', { method: 'POST', body: JSON.stringify({ p_partido_ids: [M] }) });
    assert.deepEqual(memberCode.body, [{ partido_id: M, codigo: CODE }]);
    const memberView = await member(`partidos_view?select=codigo&id=eq.${M}`);
    assert.deepEqual(memberView.body, [{ codigo: CODE }]);
    const link = await anon('rpc/resolve_match_by_code', { method: 'POST', body: JSON.stringify({ p_codigo: CODE }) });
    assert.equal(link.body, M);
    const invite = await outsider('rpc/get_partido_by_invite', { method: 'POST', body: JSON.stringify({ p_partido_id: M, p_codigo: CODE }) });
    assert.equal(invite.body?.[0]?.nombre, 'Codigo lab');
  } finally {
    const restored = sqlTry('grant select on table public.partidos to anon, authenticated;');
    sqlTry(`delete from public.jugadores where partido_id = ${M}; delete from public.partidos where id = ${M};`);
    assert.equal(restored.ok, true, restored.error);
  }
  assert.deepEqual(lines(sqlTry(`select has_column_privilege('authenticated', 'public.partidos', 'codigo', 'select');`)), ['t']);
});
