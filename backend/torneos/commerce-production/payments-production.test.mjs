// COMMERCE-PRODUCTION — torneos-payments-production: configuration, routes and the whole payment lifecycle.
//   Part U (offline): configuration refusals, attestation, HMAC, Preference contract, webhook gates, binding policy, with a
//          fake database. Always runs.
//   Part E (lab): the real handler + the lab PostgreSQL (migrations 0000 → 0013, the production LOGIN) + the Mercado Pago
//          emulator in production shape. Checkout → Preference → payment → webhook / reconcile → grant, and every
//          adversarial case the brief lists. Needs Docker (lab/pg-lab.mjs up is run by the suite).
//   node --test --test-concurrency=1 backend/torneos/commerce-production/payments-production.test.mjs
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BASE, emulator, internalRequest, LAB_ENV, labProductionDb, PREFERENCE_PATH, RECONCILE_PATH, SECRET_HEX, SELLER, send, service, TOKEN,
  WEBHOOK_SECRET, webhookRequest,
} from './lab/payments-harness.mjs';

const FUNCTIONS = new URL('../supabase/functions/torneos-payments-production/', import.meta.url);
const { loadProductionPaymentsConfig, notificationHostProblem, hostedDbProblem } = await import(new URL('config.ts', FUNCTIONS).href);

const HOSTED = Object.freeze({
  ...LAB_ENV,
  TORNEOS_PAYMENTS_DEPLOYMENT: 'production',
  APP_PUBLIC_URL: 'https://app.arma2.com.ar',
  TORNEOS_PAYMENTS_NOTIFICATION_URL: 'https://torneos-payments.example-org.deno.net/functions/v1/torneos-payments-production/webhooks/mercadopago/v1',
  TORNEOS_PAYMENTS_DB_URL: 'postgres://torneos_payments_prod.onzpwnqxnvlgsevivngf:pw@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',
  TORNEOS_PAYMENTS_DB_SSL_CA: '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----',
});
const refusedConfig = (env) => { try { loadProductionPaymentsConfig(env); return null; } catch (error) { return error.message; } };

// ============================================================================ Part U — offline
describe('configuration (fail closed, production only)', () => {
  test('the lab shape and the hosted shape load', () => {
    assert.equal(loadProductionPaymentsConfig(LAB_ENV).deployment, null);
    const hosted = loadProductionPaymentsConfig(HOSTED);
    assert.deepEqual([hosted.deployment, hosted.host, hosted.appBaseUrl], ['production', 'torneos-payments.example-org.deno.net', 'https://app.arma2.com.ar']);
  });

  test('TEST material, other environments and foreign secrets refuse the boot', () => {
    for (const [name, env] of Object.entries({
      'environment test': { ...LAB_ENV, MERCADO_PAGO_ENVIRONMENT: 'test' },
      'environment missing': { ...LAB_ENV, MERCADO_PAGO_ENVIRONMENT: '' },
      'a TEST token next to production': { ...LAB_ENV, MERCADO_PAGO_TEST_ACCESS_TOKEN: 'APP_USR-x' },
      'a TEST- token': { ...LAB_ENV, MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: 'TEST-1234567890-abcdef-0123456789' },
      'the QA pin of the TEST runtime': { ...LAB_ENV, TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID: randomUUID() },
      'a generic MP name': { ...LAB_ENV, MERCADO_PAGO_ACCESS_TOKEN: TOKEN },
      'gateway bridge keys': { ...LAB_ENV, TORNEOS_BRIDGE_KEYS: 'x' },
      'a PG variable': { ...LAB_ENV, PGPASSWORD: 'x' },
      'the TEST login': { ...LAB_ENV, TORNEOS_PAYMENTS_DB_URL: 'postgres://torneos_payments_test:pw@db.unit.invalid:5432/postgres' },
      'the installer login': { ...LAB_ENV, TORNEOS_PAYMENTS_DB_URL: 'postgres://postgres:pw@db.unit.invalid:5432/postgres' },
      'a short internal secret': { ...LAB_ENV, TORNEOS_PAYMENTS_INTERNAL_SECRET: 'ab'.repeat(16) },
      'secrets reused': { ...LAB_ENV, MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: SECRET_HEX },
      'non-numeric seller': { ...LAB_ENV, MERCADO_PAGO_PRODUCTION_SELLER_ID: 'abc' },
    })) assert.ok(refusedConfig(env), name);
  });

  test('a non-hosted configuration can reach nothing real', () => {
    assert.match(refusedConfig({ ...LAB_ENV, APP_PUBLIC_URL: 'https://app.arma2.com.ar' }), /\.invalid/);
    assert.match(refusedConfig({ ...LAB_ENV, TORNEOS_PAYMENTS_DB_URL: 'postgres://x:pw@aws-0-sa-east-1.pooler.supabase.com:6543/postgres' }), /DEPLOYMENT=production/);
  });

  test('hosted production pins the pooler login, TLS, the web app and a production notification host', () => {
    assert.match(refusedConfig({ ...HOSTED, TORNEOS_PAYMENTS_DB_SSL_CA: '' }), /SSL_CA/);
    assert.match(refusedConfig({ ...HOSTED, APP_PUBLIC_URL: 'https://arma2-preview.vercel.app' }), /production web app/);
    assert.match(refusedConfig({ ...HOSTED, TORNEOS_PAYMENTS_DB_URL: HOSTED.TORNEOS_PAYMENTS_DB_URL.replace('torneos_payments_prod', 'other_login') }), /login/);
    assert.match(refusedConfig({ ...HOSTED, TORNEOS_PAYMENTS_DB_URL: HOSTED.TORNEOS_PAYMENTS_DB_URL.replace('onzpwnqxnvlgsevivngf', 'rcyuuoaqfwcembdajcss') }), /Core|login/);
    assert.match(refusedConfig({ ...HOSTED, TORNEOS_PAYMENTS_NOTIFICATION_URL: HOSTED.TORNEOS_PAYMENTS_NOTIFICATION_URL.replace('torneos-payments.', 'torneos-payments-test.') }), /non-production/);
    assert.match(refusedConfig({ ...HOSTED, SUPABASE_URL: 'https://x.supabase.co' }), /hosted production/);
    assert.match(refusedConfig({ ...HOSTED, TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: 'http://mp-stub:8080' }), /lab/);
    assert.equal(notificationHostProblem('app.arma2.com.ar'), 'is the web app host');
    assert.equal(hostedDbProblem(new URL('postgres://torneos_payments_prod.onzpwnqxnvlgsevivngf:pw@db.example.com:5432/postgres')), 'host');
  });
});

/** An in-memory database answering the production RPCs for one purchase (Part U only). */
function memoryDb(purchase, { applied = [] } = {}) {
  return {
    applied,
    async call(name, args) {
      if (name === 'get_production_provider_tournament_purchase') {
        if (args[0] !== purchase.externalReference) { const e = new (await import(new URL('rpc.ts', FUNCTIONS).href)).DbError('P0002', 'TORNEOS_PURCHASE_NOT_FOUND'); throw e; }
        return purchase;
      }
      if (name === 'record_production_tournament_purchase_preference') {
        Object.assign(purchase, { status: 'preference_created', providerPreferenceId: args[1], preferenceExpiresAt: args[2] });
        return { ...purchase, idempotentReplay: false };
      }
      if (name.startsWith('apply_production')) { applied.push([name, ...args]); return { ...purchase, outcome: 'approved', status: 'approved' }; }
      if (name === 'claim_production_tournament_purchase_check') return { ...purchase, claimed: true };
      if (name === 'complete_production_tournament_purchase_check') return { purchaseId: args[0], checks: 1 };
      if (name === 'list_production_tournament_purchases_to_reconcile') return [purchase];
      throw new Error(`unexpected ${name}`);
    },
  };
}
function projection(over = {}) {
  const id = randomUUID();
  return { schemaVersion: 3, id, organizationId: randomUUID(), seasonId: randomUUID(), tournamentId: null, productCode: 'torneos_premium',
    provider: 'MERCADO_PAGO', providerEnvironment: 'production', providerPreferenceId: null, externalReference: `arma2:season:purchase:${id}`,
    status: 'created', amount: 39900, listAmount: 49900, currency: 'ARS', createdAt: new Date().toISOString(),
    preferenceExpiresAt: new Date(Date.now() + 1800_000).toISOString(), ...over };
}

describe('routes (offline)', () => {
  test('a TEST seller token disables every route (attestation), and so does another seller', async () => {
    for (const me of [{ id: Number(SELLER), site_id: 'MLA', tags: ['test_user'] }, { id: 1234567, site_id: 'MLA', tags: [] }, { id: Number(SELLER), site_id: 'MLB', tags: [] }]) {
      const mp = emulator({ me });
      const svc = service({ db: memoryDb(projection()), mp });
      const r = await send(svc, internalRequest(PREFERENCE_PATH, { purchase_id: randomUUID() }));
      assert.equal(r.status, 503);
      assert.ok(!mp.calls.some((c) => c.startsWith('POST')), 'nothing written to Mercado Pago');
    }
  });

  test('unknown paths, methods and unsigned internal calls are refused', async () => {
    const svc = service({ db: memoryDb(projection()), mp: emulator() });
    assert.equal((await send(svc, new Request(`${BASE}/health`))).status, 404);
    assert.equal((await send(svc, new Request(`${BASE}${PREFERENCE_PATH}`, { method: 'GET' }))).status, 404);
    assert.equal((await send(svc, new Request(`${BASE}${PREFERENCE_PATH}`, { method: 'POST', body: '{}' }))).status, 401);
    assert.equal((await send(svc, internalRequest(PREFERENCE_PATH, { purchase_id: randomUUID() }, { secretHex: 'ab'.repeat(32) }))).status, 401);
    assert.equal((await send(svc, internalRequest(RECONCILE_PATH, { purchase_id: randomUUID(), extra: 1 }))).status, 400);
    const stale = String(Math.floor(Date.now() / 1000) - 120);
    assert.equal((await send(svc, internalRequest(PREFERENCE_PATH, { purchase_id: randomUUID() }, { time: stale }))).status, 401);
  });

  test('the Preference is exactly the certified Checkout Pro body, idempotent per purchase, with production URLs', async () => {
    const purchase = projection();
    const mp = emulator();
    const svc = service({ db: memoryDb(purchase), mp });
    const r = await send(svc, internalRequest(PREFERENCE_PATH, { purchase_id: purchase.id }));
    assert.equal(r.status, 200);
    assert.match(r.body.checkoutUrl, /^https:\/\/www\.mercadopago\.com\.ar\//);
    const pref = mp.preference(r.body.preferenceId);
    assert.equal(pref.idempotencyKey, purchase.id);
    assert.deepEqual(pref.body.items, [{ id: 'torneos_premium', title: 'Arma2 Torneos Premium', quantity: 1, currency_id: 'ARS', unit_price: 39900 }]);
    assert.equal(pref.body.external_reference, purchase.externalReference);
    assert.deepEqual(pref.body.metadata, { purchase_id: purchase.id });
    assert.equal(pref.body.notification_url, LAB_ENV.TORNEOS_PAYMENTS_NOTIFICATION_URL);
    assert.equal(pref.body.back_urls.success, `https://app.unit.invalid/torneos/organizacion/${purchase.organizationId}/temporada/${purchase.seasonId}/plan/compra/${purchase.id}/exito`);
    assert.equal(pref.body.auto_return, 'approved');
    // A second request reuses the recorded Preference (GET), never a new POST.
    const again = await send(svc, internalRequest(PREFERENCE_PATH, { purchase_id: purchase.id }));
    assert.equal(again.body.preferenceId, r.body.preferenceId);
    assert.equal(mp.calls.filter((c) => c === 'POST /checkout/preferences').length, 1);
  });

  test('an expired Preference is never reused; a foreign or sandbox Preference answer is refused', async () => {
    const expired = projection({ status: 'preference_created', providerPreferenceId: `${SELLER}-${randomUUID()}`, preferenceExpiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.deepEqual(await send(service({ db: memoryDb(expired), mp: emulator() }), internalRequest(PREFERENCE_PATH, { purchase_id: expired.id })),
      { status: 409, body: { error: 'preference_expired' } });
    const purchase = projection();
    const mp = emulator();
    const original = mp.fetch;
    mp.fetch = async (input, init) => {
      const response = await original(input, init);
      if (String(input).endsWith('/checkout/preferences') && init?.method === 'POST') {
        const body = await response.json();
        return new Response(JSON.stringify({ ...body, init_point: body.sandbox_init_point }), { status: 201 });
      }
      return response;
    };
    const r = await send(service({ db: memoryDb(purchase), mp }), internalRequest(PREFERENCE_PATH, { purchase_id: purchase.id }));
    assert.deepEqual(r, { status: 502, body: { error: 'provider_response_invalid' } });
    assert.equal(purchase.status, 'created', 'nothing recorded');
  });

  test('webhook gates: signature, live_mode true, the production seller, the topic', async () => {
    const purchase = projection();
    const db = memoryDb(purchase);
    const svc = service({ db, mp: emulator() });
    assert.equal((await send(svc, webhookRequest({ dataId: '123', secret: 'another-secret-0000000' }))).status, 401);
    assert.equal((await send(svc, webhookRequest({ dataId: '123', liveMode: false }))).status, 400);
    assert.equal((await send(svc, webhookRequest({ dataId: '123', sellerId: '999999' }))).status, 400);
    assert.equal((await send(svc, webhookRequest({ dataId: '123', type: 'merchant_order' }))).status, 400);
    assert.equal(db.applied.length, 0);
  });
});

// ============================================================================ Part E — lab
describe('lifecycle on the lab database (production RPCs, production login)', async () => {
  const lab = await import('./lab/pg-lab.mjs');
  const fx = await import('./lab/fixtures.mjs');
  let db;
  // One emulator for the whole run (its payment ids are a per-instance sequence, unique like Mercado Pago's) and a
  // fresh lab database (ids of an earlier run would be real payment conflicts for the database).
  const mp = emulator();
  before(async () => { await lab.up({ fresh: true }); db = labProductionDb(); fx.setScope('open'); });
  after(async () => { fx.setScope('off', 'Laboratorio cerrado al terminar'); await db?.end(); });

  /** A real production purchase (client wrapper as the owner) with its Preference created through the handler. */
  async function preparedPurchase(svc, mp, label) {
    const w = fx.world(label);
    const p = fx.checkout(w.owner, w);
    const r = await send(svc, internalRequest(PREFERENCE_PATH, { purchase_id: p.id }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return { ...w, id: p.id, preferenceId: r.body.preferenceId, mp };
  }
  const iso = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString();

  test('checkout → Preference → approved payment → signed webhook → Premium for that season only', async () => {
    const svc = service({ db, mp });
    const p = await preparedPurchase(svc, mp, 'e2e-approved');
    const other = fx.season(p.owner, p.org, 'e2e-other');
    assert.equal(fx.purchaseRow(p.id).status, 'preference_created');
    const paymentId = mp.pay(p.preferenceId, { status: 'approved', statusDetail: 'accredited', at: iso(-5) });
    const r = await send(svc, webhookRequest({ dataId: paymentId }));
    assert.deepEqual([r.status, r.body.outcome], [200, 'approved']);
    assert.equal(fx.planOf(p.org, p.season), 'PREMIUM');
    assert.equal(fx.planOf(p.org, other), 'FREE');
    // The same delivery again, and a retry minutes later: one grant, one approved event.
    assert.equal((await send(svc, webhookRequest({ dataId: paymentId }))).body.outcome, 'provider_snapshot_duplicate');
    assert.deepEqual(fx.grantEvents(p.id), ['granted']);
  });

  test('return before the webhook: the buyer\'s refresh reconciles from Mercado Pago (throttled)', async () => {
    const svc = service({ db, mp });
    const p = await preparedPurchase(svc, mp, 'e2e-return');
    mp.pay(p.preferenceId, { status: 'approved', statusDetail: 'accredited', at: iso(-5) });
    const r = await send(svc, internalRequest(RECONCILE_PATH, { purchase_id: p.id }));
    assert.deepEqual([r.status, r.body.outcome, r.body.status], [200, 'verified', 'approved']);
    assert.equal(fx.planOf(p.org, p.season), 'PREMIUM');
    const searches = mp.calls.filter((c) => c.startsWith('GET /v1/payments/search')).length;
    const again = await send(svc, internalRequest(RECONCILE_PATH, { purchase_id: p.id }));
    assert.equal(again.body.outcome, 'recently_checked');
    assert.equal(mp.calls.filter((c) => c.startsWith('GET /v1/payments/search')).length, searches, 'no provider call inside the throttle window');
    // The late webhook afterwards changes nothing.
    const paymentId = mp.calls.find((c) => /^GET \/v1\/payments\/\d+$/.test(c)).split('/').pop();
    assert.equal((await send(svc, webhookRequest({ dataId: paymentId }))).body.outcome, 'provider_snapshot_duplicate');
  });

  test('no payment yet: refresh answers without changing anything', async () => {
    const svc = service({ db, mp });
    const p = await preparedPurchase(svc, mp, 'e2e-nopay');
    const r = await send(svc, internalRequest(RECONCILE_PATH, { purchase_id: p.id }));
    assert.deepEqual([r.status, r.body.outcome, r.body.status], [200, 'no_payment', 'preference_created']);
  });

  test('pending (cash ticket) then approved; an old pending webhook after approval never degrades', async () => {
    const svc = service({ db, mp });
    const p = await preparedPurchase(svc, mp, 'e2e-pending');
    const paymentId = mp.pay(p.preferenceId, { status: 'pending', statusDetail: 'pending_waiting_payment', at: iso(-60) });
    assert.equal((await send(svc, webhookRequest({ dataId: paymentId }))).body.outcome, 'pending');
    assert.equal(fx.purchaseRow(p.id).status, 'pending');
    mp.update(paymentId, { status: 'approved', statusDetail: 'accredited', at: iso(-10) });
    assert.equal((await send(svc, webhookRequest({ dataId: paymentId }))).body.outcome, 'approved');
    mp.serve(paymentId, 0); // Mercado Pago serving the older snapshot (out-of-order delivery)
    assert.equal((await send(svc, webhookRequest({ dataId: paymentId }))).body.outcome, 'stale_ignored');
    assert.equal(fx.purchaseRow(p.id).status, 'approved');
    assert.equal(fx.planOf(p.org, p.season), 'PREMIUM');
  });

  test('rejected card keeps the purchase open; another card approves it', async () => {
    const svc = service({ db, mp });
    const p = await preparedPurchase(svc, mp, 'e2e-rejected');
    const first = mp.pay(p.preferenceId, { status: 'rejected', statusDetail: 'cc_rejected_insufficient_amount', at: iso(-30) });
    assert.equal((await send(svc, webhookRequest({ dataId: first }))).body.outcome, 'attempt_rejected');
    assert.equal(fx.purchaseRow(p.id).status, 'preference_created');
    assert.equal(fx.planOf(p.org, p.season), 'FREE');
    const second = mp.pay(p.preferenceId, { status: 'approved', statusDetail: 'accredited', at: iso(-5) });
    assert.equal((await send(svc, webhookRequest({ dataId: second }))).body.outcome, 'approved');
  });

  test('forged or foreign payments never grant: amount, currency, metadata, seller, Preference, live_mode', async () => {
    const svc = service({ db, mp });
    const decoy = await preparedPurchase(svc, mp, 'e2e-decoy');
    for (const [label, options] of Object.entries({
      amount: { amount: 399 },
      currency: { currency: 'USD' },
      metadata: { metadataPurchase: decoy.id },
      seller: { collector: '1357924680' },
      preference: { orderPreference: decoy.preferenceId },
      live_mode: { liveMode: false },
      'not in the order': { inOrder: false },
      'another application': { paymentApplication: '9999999999999999' },
    })) {
      // A fresh purchase per case: the emulator opens one merchant order per Preference on its first payment.
      const p = await preparedPurchase(svc, mp, `e2e-forged-${label.replace(/\s+/g, '-')}`);
      const paymentId = mp.pay(p.preferenceId, { status: 'approved', statusDetail: 'accredited', at: iso(-5), ...options });
      const r = await send(svc, webhookRequest({ dataId: paymentId }));
      assert.equal(r.status, 422, `${label}: ${JSON.stringify(r.body)}`);
      assert.equal(fx.planOf(p.org, p.season), 'FREE', label);
      assert.equal(fx.purchaseRow(p.id).status, 'preference_created', label);
    }
    // A payment whose external_reference names another season's purchase is bound to that purchase, never to this one.
    const p = await preparedPurchase(svc, mp, 'e2e-forged-cross');
    const crossSeason = mp.pay(p.preferenceId, { status: 'approved', at: iso(-5), externalReference: `arma2:season:purchase:${decoy.id}` });
    assert.equal((await send(svc, webhookRequest({ dataId: crossSeason }))).status, 422);
    assert.equal(fx.planOf(decoy.org, decoy.season), 'FREE');
    assert.equal(fx.planOf(p.org, p.season), 'FREE');
  });

  test('a payment of the same seller that is not a Torneos purchase is acknowledged and ignored', async () => {
    const svc = service({ db, mp });
    const p = await preparedPurchase(svc, mp, 'e2e-foreign');
    const paymentId = mp.pay(p.preferenceId, { status: 'approved', at: iso(-5), externalReference: 'shop-order-77' });
    const r = await send(svc, webhookRequest({ dataId: paymentId }));
    assert.deepEqual([r.status, r.body.outcome], [200, 'ignored_foreign_payment']);
  });

  test('refund from the Mercado Pago panel → signed webhook → Premium revoked, nothing deleted', async () => {
    const svc = service({ db, mp });
    const p = await preparedPurchase(svc, mp, 'e2e-refund');
    const paymentId = mp.pay(p.preferenceId, { status: 'approved', statusDetail: 'accredited', at: iso(-120) });
    await send(svc, webhookRequest({ dataId: paymentId }));
    mp.panelRefund(paymentId, { at: iso(-60) });
    const r = await send(svc, webhookRequest({ dataId: paymentId }));
    assert.deepEqual([r.status, r.body.outcome], [200, 'reversal_applied']);
    assert.equal(fx.purchaseRow(p.id).status, 'refunded');
    assert.equal(fx.planOf(p.org, p.season), 'FREE');
    assert.deepEqual(fx.grantEvents(p.id), ['granted', 'revoked']);
    assert.equal(Number(fx.admin(`select count(*) from public.tournament_season_plan_grants where origin_purchase_id = '${p.id}'`)), 1, 'the grant row is kept (history)');
  });

  test('chargeback notification (topic_chargebacks_wh): dispute suspends, the payment state decides', async () => {
    const svc = service({ db, mp });
    const p = await preparedPurchase(svc, mp, 'e2e-chargeback');
    const paymentId = mp.pay(p.preferenceId, { status: 'approved', statusDetail: 'accredited', at: iso(-300) });
    await send(svc, webhookRequest({ dataId: paymentId }));
    mp.update(paymentId, { status: 'charged_back', statusDetail: 'in_process', at: iso(-200) });
    const chargebackId = mp.chargeback(paymentId, { liveMode: true });
    const r = await send(svc, webhookRequest({ dataId: chargebackId, type: 'topic_chargebacks_wh' }));
    assert.deepEqual([r.status, r.body.outcome], [200, 'reversal_applied']);
    assert.equal(fx.planOf(p.org, p.season), 'FREE');
    mp.update(paymentId, { status: 'charged_back', statusDetail: 'reimbursed', at: iso(-100) });
    assert.equal((await send(svc, webhookRequest({ dataId: chargebackId, type: 'topic_chargebacks_wh' }))).body.outcome, 'reversal_applied');
    assert.equal(fx.planOf(p.org, p.season), 'PREMIUM');
    const sandboxChargeback = mp.chargeback(paymentId, { liveMode: false });
    assert.equal((await send(svc, webhookRequest({ dataId: sandboxChargeback, type: 'topic_chargebacks_wh' }))).status, 422);
  });

  test('the cron reconciles a purchase whose webhook never arrived, and flags a late approval of a closed one', async () => {
    const svc = service({ db, mp });
    const lost = await preparedPurchase(svc, mp, 'e2e-cron');
    mp.pay(lost.preferenceId, { status: 'approved', statusDetail: 'accredited', at: iso(-600) });
    fx.age(lost.id, { createdMinutes: 20, updatedMinutes: 20 });
    const closed = await preparedPurchase(svc, mp, 'e2e-cron-closed');
    fx.age(closed.id, { createdMinutes: 90, updatedMinutes: 90, expiresMinutes: 30 });
    fx.checkout(closed.owner, closed); // the stale sweep expires it
    assert.equal(fx.purchaseRow(closed.id).status, 'expired');
    mp.pay(closed.preferenceId, { status: 'approved', statusDetail: 'accredited', at: iso(-30) });
    let summary;
    for (let i = 0; i < 6; i += 1) {
      summary = await svc.reconcileDue();
      if (fx.purchaseRow(lost.id).status === 'approved' && fx.eventTypes(closed.id).includes('payment.approved_after_close')) break;
    }
    assert.equal(fx.purchaseRow(lost.id).status, 'approved');
    assert.equal(fx.planOf(lost.org, lost.season), 'PREMIUM');
    assert.ok(fx.eventTypes(closed.id).includes('payment.approved_after_close'), 'late approval recorded for a manual refund');
    assert.equal(fx.planOf(closed.org, closed.season), 'FREE');
    assert.equal(summary.event, 'reconcile_summary');
  });

  test('double tap on the gateway path: one purchase, one Preference', async () => {
    const svc = service({ db, mp });
    const w = fx.world('e2e-double');
    const key = randomUUID();
    const [a, b] = [fx.checkout(w.owner, w, key), fx.checkout(w.owner, w, key)];
    assert.equal(a.id, b.id);
    const [r1, r2] = await Promise.all([send(svc, internalRequest(PREFERENCE_PATH, { purchase_id: a.id })), send(svc, internalRequest(PREFERENCE_PATH, { purchase_id: a.id }))]);
    const ok = [r1, r2].filter((r) => r.status === 200);
    assert.ok(ok.length >= 1);
    assert.equal(new Set(ok.map((r) => r.body.preferenceId)).size, 1);
    const ofPurchase = [...mp.state.preferences.values()].filter((p) => p.idempotencyKey === a.id);
    assert.equal(ofPurchase.length, 1, 'Mercado Pago idempotency key = purchase id: one Preference per purchase');
    assert.equal(fx.purchaseRow(a.id).provider_preference_id, ofPurchase[0].answer.id);
  });
});
