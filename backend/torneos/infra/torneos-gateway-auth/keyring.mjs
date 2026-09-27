// GATEWAY/AUTH — the Production bridge key ring (B03). Pure functions; custody is keychain-gateway-auth.mjs.
//
//   generateRing()      a NEW ring, generated here, in memory: k1 (active) + k2 (standby), RSA 2048, RS256. There is
//                       no import: no existing key (nonprod, Staging, lab, a file) can enter the Production ring.
//   kid                 arma2-torneos-prod-<slot>-<first 16 chars of the RFC 7638 thumbprint>: unique, derived from
//                       the key itself, never a nonprod name (p3a-*, p3b-*, t-*, r3-*, fixture*).
//   publicJwks()        the public halves only (kty/n/e/kid/alg/use) — the pin (pins/production-bridge-jwks.json) and
//                       the custom_jwks body are derived from it and nothing else.
//   gatewayRingDocument the TORNEOS_BRIDGE_KEYS the gateway will run with: k1 private+public (active), k2 PUBLIC ONLY
//                       (trusted, so a rotation never waits for B03), trustedKids [k1, k2]. k2's private half stays in
//                       custody until the rotation that activates it.
//   rotationPlan()      the safe order for k1 → k2 (documented and tested; executed only in a later, separate phase).
import crypto from 'node:crypto';
import { KID_PATTERN, RING_SLOTS, RSA_MODULUS_BITS, BRIDGE, sha256 } from './gateway-auth-contract.mjs';

export const NONPROD_KID = /^(p3a|p3b|t|r3|r4|r5|lab|fixture|staging|nonprod|test|local)[-_]/i;

export function thumbprint(jwk) {
  // RFC 7638: the required members, lexicographic, no whitespace.
  return crypto.createHash('sha256').update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).digest('base64url');
}
const publicOf = (jwk, kid) => ({ kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: BRIDGE.alg, use: 'sig' });

export function assertProductionKid(kid, slot) {
  if (!KID_PATTERN.test(kid) || !kid.includes(`-${slot}-`) || NONPROD_KID.test(kid)) throw new Error(`kid_not_production_${slot}`);
  return kid;
}

/** A fresh ring, in memory. Returns { slots: [{slot, kid, pkcs8, publicJwk}], jwks }. */
export function generateRing({ generateKeyPair = crypto.generateKeyPairSync } = {}) {
  const slots = RING_SLOTS.map((slot) => {
    const { privateKey, publicKey } = generateKeyPair('rsa', { modulusLength: RSA_MODULUS_BITS, publicExponent: 0x10001 });
    const jwk = publicKey.export({ format: 'jwk' });
    const kid = assertProductionKid(`arma2-torneos-prod-${slot}-${thumbprint(jwk).slice(0, 16)}`, slot);
    return { slot, kid, pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'), publicJwk: publicOf(jwk, kid) };
  });
  if (slots[0].publicJwk.n === slots[1].publicJwk.n) throw new Error('ring_slots_identical');
  return { slots, jwks: { keys: slots.map((s) => s.publicJwk) } };
}

/** Rebuilds the public JWK from a private key in custody and checks it against the pin (so custody ≡ pin, always). */
export function publicFromPkcs8(pkcs8b64u, kid) {
  const key = crypto.createPrivateKey({ key: Buffer.from(pkcs8b64u, 'base64url'), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== RSA_MODULUS_BITS) throw new Error('custody_key_not_rsa_2048');
  return publicOf(crypto.createPublicKey(key).export({ format: 'jwk' }), kid);
}

export function jwksPinDocument(jwks, { generatedAt }) {
  const doc = { purpose: 'Arma2 Torneos PRODUCTION bridge ring — PUBLIC halves only (custom_jwks B03 + gateway trust)', generated_at: generatedAt,
    alg: BRIDGE.alg, modulus_bits: RSA_MODULUS_BITS, active: jwks.keys[0].kid, standby: jwks.keys[1].kid, keys: jwks.keys,
    custody: { service: 'arma2-torneos-prod-bridge', accounts: RING_SLOTS.flatMap((s) => [`${s}.meta`, `${s}.part*`]) } };
  assertJwksPin(doc);
  return doc;
}
export function assertJwksPin(doc) {
  if (!doc || !Array.isArray(doc.keys) || doc.keys.length !== 2) throw new Error('jwks_pin_shape');
  doc.keys.forEach((k, i) => {
    assertProductionKid(k.kid, RING_SLOTS[i]);
    if (Object.keys(k).sort().join(',') !== 'alg,e,kid,kty,n,use' || k.kty !== 'RSA' || k.alg !== 'RS256' || k.use !== 'sig') throw new Error('jwks_pin_key_shape');
    if (!k.kid.endsWith(thumbprint(k).slice(0, 16))) throw new Error('jwks_pin_kid_not_thumbprint');
  });
  if (doc.active !== doc.keys[0].kid || doc.standby !== doc.keys[1].kid) throw new Error('jwks_pin_roles');
  return doc;
}
export const jwksDigest = (jwks) => sha256(JSON.stringify({ keys: jwks.keys.map((k) => ({ kty: k.kty, n: k.n, e: k.e, kid: k.kid, alg: 'RS256', use: 'sig' })) }));

/** TORNEOS_BRIDGE_KEYS for the gateway: k1 active (private + public), k2 standby (public only). */
export function gatewayRingDocument({ k1Pkcs8, jwksPin }) {
  assertJwksPin(jwksPin);
  const [k1, k2] = jwksPin.keys;
  const k1Pub = publicFromPkcs8(k1Pkcs8, k1.kid);
  if (k1Pub.n !== k1.n || k1Pub.e !== k1.e) throw new Error('custody_k1_differs_from_pin');
  const pem = crypto.createPrivateKey({ key: Buffer.from(k1Pkcs8, 'base64url'), format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' });
  return { activeKid: k1.kid, trustedKids: [k1.kid, k2.kid], keys: [{ kid: k1.kid, privateKey: pem, publicKey: k1 }, { kid: k2.kid, publicKey: k2 }] };
}

/**
 * The safe rotation k1 → k2 (then a new standby k3). Pure plan; nothing here runs it. Each step keeps every token that can
 * still be alive (TTL 120 s + tolerance 5 s) verifiable by BOTH the gateway and PostgREST.
 */
export function rotationPlan(jwksPin) {
  assertJwksPin(jwksPin);
  const [k1, k2] = jwksPin.keys.map((k) => k.kid);
  const drain = BRIDGE.ttl + BRIDGE.toleranceSeconds;
  return [
    { step: 1, where: 'gateway env', action: `TORNEOS_BRIDGE_KEYS: add ${k2} private half from custody; activeKid=${k2}; trustedKids=[${k1}, ${k2}]; redeploy`, custom_jwks: 'unchanged [k1, k2] (k2 already trusted: B03 needs no write)' },
    { step: 2, where: 'wait', action: `≥ ${drain} s after the redeploy is live (TTL ${BRIDGE.ttl} s + tolerance ${BRIDGE.toleranceSeconds} s): no k1-signed token can still verify` },
    { step: 3, where: 'custody', action: 'generate k3 (new standby) with --keyring-generate semantics into its own slot; new public pin [k2, k3]' },
    { step: 4, where: 'Torneos Auth (B03)', action: `POST third-party-auth {custom_jwks:[${k2}, k3]} FIRST (both integrations trusted), then DELETE the [${k1}, ${k2}] integration — third-party-auth has no PATCH` },
    { step: 5, where: 'gateway env', action: `trustedKids=[${k2}, k3]; drop ${k1}; redeploy` },
    { step: 6, where: 'custody', action: `retire ${k1} (Keychain entry kept, marked retired; never reused)` },
  ];
}

/**
 * Splits a base64url private key into Keychain-sized parts. `security add-generic-password -w` reads the value from a
 * prompt; macOS getpass(3) keeps at most 128 bytes and a canonical tty line 1024, so every stored line (part or meta)
 * stays under 100 characters. The meta digest is 128 bits: integrity of the reassembly (the public key is re-derived
 * and compared with the pin anyway).
 */
export const PART_CHARS = 100;
export const MAX_PARTS = 20;
export function splitParts(pkcs8b64u, kid) {
  if (!/^[A-Za-z0-9_-]{1000,4000}$/.test(pkcs8b64u)) throw new Error('pkcs8_shape');
  if (!KID_PATTERN.test(kid)) throw new Error('kid_shape');
  const parts = [];
  for (let i = 0; i < pkcs8b64u.length; i += PART_CHARS) parts.push(pkcs8b64u.slice(i, i + PART_CHARS));
  if (parts.length > MAX_PARTS) throw new Error('pkcs8_too_many_parts');
  const meta = `v1;kid=${kid};parts=${parts.length};sha256=${sha256(pkcs8b64u).slice(0, 32)}`;
  if (meta.length >= 100) throw new Error('meta_too_long');
  return { parts, meta };
}
export function parseMeta(meta) {
  const m = /^v1;kid=([A-Za-z0-9_-]{1,64});parts=(\d{1,2});sha256=([0-9a-f]{32})$/.exec(meta ?? '');
  if (!m) throw new Error('custody_meta');
  return { kid: m[1], parts: Number(m[2]), sha256: m[3] };
}
export function joinParts(meta, parts, kid) {
  const m = parseMeta(meta);
  if (m.kid !== kid) throw new Error('custody_kid_differs_from_pin');
  if (m.parts !== parts.length) throw new Error('custody_meta_parts');
  const whole = parts.join('');
  if (sha256(whole).slice(0, 32) !== m.sha256) throw new Error('custody_parts_digest');
  return whole;
}
