jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: jest.fn(),
  },
}));

const { Capacitor } = require('@capacitor/core');
const { getAuthRedirectUrl } = require('../utils/authRedirectUrl');

describe('getAuthRedirectUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    Capacitor.isNativePlatform.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('uses the canonical origin for production web auth', () => {
    process.env.NODE_ENV = 'production';
    process.env.REACT_APP_AUTH_REDIRECT_URL = 'com.teambalancer.app://auth/callback';
    process.env.REACT_APP_PUBLIC_APP_URL = 'https://arma2.vercel.app';

    expect(getAuthRedirectUrl()).toBe('https://app.arma2.com.ar/auth/callback');
  });

  test('does not allow a legacy production environment variable to leak into auth links', () => {
    process.env.NODE_ENV = 'production';
    process.env.REACT_APP_PUBLIC_APP_URL = 'https://arma2-nicoavayus-projects.vercel.app';
    expect(getAuthRedirectUrl()).toBe('https://app.arma2.com.ar/auth/callback');
  });

  test('uses the current origin during local development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.REACT_APP_PUBLIC_APP_URL;
    delete process.env.REACT_APP_AUTH_REDIRECT_URL;
    expect(getAuthRedirectUrl()).toBe(`${window.location.origin}/auth/callback`);
  });

  test('keeps the native iOS deep link when running inside Capacitor', () => {
    Capacitor.isNativePlatform.mockReturnValue(true);
    process.env.REACT_APP_AUTH_REDIRECT_URL = 'com.teambalancer.app://auth/callback';

    expect(getAuthRedirectUrl()).toBe('com.teambalancer.app://auth/callback');
  });
});
