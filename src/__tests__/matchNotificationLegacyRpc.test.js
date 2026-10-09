/**
 * Core Production has enqueue_partido_notification / enqueue_match_participant_notification
 * (checked server-side since 20261010145000) but not their *_as_actor variants. When the
 * *_as_actor RPC is missing (PGRST202) the client must call the legacy name, not fall through
 * to a direct cross-user insert into notifications, which Production's RLS refuses (403) — that
 * is how the organizer stopped being told that a player accepted a private invite.
 */
import { rpcWithLegacyName } from '../utils/backendFallback';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: (...args) => mockFrom(...args),
  },
}));
jest.mock('../services/pushDispatchService', () => ({
  requestImmediatePushDispatch: jest.fn().mockResolvedValue({ ok: true }),
}));

const missing = { code: 'PGRST202', message: 'Could not find the function public.enqueue_partido_notification_as_actor' };

describe('rpcWithLegacyName', () => {
  test('uses the first RPC when it exists', async () => {
    const client = { rpc: jest.fn().mockResolvedValue({ data: { ok: true }, error: null }) };
    const result = await rpcWithLegacyName(client, 'a_as_actor', 'a', { p: 1 });
    expect(result.data).toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('a_as_actor', { p: 1 });
  });

  test('calls the legacy name with the same arguments only when the first is missing', async () => {
    const client = {
      rpc: jest.fn()
        .mockResolvedValueOnce({ data: null, error: missing })
        .mockResolvedValueOnce({ data: { recipients_count: 2 }, error: null }),
    };
    const result = await rpcWithLegacyName(client, 'a_as_actor', 'a', { p: 1 });
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'a', { p: 1 });
    expect(result).toEqual({ data: { recipients_count: 2 }, error: null });
  });

  test('never retries on a real answer (403, business or SQL error)', async () => {
    for (const error of [{ code: '42501', message: 'permission denied' }, { code: 'P0001', message: 'forbidden' }, { code: '23505' }]) {
      const client = { rpc: jest.fn().mockResolvedValue({ data: null, error }) };
      // eslint-disable-next-line no-await-in-loop
      const result = await rpcWithLegacyName(client, 'a_as_actor', 'a', {});
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(result.error).toBe(error);
    }
  });
});

describe('join notifications on Core Production (no *_as_actor)', () => {
  let notifyAdminPlayerJoined;
  let notifyAdminJoinRequest;
  beforeEach(() => {
    jest.resetModules();
    mockRpc.mockReset();
    mockFrom.mockReset();
    mockRpc.mockImplementation(async (name) => (
      name.endsWith('_as_actor') ? { data: null, error: missing } : { data: { ok: true, recipients_count: 2 }, error: null }
    ));
    // eslint-disable-next-line global-require
    ({ notifyAdminPlayerJoined, notifyAdminJoinRequest } = require('../services/matchJoinNotificationService'));
  });

  test('a player who accepted an invite tells the roster through enqueue_match_participant_notification', async () => {
    const result = await notifyAdminPlayerJoined({ matchId: 42, playerName: 'Jugador', playerUserId: 'u-1' });
    expect(result.ok).toBe(true);
    const names = mockRpc.mock.calls.map(([name]) => name);
    expect(names).toEqual(['enqueue_match_participant_notification_as_actor', 'enqueue_match_participant_notification']);
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_partido_id: 42, p_type: 'match_update', p_exclude_user_id: 'u-1', p_include_admin: true });
    expect(mockFrom).not.toHaveBeenCalledWith('notifications');
  });

  test('a requester tells the organizer through enqueue_partido_notification', async () => {
    await notifyAdminJoinRequest({ matchId: 42, playerName: 'Jugador', playerUserId: 'u-2', adminUserId: 'org-1' });
    const names = mockRpc.mock.calls.map(([name]) => name);
    expect(names.slice(0, 2)).toEqual(['enqueue_partido_notification_as_actor', 'enqueue_partido_notification']);
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_partido_id: 42, p_type: 'match_join_request' });
    expect(mockFrom).not.toHaveBeenCalledWith('notifications');
  });
});
