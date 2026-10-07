import { randomUUID } from 'node:crypto';
import { importPKCS8, importJWK, SignJWT, jwtVerify } from 'jose';

export const ISSUER = 'urn:arma2:local:identity-bridge';
export const AUDIENCE = 'arma2-torneos-local';
export const TTL = 120;
export const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export async function issueToken(cfg, identity, sessionId) {
  const key = cfg.keys.find(k => k.kid === cfg.activeKid);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ core_user_id: identity.core_user_id, session_id: sessionId,
    role: 'authenticated' }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: key.kid })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(identity.id)
    .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + TTL).setJti(randomUUID())
    .sign(await importPKCS8(key.privateKey, 'RS256'));
}
// MEDIA-V1: the same token for an identity the gateway already verified, plus the gateway-only upload-session claim
// (backend/torneos/supabase/functions/torneos-gateway/token.ts issueMediaUploadToken). Never returned to a client.
export async function issueMediaUploadToken(cfg, verified, uploadSessionId) {
  if (![verified.sub, verified.core_user_id, verified.session_id, uploadSessionId].every(uuid)) throw new Error('invalid media claim');
  const key = cfg.keys.find(k => k.kid === cfg.activeKid);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ core_user_id: verified.core_user_id, session_id: verified.session_id, role: 'authenticated',
    torneos_media_upload_session: uploadSessionId }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: key.kid })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(verified.sub)
    .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + TTL).setJti(randomUUID())
    .sign(await importPKCS8(key.privateKey, 'RS256'));
}
export async function verifyToken(token, cfg, currentDate = new Date()) {
  const { payload: p, protectedHeader: h } = await jwtVerify(token, async header => {
    const key = cfg.keys.find(k => k.kid === header.kid && cfg.trustedKids.includes(k.kid));
    if (!key) throw new Error('untrusted signing key');
    return importJWK(key.publicKey, 'RS256');
  }, { algorithms: ['RS256'], issuer: ISSUER, audience: AUDIENCE,
    clockTolerance: 5, currentDate, requiredClaims: ['sub','iat','exp','nbf','jti','session_id','core_user_id','role'] });
  if (h.typ !== 'JWT' || p.aud !== AUDIENCE || p.role !== 'authenticated' ||
      ![p.sub,p.core_user_id,p.session_id,p.jti].every(uuid) ||
      ![p.iat,p.exp,p.nbf].every(Number.isInteger) || p.exp - p.iat !== TTL ||
      p.nbf !== p.iat || p.iat > Math.floor(currentDate.getTime()/1000) + 5 ||
      'torneos_media_upload_session' in p) { // MEDIA-V1: gateway-internal claim, never presented
    throw new Error('invalid token contract');
  }
  return p;
}
