// PAYMENTS TEST — in-process Mercado Pago emulator for the offline rehearsal and the unit tests. It speaks the exact
// shapes the byte-pinned provider (_shared/mercadoPagoPaymentProvider.ts) reads: /users/me, POST/GET
// /checkout/preferences, /v1/payments/{id}, /v1/payments/search, /merchant_orders/{id}, /v1/chargebacks/{id},
// POST /v1/payments/{id}/refunds. Every payment is a list of provider SNAPSHOTS (date_last_updated ascending); the
// emulator serves the snapshot selected by `serve(id, index)`, which is how the rehearsal reproduces old notifications
// racing newer provider states. Nothing leaves the process.
import crypto from 'node:crypto';

// Sandbox realism (2026-09-26): Mercado Pago Checkout Pro sandbox answers live_mode=true for TEST-seller payments, so the
// emulator defaults to it (`liveMode`); every Preference carries the creating application's client_id and every merchant
// order its application_id (`applicationId`), which the remote-test sandbox policy binds.
export function makeMercadoPago({ sellerId, accessToken, me = null, liveMode: defaultLiveMode = true, applicationId = '4412345678901234' }) {
  const state = { preferences: new Map(), payments: new Map(), orders: new Map(), chargebacks: new Map(), calls: [], served: new Map(), down: null, meOverride: me };
  let seq = 90_000_000_000;
  const nextId = () => String(++seq);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const snapshotOf = (id) => {
    const p = state.payments.get(id); if (!p) return null;
    const i = state.served.get(id) ?? p.snapshots.length - 1;
    return { ...p.base, ...p.snapshots[i] };
  };
  const api = {
    state,
    get calls() { return state.calls.slice(); },
    /** Every call to Mercado Pago fails with this HTTP status (or a network error for 'network') until cleared. */
    setDown(status) { state.down = status; },
    setMe(value) { state.meOverride = value; },
    preference(id) { return state.preferences.get(id) ?? null; },
    /** A checkout payment on a preference (what a test buyer's card attempt produces). */
    pay(preferenceId, { status, statusDetail = null, at, amount = null, currency = 'ARS', externalReference = null, collector = sellerId, liveMode = defaultLiveMode, metadataPurchase = null, inOrder = true, orderPreference = null, orderApplication = applicationId, paymentApplication = undefined }) {
      const pref = state.preferences.get(preferenceId);
      if (!pref) throw new Error('emulator_unknown_preference');
      const id = nextId();
      let orderId = pref.orderId;
      if (!orderId) { orderId = nextId(); pref.orderId = orderId; state.orders.set(orderId, { id: Number(orderId), preference_id: orderPreference ?? preferenceId, external_reference: pref.body.external_reference, collector: { id: Number(sellerId) }, payments: [], application_id: orderApplication }); }
      if (inOrder) state.orders.get(orderId).payments.push({ id: Number(id) });
      state.payments.set(id, { base: { id: Number(id), external_reference: externalReference ?? pref.body.external_reference, currency_id: currency, transaction_amount: amount ?? pref.body.items[0].unit_price,
        collector_id: Number(collector), metadata: { purchase_id: metadataPurchase ?? pref.body.metadata.purchase_id }, order: { id: Number(orderId), type: 'mercadopago' }, live_mode: liveMode, ...(paymentApplication === undefined ? {} : { application_id: paymentApplication }) },
      snapshots: [{ status, status_detail: statusDetail, date_last_updated: at }] });
      return id;
    },
    /** A newer provider state of the same payment (refund, mediation, reimbursement…). */
    update(id, { status, statusDetail = null, at }) { state.payments.get(id).snapshots.push({ status, status_detail: statusDetail, date_last_updated: at }); state.served.delete(id); },
    /** Serve an older snapshot (index) — a stale re-fetch; `null` = latest. */
    serve(id, index) { if (index === null) state.served.delete(id); else state.served.set(id, index); },
    chargeback(paymentId, { liveMode = defaultLiveMode } = {}) { const id = nextId(); state.chargebacks.set(id, { id: Number(id), payments: [Number(paymentId)], currency: 'ARS', amount: 39900, coverage_applied: false, live_mode: liveMode }); return id; },
    async fetch(input, init = {}) {
      const url = new URL(String(input));
      const method = (init.method ?? 'GET').toUpperCase();
      state.calls.push(`${method} ${url.pathname}${url.search}`);
      if (url.origin !== 'https://api.mercadopago.com') throw new TypeError(`emulator refuses ${url.origin}`);
      if (state.down === 'network') throw new TypeError('network down');
      if (state.down) return json(state.down, { message: 'emulated outage' });
      const auth = new Headers(init.headers ?? {}).get('authorization');
      if (auth !== `Bearer ${accessToken}`) return json(401, { message: 'invalid_token' });
      let m;
      if (url.pathname === '/users/me') return json(200, state.meOverride ?? { id: Number(sellerId), nickname: 'TESTUSER_EMULATED', site_id: 'MLA', tags: ['normal', 'test_user'] });
      if (url.pathname === '/checkout/preferences' && method === 'POST') {
        const body = JSON.parse(init.body);
        const key = new Headers(init.headers).get('x-idempotency-key');
        for (const [pid, p] of state.preferences) if (p.idempotencyKey === key) return json(201, p.answer);
        const id = `${sellerId}-${crypto.randomUUID()}`;
        const answer = { id, collector_id: Number(sellerId), client_id: applicationId, init_point: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${id}`, sandbox_init_point: `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=${id}`,
          items: body.items, external_reference: body.external_reference, metadata: body.metadata, notification_url: body.notification_url, back_urls: body.back_urls, auto_return: body.auto_return,
          expires: body.expires, expiration_date_from: body.expiration_date_from, expiration_date_to: body.expiration_date_to, payer: { email: '', name: '' } };
        state.preferences.set(id, { body, idempotencyKey: key, answer, orderId: null });
        return json(201, answer);
      }
      if ((m = /^\/checkout\/preferences\/(.+)$/.exec(url.pathname)) && method === 'GET') { const p = state.preferences.get(m[1]); return p ? json(200, p.answer) : json(404, { message: 'not found' }); }
      if (url.pathname === '/v1/payments/search' && method === 'GET') {
        const ref = url.searchParams.get('external_reference');
        return json(200, { results: [...state.payments.keys()].map(snapshotOf).filter((p) => p.external_reference === ref) });
      }
      if ((m = /^\/v1\/payments\/(\d+)\/refunds$/.exec(url.pathname)) && method === 'POST') {
        const p = state.payments.get(m[1]); if (!p) return json(404, { message: 'not found' });
        const last = p.snapshots.at(-1);
        api.update(m[1], { status: 'refunded', statusDetail: 'refunded', at: new Date(Date.parse(last.date_last_updated) + 60_000).toISOString() });
        return json(201, { id: Number(nextId()), payment_id: Number(m[1]), amount: p.base.transaction_amount, status: 'approved' });
      }
      if ((m = /^\/v1\/payments\/(\d+)$/.exec(url.pathname))) { const p = snapshotOf(m[1]); return p ? json(200, p) : json(404, { message: 'Payment not found' }); }
      if ((m = /^\/merchant_orders\/(\d+)$/.exec(url.pathname))) { const o = state.orders.get(m[1]); return o ? json(200, o) : json(404, { message: 'not found' }); }
      if ((m = /^\/v1\/chargebacks\/(\d+)$/.exec(url.pathname))) { const c = state.chargebacks.get(m[1]); return c ? json(200, c) : json(404, { message: 'not found' }); }
      return json(404, { message: 'unknown endpoint' });
    },
  };
  return api;
}

/** A Mercado Pago-shaped signed notification (x-signature over the raw ts bytes). */
export function signedNotification({ base, secret, dataId, sellerId, type = 'payment', body = null, ts = String(Date.now()), requestId = crypto.randomUUID(), host = null, liveMode = true }) {
  const data = type === 'topic_chargebacks_wh' ? { id: String(dataId), checkout: 'PRO' } : { id: String(dataId) };
  const payload = body ?? { id: Number(dataId) + 1, live_mode: liveMode, type, date_created: new Date().toISOString(), user_id: Number(sellerId), api_version: 'v1', action: `${type}.updated`, data };
  const v1 = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  const url = `${base}/webhooks/mercadopago/v1?data.id=${encodeURIComponent(dataId)}&type=${encodeURIComponent(type)}`;
  return { url, init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}`, ...(host ? { host } : {}) }, body: JSON.stringify(payload) } };
}
/** The gateway → payments internal HMAC (hmac.ts manifest). */
export function signedInternal({ url, secretHex, body, time = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID() }) {
  const path = '/internal/v1/season-checkout-preference';
  const sig = crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${path}\n${time}\n${nonce}\n${body}`).digest('hex');
  return { url, init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-time': time, 'x-nonce': nonce, 'x-signature': sig }, body } };
}
