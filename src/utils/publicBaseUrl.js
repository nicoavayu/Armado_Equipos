// Canonical public base URL for shared links.
// On Vercel, `window.location.origin` may be a preview URL that is protected (asks users to log in).
// Use `REACT_APP_PUBLIC_APP_URL` to force the production domain when generating share links.

export function getPublicBaseUrl() {
  const envUrl = String(process.env.REACT_APP_PUBLIC_APP_URL || '').trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

