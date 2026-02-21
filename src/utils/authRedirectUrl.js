export function getAuthRedirectUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    if (process.env.NODE_ENV === 'development') {
      return `${window.location.origin}/auth/callback`;
    }
  }

  const envUrl = String(process.env.REACT_APP_AUTH_REDIRECT_URL || '').trim();
  if (envUrl) return envUrl;

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth/callback`;
  }

  return undefined;
}
