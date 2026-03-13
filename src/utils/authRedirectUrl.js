import { Capacitor } from '@capacitor/core';

const NATIVE_IOS_REDIRECT_FALLBACK = 'com.teambalancer.app://auth/callback';

export function getAuthRedirectUrl() {
  const envUrl = String(process.env.REACT_APP_AUTH_REDIRECT_URL || '').trim();
  const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

  if (isNativeIos) {
    return envUrl || NATIVE_IOS_REDIRECT_FALLBACK;
  }

  if (envUrl && /^https?:\/\//i.test(envUrl)) return envUrl;

  if (process.env.NODE_ENV === 'production') {
    const envOrigin = String(process.env.REACT_APP_PUBLIC_APP_ORIGIN || '').trim().replace(/\/+$/, '');
    const canonicalOrigin = envOrigin || 'https://arma2.vercel.app';
    return `${canonicalOrigin}/auth/callback`;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    if (process.env.NODE_ENV === 'development') {
      return `${window.location.origin}/auth/callback`;
    }
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth/callback`;
  }

  return undefined;
}
