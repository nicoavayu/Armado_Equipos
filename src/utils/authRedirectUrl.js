import { Capacitor } from '@capacitor/core';
import { PUBLIC_APP_ORIGIN } from './publicAppUrl';

const NATIVE_AUTH_REDIRECT_FALLBACK = 'com.teambalancer.app://auth/callback';

export function getAuthRedirectUrl() {
  const envUrl = String(process.env.REACT_APP_AUTH_REDIRECT_URL || '').trim();
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    if (envUrl && !/^https?:\/\//i.test(envUrl)) return envUrl;
    return NATIVE_AUTH_REDIRECT_FALLBACK;
  }

  if (process.env.NODE_ENV === 'production') {
    return `${PUBLIC_APP_ORIGIN}/auth/callback`;
  }

  if (envUrl && /^https?:\/\//i.test(envUrl)) return envUrl;

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth/callback`;
  }

  return undefined;
}
