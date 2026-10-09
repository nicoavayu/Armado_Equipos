// 20261010134000: a match created from a frequent template keeps the link (so its history
// is not empty), only to the organizer's own template; and confirming teams no longer
// sends a column partido_team_confirmations does not have. Through the real API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { API, config, root } from '../lab.mjs';

const qa = JSON.parse(await readFile(`${root}.runtime/qa-users.json`, 'utf8'));
const c = await config();
const signIn = async (key) => {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: c.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${key}@arma2.lab`, password: qa.passwords[key] }),
  });
  if (!r.ok) throw new Error(`sign-in ${key}: ${r.status}`);
  return (await r.json()).access_token;
};
const rest = (token) => async (method, path, body) => {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: { apikey: c.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

const organizer = rest(await signIn('organizador'));
const other = rest(await signIn('jugador1'));
const ORGANIZER_ID = qa.ids.organizador;
const OTHER_ID = qa.ids.jugador1;

const template = async (api, ownerId, nombre) => {
  const r = await api('POST', 'partidos_frecuentes', { nombre, usuario_id: ownerId, creado_por: ownerId, hora: '21:00', sede: 'Lab', modalidad: 'F5', cupo_jugadores: 10 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body[0].id;
};
const match = (templateId) => organizer('POST', 'partidos?select=id,template_id', {
  nombre: 'Lab template link', fecha: '2026-12-01', hora: '21:00', sede: 'Lab', modalidad: 'F5', cupo_jugadores: 10,
  tipo_partido: 'Masculino', creado_por: ORGANIZER_ID, codigo: `TL${Date.now().toString(16).slice(-6)}`, template_id: templateId,
});

test('API: creating from your own template keeps the link and the history lists it', async () => {
  const own = await template(organizer, ORGANIZER_ID, 'Lab propia');
  const created = await match(own);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body[0].template_id, own);
  const history = await organizer('GET', `partidos?select=id&template_id=eq.${own}`);
  assert.deepEqual(history.body.map((row) => row.id), [created.body[0].id]);
  await organizer('DELETE', `partidos?id=eq.${created.body[0].id}`);
  await organizer('DELETE', `partidos_frecuentes?id=eq.${own}`);
});

test('API: pointing a match to someone else\'s template is cleared, not stored', async () => {
  const foreign = await template(other, OTHER_ID, 'Lab ajena');
  const created = await match(foreign);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body[0].template_id, null);
  await organizer('DELETE', `partidos?id=eq.${created.body[0].id}`);
  await other('DELETE', `partidos_frecuentes?id=eq.${foreign}`);
});

test('API: the team confirmation payload passes the column check (no template_id)', async () => {
  const r = await organizer('POST', 'partido_team_confirmations?on_conflict=partido_id', {
    partido_id: 999999, confirmed_by: null, participants: [], team_a: [], team_b: [], teams_json: null,
  });
  // Not PGRST204 (unknown column): it reaches the row rules, which reject a match the caller does not run.
  assert.notEqual(r.body?.code, 'PGRST204', JSON.stringify(r.body));
});

test('API: creating a match needs creado_por (the "Usar plantilla" modal did not send it)', async () => {
  const r = await organizer('POST', 'partidos?select=id', {
    nombre: 'Lab sin creador', fecha: '2026-12-02', hora: '21:00', sede: 'Lab', modalidad: 'F5', cupo_jugadores: 10,
    tipo_partido: 'Masculino', codigo: `TN${Date.now().toString(16).slice(-6)}`,
  });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body?.code, '42501');
});
