import { serializeClearedPrivateWebAccessCookie } from '../server/privateWebAccess.mjs';

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : (value || '')).split(',')[0].trim();
}

function isSameOriginRequest(request) {
  const origin = firstHeaderValue(request.headers?.origin);
  if (!origin) return true;
  const host = firstHeaderValue(request.headers?.['x-forwarded-host'] || request.headers?.host);
  const protocol = firstHeaderValue(request.headers?.['x-forwarded-proto']) || 'https';
  if (!host) return false;

  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

export default function handler(request, response) {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.statusCode = 405;
    response.end('Method not allowed');
    return;
  }

  if (!isSameOriginRequest(request)) {
    response.statusCode = 403;
    response.end('Access denied');
    return;
  }

  response.setHeader('Set-Cookie', serializeClearedPrivateWebAccessCookie());
  response.statusCode = 204;
  response.end();
}
