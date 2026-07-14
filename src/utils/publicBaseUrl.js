import { PUBLIC_APP_ORIGIN } from './publicAppUrl';

export function getPublicBaseUrl() {
  if (process.env.NODE_ENV === 'production') return PUBLIC_APP_ORIGIN;
  const envUrl = String(process.env.REACT_APP_PUBLIC_APP_URL || '').trim();
  const legacyOrigin = String(process.env.REACT_APP_PUBLIC_APP_ORIGIN || '').trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  if (legacyOrigin) return legacyOrigin.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return PUBLIC_APP_ORIGIN;
}
