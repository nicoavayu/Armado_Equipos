// GATEWAY/AUTH — read-only certification of the B03 jwks_url (the gateway's public JWKS) before and after it is published.
//
// The hosted resolver trusts whatever this URL serves, so it is judged as the resolver sees it:
//   HTTPS only, the exact pinned host, 200 with no redirect (node:https never follows one), Content-Type
//   application/json, the body byte-equal to the pinned public k1+k2 (G.customJwksBody), no private JWK member, no
//   secret the session holds, no Set-Cookie. Request input cannot alter it: a query string, a foreign
//   X-Forwarded-Host, and other methods either get the same bytes or are refused — never a different key set.
import https from 'node:https';
import * as G from './gateway-auth-contract.mjs';

const IDLE_TIMEOUT_MS = 15000;

/** GET/POST to the pinned gateway host only. Resolves {status, headers, raw}; a redirect is just a 3xx status here. */
export function jwksHttpsTransport({ method = 'GET', path, headers = {} }) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const req = https.request({ host: G.GATEWAY_HOST, servername: G.GATEWAY_HOST, port: 443, method, path, rejectUnauthorized: true, minVersion: 'TLSv1.2',
      headers: { Accept: 'application/json', 'User-Agent': 'arma2-torneos-gateway-auth/1', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks).toString('utf8'), elapsed_ms: Date.now() - started }));
    });
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error('idle_timeout')));
    req.on('error', (e) => reject(new Error(`request_failed_${e.code ?? e.message}`)));
    req.end();
  });
}

export async function probeJwksUrl({ jwksPin, transport, known = [] }) {
  const url = new URL(G.B03_JWKS_URL);
  const want = JSON.stringify(G.customJwksBody(jwksPin).custom_jwks);
  const checks = [];
  const add = (name, pass, extra = {}) => checks.push({ name, pass: !!pass, ...extra });
  add('jwks_url is https on the exact pinned gateway host, default port, no credentials/query/fragment',
    url.protocol === 'https:' && url.hostname === G.GATEWAY_HOST && url.port === '' && !url.username && !url.password && !url.search && !url.hash, { url: G.B03_JWKS_URL });
  const get = async (name, opts) => { try { return await transport({ path: url.pathname, ...opts }); } catch (e) { return { status: 0, headers: {}, raw: '', error: String(e.message).slice(0, 120) }; } };
  const r = await get('base', {});
  let body = null; try { body = JSON.parse(r.raw); } catch { body = null; }
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  add('GET → 200, no redirect', r.status === 200, { status: r.status, location: r.headers?.location ?? null });
  add('Content-Type application/json', /^application\/json(;|$)/.test(String(r.headers?.['content-type'] ?? '')), { content_type: r.headers?.['content-type'] ?? null });
  add('no Set-Cookie', !r.headers?.['set-cookie']);
  add('body byte-equal to the pinned public k1+k2', r.raw === want, { bytes: r.raw.length, sha256: G.sha256(r.raw), pin_sha256: G.sha256(want) });
  add('kids exactly the pin, in order', JSON.stringify(keys.map((k) => k.kid)) === JSON.stringify(jwksPin.keys.map((k) => k.kid)), { kids: keys.map((k) => k.kid ?? null) });
  add('only public RSA members (kty n e kid alg use), no private member', keys.length === 2 && keys.every((k) => Object.keys(k).sort().join(',') === 'alg,e,kid,kty,n,use' && !G.PRIVATE_JWK_MEMBERS.some((m) => m in k)));
  add('no secret-shaped or known secret value in the response', G.secretFindings(r.raw + JSON.stringify(r.headers ?? {}), known).length === 0);
  // Request input cannot select or alter the key set.
  const q = await get('query', { path: `${url.pathname}?kid=attacker&keys=%5B%5D&jwks=x` });
  add('query string → same bytes (ignored)', q.status === 200 && q.raw === want, { status: q.status });
  const xf = await get('xfh', { headers: { 'X-Forwarded-Host': 'attacker.invalid' } });
  add('foreign X-Forwarded-Host → same bytes or refused, never another key set', (xf.status === 200 && xf.raw === want) || xf.status === 403, { status: xf.status });
  const origin = await get('origin', { headers: { Origin: 'https://attacker.invalid' } });
  add('foreign Origin → 403 (browser clients); the resolver sends none', origin.status === 403, { status: origin.status });
  const post = await get('post', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  add('POST → not 200 (no write path)', post.status !== 200 && post.raw !== want, { status: post.status });
  return { url: G.B03_JWKS_URL, checks, passed: checks.filter((c) => c.pass).length, total: checks.length, pass: checks.every((c) => c.pass), sha256: G.sha256(r.raw) };
}
