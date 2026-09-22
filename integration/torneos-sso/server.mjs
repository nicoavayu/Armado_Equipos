import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { decodeJwt } from 'jose';
import pg from 'pg';
import { issueToken, verifyToken, uuid, TTL } from './token.mjs';

const origin = 'http://127.0.0.1:58410';
const readConfig = async () => JSON.parse(await readFile('.runtime/server/config.json', 'utf8'));
const initial = await readConfig();
const core = new pg.Pool({ host: 'core-db', database: 'postgres', user: 'poc_session_reader',
  password: initial.readerPassword, connectionTimeoutMillis: 2000, statement_timeout: 2000 });
const torneos = new pg.Pool({ host: 'torneos-db', database: 'postgres', user: 'poc_identity_writer',
  password: initial.writerPassword, connectionTimeoutMillis: 2000, statement_timeout: 2000 });
for (const pool of [core,torneos]) pool.on('error', () => console.error('local database unavailable'));
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
class Unavailable extends Error {}
async function dependencyFetch(url, options) {
  try { return await fetch(url, options); } catch { throw new Unavailable(); }
}
function bearer(req) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ') || value.length > 12000) throw new Error('unauthorized');
  return value.slice(7);
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function activeSession(userId, sessionId) {
  if (!uuid(userId) || !uuid(sessionId)) throw new Error('unauthorized');
  // Explicit fail-closed contract even if GoTrue is down while its DB is alive.
  const health = await dependencyFetch('http://core-auth:9999/health', { signal: AbortSignal.timeout(2000) });
  if (!health.ok) throw new Unavailable();
  const { rowCount } = await core.query(`SELECT s.id FROM auth.sessions s
    JOIN auth.users u ON u.id = s.user_id WHERE s.id = $1 AND s.user_id = $2
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND (s.not_after IS NULL OR s.not_after > now())`, [sessionId,userId]);
  if (rowCount !== 1) throw new Error('inactive session');
}
async function verifiedCore(token) {
  const response = await dependencyFetch('http://core-auth:9999/user', {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('unauthorized');
  const user = await response.json();
  // Decode only after GoTrue has cryptographically verified this exact bearer.
  const p = decodeJwt(token);
  if (p.sub !== user.id || p.aud !== 'authenticated' || p.role !== 'authenticated' ||
      p.iss !== `${origin}/auth/v1` || user.is_anonymous === true) throw new Error('unauthorized');
  await activeSession(user.id, p.session_id);
  return { userId: user.id, sessionId: p.session_id };
}
async function proxy(req, res, url, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  for (const name of ['accept','content-type','prefer','range']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const r = await dependencyFetch(url, { method: req.method, headers,
    body: ['GET','HEAD'].includes(req.method) ? undefined : await body(req),
    redirect: 'error', signal: AbortSignal.timeout(5000) });
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json',
    'cache-control': 'no-store', ...(r.headers.has('content-range') ? { 'content-range': r.headers.get('content-range') } : {}) });
  res.end(Buffer.from(await r.arrayBuffer()));
}
const server = http.createServer(async (req,res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
  try {
    if (req.headers.host !== '127.0.0.1:58410' ||
        (req.headers.origin && req.headers.origin !== origin)) return json(res, 403, { error: 'origin rejected' });
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/config') {
      return json(res, 200, { coreUrl: origin, torneosUrl: `${origin}/torneos`,
        anonKey: initial.anonKey });
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      const r = await dependencyFetch('http://core-auth:9999/health', { signal: AbortSignal.timeout(2000) });
      return json(res, r.ok ? 200 : 503, { ready: r.ok });
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      const path = url.pathname.slice('/auth/v1'.length);
      const allowed = { '/signup': ['POST'], '/token': ['POST'], '/user': ['GET'], '/logout': ['POST'] };
      if (!allowed[path]?.includes(req.method)) return json(res, 404, { error: 'not found' });
      return await proxy(req,res,`http://core-auth:9999${path}${url.search}`,
        req.headers.authorization ? bearer(req) : undefined);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      return await proxy(req, res, `http://core-rest:3000${url.pathname.slice('/rest/v1'.length)}${url.search}`,
        req.headers.authorization ? bearer(req) : undefined);
    }
    if (req.method === 'POST' && url.pathname === '/exchange') {
      const raw = await body(req);
      if (raw.length && raw.toString() !== '{}') return json(res, 400, { error: 'exchange accepts no identity or role input' });
      const c = await verifiedCore(bearer(req));
      const { rows: [identity] } = await torneos.query(`INSERT INTO public.torneos_identity(core_user_id)
        VALUES ($1) ON CONFLICT(core_user_id) DO UPDATE SET core_user_id = EXCLUDED.core_user_id
        RETURNING id,core_user_id`, [c.userId]);
      const token = await issueToken(await readConfig(), identity, c.sessionId);
      return json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: TTL });
    }
    if (/^\/torneos\/rest\/v1\/(sso_probe|torneos_identity)$/.test(url.pathname)
        && ['GET','HEAD','POST','PATCH','DELETE'].includes(req.method)) {
      const token = bearer(req);
      const p = await verifyToken(token, await readConfig());
      await activeSession(p.core_user_id, p.session_id);
      const { rowCount } = await torneos.query('SELECT id FROM public.torneos_identity WHERE id=$1 AND core_user_id=$2', [p.sub,p.core_user_id]);
      if (rowCount !== 1) throw new Error('identity mismatch');
      return await proxy(req,res,`http://torneos-rest:3000${url.pathname.slice('/torneos/rest/v1'.length)}${url.search}`,token);
    }
    if (req.method === 'GET' && (['/', '/torneos', '/terms', '/privacy', '/login', '/auth/callback'].includes(url.pathname)
      || /^\/static\/[a-zA-Z0-9/_.-]+$/.test(url.pathname))) {
      const asset = url.pathname.startsWith('/static/') ? url.pathname : '/index.html';
      if (asset.includes('..')) return json(res, 404, { error: 'not found' });
      const mime = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css'
        : asset.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      const bytes = await readFile(`dist${asset}`);
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
      return res.end(bytes);
    }
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    // Never log request, bearer, SQL, errors with context, or response bodies.
    if (!res.headersSent) json(res, error instanceof Unavailable || ['ECONNREFUSED', '57P01', 'ETIMEDOUT'].includes(error?.code) ? 503 : 401, { error: 'access denied' });
    else res.end();
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(58410, '0.0.0.0', () => console.log('Isolated SSO gateway ready'));
