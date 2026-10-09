// 20261010135000 against the installed apps: every read of usuarios/profiles that app
// version 1.1.21 (both stores; built from dad2a0b9) makes, replayed through the real API
// with each account's own session, plus its profile writes. Nothing may error, and no
// response may carry another account's (or, through the table, any) private value.
// The select lists below were extracted from dad2a0b9 (src/, tests excluded).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { API, config, root, sqlTry } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const c = await config();
const OWNER = qa.ids.jugador8;
const FOREIGN = qa.ids.jugador9;
const PRIVATE = ['email', 'telefono', 'fecha_nacimiento', 'location_accuracy_m'];

const LEGACY_SELECTS = {
  "usuarios": [
    "*",
    "avatar_url",
    "id,avatar_url",
    "id,nombre",
    "id,nombre,avatar_url,acepta_invitaciones",
    "id,nombre,avatar_url,lesion_activa",
    "id,nombre,avatar_url,localidad,latitud,longitud,ranking,partidos_jugados,posicion,posiciones,disponible_arquero,acepta_invitaciones,bio,fecha_alta,updated_at,nacionalidad,mvps",
    "id,nombre,avatar_url,localidad,latitud,longitud,ranking,partidos_jugados,posicion,posiciones,disponible_arquero,acepta_invitaciones,bio,nacionalidad,mvps",
    "id,nombre,avatar_url,posicion,posiciones,ranking,partidos_jugados,pais_codigo,numero",
    "id,nombre,avatar_url,posicion,ranking",
    "id,nombre,email,avatar_url,localidad",
    "id,nombre,email,avatar_url,localidad,ranking,partidos_jugados,posicion,latitud,longitud",
    "id,nombre,email,avatar_url,localidad,ranking,posicion,partidos_jugados,latitud,longitud",
    "id,ranking",
    "id,ranking,partidos_abandonados",
    "latitud,longitud",
    "latitud,longitud,location_updated_at",
    "nombre",
    "nombre,avatar_url",
    "partidos_abandonados",
    "partidos_jugados,partidos_abandonados,ranking",
    "posiciones,posicion",
    "ranking",
    "telefono"
  ],
  "profiles": [
    "*",
    "id,avatar_url",
    "id,nombre,avatar_url",
    "id,nombre,avatar_url,estadisticas"
  ]
};

const signIn = async (key) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: c.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${key}@arma2.lab`, password: qa.passwords[key] }),
  });
  if (!r.ok) throw new Error(`sign-in ${key}: ${r.status}`);
  return (await r.json()).access_token;
};
const api = (token) => async (method, path, body, prefer = 'return=representation') => {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: { apikey: c.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const owner = api(await signIn('jugador8'));
const foreign = api(await signIn('jugador9'));

const columnExists = (table, column) => sqlTry(`select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = '${table}' and column_name = '${column}';`).out.trim() === '1';

const leaks = (rows) => (Array.isArray(rows) ? rows : [rows]).flatMap((row) => PRIVATE
  .filter((key) => row && Object.hasOwn(row, key) && row[key] !== null)
  .map((key) => `${row.id || '?'}.${key}`));

test.before(async () => {
  // The owner fills in phone, birth date and an exact location like the app does.
  const r = await owner('PATCH', `usuarios?id=eq.${OWNER}&select=*`, {
    telefono: '+54 9 11 6000-1234', fecha_nacimiento: '1994-03-02', latitud: -34.60371, longitud: -58.38157, location_accuracy_m: 8,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(leaks(r.body), [], 'the PATCH response itself must come back masked');
});

test.after(() => {
  // Leave the lab as it was: clear the owner's private values.
  sqlTry(`update app_private.usuarios_private set telefono = null, fecha_nacimiento = null, latitud = null,
    longitud = null, location_accuracy_m = null where user_id = '${OWNER}';
    update public.usuarios set latitud = null, longitud = null where id = '${OWNER}';`);
});

for (const [table, selects] of Object.entries(LEGACY_SELECTS)) {
  for (const select of selects) {
    for (const [who, call] of [['another account', foreign], ['the owner', owner]]) {
      test(`1.1.21 read ${table}?select=${select.slice(0, 60)} as ${who}: 200, nothing private`, async () => {
        const filter = table === 'usuarios' || table === 'profiles' ? `&id=in.(${OWNER},${FOREIGN})` : '';
        const r = await call('GET', `${table}?select=${encodeURIComponent(select)}${filter}`);
        if (r.status === 400 && r.body?.code === '42703') {
          // 1.1.21 asks for a column this schema never had (usuarios.fecha_alta,
          // profiles.estadisticas): it fails the same way today, unrelated to this change.
          const missing = /column \w+\.(\w+) does not exist/.exec(r.body.message)?.[1];
          assert.ok(missing && !columnExists(table, missing), `unexpected 42703: ${r.body.message}`);
          return;
        }
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(leaks(r.body), []);
      });
    }
  }
}

test('another account sees only the ~1 km location of the owner', async () => {
  const r = await foreign('GET', `usuarios?select=latitud,longitud&id=eq.${OWNER}`);
  assert.deepEqual(r.body, [{ latitud: -34.6, longitud: -58.38 }]);
});

test('the owner still gets everything through get_my_profile()', async () => {
  const r = await owner('POST', 'rpc/get_my_profile', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [me] = r.body;
  assert.deepEqual(
    [me.telefono, me.fecha_nacimiento, me.latitud, me.longitud, me.location_accuracy_m, me.email],
    ['+54 9 11 6000-1234', '1994-03-02', -34.60371, -58.38157, 8, 'jugador8@arma2.lab'],
  );
});

test('1.1.21 bootstrap upsert (email + nulls, on_conflict=id) works and wipes nothing', async () => {
  const r = await owner('POST', 'usuarios?on_conflict=id&select=*', {
    id: OWNER, nombre: 'Jugador 8', email: 'jugador8@arma2.lab', avatar_url: null, ranking: 5, partidos_jugados: 0,
    acepta_invitaciones: true, perfil_completo: false, profile_completion: 0, latitud: null, longitud: null,
    location_accuracy_m: null, fecha_nacimiento: null, partidos_abandonados: 0,
  }, 'return=representation,resolution=merge-duplicates');
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  assert.deepEqual(leaks(r.body), []);
  const [me] = (await owner('POST', 'rpc/get_my_profile', {})).body;
  assert.deepEqual([me.telefono, me.fecha_nacimiento, me.latitud], ['+54 9 11 6000-1234', '1994-03-02', -34.60371]);
});

test('1.1.21 profile save with the (masked, blank) form keeps the stored values', async () => {
  const r = await owner('PATCH', `usuarios?id=eq.${OWNER}`, { nombre: 'Jugador Ocho', telefono: '', fecha_nacimiento: null, bio: 'lab' });
  assert.ok([200, 204].includes(r.status), JSON.stringify(r.body));
  const [me] = (await owner('POST', 'rpc/get_my_profile', {})).body;
  assert.deepEqual([me.nombre, me.telefono, me.fecha_nacimiento], ['Jugador Ocho', '+54 9 11 6000-1234', '1994-03-02']);
});

test('1.1.21 profiles writes (upsert/update with telefono) keep working and never expose it', async () => {
  const up = await owner('POST', 'profiles?on_conflict=id&select=*', { id: OWNER, nombre: 'Jugador Ocho', telefono: '+54 9 11 6000-9999' },
    'return=representation,resolution=merge-duplicates');
  assert.ok([200, 201].includes(up.status), JSON.stringify(up.body));
  assert.deepEqual(leaks(up.body), []);
  const seen = await foreign('GET', `profiles?select=*&id=eq.${OWNER}`);
  assert.equal(seen.status, 200);
  assert.deepEqual(leaks(seen.body), []);
  sqlTry(`delete from public.profiles where id = '${OWNER}';`);
});

test('embedding usuarios from another table keeps working, masked', async () => {
  const r = await foreign('GET', 'jugadores?select=id,usuario_id,usuarios(*)&usuario_id=not.is.null&limit=20');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.flatMap((row) => leaks(row.usuarios)), []);
});

test('a direct API read of the private table is refused', async () => {
  const r = await foreign('GET', 'usuarios_private?select=*');
  assert.notEqual(r.status, 200);
});
