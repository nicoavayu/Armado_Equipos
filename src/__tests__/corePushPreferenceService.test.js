// Core's push preference as read from Torneos' profile: a missing contract (frontend deployed before Core's migration)
// is "unavailable", never a failure; any other error is reported as one.
const mockRpc = { result: { data: null, error: null }, calls: [] };

jest.mock('../services/api/supabase', () => ({
  supabase: { rpc: async (name, params) => { mockRpc.calls.push([name, params]); return mockRpc.result; } },
}));

const { loadMyCorePushPreference, saveMyCorePushPreference } = require('../services/corePushPreferenceService');

beforeEach(() => { mockRpc.calls.length = 0; });

test('reads the account preference', async () => {
  mockRpc.result = { data: { pushEnabled: false }, error: null };
  await expect(loadMyCorePushPreference()).resolves.toEqual({ available: true, pushEnabled: false });
  expect(mockRpc.calls).toEqual([['get_my_push_preference', undefined]]);
});

test('without the RPC yet (PGRST202) the preference is unavailable, not an error', async () => {
  mockRpc.result = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  await expect(loadMyCorePushPreference()).resolves.toEqual({ available: false, pushEnabled: true });
});

test('any other error is reported', async () => {
  mockRpc.result = { data: null, error: { code: '42501', message: 'AUTH_REQUIRED' } };
  await expect(loadMyCorePushPreference()).rejects.toMatchObject({ code: '42501' });
});

test('saving sends only a boolean', async () => {
  mockRpc.result = { data: { pushEnabled: true, pendingSkipped: 0 }, error: null };
  await expect(saveMyCorePushPreference(true)).resolves.toEqual({ pushEnabled: true });
  expect(mockRpc.calls).toEqual([['set_my_push_preference', { p_enabled: true }]]);
  await expect(saveMyCorePushPreference('no')).rejects.toThrow('PUSH_PREFERENCE_REQUIRED');
});
