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
    // Notifications now route through the secure create_notification RPC
    // (server-generated content); no direct client insert.
    expect(mockInsertCalls).toHaveLength(0);
    const notifCalls = mockRpc.mock.calls.filter((c) => c[0] === 'create_notification');
    expect(notifCalls).toHaveLength(1);
    expect(notifCalls[0][1].p_type).toBe('payment_reported');
    expect(notifCalls[0][1].p_recipient_id).toBe('admin-uuid');
    expect(notifCalls[0][1].p_context).toEqual({ match_id: 123 });
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
    // One secure create_notification RPC per pending recipient; no direct insert.
    expect(mockInsertCalls).toHaveLength(0);
    const notifCalls = mockRpc.mock.calls.filter((c) => c[0] === 'create_notification');
    expect(notifCalls).toHaveLength(2);
    expect(notifCalls[0][1].p_type).toBe('payment_reminder');
    expect(notifCalls.map((c) => c[1].p_recipient_id).sort()).toEqual(['u1', 'u2']);
  });

  test('inserts nothing when there are no pending recipients', async () => {
    mockRpc = jest.fn().mockResolvedValue({ data: [], error: null });
    const res = await adminRemindPending(123, { matchName: 'X' });
    expect(res.notified).toBe(0);
    expect(mockInsertCalls).toHaveLength(0);
  });

  test('never reminds/pushes the admin running the action (no self-reminder)', async () => {
    mockUserId = 'admin-uuid';
    mockRpc = jest.fn().mockResolvedValue({
      data: [
        { user_id: 'admin-uuid', player_name: 'Admin' },
        { user_id: 'u2', player_name: 'Fede' },
      ],
      error: null,
    });
    const res = await adminRemindPending(123, { matchName: 'X' });
    expect(res.notified).toBe(1);
    expect(mockInsertCalls).toHaveLength(0);
    const notifCalls = mockRpc.mock.calls.filter((c) => c[0] === 'create_notification');
    expect(notifCalls).toHaveLength(1);
    expect(notifCalls[0][1].p_recipient_id).toBe('u2');
    expect(notifCalls.some((c) => c[1].p_recipient_id === 'admin-uuid')).toBe(false);
  });

  test('inserts nothing when the only pending recipient is the admin themselves', async () => {
    mockUserId = 'admin-uuid';
    mockRpc = jest.fn().mockResolvedValue({
      data: [{ user_id: 'admin-uuid', player_name: 'Admin' }],
      error: null,
    });
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
