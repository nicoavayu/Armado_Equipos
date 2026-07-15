export const PUBLIC_APP_ORIGIN = 'https://app.arma2.com.ar';
export const LEGACY_VERCEL_HOSTNAMES = new Set([
  'arma2.vercel.app',
  'arma2-nicoavayus-projects.vercel.app',
]);

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const CAPACITOR_PROTOCOLS = new Set(['capacitor:', 'ionic:']);

export const getCanonicalRedirectUrl = (locationLike) => {
  if (!locationLike) return null;

  const hostname = String(locationLike.hostname || '').toLowerCase();
  const protocol = String(locationLike.protocol || '').toLowerCase();
  if (LOCAL_HOSTNAMES.has(hostname) || CAPACITOR_PROTOCOLS.has(protocol)) return null;
  if (!LEGACY_VERCEL_HOSTNAMES.has(hostname)) return null;

  return `${PUBLIC_APP_ORIGIN}${locationLike.pathname || '/'}${locationLike.search || ''}${locationLike.hash || ''}`;
};
