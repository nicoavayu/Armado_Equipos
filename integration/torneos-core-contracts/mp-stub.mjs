// MP-A3 — lab-only Mercado Pago stub. Never deployed, never reachable from outside the lab.
//
// It implements ONLY the Mercado Pago API calls that the reused provider
// (backend/torneos/supabase/functions/_shared/mercadoPagoPaymentProvider.ts) actually performs:
//   POST /checkout/preferences            createPreference (new purchase; X-Idempotency-Key)
//   GET  /checkout/preferences/:id        createPreference (purchase that already has a preference)
//   GET  /v1/payments/:id                 fetchMercadoPagoPayment
//   GET  /merchant_orders/:id             fetchMercadoPagoMerchantOrder
//   GET  /v1/chargebacks/:id              fetchMercadoPagoChargeback
// Every call must carry `Authorization: Bearer <lab test token>`, as the real API requires.
//
// The payments service reaches it through its lab-only fetch wrapper, which rewrites the provider's
// fixed origin (https://api.mercadopago.com) to http://mp-stub:8080. Test suites drive deterministic
// scenarios through /__lab/* control routes (lab control token required): payments in any status, their
// merchant order, chargebacks, transient 5xx, slow or malformed preference responses, and binding
// mismatches (via field overrides). The stub never contacts the network. It logs and records metadata only
// (method, route template, status, idempotency key, price fields): never a token, secret or payer data.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

function required(name) {
  const value = (process.env[name] ?? '').trim();
  if (!value) { console.error(`mp-stub: missing ${name}`); process.exit(1); }
  return value;
}
const PORT = 8080;
const ACCESS_TOKEN = required('MP_STUB_ACCESS_TOKEN');
const SELLER_ID = required('MP_STUB_SELLER_ID');
const CONTROL_TOKEN = required('MP_STUB_CONTROL_TOKEN');
if (!/^[1-9]\d{5,15}$/.test(SELLER_ID)) { console.error('mp-stub: seller id must be numeric'); process.exit(1); }

let state;
function reset() {
  state = {
    preferences: new Map(),   // id → stored preference response
    byKey: new Map(),         // X-Idempotency-Key → preference id
    payments: new Map(),      // id → payment resource
    orders: new Map(),        // id → merchant order resource
    orderByPreference: new Map(),
    chargebacks: new Map(),   // id → chargeback resource
    failures: [],             // { method, route, status, times }
    preferenceMode: null,     // { mode, delayMs, times }
    calls: [],                // metadata only
    seq: 1000,
  };
}
reset();
const nextId = () => String(++state.seq) + String(Date.now()).slice(-6);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req, limit = 65536) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) return undefined; chunks.push(chunk); }
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
function takeFailure(method, route) {
  const failure = state.failures.find(f => f.method === method && f.route === route && f.times > 0);
  if (!failure) return null;
  failure.times -= 1;
  return failure;
}
function takePreferenceMode() {
  const m = state.preferenceMode;
  if (!m) return null;
  if (m.times !== undefined) { m.times -= 1; if (m.times <= 0) state.preferenceMode = null; }
  return m;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function checkoutUrlFor(id, mode) {
  if (mode === 'lookalike_host') return `https://mercadopago.com.ar.lab-attacker.invalid/checkout/v1/redirect?pref_id=${id}`;
  if (mode === 'suffix_host') return `https://evilmercadopago.com.ar/checkout/v1/redirect?pref_id=${id}`;
  if (mode === 'http_scheme') return `http://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${id}`;
  if (mode === 'missing_init_point') return undefined;
  return `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${id}`;
}

async function createPreference(req, res, record) {
  const key = req.headers['x-idempotency-key'];
  record.idempotencyKey = typeof key === 'string' ? key : null;
  const body = await readJson(req);
  const item = body?.items?.[0];
  if (!body || !item || typeof key !== 'string' || !key) return 400;
  record.body = {
    unit_price: item.unit_price, currency_id: item.currency_id, quantity: item.quantity, item_id: item.id,
    external_reference: body.external_reference, metadata_purchase_id: body.metadata?.purchase_id ?? null,
    expiration_date_from: body.expiration_date_from, expiration_date_to: body.expiration_date_to,
    notification_url: body.notification_url, back_url_success: body.back_urls?.success ?? null,
    auto_return: body.auto_return, expires: body.expires, keys: Object.keys(body).sort(),
  };
  const mode = takePreferenceMode();
  if (mode?.delayMs) await sleep(mode.delayMs);
  if (mode?.mode === 'status_500') return 500;
  const existing = state.byKey.get(key);
  if (existing) { record.idempotentReplay = true; send(res, 201, state.preferences.get(existing)); return 201; }
  const id = `lab-pref-${randomBytes(8).toString('hex')}`;
  const preference = {
    id, collector_id: mode?.mode === 'wrong_collector' ? Number(SELLER_ID) + 1 : Number(SELLER_ID),
    init_point: checkoutUrlFor(id, mode?.mode), sandbox_init_point: checkoutUrlFor(id, mode?.mode),
    external_reference: body.external_reference, items: body.items, metadata: body.metadata,
    expires: body.expires, expiration_date_from: body.expiration_date_from, expiration_date_to: body.expiration_date_to,
    notification_url: body.notification_url, back_urls: body.back_urls, auto_return: body.auto_return,
    operation_type: 'regular_payment', date_created: new Date().toISOString(),
  };
  if (preference.init_point === undefined) { delete preference.init_point; delete preference.sandbox_init_point; }
  state.preferences.set(id, preference);
  state.byKey.set(key, id);
  send(res, 201, preference);
  return 201;
}

function getPreference(res, id) {
  const preference = state.preferences.get(id);
  if (!preference) return 404;
  const mode = takePreferenceMode();
  if (mode?.mode === 'status_500') return 500;
  if (mode?.mode === 'other_id_on_get') { send(res, 200, { ...preference, id: `${preference.id}-other` }); return 200; }
  if (mode?.mode === 'lookalike_host') { send(res, 200, { ...preference, init_point: checkoutUrlFor(id, 'lookalike_host') }); return 200; }
  send(res, 200, preference);
  return 200;
}

// ---------------------------------------------------------------- lab control
function merge(target, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) merge(target[k], v);
    else if (v === '__delete__') delete target[k];
    else target[k] = v;
  }
  return target;
}
/** Builds a payment (and its merchant order) for a stored preference, as Mercado Pago would, then applies overrides. */
function labPayment(spec) {
  const preference = state.preferences.get(spec.preferenceId);
  if (!preference) return { status: 404, body: { error: 'unknown preference' } };
  const paymentId = spec.paymentId ?? nextId();
  let orderId = state.orderByPreference.get(preference.id);
  if (!orderId) {
    orderId = nextId();
    state.orderByPreference.set(preference.id, orderId);
    state.orders.set(orderId, { id: Number(orderId), preference_id: preference.id, external_reference: preference.external_reference,
      collector: { id: Number(SELLER_ID) }, payments: [], status: 'opened', order_status: 'payment_required' });
  }
  const order = state.orders.get(orderId);
  const item = preference.items?.[0] ?? {};
  // Payer data exists in real resources; the payments service must never log or return it.
  const payment = {
    id: Number(paymentId), status: spec.status, status_detail: spec.statusDetail ?? null,
    external_reference: preference.external_reference, currency_id: item.currency_id, transaction_amount: item.unit_price,
    collector_id: Number(SELLER_ID), metadata: { ...(preference.metadata ?? {}) },
    order: { id: Number(orderId), type: 'mercadopago' }, live_mode: false,
    payer: { email: `lab-payer-${paymentId}@payer.invalid`, identification: { type: 'DNI', number: `9${String(paymentId).slice(-7)}` } },
    date_created: new Date().toISOString(),
  };
  merge(payment, spec.overrides?.payment);
  state.payments.set(String(paymentId), payment);
  if (!order.payments.some(p => String(p.id) === String(paymentId))) order.payments.push({ id: Number(paymentId), status: spec.status });
  if (spec.overrides?.order) merge(order, spec.overrides.order);
  return { status: 200, body: { paymentId: String(paymentId), orderId: String(orderId) } };
}
function labSetPayment(spec) {
  const payment = state.payments.get(String(spec.paymentId));
  if (!payment) return { status: 404, body: { error: 'unknown payment' } };
  if (spec.status !== undefined) payment.status = spec.status;
  if (spec.statusDetail !== undefined) payment.status_detail = spec.statusDetail;
  merge(payment, spec.overrides?.payment);
  return { status: 200, body: { paymentId: String(spec.paymentId) } };
}
function labChargeback(spec) {
  const id = spec.chargebackId ?? nextId();
  const payment = state.payments.get(String(spec.paymentId));
  const chargeback = { id: Number(id), payments: [Number(spec.paymentId)], currency: payment?.currency_id ?? 'ARS',
    amount: payment?.transaction_amount ?? 0, coverage_applied: false, live_mode: false, date_created: new Date().toISOString() };
  merge(chargeback, spec.overrides);
  state.chargebacks.set(String(id), chargeback);
  return { status: 200, body: { chargebackId: String(id) } };
}
async function control(req, res, path) {
  if (req.headers['x-mp-stub-control'] !== CONTROL_TOKEN) return send(res, 403, { error: 'forbidden' });
  const body = req.method === 'POST' ? await readJson(req) : null;
  if (body === undefined) return send(res, 400, { error: 'invalid json' });
  if (req.method === 'GET' && path === '/__lab/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && path === '/__lab/calls') return send(res, 200, { calls: state.calls });
  if (req.method === 'POST' && path === '/__lab/reset') { reset(); return send(res, 200, { ok: true }); }
  if (req.method === 'POST' && path === '/__lab/preference-mode') { state.preferenceMode = body?.mode || body?.delayMs ? body : null; return send(res, 200, { ok: true }); }
  if (req.method === 'POST' && path === '/__lab/fail') { state.failures.push({ method: body.method, route: body.route, status: body.status, times: body.times ?? 1 }); return send(res, 200, { ok: true }); }
  if (req.method === 'POST' && path === '/__lab/payments') { const r = labPayment(body ?? {}); return send(res, r.status, r.body); }
  if (req.method === 'POST' && path === '/__lab/payment-state') { const r = labSetPayment(body ?? {}); return send(res, r.status, r.body); }
  if (req.method === 'POST' && path === '/__lab/chargebacks') { const r = labChargeback(body ?? {}); return send(res, r.status, r.body); }
  return send(res, 404, { error: 'not found' });
}

// ---------------------------------------------------------------- Mercado Pago API surface
const ROUTES = [
  ['POST', /^\/checkout\/preferences$/, '/checkout/preferences'],
  ['GET', /^\/checkout\/preferences\/([^/]+)$/, '/checkout/preferences/:id'],
  ['GET', /^\/v1\/payments\/(\d{1,32})$/, '/v1/payments/:id'],
  ['GET', /^\/merchant_orders\/(\d{1,32})$/, '/merchant_orders/:id'],
  ['GET', /^\/v1\/chargebacks\/(\d{1,32})$/, '/v1/chargebacks/:id'],
];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mp-stub');
  if (url.pathname.startsWith('/__lab/')) return control(req, res, url.pathname);
  const match = ROUTES.map(([method, re, route]) => [method, url.pathname.match(re), route]).find(([method, m]) => method === req.method && m);
  const route = match?.[2] ?? 'unknown';
  const record = { seq: state.calls.length + 1, method: req.method, route, authorized: req.headers.authorization === `Bearer ${ACCESS_TOKEN}` };
  state.calls.push(record);
  let status;
  try {
    if (!match) status = 404;
    else if (!record.authorized) status = 401;
    else if (url.search) status = 400;
    else {
      const failure = takeFailure(req.method, route);
      if (failure) status = failure.status;
      else {
        const id = decodeURIComponent(match[1][1] ?? '');
        if (route === '/checkout/preferences') status = await createPreference(req, res, record);
        else if (route === '/checkout/preferences/:id') status = getPreference(res, id);
        else {
          const store = route === '/v1/payments/:id' ? state.payments : route === '/merchant_orders/:id' ? state.orders : state.chargebacks;
          const resource = store.get(id);
          if (resource) { send(res, 200, resource); status = 200; } else status = 404;
        }
      }
    }
  } catch { status = 500; }
  if (!res.headersSent) send(res, status, { message: 'lab stub', status });
  record.status = status;
  console.log(`mp-stub ${req.method} ${route} ${status}`);
});
server.listen(PORT, '0.0.0.0', () => console.log(`mp-stub listening on ${PORT}`));
