import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMercadoPagoPreferenceBody,
  createMercadoPagoPaymentProvider,
  fetchMercadoPagoChargeback,
  getMercadoPagoTestConfig,
  normalizeMercadoPagoPaymentStatus,
  paymentIdFromMercadoPagoChargeback,
  verifyMercadoPagoPaymentBinding,
  verifyMercadoPagoWebhookSignature,
} from '../../supabase/functions/_shared/mercadoPagoPaymentProvider.ts';

const PURCHASE = Object.freeze({
  id: '50000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000001',
  seasonId: '20000000-0000-4000-8000-000000000001',
  tournamentId: null,
  productCode: 'torneos_premium',
  provider: 'MERCADO_PAGO',
  providerEnvironment: 'test',
  providerPreferenceId: null,
  externalReference: 'arma2:season:purchase:50000000-0000-4000-8000-000000000001',
  status: 'created',
  amount: 39900,
  currency: 'ARS',
  createdAt: '2026-08-27T00:00:00.000Z',
  preferenceExpiresAt: '2026-08-27T00:30:00.000Z',
});
const CONTEXT = Object.freeze({
  appBaseUrl: 'https://preview.arma2.example',
  notificationUrl: 'https://project.supabase.co/functions/v1/tournament-mercadopago-webhook',
});
const CONFIG = Object.freeze({
  accessToken: 'TEST_TOKEN_FIXTURE_ONLY',
  webhookSecret: 'TEST_WEBHOOK_SECRET_FIXTURE_ONLY',
  sellerId: '123456789',
});

test('preference uses only the server purchase snapshot and canonical return URLs', () => {
  const body = buildMercadoPagoPreferenceBody(PURCHASE, CONTEXT);
  assert.deepEqual(body.items, [{
    id: 'torneos_premium',
    title: 'Arma2 Torneos Premium',
    quantity: 1,
    currency_id: 'ARS',
    unit_price: 39900,
  }]);
  assert.equal(body.external_reference, PURCHASE.externalReference);
  assert.equal(body.back_urls.success, `${CONTEXT.appBaseUrl}/torneos/organizacion/${PURCHASE.organizationId}/temporada/${PURCHASE.seasonId}/plan/compra/${PURCHASE.id}/exito`);
  assert.equal(body.back_urls.pending.endsWith(`/${PURCHASE.id}/pendiente`), true);
  assert.equal(body.back_urls.failure.endsWith(`/${PURCHASE.id}/fallo`), true);
  assert.deepEqual(body.metadata, { purchase_id: PURCHASE.id });
  assert.equal('amount' in body, false, 'there is no browser amount input');
});

test('preference creation is mocked, idempotent, TEST-seller bound, and never contacts the network', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      id: '123456789-test-preference',
      collector_id: 123456789,
      init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=test',
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const provider = createMercadoPagoPaymentProvider({ config: CONFIG, fetcher });
  const preference = await provider.createPreference(PURCHASE, CONTEXT);
  assert.equal(preference.provider, 'MERCADO_PAGO');
  assert.equal(preference.preferenceId, '123456789-test-preference');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.mercadopago.com/checkout/preferences');
  assert.equal(calls[0].init.headers['X-Idempotency-Key'], PURCHASE.id);
  assert.equal(calls[0].body.items[0].unit_price, PURCHASE.amount);
});

test('an existing preference is retrieved instead of creating another one', async () => {
  const calls = [];
  const existing = { ...PURCHASE, providerPreferenceId: '123456789-existing' };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      id: existing.providerPreferenceId,
      collector_id: CONFIG.sellerId,
      init_point: 'https://www.mercadopago.com/mla/checkout/start?pref_id=existing',
    }), { status: 200 });
  };
  await createMercadoPagoPaymentProvider({ config: CONFIG, fetcher })
    .createPreference(existing, CONTEXT);
  assert.equal(calls[0].init.method, 'GET');
  assert.match(calls[0].url, /checkout\/preferences\/123456789-existing$/);
});

test('configuration and public URLs fail closed', () => {
  const environment = new Map([
    ['MERCADO_PAGO_ENVIRONMENT', 'production'],
    ['MERCADO_PAGO_TEST_ACCESS_TOKEN', CONFIG.accessToken],
    ['MERCADO_PAGO_TEST_WEBHOOK_SECRET', CONFIG.webhookSecret],
    ['MERCADO_PAGO_TEST_SELLER_ID', CONFIG.sellerId],
  ]);
  assert.throws(() => getMercadoPagoTestConfig(environment), /test_environment_required/);
  assert.throws(() => buildMercadoPagoPreferenceBody(PURCHASE, {
    ...CONTEXT, appBaseUrl: 'http://localhost:3000',
  }), /public_https/);
});

test('provider API failures remain retryable and do not fall back to FAKE', async () => {
  const provider = createMercadoPagoPaymentProvider({
    config: CONFIG,
    fetcher: async () => new Response('{}', { status: 503 }),
  });
  await assert.rejects(() => provider.createPreference(PURCHASE, CONTEXT), /api_503/);
});

async function signatureFor({ dataId, requestId, timestamp, secret }) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(manifest),
  ));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('x-signature validates the official manifest and rejects tampering', async () => {
  const timestamp = 1_800_000_000;
  const requestId = 'request-test-1';
  const dataId = '987654321';
  const digest = await signatureFor({
    dataId, requestId, timestamp, secret: CONFIG.webhookSecret,
  });
  const valid = await verifyMercadoPagoWebhookSignature({
    xSignature: `ts=${timestamp},v1=${digest}`,
    xRequestId: requestId,
    dataId,
    secret: CONFIG.webhookSecret,
  });
  assert.equal(valid, true);
  assert.equal(await verifyMercadoPagoWebhookSignature({
    xSignature: `ts=${timestamp},v1=${digest}`,
    xRequestId: requestId,
    dataId: '987654322',
    secret: CONFIG.webhookSecret,
  }), false);
  assert.equal(await verifyMercadoPagoWebhookSignature({
    xSignature: `ts=invalid,v1=${digest}`,
    xRequestId: requestId,
    dataId,
    secret: CONFIG.webhookSecret,
  }), false);
});

test('chargeback notifications are re-queried and bound to one TEST payment', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({
      id: '233000061680860000',
      payments: [987654321],
      currency: 'ARS',
      amount: 39900,
      coverage_applied: null,
      live_mode: false,
    }), { status: 200 });
  };
  const chargeback = await fetchMercadoPagoChargeback(
    '233000061680860000', CONFIG, fetcher,
  );
  assert.equal(calls[0], 'https://api.mercadopago.com/v1/chargebacks/233000061680860000');
  assert.equal(paymentIdFromMercadoPagoChargeback(
    chargeback, '233000061680860000',
  ), '987654321');
  assert.throws(() => paymentIdFromMercadoPagoChargeback(
    { ...chargeback, live_mode: true }, '233000061680860000',
  ), /binding_mismatch/);
  assert.throws(() => paymentIdFromMercadoPagoChargeback(
    { ...chargeback, payments: [987654321, 987654322] }, '233000061680860000',
  ), /binding_mismatch/);
});

test('Mercado Pago payment states map to the certified commercial states', () => {
  const cases = [
    ['approved', null, 'status', 'approved'],
    ['pending', null, 'status', 'pending'],
    ['in_process', null, 'status', 'pending'],
    ['authorized', null, 'status', 'pending'],
    ['rejected', 'cc_rejected', 'status', 'rejected'],
    ['cancelled', 'expired', 'status', 'expired'],
    ['refunded', 'refunded', 'reversal', 'refund'],
    ['charged_back', 'in_process', 'reversal', 'chargeback_disputed'],
    ['charged_back', 'reimbursed', 'reversal', 'chargeback_restored'],
    ['charged_back', 'settled', 'reversal', 'chargeback_buyer_won'],
  ];
  for (const [status, detail, kind, target] of cases) {
    const normalized = normalizeMercadoPagoPaymentStatus({ status, status_detail: detail });
    assert.equal(normalized.kind, kind);
    assert.equal(normalized.status || normalized.action, target);
  }
  assert.equal(normalizeMercadoPagoPaymentStatus({ status: 'unknown_future_state' }), null);
});

function verifiedProviderObjects(overrides = {}) {
  const payment = {
    id: 987654321,
    status: 'approved',
    external_reference: PURCHASE.externalReference,
    currency_id: 'ARS',
    transaction_amount: 39900,
    collector_id: CONFIG.sellerId,
    metadata: { purchase_id: PURCHASE.id },
    order: { id: 456789123, type: 'mercadopago' },
    live_mode: false,
    ...(overrides.payment || {}),
  };
  const order = {
    id: 456789123,
    preference_id: '123456789-test-preference',
    external_reference: PURCHASE.externalReference,
    collector: { id: CONFIG.sellerId },
    payments: [{ id: 987654321 }],
    ...(overrides.order || {}),
  };
  return { payment, order };
}

test('verified payment requires amount, currency, reference, preference, seller and TEST mode', () => {
  const purchase = { ...PURCHASE, providerPreferenceId: '123456789-test-preference' };
  const valid = verifiedProviderObjects();
  assert.doesNotThrow(() => verifyMercadoPagoPaymentBinding(
    valid.payment, valid.order, purchase, CONFIG,
  ));
  for (const mismatch of [
    { payment: { transaction_amount: 1 } },
    { payment: { currency_id: 'USD' } },
    { payment: { external_reference: 'wrong' } },
    { payment: { metadata: { purchase_id: 'wrong' } } },
    { payment: { collector_id: '999' } },
    { payment: { live_mode: true } },
    { order: { preference_id: 'wrong' } },
    { order: { payments: [] } },
  ]) {
    const objects = verifiedProviderObjects(mismatch);
    assert.throws(() => verifyMercadoPagoPaymentBinding(
      objects.payment, objects.order, purchase, CONFIG,
    ), /binding_mismatch/);
  }
});
