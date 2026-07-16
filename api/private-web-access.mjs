import {
  createPrivateWebAccessToken,
  hasValidPrivateWebSigningSecret,
  isPrivateWebPasswordHashValid,
  normalizePrivateWebReturnTo,
  serializePrivateWebAccessCookie,
  verifyPrivateWebPassword,
} from '../server/privateWebAccess.mjs';

const MAX_BODY_BYTES = 4096;
const GENERIC_FAILURE_PATH = '/acceso-web?error=1';

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

async function readBody(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  let rawBody = typeof request.body === 'string' ? request.body : '';
  if (!rawBody && request[Symbol.asyncIterator]) {
    for await (const chunk of request) {
      rawBody += chunk.toString('utf8');
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        throw new Error('Request body too large.');
      }
    }
  }

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    throw new Error('Request body too large.');
  }

  const contentType = firstHeaderValue(request.headers?.['content-type']).toLowerCase();
  if (contentType.startsWith('application/json')) return JSON.parse(rawBody || '{}');
  return Object.fromEntries(new URLSearchParams(rawBody));
}

function redirect(response, location) {
  response.statusCode = 303;
  response.setHeader('Location', location);
  response.end();
}

function buildFailurePath(returnTo) {
  const normalized = normalizePrivateWebReturnTo(returnTo, '/login');
  return `${GENERIC_FAILURE_PATH}&returnTo=${encodeURIComponent(normalized)}`;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');

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

  let body;
  try {
    body = await readBody(request);
  } catch {
    redirect(response, GENERIC_FAILURE_PATH);
    return;
  }

  const password = typeof body?.password === 'string' ? body.password : '';
  const returnTo = normalizePrivateWebReturnTo(body?.returnTo, '/login');
  const passwordHash = process.env.PRIVATE_WEB_ACCESS_PASSWORD_HASH;
  const signingSecret = process.env.PRIVATE_WEB_ACCESS_SIGNING_SECRET;

  if (
    !isPrivateWebPasswordHashValid(passwordHash)
    || !hasValidPrivateWebSigningSecret(signingSecret)
  ) {
    response.statusCode = 503;
    response.end('Access unavailable');
    return;
  }

  let passwordValid = false;
  try {
    passwordValid = await verifyPrivateWebPassword(password, passwordHash);
  } catch {
    passwordValid = false;
  }

  if (!passwordValid) {
    redirect(response, buildFailurePath(returnTo));
    return;
  }

  const token = await createPrivateWebAccessToken(signingSecret);
  response.setHeader('Set-Cookie', serializePrivateWebAccessCookie(token));
  redirect(response, returnTo);
}
