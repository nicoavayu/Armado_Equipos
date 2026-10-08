import { updateProfile } from '../services/db/profiles';
import { supabase } from '../lib/supabaseClient';
import { readMyProfile } from '../services/db/publicProfiles';

jest.mock('../lib/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../services/db/publicProfiles', () => ({ readMyProfile: jest.fn(), fetchPublicProfiles: jest.fn() }));

let updates;
beforeEach(() => {
  updates = [];
  supabase.from.mockImplementation(() => ({
    update: (values) => {
      updates.push(values);
      return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'u-1' }, error: null }) }), then: undefined }) };
    },
  }));
  supabase.rpc.mockResolvedValue({ data: null, error: null });
  readMyProfile.mockResolvedValue({ data: { id: 'u-1', telefono: null }, error: null });
});

const clearCalls = () => supabase.rpc.mock.calls.filter(([name]) => name === 'clear_my_profile_fields');

test('emptying phone, birth date or location clears them explicitly', async () => {
  await updateProfile('u-1', { nombre: 'Ana', telefono: '', fecha_nacimiento: null, latitud: null, longitud: null });
  expect(clearCalls()).toEqual([['clear_my_profile_fields', { p_fields: ['telefono', 'fecha_nacimiento', 'ubicacion'] }]]);
});

test('fields that are not sent, or sent with a value, are never cleared', async () => {
  await updateProfile('u-1', { nombre: 'Ana', telefono: '+54 9 11 1234-5678' });
  await updateProfile('u-1', { bio: 'hola' });
  expect(clearCalls()).toEqual([]);
});

test('a backend without the RPC (before 20261010135000) does not fail the save', async () => {
  supabase.rpc.mockImplementation(async (name) => (name === 'clear_my_profile_fields'
    ? { data: null, error: { code: 'PGRST202', message: 'not found' } }
    : { data: null, error: null }));
  await expect(updateProfile('u-1', { telefono: '' })).resolves.toBeTruthy();
});

test('a real clear failure is reported', async () => {
  supabase.rpc.mockImplementation(async (name) => (name === 'clear_my_profile_fields'
    ? { data: null, error: { code: '42501', message: 'not_authenticated' } }
    : { data: null, error: null }));
  await expect(updateProfile('u-1', { telefono: '' })).rejects.toMatchObject({ code: '42501' });
});
