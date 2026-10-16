// «Cerrar sesión» → sign in as another account: nothing of the previous account may remain.
//   • logout order: push token deactivation → Supabase signOut → Sentry user cleared → Torneos account keys removed
//   • exactly the Torneos account-scoped keys are removed (no storage.clear(), device preferences survive)
//   • a storage failure never blocks the logout (Spanish notice, success kept)
//   • the Torneos gateway bridge bearer of account A is dropped on SIGNED_OUT and account B gets a fresh exchange
const mockSignOut = jest.fn();
const mockRemoveSession = jest.fn();
const mockDeactivate = jest.fn();
const mockClearSentryUser = jest.fn();
const mockCallOrder = [];

jest.mock('../services/api/supabase', () => ({
  supabase: {
    auth: {
      signOut: (...args) => mockSignOut(...args),
      _removeSession: (...args) => mockRemoveSession(...args),
    },
  },
}));

jest.mock('../services/pushTokenService', () => ({
  deactivateCurrentDevicePushToken: (...args) => mockDeactivate(...args),
}));

jest.mock('../utils/monitoring/sentry', () => ({
  clearSentryUser: (...args) => mockClearSentryUser(...args),
}));

jest.mock('../lib/coreSupabaseClient', () => ({ coreSupabase: null }));

const {
  TORNEOS_ACCOUNT_STORAGE_KEYS,
  clearAccountScopedLocalState,
  clearLocalAuthSession,
  getLogoutErrorMessage,
  signOutWithPushDeactivation,
} = require('../services/authLogoutService');
const { PREMIUM_INTENT_STORAGE_KEY } = require('../features/torneos/domain/premiumIntent');
const { createTorneosTransport } = require('../features/torneos/foundation/torneosTransport');
const { createCoreSessionBridge } = require('../features/torneos/stagingV1/coreSessionBridge');

const WORKSPACE_KEY = 'arma2:torneos:last-workspace:v2';
const DEVICE_PREFERENCES = {
  'arma2:torneos:home-view:v1': 'list',
  'arma2:torneos:app-callout-dismissed:v1': '1',
};
const OTHER_APP_KEY = 'sb-core-auth-token-owned-by-supabase';

const seedAccountA = () => {
  window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
    workspaceType: 'tournament_organization',
    activeOrganizationId: 'org-of-account-a',
  }));
  window.sessionStorage.setItem(PREMIUM_INTENT_STORAGE_KEY, 'premium');
  Object.entries(DEVICE_PREFERENCES).forEach(([key, value]) => window.localStorage.setItem(key, value));
  window.localStorage.setItem(OTHER_APP_KEY, 'untouched-by-this-module');
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockCallOrder.length = 0;
  [mockSignOut, mockRemoveSession, mockDeactivate, mockClearSentryUser].forEach((mock) => mock.mockReset());
  mockDeactivate.mockImplementation(async () => { mockCallOrder.push('push'); return { success: true }; });
  mockSignOut.mockImplementation(async () => { mockCallOrder.push('supabase.signOut'); return { error: null }; });
  mockRemoveSession.mockImplementation(async () => { mockCallOrder.push('supabase.removeSession'); });
  mockClearSentryUser.mockImplementation(() => { mockCallOrder.push('sentry'); });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Torneos account-scoped keys', () => {
  test('the exact key list, pinned to the Torneos modules that own them', () => {
    expect(TORNEOS_ACCOUNT_STORAGE_KEYS).toEqual([
      { storage: 'localStorage', key: 'arma2:torneos:last-workspace:v2' },
      { storage: 'sessionStorage', key: 'arma2:torneos:premium-intent:v1' },
    ]);
    expect(PREMIUM_INTENT_STORAGE_KEY).toBe('arma2:torneos:premium-intent:v1');
    // TorneosWorkspaceContext.jsx is a React module with service imports; its key is pinned by source text.
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../features/torneos/context/TorneosWorkspaceContext.jsx'), 'utf8');
    expect(source).toContain(`export const TORNEOS_WORKSPACE_STORAGE_KEY = '${WORKSPACE_KEY}';`);
  });
});

describe('signOutWithPushDeactivation', () => {
  test('order: push → Supabase signOut → Sentry → Torneos keys; only those keys go', async () => {
    seedAccountA();
    const realRemoveItem = Storage.prototype.removeItem;
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function removeItem(key) {
      mockCallOrder.push(`remove:${key}`);
      return realRemoveItem.call(this, key);
    });

    const result = await signOutWithPushDeactivation({ reason: 'user_logout' });

    expect(result).toEqual(expect.objectContaining({ success: true, localCleanup: { success: true } }));
    expect(mockCallOrder).toEqual([
      'push',
      'supabase.signOut',
      'sentry',
      'remove:arma2:torneos:last-workspace:v2',
      'remove:arma2:torneos:premium-intent:v1',
    ]);
    expect(mockSignOut).toHaveBeenCalledWith();
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(PREMIUM_INTENT_STORAGE_KEY)).toBeNull();
    Object.entries(DEVICE_PREFERENCES).forEach(([key, value]) => {
      expect(window.localStorage.getItem(key)).toBe(value);
    });
    expect(window.localStorage.getItem(OTHER_APP_KEY)).toBe('untouched-by-this-module');
  });

  test('the Torneos keys are removed only after Supabase signOut resolved', async () => {
    seedAccountA();
    mockSignOut.mockImplementation(async () => {
      mockCallOrder.push('supabase.signOut');
      // Still signed in while Supabase works: the account state is still there.
      expect(window.localStorage.getItem(WORKSPACE_KEY)).not.toBeNull();
      return { error: null };
    });
    await signOutWithPushDeactivation();
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBeNull();
  });

  test('a failed Supabase signOut keeps the session and its Torneos state, with the Spanish error', async () => {
    seedAccountA();
    mockSignOut.mockResolvedValue({ error: new Error('network down') });

    const result = await signOutWithPushDeactivation({ force: true });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('signout_failed');
    expect(getLogoutErrorMessage(result)).toBe('No se pudo cerrar sesión (network down).');
    expect(window.localStorage.getItem(WORKSPACE_KEY)).not.toBeNull();
    expect(mockClearSentryUser).not.toHaveBeenCalled();
  });

  test('a storage that refuses never blocks the logout: success kept, Spanish notice, nothing thrown', async () => {
    seedAccountA();
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const result = await signOutWithPushDeactivation();

    expect(result.success).toBe(true);
    expect(result.localCleanup).toEqual({
      success: false,
      failedKeys: ['arma2:torneos:last-workspace:v2', 'arma2:torneos:premium-intent:v1'],
      message: 'Cerraste sesión, pero no pudimos limpiar algunos datos locales de Torneos en este dispositivo.',
    });
    expect(getLogoutErrorMessage(result)).toBe('');
  });

  test('never calls storage.clear()', async () => {
    seedAccountA();
    const clearSpy = jest.spyOn(Storage.prototype, 'clear');
    await signOutWithPushDeactivation();
    await clearLocalAuthSession();
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe('clearLocalAuthSession (local-only sign-out)', () => {
  test('removes the local Supabase session, then the Torneos account keys', async () => {
    seedAccountA();
    const result = await clearLocalAuthSession();
    expect(result).toEqual({ success: true, localCleanup: { success: true } });
    expect(mockCallOrder).toEqual(['supabase.removeSession', 'sentry']);
    expect(window.localStorage.getItem(WORKSPACE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(PREMIUM_INTENT_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem('arma2:torneos:home-view:v1')).toBe('list');
  });

  test('a failure keeps the Torneos keys', async () => {
    seedAccountA();
    mockRemoveSession.mockRejectedValue(new Error('locked'));
    const result = await clearLocalAuthSession();
    expect(result).toEqual(expect.objectContaining({ success: false, reason: 'signout_failed' }));
    expect(window.localStorage.getItem(WORKSPACE_KEY)).not.toBeNull();
  });
});

describe('clearAccountScopedLocalState', () => {
  test('is idempotent when nothing is stored', () => {
    expect(clearAccountScopedLocalState()).toEqual({ success: true });
    expect(clearAccountScopedLocalState()).toEqual({ success: true });
  });
});

describe('user switch A → logout → B on the Torneos gateway bridge', () => {
  const makeFakeCore = () => {
    let session = null;
    const listeners = new Set();
    return {
      setSession(next) { session = next; },
      emit(event) { listeners.forEach((listener) => listener(event, session)); },
      client: {
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
          onAuthStateChange: (listener) => {
            listeners.add(listener);
            return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
          },
        },
      },
    };
  };
  const jsonResponse = (status, body) => ({
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
  });

  test('A’s bearer is dropped on SIGNED_OUT, nothing is sent without a session, and B gets a fresh exchange', async () => {
    const core = makeFakeCore();
    const calls = [];
    const fetchImpl = jest.fn(async (url, init) => {
      calls.push({ path: new URL(url).pathname, authorization: init.headers.Authorization });
      if (url.endsWith('/exchange')) {
        const coreToken = init.headers.Authorization.replace('Bearer ', '');
        return jsonResponse(200, { access_token: `bridge-for-${coreToken}`, token_type: 'Bearer', expires_in: 300 });
      }
      return jsonResponse(200, { ok: true });
    });
    const bridge = createCoreSessionBridge(core.client, { now: () => 0 });
    const transport = createTorneosTransport({
      gatewayUrl: 'https://gateway.example.test',
      getCoreAccessToken: bridge.getCoreAccessToken,
      onCoreAuthChange: bridge.onCoreAuthChange,
      fetchImpl,
      now: () => 0,
    });

    core.setSession({ access_token: 'core-a', expires_at: 3600, user: { id: 'user-a' } });
    core.emit('INITIAL_SESSION');
    await transport.rpc('get_my_workspace_context');
    await transport.rpc('get_my_workspace_context');
    expect(calls.map((call) => [call.path, call.authorization])).toEqual([
      ['/exchange', 'Bearer core-a'],
      ['/torneos/rest/v1/rpc/get_my_workspace_context', 'Bearer bridge-for-core-a'],
      ['/torneos/rest/v1/rpc/get_my_workspace_context', 'Bearer bridge-for-core-a'],
    ]);

    // «Cerrar sesión»
    core.setSession(null);
    core.emit('SIGNED_OUT');
    calls.length = 0;
    await expect(transport.rpc('get_my_workspace_context')).rejects.toMatchObject({ code: 'CORE_AUTH_REQUIRED' });
    expect(calls).toEqual([]);

    // «Ingresar con Google» with account B
    core.setSession({ access_token: 'core-b', expires_at: 3600, user: { id: 'user-b' } });
    core.emit('SIGNED_IN');
    await transport.rpc('get_my_workspace_context');
    expect(calls.map((call) => [call.path, call.authorization])).toEqual([
      ['/exchange', 'Bearer core-b'],
      ['/torneos/rest/v1/rpc/get_my_workspace_context', 'Bearer bridge-for-core-b'],
    ]);
    expect(calls.some((call) => String(call.authorization).includes('core-a'))).toBe(false);
    transport.dispose();
  });
});
