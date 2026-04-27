import { Capacitor } from '@capacitor/core';

const NATIVE_IOS_REDIRECT_FALLBACK = 'com.teambalancer.app://auth/callback';

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');
const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());
const buildCallbackUrl = (origin) => `${normalizeOrigin(origin)}/auth/callback`;

export function getAuthRedirectUrl() {
  const envUrl = String(process.env.REACT_APP_AUTH_REDIRECT_URL || '').trim();
  const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

  if (isNativeIos) {
    return envUrl || NATIVE_IOS_REDIRECT_FALLBACK;
  }

  if (isHttpUrl(envUrl)) return envUrl;

  if (typeof window !== 'undefined' && window.location?.origin) {
    const windowOrigin = normalizeOrigin(window.location.origin);
    if (isHttpUrl(windowOrigin)) {
      return buildCallbackUrl(windowOrigin);
    }
  }

  const envOrigin = normalizeOrigin(
    process.env.REACT_APP_PUBLIC_APP_ORIGIN
    || process.env.REACT_APP_PUBLIC_APP_URL,
  );
  if (isHttpUrl(envOrigin)) {
    return buildCallbackUrl(envOrigin);
  }

  if (process.env.NODE_ENV === 'production') {
    return 'https://arma2.vercel.app/auth/callback';
  }

  return undefined;
}
