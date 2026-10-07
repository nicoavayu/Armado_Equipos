const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: (...args) => mockFrom(...args),
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
  },
}));

const chain = (result) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    ilike: jest.fn(() => builder),
    neq: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    single: jest.fn(async () => result),
    maybeSingle: jest.fn(async () => result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
};

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
}));

const {
  PRIVATE_PROFILE_FIELDS,
  fetchPublicProfiles,
  readMyProfile,
  searchPublicUsers,
  withApproxLocations,
} = require('../services/db/publicProfiles');

const MISSING_RPC = { code: 'PGRST202', message: 'Could not find the function' };

describe('public profile reads (other users never get private columns)', () => {
  beforeEach(() => { mockRpc.mockReset(); mockFrom.mockReset(); });

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

  test('before phase A exists in the backend, the own profile is read from the table as before', async () => {
    mockRpc.mockReturnValue(chain({ data: null, error: MISSING_RPC }));
    const ownRow = chain({ data: { id: 'me', email: 'me@example.com' }, error: null });
    mockFrom.mockReturnValue(ownRow);

    await expect(readMyProfile({ columns: 'email', single: true })).resolves.toEqual({ data: { id: 'me', email: 'me@example.com' }, error: null });
    expect(mockFrom).toHaveBeenCalledWith('usuarios');
    expect(ownRow.eq).toHaveBeenCalledWith('id', 'me');
  });

  test('with phase A, a permission error is not hidden behind the table fallback', async () => {
    mockRpc.mockReturnValue(chain({ data: null, error: { code: '42501', message: 'permission denied' } }));
    const result = await readMyProfile({ single: true });
    expect(result.error).toEqual({ code: '42501', message: 'permission denied' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('before phase A, others\' profiles drop the private keys and search is by name only', async () => {
    mockRpc.mockResolvedValue({ data: null, error: MISSING_RPC });
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 'u1', nombre: 'Ana', email: 'a@x.com', latitud: -34.5 }], error: null }));
    await expect(fetchPublicProfiles(['u1'])).resolves.toEqual([{ id: 'u1', nombre: 'Ana' }]);

    const searchQuery = chain({ data: [{ id: 'u2', nombre: 'Thomas' }], error: null });
    mockFrom.mockReturnValueOnce(searchQuery);
    await expect(searchPublicUsers('thom', 10)).resolves.toEqual([{ id: 'u2', nombre: 'Thomas' }]);
    expect(searchQuery.select.mock.calls[0][0]).not.toMatch(/email/);
    expect(searchQuery.ilike).toHaveBeenCalledWith('nombre', '%thom%');
    expect(searchQuery.neq).toHaveBeenCalledWith('id', 'me');
  });
});
