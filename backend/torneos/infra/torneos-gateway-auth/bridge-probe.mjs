// GATEWAY/AUTH — PostgREST probes of the post-gateway/auth state (B03 + pre_request), no user, no fixture, no write.
//
// Hosted aud/iss handling is NOT assumed: it is measured. Every bridge-shaped token below names an identity that does
// not exist, so the best any of them can get is the identity gate:
//   k1 (active) / k2 (standby), certified claims → 401 PT401 'invalid identity token'  = the host verified the RS256
//                  signature against custom_jwks AND accepted iss/aud, then private.check_token refused the identity.
//                  Any other 401 = the host refused the token itself → B03_HOST_REJECTS_BRIDGE_TOKEN (STOP; iss/aud is
//                  a human decision, never a silent migration).
//   k1-signed, role=service_role → PT401 (pre_request refuses every non-anon role without a bridge identity).
//   unknown RS256 key, HS256 GoTrue-shaped, alg=none → 401 and NOT PT401 (refused before the database).
//   anon (apikey only) → the public-page table still answers 200 (pre_request lets anon through).
//   With `identity` (the one existing shadow identity, read-only SQL): k1 and k2 tokens for it → 200 with exactly its own
//   row (signature trusted AND identity gate passed AND RLS own_identity); the same token with the payload rewritten
//   (original signature) → 401 NOT PT401 (refused by the JWT check, before the database).
// Recorded, not judged: k1-signed with another aud / another iss (what the host does with them is evidence for later).
import crypto from 'node:crypto';
import { BRIDGE } from './gateway-auth-contract.mjs';

const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
export function mintBridgeToken({ pkcs8, kid, now = Math.floor(Date.now() / 1000), overrides = {} }) {
  const key = crypto.createPrivateKey({ key: Buffer.from(pkcs8, 'base64url'), format: 'der', type: 'pkcs8' });
  const head = b64u({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64u({ core_user_id: crypto.randomUUID(), session_id: crypto.randomUUID(), role: 'authenticated', iss: BRIDGE.issuer, aud: BRIDGE.audience,
    sub: crypto.randomUUID(), iat: now, nbf: now, exp: now + BRIDGE.ttl, jti: crypto.randomUUID(), ...overrides });
  return `${head}.${body}.${crypto.sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
function foreignTokens(now) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const unknown = mintBridgeToken({ pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'), kid: 'arma2-torneos-prod-k1-unknownprobe0000', now });
  const hsKey = crypto.randomBytes(32);
  const hh = b64u({ alg: 'HS256', typ: 'JWT' });
  const hb = b64u({ iss: 'https://example.invalid/auth/v1', aud: 'authenticated', role: 'authenticated', sub: crypto.randomUUID(), iat: now, exp: now + 600 });
  const hs = `${hh}.${hb}.${crypto.createHmac('sha256', hsKey).update(`${hh}.${hb}`).digest('base64url')}`;
  const none = `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ role: 'service_role', iat: now, exp: now + 60 })}.`;
  return { unknown, hs, none };
}

const summarize = (res) => ({ status: res.status, code: typeof res.body?.code === 'string' ? res.body.code : null, message: typeof res.body?.message === 'string' ? res.body.message.slice(0, 120) : null, rows: Array.isArray(res.body) ? res.body.length : null });
const isGate = (s) => s.status === 401 && s.code === 'PT401' && /invalid identity token/.test(s.message ?? '');

const tamper = (token) => {
  const [h, p, sig] = token.split('.');
  const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return `${h}.${b64u({ ...c, sub: crypto.randomUUID() })}.${sig}`;
};
const isOwnRow = (s) => s.status === 200 && s.rows === 1;
const hostRefused = (s) => s.status === 401 && s.code !== 'PT401';

/** ring: { k1: {pkcs8, kid}, k2: {pkcs8, kid} } in memory; identity (optional): { id, core_user_id } of an EXISTING row. */
export async function probeBridge({ ref, apikey, ring, transport, identity = null, anonTable = 'tournament_competition_formats' }) {
  const now = Math.floor(Date.now() / 1000);
  const checks = []; const measured = [];
  const call = async (token, path = '/rest/v1/torneos_identity?select=id&limit=1') => {
    try { return summarize(await transport({ ref, method: 'GET', path, headers: { apikey, ...(token ? { Authorization: `Bearer ${token}` } : {}) } })); } catch (e) { return { status: 0, error: String(e.message).slice(0, 120) }; }
  };
  const judge = async (name, token, expect, path) => { const s = await call(token, path); checks.push({ name, pass: expect(s), ...s }); return s; };
  const k1 = await judge('k1 (active) bridge token, unknown identity → PT401 identity gate (host accepted signature, iss, aud)', mintBridgeToken({ ...ring.k1, now }), isGate);
  await judge('k2 (standby) bridge token, unknown identity → PT401 identity gate', mintBridgeToken({ ...ring.k2, now }), isGate);
  await judge('k1-signed role=service_role → PT401 (pre_request refuses non-bridge roles)', mintBridgeToken({ ...ring.k1, now, overrides: { role: 'service_role' } }), isGate);
  await judge('k1-signed expired token → 401', mintBridgeToken({ ...ring.k1, now: now - 600 }), (s) => s.status === 401);
  if (identity) {
    const bind = { sub: identity.id, core_user_id: identity.core_user_id };
    const own = `/rest/v1/torneos_identity?select=id&id=eq.${identity.id}`;
    const t1 = mintBridgeToken({ ...ring.k1, now, overrides: bind });
    await judge('A k1 (active) bridge token for the existing identity → 200, exactly its own row', t1, isOwnRow, own);
    await judge('E k2 (standby) bridge token for the existing identity → 200, exactly its own row (rotation needs no B03 write)', mintBridgeToken({ ...ring.k2, now, overrides: bind }), isOwnRow, own);
    await judge('D tampered (sub rewritten, original k1 signature) → 401 refused by the JWT check, not PT401', tamper(t1), hostRefused, own);
  }
  const f = foreignTokens(now);
  await judge('unknown RS256 key → 401, refused before the database', f.unknown, (s) => s.status === 401 && s.code !== 'PT401');
  await judge('HS256 GoTrue-shaped token (foreign secret) → 401, refused before the database', f.hs, (s) => s.status === 401 && s.code !== 'PT401');
  await judge('alg=none service_role → 401', f.none, (s) => s.status === 401 && s.code !== 'PT401');
  await judge(`anon (apikey only) → ${anonTable} 200 (pre_request lets anon through)`, null, (s) => s.status === 200 && s.rows !== null, `/rest/v1/${anonTable}?select=*&limit=1`);
  for (const [name, overrides] of [['k1-signed, aud=authenticated', { aud: 'authenticated' }], ['k1-signed, iss=<Core Production GoTrue>', { iss: 'https://core-production.invalid/auth/v1' }], ['k1-signed, no aud', { aud: undefined }]]) {
    measured.push({ name, ...await call(mintBridgeToken({ ...ring.k1, now, overrides })) });
  }
  const accepted = checks.find((c) => c.name.startsWith('A '));
  return { checks, measured, identity_probed: identity ? { id: identity.id.slice(0, 8), core_user_id: identity.core_user_id.slice(0, 8), own_row: accepted?.pass ?? null } : null, passed: checks.filter((c) => c.pass).length, total: checks.length, pass: checks.every((c) => c.pass), hostAcceptsBridge: isGate(k1) };
}
