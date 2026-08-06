// Contrato del RPC de "Dejar de buscar" del lado del cliente.
//
// La migración 20260806120000 conserva intacta la firma pública de
// `cancel_my_availability()` (sin argumentos, returns void) y agrega
// `cancel_my_availability_detailed()` con los contadores. Este cliente pide el
// detallado y cae al histórico si el backend todavía no tiene la migración.

const mockRpc = jest.fn();
const mockGetSession = jest.fn();
const mockDispatch = jest.fn();

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    auth: { getSession: (...args) => mockGetSession(...args) },
  },
}));

jest.mock('../services/pushDispatchService', () => ({
  requestImmediatePushDispatchSafe: (...args) => mockDispatch(...args),
}));

// eslint-disable-next-line import/first
import { cancelMyAvailability } from '../services/db/availability';

const COUNTERS = {
  availability_cancelled: 1,
  gestation_memberships_released: 2,
  created_invites_withdrawn: 1,
  created_memberships_kept: 3,
};

// La config de jest de CRA usa resetMocks: true, así que las implementaciones
// se vuelven a poner en cada test.
beforeEach(() => {
  mockGetSession.mockImplementation(async () => ({
    data: { session: { user: { id: 'me' }, access_token: 'token', expires_at: 4102444800 } },
    error: null,
  }));
  mockDispatch.mockImplementation(async () => {});
});

describe('cancelMyAvailability()', () => {
  test('pide el RPC con contadores y los normaliza', async () => {
    mockRpc.mockResolvedValue({ data: [COUNTERS], error: null });

    const result = await cancelMyAvailability();

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('cancel_my_availability_detailed');
    expect(result).toEqual({
      availabilityCancelled: 1,
      gestationMembershipsReleased: 2,
      createdInvitesWithdrawn: 1,
      createdMembershipsKept: 3,
    });
  });

  test('acepta también una fila suelta, no sólo un array', async () => {
    mockRpc.mockResolvedValue({ data: COUNTERS, error: null });
    await expect(cancelMyAvailability()).resolves.toMatchObject({ createdMembershipsKept: 3 });
  });

  test.each([
    ['PGRST202', 'Could not find the function public.cancel_my_availability_detailed'],
    [undefined, 'function public.cancel_my_availability_detailed() does not exist'],
  ])('cae al contrato histórico cuando el backend no tiene el RPC nuevo (code=%s)', async (code, message) => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code, message } })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await cancelMyAvailability();

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'cancel_my_availability_detailed');
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'cancel_my_availability');
    // El RPC void no devuelve contadores: todo en cero, y la baja igual sirvió.
    expect(result).toEqual({
      availabilityCancelled: 0,
      gestationMembershipsReleased: 0,
      createdInvitesWithdrawn: 0,
      createdMembershipsKept: 0,
    });
  });

  test('un error real NO dispara el fallback: se propaga', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for function cancel_my_availability_detailed' },
    });

    await expect(cancelMyAvailability()).rejects.toThrow();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  test('si el fallback también falla, el error se propaga', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });

    await expect(cancelMyAvailability()).rejects.toThrow();
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  test('valores no numéricos o negativos se normalizan a cero', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        availability_cancelled: 'no es un número',
        gestation_memberships_released: -4,
        created_invites_withdrawn: null,
        created_memberships_kept: '2',
      }],
      error: null,
    });

    await expect(cancelMyAvailability()).resolves.toEqual({
      availabilityCancelled: 0,
      gestationMembershipsReleased: 0,
      createdInvitesWithdrawn: 0,
      createdMembershipsKept: 2,
    });
  });
});
