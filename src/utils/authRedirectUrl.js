import { Capacitor } from '@capacitor/core';

const NATIVE_AUTH_REDIRECT_FALLBACK = 'com.teambalancer.app://auth/callback';

export function getAuthRedirectUrl() {
  const envUrl = String(process.env.REACT_APP_AUTH_REDIRECT_URL || '').trim();
  const publicAppUrl = String(process.env.REACT_APP_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const legacyPublicOrigin = String(process.env.REACT_APP_PUBLIC_APP_ORIGIN || '').trim().replace(/\/+$/, '');
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    if (envUrl && !/^https?:\/\//i.test(envUrl)) return envUrl;
    return NATIVE_AUTH_REDIRECT_FALLBACK;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth/callback`;
  }

  if (envUrl && /^https?:\/\//i.test(envUrl)) return envUrl;

  if (process.env.NODE_ENV === 'production') {
    const canonicalOrigin = publicAppUrl || legacyPublicOrigin || 'https://arma2.vercel.app';
    return `${canonicalOrigin}/auth/callback`;
  }

  return undefined;
}
