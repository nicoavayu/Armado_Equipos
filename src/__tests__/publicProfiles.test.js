const mockRpc = jest.fn();

jest.mock('../lib/supabaseClient', () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
}));

const {
  PRIVATE_PROFILE_FIELDS,
  fetchPublicProfiles,
  searchPublicUsers,
  withApproxLocations,
} = require('../services/db/publicProfiles');

describe('public profile reads (other users never get private columns)', () => {
  beforeEach(() => mockRpc.mockReset());

  test('the private columns are the ones the database no longer exposes', () => {
    expect(PRIVATE_PROFILE_FIELDS).toEqual(['email', 'fecha_nacimiento', 'latitud', 'longitud', 'location_accuracy_m']);
  });

  test('other users\' coordinates come from the ~1 km RPC, merged by id, one call for the list', async () => {
    mockRpc.mockResolvedValue({ data: [{ id: 'u1', latitud: -34.58, longitud: -58.43 }], error: null });
    const rows = await withApproxLocations([
      { id: 'u1', nombre: 'Ana', latitud: -34.5812345 },
      { id: 'u2', nombre: 'Beto' },
      { id: 'u1', nombre: 'Ana repetida' },
    ]);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_usuarios_approx_location', { p_user_ids: ['u1', 'u2'] });
    expect(rows.map((row) => [row.nombre, row.latitud, row.longitud])).toEqual([
      ['Ana', -34.58, -58.43],
      ['Beto', null, null],
      ['Ana repetida', -34.58, -58.43],
    ]);
  });

  test('a failed location lookup keeps the list and drops the coordinates', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const rows = await withApproxLocations([{ id: 'u1', nombre: 'Ana', latitud: -34.5 }]);
    expect(rows).toEqual([{ id: 'u1', nombre: 'Ana', latitud: null, longitud: null }]);
  });

  test('empty inputs never call the backend', async () => {
    expect(await withApproxLocations([])).toEqual([]);
    expect(await fetchPublicProfiles([null, ''])).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('search goes through search_usuarios and surfaces errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: 'u1', nombre: 'Thomas' }], error: null });
    await expect(searchPublicUsers('thomas@example.com', 10)).resolves.toEqual([{ id: 'u1', nombre: 'Thomas' }]);
    expect(mockRpc).toHaveBeenCalledWith('search_usuarios', { p_query: 'thomas@example.com', p_limit: 10 });

    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(searchPublicUsers('thomas', 10)).rejects.toEqual({ message: 'denied' });
  });
});
