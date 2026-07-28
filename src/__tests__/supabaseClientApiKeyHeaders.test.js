const mockCreateClient = jest.fn(() => ({ client: true }));

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args) => mockCreateClient(...args),
}));

describe('Supabase browser client API key headers', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

  beforeEach(() => {
    jest.resetModules();
    mockCreateClient.mockClear();
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'publishable-test-key';
    process.env.REACT_APP_SUPABASE_URL = 'https://supabase.example.test';
    global.fetch = jest.fn(async () => new Response(null, { status: 204 }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.REACT_APP_SUPABASE_ANON_KEY = originalKey;
  });

  test('removes a Bearer API key and keeps it only in apikey', async () => {
    require('../lib/supabaseClient');
    const options = mockCreateClient.mock.calls[0][2];

    await options.global.fetch('https://supabase.example.test/rest/v1/usuarios', {
      headers: { Authorization: 'Bearer publishable-test-key' },
    });

    const sentHeaders = global.fetch.mock.calls[0][1].headers;
    expect(sentHeaders.get('apikey')).toBe('publishable-test-key');
    expect(sentHeaders.get('Authorization')).toBeNull();
  });

  test('preserves the authenticated user JWT', async () => {
    require('../lib/supabaseClient');
    const options = mockCreateClient.mock.calls[0][2];

    await options.global.fetch('https://supabase.example.test/rest/v1/usuarios', {
      headers: { Authorization: 'Bearer user.jwt.token' },
    });

    const sentHeaders = global.fetch.mock.calls[0][1].headers;
    expect(sentHeaders.get('apikey')).toBe('publishable-test-key');
    expect(sentHeaders.get('Authorization')).toBe('Bearer user.jwt.token');
  });
});
