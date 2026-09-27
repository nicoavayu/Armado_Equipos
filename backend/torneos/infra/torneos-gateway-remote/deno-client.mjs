// GATEWAY REMOTE — Deno Deploy API v2 transport and client. Every request is classified (remote-contract.mjs) BEFORE it
// reaches the socket; writes exist only while the session arms exactly that write. No retry: one request, one answer.
// Env values are never logged or returned: the projections below keep names, flags and ids only.
import https from 'node:https';
import { DENO_API_HOST, classifyDenoRequest } from './remote-contract.mjs';

const IDLE_TIMEOUT_MS = 60000;

export function denoHttpsTransport({ token, method, path, body }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'arma2-torneos-gateway-remote/1' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    const req = https.request({ host: DENO_API_HOST, servername: DENO_API_HOST, port: 443, method, path, headers, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
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

export class DenoApiError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }

export const projectEnv = (list) => (Array.isArray(list) ? list.map((e) => ({ key: e?.key ?? null, secret: e?.secret ?? null, contexts: e?.contexts ?? null, value_returned: typeof e?.value === 'string' })) : null);
export const projectApp = (a) => (a && typeof a === 'object' ? { id: a.id ?? null, slug: a.slug ?? null, layers: Array.isArray(a.layers) ? a.layers.map((l) => l?.slug ?? l?.id ?? null) : null,
  env_vars: projectEnv(a.env_vars), config: a.config ?? null, labels: a.labels ?? null, created_at: a.created_at ?? null, updated_at: a.updated_at ?? null } : null);
export const projectRevision = (r) => (r && typeof r === 'object' ? { id: r.id ?? null, status: r.status ?? null, failure_reason: r.failure_reason ?? null,
  failure_detail: r.failure_detail ? { stage: r.failure_detail.stage ?? null, code: r.failure_detail.code ?? null } : null, env_vars: projectEnv(r.env_vars), layers: Array.isArray(r.layers) ? r.layers.length : null,
  config: r.config ?? null, labels: r.labels ?? null, created_at: r.created_at ?? null, build_finished_at: r.build_finished_at ?? null,
  timelines: Array.isArray(r.timelines) ? r.timelines.map((t) => ({ name: t?.name ?? null, context: t?.context ?? null, hostnames: Array.isArray(t?.hostnames) ? t.hostnames : [] })) : null } : null);

export function makeDenoClient({ transport = denoHttpsTransport, token, armedFor = () => null, known = [] }) {
  const log = [];
  const call = async (method, path, body) => {
    const cls = classifyDenoRequest({ method, path, body }, { armedFor: armedFor() });
    let res;
    try { res = await transport({ token, method, path, body }); } catch (e) { throw new DenoApiError('DENO_TRANSPORT_FAILED', { id: cls.id, error: String(e.message).slice(0, 120) }); }
    log.push({ id: cls.id, kind: cls.kind, method, status: res.status });
    return { ...res, cls };
  };
  const msg = (res) => {
    const m = res.body?.message ?? res.body?.error?.message ?? res.body?.code ?? null;
    let s = typeof m === 'string' ? m.slice(0, 200) : null;
    if (s) for (const k of known) if (k && k.length >= 8) s = s.split(k).join('«REDACTED»');
    return s;
  };
  const ok = (res, codes = [200]) => {
    if (codes.includes(res.status)) return res.body;
    if (res.status === 401) throw new DenoApiError('DENO_TOKEN_REJECTED', { id: res.cls.id, status: 401, message: msg(res) });
    if (res.status === 403) throw new DenoApiError('DENO_TOKEN_PERMISSION_DENIED', { id: res.cls.id, status: 403, message: msg(res) });
    throw new DenoApiError('DENO_API_STATUS_UNEXPECTED', { id: res.cls.id, status: res.status, message: msg(res) });
  };
  const list = (b) => (Array.isArray(b) ? b : Array.isArray(b?.items) ? b.items : Array.isArray(b?.data) ? b.data : []);
  return {
    get requests() { return log.slice(); },
    get writes() { return log.filter((r) => r.kind.startsWith('write:')).length; },
    async apps() { return list(ok(await call('GET', '/v2/apps?limit=100'))).map((a) => ({ id: a?.id ?? null, slug: a?.slug ?? null })); },
    async app() {
      const res = await call('GET', `/v2/apps/${'torneos-gateway'}`);
      if (res.status === 404) return null;
      return projectApp(ok(res));
    },
    async layers() { return list(ok(await call('GET', '/v2/layers'))).map((l) => ({ id: l?.id ?? null, slug: l?.slug ?? null })); },
    async revisions() { return list(ok(await call('GET', '/v2/apps/torneos-gateway/revisions?limit=20'))).map(projectRevision); },
    async revision(id) { return projectRevision(ok(await call('GET', `/v2/revisions/${id}`))); },
    async timelines(id) { return list(ok(await call('GET', `/v2/revisions/${id}/timelines`))).map((t) => ({ slug: t?.slug ?? null, partition: t?.partition ?? null, domains: Array.isArray(t?.domains) ? t.domains.map((d) => d?.domain ?? null) : [] })); },
    async logs(startIso, endIso) {
      const b = ok(await call('GET', `/v2/apps/torneos-gateway/logs?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=200`));
      return list(b).map((l) => { let m = String(l?.message ?? '').slice(0, 300); for (const k of known) if (k && k.length >= 8) m = m.split(k).join('«REDACTED»'); return { level: l?.level ?? null, message: m, revision_id: l?.revision_id ?? null }; });
    },
    // ── writes (armed by the session, one at a time) ──
    async createApp(body) { return projectApp(ok(await call('POST', '/v2/apps', body), [200, 201])); },
    async setPublicUrl(body) { return projectApp(ok(await call('PATCH', '/v2/apps/torneos-gateway', body))); },
    async deploy(body) { return projectRevision(ok(await call('POST', '/v2/apps/torneos-gateway/deploy', body), [200, 201, 202])); },
  };
}
