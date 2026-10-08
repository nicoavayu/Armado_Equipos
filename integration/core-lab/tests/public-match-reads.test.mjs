// 20261010125000: without a session, a match is read only by presenting its code — one
// match per code — instead of anon listing every match, its code and its roster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));

const asAnon = (statements) => sqlTry(`
  begin;
  insert into public.partidos (id, nombre, codigo, fecha, hora, sede, modalidad, cupo_jugadores, estado, creado_por, admin_id)
  values (990301, 'Link lab', 'LINKLAB1', current_date + 2, '20:00', 'Cancha lab', 'F5', 10, 'activo', '${qa.ids.organizador}', '${qa.ids.organizador}'),
         (990302, 'Otro partido', 'OTROLAB2', current_date + 3, '20:00', 'Otra cancha', 'F5', 10, 'activo', '${qa.ids.ajeno}', '${qa.ids.ajeno}');
  insert into public.jugadores (partido_id, nombre, usuario_id) values
    (990301, 'Invitado Link', null), (990301, 'Martín Gómez', '${qa.ids.jugador1}'), (990302, 'Ajeno', '${qa.ids.ajeno}');
  set local role anon;
  ${statements}
  rollback;`);

const lines = (result) => {
  assert.equal(result.ok, true, result.error);
  return result.out.trim().split('\n').filter(Boolean);
};

test('anon lists no match, no code and no roster', () => {
  assert.deepEqual(lines(asAnon(`
    select count(*) from public.partidos;
    select count(*) from public.partidos_view;
    select count(*) from public.jugadores;
    select count(*) from public.partidos where codigo = 'LINKLAB1';`)), ['0', '0', '0', '0']);
});

test('the code opens exactly its own match and roster (as the voting and invite pages read them)', () => {
  assert.deepEqual(lines(asAnon(`
    select (m->'partido'->>'id') || '|' || (m->'partido'->>'nombre') || '|' || jsonb_array_length(m->'jugadores') || '|' || (m->'partido' ? 'tipo_partido')
    from public.public_get_match_by_code('linklab1') m;
    select jsonb_array_length(public.public_get_match_by_code(' LINKLAB1 ', 990301)->'jugadores');`)),
  ['990301|Link lab|2|true', '2']);
});

test('a wrong code, or a code with another match id, opens nothing', () => {
  assert.deepEqual(lines(asAnon(`
    select coalesce(public.public_get_match_by_code('NOEXISTE')::text, 'null');
    select coalesce(public.public_get_match_by_code('LINKLAB1', 990302)::text, 'null');
    select coalesce(public.public_get_match_by_code('')::text, 'null');
    select coalesce(public.public_get_match_by_code('%')::text, 'null');`)), ['null', 'null', 'null', 'null']);
});

test('a cancelled match is not opened by its link', () => {
  assert.deepEqual(lines(asAnon(`reset role; update public.partidos set estado = 'cancelado' where id = 990301; set local role anon;
    select coalesce(public.public_get_match_by_code('LINKLAB1')::text, 'null');`)), ['null']);
});

test('signed-in accounts keep reading matches as before (unchanged by this migration)', () => {
  assert.deepEqual(lines(asAnon(`reset role;
    set local "request.jwt.claims" to '{"sub":"${qa.ids.jugador1}","role":"authenticated"}'; set local role authenticated;
    select count(*) >= 2 from public.partidos where id in (990301, 990302);`)), ['t']);
});
