// INFRA-1 R3 — Management API transport and client. Every request is classified by the allowlist of
// foundation-contract.mjs BEFORE it reaches the socket; the client exposes named operations only
// (no generic request method), and the two writes exist only on a client armed for exactly that write.
import https from 'node:https';
import * as F from './foundation-contract.mjs';

const IDLE_TIMEOUT_MS = 30000;

/** node:https, no redirects (a 3xx could carry Authorization elsewhere), TLS ≥ 1.2, idle timeout. */
export function httpsTransport({ pat, method, path, body }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'User-Agent': 'arma2-torneos-infra1-r3-foundation/1' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    const req = https.request({ host: F.API_HOST, servername: F.API_HOST, port: 443, method, path, headers, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
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

export const projectProject = (p) => (p && typeof p === 'object' ? {
  ref: p.ref ?? p.id ?? null, name: p.name ?? null, organization_slug: p.organization_slug ?? p.organization_id ?? null,
  region: p.region ?? null, status: p.status ?? null, created_at: p.created_at ?? null,
  database: p.database ? { version: p.database.version ?? null, postgres_engine: p.database.postgres_engine ?? null, release_channel: p.database.release_channel ?? null } : null,
} : null);
export const projectFunction = (f) => (f && typeof f === 'object' ? {
  slug: f.slug ?? null, status: f.status ?? null, version: f.version ?? null, verify_jwt: f.verify_jwt ?? null,
  updated_at: f.updated_at ?? null, ezbr_sha256: f.ezbr_sha256 ?? null,
} : null);
export const AUTH_CONFIG_KEYS = Object.freeze(['site_url', 'uri_allow_list', 'disable_signup', 'jwt_exp', 'external_anonymous_users_enabled',
  'external_email_enabled', 'external_phone_enabled', 'mailer_autoconfirm', 'sms_autoconfirm', 'external_google_enabled', 'external_apple_enabled',
  'external_github_enabled', 'external_azure_enabled', 'saml_enabled', 'hook_custom_access_token_enabled', 'security_manual_linking_enabled']);
export const projectAuthConfig = (c) => (c && typeof c === 'object' ? Object.fromEntries(AUTH_CONFIG_KEYS.filter((k) => k in c).map((k) => [k, c[k]])) : null);
export const projectPostgrest = (c) => (c && typeof c === 'object' ? { db_schema: c.db_schema ?? null, db_extra_search_path: c.db_extra_search_path ?? null, max_rows: c.max_rows ?? null } : null);
export const projectThirdPartyAuth = (rows) => (Array.isArray(rows) ? rows.map((r) => ({
  id: r.id ?? null, type: r.type ?? null, oidc_issuer_url: r.oidc_issuer_url ?? null, jwks_url: r.jwks_url ?? null,
  custom_jwks_kids: Array.isArray(r.custom_jwks?.keys) ? r.custom_jwks.keys.map((k) => k.kid ?? null) : (r.custom_jwks ? 'present' : null),
  resolved_at: r.resolved_at ?? null,
})) : null);

export class ApiError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; }
}

/**
 * The only handle the runner uses. `armedFor` ∈ {null, 'pause', 'create'} (or a getter of it, read at each
 * request); `createdRef` is the Arma2
 * Torneos ref once it is known (from the projects list by exact name, or from the create response).
 * Every value that looks like a key is dropped by the projections before it can be returned.
 */
export function makeClient({ transport, pat, armedFor = null, known = [] }) {
  let createdRef = null;
  const log = [];
  const call = async (method, path, body) => {
    const cls = F.classifyRequest({ method, path, body }, { armedFor: typeof armedFor === 'function' ? armedFor() : armedFor, createdRef });
    let res;
    try { res = await transport({ pat, method, path, body }); } catch (e) { throw new ApiError('TRANSPORT_FAILED', { id: cls.id, error: String(e.message).slice(0, 120) }); }
    log.push({ id: cls.id, kind: cls.kind, method, ref: cls.ref, status: res.status });
    return { ...res, cls };
  };
  const ok = (res, codes = [200]) => {
    if (!codes.includes(res.status)) throw new ApiError('API_STATUS_UNEXPECTED', { id: res.cls.id, status: res.status, message: typeof res.body?.message === 'string' ? res.body.message.slice(0, 160) : null });
    return res.body;
  };
  const sqlRows = (body) => (Array.isArray(body) ? body : (Array.isArray(body?.result) ? body.result : []));
  const client = {
    get requests() { return log.slice(); },
    get writes() { return log.filter((r) => r.kind.startsWith('write:')).length; },
    setCreatedRef(ref) {
      if (!F.REF_PATTERN.test(ref ?? '') || F.KNOWN_REFS.includes(ref)) throw new ApiError('CREATED_REF_INVALID', { ref });
      if (createdRef && createdRef !== ref) throw new ApiError('CREATED_REF_CHANGED');
      createdRef = ref;
    },
    get createdRef() { return createdRef; },
    async org() { const b = ok(await call('GET', `/v1/organizations/${F.ORG_SLUG}`)); return { slug: b?.slug ?? b?.id ?? null, name: b?.name ?? null, plan: b?.plan ?? null }; },
    async projects() { const b = ok(await call('GET', '/v1/projects')); return (Array.isArray(b) ? b : []).map(projectProject); },
    async regions() { return ok(await call('GET', `/v1/projects/available-regions?organization_slug=${F.ORG_SLUG}&continent=SA`)); },
    async prodProject() { return projectProject(ok(await call('GET', `/v1/projects/${F.PROD_REF}`))); },
    async prodContractFn() { return projectFunction(ok(await call('GET', `/v1/projects/${F.PROD_REF}/functions/${F.CORE_CONTRACT_SLUG}`))); },
    async project(ref) { return projectProject(ok(await call('GET', `/v1/projects/${ref}`))); },
    async functions(ref) { const b = ok(await call('GET', `/v1/projects/${ref}/functions`)); return (Array.isArray(b) ? b : []).map(projectFunction); },
    async branches(ref) {
      const res = await call('GET', `/v1/projects/${ref}/branches`);
      if (res.status === 404 || res.status === 422) return { branching: 'disabled', status: res.status, branches: [] };
      const b = ok(res); return { branching: 'enabled', status: res.status, branches: (Array.isArray(b) ? b : []).map((x) => ({ name: x.name ?? null, is_default: x.is_default ?? null, status: x.status ?? null, persistent: x.persistent ?? null, git_branch: x.git_branch ?? null })) };
    },
    async health(ref) {
      const b = ok(await call('GET', `/v1/projects/${ref}/health?services=auth,db,pooler,rest,db_postgres_user`));
      return (Array.isArray(b) ? b : []).map((s) => ({ name: s.name ?? null, status: s.status ?? null, error: s.error ? String(s.error).slice(0, 120) : null }));
    },
    async pooler(ref) {
      const b = ok(await call('GET', `/v1/projects/${ref}/config/database/pooler`));
      const list = Array.isArray(b) ? b : [b];
      const hosts = [...new Set(list.map((e) => e?.db_host ?? null).filter(Boolean))];
      return { hosts, pool_modes: [...new Set(list.map((e) => e?.pool_mode ?? null).filter(Boolean))], db_user: [...new Set(list.map((e) => e?.db_user ?? null).filter(Boolean))], db_port: [...new Set(list.map((e) => e?.db_port ?? null).filter(Boolean))] };
    },
    async thirdPartyAuth(ref) { return projectThirdPartyAuth(ok(await call('GET', `/v1/projects/${ref}/config/auth/third-party-auth`))); },
    async authConfig(ref) { return projectAuthConfig(ok(await call('GET', `/v1/projects/${ref}/config/auth`))); },
    async postgrest(ref) { return projectPostgrest(ok(await call('GET', `/v1/projects/${ref}/postgrest`))); },
    /** Names/types only; the anon-level key used by the PostgREST probe is returned separately and never persisted. */
    async apiKeys(ref) {
      const b = ok(await call('GET', `/v1/projects/${ref}/api-keys?reveal=false`));
      const rows = Array.isArray(b) ? b : [];
      for (const k of rows) if (typeof k?.api_key === 'string' && k.api_key.length >= 8) known.push(k.api_key);
      const shape = (v) => (typeof v !== 'string' ? null : v.startsWith('sb_publishable_') ? 'sb_publishable_' : v.startsWith('sb_secret_') ? 'sb_secret_' : v.startsWith('eyJ') ? 'jwt' : 'other');
      const pub = rows.find((k) => k?.type === 'publishable' && typeof k.api_key === 'string' && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k.api_key));
      let probeKey = pub?.api_key ?? null; let probeKeyKind = pub ? 'publishable' : null;
      if (!probeKey) {
        const anon = rows.find((k) => k?.type === 'legacy' && k.name === 'anon' && typeof k.api_key === 'string' && k.api_key.startsWith('eyJ'));
        if (anon) { try { const claims = JSON.parse(Buffer.from(anon.api_key.split('.')[1], 'base64url').toString('utf8')); if (claims.role === 'anon') { probeKey = anon.api_key; probeKeyKind = 'legacy-anon'; } } catch { /* not a usable anon JWT */ } }
      }
      return { keys: rows.map((k) => ({ name: k?.name ?? null, type: k?.type ?? null, key_shape: shape(k?.api_key) })), probeKey, probeKeyKind };
    },
    async secretNames(ref) { const b = ok(await call('GET', `/v1/projects/${ref}/secrets`)); return (Array.isArray(b) ? b : []).map((s) => s?.name ?? null).filter(Boolean).sort(); },
    async dbMigrations(ref) { const b = ok(await call('GET', `/v1/projects/${ref}/database/migrations`)); return (Array.isArray(b) ? b : []).map((m) => ({ version: m?.version ?? null, name: m?.name ?? null })); },
    async sql(ref, query) { return sqlRows(ok(await call('POST', `/v1/projects/${ref}/database/query`, { query, read_only: true }), [200, 201])); },
    // ── the two writes ──
    async pauseStaging() { const res = await call('POST', `/v1/projects/${F.STAGING_REF}/pause`); ok(res, [200, 201]); return { status: res.status }; },
    async createProject(dbPass) {
      const res = await call('POST', '/v1/projects', F.createProjectBody(dbPass));
      if (res.status !== 201 && res.status !== 200) throw new ApiError('CREATE_STATUS_UNEXPECTED', { status: res.status, message: typeof res.body?.message === 'string' ? res.body.message.slice(0, 200) : null });
      return projectProject(res.body);
    },
  };
  return client;
}
