const encoder = new TextEncoder();

export const PRIVATE_WEB_COOKIE_NAME = '__Host-arma2_private_web';
export const PRIVATE_WEB_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256';
export const PASSWORD_HASH_ITERATIONS = 210_000;

const MIN_PASSWORD_HASH_ITERATIONS = 100_000;
const MAX_PASSWORD_HASH_ITERATIONS = 1_000_000;
const SIGNING_SECRET_MIN_LENGTH = 32;

function getWebCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Web Crypto is unavailable.');
  }
  return globalThis.crypto;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid base64url value.');
  }

  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isSigningSecretValid(secret) {
  return typeof secret === 'string' && secret.length >= SIGNING_SECRET_MIN_LENGTH;
}

function parsePasswordHash(storedHash) {
  if (typeof storedHash !== 'string') return null;
  const [scheme, rawIterations, saltValue, digestValue, ...rest] = storedHash.split('$');
  const iterations = Number(rawIterations);

  if (
    rest.length > 0
    || scheme !== PASSWORD_HASH_SCHEME
    || !Number.isInteger(iterations)
    || iterations < MIN_PASSWORD_HASH_ITERATIONS
    || iterations > MAX_PASSWORD_HASH_ITERATIONS
  ) {
    return null;
  }

  try {
    const salt = base64UrlToBytes(saltValue);
    const digest = base64UrlToBytes(digestValue);
    if (salt.length < 16 || digest.length !== 32) return null;
    return { iterations, salt, digest };
  } catch {
    return null;
  }
}

export function isPrivateWebPasswordHashValid(storedHash) {
  return Boolean(parsePasswordHash(storedHash));
}

async function derivePassword(password, salt, iterations) {
  const webCrypto = getWebCrypto();
  const passwordKey = await webCrypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await webCrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    passwordKey,
    256,
  );
  return new Uint8Array(derivedBits);
}

function constantTimeEqual(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

export async function createPrivateWebPasswordHash(
  password,
  { iterations = PASSWORD_HASH_ITERATIONS, salt } = {},
) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 256) {
    throw new Error('Invalid password length.');
  }
  if (
    !Number.isInteger(iterations)
    || iterations < MIN_PASSWORD_HASH_ITERATIONS
    || iterations > MAX_PASSWORD_HASH_ITERATIONS
  ) {
    throw new Error('Invalid PBKDF2 iteration count.');
  }

  const webCrypto = getWebCrypto();
  const resolvedSalt = salt || webCrypto.getRandomValues(new Uint8Array(16));
  if (!(resolvedSalt instanceof Uint8Array) || resolvedSalt.length < 16) {
    throw new Error('Invalid PBKDF2 salt.');
  }

  const digest = await derivePassword(password, resolvedSalt, iterations);
  return [
    PASSWORD_HASH_SCHEME,
    String(iterations),
    bytesToBase64Url(resolvedSalt),
    bytesToBase64Url(digest),
  ].join('$');
}

export async function verifyPrivateWebPassword(password, storedHash) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 256) {
    return false;
  }

  const parsedHash = parsePasswordHash(storedHash);
  if (!parsedHash) return false;

  const digest = await derivePassword(password, parsedHash.salt, parsedHash.iterations);
  return constantTimeEqual(digest, parsedHash.digest);
}

async function importHmacKey(secret, usage) {
  if (!isSigningSecretValid(secret)) throw new Error('Invalid signing secret.');
  return getWebCrypto().subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function createPrivateWebAccessToken(
  signingSecret,
  { nowMs = Date.now(), maxAgeSeconds = PRIVATE_WEB_COOKIE_MAX_AGE_SECONDS } = {},
) {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error('Invalid token duration.');
  }

  const issuedAt = Math.floor(nowMs / 1000);
  const nonce = getWebCrypto().getRandomValues(new Uint8Array(16));
  const payload = {
    v: 1,
    iat: issuedAt,
    exp: issuedAt + maxAgeSeconds,
    n: bytesToBase64Url(nonce),
  };
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(signingSecret, 'sign');
  const signature = await getWebCrypto().subtle.sign('HMAC', key, encoder.encode(encodedPayload));

  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyPrivateWebAccessToken(token, signingSecret, { nowMs = Date.now() } = {}) {
  if (typeof token !== 'string' || !isSigningSecretValid(signingSecret)) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  try {
    const [encodedPayload, encodedSignature] = parts;
    const key = await importHmacKey(signingSecret, 'verify');
    const signatureValid = await getWebCrypto().subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!signatureValid) return false;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload)));
    const nowSeconds = Math.floor(nowMs / 1000);
    if (
      payload?.v !== 1
      || !Number.isInteger(payload.iat)
      || !Number.isInteger(payload.exp)
      || typeof payload.n !== 'string'
      || payload.exp <= nowSeconds
      || payload.iat > nowSeconds + 300
      || payload.exp - payload.iat > PRIVATE_WEB_COOKIE_MAX_AGE_SECONDS
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getPrivateWebAccessToken(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const segment of cookieHeader.split(';')) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex < 0) continue;
    const name = segment.slice(0, separatorIndex).trim();
    if (name !== PRIVATE_WEB_COOKIE_NAME) continue;
    return segment.slice(separatorIndex + 1).trim() || null;
  }
  return null;
}

export function serializePrivateWebAccessCookie(token, { nowMs = Date.now() } = {}) {
  const expiresAt = new Date(nowMs + (PRIVATE_WEB_COOKIE_MAX_AGE_SECONDS * 1000));
  return [
    `${PRIVATE_WEB_COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${PRIVATE_WEB_COOKIE_MAX_AGE_SECONDS}`,
    `Expires=${expiresAt.toUTCString()}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

export function serializeClearedPrivateWebAccessCookie() {
  return [
    `${PRIVATE_WEB_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

export function normalizePrivateWebReturnTo(value, fallback = '/login') {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim();
  if (
    candidate.length === 0
    || candidate.length > 2048
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(candidate)
    || /%0d|%0a/i.test(candidate)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, 'https://app.arma2.com.ar');
    if (parsed.origin !== 'https://app.arma2.com.ar') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function hasValidPrivateWebSigningSecret(secret) {
  return isSigningSecretValid(secret);
}
