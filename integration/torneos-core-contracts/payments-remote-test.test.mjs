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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { UNIT_ENV } from './payments-unit-env.mjs';

const { loadPaymentsConfig, ConfigError } = await import('../../backend/torneos/supabase/functions/torneos-payments/config.ts');
const { createPaymentsService } = await import('../../backend/torneos/supabase/functions/torneos-payments/handler.ts');
const { TORNEOS_REF } = await import('../../backend/torneos/supabase/functions/torneos-payments/remote-test.ts');

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
