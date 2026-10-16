// «Ingresar con Google» must show Google's account chooser instead of silently reusing the account that is
// already signed in to the browser / Custom Tab / SFSafariViewController. Everything else about the OAuth
// request (redirectTo, skipBrowserRedirect on native, the client's flow type) must stay exactly as before.
const mockSignInWithOAuth = jest.fn();
const mockBrowserOpen = jest.fn();
const mockGetAuthRedirectUrl = jest.fn();
const mockIsNativePlatform = jest.fn();
const mockGetPlatform = jest.fn();
const mockStartPendingAuthFlow = jest.fn();
const mockMarkPendingAuthBrowserOpened = jest.fn();
const mockClearPendingAuthFlow = jest.fn();
const mockSetAuthFlowResult = jest.fn();
let mockRealClient = null;

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (...args) => mockIsNativePlatform(...args),
    getPlatform: (...args) => mockGetPlatform(...args),
  },
}));

jest.mock('@capacitor/browser', () => ({
  Browser: { open: (...args) => mockBrowserOpen(...args) },
}));

jest.mock('@capacitor-community/apple-sign-in', () => ({
  SignInWithApple: { authorize: jest.fn() },
}));

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args) => (mockRealClient
        ? mockRealClient.auth.signInWithOAuth(...args)
        : mockSignInWithOAuth(...args)),
    },
  },
}));

jest.mock('../utils/authRedirectUrl', () => ({
  getAuthRedirectUrl: (...args) => mockGetAuthRedirectUrl(...args),
}));

jest.mock('../utils/authFlowState', () => ({
  clearPendingAuthFlow: (...args) => mockClearPendingAuthFlow(...args),
  markPendingAuthBrowserOpened: (...args) => mockMarkPendingAuthBrowserOpened(...args),
  markPendingAuthSessionRestored: jest.fn(),
  readPendingAuthFlow: jest.fn(() => null),
  setAuthFlowResult: (...args) => mockSetAuthFlowResult(...args),
  startPendingAuthFlow: (...args) => mockStartPendingAuthFlow(...args),
}));

jest.mock('../utils/monitoring/analytics', () => ({ track: jest.fn() }));

const loadSocialAuth = () => require('../services/auth/socialAuth');

beforeEach(() => {
  jest.resetModules();
  mockRealClient = null;
  [
    mockSignInWithOAuth, mockBrowserOpen, mockGetAuthRedirectUrl, mockIsNativePlatform, mockGetPlatform,
    mockStartPendingAuthFlow, mockMarkPendingAuthBrowserOpened, mockClearPendingAuthFlow, mockSetAuthFlowResult,
  ].forEach((mock) => mock.mockReset());
  mockStartPendingAuthFlow.mockReturnValue({ started: true, flow: { id: 'flow-1' } });
  mockBrowserOpen.mockResolvedValue(undefined);
});

describe('Google sign-in shows the account chooser', () => {
  test('the query params ask Google for the chooser and nothing else', () => {
    expect(loadSocialAuth().GOOGLE_OAUTH_QUERY_PARAMS).toEqual({ prompt: 'select_account' });
  });

  test('web: same redirectTo as before, no skipBrowserRedirect, plus prompt=select_account', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    mockGetPlatform.mockReturnValue('web');
    mockGetAuthRedirectUrl.mockReturnValue('https://arma2.example.test/auth/callback');
    mockSignInWithOAuth.mockResolvedValue({ data: { provider: 'google', url: 'https://idp.example.test/authorize' }, error: null });

    await loadSocialAuth().signInWithGoogle({ source: 'auth_button' });

    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://arma2.example.test/auth/callback',
        queryParams: { prompt: 'select_account' },
      },
    });
    expect(mockStartPendingAuthFlow).toHaveBeenCalledWith({ provider: 'google', kind: 'oauth_web', source: 'auth_button' });
    expect(mockBrowserOpen).not.toHaveBeenCalled();
  });

  test('web without a redirect URL (local dev): only the chooser param is added', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    mockGetAuthRedirectUrl.mockReturnValue(undefined);
    mockSignInWithOAuth.mockResolvedValue({ data: { provider: 'google', url: null }, error: null });

    await loadSocialAuth().signInWithGoogle();

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { queryParams: { prompt: 'select_account' } },
    });
  });

  test.each(['android', 'ios'])('native %s: deep-link redirect + skipBrowserRedirect kept, chooser asked, URL opened in the in-app browser', async (platform) => {
    mockIsNativePlatform.mockReturnValue(true);
    mockGetPlatform.mockReturnValue(platform);
    mockGetAuthRedirectUrl.mockReturnValue('com.teambalancer.app://auth/callback');
    mockSignInWithOAuth.mockResolvedValue({ data: { provider: 'google', url: 'https://idp.example.test/authorize?x=1' }, error: null });

    const result = await loadSocialAuth().signInWithGoogle({ source: 'auth_button' });

    expect(result).toEqual({ pending: true });
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'com.teambalancer.app://auth/callback',
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    });
    expect(mockStartPendingAuthFlow).toHaveBeenCalledWith({ provider: 'google', kind: 'oauth_native', source: 'auth_button' });
    expect(mockBrowserOpen).toHaveBeenCalledWith({ url: 'https://idp.example.test/authorize?x=1' });
  });

  test('a fresh options object per call: the shared constant is never mutated', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    mockGetAuthRedirectUrl.mockReturnValue('https://arma2.example.test/auth/callback');
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null });
    const socialAuth = loadSocialAuth();

    await socialAuth.signInWithGoogle();
    mockSignInWithOAuth.mock.calls[0][0].options.queryParams.prompt = 'none';

    expect(socialAuth.GOOGLE_OAUTH_QUERY_PARAMS).toEqual({ prompt: 'select_account' });
    expect(Object.isFrozen(socialAuth.GOOGLE_OAUTH_QUERY_PARAMS)).toBe(true);
  });

  test('a Supabase error still clears the pending flow and surfaces the Spanish Google message', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    mockGetAuthRedirectUrl.mockReturnValue('https://arma2.example.test/auth/callback');
    mockSignInWithOAuth.mockResolvedValue({ data: null, error: new Error('provider disabled') });

    await expect(loadSocialAuth().signInWithGoogle()).rejects.toThrow('No pudimos iniciar sesión con Google. provider disabled');
    expect(mockClearPendingAuthFlow).toHaveBeenCalled();
  });

  test('real supabase-js URL: prompt=select_account reaches /authorize next to provider and redirect_to, with the client flow type unchanged (no PKCE challenge added)', async () => {
    const { createClient } = jest.requireActual('@supabase/supabase-js');
    // No network: skipBrowserRedirect (native path) makes signInWithOAuth only build the URL.
    mockRealClient = createClient('http://127.0.0.1:54321', 'test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    mockIsNativePlatform.mockReturnValue(true);
    mockGetPlatform.mockReturnValue('android');
    mockGetAuthRedirectUrl.mockReturnValue('com.teambalancer.app://auth/callback');

    await loadSocialAuth().signInWithGoogle();

    expect(mockBrowserOpen).toHaveBeenCalledTimes(1);
    const url = new URL(mockBrowserOpen.mock.calls[0][0].url);
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:54321/auth/v1/authorize');
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('com.teambalancer.app://auth/callback');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.has('code_challenge')).toBe(false);
  });
});

describe('the Core Supabase client auth config is unchanged by this fix', () => {
  test('createClient keeps persistSession/autoRefreshToken/detectSessionInUrl and sets no flowType', () => {
    jest.isolateModules(() => {
      const mockCreateClient = jest.fn(() => ({ auth: {} }));
      jest.doMock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
      require('../lib/supabaseClient');
      expect(mockCreateClient).toHaveBeenCalledTimes(1);
      const config = mockCreateClient.mock.calls[0][2];
      expect(config.auth).toEqual({
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      });
      jest.dontMock('@supabase/supabase-js');
    });
  });
});
