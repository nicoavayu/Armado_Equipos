// MP-A3 — T3: torneos-payments internal endpoint POST /internal/v1/season-checkout-preference.
//   Part A (offline): the handler with an in-memory DB and a fake Mercado Pago, for projections the real
//   database cannot even hold (provider/environment/currency/amount are DB CHECKs) — defence in depth.
//   Part B (lab): the REAL function on the local edge-runtime, the REAL Torneos DB (0000 → 0001 → 0002)
//   through the payment-service login, and the lab mp-stub. Requires TORNEOS_LAB_MODE=commerce lab up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  cfg, internal, http, signInternal, stub, stubCalls, newPurchase, preparedPurchase, purchaseRow, eventTypes, admin, asPay, lit,
  waitPayments, writeEvidence, assertNoLeak, INTERNAL_PATH, WEBHOOK_PATH, sqlRaw, RUN,
} from './payments-lab.mjs';
import { UNIT_ENV, UNIT_SECRET_HEX } from './payments-unit-env.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const results = [];
const bodies = [];
const HANDLER = `${repo}backend/torneos/supabase/functions/torneos-payments/handler.ts`;

// ---------------------------------------------------------------- Part A fixtures
const SECRET_HEX = UNIT_SECRET_HEX;
const PID = '50000000-0000-4000-8000-0000000000a1';
const projection = (over = {}) => ({ schemaVersion: 3, id: PID, organizationId: '10000000-0000-4000-8000-000000000001', seasonId: '20000000-0000-4000-8000-000000000001',
  tournamentId: null, productCode: 'torneos_premium', provider: 'MERCADO_PAGO', providerEnvironment: 'test', providerPreferenceId: null,
  externalReference: `arma2:season:purchase:${PID}`, status: 'created', amount: 39900, listAmount: 49900, currency: 'ARS',
  createdAt: '2026-09-22T00:00:00.000Z', preferenceExpiresAt: '2026-09-22T00:30:00.000Z', ...over });
function unitService(purchase, { fetcherCalls = [] } = {}) {
  const calls = [];
  return import(HANDLER).then(({ createPaymentsService }) => ({
    calls, fetcherCalls,
    handle: createPaymentsService({
      env: UNIT_ENV, log: () => {}, now: () => Date.parse('2026-09-22T00:10:00.000Z'),
      connectDb: () => ({ async call(name, args) { calls.push([name, args]); if (name === 'get_provider_tournament_purchase') return purchase;
        if (name === 'record_tournament_purchase_preference') return { ...purchase, status: 'preference_created', providerPreferenceId: args[3], preferenceExpiresAt: args[4], idempotentReplay: false };
        throw new Error('unexpected'); } }),
      fetcher: async (url, init) => { fetcherCalls.push([String(url), init?.method]);
        return new Response(JSON.stringify({ id: 'pref-unit-1', collector_id: 123456789, init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-unit-1' }), { status: 201 }); },
    }),
  }));
}
async function unitCall(service, payload) {
  const body = JSON.stringify(payload);
  const time = Math.floor(Date.parse('2026-09-22T00:10:00.000Z') / 1000);
  const nonce = randomUUID();
  const signature = createHmac('sha256', Buffer.from(SECRET_HEX, 'hex')).update(`${INTERNAL_PATH}\n${time}\n${nonce}\n${body}`).digest('hex');
  const r = await service.handle(new Request(`http://unit.invalid/torneos-payments${INTERNAL_PATH}`, { method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-time': String(time), 'x-nonce': nonce, 'x-signature': signature } }));
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('MP-A3 — T3 checkout internal endpoint', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 300) }); throw error; }
    });
  }
  const record = (r) => { bodies.push(r.text ?? JSON.stringify(r.body)); return r; };
  try {
    // ============================================================ Part A — offline handler (defence in depth)
    await check('unit: a projection with provider ≠ MERCADO_PAGO → 422 purchase_invalid; Mercado Pago never called; nothing recorded', async () => {
      const s = await unitService(projection({ provider: 'FAKE' }));
      const r = await unitCall(s, { purchase_id: PID });
      assert.deepEqual([r.status, r.body?.error], [422, 'purchase_invalid']);
      assert.equal(s.fetcherCalls.length, 0); assert.deepEqual(s.calls.map(c => c[0]), ['get_provider_tournament_purchase']);
    });
    await check('unit: environment ≠ test (production / live / qa) → 422 purchase_invalid', async () => {
      for (const env of ['production', 'live', 'qa', 'local']) {
        const s = await unitService(projection({ providerEnvironment: env }));
        const r = await unitCall(s, { purchase_id: PID });
        assert.deepEqual([env, r.status, r.body?.error], [env, 422, 'purchase_invalid']); assert.equal(s.fetcherCalls.length, 0);
      }
    });
    await check('unit: currency ≠ ARS, amount 0 / negative / fractional / string → 422 purchase_invalid', async () => {
      for (const over of [{ currency: 'USD' }, { amount: 0 }, { amount: -1 }, { amount: 399.5 }, { amount: '39900' }]) {
        const s = await unitService(projection(over));
        const r = await unitCall(s, { purchase_id: PID });
        assert.deepEqual([JSON.stringify(over), r.status], [JSON.stringify(over), 422]); assert.equal(s.fetcherCalls.length, 0);
      }
    });
    await check('unit: a DB projection of another purchase id / external reference → refused; the price is the DB snapshot (39900) and the MP call goes only to the Mercado Pago API origin', async () => {
      const other = await unitService(projection({ id: '50000000-0000-4000-8000-0000000000ff' }));
      assert.equal((await unitCall(other, { purchase_id: PID })).status, 422);
      const ok = await unitService(projection());
      const r = await unitCall(ok, { purchase_id: PID });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(Object.keys(r.body).sort(), ['checkoutUrl', 'expiresAt', 'preferenceId', 'provider']);
      assert.equal(r.body.expiresAt, '2026-09-22T00:40:00.000Z', 'created → now + 30 min');
      const recorded = ok.calls.find(c => c[0] === 'record_tournament_purchase_preference')[1];
      assert.deepEqual(recorded, [PID, 'MERCADO_PAGO', 'test', 'pref-unit-1', '2026-09-22T00:40:00.000Z'], 'same expiry in MP body and DB');
      assert.deepEqual(ok.fetcherCalls, [['https://api.mercadopago.com/checkout/preferences', 'POST']]);
    });

    // ============================================================ Part B — REAL function + DB + mp-stub
    await check('lab: commerce lab reachable (mp-stub up, torneos-payments answers)', async () => {
      assert.ok(cfg?.mpa, 'commerce .runtime present (TORNEOS_LAB_MODE=commerce node lab.mjs up)');
      await stub('/__lab/health');
      await stub('/__lab/reset', {}); // no scenario queued by an earlier run survives
      assert.equal(await waitPayments(), 401, 'unsigned request → 401 (function booted with a valid config)');
    });
    let p;
    await check('HMAC valid + created purchase → 200; Preference created at the stub and recorded in the DB (preference_created, same id, same expiry now+30min)', async () => {
      p = newPurchase('ok');
      const before = Date.now();
      const r = record(await internal({ purchase_id: p.id }));
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(Object.keys(r.body).sort(), ['checkoutUrl', 'expiresAt', 'preferenceId', 'provider']);
      assert.equal(r.body.provider, 'MERCADO_PAGO');
      const row = purchaseRow(p.id);
      assert.equal(row.status, 'preference_created'); assert.equal(row.provider_preference_id, r.body.preferenceId);
      assert.equal(Date.parse(row.preference_expires_at), Date.parse(r.body.expiresAt), 'DB expiry == response expiry');
      const delta = Date.parse(r.body.expiresAt) - before;
      assert.ok(delta > 29 * 60_000 && delta < 31 * 60_000, `expiry ≈ now + 30 min (${delta})`);
      const call = (await stubCalls()).filter(c => c.route === '/checkout/preferences' && c.idempotencyKey === p.id);
      assert.equal(call.length, 1);
      assert.equal(Date.parse(call[0].body.expiration_date_to), Date.parse(r.body.expiresAt), 'MP expiration_date_to == DB expiry');
      assert.deepEqual(eventTypes(p.id), ['purchase.created', 'preference.created']);
    });
    await check('price comes from the DB: unit_price == amount_snapshot, ARS, quantity 1; X-Idempotency-Key == purchase.id; bearer is the TEST token; metadata/external_reference bound', async () => {
      const row = purchaseRow(p.id);
      const [call] = (await stubCalls()).filter(c => c.route === '/checkout/preferences' && c.idempotencyKey === p.id);
      assert.equal(call.idempotencyKey, p.id); assert.equal(call.authorized, true);
      assert.equal(call.body.unit_price, row.amount_snapshot); assert.equal(call.body.currency_id, 'ARS'); assert.equal(call.body.quantity, 1);
      assert.equal(call.body.external_reference, `arma2:season:purchase:${p.id}`); assert.equal(call.body.metadata_purchase_id, p.id);
      assert.ok(call.body.notification_url.endsWith('/torneos-payments/webhooks/mercadopago/v1'));
      assert.ok(call.body.back_url_success.startsWith('https://torneos-mp-a3.lab.invalid/torneos/organizacion/'));
    });
    await check('checkout URL host valid: https + mercadopago.com(.ar) exactly as the provider guard', async () => {
      const r = record(await internal({ purchase_id: p.id }));
      const u = new URL(r.body.checkoutUrl);
      assert.equal(u.protocol, 'https:'); assert.match(u.hostname, /(^|\.)mercadopago\.com(\.ar)?$/);
    });
    await check('preference_created → the existing Preference is reused (GET, no new POST), same id and DB expiry; DB untouched', async () => {
      const row = purchaseRow(p.id);
      const posts = (await stubCalls()).filter(c => c.route === '/checkout/preferences').length;
      const r = record(await internal({ purchase_id: p.id }));
      assert.equal(r.status, 200); assert.equal(r.body.preferenceId, row.provider_preference_id);
      assert.equal(Date.parse(r.body.expiresAt), Date.parse(row.preference_expires_at));
      assert.equal((await stubCalls()).filter(c => c.route === '/checkout/preferences').length, posts, 'no second POST');
      assert.ok((await stubCalls()).some(c => c.route === '/checkout/preferences/:id' && c.status === 200));
      assert.deepEqual(purchaseRow(p.id), row);
    });
    await check('bad signature / wrong secret → 401; nothing created', async () => {
      const q = newPurchase('badsig');
      assert.equal(record(await internal({ purchase_id: q.id }, { headers: { 'x-signature': '0'.repeat(64) } })).status, 401);
      assert.equal(record(await internal({ purchase_id: q.id }, { sign: { secretHex: 'b2'.repeat(32) } })).status, 401);
      assert.equal(record(await internal({ purchase_id: q.id }, { headers: { 'x-signature': 'zz' } })).status, 401);
      assert.equal(purchaseRow(q.id).status, 'created');
    });
    await check('timestamp outside ±30 s (old / future / non-numeric) → 401; inside the window → accepted', async () => {
      const q = newPurchase('time');
      const now = Math.floor(Date.now() / 1000);
      for (const time of [now - 45, now + 45, now - 3600, 'abc', '']) assert.equal(record(await internal({ purchase_id: q.id }, { sign: { time } })).status, 401, `time ${time}`);
      assert.equal(purchaseRow(q.id).status, 'created');
      assert.equal(record(await internal({ purchase_id: q.id }, { sign: { time: now - 20 } })).status, 200, 'now-20 accepted');
    });
    await check('nonce missing / empty → 401; a replayed nonce → 401', async () => {
      const q = newPurchase('nonce');
      assert.equal(record(await internal({ purchase_id: q.id }, { sign: { nonce: '' } })).status, 401);
      const body = JSON.stringify({ purchase_id: q.id });
      const h = signInternal({ body });
      const noNonce = { ...h }; delete noNonce['x-nonce'];
      assert.equal(record(await http(INTERNAL_PATH, { headers: { 'content-type': 'application/json', ...noNonce }, body })).status, 401);
      assert.equal(record(await http(INTERNAL_PATH, { headers: { 'content-type': 'application/json', ...h }, body })).status, 200);
      assert.equal(record(await http(INTERNAL_PATH, { headers: { 'content-type': 'application/json', ...h }, body })).status, 401, 'replay');
    });
    await check('body altered after signing / path altered (signed for another path) → 401', async () => {
      const q = newPurchase('alter'); const other = newPurchase('alter2');
      const signedBody = JSON.stringify({ purchase_id: q.id });
      const h = signInternal({ body: signedBody });
      assert.equal(record(await http(INTERNAL_PATH, { headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify({ purchase_id: other.id }) })).status, 401);
      assert.equal(record(await http(INTERNAL_PATH, { headers: { 'content-type': 'application/json', ...h }, body: signedBody + ' ' })).status, 401);
      assert.equal(record(await internal({ purchase_id: q.id }, { sign: { path: WEBHOOK_PATH } })).status, 401);
      assert.equal(record(await internal({ purchase_id: q.id }, { sign: { path: `/torneos-payments${INTERNAL_PATH}` } })).status, 401);
      assert.equal(purchaseRow(q.id).status, 'created'); assert.equal(purchaseRow(other.id).status, 'created');
    });
    await check('request with Origin → 403; with Authorization bearer (even with a valid HMAC) → 403; nothing created', async () => {
      const q = newPurchase('origin');
      assert.equal(record(await internal({ purchase_id: q.id }, { headers: { origin: 'https://torneos-mp-a3.lab.invalid' } })).status, 403);
      assert.equal(record(await internal({ purchase_id: q.id }, { headers: { authorization: `Bearer ${cfg.anonKey}` } })).status, 403);
      assert.equal(purchaseRow(q.id).status, 'created');
    });
    await check('input is exactly { purchase_id: <uuid> }: invalid UUID, extra fields (price/org/season/user/provider/environment/urls), arrays, non-JSON → 400', async () => {
      const q = newPurchase('input');
      for (const payload of [{ purchase_id: 'not-a-uuid' }, { purchase_id: 42 }, {}, [q.id], null,
        { purchase_id: q.id, price: 1 }, { purchase_id: q.id, amount: 1 }, { purchase_id: q.id, organization_id: q.org }, { purchase_id: q.id, season_id: q.season },
        { purchase_id: q.id, user_id: randomUUID() }, { purchase_id: q.id, provider: 'FAKE' }, { purchase_id: q.id, environment: 'live' },
        { purchase_id: q.id, back_url: 'https://evil.invalid' }, { purchaseId: q.id }]) {
        assert.equal(record(await internal(payload)).status, 400, JSON.stringify(payload));
      }
      assert.equal(record(await internal(null, { rawBody: '{"purchase_id":' })).status, 400);
      assert.equal(record(await internal(null, { rawBody: 'x'.repeat(5000) })).status, 413);
      assert.equal(purchaseRow(q.id).status, 'created');
      assert.equal((await stubCalls()).filter(c => c.idempotencyKey === q.id).length, 0, 'Mercado Pago never called');
    });
    await check('purchase inexistent → 404', async () => {
      const r = record(await internal({ purchase_id: randomUUID() }));
      assert.deepEqual([r.status, r.body?.error], [404, 'purchase_not_found']);
    });
    await check('provider / environment incorrect in the DB (FAKE local / FAKE qa purchase) → 404: the payment service lookup never returns it; amount/currency invalid cannot exist (CHECK 23514)', async () => {
      for (const env of ['local', 'qa']) {
        const f = newPurchase(`fake-${env}`);
        const id = randomUUID();
        admin(`insert into public.tournament_purchases (id, organization_id, season_id, buyer_user_id, product_code, offer_code, offer_version, list_amount_snapshot, amount_snapshot, currency, provider, provider_environment, external_reference, idempotency_key, status)
          select ${lit(id)}, organization_id, season_id, buyer_user_id, product_code, offer_code, offer_version, list_amount_snapshot, amount_snapshot, currency, 'FAKE', ${lit(env)}, ${lit(`arma2:season:purchase:${id}`)}, ${lit(randomUUID())}, 'cancelled' from public.tournament_purchases where id = ${lit(f.id)}`);
        const r = record(await internal({ purchase_id: id }));
        assert.deepEqual([env, r.status], [env, 404]);
      }
      const f = newPurchase('check');
      for (const [label, cols] of [['amount 0', "0, 'ARS'"], ['amount negative', "-1, 'ARS'"], ['currency USD', "39900, 'USD'"]]) {
        const id = randomUUID();
        const r = sqlRaw(`BEGIN; insert into public.tournament_purchases (id, organization_id, season_id, buyer_user_id, product_code, offer_code, offer_version, list_amount_snapshot, amount_snapshot, currency, provider, provider_environment, external_reference, idempotency_key, status)
          select ${lit(id)}, organization_id, season_id, buyer_user_id, product_code, offer_code, offer_version, list_amount_snapshot, ${cols}, 'MERCADO_PAGO', 'test', ${lit(`arma2:season:purchase:${id}`)}, ${lit(randomUUID())}, 'cancelled' from public.tournament_purchases where id = ${lit(f.id)}; ROLLBACK;`);
        assert.ok(!r.ok && /23514/.test(r.error), `${label} rejected by CHECK: ${r.error}`);
      }
    });
    await check('status not payable (pending / approved / cancelled / expired preference) → 409; Mercado Pago not called', async () => {
      const pend = await preparedPurchase('pending');
      asPay(`select public.apply_verified_tournament_payment_status(${lit(pend.id)}, 'MERCADO_PAGO', 'test', 'pending', 'pending', null, '9${Date.now() % 1e8}', '2026-09-20T00:00:01Z'::timestamptz)`);
      const appr = await preparedPurchase('approved');
      asPay(`select public.apply_verified_tournament_payment_status(${lit(appr.id)}, 'MERCADO_PAGO', 'test', 'approved', 'approved', 'accredited', '8${Date.now() % 1e8}', '2026-09-20T00:00:01Z'::timestamptz)`);
      const canc = newPurchase('cancelled');
      admin(`update public.tournament_purchases set status = 'cancelled', cancelled_at = now() where id = ${lit(canc.id)}`);
      const exp = await preparedPurchase('expiredpref');
      admin(`update public.tournament_purchases set preference_expires_at = now() - interval '1 minute' where id = ${lit(exp.id)}`);
      const gets = (await stubCalls()).length;
      for (const [q, status, error] of [[pend, 'pending', 'purchase_not_payable'], [appr, 'approved', 'purchase_not_payable'], [canc, 'cancelled', 'purchase_not_payable'], [exp, 'preference_created', 'preference_expired']]) {
        assert.equal(purchaseRow(q.id).status, status);
        const r = record(await internal({ purchase_id: q.id }));
        assert.deepEqual([status, r.status, r.body?.error], [status, 409, error]);
      }
      assert.equal((await stubCalls()).length, gets, 'Mercado Pago not called');
    });
    await check('Preference conflict: another preference recorded while Mercado Pago answered → 409 preference_conflict, DB keeps the first; existing preference whose MP id differs → 502, DB untouched', async () => {
      const q = newPurchase('conflict');
      await stub('/__lab/preference-mode', { delayMs: 2500, times: 1 });
      const pending = internal({ purchase_id: q.id });
      await new Promise(r => setTimeout(r, 900));
      asPay(`select public.record_tournament_purchase_preference(${lit(q.id)}, 'MERCADO_PAGO', 'test', ${lit(`racing-${RUN}`)}, now() + interval '30 minutes')`);
      const r = record(await pending);
      assert.deepEqual([r.status, r.body?.error], [409, 'preference_conflict']);
      assert.equal(purchaseRow(q.id).provider_preference_id, `racing-${RUN}`);
      const g = await preparedPurchase('getmismatch');
      const before = purchaseRow(g.id);
      await stub('/__lab/preference-mode', { mode: 'other_id_on_get', times: 1 });
      const m = record(await internal({ purchase_id: g.id }));
      assert.deepEqual([m.status, m.body?.error], [502, 'provider_response_invalid']);
      assert.deepEqual(purchaseRow(g.id), before);
    });
    await check('malicious / look-alike checkout host, http scheme, missing init_point, foreign collector → 502 provider_response_invalid; nothing recorded (purchase stays created)', async () => {
      for (const mode of ['lookalike_host', 'suffix_host', 'http_scheme', 'missing_init_point', 'wrong_collector']) {
        const q = newPurchase(mode.replace(/_/g, ''));
        await stub('/__lab/preference-mode', { mode, times: 1 });
        const r = record(await internal({ purchase_id: q.id }));
        assert.deepEqual([mode, r.status, r.body?.error], [mode, 502, 'provider_response_invalid']);
        assert.equal(purchaseRow(q.id).status, 'created', mode); assert.equal(purchaseRow(q.id).provider_preference_id, null);
        assert.ok(!r.text.includes('lab-attacker') && !r.text.includes('evilmercadopago'), 'bad URL never returned');
      }
    });
    await check('Mercado Pago 5xx on create → 503 provider_unavailable; purchase stays created; a retry succeeds with the same idempotency key', async () => {
      const q = newPurchase('mp5xx');
      await stub('/__lab/fail', { method: 'POST', route: '/checkout/preferences', status: 502, times: 1 });
      const r = record(await internal({ purchase_id: q.id }));
      assert.deepEqual([r.status, r.body?.error], [503, 'provider_unavailable']);
      assert.equal(purchaseRow(q.id).status, 'created');
      const ok = record(await internal({ purchase_id: q.id }));
      assert.equal(ok.status, 200); assert.equal(purchaseRow(q.id).status, 'preference_created');
    });
    await check('other methods / paths → 404 (no generic proxy, no CORS preflight)', async () => {
      for (const [method, path] of [['GET', INTERNAL_PATH], ['PUT', INTERNAL_PATH], ['OPTIONS', INTERNAL_PATH], ['POST', '/internal/v1/other'],
        ['POST', `${INTERNAL_PATH}/x`], ['POST', '/'], ['GET', '/health'], ['POST', '/rest/v1/rpc/get_provider_tournament_purchase']]) {
        const r = record(await http(path, { method, body: method === 'GET' || method === 'OPTIONS' ? undefined : '{}' }));
        assert.deepEqual([method, path, r.status], [method, path, 404]);
        assert.ok(!Object.keys(r.headers).some(h => h.startsWith('access-control-')), 'no CORS headers');
      }
      const q = newPurchase('query');
      assert.equal(record(await http(INTERNAL_PATH, { query: '?x=1', headers: { 'content-type': 'application/json', ...signInternal({ body: JSON.stringify({ purchase_id: q.id }) }) }, body: JSON.stringify({ purchase_id: q.id }) })).status, 400);
    });
    await check('responses carry no secrets: no token, webhook secret, internal secret, seller, DB URL, internal headers, raw provider response or payer data', async () => {
      const all = bodies.join('\n');
      assertNoLeak(all, [cfg.mpa.sellerId], 'T3 responses');
      assert.ok(!/collector_id|init_point|sandbox_init_point|items|back_urls|notification_url|x-signature|x-nonce|lab_payment_service/.test(all));
    });
  } finally {
    await writeEvidence('t3-checkout-internal', { suite: 'MP-A3 T3 checkout internal', results,
      passed: results.filter(r => r.status === 'PASS').length, total: results.length });
  }
});
