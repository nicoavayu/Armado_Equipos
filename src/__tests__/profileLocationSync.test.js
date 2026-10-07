const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockSingle = jest.fn();

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { updateProfile } = require('../services/db/profiles');

describe('profile location auto-match sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSingle.mockResolvedValue({
      data: {
        id: 'user-123',
        latitud: -34.6037347,
        longitud: -58.3815704,
      },
      error: null,
    });
    mockSelect.mockReturnValue({ single: mockSingle });
    mockEq.mockReturnValue({ select: mockSelect });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });
    // The saved row comes back through get_my_profile() (private columns are not
    // readable through the table); the location sync is the other RPC.
    mockRpc.mockImplementation((name) => {
      if (name === 'get_my_profile') {
        return {
          single: async () => ({
            data: { id: 'user-123', latitud: -34.6037347, longitud: -58.3815704 },
            error: null,
          }),
        };
      }
      return Promise.resolve({ data: { id: 88 }, error: null });
    });
  });

  test('actualiza la búsqueda existente mediante el sync in-place sin crear otra disponibilidad', async () => {
    await updateProfile('user-123', {
      latitud: -34.6037347,
      longitud: -58.3815704,
      location_updated_at: '2026-07-14T12:00:00.000Z',
    });

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('usuarios');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockEq).toHaveBeenCalledWith('id', 'user-123');
    expect(mockSelect).toHaveBeenCalledWith('id');
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith('get_my_profile');
    expect(mockRpc).toHaveBeenCalledWith('sync_my_auto_match_location_from_profile');
    expect(mockFrom).not.toHaveBeenCalledWith('player_availability');
  });
});
