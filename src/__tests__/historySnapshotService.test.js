import { ensureParticipantsSnapshot } from '../services/historySnapshotService';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

// Minimal PostgREST-like builder: records every select and answers per table.
const calls = [];
let tables = {};
const builder = (table) => {
  const call = { table, select: null, filters: [], upsert: null };
  calls.push(call);
  const result = () => tables[table](call);
  const chain = {
    select(columns) { call.select = columns; return chain; },
    eq(column, value) { call.filters.push(['eq', column, value]); return chain; },
    in(column, values) { call.filters.push(['in', column, values]); return chain; },
    order() { return chain; },
    maybeSingle() { return Promise.resolve(result()); },
    upsert(payload) { call.upsert = payload; return Promise.resolve({ error: null }); },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
  };
  return chain;
};

const roster = [
  { id: 71, uuid: 'u-71', usuario_id: 'user-sofia', nombre: 'Sofía Ruiz', avatar_url: null, score: 5, is_goalkeeper: false },
  { id: 72, uuid: 'u-72', usuario_id: 'user-diego', nombre: 'Diego Sosa', avatar_url: 'https://cdn/roster-diego.png', score: 5, is_goalkeeper: true },
  { id: 77, uuid: 'u-77', usuario_id: null, nombre: 'Juan Pérez', avatar_url: null, score: 5, is_goalkeeper: false },
];

beforeEach(() => {
  calls.length = 0;
  tables = {
    survey_results: () => ({ data: null, error: null }),
    jugadores: (call) => (String(call.select).includes('foto_url')
      ? { data: null, error: { code: '42703', message: 'column jugadores.foto_url does not exist' } }
      : { data: roster, error: null }),
    usuarios: () => ({ data: [{ id: 'user-sofia', avatar_url: 'https://cdn/profile-sofia.png' }], error: null }),
    partido_team_confirmations: () => ({ data: null, error: null }),
    partidos: () => ({ data: { survey_team_a: ['u-71', 'u-77'], survey_team_b: ['u-72'], teams_source: 'survey' }, error: null }),
  };
  supabase.from.mockImplementation(builder);
});

test('the participants snapshot never asks for jugadores.foto_url', async () => {
  await expect(ensureParticipantsSnapshot(5)).resolves.toEqual({ ok: true, changed: true });
  const rosterReads = calls.filter((call) => call.table === 'jugadores');
  expect(rosterReads).toHaveLength(1);
  expect(rosterReads[0].select).not.toContain('foto_url');
});

test('roster photo first; the public profile photo only for registered players without one', async () => {
  await ensureParticipantsSnapshot(5);
  const profileRead = calls.find((call) => call.table === 'usuarios');
  expect(profileRead.select).toBe('id, avatar_url');
  expect(profileRead.filters).toEqual([['in', 'id', ['user-sofia']]]);

  const { snapshot_participantes: participants } = calls.find((call) => call.upsert).upsert;
  expect(participants.map((player) => [player.id, player.avatar_url])).toEqual([
    [71, 'https://cdn/profile-sofia.png'],
    [72, 'https://cdn/roster-diego.png'],
    [77, null],
  ]);
});

test('no profile read when every roster row has its photo or is a guest', async () => {
  tables.jugadores = () => ({ data: [roster[1], roster[2]], error: null });
  await ensureParticipantsSnapshot(5);
  expect(calls.some((call) => call.table === 'usuarios')).toBe(false);
});

test('a failed profile read keeps the snapshot (photos are optional)', async () => {
  tables.usuarios = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
  await expect(ensureParticipantsSnapshot(5)).resolves.toEqual({ ok: true, changed: true });
});
