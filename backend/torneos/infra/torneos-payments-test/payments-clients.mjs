// PAYMENTS TEST — the three HTTPS clients of the operator session. Every request is classified by the contract BEFORE it
// reaches the socket; writes exist only while the session arms exactly that write. No redirects, TLS ≥ 1.2, no retry:
// one request, one answer. Projections keep ids, states, amounts and flags only — never tokens, payer data or env values.
import https from 'node:https';
import crypto from 'node:crypto';
import * as C from './payments-test-contract.mjs';

const IDLE_TIMEOUT_MS = 60000;
export class ClientError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail ?? null; } }

/** node:https to one fixed host; returns { status, body, raw, headers, elapsed_ms }. */
export function httpsTo(host, { userAgent }) {
  return ({ token = null, method, path, body, headers = {} }) => {
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const h = { Accept: 'application/json', 'User-Agent': userAgent, ...headers };
      if (token) h.Authorization = `Bearer ${token}`;
      if (payload) { h['Content-Type'] = h['Content-Type'] ?? 'application/json'; h['Content-Length'] = payload.length; }
      const req = https.request({ host, servername: host, port: 443, method, path, headers: h, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new Error(`redirect_refused_${res.statusCode}`)); return; }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
          resolve({ status: res.statusCode, body: parsed, raw, headers: res.headers, elapsed_ms: Date.now() - started });
        });
      });
      req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error('idle_timeout')));
      req.on('error', (e) => reject(new Error(`request_failed_${e.code ?? e.message}`)));
      if (payload) req.write(payload);
      req.end();
    });
  };
}
export const denoHttpsTransport = httpsTo(C.DENO_API_HOST, { userAgent: 'arma2-torneos-payments-test/1' });
export const mpHttpsTransport = httpsTo(C.MP_API_HOST, { userAgent: 'arma2-torneos-payments-test/1' });
export const appHttpsTransport = httpsTo(C.PAYMENTS_HOST, { userAgent: 'arma2-torneos-payments-test-operator/1' });

const redactWith = (known) => (s) => { let t = typeof s === 'string' ? s : ''; for (const k of known) if (k && k.length >= 8) t = t.split(k).join('«REDACTED»'); return t.slice(0, 200); };
const list = (b) => (Array.isArray(b) ? b : Array.isArray(b?.items) ? b.items : Array.isArray(b?.data) ? b.data : []);

// ─────────────────────────── Deno Deploy ───────────────────────────
export const projectEnv = (l) => (Array.isArray(l) ? l.map((e) => ({ key: e?.key ?? null, secret: e?.secret ?? null, contexts: e?.contexts ?? null, value_returned: typeof e?.value === 'string' })) : null);
export const projectApp = (a) => (a && typeof a === 'object' ? { id: a.id ?? null, slug: a.slug ?? null, layers: Array.isArray(a.layers) ? a.layers.map((l) => l?.slug ?? l?.id ?? null) : null,
  env_vars: projectEnv(a.env_vars), config: a.config ?? null, labels: a.labels ?? null, created_at: a.created_at ?? null, updated_at: a.updated_at ?? null } : null);
export const projectRevision = (r) => (r && typeof r === 'object' ? { id: r.id ?? null, status: r.status ?? null, failure_reason: r.failure_reason ?? null,
  failure_detail: r.failure_detail ? { stage: r.failure_detail.stage ?? null, code: r.failure_detail.code ?? null } : null, env_vars: projectEnv(r.env_vars), layers: Array.isArray(r.layers) ? r.layers.length : null,
  config: r.config ?? null, labels: r.labels ?? null, created_at: r.created_at ?? null, build_finished_at: r.build_finished_at ?? null,
  timelines: Array.isArray(r.timelines) ? r.timelines.map((t) => ({ name: t?.name ?? null, context: t?.context ?? null, hostnames: Array.isArray(t?.hostnames) ? t.hostnames : [] })) : null } : null);

export function makeDenoClient({ transport = denoHttpsTransport, token, armedFor = () => null, known = [] }) {
  const log = [];
  const redact = redactWith(known);
  const call = async (method, path, body) => {
    const cls = C.classifyDenoRequest({ method, path, body }, { armedFor: armedFor() });
    let res; try { res = await transport({ token, method, path, body }); } catch (e) { throw new ClientError('DENO_TRANSPORT_FAILED', { id: cls.id, error: String(e.message).slice(0, 120) }); }
    log.push({ id: cls.id, kind: cls.kind, method, status: res.status });
    return { ...res, cls };
  };
  const ok = (res, codes = [200]) => {
    if (codes.includes(res.status)) return res.body;
    const message = redact(res.body?.message ?? res.body?.error?.message ?? res.body?.code ?? null);
    if (res.status === 401) throw new ClientError('DENO_TOKEN_REJECTED', { id: res.cls.id, message });
    if (res.status === 403) throw new ClientError('DENO_TOKEN_PERMISSION_DENIED', { id: res.cls.id, message });
    throw new ClientError('DENO_API_STATUS_UNEXPECTED', { id: res.cls.id, status: res.status, message });
  };
  const app = async (slug) => { const res = await call('GET', `/v2/apps/${slug}`); return res.status === 404 ? null : projectApp(ok(res)); };
  return {
    get requests() { return log.slice(); },
    get writes() { return log.filter((r) => r.kind.startsWith('write:')).length; },
    async apps() { return list(ok(await call('GET', '/v2/apps?limit=100'))).map((a) => ({ id: a?.id ?? null, slug: a?.slug ?? null })); },
    app: () => app(C.APP_SLUG),
    gatewayApp: () => app(C.GATEWAY_APP_SLUG),
    async layers() { return list(ok(await call('GET', '/v2/layers'))).map((l) => ({ id: l?.id ?? null, slug: l?.slug ?? null })); },
    async revisions(slug = C.APP_SLUG) { return list(ok(await call('GET', `/v2/apps/${slug}/revisions?limit=20`))).map(projectRevision); },
    async revision(id) { return projectRevision(ok(await call('GET', `/v2/revisions/${id}`))); },
    async timelines(id) { return list(ok(await call('GET', `/v2/revisions/${id}/timelines`))).map((t) => ({ slug: t?.slug ?? null, partition: t?.partition ?? null, domains: Array.isArray(t?.domains) ? t.domains.map((d) => d?.domain ?? null) : [] })); },
    async logs(startIso, endIso) {
      const b = ok(await call('GET', `/v2/apps/${C.APP_SLUG}/logs?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=200`));
      return list(b).map((l) => ({ level: l?.level ?? null, message: redact(String(l?.message ?? '')), revision_id: l?.revision_id ?? null, timestamp: l?.timestamp ?? l?.time ?? null }));
    },
    async createApp(body) { return projectApp(ok(await call('POST', '/v2/apps', body), [200, 201])); },
    async deploy(body) { return projectRevision(ok(await call('POST', `/v2/apps/${C.APP_SLUG}/deploy`, body), [200, 201, 202])); },
  };
}

// ─────────────────────────── Mercado Pago (TEST seller) ───────────────────────────
const host = (u) => { try { return new URL(String(u)).hostname; } catch { return null; } };
export const projectPreference = (p, sellerId) => (p && typeof p === 'object' ? {
  id: p.id ?? null, collector_matches: String(p.collector_id ?? '') === sellerId,
  items: Array.isArray(p.items) ? p.items.map((i) => ({ id: i?.id ?? null, title: i?.title ?? null, quantity: i?.quantity ?? null, currency_id: i?.currency_id ?? null, unit_price: i?.unit_price ?? null })) : null,
  external_reference: p.external_reference ?? null, metadata_keys: p.metadata && typeof p.metadata === 'object' ? Object.keys(p.metadata).sort() : null, metadata_purchase_id: p.metadata?.purchase_id ?? null,
  notification_url: p.notification_url ?? null, back_urls: p.back_urls ?? null, auto_return: p.auto_return ?? null, expires: p.expires ?? null,
  expiration_date_from: p.expiration_date_from ?? null, expiration_date_to: p.expiration_date_to ?? null,
  payer_fields_set: p.payer && typeof p.payer === 'object' ? Object.entries(p.payer).filter(([, v]) => v !== null && v !== '' && !(typeof v === 'object' && Object.values(v ?? {}).every((x) => x === null || x === ''))).map(([k]) => k) : [],
  init_point_host: host(p.init_point), sandbox_init_point_host: host(p.sandbox_init_point), operation_type: p.operation_type ?? null, purpose: p.purpose ?? null,
} : null);
export const projectPayment = (p, sellerId) => (p && typeof p === 'object' ? {
  id: p.id !== undefined ? String(p.id) : null, status: p.status ?? null, status_detail: p.status_detail ?? null, date_last_updated: p.date_last_updated ?? null, date_created: p.date_created ?? null,
  transaction_amount: p.transaction_amount ?? null, currency_id: p.currency_id ?? null, live_mode: p.live_mode ?? null, collector_matches: String(p.collector_id ?? '') === sellerId,
  external_reference: p.external_reference ?? null, metadata_purchase_id: p.metadata?.purchase_id ?? null, order: p.order ? { id: p.order.id !== undefined ? String(p.order.id) : null, type: p.order.type ?? null } : null,
  payment_type_id: p.payment_type_id ?? null, refunds: Array.isArray(p.refunds) ? p.refunds.length : null,
} : null);
export const projectOrder = (o, sellerId) => (o && typeof o === 'object' ? { id: o.id !== undefined ? String(o.id) : null, preference_id: o.preference_id ?? null, external_reference: o.external_reference ?? null,
  collector_matches: String(o.collector?.id ?? '') === sellerId, payments: Array.isArray(o.payments) ? o.payments.map((x) => String(x?.id ?? '')) : null, status: o.status ?? null } : null);

export function makeMercadoPagoClient({ transport = mpHttpsTransport, token, sellerId, armedFor = () => null, known = [] }) {
  const log = [];
  const redact = redactWith(known);
  const call = async (method, path, body, headers) => {
    const cls = C.classifyMpRequest({ method, path, body }, { armedFor: armedFor() });
    let res; try { res = await transport({ token, method, path, body, headers }); } catch (e) { throw new ClientError('MP_TRANSPORT_FAILED', { id: cls.id, error: String(e.message).slice(0, 120) }); }
    log.push({ id: cls.id, kind: cls.kind, method, status: res.status });
    return { ...res, cls };
  };
  const ok = (res, codes = [200]) => {
    if (codes.includes(res.status)) return res.body;
    throw new ClientError(res.status === 401 || res.status === 403 ? 'MP_TOKEN_REFUSED' : 'MP_STATUS_UNEXPECTED', { id: res.cls.id, status: res.status, message: redact(res.body?.message ?? null) });
  };
  return {
    get requests() { return log.slice(); },
    get writes() { return log.filter((r) => r.kind.startsWith('write:')).length; },
    async attest() { return C.attestationOf(ok(await call('GET', '/users/me')), sellerId); },
    async preference(id) { return projectPreference(ok(await call('GET', `/checkout/preferences/${id}`)), sellerId); },
    async payment(id) { const res = await call('GET', `/v1/payments/${id}`); return res.status === 404 ? null : projectPayment(ok(res), sellerId); },
    async paymentsFor(purchaseId) {
      const b = ok(await call('GET', `/v1/payments/search?external_reference=${encodeURIComponent(`arma2:season:purchase:${purchaseId}`)}&sort=date_created&criteria=asc&limit=20`));
      return (Array.isArray(b?.results) ? b.results : []).map((p) => projectPayment(p, sellerId));
    },
    async order(id) { return projectOrder(ok(await call('GET', `/merchant_orders/${id}`)), sellerId); },
    async refund(paymentId, idempotencyKey) {
      const b = ok(await call('POST', `/v1/payments/${paymentId}/refunds`, {}, { 'X-Idempotency-Key': idempotencyKey }), [200, 201]);
      return { refund_id: b?.id !== undefined ? String(b.id) : null, payment_id: b?.payment_id !== undefined ? String(b.payment_id) : null, amount: b?.amount ?? null, status: b?.status ?? null };
    },
  };
}

// ─────────────────────────── the TEST app (operator = the internal caller; signed notifications) ───────────────────────────
export function makeAppClient({ transport = appHttpsTransport, internalSecretHex = null, webhookSecret = null, sellerId = null, now = () => Date.now() }) {
  const log = [];
  const path0 = new URL(C.PAYMENTS_BASE).pathname;
  const send = async (label, method, path, { body, headers = {} } = {}) => {
    if (!path.startsWith(path0) && !path.startsWith('/')) throw new ClientError('APP_PATH_REFUSED');
    const res = await transport({ method, path, body, headers });
    log.push({ label, method, path: path.replace(/data\.id=\d+/, 'data.id=…'), status: res.status, error: res.body?.error ?? null, outcome: res.body?.outcome ?? null });
    return { status: res.status, body: res.body, error: res.body?.error ?? null };
  };
  const internalHeaders = (body, { time = String(Math.floor(now() / 1000)), nonce = crypto.randomUUID(), secretHex = internalSecretHex } = {}) => {
    const sig = crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${C.INTERNAL_PATH}\n${time}\n${nonce}\n${body}`).digest('hex');
    return { 'x-time': time, 'x-nonce': nonce, 'x-signature': sig };
  };
  const signature = (dataId, { ts = String(now()), requestId = crypto.randomUUID(), secret = webhookSecret } = {}) =>
    ({ 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}` });
  const notification = (dataId, type = 'payment', over = {}) => ({ id: Number(String(dataId).slice(-9)) + 1, live_mode: false, type, date_created: new Date(now()).toISOString(), user_id: Number(sellerId), api_version: 'v1',
    action: `${type}.updated`, data: type === 'topic_chargebacks_wh' ? { id: String(dataId), checkout: 'PRO' } : { id: String(dataId) }, ...over });
  const webhookPath = (dataId, type = 'payment') => `${path0}${C.WEBHOOK_PATH}?data.id=${encodeURIComponent(dataId)}&type=${encodeURIComponent(type)}`;
  return {
    get requests() { return log.slice(); },
    raw: (label, method, path, opts) => send(label, method, path, opts),
    async preference(purchaseId, over = {}) { const body = JSON.stringify({ purchase_id: purchaseId }); return send('internal', 'POST', `${path0}${C.INTERNAL_PATH}`, { body, headers: { ...internalHeaders(body, over), ...(over.headers ?? {}) } }); },
    internalHeaders,
    async notify(dataId, { type = 'payment', ts, body, secret, requestId, omitSignature = false } = {}) {
      const text = JSON.stringify(body ?? notification(dataId, type));
      const headers = omitSignature ? { 'x-request-id': crypto.randomUUID() } : signature(dataId, { ts, secret, requestId });
      return send(`webhook:${type}`, 'POST', webhookPath(dataId, type), { body: text, headers });
    },
    notification, webhookPath,
  };
}
