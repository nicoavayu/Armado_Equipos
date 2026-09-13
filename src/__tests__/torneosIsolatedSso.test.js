import { createTorneosClient } from '../features/torneos/isolated/createTorneosClient';
import { resolveIsolatedSso } from '../features/torneos/isolated/config';

jest.mock('@supabase/supabase-js', () => ({ createClient: (url, key, options) => ({ url, options }) }));
beforeAll(() => { AbortSignal.timeout = () => new AbortController().signal; });
const origin = 'http://127.0.0.1:58410';
function fixture() {
  let listener;
  let session = { user: { id: 'alice' }, access_token: 'core-a', expires_at: 9999999999 };
  const core = { supabaseUrl: origin, auth: {
    getSession: jest.fn(async () => ({ data: { session } })),
    onAuthStateChange: jest.fn(fn => { listener = fn; return { data: { subscription: { unsubscribe: jest.fn() } } }; }),
    stopAutoRefresh: jest.fn(), signInWithPassword: jest.fn(), signOut: jest.fn(),
  } };
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: 'torneos-a', expires_in: 120, token_type: 'Bearer' }) }));
  const client = createTorneosClient(core, { origin, anonKey: 'anon', fetchImpl, now: () => 100000 });
  return { core, client, fetchImpl, token: client.supabaseTorneos.options.accessToken,
    event: event => listener(event), session: value => { session = value; } };
}
test('existing Core singleton owns Auth; Torneos never persists or starts Auth', async () => {
  const f = fixture();
  expect(await f.token()).toBe('torneos-a');
  expect(f.client.supabaseTorneos.options.auth.persistSession).toBe(false);
  f.client.dispose();
  expect(f.core.auth.stopAutoRefresh).not.toHaveBeenCalled();
  expect(f.core.auth.signInWithPassword).not.toHaveBeenCalled();
  expect(f.core.auth.signOut).not.toHaveBeenCalled();
});
test('concurrent requests coalesce and refresh invalidates cached authorization', async () => {
  const f = fixture();
  await Promise.all([f.token(), f.token(), f.token()]);
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  f.event('TOKEN_REFRESHED');
  await f.token();
  expect(f.fetchImpl).toHaveBeenCalledTimes(2);
});
test('logout during exchange discards response', async () => {
  const f = fixture();
  let resolve;
  f.fetchImpl.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const token = f.token();
  await Promise.resolve();
  f.event('SIGNED_OUT');
  resolve({ ok: true, json: async () => ({ access_token: 'late-token', expires_in: 120, token_type: 'Bearer' }) });
  await expect(token).rejects.toThrow('Core session changed');
});
test.each([null, { access_token: 'expired', expires_at: 1 }])('absent or expired Core session blocks exchange', async session => {
  const f = fixture(); f.session(session);
  await expect(f.token()).rejects.toThrow('Core authorization required');
  expect(f.fetchImpl).not.toHaveBeenCalled();
});
test('exchange failure is confined to Torneos', async () => {
  const f = fixture(); f.fetchImpl.mockResolvedValueOnce({ ok: false });
  await expect(f.token()).rejects.toThrow('Torneos authorization unavailable');
  expect(f.core.auth.signOut).not.toHaveBeenCalled();
  expect((await f.core.auth.getSession()).data.session.access_token).toBe('core-a');
});
test('same-user replacement session never reuses previous session authorization', async () => {
  const f = fixture(); await f.token();
  f.session({ user: { id: 'alice' }, access_token: 'core-b', expires_at: 9999999999 });
  await f.token();
  expect(f.fetchImpl).toHaveBeenCalledTimes(2);
});
test('integration gate requires every local isolation condition', () => {
  const env = { REACT_APP_TORNEOS_ISOLATED_SSO: 'true', REACT_APP_DEPLOY_ENV: 'test',
    REACT_APP_LOCAL_EDIT_MODE: 'false', REACT_APP_SUPABASE_URL: origin };
  expect(resolveIsolatedSso(env, { origin })).toBe(true);
  for (const key of Object.keys(env)) expect(resolveIsolatedSso({ ...env, [key]: '' }, { origin })).toBe(false);
  expect(resolveIsolatedSso(env, { origin: 'https://app.arma2.com.ar' })).toBe(false);
  expect(() => createTorneosClient({ supabaseUrl: 'https://example.supabase.co' }, { origin, anonKey: 'anon' })).toThrow();
});
