const { createHash } = require('crypto');
const { TextEncoder } = require('util');
const mockAuthorize = jest.fn();
const mockSignInWithIdToken = jest.fn();
const mockUpdateUser = jest.fn();
const mockTrack = jest.fn();
const mockStartPendingAuthFlow = jest.fn();
const mockMarkPendingAuthBrowserOpened = jest.fn();
const mockMarkPendingAuthSessionRestored = jest.fn();
const mockClearPendingAuthFlow = jest.fn();
const mockReadPendingAuthFlow = jest.fn();
const mockSetAuthFlowResult = jest.fn();
const mockUsuariosEq = jest.fn();
const mockProfilesEq = jest.fn();
const mockUsuariosUpdate = jest.fn();
const mockProfilesUpdate = jest.fn();
const mockFrom = jest.fn();

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: jest.fn(() => true),
    getPlatform: jest.fn(() => 'ios'),
  },
}));

jest.mock('@capacitor/browser', () => ({
  Browser: {
    open: jest.fn(),
  },
}));

jest.mock('@capacitor-community/apple-sign-in', () => ({
  SignInWithApple: {
    authorize: (...args) => mockAuthorize(...args),
  },
}));

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...args) => mockSignInWithIdToken(...args),
      updateUser: (...args) => mockUpdateUser(...args),
    },
    from: (...args) => mockFrom(...args),
  },
}));

jest.mock('../utils/authRedirectUrl', () => ({
  getAuthRedirectUrl: jest.fn(() => 'com.teambalancer.app://auth/callback'),
}));

jest.mock('../utils/authFlowState', () => ({
  clearPendingAuthFlow: (...args) => mockClearPendingAuthFlow(...args),
  markPendingAuthBrowserOpened: (...args) => mockMarkPendingAuthBrowserOpened(...args),
  markPendingAuthSessionRestored: (...args) => mockMarkPendingAuthSessionRestored(...args),
  readPendingAuthFlow: (...args) => mockReadPendingAuthFlow(...args),
  setAuthFlowResult: (...args) => mockSetAuthFlowResult(...args),
  startPendingAuthFlow: (...args) => mockStartPendingAuthFlow(...args),
}));

jest.mock('../utils/monitoring/analytics', () => ({
  track: (...args) => mockTrack(...args),
}));

describe('socialAuth signInWithApple', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAuthorize.mockReset();
    mockSignInWithIdToken.mockReset();
    mockUpdateUser.mockReset();
    mockTrack.mockReset();
    mockStartPendingAuthFlow.mockReset();
    mockMarkPendingAuthBrowserOpened.mockReset();
    mockMarkPendingAuthSessionRestored.mockReset();
    mockClearPendingAuthFlow.mockReset();
    mockReadPendingAuthFlow.mockReset();
    mockSetAuthFlowResult.mockReset();
    mockUsuariosEq.mockReset();
    mockProfilesEq.mockReset();
    mockUsuariosUpdate.mockReset();
    mockProfilesUpdate.mockReset();
    mockFrom.mockReset();

    mockStartPendingAuthFlow.mockReturnValue({
      started: true,
      flow: { id: 'flow-1', provider: 'apple' },
    });
    mockUpdateUser.mockResolvedValue({ error: null });
    mockSignInWithIdToken.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-1', email: 'relay@privaterelay.appleid.com' },
        },
      },
      error: null,
    });
    mockUsuariosEq.mockResolvedValue({ error: null });
    mockProfilesEq.mockResolvedValue({ error: null });
    mockUsuariosUpdate.mockReturnValue({ eq: mockUsuariosEq });
    mockProfilesUpdate.mockReturnValue({ eq: mockProfilesEq });
    mockFrom.mockImplementation((table) => {
      if (table === 'usuarios') {
        return { update: mockUsuariosUpdate };
      }
      if (table === 'profiles') {
        return { update: mockProfilesUpdate };
      }
      return { update: jest.fn(() => ({ eq: jest.fn() })) };
    });

    if (!global.crypto) {
      global.crypto = {};
    }
    if (!global.TextEncoder) {
      global.TextEncoder = TextEncoder;
    }
    if (!global.crypto.subtle) {
      global.crypto.subtle = {
        digest: jest.fn(async (_algorithm, data) => {
          const hash = createHash('sha256').update(Buffer.from(data)).digest();
          return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
        }),
      };
    }
  });

  test('persists Apple full name and signs in with the same nonce used for the native request', async () => {
    mockAuthorize.mockResolvedValue({
      response: {
        identityToken: 'identity-token',
        email: 'relay@privaterelay.appleid.com',
        givenName: 'Ada',
        familyName: 'Lovelace',
      },
    });

    const { signInWithApple } = require('../services/auth/socialAuth');
    await signInWithApple({ source: 'auth_button' });

    const authorizeOptions = mockAuthorize.mock.calls[0][0];
    expect(authorizeOptions.clientId).toBe('com.teambalancer.app');
    expect(authorizeOptions.redirectURI).toBe('com.teambalancer.app://auth/callback');
    expect(authorizeOptions.scopes).toBe('email name');

    const rawNonce = mockSignInWithIdToken.mock.calls[0][0].nonce;
    expect(authorizeOptions.nonce).toBe(createHash('sha256').update(rawNonce).digest('hex'));

    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'identity-token',
      nonce: rawNonce,
    });

    expect(mockUpdateUser).toHaveBeenCalledWith({
      data: {
        full_name: 'Ada Lovelace',
        given_name: 'Ada',
        family_name: 'Lovelace',
      },
    });

    expect(mockUsuariosUpdate).toHaveBeenCalledWith(expect.objectContaining({
      nombre: 'Ada Lovelace',
      email: 'relay@privaterelay.appleid.com',
    }));
    expect(mockUsuariosEq).toHaveBeenCalledWith('id', 'user-1');
    expect(mockProfilesUpdate).toHaveBeenCalledWith({ nombre: 'Ada Lovelace' });
    expect(mockProfilesEq).toHaveBeenCalledWith('id', 'user-1');
    expect(mockMarkPendingAuthSessionRestored).toHaveBeenCalledWith({
      provider: 'apple',
      userId: 'user-1',
    });
    expect(mockTrack).toHaveBeenCalledWith('login_success', {
      provider: 'apple',
      user_id: 'user-1',
      method: 'native_apple',
    });
  });
});
