const mockRpc = jest.fn();
const mockGetSession = jest.fn();

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    auth: { getSession: (...args) => mockGetSession(...args) },
  },
}));

jest.mock('../services/pushDispatchService', () => ({
  requestImmediatePushDispatchSafe: jest.fn(),
}));

// eslint-disable-next-line import/first
import { setMyGlobalAvailability } from '../services/db/availability';

beforeEach(() => {
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: 'actor' }, access_token: 'token', expires_at: 4102444800 } },
    error: null,
  });
});

describe('setMyGlobalAvailability()', () => {
  test.each([true, false])('uses the single global availability RPC for %s', async (enabled) => {
    mockRpc.mockResolvedValue({ data: { enabled }, error: null });

    await expect(setMyGlobalAvailability(enabled)).resolves.toEqual({ enabled });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('set_my_global_availability', {
      p_enabled: enabled,
    });
  });

  test('propagates a real RPC failure without independent fallback writes', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    await expect(setMyGlobalAvailability(false)).rejects.toThrow();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
