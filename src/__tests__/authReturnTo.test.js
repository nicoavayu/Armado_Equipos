import {
  clearAuthReturnTo,
  consumeAuthReturnTo,
  readAuthReturnTo,
  setAuthReturnTo,
} from '../utils/authReturnTo';

const RETURN_TO_KEY = 'auth:returnTo';
const DEEP_ROUTE = '/torneos/organizaciones/liga-demo/temporadas/2026/fixture';

describe('auth returnTo store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Also drops the in-memory consumption memo.
    clearAuthReturnTo();
  });

  test('stores only same-origin absolute paths', () => {
    setAuthReturnTo(DEEP_ROUTE);
    expect(readAuthReturnTo()).toBe(DEEP_ROUTE);

    [
      'https://evil.example/pwn',
      '//evil.example/pwn',
      '/\\evil.example/pwn',
      'torneos',
      '',
      null,
      undefined,
      42,
    ].forEach((candidate) => {
      window.localStorage.clear();
      setAuthReturnTo(candidate);
      expect(window.localStorage.getItem(RETURN_TO_KEY)).toBeNull();
    });
  });

  test('rejects a hostile value written straight into storage', () => {
    [
      'https://evil.example/pwn',
      '//evil.example/pwn',
      '/\\evil.example/pwn',
      'javascript:alert(1)',
    ].forEach((hostile) => {
      window.localStorage.setItem(RETURN_TO_KEY, hostile);
      expect(readAuthReturnTo()).toBeNull();
      expect(consumeAuthReturnTo('/home')).toBe('/home');
    });
  });

  test('consumes the stored deep route exactly once without an intent', () => {
    setAuthReturnTo(DEEP_ROUTE);

    expect(consumeAuthReturnTo('/home')).toBe(DEEP_ROUTE);
    expect(consumeAuthReturnTo('/home')).toBe('/home');
  });

  test('replays the same target for repeated consumptions of one intent', () => {
    setAuthReturnTo(DEEP_ROUTE);

    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback?code=abc' })).toBe(DEEP_ROUTE);
    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback?code=abc' })).toBe(DEEP_ROUTE);
    expect(window.localStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  test('falls back consistently when nothing was stored', () => {
    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback?code=abc' })).toBe('/home');
    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback?code=abc' })).toBe('/home');
  });

  test('does not leak one login attempt into the next', () => {
    setAuthReturnTo(DEEP_ROUTE);
    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback?code=first' })).toBe(DEEP_ROUTE);

    // A different attempt with nothing stored must not replay the old route.
    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback?code=second' })).toBe('/home');
    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback?code=first' })).toBe('/home');
  });

  test('a new stored intent invalidates the memo', () => {
    setAuthReturnTo(DEEP_ROUTE);
    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback' })).toBe(DEEP_ROUTE);

    setAuthReturnTo('/profile');
    expect(consumeAuthReturnTo('/home', { intent: '/auth/callback' })).toBe('/profile');
  });
});
