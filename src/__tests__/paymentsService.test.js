let mockRpc = jest.fn();
let mockInsertCalls = [];
let mockInsertResult = { error: null };
let mockUserId = 'me-uuid';

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: () => ({
      insert: (payload) => { mockInsertCalls.push(payload); return Promise.resolve(mockInsertResult); },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: mockUserId } } }) },
  },
}));

const {
  reportMyPayment,
  adminRemindPending,
  adminSetPaymentStatus,
  adminClosePayments,
} = require('../services/db/payments');

beforeEach(() => {
  mockRpc = jest.fn();
  mockInsertCalls = [];
  mockInsertResult = { error: null };
  mockUserId = 'me-uuid';
});

describe('reportMyPayment', () => {
  test('calls RPC then notifies the admin', async () => {
    mockRpc = jest.fn().mockResolvedValue({ error: null });
    await reportMyPayment(123, { matchName: 'Fútbol jueves', reporterName: 'Juan', adminUserId: 'admin-uuid' });

    expect(mockRpc).toHaveBeenCalledWith('report_my_payment', { p_partido_id: 123 });
    expect(mockInsertCalls).toHaveLength(1);
    const notif = mockInsertCalls[0];
    expect(notif.user_id).toBe('admin-uuid');
    expect(notif.type).toBe('payment_reported');
    expect(notif.data.link).toBe('/pagos/123');
    expect(notif.message).toContain('Juan');
    expect(notif.message).toContain('Fútbol jueves');
  });

  test('does not notify when the caller is the admin', async () => {
    mockRpc = jest.fn().mockResolvedValue({ error: null });
    mockUserId = 'admin-uuid';
    await reportMyPayment(123, { matchName: 'X', reporterName: 'Y', adminUserId: 'admin-uuid' });
    expect(mockInsertCalls).toHaveLength(0);
  });

  test('throws when the RPC fails and skips notifications', async () => {
    mockRpc = jest.fn().mockResolvedValue({ error: { message: 'no_payment_row_or_locked' } });
    await expect(reportMyPayment(123, { matchName: 'X', adminUserId: 'admin-uuid' })).rejects.toBeTruthy();
    expect(mockInsertCalls).toHaveLength(0);
  });
});

describe('adminRemindPending', () => {
  test('notifies only the pending recipients returned by the RPC', async () => {
    mockRpc = jest.fn().mockResolvedValue({
      data: [
        { user_id: 'u1', player_name: 'Juan' },
        { user_id: 'u2', player_name: 'Fede' },
      ],
      error: null,
    });
    const res = await adminRemindPending(123, { matchName: 'Fútbol jueves' });

    expect(mockRpc).toHaveBeenCalledWith('admin_remind_pending_payments', { p_partido_id: 123 });
    expect(res.notified).toBe(2);
    expect(mockInsertCalls).toHaveLength(1);
    const payload = mockInsertCalls[0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(2);
    expect(payload[0].type).toBe('payment_reminder');
    expect(payload[0].data.link).toBe('/pagos/123');
    expect(payload[0].message).toContain('Fútbol jueves');
  });

  test('inserts nothing when there are no pending recipients', async () => {
    mockRpc = jest.fn().mockResolvedValue({ data: [], error: null });
    const res = await adminRemindPending(123, { matchName: 'X' });
    expect(res.notified).toBe(0);
    expect(mockInsertCalls).toHaveLength(0);
  });

  test('throws when the RPC fails', async () => {
    mockRpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'not_match_admin' } });
    await expect(adminRemindPending(123, { matchName: 'X' })).rejects.toBeTruthy();
  });
});

describe('admin mutations', () => {
  test('adminSetPaymentStatus passes jugador + status to the RPC', async () => {
    mockRpc = jest.fn().mockResolvedValue({ error: null });
    await adminSetPaymentStatus(123, 55, 'paid');
    expect(mockRpc).toHaveBeenCalledWith('admin_set_payment_status', { p_partido_id: 123, p_jugador_id: 55, p_status: 'paid' });
  });

  test('adminClosePayments forwards the force flag', async () => {
    mockRpc = jest.fn().mockResolvedValue({ error: null });
    await adminClosePayments(123, { force: true });
    expect(mockRpc).toHaveBeenCalledWith('admin_close_payments', { p_partido_id: 123, p_force: true });
  });
});
