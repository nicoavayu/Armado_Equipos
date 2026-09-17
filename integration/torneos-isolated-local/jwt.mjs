// RS256 identity-bridge tokens with node:crypto only (no npm dependency, no network).
// Same key-ring shape as the Phase 3A lab (`kid`, PKCS#8 private key, JWK public key) so the
// Edge gateway's TORNEOS_BRIDGE_KEYS (R4) can be built from it unchanged, and the same claim
// contract as integration/torneos-sso/token.mjs (issuer, audience, TTL 120, nbf = iat).
import { generateKeyPairSync, createPrivateKey, createSign, randomUUID } from 'node:crypto';

export const ISSUER = 'urn:arma2:local:identity-bridge';
export const AUDIENCE = 'arma2-torneos-local';
export const TTL = 120;

export function generateKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}
const b64u = (s) => Buffer.from(s).toString('base64url');
export function sign(key, claims, header = {}) {
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header }));
  const p = b64u(JSON.stringify(claims));
  const sig = createSign('RSA-SHA256').update(`${h}.${p}`).sign(createPrivateKey(key.privateKey));
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}
/** Valid bridge bearer for a local identity (contract of private.current_identity_id). */
export function bearer(key, identity, overrides = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { role: 'authenticated', iss: ISSUER, aud: AUDIENCE, sub: identity.id, core_user_id: identity.core_user_id,
    session_id: randomUUID(), jti: randomUUID(), iat: now, nbf: now, exp: now + TTL, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete claims[k];
  return sign(key, claims, header);
}
