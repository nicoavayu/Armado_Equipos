import { next, rewrite } from '@vercel/functions';
import {
  getPrivateWebAccessToken,
  normalizePrivateWebReturnTo,
  verifyPrivateWebAccessToken,
} from './server/privateWebAccess.mjs';
import publicVotingRoutes from './src/config/publicVotingRoutes.js';
import publicMatchInviteRoutes from './src/config/publicMatchInviteRoutes.js';

const {
  isAllowedPublicVotingRequest,
  isLegacyPublicVotingAlias,
} = publicVotingRoutes;
const { isAllowedPublicMatchInviteRequest } = publicMatchInviteRoutes;

const LEGACY_PRODUCTION_HOSTS = new Set([
  'arma2.vercel.app',
  'arma2-nicoavayus-projects.vercel.app',
]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_PROTOCOLS = new Set(['capacitor:', 'ionic:']);
const PUBLIC_GATE_ASSETS = new Set([
  '/mobile-only.html',
  '/private-web-access.html',
  '/web-access.css',
  '/web-access.js',
  '/logo_arma2.png',
  '/fonts/oswald-latin.woff2',
  '/fonts/bebas-neue-latin.woff2',
  '/favicon.ico',
  '/favicon.svg',
  '/16x16.png',
  '/32x32.png',
  '/robots.txt',
]);
const PUBLIC_GATE_API_PATHS = new Set([
  '/api/private-web-access',
  '/api/private-web-logout',
]);
const PUBLIC_SPA_BUILD_ASSET_PATTERNS = [
  /^\/static\/(?:js|css)\/(?:[A-Za-z0-9_-]+\.)?[a-f0-9]{8}(?:\.chunk)?\.(?:js|css)$/,
  /^\/static\/media\/[A-Za-z0-9_-]+\.[a-f0-9]{8,32}\.(?:jpe?g|png|svg|webp|woff2?)$/,
];

const GATE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function withGateSecurityHeaders(response) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Content-Security-Policy', GATE_CONTENT_SECURITY_POLICY);
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Vary', 'Cookie');
  return response;
}

function isLocalOrCapacitorRequest(url) {
  return LOCAL_HOSTS.has(url.hostname.toLowerCase()) || LOCAL_PROTOCOLS.has(url.protocol.toLowerCase());
}

function redirectLegacyProductionHost(url) {
  if (!LEGACY_PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) return null;
  const destination = new URL('https://app.arma2.com.ar');
  destination.pathname = url.pathname;
  destination.search = url.search;
  return new Response(null, {
    status: 308,
    headers: { Location: destination.toString() },
  });
}

function redirectLegacyPublicVotingAlias(url) {
  if (!isLegacyPublicVotingAlias(url)) return null;
  const destination = new URL('/votar-equipos', url.origin);
  destination.search = url.search;
  return new Response(null, {
    status: 308,
    headers: { Location: destination.toString() },
  });
}

function isPublicSpaBuildAsset(pathname) {
  return PUBLIC_SPA_BUILD_ASSET_PATTERNS.some((pattern) => pattern.test(pathname));
}

export default async function privateWebGate(request) {
  const url = new URL(request.url);
  const legacyRedirect = redirectLegacyProductionHost(url);
  if (legacyRedirect) return legacyRedirect;
  if (isLocalOrCapacitorRequest(url)) return next();

  const legacyVotingRedirect = redirectLegacyPublicVotingAlias(url);
  if (legacyVotingRedirect) return legacyVotingRedirect;

  const isReadRequest = request.method === 'GET' || request.method === 'HEAD';
  if (
    isReadRequest
    && (
      isAllowedPublicVotingRequest(url)
      || isAllowedPublicMatchInviteRequest(url)
      || isPublicSpaBuildAsset(url.pathname)
    )
  ) {
    return next();
  }

  if (PUBLIC_GATE_API_PATHS.has(url.pathname)) return next();

  const signingSecret = process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET || '';
  const token = getPrivateWebAccessToken(request.headers.get('cookie'));
  const accessGranted = token
    ? await verifyPrivateWebAccessToken(token, signingSecret)
    : false;

  if (accessGranted) {
    if (url.pathname === '/acceso-web' || url.pathname === '/private-web-access.html') {
      const returnTo = normalizePrivateWebReturnTo(url.searchParams.get('returnTo'), '/login');
      return Response.redirect(new URL(returnTo, url.origin), 302);
    }
    return next();
  }

  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (url.pathname === '/acceso-web' || url.pathname === '/private-web-access.html') {
    return withGateSecurityHeaders(rewrite(new URL('/private-web-access.html', url)));
  }

  if (PUBLIC_GATE_ASSETS.has(url.pathname)) {
    return withGateSecurityHeaders(next());
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Access denied', {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return withGateSecurityHeaders(rewrite(new URL('/mobile-only.html', url)));
}

export const config = {
  matcher: '/:path*',
};
