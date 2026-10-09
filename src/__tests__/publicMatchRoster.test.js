import { fetchPublicMatchRoster } from '../services/db/publicMatch';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const tableReturning = (rows, count) => {
  const eq = jest.fn().mockResolvedValue({ data: rows, count });
  const select = jest.fn(() => ({ eq }));
  supabase.from.mockReturnValue({ select });
  return { select, eq };
};

describe('fetchPublicMatchRoster (20261010140000)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the published roster through get_public_match_roster, without touching the table', async () => {
    const rows = [{ id: 1, nombre: 'Lucía', has_account: true, is_me: false }, { id: 2, nombre: 'Invitado', has_account: false, is_me: false }];
    supabase.rpc.mockResolvedValue({ data: rows, error: null });
    await expect(fetchPublicMatchRoster('42')).resolves.toEqual({ jugadores: rows, count: 2 });
    expect(supabase.rpc).toHaveBeenCalledWith('get_public_match_roster', { p_partido_id: 42 });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('falls back to the table on a backend without the RPC', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    const { eq } = tableReturning([{ id: 7, usuario_id: 'u1' }], 1);
    await expect(fetchPublicMatchRoster(42)).resolves.toEqual({ jugadores: [{ id: 7, usuario_id: 'u1' }], count: 1 });
    expect(supabase.from).toHaveBeenCalledWith('jugadores');
    expect(eq).toHaveBeenCalledWith('partido_id', 42);
  });

  it('falls back to the table when the RPC call itself fails', async () => {
    supabase.rpc.mockRejectedValue(new Error('network'));
    tableReturning([], null);
    await expect(fetchPublicMatchRoster(5)).resolves.toEqual({ jugadores: [], count: 0 });
  });
});
