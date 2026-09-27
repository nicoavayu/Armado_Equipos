// GATEWAY REMOTE — HTTPS probes of the deployed gateway (B7 basic certification + the operator-side part of C3/C5).
// No user and no Core session: every bridge token here is minted by the session with the Production k1 for a RANDOM
// identity/Core user, so the best it can reach is the live Core authority (the Core contract `session` verdict for a
// user that does not exist → 401) or the RPC allowlist (403 before any Core call). Nothing is written anywhere: no
// identity is created (/exchange is only called without a valid Core bearer).
import crypto from 'node:crypto';
import https from 'node:https';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { mintBridgeToken } from '../torneos-gateway-auth/bridge-probe.mjs';

const ORIGIN = G.WEB_ORIGIN;

export function gatewayHttps({ url, method = 'GET', headers = {}, body }) {
  const u = new URL(url);
  const payload = body === undefined ? null : Buffer.from(body);
  return new Promise((resolve) => {
    const h = { 'user-agent': 'arma2-torneos-gateway-remote-probe/1', ...headers };
    if (payload) h['content-length'] = payload.length;
    const req = https.request({ host: u.hostname, servername: u.hostname, port: 443, path: u.pathname + u.search, method, headers: h, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => {
        const raw = Buffer.concat(c).toString('utf8');
        let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, json, raw });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: String(e.code ?? e.message).slice(0, 80) }));
    if (payload) req.write(payload);
    req.end();
  });
}

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const brief = (r) => ({ status: r.status, error: typeof r.json?.error === 'string' ? r.json.error : (r.error ?? null), acao: r.headers?.['access-control-allow-origin'] ?? null, cache: r.headers?.['cache-control'] ?? null });

/**
 * base: the public URL (https://<host>/functions/v1/torneos-gateway). jwksPin: the pinned public ring. ring: {k1:{pkcs8,kid}}.
 * known: secret values that must never appear in a response. torneosAnonKey: the one public key /config may return.
 */
export async function probeGateway({ base, jwksPin, ring, known = [], torneosAnonKey, transport = gatewayHttps, alternateHosts = [] }) {
  const checks = [];
  const add = (name, pass, r, extra = {}) => { checks.push({ name, pass: !!pass, ...brief(r ?? {}), ...extra }); return r; };
  const at = (p) => `${base}${p}`;
  const o = { origin: ORIGIN };

  const health = await transport({ url: at('/health'), headers: o });
  add('GET /health (allowed origin) → 200 ready + exact CORS origin + no-store', health.status === 200 && health.json?.ready === true && health.headers?.['access-control-allow-origin'] === ORIGIN && health.headers?.['cache-control'] === 'no-store', health);

  const jwks = await transport({ url: at('/.well-known/jwks.json'), headers: o });
  const want = jwksPin.keys.map((k) => ({ kty: k.kty, n: k.n, e: k.e, kid: k.kid, alg: 'RS256', use: 'sig' }));
  const got = Array.isArray(jwks.json?.keys) ? jwks.json.keys : null;
  const noPrivate = !!got && got.every((k) => ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].every((m) => !(m in k)));
  add('GET /.well-known/jwks.json → exactly the pinned public k1 (active) + k2 (standby), no private member', jwks.status === 200 && noPrivate && canon(got) === canon(want), jwks,
    { kids: got?.map((k) => k.kid) ?? null });

  const cfg = await transport({ url: at('/config'), headers: o });
  const cfgKeys = cfg.json ? Object.keys(cfg.json).sort().join(',') : null;
  const cfgScan = cfg.raw ? G.secretFindings(cfg.raw.split(torneosAnonKey ?? '\u0000').join('«torneos-publishable»'), known) : ['no_body'];
  add('GET /config → {coreUrl, torneosUrl, anonKey}: Core Production URL, gateway /torneos, Torneos publishable key; nothing secret', cfg.status === 200 && cfgKeys === 'anonKey,coreUrl,torneosUrl'
    && cfg.json.coreUrl === `https://${G.CORE_PROD_REF}.supabase.co` && cfg.json.torneosUrl === `${base}/torneos` && cfg.json.anonKey === torneosAnonKey && cfgScan.length === 0, cfg, { secret_findings: cfgScan });

  const foreign = await transport({ url: at('/health'), headers: { origin: 'https://evil.example' } });
  add('GET /health, foreign Origin → 403 origin rejected, no CORS grant', foreign.status === 403 && foreign.json?.error === 'origin rejected' && !foreign.headers?.['access-control-allow-origin'], foreign);
  const nullOrigin = await transport({ url: at('/health'), headers: { origin: 'null' } });
  add('GET /health, Origin null → 403', nullOrigin.status === 403, nullOrigin);
  const lookalike = await transport({ url: at('/health'), headers: { origin: 'https://app.arma2.com.ar.evil.example' } });
  add('GET /health, look-alike Origin → 403', lookalike.status === 403, lookalike);

  const pre = await transport({ url: at('/exchange'), method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
  add('OPTIONS /exchange (allowed origin) → 204 with exact CORS grant', pre.status === 204 && pre.headers?.['access-control-allow-origin'] === ORIGIN, pre);
  const preForeign = await transport({ url: at('/exchange'), method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  add('OPTIONS /exchange (foreign origin) → 403, no CORS grant', preForeign.status === 403 && !preForeign.headers?.['access-control-allow-origin'], preForeign);

  for (const host of alternateHosts) {
    const r = await transport({ url: `https://${host}${new URL(base).pathname}/health`, headers: o });
    add(`GET /health on another hostname of the app (${host}) → 403 (Host check)`, r.status === 403, r);
  }

  const json = { origin: ORIGIN, 'content-type': 'application/json' };
  const ex0 = await transport({ url: at('/exchange'), method: 'POST', headers: json, body: '{}' });
  add('POST /exchange without bearer → 401', ex0.status === 401, ex0);
  const exBad = await transport({ url: at('/exchange'), method: 'POST', headers: { ...json, authorization: 'Bearer not-a-core-token' }, body: '{}' });
  add('POST /exchange with a non-Core bearer → 401 (GoTrue refuses it)', exBad.status === 401, exBad);
  const exBody = await transport({ url: at('/exchange'), method: 'POST', headers: { ...json, authorization: 'Bearer not-a-core-token' }, body: JSON.stringify({ core_user_id: crypto.randomUUID(), role: 'service_role' }) });
  add('POST /exchange with identity/role input → 400 (refused before any Core call)', exBody.status === 400, exBody);
  const exHuge = await transport({ url: at('/exchange'), method: 'POST', headers: json, body: 'x'.repeat(20000) });
  add('POST /exchange with a 20 KB body → refused (4xx, never 2xx)', exHuge.status >= 400 && exHuge.status < 500, exHuge);

  const now = Math.floor(Date.now() / 1000);
  const rpc = (name) => at(`/torneos/rest/v1/rpc/${name}`);
  const r0 = await transport({ url: rpc('get_my_tournament_memberships'), method: 'POST', headers: json, body: '{}' });
  add('POST allowlisted RPC without bearer → 401', r0.status === 401, r0);
  const random = { sub: crypto.randomUUID(), core_user_id: crypto.randomUUID() };
  const k1 = mintBridgeToken({ ...ring.k1, now, overrides: random });
  const off = await transport({ url: rpc('get_tournament_purchase'), method: 'POST', headers: { ...json, authorization: `Bearer ${k1}` }, body: '{}' });
  add('POST commerce RPC (commerce OFF), valid k1 bridge token → 403 rpc not enabled (before any Core call)', off.status === 403 && off.json?.error === 'rpc not enabled', off);
  const off2 = await transport({ url: rpc('create_tournament_season_checkout_purchase'), method: 'POST', headers: { ...json, authorization: `Bearer ${k1}` }, body: '{}' });
  add('POST checkout-creation RPC, valid k1 bridge token → 403 rpc not enabled', off2.status === 403 && off2.json?.error === 'rpc not enabled', off2);
  const commerceRoute = await transport({ url: at('/commerce/v1/season-checkout'), method: 'POST', headers: { ...json, authorization: `Bearer ${k1}` }, body: '{}' });
  add('POST /commerce/v1/season-checkout (commerce OFF) → 404, route absent', commerceRoute.status === 404, commerceRoute);
  const live = await transport({ url: rpc('get_my_tournament_memberships'), method: 'POST', headers: { ...json, authorization: `Bearer ${k1}` }, body: '{}' });
  add('POST allowlisted RPC, valid k1 token for a Core user that does not exist → 401 (live Core authority: session inactive)', live.status === 401 && live.json?.error === 'access denied', live);
  const expired = mintBridgeToken({ ...ring.k1, now: now - 600, overrides: random });
  const exp = await transport({ url: rpc('get_my_tournament_memberships'), method: 'POST', headers: { ...json, authorization: `Bearer ${expired}` }, body: '{}' });
  add('POST allowlisted RPC, expired k1 token → 401', exp.status === 401, exp);
  const ttlBreak = mintBridgeToken({ ...ring.k1, now, overrides: { ...random, exp: now + 3600 } });
  const ttl = await transport({ url: rpc('get_my_tournament_memberships'), method: 'POST', headers: { ...json, authorization: `Bearer ${ttlBreak}` }, body: '{}' });
  add('POST allowlisted RPC, k1 token with exp−iat ≠ 120 → 401 (token contract)', ttl.status === 401, ttl);
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const foreignKey = mintBridgeToken({ pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'), kid: ring.k1.kid, now, overrides: random });
  const fk = await transport({ url: rpc('get_my_tournament_memberships'), method: 'POST', headers: { ...json, authorization: `Bearer ${foreignKey}` }, body: '{}' });
  add('POST allowlisted RPC, token signed by a foreign key under the k1 kid → 401', fk.status === 401, fk);
  const wrongAud = mintBridgeToken({ ...ring.k1, now, overrides: { ...random, aud: 'authenticated' } });
  const wa = await transport({ url: rpc('get_my_tournament_memberships'), method: 'POST', headers: { ...json, authorization: `Bearer ${wrongAud}` }, body: '{}' });
  add('POST allowlisted RPC, k1 token with aud=authenticated → 401', wa.status === 401, wa);

  const nf = await transport({ url: at('/nope'), headers: o });
  add('GET unknown path under the mount → 404', nf.status === 404, nf);
  const outside = await transport({ url: `${new URL(base).origin}/`, headers: o });
  add('GET / (outside the mount) → 404', outside.status === 404, outside);

  // No response may carry any secret the session holds.
  const all = [health, jwks, foreign, ex0, exBad, exBody, off, live].map((r) => r.raw ?? '').join('\n');
  const leaks = G.secretFindings(all, known);
  add('no response body carries a secret the session holds (contract secret, DB passwords, private keys, tokens)', leaks.length === 0, {}, { findings: leaks });
  return { checks, passed: checks.filter((c) => c.pass).length, total: checks.length, pass: checks.every((c) => c.pass) };
}
