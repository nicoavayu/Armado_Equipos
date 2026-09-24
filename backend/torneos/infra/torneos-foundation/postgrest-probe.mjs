// INFRA-1 R3 — remote PostgREST certification of Arma2 Torneos, with no user and no fixture.
//
// Host: exactly https://<torneos ref>.supabase.co/rest/v1/… (the ref is the created project's, never a
// known Core ref). Requests: GETs, and POST /rpc/<name> ONLY for functions the catalog proves anon cannot
// execute (so the call can only be refused — no side effect is reachable). The anon-level key is the
// project's publishable (or legacy anon) key: public by design, still never written to evidence.
// Wrong-role tokens are forged here with throwaway keys and must all be rejected with 401:
//   HS256 {role: service_role} signed with a random secret · alg none · RS256 bridge-shaped claims signed
//   with an ephemeral RSA key (no custom_jwks trusts it — the negative half of B03).
import https from 'node:https';
import crypto from 'node:crypto';
import * as F from './foundation-contract.mjs';

const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
export function forgeTokens(nowSec = Math.floor(Date.now() / 1000)) {
  const hsKey = crypto.randomBytes(32);
  const hsHead = b64u({ alg: 'HS256', typ: 'JWT' });
  const hsBody = b64u({ role: 'service_role', iss: 'supabase', iat: nowSec, exp: nowSec + 60 });
  const hs = `${hsHead}.${hsBody}.${crypto.createHmac('sha256', hsKey).update(`${hsHead}.${hsBody}`).digest('base64url')}`;
  const none = `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ role: 'service_role', iat: nowSec, exp: nowSec + 60 })}.`;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsHead = b64u({ alg: 'RS256', typ: 'JWT', kid: 'infra1-r3-untrusted-probe' });
  const rsBody = b64u({ iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local', role: 'authenticated', sub: crypto.randomUUID(), core_user_id: crypto.randomUUID(), session_id: crypto.randomUUID(), jti: crypto.randomUUID(), iat: nowSec, nbf: nowSec, exp: nowSec + 120 });
  const rs = `${rsHead}.${rsBody}.${crypto.sign('sha256', Buffer.from(`${rsHead}.${rsBody}`), privateKey).toString('base64url')}`;
  return { hs, none, rs };
}

export function assertProbeTarget(ref, reqPath, method) {
  if (!F.REF_PATTERN.test(ref ?? '') || F.KNOWN_REFS.includes(ref)) throw new Error('probe_ref_invalid');
  if (!/^\/rest\/v1\/[A-Za-z0-9_/?=.&,*-]*$/.test(reqPath)) throw new Error('probe_path_invalid');
  if (method === 'POST' && !/^\/rest\/v1\/rpc\/[a-z_]+$/.test(reqPath)) throw new Error('probe_post_only_rpc');
  if (method === 'POST' && !F.PROBE_DENIED_RPCS.includes(reqPath.split('/').pop())) throw new Error('probe_rpc_not_in_denied_set');
  if (method !== 'GET' && method !== 'POST') throw new Error('probe_method');
}

export function httpsProbeTransport({ ref, method, path, headers, body }) {
  assertProbeTarget(ref, path, method);
  const host = `${ref}.supabase.co`;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const h = { Accept: 'application/json', 'User-Agent': 'arma2-torneos-infra1-r3-postgrest-probe/1', ...headers };
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = payload.length; }
    const req = https.request({ host, servername: host, port: 443, method, path, headers: h, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); resolve({ status: res.statusCode, body: null, redirect: true }); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; } resolve({ status: res.statusCode, body: parsed, raw }); });
    });
    req.setTimeout(20000, () => req.destroy(new Error('idle_timeout')));
    req.on('error', (e) => reject(new Error(`probe_request_failed_${e.code ?? e.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

const DENIED = [401, 403, 404];
/** Only what is safe to persist from a PostgREST answer: status, PostgREST code, a short message. */
const summarize = (res) => ({ status: res.status, code: typeof res.body?.code === 'string' ? res.body.code : null, message: typeof res.body?.message === 'string' ? res.body.message.slice(0, 120) : null, rows: Array.isArray(res.body) ? res.body.length : null });

export async function probePostgrest({ ref, apikey, transport = httpsProbeTransport, tokens = forgeTokens() }) {
  if (typeof apikey !== 'string' || apikey.length < 20) throw new Error('probe_apikey_missing');
  const checks = [];
  const run = async (name, expect, { method = 'GET', path, headers = {}, body }) => {
    let res;
    try { res = await transport({ ref, method, path, headers, body }); } catch (e) { checks.push({ name, pass: false, error: String(e.message).slice(0, 120) }); return null; }
    const s = summarize(res);
    const pass = expect(res, s);
    checks.push({ name, method, path, pass, ...s });
    return res;
  };
  const anon = { apikey };
  await run('unauthenticated: no apikey is refused', (r) => r.status === 401, { path: '/rest/v1/torneos_identity?select=id&limit=1' });
  for (const t of F.PROBE_DENIED_TABLES) {
    await run(`anon: internal table ${t} is refused`, (r) => DENIED.includes(r.status), { path: `/rest/v1/${t}?select=*&limit=1`, headers: anon });
  }
  await run(`anon: public-page table ${F.PROBE_ANON_READ_TABLE} is readable (RLS-filtered)`, (r) => r.status === 200 && Array.isArray(r.body), { path: `/rest/v1/${F.PROBE_ANON_READ_TABLE}?select=*&limit=1`, headers: anon });
  await run('anon: private schema is not exposed (Accept-Profile private)', (r) => r.status === 406 || DENIED.includes(r.status), { path: '/rest/v1/core_contract_attestations?select=*&limit=1', headers: { ...anon, 'Accept-Profile': 'private' } });
  for (const fn of F.PROBE_DENIED_RPCS) {
    await run(`anon: RPC ${fn} is refused`, (r) => DENIED.includes(r.status), { method: 'POST', path: `/rest/v1/rpc/${fn}`, headers: anon, body: {} });
  }
  await run('wrong role: forged HS256 service_role token → 401', (r) => r.status === 401, { path: '/rest/v1/tournament_payment_provider_watermarks?select=*&limit=1', headers: { ...anon, Authorization: `Bearer ${tokens.hs}` } });
  await run('wrong role: alg=none token → 401', (r) => r.status === 401, { path: '/rest/v1/tournament_payment_provider_watermarks?select=*&limit=1', headers: { ...anon, Authorization: `Bearer ${tokens.none}` } });
  await run('untrusted RS256 bridge-shaped token → 401 (no custom_jwks trust)', (r) => r.status === 401, { method: 'POST', path: '/rest/v1/rpc/get_my_tournament_memberships', headers: { ...anon, Authorization: `Bearer ${tokens.rs}` }, body: {} });
  // OpenAPI root: record whether it answers and, if it does, that no internal object is described.
  const root = await transport({ ref, method: 'GET', path: '/rest/v1/', headers: anon }).catch((e) => ({ status: 0, error: e.message }));
  const paths = root?.body && typeof root.body === 'object' && root.body.paths ? Object.keys(root.body.paths) : null;
  const leaked = (paths ?? []).filter((p) => F.PROBE_DENIED_TABLES.some((t) => p === `/${t}`) || F.PROBE_DENIED_RPCS.some((fn) => p === `/rpc/${fn}`));
  checks.push({ name: 'anon: OpenAPI root does not describe internal tables/RPCs', method: 'GET', path: '/rest/v1/', status: root?.status ?? 0, pass: leaked.length === 0 && [200, 401, 403, 404].includes(root?.status), described_paths: paths ? paths.length : null, leaked });
  return { checks, passed: checks.filter((c) => c.pass).length, total: checks.length, pass: checks.every((c) => c.pass) };
}
