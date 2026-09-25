// GATEWAY/AUTH — Management API transport and client. Every request is classified by gateway-auth-contract.mjs BEFORE
// it reaches the socket; the client exposes named operations only (no generic request), and the two API writes exist
// only on a client armed for exactly that write, in the mode that owns it. No retry anywhere: one request, one answer.
import https from 'node:https';
import * as G from './gateway-auth-contract.mjs';
import { jwksDigest } from './keyring.mjs';

const IDLE_TIMEOUT_MS = 30000;

/** node:https to api.supabase.com, no redirects (a 3xx could carry Authorization elsewhere), TLS ≥ 1.2, idle timeout. */
export function httpsTransport({ pat, method, path, body }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'User-Agent': 'arma2-torneos-gateway-auth/1' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    const req = https.request({ host: G.API_HOST, servername: G.API_HOST, port: 443, method, path, headers, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new Error(`redirect_refused_${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw, elapsed_ms: Date.now() - started });
      });
    });
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error('idle_timeout')));
    req.on('error', (e) => reject(new Error(`request_failed_${e.code ?? e.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

export const projectProject = (p) => (p && typeof p === 'object' ? { ref: p.ref ?? p.id ?? null, name: p.name ?? null, organization_slug: p.organization_slug ?? p.organization_id ?? null, region: p.region ?? null, status: p.status ?? null } : null);
export const projectFunction = (f) => (f && typeof f === 'object' ? { slug: f.slug ?? null, status: f.status ?? null, version: f.version ?? null, verify_jwt: f.verify_jwt ?? null, ezbr_sha256: f.ezbr_sha256 ?? null } : null);
export const projectAuthConfig = (c) => (c && typeof c === 'object' ? Object.fromEntries([...new Set([...G.AUTH_CONFIG_KEYS, ...G.authMustOffKeys(c)])].filter((k) => k in c).map((k) => [k, c[k]])) : null);
/** sha256 per key of the WHOLE Auth answer. Kept in memory only (values include secrets): it proves which keys moved. */
export const fingerprintAuthConfig = (c) => (c && typeof c === 'object' ? Object.fromEntries(Object.keys(c).sort().map((k) => [k, G.sha256(`${JSON.stringify(c[k]) ?? 'undefined'}`)])) : null);
export const projectPostgrest = (c) => (c && typeof c === 'object' ? { db_schema: c.db_schema ?? null, db_extra_search_path: c.db_extra_search_path ?? null, max_rows: c.max_rows ?? null } : null);
export const projectThirdPartyAuth = (rows) => (Array.isArray(rows) ? rows.map((r) => ({
  id: r.id ?? null, type: r.type ?? null, oidc_issuer_url: r.oidc_issuer_url ?? null, jwks_url: r.jwks_url ?? null,
  custom_jwks_kids: Array.isArray(r.custom_jwks?.keys) ? r.custom_jwks.keys.map((k) => k.kid ?? null) : (r.custom_jwks ? 'present' : null),
  custom_jwks_digest: Array.isArray(r.custom_jwks?.keys) && r.custom_jwks.keys.every((k) => k.kty === 'RSA' && k.n && k.e) ? jwksDigest(r.custom_jwks) : null,
  custom_jwks_private_material: Array.isArray(r.custom_jwks?.keys) && r.custom_jwks.keys.some((k) => ['d', 'p', 'q'].some((x) => x in k)),
  resolved_at: r.resolved_at ?? null,
})) : null);

export class ApiError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }

/**
 * `mode` pins the endpoints; `armedFor()` is read at each request and can only be the mode's own API write;
 * `jwksPin()` supplies the pinned public JWKS the B03 body is checked against. Keys are dropped by the projections.
 */
export function makeClient({ transport, pat, mode, armedFor = () => null, jwksPin = () => null, known = [] }) {
  if (!G.MODE_ENDPOINTS[mode]) throw new ApiError('CLIENT_MODE_REQUIRED', { mode: mode ?? null });
  const log = [];
  const call = async (method, path, body) => {
    const cls = G.classifyRequest({ method, path, body }, { mode, armedFor: armedFor(), jwksPin: jwksPin() });
    let res;
    try { res = await transport({ pat, method, path, body }); } catch (e) { throw new ApiError('TRANSPORT_FAILED', { id: cls.id, error: String(e.message).slice(0, 120) }); }
    log.push({ id: cls.id, kind: cls.kind, method, ref: cls.ref, status: res.status });
    return { ...res, cls };
  };
  const message = (res, n) => (typeof res.body?.message === 'string' ? res.body.message.slice(0, n) : null);
  const denied = (res) => {
    if (res.status !== 401 && res.status !== 403) return;
    throw new ApiError(res.status === 401 ? 'PAT_REJECTED' : 'PAT_PERMISSION_DENIED', { id: res.cls.id, ref: res.cls.ref, status: res.status,
      required_permissions: res.cls.fga.map((f) => G.FGA_LABELS[f]), required_resource_access: `Organization ${G.ORG_SLUG}`, message: message(res, 160) });
  };
  const ok = (res, codes = [200]) => {
    if (!codes.includes(res.status)) { denied(res); throw new ApiError('API_STATUS_UNEXPECTED', { id: res.cls.id, ref: res.cls.ref, status: res.status, message: message(res, 160) }); }
    return res.body;
  };
  const sqlRows = (body) => (Array.isArray(body) ? body : (Array.isArray(body?.result) ? body.result : []));
  const T = G.TORNEOS_REF;
  return {
    get requests() { return log.slice(); },
    get writes() { return log.filter((r) => r.kind.startsWith('write:')).length; },
    async org() { const b = ok(await call('GET', `/v1/organizations/${G.ORG_SLUG}`)); return { slug: b?.slug ?? b?.id ?? null, plan: b?.plan ?? null }; },
    async projects() { const b = ok(await call('GET', '/v1/projects')); return (Array.isArray(b) ? b : []).map(projectProject); },
    async prodProject() { return projectProject(ok(await call('GET', `/v1/projects/${G.CORE_PROD_REF}`))); },
    async prodContractFn() { return projectFunction(ok(await call('GET', `/v1/projects/${G.CORE_PROD_REF}/functions/${G.CORE_CONTRACT_SLUG}`))); },
    async project(ref) { return projectProject(ok(await call('GET', `/v1/projects/${ref}`))); },
    async health() { const b = ok(await call('GET', `/v1/projects/${T}/health?services=auth,db,pooler,rest,db_postgres_user`)); return (Array.isArray(b) ? b : []).map((s) => ({ name: s.name ?? null, status: s.status ?? null })); },
    async functions() { const b = ok(await call('GET', `/v1/projects/${T}/functions`)); return (Array.isArray(b) ? b : []).map(projectFunction); },
    async secretNames() { const b = ok(await call('GET', `/v1/projects/${T}/secrets`)); return (Array.isArray(b) ? b : []).map((s) => s?.name ?? null).filter(Boolean).sort(); },
    async authConfig() { const b = ok(await call('GET', `/v1/projects/${T}/config/auth`)); return { config: projectAuthConfig(b), fingerprint: fingerprintAuthConfig(b) }; },
    async thirdPartyAuth() { return projectThirdPartyAuth(ok(await call('GET', `/v1/projects/${T}/config/auth/third-party-auth`))); },
    async postgrest() { return projectPostgrest(ok(await call('GET', `/v1/projects/${T}/postgrest`))); },
    async dbMigrations() { const b = ok(await call('GET', `/v1/projects/${T}/database/migrations`)); return (Array.isArray(b) ? b : []).map((m) => ({ version: m?.version ?? null })); },
    async pooler() {
      const b = ok(await call('GET', `/v1/projects/${T}/config/database/pooler`));
      const list = Array.isArray(b) ? b : [b];
      return { hosts: [...new Set(list.map((e) => e?.db_host ?? null).filter(Boolean))], pool_modes: [...new Set(list.map((e) => e?.pool_mode ?? null).filter(Boolean))] };
    },
    /** Names/types only; the publishable (or legacy anon) key for the probes is returned separately and never persisted. */
    async apiKeys() {
      const rows = ok(await call('GET', `/v1/projects/${T}/api-keys?reveal=false`));
      const list = Array.isArray(rows) ? rows : [];
      for (const k of list) if (typeof k?.api_key === 'string' && k.api_key.length >= 8) known.push(k.api_key);
      const pub = list.find((k) => k?.type === 'publishable' && typeof k.api_key === 'string' && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k.api_key));
      let probeKey = pub?.api_key ?? null;
      if (!probeKey) {
        const anon = list.find((k) => k?.type === 'legacy' && k.name === 'anon' && typeof k.api_key === 'string' && k.api_key.startsWith('eyJ'));
        try { if (anon && JSON.parse(Buffer.from(anon.api_key.split('.')[1], 'base64url').toString('utf8')).role === 'anon') probeKey = anon.api_key; } catch { /* unusable */ }
      }
      return { keys: list.map((k) => ({ name: k?.name ?? null, type: k?.type ?? null })), probeKey };
    },
    async sql(query) { return sqlRows(ok(await call('POST', `/v1/projects/${T}/database/query`, { query, read_only: true }), [200, 201])); },
    // ── the two API writes ──
    async authLockdown() { return projectAuthConfig(ok(await call('PATCH', `/v1/projects/${T}/config/auth`, { ...G.AUTH_LOCKDOWN_BODY }))); },
    async createThirdPartyAuth(body) { const b = ok(await call('POST', `/v1/projects/${T}/config/auth/third-party-auth`, body), [200, 201]); return projectThirdPartyAuth([b])[0]; },
  };
}
