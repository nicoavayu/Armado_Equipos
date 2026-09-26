// PAYMENTS TEST (2026-09-26) — the hosted TEST deployment of torneos-payments (remote-test.ts). Offline: no lab, no
// network; the real config.ts / handler.ts with in-process fakes for Mercado Pago and the database.
//
//   R1  a hosted database requires TORNEOS_PAYMENTS_DEPLOYMENT=remote-test; offline hosts (lab, loopback, .invalid) don't
//   R2  remote-test = exactly the Arma2 Torneos pooler login, a CA, canonical public hosts, no lab origin
//   R3  remote-test refuses Core / Supabase / gateway / commerce-gateway material, public or private
//   R4  LIVE guard: nothing reaches Mercado Pago or the DB until /users/me attests the configured TEST seller (test_user,
//       MLA); a non-TEST answer is final for the isolate; transient answers are retried at most every 10 s
//   R5  Host: remote-test answers only on the declared host
//   R6  the lab / unit contract is unchanged (no attestation, no Host check)
//   R7  SANDBOX (2026-09-26 decision): Mercado Pago sandbox reports live_mode=true, so remote-test accepts a payment only
//       through remoteTestSandboxProblem (attested seller, exact collector / application / reference / metadata /
//       preference / order, pinned QA organization, ARS 39.900, valid signature, provider lookup); everything else and
//       every non-remote-test deployment keeps the certified live_mode=false guard
//   R8  QA scope pin: TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID is remote-test only; unset, remote-test serves no purchase
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { UNIT_ENV } from './payments-unit-env.mjs';

const { loadPaymentsConfig, ConfigError } = await import('../../backend/torneos/supabase/functions/torneos-payments/config.ts');
const { createPaymentsService } = await import('../../backend/torneos/supabase/functions/torneos-payments/handler.ts');
const { TORNEOS_REF } = await import('../../backend/torneos/supabase/functions/torneos-payments/remote-test.ts');
const { DbError } = await import('../../backend/torneos/supabase/functions/torneos-payments/rpc.ts');

const HOST = 'torneos-payments-test.nicoavayu.deno.net';
const SELLER = '2987654321';
const SECRET_HEX = crypto.createHash('sha256').update('payments-remote-test-fixture').digest('hex');
const POOLER = `postgres://torneos_payments_test.${TORNEOS_REF}:pw-fixture@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
const REMOTE = Object.freeze({
  TORNEOS_PAYMENT_PROVIDER: 'MERCADO_PAGO', MERCADO_PAGO_ENVIRONMENT: 'test',
  MERCADO_PAGO_TEST_ACCESS_TOKEN: 'APP_USR-fixture-access-token-0000', MERCADO_PAGO_TEST_WEBHOOK_SECRET: 'fixture-webhook-secret-000000000000',
  MERCADO_PAGO_TEST_SELLER_ID: SELLER, APP_PUBLIC_URL: `https://${HOST}`,
  TORNEOS_PAYMENTS_NOTIFICATION_URL: `https://${HOST}/functions/v1/torneos-payments/webhooks/mercadopago/v1`,
  TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX, TORNEOS_PAYMENTS_DB_URL: POOLER,
  TORNEOS_PAYMENTS_DB_SSL_CA: Buffer.from('-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----\n').toString('base64'),
  TORNEOS_PAYMENTS_DEPLOYMENT: 'remote-test',
  TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000001',
});
const reject = (env, label) => {
  let caught = null; try { loadPaymentsConfig(env); } catch (e) { caught = e; }
  assert.ok(caught instanceof ConfigError, `${label}: must be refused (got ${caught ? caught.message : 'a configuration'})`);
  for (const v of Object.values(env)) if (typeof v === 'string' && v.length >= 16) assert.ok(!caught.message.includes(v), `${label}: the error names no value`);
  return caught.message;
};

test('R1 a hosted database requires remote-test; offline hosts keep the unit / lab contract', () => {
  const unit = loadPaymentsConfig({ ...UNIT_ENV });
  assert.equal(unit.deployment, null); assert.equal(unit.remoteHost, null);
  for (const host of ['127.0.0.1', 'localhost', 'torneos-db', 'db.fixture.invalid']) {
    assert.equal(loadPaymentsConfig({ ...UNIT_ENV, TORNEOS_PAYMENTS_DB_URL: `postgres://payments_login:pw@${host}:5432/postgres` }).deployment, null, host);
  }
  const hosted = { ...REMOTE }; delete hosted.TORNEOS_PAYMENTS_DEPLOYMENT;
  assert.match(reject(hosted, 'pooler without the marker'), /requires TORNEOS_PAYMENTS_DEPLOYMENT=remote-test/);
  for (const host of ['db.example.com', `db.${TORNEOS_REF}.supabase.co`, '10.0.0.5', 'aws-0-sa-east-1.pooler.supabase.com']) {
    reject({ ...UNIT_ENV, TORNEOS_PAYMENTS_DB_URL: `postgres://payments_login.${TORNEOS_REF}:pw@${host}:5432/postgres` }, `hosted ${host} without the marker`);
  }
  for (const d of ['remote', 'REMOTE-TEST', 'remote_test', 'live', 'prod', 'production', 'test', 'local', 'lab']) reject({ ...REMOTE, TORNEOS_PAYMENTS_DEPLOYMENT: d }, `deployment ${d}`);
});

test('R2 remote-test: exact Arma2 Torneos pooler login, CA, canonical hosts, never the lab origin', () => {
  const cfg = loadPaymentsConfig({ ...REMOTE });
  assert.equal(cfg.deployment, 'remote-test'); assert.equal(cfg.remoteHost, HOST);
  assert.equal(loadPaymentsConfig({ ...REMOTE, TORNEOS_PAYMENTS_DB_URL: POOLER.replace(':6543/', ':5432/') }).deployment, 'remote-test');
  const bad = {
    'Core Production ref': POOLER.replaceAll(TORNEOS_REF, 'rcyuuoaqfwcembdajcss'),
    'another project': POOLER.replaceAll(TORNEOS_REF, 'abcdefghijklmnopqrst'),
    'direct db host': `postgres://torneos_payments_test:pw@db.${TORNEOS_REF}.supabase.co:5432/postgres`,
    'another region': POOLER.replace('sa-east-1', 'us-east-1'),
    'look-alike pooler': POOLER.replace('pooler.supabase.com', 'pooler.supabase.com.evil.example'),
    'port 5433': POOLER.replace(':6543/', ':5433/'),
    'no port': POOLER.replace(':6543/', '/'),
    'another database': POOLER.replace('/postgres', '/template1'),
    'query options': `${POOLER}?options=-c%20role%3Dpostgres`,
    'login without the project': POOLER.replace(`.${TORNEOS_REF}`, ''),
    'gateway login': POOLER.replace('torneos_payments_test', 'torneos_edge_core_adapter'),
    'identity writer login': POOLER.replace('torneos_payments_test', 'torneos_edge_identity_writer'),
    'postgres login': POOLER.replace('torneos_payments_test', 'postgres'),
    'role login': POOLER.replace('torneos_payments_test', 'torneos_payment_service'),
  };
  for (const [label, url] of Object.entries(bad)) reject({ ...REMOTE, TORNEOS_PAYMENTS_DB_URL: url }, label);
  reject({ ...REMOTE, TORNEOS_PAYMENTS_DB_SSL_CA: '' }, 'no CA');
  reject({ ...REMOTE, TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: 'http://mp-stub:8080' }, 'lab origin');
  for (const [name, value] of [
    ['TORNEOS_PAYMENTS_NOTIFICATION_URL', `https://${HOST}:8443/functions/v1/torneos-payments/webhooks/mercadopago/v1`],
    ['TORNEOS_PAYMENTS_NOTIFICATION_URL', 'https://203.0.113.9/functions/v1/torneos-payments/webhooks/mercadopago/v1'],
    ['TORNEOS_PAYMENTS_NOTIFICATION_URL', 'https://torneos-prod.nicoavayu.deno.net/functions/v1/torneos-payments/webhooks/mercadopago/v1'],
    ['TORNEOS_PAYMENTS_NOTIFICATION_URL', `https://${HOST}/functions/v1/torneos-gateway/webhooks/mercadopago/v1`],
    ['APP_PUBLIC_URL', `https://${HOST}:8443`], ['APP_PUBLIC_URL', 'https://app.arma2.com.ar'], ['APP_PUBLIC_URL', 'http://example.com'],
    ['APP_PUBLIC_URL', 'https://rcyuuoaqfwcembdajcss.supabase.co'],
  ]) reject({ ...REMOTE, [name]: value }, `${name}=${value}`);
});

test('R3 remote-test refuses Core / Supabase / gateway / commerce-gateway material (public included) and any LIVE-looking MP variable', () => {
  for (const name of ['CORE_ANON_KEY', 'CORE_AUTH_URL', 'CORE_CONTRACT_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TORNEOS_COMMERCE_MODE', 'TORNEOS_COMMERCE_DEPLOYMENT',
    'TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST', 'TORNEOS_GATEWAY_PUBLIC_URL', 'TORNEOS_BRIDGE_KEYS', 'TORNEOS_CONTRACT_SERVICE_SECRET', 'TORNEOS_DB_SSL_CA',
    'TORNEOS_DB_CORE_ADAPTER_URL', 'TORNEOS_REST_URL', 'TORNEOS_ANON_KEY', 'TORNEOS_ALLOWED_ORIGIN', 'DATABASE_URL', 'PGHOST', 'PGPASSWORD']) {
    reject({ ...REMOTE, [name]: 'fixture-value' }, name);
  }
  for (const [name, value] of [['MERCADO_PAGO_ENVIRONMENT', 'live'], ['MERCADO_PAGO_ENVIRONMENT', 'production'], ['MERCADO_PAGO_ACCESS_TOKEN', 'x'],
    ['MERCADO_PAGO_LIVE_ACCESS_TOKEN', 'x'], ['MERCADO_PAGO_PROD_ACCESS_TOKEN', 'x'], ['TORNEOS_PAYMENT_PROVIDER', 'FAKE']]) reject({ ...REMOTE, [name]: value }, `${name}=${value}`);
  // Blank values and platform variables are tolerated.
  assert.equal(loadPaymentsConfig({ ...REMOTE, CORE_ANON_KEY: '   ', DENO_DEPLOYMENT_ID: 'abc', DENO_REGION: 'gcp-southamerica-east1', PORT: '8000', TZ: 'UTC' }).deployment, 'remote-test');
});

// ── runtime fakes ──
function mpFake({ me = { id: Number(SELLER), site_id: 'MLA', tags: ['normal', 'test_user'] }, meStatus = 200, calls }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(`${init.method ?? 'GET'} ${url.pathname}`);
    assert.equal(url.origin, 'https://api.mercadopago.com');
    if (url.pathname === '/users/me') {
      if (meStatus === 'throw') throw new TypeError('network down');
      return new Response(JSON.stringify(me), { status: meStatus });
    }
    if (url.pathname === '/checkout/preferences') {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: `${SELLER}-pref-fixture`, collector_id: Number(SELLER), init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x', _body: body }), { status: 201 });
    }
    return new Response('{}', { status: 404 });
  };
}
const PURCHASE = '2b0c8e5e-1111-4222-8333-944445555666';
function dbFake(calls) {
  return () => ({ async call(name, args) {
    calls.push(name);
    if (name === 'get_provider_tournament_purchase') return { id: PURCHASE, organizationId: '00000000-0000-4000-8000-000000000001', seasonId: '00000000-0000-4000-8000-000000000002', tournamentId: null,
      productCode: 'torneos_premium', provider: 'MERCADO_PAGO', providerEnvironment: 'test', providerPreferenceId: null, externalReference: `arma2:season:purchase:${PURCHASE}`,
      status: 'created', amount: 39900, currency: 'ARS', createdAt: new Date().toISOString(), preferenceExpiresAt: null };
    if (name === 'record_tournament_purchase_preference') return { providerPreferenceId: args[3], preferenceExpiresAt: args[4] };
    throw new Error(`unexpected ${name}`);
  } });
}
async function internalRequest(service, host = HOST, secretHex = SECRET_HEX) {
  const body = JSON.stringify({ purchase_id: PURCHASE });
  const time = String(Math.floor(Date.now() / 1000)); const nonce = crypto.randomUUID();
  const sig = crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`/internal/v1/season-checkout-preference\n${time}\n${nonce}\n${body}`).digest('hex');
  const res = await service(new Request(`https://${host}/functions/v1/torneos-payments/internal/v1/season-checkout-preference`, { method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-time': time, 'x-nonce': nonce, 'x-signature': sig } }));
  return { status: res.status, body: await res.json() };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test('R4 LIVE guard: a TEST seller is attested once, then the Preference is created (ARS 39.900, one item)', async () => {
  const mp = []; const db = []; const logs = [];
  const service = createPaymentsService({ env: { ...REMOTE }, connectDb: dbFake(db), fetcher: mpFake({ calls: mp }), log: (e) => logs.push(e) });
  const r = await internalRequest(service);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.preferenceId, `${SELLER}-pref-fixture`);
  const r2 = await internalRequest(service);
  assert.equal(r2.status, 200, 'the fake DB keeps the purchase "created"; what matters here is that no second attestation happens');
  assert.deepEqual(mp.filter((c) => c === 'GET /users/me'), ['GET /users/me'], 'exactly one attestation per isolate');
  assert.ok(logs.every((l) => !JSON.stringify(l).includes(REMOTE.MERCADO_PAGO_TEST_ACCESS_TOKEN)));
});

for (const [label, fake] of [
  ['a real (non-test) seller', { me: { id: Number(SELLER), site_id: 'MLA', tags: ['normal'] } }],
  ['another test seller', { me: { id: 1111, site_id: 'MLA', tags: ['test_user'] } }],
  ['a test seller of another site', { me: { id: Number(SELLER), site_id: 'MLB', tags: ['test_user'] } }],
  ['a rejected token (401)', { meStatus: 401 }],
  ['a forbidden token (403)', { meStatus: 403 }],
  ['a malformed answer', { me: ['test_user'] }],
]) {
  test(`R4 LIVE guard: ${label} → 503 provider_not_test on both routes, nothing reaches the provider or the database, final`, async () => {
    const mp = []; const db = []; const logs = [];
    const service = createPaymentsService({ env: { ...REMOTE }, connectDb: dbFake(db), fetcher: mpFake({ ...fake, calls: mp }), log: (e) => logs.push(e) });
    const r = await internalRequest(service);
    assert.equal(r.status, 503); assert.deepEqual(r.body, { error: 'service_unavailable' });
    const w = await service(new Request(`https://${HOST}/functions/v1/torneos-payments/webhooks/mercadopago/v1?data.id=123&type=payment`, { method: 'POST', body: '{}' }));
    assert.equal(w.status, 503);
    assert.deepEqual(mp, ['GET /users/me'], 'the attestation is the only provider call, and it is not repeated');
    assert.deepEqual(db, []);
    assert.ok(logs.some((l) => l.event === 'provider_not_test'));
    assert.ok(logs.some((l) => l.code === 'provider_not_test'));
  });
}

test('R4 transient attestation failures are retried at most every 10 s and never let a request through', async () => {
  const mp = []; const db = []; let t = Date.now();
  const service = createPaymentsService({ env: { ...REMOTE }, connectDb: dbFake(db), fetcher: mpFake({ meStatus: 500, calls: mp }), log: () => {}, now: () => t });
  await settle();
  for (let i = 0; i < 5; i += 1) assert.equal((await internalRequest(service)).body.error, 'provider_unavailable');
  assert.equal(mp.length, 1, 'no retry inside the window');
  t += 10_001;
  assert.equal((await internalRequest(service)).body.error, 'provider_unavailable');
  assert.equal(mp.length, 2);
  assert.deepEqual(db, []);
  const net = []; const s2 = createPaymentsService({ env: { ...REMOTE }, connectDb: dbFake([]), fetcher: mpFake({ meStatus: 'throw', calls: net }), log: () => {} });
  assert.equal((await internalRequest(s2)).body.error, 'provider_unavailable');
});

test('R5 Host: remote-test answers only on the declared host', async () => {
  const mp = []; const db = [];
  const service = createPaymentsService({ env: { ...REMOTE }, connectDb: dbFake(db), fetcher: mpFake({ calls: mp }), log: () => {} });
  for (const host of ['torneos-gateway.nicoavayu.deno.net', 'torneos-payments-test-abc123.nicoavayu.deno.net', `${HOST}.evil.example`, 'evil.example']) {
    const r = await internalRequest(service, host);
    assert.equal(r.status, 403, host); assert.deepEqual(r.body, { error: 'forbidden' });
  }
  assert.deepEqual(db, []);
  assert.equal((await internalRequest(service)).status, 200);
});

test('R6 unit / lab contract unchanged: no attestation, no Host check', async () => {
  const mp = []; const db = [];
  const env = { ...UNIT_ENV, TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX, MERCADO_PAGO_TEST_SELLER_ID: SELLER };
  const service = createPaymentsService({ env, connectDb: dbFake(db), fetcher: mpFake({ calls: mp }), log: () => {} });
  const r = await internalRequest(service, 'anything.unit.invalid');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!mp.includes('GET /users/me'));
});

// ── R7 / R8: the sandbox policy, end to end through the real handler ──
const QA_ORG = REMOTE.TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID;
const SEASON = '00000000-0000-4000-8000-000000000002';
const PREF = `${SELLER}-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d`;
const APP_ID = '4412345678901234';
const PAY_ID = '180983221818';
const ORDER_ID = '44753974345';
const REF = `arma2:season:purchase:${PURCHASE}`;
function sandboxWorld(over = {}) {
  const w = {
    payment: { id: Number(PAY_ID), status: 'approved', status_detail: 'accredited', external_reference: REF, currency_id: 'ARS', transaction_amount: 39900, collector_id: Number(SELLER),
      metadata: { purchase_id: PURCHASE }, order: { id: Number(ORDER_ID), type: 'mercadopago' }, live_mode: true, date_last_updated: '2026-09-26T09:31:17.000-04:00' },
    order: { id: Number(ORDER_ID), preference_id: PREF, external_reference: REF, collector: { id: Number(SELLER) }, payments: [{ id: Number(PAY_ID) }], application_id: APP_ID },
    preference: { id: PREF, collector_id: Number(SELLER), client_id: APP_ID, external_reference: REF, metadata: { purchase_id: PURCHASE },
      items: [{ id: 'torneos_premium', title: 'Arma2 Torneos Premium', quantity: 1, currency_id: 'ARS', unit_price: 39900 }] },
    purchase: { id: PURCHASE, organizationId: QA_ORG, seasonId: SEASON, tournamentId: null, productCode: 'torneos_premium', provider: 'MERCADO_PAGO', providerEnvironment: 'test',
      providerPreferenceId: PREF, externalReference: REF, status: 'preference_created', amount: 39900, currency: 'ARS', createdAt: '2026-09-26T13:15:20.886889+00:00',
      preferenceExpiresAt: '2026-09-26T13:49:00.000Z' },
    me: { id: Number(SELLER), site_id: 'MLA', tags: ['normal', 'test_user'] },
    chargeback: null,
  };
  for (const [k, v] of Object.entries(over)) w[k] = typeof v === 'function' ? v(w[k]) : v;
  return w;
}
function sandboxService(w, env = REMOTE) {
  const mp = []; const db = []; const logs = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input)); mp.push(`${init.method ?? 'GET'} ${url.pathname}`);
    assert.equal(url.origin, 'https://api.mercadopago.com');
    const json = (b) => new Response(JSON.stringify(b), { status: b ? 200 : 404 });
    if (url.pathname === '/users/me') return json(w.me);
    if (url.pathname === `/v1/payments/${w.payment?.id}`) return json(w.payment);
    if (url.pathname === `/merchant_orders/${ORDER_ID}`) return json(w.order);
    if (url.pathname === `/checkout/preferences/${PREF}`) return json(w.preference);
    if (w.chargeback && url.pathname === `/v1/chargebacks/${w.chargeback.id}`) return json(w.chargeback);
    return new Response('{"message":"not found"}', { status: 404 });
  };
  const connectDb = () => ({ async call(name, args) {
    db.push(name);
    if (name === 'get_provider_tournament_purchase') if (args[0] !== REF) throw new DbError('P0002', 'TORNEOS_PURCHASE_NOT_FOUND');
      return { ...w.purchase };
    if (name === 'apply_verified_tournament_payment_status' || name === 'apply_verified_tournament_payment_reversal') return { outcome: 'applied' };
    throw new Error(`unexpected ${name}`);
  } });
  return { service: createPaymentsService({ env: { ...env }, connectDb, fetcher, log: (e) => logs.push(e) }), mp, db, logs };
}
async function sandboxNotify(svc, { dataId = PAY_ID, type = 'payment', body, secret = REMOTE.MERCADO_PAGO_TEST_WEBHOOK_SECRET, host = HOST, env = REMOTE } = {}) {
  const ts = String(Date.now()); const rid = crypto.randomUUID();
  const v1 = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${rid};ts:${ts};`).digest('hex');
  const payload = body ?? { id: 1, type, action: `${type}.updated`, api_version: 'v1', live_mode: true, user_id: Number(env.MERCADO_PAGO_TEST_SELLER_ID),
    data: type === 'topic_chargebacks_wh' ? { id: dataId, checkout: 'PRO' } : { id: dataId }, date_created: new Date().toISOString() };
  const res = await svc.service(new Request(`https://${host}/functions/v1/torneos-payments/webhooks/mercadopago/v1?data.id=${dataId}&type=${type}`,
    { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json', 'x-request-id': rid, 'x-signature': `ts=${ts},v1=${v1}` } }));
  return { status: res.status, body: await res.json(), code: svc.logs.filter((l) => l.route === 'webhook').at(-1)?.code };
}
const applied = (svc) => svc.db.filter((n) => n.startsWith('apply_verified_'));

test('R7 PASS: remote-test + live_mode=true + attested TEST seller + exact collector / application / QA reference / 39.900 ARS + valid signature → applied', async () => {
  const svc = sandboxService(sandboxWorld());
  const r = await sandboxNotify(svc);
  assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body.outcome, 'applied');
  assert.deepEqual(applied(svc), ['apply_verified_tournament_payment_status']);
  assert.deepEqual(svc.mp, ['GET /users/me', `GET /v1/payments/${PAY_ID}`, `GET /merchant_orders/${ORDER_ID}`, `GET /checkout/preferences/${PREF}`], 'provider lookup: payment, order and our own Preference');
  // live_mode false is judged by the same policy (it never relaxes anything), and the notification body is not authority
  const svc2 = sandboxService(sandboxWorld({ payment: (p) => ({ ...p, live_mode: false }) }));
  assert.equal((await sandboxNotify(svc2)).status, 200);
  // rejected / refunded payments go through the same policy (status and reversal RPCs)
  const svc3 = sandboxService(sandboxWorld({ payment: (p) => ({ ...p, status: 'rejected', status_detail: 'cc_rejected_other_reason' }) }));
  assert.equal((await sandboxNotify(svc3)).status, 200);
  const svc4 = sandboxService(sandboxWorld({ payment: (p) => ({ ...p, status: 'refunded', status_detail: 'refunded' }), purchase: (p) => ({ ...p, status: 'approved' }) }));
  assert.equal((await sandboxNotify(svc4)).status, 200); assert.deepEqual(applied(svc4), ['apply_verified_tournament_payment_reversal']);
  // an application id not exposed by payment / order is not required; one that is exposed must match
  const svc5 = sandboxService(sandboxWorld({ order: (o) => { const { application_id, ...rest } = o; return rest; } }));
  assert.equal((await sandboxNotify(svc5)).status, 200);
});

test('R7 PASS: remote-test dispute via topic_chargebacks_wh with live_mode=true → the chargeback names one payment, which passes the same policy', async () => {
  const svc = sandboxService(sandboxWorld({ chargeback: { id: 233000061680, payments: [Number(PAY_ID)], live_mode: true, currency: 'ARS', amount: 39900 },
    payment: (p) => ({ ...p, status: 'charged_back', status_detail: 'in_process' }), purchase: (p) => ({ ...p, status: 'approved' }) }));
  const r = await sandboxNotify(svc, { dataId: '233000061680', type: 'topic_chargebacks_wh' });
  assert.equal(r.status, 200, JSON.stringify(r)); assert.deepEqual(applied(svc), ['apply_verified_tournament_payment_reversal']);
  const two = sandboxService(sandboxWorld({ chargeback: { id: 233000061680, payments: [Number(PAY_ID), 1], live_mode: true } }));
  assert.equal((await sandboxNotify(two, { dataId: '233000061680', type: 'topic_chargebacks_wh' })).status, 422);
  const untyped = sandboxService(sandboxWorld({ chargeback: { id: 233000061680, payments: [Number(PAY_ID)], live_mode: 'true' } }));
  assert.equal((await sandboxNotify(untyped, { dataId: '233000061680', type: 'topic_chargebacks_wh' })).status, 422);
  assert.deepEqual([...applied(two), ...applied(untyped)], []);
});

const OTHER_PURCHASE = '3c1d9f6f-2222-4333-8444-a55556666777';
for (const [label, over, code] of [
  ['seller not test_user (/users/me without the tag) → 503 before any lookup', { me: { id: Number(SELLER), site_id: 'MLA', tags: ['normal'] } }, 'provider_not_test'],
  ['LIVE credentials: /users/me is another (real) seller → 503', { me: { id: 123456789, site_id: 'MLA', tags: ['normal'] } }, 'provider_not_test'],
  ['collector different (payment)', { payment: (p) => ({ ...p, collector_id: 1234567890 }) }, 'payment_verification_failed_collector'],
  ['collector different (merchant order)', { order: (o) => ({ ...o, collector: { id: 1234567890 } }) }, 'payment_verification_failed_collector'],
  ['collector different (our Preference)', { preference: (p) => ({ ...p, collector_id: 1234567890 }) }, 'payment_verification_failed_collector'],
  ['application_id different (merchant order)', { order: (o) => ({ ...o, application_id: '999999' }) }, 'payment_verification_failed_application'],
  ['application_id different (payment)', { payment: (p) => ({ ...p, application_id: 999999 }) }, 'payment_verification_failed_application'],
  ['application exposed but our Preference has no client_id', { preference: (p) => ({ ...p, client_id: null }) }, 'payment_verification_failed_application'],
  ['external_reference different (payment of another, unknown purchase) → 404 purchase_not_found', { payment: (p) => ({ ...p, external_reference: `arma2:season:purchase:${OTHER_PURCHASE}` }) }, 'purchase_not_found'],
  ['external_reference different (merchant order)', { order: (o) => ({ ...o, external_reference: `arma2:season:purchase:${OTHER_PURCHASE}` }) }, 'payment_verification_failed_reference'],
  ['external_reference different (our Preference)', { preference: (p) => ({ ...p, external_reference: `arma2:season:purchase:${OTHER_PURCHASE}` }) }, 'payment_verification_failed_reference'],
  ['metadata different (another purchase)', { payment: (p) => ({ ...p, metadata: { purchase_id: OTHER_PURCHASE } }) }, 'payment_verification_failed_metadata'],
  ['metadata with an extra key', { payment: (p) => ({ ...p, metadata: { purchase_id: PURCHASE, season_id: SEASON } }) }, 'payment_verification_failed_metadata'],
  ['metadata different on our Preference', { preference: (p) => ({ ...p, metadata: { purchase_id: OTHER_PURCHASE } }) }, 'payment_verification_failed_metadata'],
  ['amount different (payment 100)', { payment: (p) => ({ ...p, transaction_amount: 100 }) }, 'payment_verification_failed_amount'],
  ['amount different (payment "39900" string)', { payment: (p) => ({ ...p, transaction_amount: '39900' }) }, 'payment_verification_failed_amount'],
  ['amount different (DB offer 49.900)', { purchase: (p) => ({ ...p, amount: 49900 }) }, 'payment_verification_failed_product'],
  ['amount different (Preference item 1)', { preference: (p) => ({ ...p, items: [{ ...p.items[0], unit_price: 1 }] }) }, 'payment_verification_failed_preference_item'],
  ['currency different (payment USD)', { payment: (p) => ({ ...p, currency_id: 'USD' }) }, 'payment_verification_failed_currency'],
  ['currency different (Preference item BRL)', { preference: (p) => ({ ...p, items: [{ ...p.items[0], currency_id: 'BRL' }] }) }, 'payment_verification_failed_preference_item'],
  ['purchase outside the pinned QA organization (a real season)', { purchase: (p) => ({ ...p, organizationId: '11111111-1111-4111-8111-111111111111' }) }, 'payment_verification_failed_qa_scope'],
  ['purchase without a recorded preference', { purchase: (p) => ({ ...p, providerPreferenceId: null, status: 'created' }) }, 'payment_verification_failed'],
  ['purchase in an unexpected state (cancelled)', { purchase: (p) => ({ ...p, status: 'cancelled' }) }, 'payment_verification_failed_purchase_state'],
  ['provider lookup inconsistent: payment id ≠ notified id', { payment: (p) => ({ ...p, id: 1 }) }, 'payment_verification_failed'],
  ['provider lookup inconsistent: payment not in its merchant order', { order: (o) => ({ ...o, payments: [{ id: 1 }] }) }, 'payment_verification_failed_order'],
  ['provider lookup inconsistent: merchant order of another preference', { order: (o) => ({ ...o, preference_id: `${SELLER}-ffffffff-ffff-4fff-8fff-ffffffffffff` }) }, 'payment_verification_failed_preference'],
  ['provider lookup inconsistent: our Preference answers another id', { preference: (p) => ({ ...p, id: `${SELLER}-ffffffff-ffff-4fff-8fff-ffffffffffff` }) }, 'payment_verification_failed_preference'],
  ['provider lookup inconsistent: our Preference is gone (404)', { preference: null }, 'payment_verification_failed'],
  ['provider lookup inconsistent: payment live_mode not a boolean', { payment: (p) => ({ ...p, live_mode: 'true' }) }, 'payment_verification_failed_live_mode_shape'],
]) {
  test(`R7 FAIL: remote-test + ${label}; nothing applied`, async () => {
    const svc = sandboxService(sandboxWorld(over));
    const r = await sandboxNotify(svc);
    if (code === 'provider_not_test') { assert.equal(r.status, 503); assert.deepEqual(svc.mp, ['GET /users/me']); assert.deepEqual(svc.db, []); }
    else if (code === 'purchase_not_found') assert.equal(r.status, 404, JSON.stringify(r));
    else assert.equal(r.status, 422, JSON.stringify(r));
    assert.ok(r.code === code || r.code.startsWith(`${code}`), `${r.code} vs ${code}`);
    assert.deepEqual(applied(svc), []);
  });
}

test('R7 FAIL: remote-test + invalid webhook signature (wrong secret, unsigned) → 401 before any provider lookup', async () => {
  const svc = sandboxService(sandboxWorld());
  assert.equal((await sandboxNotify(svc, { secret: 'another-secret-000000000000000000' })).status, 401);
  const res = await svc.service(new Request(`https://${HOST}/functions/v1/torneos-payments/webhooks/mercadopago/v1?data.id=${PAY_ID}&type=payment`, { method: 'POST', body: '{}' }));
  assert.equal(res.status, 401);
  assert.deepEqual(svc.mp.filter((c) => c !== 'GET /users/me'), []); assert.deepEqual(svc.db, []);
});

test('R7 FAIL: remote-test notification body — live_mode not a boolean, another seller, unknown topic → 400; the body is never authority', async () => {
  const svc = sandboxService(sandboxWorld());
  const base = { id: 1, type: 'payment', live_mode: true, user_id: Number(SELLER), data: { id: PAY_ID } };
  for (const body of [{ ...base, live_mode: 'true' }, { ...base, live_mode: undefined }, { ...base, live_mode: 1 }, { ...base, user_id: 1234567 }, { ...base, type: 'merchant_order' }]) {
    assert.equal((await sandboxNotify(svc, { body })).status, 400, JSON.stringify(body));
  }
  // a body claiming live_mode=false changes nothing: the re-fetched provider resources still decide
  const lie = sandboxService(sandboxWorld({ payment: (p) => ({ ...p, collector_id: 1234567890 }) }));
  assert.equal((await sandboxNotify(lie, { body: { ...base, live_mode: false } })).status, 422);
  assert.deepEqual([...applied(svc), ...applied(lie)], []);
});

test('R7 FAIL: live_mode=true outside remote-test (unit / lab deployment) → the certified guard: body 400, provider payment 422', async () => {
  const env = { ...UNIT_ENV, MERCADO_PAGO_TEST_SELLER_ID: SELLER, TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX, MERCADO_PAGO_TEST_WEBHOOK_SECRET: REMOTE.MERCADO_PAGO_TEST_WEBHOOK_SECRET };
  const host = 'fn.unit.invalid';
  const svc = sandboxService(sandboxWorld(), env);
  assert.equal((await sandboxNotify(svc, { host, env })).status, 400, 'payload live_mode=true');
  const body = { id: 1, type: 'payment', live_mode: false, user_id: Number(SELLER), data: { id: PAY_ID } };
  const r = await sandboxNotify(svc, { host, env, body });
  assert.equal(r.status, 422, 'provider live_mode=true fails the byte-pinned provider binding'); assert.equal(r.code, 'payment_verification_failed');
  const ok = sandboxService(sandboxWorld({ payment: (p) => ({ ...p, live_mode: false }) }), env);
  assert.equal((await sandboxNotify(ok, { host, env, body })).status, 200, 'the certified lab path is otherwise unchanged');
  assert.ok(!ok.mp.includes(`GET /checkout/preferences/${PREF}`), 'lab keeps the certified lookups (no Preference re-read)');
  const cb = sandboxService(sandboxWorld({ chargeback: { id: 233000061680, payments: [Number(PAY_ID)], live_mode: true } }), env);
  assert.equal((await sandboxNotify(cb, { host, env, type: 'topic_chargebacks_wh', dataId: '233000061680', body: { ...body, type: 'topic_chargebacks_wh', data: { id: '233000061680', checkout: 'PRO' } } })).status, 422);
  assert.deepEqual([...applied(svc), ...applied(cb)], []);
});

test('R8 QA scope pin: remote-test only, lowercase uuid; unset → no purchase is served (preference 422, webhook 422)', async () => {
  reject({ ...UNIT_ENV, TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID: QA_ORG }, 'QA pin outside remote-test');
  for (const v of ['qa-payments-test-2489cc1f', 'AAAAAAAA-0000-4000-8000-000000000001', `${QA_ORG}x`, '*']) reject({ ...REMOTE, TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID: v }, `QA pin ${v}`);
  const unpinned = { ...REMOTE }; delete unpinned.TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID;
  assert.equal(loadPaymentsConfig(unpinned).qaOrganizationId, null);
  const svc = sandboxService(sandboxWorld(), unpinned);
  const w = await sandboxNotify(svc, { env: unpinned });
  assert.equal(w.status, 422); assert.equal(w.code, 'payment_verification_failed_qa_scope_unset');
  const mp = []; const db = [];
  const pref = createPaymentsService({ env: unpinned, connectDb: dbFake(db), fetcher: mpFake({ calls: mp }), log: () => {} });
  const r = await internalRequest(pref);
  assert.equal(r.status, 422); assert.deepEqual(r.body, { error: 'purchase_invalid' });
  assert.ok(!mp.includes('POST /checkout/preferences'));
  const other = createPaymentsService({ env: { ...REMOTE, TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID: '11111111-1111-4111-8111-111111111111' }, connectDb: dbFake([]), fetcher: mpFake({ calls: [] }), log: () => {} });
  assert.equal((await internalRequest(other)).status, 422, 'a purchase of another organization is never priced into a Preference');
});

test('R7 parity: every certified provider-binding mismatch except live_mode is also refused by the remote-test policy', async () => {
  const { verifyMercadoPagoPaymentBinding } = await import('../../backend/torneos/supabase/functions/_shared/mercadoPagoPaymentProvider.ts');
  const { remoteTestSandboxProblem } = await import('../../backend/torneos/supabase/functions/torneos-payments/remote-test.ts');
  const w = sandboxWorld({ payment: (p) => ({ ...p, live_mode: false }) });
  const cfg = { accessToken: 'x', webhookSecret: 'y', sellerId: SELLER };
  const judge = (payment, order, purchase) => ({
    provider: (() => { try { verifyMercadoPagoPaymentBinding(payment, order, purchase, cfg); return null; } catch { return 'refused'; } })(),
    remote: remoteTestSandboxProblem({ payment, order, preference: w.preference, purchase, attestedSellerId: SELLER, sellerId: SELLER, qaOrganizationId: QA_ORG }),
  });
  assert.deepEqual(judge(w.payment, w.order, w.purchase), { provider: null, remote: null });
  const live = judge({ ...w.payment, live_mode: true }, w.order, w.purchase);
  assert.deepEqual(live, { provider: 'refused', remote: null }, 'the ONLY difference: live_mode=true');
  for (const [label, p, o, pu] of [
    ['payment id', { id: undefined }], ['collector', { collector_id: 1 }], ['order collector', {}, { collector: { id: 1 } }], ['reference', { external_reference: 'x' }],
    ['order reference', {}, { external_reference: 'x' }], ['metadata', { metadata: { purchase_id: 'x' } }], ['currency', { currency_id: 'USD' }], ['amount', { transaction_amount: 1 }],
    ['order preference', {}, { preference_id: 'x' }], ['not in order', {}, { payments: [] }], ['purchase preference', {}, {}, { providerPreferenceId: 'x' }],
  ]) {
    const v = judge({ ...w.payment, ...p }, { ...w.order, ...(o ?? {}) }, { ...w.purchase, ...(pu ?? {}) });
    assert.equal(v.provider, 'refused', label); assert.notEqual(v.remote, null, `${label}: remote-test must refuse what the provider refuses`);
  }
});
