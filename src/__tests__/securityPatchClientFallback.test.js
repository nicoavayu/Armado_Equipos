import { isMissingRpcError, isMissingEdgeFunctionError } from '../utils/backendFallback';

describe('backendFallback — strict feature detection', () => {
  test('isMissingRpcError: true only for PGRST202 (or missing-code canonical message)', () => {
    expect(isMissingRpcError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingRpcError({ message: 'Could not find the function public.foo' })).toBe(true);
  });

  test('isMissingRpcError: false for auth / validation / business / rate-limit / SQL errors', () => {
    expect(isMissingRpcError(null)).toBe(false);
    expect(isMissingRpcError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingRpcError({ code: 'PGRST301' })).toBe(false);
    expect(isMissingRpcError({ code: '23505' })).toBe(false);
    expect(isMissingRpcError({ code: 'P0001', message: 'forbidden' })).toBe(false);
    // a deployed function returning a business error keeps a code -> not "missing"
    expect(isMissingRpcError({ message: 'forbidden' })).toBe(false);
  });

  test('isMissingEdgeFunctionError: true only for HTTP 404', () => {
    expect(isMissingEdgeFunctionError({ status: 404 })).toBe(true);
    expect(isMissingEdgeFunctionError({ context: { status: 404 } })).toBe(true);
    expect(isMissingEdgeFunctionError({ status: 401 })).toBe(false);
    expect(isMissingEdgeFunctionError({ context: { status: 429 } })).toBe(false);
    expect(isMissingEdgeFunctionError(null)).toBe(false);
  });
});

// --- insertNotificationSecure -------------------------------------------------
const mockSupabase = {
  rpc: jest.fn(),
  from: jest.fn(),
};
jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args) => mockSupabase.rpc(...args),
    from: (...args) => mockSupabase.from(...args),
  },
}));

describe('insertNotificationSecure — RPC-first with strict fallback', () => {
  let insertNotificationSecure;
  beforeEach(() => {
    jest.resetModules();
    mockSupabase.rpc.mockReset();
    mockSupabase.from.mockReset();
    // eslint-disable-next-line global-require
    ({ insertNotificationSecure } = require('../utils/notificationHelpers'));
  });

  test('calls create_notification and does NOT insert directly on success', async () => {
    mockSupabase.rpc.mockResolvedValue({ error: null });
    await insertNotificationSecure({
      type: 'friend_accepted',
      recipientId: 'u1',
      context: {},
      legacyRow: { user_id: 'u1', type: 'friend_accepted' },
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_notification', {
      p_type: 'friend_accepted',
      p_recipient_id: 'u1',
      p_context: {},
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  test('falls back to a direct insert ONLY when the RPC is missing (PGRST202)', async () => {
    mockSupabase.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    const insert = jest.fn().mockResolvedValue({ error: null });
    mockSupabase.from.mockReturnValue({ insert });
    await insertNotificationSecure({
      type: 'friend_accepted',
      recipientId: 'u1',
      context: {},
      legacyRow: { user_id: 'u1', type: 'friend_accepted' },
    });
    expect(mockSupabase.from).toHaveBeenCalledWith('notifications');
    expect(insert).toHaveBeenCalledWith([{ user_id: 'u1', type: 'friend_accepted' }]);
  });

  test('does NOT fall back on forbidden/validation errors — surfaces them', async () => {
    mockSupabase.rpc.mockResolvedValue({ error: { code: '42501', message: 'forbidden' } });
    await expect(
      insertNotificationSecure({
        type: 'friend_accepted',
        recipientId: 'u1',
        context: {},
        legacyRow: { user_id: 'u1' },
      }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

// --- uploadGuestVotingPhoto ---------------------------------------------------
const mockInvoke = jest.fn();
jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    functions: { invoke: (...args) => mockInvoke(...args) },
  },
}));
jest.mock('../utils/imageUpload', () => ({
  prepareImageForUpload: jest.fn().mockResolvedValue({ file: { name: 'x.jpg', type: 'image/jpeg' } }),
}));

describe('uploadGuestVotingPhoto — token flow with strict 404 fallback', () => {
  let uploadGuestVotingPhoto;
  beforeEach(() => {
    jest.resetModules();
    mockInvoke.mockReset();
    global.FileReader = class {
      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,AAAA';
        if (this.onload) this.onload();
      }
    };
    // eslint-disable-next-line global-require
    ({ uploadGuestVotingPhoto } = require('../services/votingPhotoUpload'));
  });

  test('issues a token then uploads, returning the server URL', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { token: 'tok' }, error: null })
      .mockResolvedValueOnce({ data: { url: 'https://cdn/x.jpg' }, error: null });
    const url = await uploadGuestVotingPhoto({
      file: {}, codigo: 'ABCD', matchId: 1, playerId: 2, guestSessionId: 'guest_1',
    });
    expect(url).toBe('https://cdn/x.jpg');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'issue-voting-photo-token', {
      body: { codigo: 'ABCD', matchId: 1, playerId: 2, guestSessionId: 'guest_1' },
    });
    expect(mockInvoke.mock.calls[1][0]).toBe('upload-voting-photo');
  });

  test('falls back via onMissing ONLY when an Edge Function is 404', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { context: { status: 404 } } });
    const onMissing = jest.fn().mockResolvedValue('legacy-url');
    const url = await uploadGuestVotingPhoto({
      file: {}, codigo: 'ABCD', matchId: 1, playerId: 2, guestSessionId: 'g', onMissing,
    });
    expect(onMissing).toHaveBeenCalled();
    expect(url).toBe('legacy-url');
  });

  test('does NOT fall back on a 401/validation error — surfaces it', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { context: { status: 401 } } });
    const onMissing = jest.fn();
    await expect(
      uploadGuestVotingPhoto({
        file: {}, codigo: 'ABCD', matchId: 1, playerId: 2, guestSessionId: 'g', onMissing,
      }),
    ).rejects.toBeDefined();
    expect(onMissing).not.toHaveBeenCalled();
  });
});
