import { PARTIDO_SELECT, fetchMatchAccessCode, fetchMatchAccessCodes } from '../services/db/matchAccessCode';
import { supabase } from '../lib/supabaseClient';

jest.mock('../lib/supabaseClient', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const legacyQuery = (result) => {
  const query = { select: jest.fn(() => query), in: jest.fn(() => Promise.resolve(result)) };
  return query;
};

afterEach(() => jest.clearAllMocks());

test('reads of partidos select every column the database has (Production\'s partidos differs from the repository\'s)', () => {
  // A named column that one schema lacks fails the whole read (42703); see coreProductionSchemaCompat.test.js.
  expect(PARTIDO_SELECT).toBe('*');
});

test('codes come from the server, only for the matches the account belongs to', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: [{ partido_id: 5, codigo: 'ABC123' }], error: null });
  const codes = await fetchMatchAccessCodes([5, '7', 5, null, -1]);
  expect(supabase.rpc).toHaveBeenCalledWith('get_match_access_codes', { p_partido_ids: [5, 7] });
  expect(Array.from(codes.entries())).toEqual([[5, 'ABC123']]);
  expect(supabase.from).not.toHaveBeenCalled();
});

test('a match the account does not belong to has no code', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(fetchMatchAccessCode(9)).resolves.toBeNull();
});

test('a backend without the RPC falls back to the previous read', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
  const query = legacyQuery({ data: [{ id: 5, codigo: 'ABC123' }], error: null });
  supabase.from.mockReturnValueOnce(query);
  await expect(fetchMatchAccessCode(5)).resolves.toBe('ABC123');
  expect(supabase.from).toHaveBeenCalledWith('partidos');
  expect(query.select).toHaveBeenCalledWith('id, codigo');
});

test('other errors surface; nothing is called without ids', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
  await expect(fetchMatchAccessCodes([5])).rejects.toMatchObject({ code: '42501' });
  await expect(fetchMatchAccessCodes([])).resolves.toEqual(new Map());
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});
