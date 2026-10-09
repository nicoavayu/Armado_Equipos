// Phase 3A gateway: the certified Phase 1.5 identity bridge (integration/torneos-sso/server.mjs
// at b5c5d4af — same token contract, same exchange, same online session check, same
// proxy) plus the four Core-dependent RPC routes served through the real adapter.
// Differences from Phase 1.5 are confined to: the loopback port, the Torneos database
// roles of the certified baseline (torneos_identity_writer / torneos_core_adapter
// instead of the PoC writer), the RPC pre-step, and the removal of the static app and
// Core REST proxy that this lab does not exercise. token.mjs is mounted verbatim.
// Phase 2D: an explicit staging v1 RPC allowlist (backend/torneos/phase2d/staging-v1-rpc-allowlist.json,
// mounted read-only) gates POST /torneos/rest/v1/rpc/<name>; any other RPC is refused after the
// bearer is verified, even for a valid Core session. The database ACL stays the final boundary.
// MP-A4: commerce runs the SAME module as the Edge gateway (functions/torneos-gateway/commerce.ts, mounted
// read-only by the commerce overlay). Its configuration comes, like everything else this lab gateway knows,
// from its private .runtime/server directory (commerce.env: the mode, the internal payments URL and its HMAC
// key, validated by commerce.ts). No file or a blank mode → commerce OFF and the module is never loaded; a
// faulty commerce configuration disables the gateway (503 on every request), as a boot fault does on Edge.
// COMPETITION-V1: the SAME competition.ts as the Edge gateway (mounted read-only with its allowlist): the
// full-competition RPCs on top of the 43 on the authenticated route, and the anonymous public read-only route
// POST /torneos/public/v1/rpc/<name>. A malformed competition allowlist disables the gateway.
// CONNECTED-V1: the same connected.ts loads connected-v1-rpc-allowlist.json when TORNEOS_CONNECTED_MODE=on.
// BRANDING-V1: the same branding.ts (mounted by compose.branding.yaml) when TORNEOS_BRANDING_MODE=on: the branding
// RPCs, the object route to the Torneos storage of the lab and signed URLs in the branding responses.
// MEDIA-V1: the same media.ts (mounted by compose.media.yaml) when TORNEOS_MEDIA_MODE=on: the gallery RPCs, the upload
// route (verified photo, gateway-claim write + completion) and the signed-read route, against the lab's Torneos storage.
// OFFICIALIZATION-V1: the same competition.ts loads officialization-v1-rpc-allowlist.json (membership + dual-control
// policy) onto the authenticated route; accept_tournament_organization_invitation goes through the adapter.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { decodeJwt } from 'jose';
import pg from 'pg';
import { issueMediaUploadToken, issueToken, verifyToken, uuid, TTL } from './token.mjs';
import { CoreClient, Denied } from './core-client.mjs';
import { Adapter, AdapterDenied, CONTRACTS } from './adapter.mjs';

const origin = 'http://127.0.0.1:58420';
// The loopback origin the browser-facing bridge presents. Default: this gateway's own published port. A second lab
// gateway on the same lab (MEDIA-V1's, beside the preview's) is published on another loopback port of the 584xx lab
// range; `origin` stays the Core issuer base either way.
const publicOrigin = process.env.PHASE3A_GATEWAY_PUBLIC_ORIGIN || origin;
if (!/^http:\/\/127\.0\.0\.1:584[0-9]{2}$/.test(publicOrigin)) throw new Error('PHASE3A_GATEWAY_PUBLIC_ORIGIN must be a 584xx loopback origin');
const readConfig = async () => JSON.parse(await readFile('.runtime/server/config.json', 'utf8'));
const initial = await readConfig();
// Staging v1 RPC allowlist: fail closed if the file is missing, malformed or empty.
const allowlistDoc = JSON.parse(await readFile('staging-v1-rpc-allowlist.json', 'utf8'));
const RPC_ALLOWLIST = new Set(Object.values(allowlistDoc.features ?? {}).flat().filter(n => /^[a-z0-9_]+$/.test(n)));
if (RPC_ALLOWLIST.size === 0) throw new Error('staging v1 RPC allowlist is empty');
const competitionModule = await import('./functions/torneos-gateway/competition.ts');
const competition = competitionModule.loadCompetitionContract(RPC_ALLOWLIST);
const COMPETITION_ALLOWLIST = competitionModule.withCompetition(RPC_ALLOWLIST, competition);
const BASE_ALLOWLIST = competitionModule.withOfficialization(COMPETITION_ALLOWLIST,
  competitionModule.loadOfficializationContract(COMPETITION_ALLOWLIST, competition));
const publicGate = new competitionModule.PublicGate();
const pool = (host, user, password) => new pg.Pool({ host, database: 'postgres', user, password,
  connectionTimeoutMillis: 2000, statement_timeout: 2000 });
const core = pool('core-db', 'poc_session_reader', initial.readerPassword);
const identity = pool('torneos-db', 'lab_identity_writer', initial.writerPassword);
const adapterPool = pool('torneos-db', 'lab_core_adapter', initial.adapterPassword);
for (const p of [core, identity, adapterPool]) p.on('error', () => console.error('local database unavailable'));
// The Core service secret lives only in this server process and in Core's function env.
const adapter = new Adapter(adapterPool, new CoreClient(initial.coreContractUrl, Buffer.from(initial.coreContractSecret, 'hex')));
let commerce = { mode: 'off' };
let commerceModule = null;
let disabled = false;
const commerceEnv = await readFile('.runtime/server/commerce.env', 'utf8').then(
  (text) => Object.fromEntries(text.split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1)])),
  (error) => (error?.code === 'ENOENT' ? {} : null));
if (commerceEnv === null || (commerceEnv.TORNEOS_COMMERCE_MODE ?? '').trim()) {
  try {
    if (commerceEnv === null) throw new Error('commerce configuration unreadable');
    commerceModule = await import('./functions/torneos-gateway/commerce.ts');
    commerce = commerceModule.loadCommerceConfig(commerceEnv, { baseAllowlist: BASE_ALLOWLIST, gatewayPublicUrl: origin,
      distinctFrom: [initial.coreContractSecret, initial.anonKey, ...initial.keys.map(k => k.privateKey)] });
  } catch (error) {
    disabled = true;
    console.error(`[gateway] disabled: ${error?.constructor?.name === 'CommerceConfigError' ? error.message : 'boot failed'}`);
  }
}
const servedAllowlist = commerceModule && !disabled ? commerceModule.effectiveRpcAllowlist(BASE_ALLOWLIST, commerce) : BASE_ALLOWLIST;
// CONNECTED-V1: the SAME connected.ts as the Edge gateway (mounted read-only with its allowlist), driven by the
// container's TORNEOS_CONNECTED_MODE (absent/off = unchanged). A faulty mode or document disables the gateway.
const connectedModule = await import('./functions/torneos-gateway/connected.ts');
let connected = { mode: 'off', rpcs: new Set(), publicRpcs: new Set() };
try {
  connected = connectedModule.loadConnectedContract(process.env, servedAllowlist, competition.publicRpcs);
} catch (error) {
  disabled = true;
  console.error(`[gateway] disabled: ${error?.constructor?.name === 'ConnectedConfigError' ? error.message : 'boot failed'}`);
}
const connectedAllowlist = connectedModule.withConnected(servedAllowlist, connected);
// BRANDING-V1: loaded only when the overlay turns it on (the module is mounted only then). A fault disables the gateway.
let branding = { mode: 'off', rpcs: new Set() };
let brandingModule = null;
if (!['', 'off'].includes((process.env.TORNEOS_BRANDING_MODE ?? '').trim())) {
  try {
    brandingModule = await import('./functions/torneos-gateway/branding.ts');
    branding = brandingModule.loadBrandingContract(process.env, connectedAllowlist, 'http://torneos-rest:3000', initial.anonKey,
      undefined, new Set([...competition.publicRpcs, ...connected.publicRpcs]));
  } catch (error) {
    disabled = true;
    console.error(`[gateway] disabled: ${error?.constructor?.name === 'BrandingConfigError' ? error.message : 'boot failed'}`);
  }
}
const brandedAllowlist = brandingModule && branding.mode === 'on' ? brandingModule.withBranding(connectedAllowlist, branding) : connectedAllowlist;
// MEDIA-V1: loaded only when the overlay turns it on (the module is mounted only then). A fault disables the gateway.
let media = { mode: 'off', rpcs: new Set() };
let mediaModule = null;
if (!['', 'off'].includes((process.env.TORNEOS_MEDIA_MODE ?? '').trim())) {
  try {
    mediaModule = await import('./functions/torneos-gateway/media.ts');
    media = mediaModule.loadMediaContract(process.env, brandedAllowlist, 'http://torneos-rest:3000');
  } catch (error) {
    disabled = true;
    console.error(`[gateway] disabled: ${error?.constructor?.name === 'MediaConfigError' ? error.message : 'boot failed'}`);
  }
}
const rpcAllowlist = mediaModule && media.mode === 'on' ? mediaModule.withMedia(brandedAllowlist, media) : brandedAllowlist;

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
    AND (s.not_after IS NULL OR s.not_after > now())`, [sessionId, userId]);
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
async function proxy(req, res, url, token, raw, rpc = null) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  for (const name of ['accept', 'content-type', 'prefer', 'range']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const r = await dependencyFetch(url, { method: req.method, headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : (raw ?? await body(req)),
    redirect: 'error', signal: AbortSignal.timeout(5000) });
  let payload = await r.arrayBuffer();
  // BRANDING-V1: the branding context gets signed URLs, signed with the caller's own token (storage RLS decides).
  if (token && rpc && r.status === 200 && branding.mode === 'on' && brandingModule.SIGNED_AUTHENTICATED_RPCS.has(rpc)) {
    payload = await brandingModule.signResponseBody(new Uint8Array(payload), branding, { bearer: token, apikey: null });
  }
  // ERROR-CONTRACT-V1: same competition.ts rule as the Edge gateway (legacy-SQLSTATE domain error → contract status).
  res.writeHead(competitionModule.domainErrorStatus(r.status, payload), { 'content-type': r.headers.get('content-type') ?? 'application/json',
    'cache-control': 'no-store', ...(r.headers.has('content-range') ? { 'content-range': r.headers.get('content-range') } : {}) });
  res.end(Buffer.from(payload));
}
async function allocateIdentity(coreUserId) {
  const c = await identity.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE torneos_identity_writer');
    // The certified bridge upsert: same row, same identity, on every exchange.
    const { rows: [row] } = await c.query(`INSERT INTO public.torneos_identity(core_user_id)
      VALUES ($1) ON CONFLICT(core_user_id) DO UPDATE SET core_user_id = EXCLUDED.core_user_id
      RETURNING id, core_user_id`, [coreUserId]);
    await c.query('COMMIT');
    return row;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}
async function identityExists(id, coreUserId) {
  // Same check as Phase 1.5, through the certified bridge role's own read policy.
  const c = await identity.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE torneos_identity_writer');
    const { rowCount } = await c.query('SELECT id FROM public.torneos_identity WHERE id=$1 AND core_user_id=$2', [id, coreUserId]);
    await c.query('COMMIT');
    return rowCount === 1;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}
const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
  try {
    if (disabled) return json(res, 503, { error: 'access denied' });
    if (req.headers.host !== new URL(publicOrigin).host ||
        (req.headers.origin && req.headers.origin !== publicOrigin)) return json(res, 403, { error: 'origin rejected' });
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/config') {
      return json(res, 200, { coreUrl: origin, torneosUrl: `${origin}/torneos`, anonKey: initial.anonKey });
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      const r = await dependencyFetch('http://core-auth:9999/health', { signal: AbortSignal.timeout(2000) });
      return json(res, r.ok ? 200 : 503, { ready: r.ok });
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      const path = url.pathname.slice('/auth/v1'.length);
      const allowed = { '/signup': ['POST'], '/token': ['POST'], '/user': ['GET', 'PUT'], '/logout': ['POST'] };
      if (!allowed[path]?.includes(req.method)) return json(res, 404, { error: 'not found' });
      return await proxy(req, res, `http://core-auth:9999${path}${url.search}`,
        req.headers.authorization ? bearer(req) : undefined);
    }
    if (req.method === 'POST' && url.pathname === '/exchange') {
      const raw = await body(req);
      if (raw.length && raw.toString() !== '{}') return json(res, 400, { error: 'exchange accepts no identity or role input' });
      const c = await verifiedCore(bearer(req));
      const row = await allocateIdentity(c.userId);
      const token = await issueToken(await readConfig(), row, c.sessionId);
      return json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: TTL });
    }
    // COMMERCE-PRODUCTION: production mode serves the same checkout route plus the purchase refresh (same module as Edge).
    const commerceRoute = commerce.mode !== 'off' && req.method === 'POST' && (url.pathname === commerceModule?.COMMERCE_ROUTE
      || (commerce.mode === 'production' && url.pathname === commerceModule?.REFRESH_ROUTE));
    if (commerceRoute) {
      const handler = url.pathname === commerceModule.COMMERCE_ROUTE ? commerceModule.seasonCheckout : commerceModule.purchaseRefresh;
      const r = await handler({ authorization: req.headers.authorization ?? null, search: url.search,
        contentLength: req.headers['content-length'] ?? null, body: req }, commerce, {
        verifyBridge: async (token) => verifyToken(token, await readConfig()),
        activeSession: (c) => activeSession(c.core_user_id, c.session_id),
        identityExists: (c) => identityExists(c.sub, c.core_user_id),
        isUnavailable: (error) => error instanceof Unavailable || ['ECONNREFUSED', '57P01', 'ETIMEDOUT'].includes(error?.code),
        restUrl: 'http://torneos-rest:3000', restApiKey: null,
        log: (entry) => console.log(JSON.stringify(entry)),
      });
      return json(res, r.status, r.body);
    }
    const publicRpc = competitionModule.PUBLIC_RPC_ROUTE.exec(url.pathname);
    if (publicRpc) {
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      const publicRequest = { name: publicRpc[1], authorization: req.headers.authorization ?? null,
        apikey: req.headers.apikey ?? null, contentType: req.headers['content-type'] ?? null,
        contentLength: req.headers['content-length'] ?? null, body: req };
      // CONNECTED-V1: its public catalog RPCs carry their own body contract; everything else is COMPETITION-V1.
      const decision = connected.publicRpcs.has(publicRpc[1])
        ? await connectedModule.prepareConnectedPublicRpc(publicRequest, connected)
        : branding.mode === 'on' && brandingModule.BRANDING_PUBLIC_RPCS.has(publicRpc[1])
          ? await brandingModule.prepareBrandingPublicRpc(publicRequest, branding)
          : await competitionModule.preparePublicRpc(publicRequest, competition);
      if (!decision.ok) return json(res, decision.status, { error: decision.error });
      if (!publicGate.tryEnter()) { res.setHeader('retry-after', '1'); return json(res, 503, { error: 'public route busy' }); }
      try {
        const r = await dependencyFetch(`http://torneos-rest:3000${decision.path}`, { method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' }, body: decision.body,
          redirect: 'error', signal: AbortSignal.timeout(5000) });
        let payload = new Uint8Array(await r.arrayBuffer());
        // BRANDING-V1: published branding only (anon key → storage RLS), one signature batch per response.
        if (r.status === 200 && branding.mode === 'on' && brandingModule.SIGNED_PUBLIC_RPCS.has(publicRpc[1])) {
          payload = await brandingModule.signResponseBody(payload, branding, brandingModule.anonCredential(initial.anonKey));
          if (brandingModule.BRANDING_PUBLIC_RPCS.has(publicRpc[1])) payload = brandingModule.projectPublicBranding(payload);
        }
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
        return res.end(Buffer.from(payload));
      } finally {
        publicGate.leave();
      }
    }
    // BRANDING-V1: one versioned object, stored or removed with the caller's own token (storage RLS decides).
    const brandingPath = branding.mode === 'on' ? brandingModule.BRANDING_OBJECT_ROUTE.exec(url.pathname) : null;
    if (brandingPath && ['POST', 'DELETE'].includes(req.method)) {
      const token = bearer(req);
      const p = await verifyToken(token, await readConfig());
      await activeSession(p.core_user_id, p.session_id);
      if (!await identityExists(p.sub, p.core_user_id)) throw new Error('identity mismatch');
      const result = await brandingModule.brandingObject({ method: req.method, path: brandingPath[1],
        contentType: req.headers['content-type'] ?? null, contentLength: req.headers['content-length'] ?? null, body: req },
        branding, token, null);
      return json(res, result.status, result.body);
    }
    // MEDIA-V1: one verified photo in, or signed reads out — for the caller's own verified identity only.
    if (media.mode === 'on' && req.method === 'POST' && [mediaModule.MEDIA_UPLOAD_ROUTE, mediaModule.MEDIA_URLS_ROUTE].includes(url.pathname)) {
      const token = bearer(req);
      const config = await readConfig();
      const p = await verifyToken(token, config);
      await activeSession(p.core_user_id, p.session_id);
      if (!await identityExists(p.sub, p.core_user_id)) throw new Error('identity mismatch');
      const deps = { bearer: token, apikey: null, mint: (sessionId) => issueMediaUploadToken(config, p, sessionId) };
      try {
        const result = url.pathname === mediaModule.MEDIA_UPLOAD_ROUTE
          ? await mediaModule.mediaUpload({ search: url.search, contentType: req.headers['content-type'] ?? null,
            contentLength: req.headers['content-length'] ?? null, body: req }, media, deps)
          : await mediaModule.mediaUrls({ contentType: req.headers['content-type'] ?? null,
            contentLength: req.headers['content-length'] ?? null, body: req }, media, deps);
        return json(res, result.status, result.body);
      } catch (error) {
        if (mediaModule.isMediaUnavailable(error)) throw new Unavailable();
        throw error;
      }
    }
    const rest = /^\/torneos\/rest\/v1\/(rpc\/([a-z0-9_]+)|[a-z0-9_]+)$/.exec(url.pathname);
    if (rest && ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
      const token = bearer(req);
      const p = await verifyToken(token, await readConfig());
      const rpc = rest[2];
      // Phase 2D: RPC names outside the staging v1 allowlist never reach PostgREST through this
      // gateway (verified bearer or not; the answer is a plain refusal, not a proxied 42501).
      if (rpc && !rpcAllowlist.has(rpc)) return json(res, 403, { error: 'rpc not enabled' });
      await activeSession(p.core_user_id, p.session_id);
      if (!await identityExists(p.sub, p.core_user_id)) throw new Error('identity mismatch');
      let raw;
      if (req.method === 'POST' && rpc && CONTRACTS[rpc]) {
        raw = await body(req);
        let parsed;
        try { parsed = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'invalid json' }); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(res, 400, { error: 'invalid json' });
        const request = CONTRACTS[rpc].request(parsed);
        if (request) {
          try {
            await adapter.prepare(p, CONTRACTS[rpc].contract, request);
          } catch (error) {
            if (error instanceof AdapterDenied || error instanceof Denied) return json(res, error.status, { error: error.code });
            throw error;
          }
        }
      }
      return await proxy(req, res, `http://torneos-rest:3000${url.pathname.slice('/torneos/rest/v1'.length)}${url.search}`, token, raw, rpc ?? null);
    }
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    // Never log request, bearer, SQL, errors with context, or response bodies.
    if (!res.headersSent) json(res, error instanceof Unavailable || ['ECONNREFUSED', '57P01', 'ETIMEDOUT'].includes(error?.code) ? 503 : 401, { error: 'access denied' });
    else res.end();
  }
});
// Production's gateway (Cloud Run) cuts a request at 30 s; a lab run that measures slow uploads mirrors it explicitly.
const requestTimeout = Number(process.env.PHASE3A_GATEWAY_REQUEST_TIMEOUT_MS || 10000);
if (!Number.isInteger(requestTimeout) || requestTimeout < 10000 || requestTimeout > 60000) throw new Error('PHASE3A_GATEWAY_REQUEST_TIMEOUT_MS must be 10000-60000');
server.requestTimeout = requestTimeout;
server.headersTimeout = 10000;
server.listen(58420, '0.0.0.0', () => console.log('Phase 3A gateway ready'));
