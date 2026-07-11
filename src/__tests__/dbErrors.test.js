// Tests for src/services/db/dbErrors.js: an RLS/permission failure with a
// valid session must NOT be disguised as "session expired" — only genuine
// auth problems (no usable JWT) get the re-login message.

let mockAuth = null;

jest.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args) => mockAuth.getSession(...args),
      refreshSession: (...args) => mockAuth.refreshSession(...args),
    },
  },
}));

jest.mock('../utils/logger', () => ({
  error: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
}));

const logger = require('../utils/logger');
const {
  AUTH_REQUIRED_MESSAGE,
  PERMISSION_DENIED_MESSAGE,
  describeDbAccessError,
  getUsableSession,
} = require('../services/db/dbErrors');

const futureSession = () => ({
  access_token: 'token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-1' },
});

describe('describeDbAccessError', () => {
  beforeEach(() => jest.clearAllMocks());

  test('42501 with a session becomes a permission message, not re-login', () => {
    const mapped = describeDbAccessError(
      { code: '42501', message: 'permission denied for table partidos' },
      { operation: 'op', target: 'partidos', userId: 'user-1' },
    );
    expect(mapped.message).toBe(PERMISSION_DENIED_MESSAGE);
    expect(mapped.message).not.toBe(AUTH_REQUIRED_MESSAGE);
  });

  test('RLS violation becomes a permission message and logs the original error', () => {
    const mapped = describeDbAccessError(
      { code: 'PGRST301', message: 'new row violates row-level security policy' },
      { operation: 'createImportedMatch', target: 'jugadores', userId: 'user-1' },
    );
    expect(mapped.message).toBe(PERMISSION_DENIED_MESSAGE);
    expect(logger.error).toHaveBeenCalledWith('[DB_ACCESS] permission error', expect.objectContaining({
      code: 'PGRST301',
      message: expect.stringContaining('row-level security'),
      operation: 'createImportedMatch',
      target: 'jugadores',
      userId: 'user-1',
    }));
  });

  test('not_authenticated / JWT problems still ask for re-login', () => {
    expect(describeDbAccessError({ message: 'not_authenticated' }).message).toBe(AUTH_REQUIRED_MESSAGE);
    expect(describeDbAccessError({ message: 'JWT expired' }).message).toBe(AUTH_REQUIRED_MESSAGE);
  });

  test('unrelated errors pass through untouched', () => {
    const original = new Error('duplicate key value violates unique constraint');
    expect(describeDbAccessError(original)).toBe(original);
  });
});

describe('getUsableSession', () => {
  test('returns null without a stored session', async () => {
    mockAuth = { getSession: async () => ({ data: { session: null } }) };
    expect(await getUsableSession()).toBeNull();
  });

  test('returns the session when it is still valid', async () => {
    const session = futureSession();
    mockAuth = { getSession: async () => ({ data: { session } }) };
    expect(await getUsableSession()).toBe(session);
  });

  test('refreshes an expired session and returns the fresh one', async () => {
    const stale = { ...futureSession(), expires_at: Math.floor(Date.now() / 1000) - 10 };
    const fresh = futureSession();
    mockAuth = {
      getSession: async () => ({ data: { session: stale } }),
      refreshSession: async () => ({ data: { session: fresh }, error: null }),
    };
    expect(await getUsableSession()).toBe(fresh);
  });

  test('returns null when the refresh fails', async () => {
    const stale = { ...futureSession(), expires_at: Math.floor(Date.now() / 1000) - 10 };
    mockAuth = {
      getSession: async () => ({ data: { session: stale } }),
      refreshSession: async () => ({ data: { session: null }, error: { message: 'refresh_token_not_found' } }),
    };
    expect(await getUsableSession()).toBeNull();
  });
});
