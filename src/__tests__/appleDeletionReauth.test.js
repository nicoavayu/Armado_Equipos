import {
  AppleReauthCancelledError,
  isIosNativePlatform,
  requestAppleAuthorizationCodeForDeletion,
} from '../services/auth/appleDeletionReauth';

let mockPlatform = { native: true, platform: 'ios' };
jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockPlatform.native,
    getPlatform: () => mockPlatform.platform,
  },
}));

const plugin = (impl) => ({ authorize: jest.fn(impl) });

beforeEach(() => { mockPlatform = { native: true, platform: 'ios' }; });

describe('requestAppleAuthorizationCodeForDeletion (the Apple sheet before deleting, iOS only)', () => {
  test('asks the native sheet for the app\'s App ID with NO scopes (no name, no email) and returns the fresh authorizationCode', async () => {
    const p = plugin(async () => ({ response: { user: '000123.abc.0456', identityToken: 'id', authorizationCode: ' c-fresh-code ' } }));
    await expect(requestAppleAuthorizationCodeForDeletion({ plugin: p })).resolves.toBe('c-fresh-code');
    const options = p.authorize.mock.calls[0][0];
    expect(options.clientId).toBe('com.teambalancer.app');
    expect(options.scopes).toBe('');
    expect(typeof options.state).toBe('string');
    expect(options.nonce).toBeUndefined();
  });

  test('closing the sheet (iOS error 1001 / cancel) → AppleReauthCancelledError', async () => {
    for (const message of ['The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)', 'User canceled']) {
      const p = plugin(async () => { throw new Error(message); });
      await expect(requestAppleAuthorizationCodeForDeletion({ plugin: p })).rejects.toBeInstanceOf(AppleReauthCancelledError);
    }
  });

  test('any other failure or no code → a plain Error (never a code in the message)', async () => {
    const failing = plugin(async () => { throw new Error('AuthorizationError error 1000'); });
    await expect(requestAppleAuthorizationCodeForDeletion({ plugin: failing })).rejects.toThrow('No se pudo confirmar con Apple.');
    const empty = plugin(async () => ({ response: { authorizationCode: '' } }));
    await expect(requestAppleAuthorizationCodeForDeletion({ plugin: empty })).rejects.toThrow('Apple no devolvió un código de autorización.');
  });

  test('outside iOS native it never opens anything', async () => {
    for (const platform of [{ native: false, platform: 'web' }, { native: true, platform: 'android' }]) {
      mockPlatform = platform;
      const p = plugin(async () => ({ response: { authorizationCode: 'c' } }));
      expect(isIosNativePlatform()).toBe(false);
      await expect(requestAppleAuthorizationCodeForDeletion({ plugin: p })).rejects.toThrow(/sólo está disponible en la app de iPhone/);
      expect(p.authorize).not.toHaveBeenCalled();
    }
  });
});
