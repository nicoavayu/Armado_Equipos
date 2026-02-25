export function getAuthRedirectUrl() {
  const envUrl = String(process.env.REACT_APP_AUTH_REDIRECT_URL || '').trim();
  if (envUrl) return envUrl;

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
