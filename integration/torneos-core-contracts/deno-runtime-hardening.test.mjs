// MP-B1.1 R3 — isolated remote commerce runtime hardening (offline; no lab, no network, no Deno Deploy).
//
//   H1  payments secret deny-list   torneos-payments refuses to boot when it sees gateway / Core / bridge private
//                                   material, Supabase admin credentials or a platform database binding
//                                   (DATABASE_URL / PG*); legitimate public or platform configuration still boots.
//   H2  forbidden DB logins         TORNEOS_PAYMENTS_DB_URL naming a gateway login (torneos_edge_identity_writer,
//                                   torneos_edge_core_adapter — plain, pooler `<login>.<ref>`, case or %-encoding
//                                   variants) is refused by the LOGIN, whatever the variable is called.
//   TS  webhook ts                  exactly ^[1-9]\d{9}$ (epoch seconds) or ^[1-9]\d{12}$ (epoch milliseconds); the RAW
//                                   header value is the one signed; seconds/milliseconds only matter to the future-skew
//                                   check (+300 s, no maximum age); every refusal happens before any provider or DB call.
//   ORD webhook ts never orders     the ordering RPCs receive only the re-fetched provider date_last_updated.
//   DD  Deno Deploy readiness       both entrypoints use only standard Deno 2 APIs (Deno.serve, Deno.env) + pinned npm
//                                   specifiers + relative imports + `with { type: "json" }`; no edge-runtime-only API, no
//                                   filesystem / subprocess / KV, no hard-coded host; routes /functions/v1/<app>/…
//   ISO Deno isolation contract     two apps, APP-level variables only, no organization variables, no database
//                                   integration, no frontend secrets — CODE_READY only (control plane not certified).
//
// Results: backend/torneos/mp-b/evidence/mp-b1.1-r3/offline[-tag].json. Fixture values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const FN_DIR = `${repo}backend/torneos/supabase/functions/`;
const GW_DIR = `${FN_DIR}torneos-gateway/`;
const PAY_DIR = `${FN_DIR}torneos-payments/`;
const EVIDENCE = `${repo}backend/torneos/mp-b/evidence/mp-b1.1-r3/`;
const TAG = process.env.MP_B11R3_EVIDENCE_TAG ? `-${process.env.MP_B11R3_EVIDENCE_TAG}` : '';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const results = [];
const evidence = { h1: [], h2: [], ts: [], rawHmac: [], ordering: [], deno: {}, isolation: {} };

const load = async (path) => import(path).catch((error) => ({ __missing: String(error?.message ?? error) }));
const payConfig = await load(`${PAY_DIR}config.ts`);
const handler = await load(`${PAY_DIR}handler.ts`);
const freshness = await load(`${PAY_DIR}webhook-freshness.ts`);
const signatureModule = await load(`${PAY_DIR}webhook-signature.ts`);
const commerce = await load(`${GW_DIR}commerce.ts`);
const { UNIT_ENV: PAY_ENV } = await import('./payments-unit-env.mjs');

function payVerdict(env) {
  if (payConfig.__missing) throw new assert.AssertionError({ message: `config.ts: ${payConfig.__missing}` });
  try { payConfig.loadPaymentsConfig(env); return { ok: true }; }
  catch (error) { return { ok: false, error: error?.constructor?.name, message: String(error?.message ?? error) }; }
}
function payReject(env, label, bucket) {
  const v = payVerdict(env);
  bucket.push({ case: label, verdict: v.ok ? 'ACCEPTED' : 'REJECTED', reason: v.message ?? null });
  assert.equal(v.ok, false, `${label}: payments must refuse to boot`);
  assert.equal(v.error, 'ConfigError', `${label}: ConfigError, got ${v.error}: ${v.message}`);
  for (const value of Object.values(env)) if (typeof value === 'string' && value.length >= 8) assert.ok(!v.message.includes(value), `${label}: the error names no value`);
}
function payAccept(env, label, bucket) {
  const v = payVerdict(env);
  bucket.push({ case: label, verdict: v.ok ? 'ACCEPTED' : 'REJECTED', reason: v.message ?? null });
  assert.equal(v.ok, true, `${label}: expected a configuration, got ${v.message}`);
}

// Real gateway-side names (torneos-gateway/config.ts, commerce.ts, lab compose) and platform / admin credentials.
const GATEWAY_PRIVATE = ['TORNEOS_BRIDGE_KEYS', 'TORNEOS_CONTRACT_SERVICE_SECRET', 'TORNEOS_DB_IDENTITY_WRITER_URL', 'TORNEOS_DB_CORE_ADAPTER_URL'];
const CORE_PRIVATE = ['CORE_SERVICE_ROLE_KEY', 'CORE_JWT_SECRET'];
const SUPABASE_ADMIN = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS', 'SUPABASE_DB_URL'];
// postgres.js 3.4.7 parseOptions: PGHOST/PGPORT/PGUSERNAME/PGUSER/PGDATABASE/PGPASSWORD/PGAPPNAME/PGTARGETSESSIONATTRS and
// env['PG' + option.toUpperCase()] (PGSSL, PGIDLE_TIMEOUT, PGDEBUG, …); plus libpq names and PostgREST server secrets.
const PLATFORM_DB_BINDING = ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGUSERNAME', 'PGPASSWORD', 'PGDATABASE', 'PGAPPNAME', 'PGTARGETSESSIONATTRS',
  'PGSSL', 'PGIDLE_TIMEOUT', 'PGCONNECT_TIMEOUT', 'PGMAX_LIFETIME', 'PGDEBUG', 'PGFETCH_TYPES', 'PGSSLMODE', 'PGPASSFILE', 'PGSERVICE', 'PGOPTIONS', 'PGRST_JWT_SECRET', 'PGRST_DB_URI'];
const PAYMENTS_FORBIDDEN = [...GATEWAY_PRIVATE, ...CORE_PRIVATE, ...SUPABASE_ADMIN, ...PLATFORM_DB_BINDING];
// Present on a Deno Deploy app / an operator shell, or public gateway configuration: never a reason to refuse.
const PAYMENTS_TOLERATED = { DENO_DEPLOYMENT_ID: 'dep-fixture', DENO_REGION: 'fixture-region', PORT: '8000', TZ: 'UTC', HOME: '/home/app', PATH: '/usr/bin',
  CORE_AUTH_URL: 'https://core.fixture.invalid/auth/v1', CORE_ANON_KEY: 'anon-public-fixture', TORNEOS_REST_URL: 'https://data.fixture.invalid/rest/v1',
  SUPABASE_URL: 'https://data.fixture.invalid', TORNEOS_DB_SSL_CA: 'public-ca-fixture', PAGE_SIZE: '20', XPGHOST: 'not-libpq', pghost: 'lower-case-not-libpq' };

// ------------------------------------------------------------------ offline webhook harness (fake provider + DB)
const NOW_MS = Date.parse('2026-09-24T12:00:00Z');
const NOW_S = NOW_MS / 1000;
const PID = '5f0e0000-0000-4000-8000-00000000b113';
const EXT = `arma2:season:purchase:${PID}`;
const PAYMENT_ID = '1790000000123';
const REQUEST_ID = 'r3-ts';
const PROVIDER_UPDATED = '2026-09-24T11:00:00.123-03:00';
const projection = { id: PID, organizationId: '10000000-0000-4000-8000-000000000001', seasonId: '20000000-0000-4000-8000-000000000001', tournamentId: null,
  productCode: 'torneos_premium', provider: 'MERCADO_PAGO', providerEnvironment: 'test', providerPreferenceId: 'pref-r3', externalReference: EXT, status: 'approved',
  amount: 39900, currency: 'ARS', createdAt: '2026-09-20T00:00:00.000Z', preferenceExpiresAt: null };
const v1Of = (ts, { secret = PAY_ENV.MERCADO_PAGO_TEST_WEBHOOK_SECRET, dataId = PAYMENT_ID, requestId = REQUEST_ID } = {}) =>
  createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');

async function deliver({ header, nowMs = NOW_MS, bodyOver = {} } = {}) {
  if (handler.__missing) throw new assert.AssertionError({ message: `handler.ts: ${handler.__missing}` });
  const calls = { fetch: 0, db: [] };
  const service = handler.createPaymentsService({ env: PAY_ENV, now: () => nowMs, log: () => {},
    connectDb: () => ({ async call(name, args) { calls.db.push({ name, args }); return name === 'get_provider_tournament_purchase' ? projection : { outcome: 'replayed' }; } }),
    fetcher: async (url) => { calls.fetch += 1; return new Response(JSON.stringify(String(url).includes('/v1/payments/') ? {
      id: PAYMENT_ID, status: 'approved', status_detail: 'accredited', date_last_updated: PROVIDER_UPDATED, external_reference: EXT, currency_id: 'ARS',
      transaction_amount: 39900, collector_id: PAY_ENV.MERCADO_PAGO_TEST_SELLER_ID, metadata: { purchase_id: PID }, live_mode: false, order: { id: '999', type: 'mercadopago' },
    } : { id: '999', preference_id: 'pref-r3', external_reference: EXT, collector: { id: PAY_ENV.MERCADO_PAGO_TEST_SELLER_ID }, payments: [{ id: PAYMENT_ID }] })); } });
  const response = await service(new Request(`https://pay.fixture.invalid/functions/v1/torneos-payments/webhooks/mercadopago/v1?data.id=${PAYMENT_ID}&type=payment`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': REQUEST_ID, ...(header === null ? {} : { 'x-signature': header }) },
    body: JSON.stringify({ type: 'payment', data: { id: PAYMENT_ID }, live_mode: false, user_id: PAY_ENV.MERCADO_PAGO_TEST_SELLER_ID, date_last_updated: '2099-01-01T00:00:00Z', ...bodyOver }) }));
  return { status: response.status, body: await response.json(), fetches: calls.fetch, db: calls.db };
}
const signed = (ts) => `ts=${ts},v1=${v1Of(ts)}`;
const accepted = (r) => r.status === 200 && r.fetches === 2 && r.db.map(c => c.name).join() === 'get_provider_tournament_purchase,apply_verified_tournament_payment_status';
const refusedEarly = (r) => r.status === 401 && r.body.error === 'invalid_signature' && r.fetches === 0 && r.db.length === 0;

const codeOf = (text) => text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const importsOf = (text) => [...text.matchAll(/^\s*(?:import|export)\b[^;'"]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map(m => m[1] ?? m[2]);

test('MP-B1.1 R3 — isolated remote commerce runtime hardening (offline)', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 400) }); throw error; }
    });
  }
  try {
    // ================================================================ H1 payments secret deny-list
    await check('H1 baseline: the fixture TEST configuration boots', async () => {
      payAccept({ ...PAY_ENV }, 'fixture TEST configuration', evidence.h1);
    });
    await check('H1 payments refuses to boot with gateway / bridge private material (TORNEOS_BRIDGE_KEYS, TORNEOS_CONTRACT_SERVICE_SECRET, gateway DB URLs)', async () => {
      for (const name of GATEWAY_PRIVATE) payReject({ ...PAY_ENV, [name]: 'fixture-value-not-a-secret' }, `payments env carries ${name}`, evidence.h1);
    });
    await check('H1 payments refuses to boot with Core private material (CORE_SERVICE_ROLE_KEY, CORE_JWT_SECRET)', async () => {
      for (const name of CORE_PRIVATE) payReject({ ...PAY_ENV, [name]: 'fixture-value-not-a-secret' }, `payments env carries ${name}`, evidence.h1);
    });
    await check('H1 payments refuses to boot with Supabase service-role / admin credentials (SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEYS, SUPABASE_DB_URL)', async () => {
      for (const name of SUPABASE_ADMIN) payReject({ ...PAY_ENV, [name]: 'fixture-value-not-a-secret' }, `payments env carries ${name}`, evidence.h1);
    });
    await check('H1 payments refuses to boot with an automatic database binding (DATABASE_URL or any libpq PG* variable postgres.js would silently use)', async () => {
      for (const name of PLATFORM_DB_BINDING) payReject({ ...PAY_ENV, [name]: 'fixture-value-not-a-secret' }, `payments env carries ${name}`, evidence.h1);
    });
    await check('H1 not over-broad: Deno Deploy platform variables, shell variables and PUBLIC gateway/Core configuration do not refuse the boot; blank foreign values are ignored', async () => {
      payAccept({ ...PAY_ENV, ...PAYMENTS_TOLERATED }, 'platform / shell / public configuration', evidence.h1);
      for (const name of PAYMENTS_FORBIDDEN) payAccept({ ...PAY_ENV, [name]: '   ' }, `blank ${name}`, evidence.h1);
    });
    await check('H1 runtime: a refused payments configuration serves 503 on both routes, opens no DB connection and logs no value', async () => {
      if (handler.__missing) throw new assert.AssertionError({ message: handler.__missing });
      for (const name of ['TORNEOS_BRIDGE_KEYS', 'TORNEOS_CONTRACT_SERVICE_SECRET', 'DATABASE_URL']) {
        let connects = 0; const logs = [];
        const service = handler.createPaymentsService({ env: { ...PAY_ENV, [name]: 'fixture-foreign-secret-value' }, log: (e) => logs.push(JSON.stringify(e)), connectDb: () => { connects += 1; return {}; } });
        for (const path of ['/internal/v1/season-checkout-preference', '/webhooks/mercadopago/v1']) {
          assert.equal((await service(new Request(`https://pay.fixture.invalid/functions/v1/torneos-payments${path}`, { method: 'POST', body: '{}' }))).status, 503, `${name} ${path}`);
        }
        assert.equal(connects, 0, name);
        assert.ok(!logs.join('\n').includes('fixture-foreign-secret-value'), `${name}: no value logged`);
      }
    });

    // ================================================================ H2 forbidden DB logins
    const dbUrl = (login) => `postgres://${login}:pw-fixture@db.fixture.invalid:5432/postgres`;
    await check('H2 payments refuses a DB URL whose LOGIN is a gateway login (plain, pooler <login>.<ref>, upper case, %-encoded)', async () => {
      for (const login of ['torneos_edge_identity_writer', 'torneos_edge_core_adapter', 'torneos_edge_identity_writer.abcdefghijklmnopqrst',
        'torneos_edge_core_adapter.abcdefghijklmnopqrst', 'TORNEOS_EDGE_IDENTITY_WRITER', 'Torneos_Edge_Core_Adapter', 'torneos%5Fedge%5Fidentity%5Fwriter',
        'torneos_identity_writer', 'torneos_core_adapter', 'lab_identity_writer', 'lab_core_adapter']) {
        payReject({ ...PAY_ENV, TORNEOS_PAYMENTS_DB_URL: dbUrl(login) }, `payments DB login ${login}`, evidence.h2);
      }
    });
    await check('H2 the rule is the login, not the variable name: the gateway login in TORNEOS_PAYMENTS_DB_URL is refused even when no gateway variable is present', async () => {
      const env = { ...PAY_ENV, TORNEOS_PAYMENTS_DB_URL: 'postgresql://torneos_edge_core_adapter.abcdefghijklmnopqrst:pw-fixture@aws-0-sa-east-1.pooler.supabase.com:6543/postgres' };
      for (const name of GATEWAY_PRIVATE) assert.ok(!(name in env));
      payReject(env, 'gateway adapter login through the pooler, no gateway variable present', evidence.h2);
    });
    await check('H2 the dedicated payments login stays allowed (plain and pooler forms); platform roles stay refused', async () => {
      for (const login of ['payments_login', 'torneos_payments_login', 'torneos_payments_login.abcdefghijklmnopqrst', 'lab_payment_service']) {
        payAccept({ ...PAY_ENV, TORNEOS_PAYMENTS_DB_URL: dbUrl(login) }, `payments DB login ${login}`, evidence.h2);
      }
      for (const login of ['postgres', 'service_role', 'supabase_admin', 'authenticator', 'anon', 'authenticated', 'torneos_payment_service']) {
        payReject({ ...PAY_ENV, TORNEOS_PAYMENTS_DB_URL: dbUrl(login) }, `payments DB login ${login}`, evidence.h2);
      }
    });

    // ================================================================ TS webhook ts model
    const T = evidence.ts;
    const record = (label, r, expected) => { T.push({ case: label, expected, http: r.status, outcome: r.body.outcome ?? r.body.error ?? null, providerFetches: r.fetches, dbCalls: r.db.length }); return r; };
    await check('TS module: parse/verify/freshness API present; future skew stays +300 s', async () => {
      assert.ok(!signatureModule.__missing, `webhook-signature.ts: ${signatureModule.__missing}`);
      assert.ok(!freshness.__missing, `webhook-freshness.ts: ${freshness.__missing}`);
      for (const fn of ['parseMercadoPagoSignature', 'mercadoPagoManifest', 'verifyMercadoPagoSignature']) assert.equal(typeof signatureModule[fn], 'function', fn);
      for (const fn of ['webhookTimestampMs', 'webhookTimeVerdict']) assert.equal(typeof freshness[fn], 'function', fn);
      assert.equal(freshness.WEBHOOK_FUTURE_SKEW_S, 300);
    });
    await check('TS valid signed 10-digit seconds and 13-digit milliseconds (now) → accepted, provider re-fetched', async () => {
      for (const [label, ts] of [['10-digit seconds now', String(NOW_S)], ['13-digit milliseconds now', String(NOW_MS + 123)], ['13-digit milliseconds, round second', String(NOW_MS)]]) {
        assert.ok(accepted(record(label, await deliver({ header: signed(ts) }), 'accepted')), label);
      }
    });
    await check('TS OLD authentic notifications (seconds and milliseconds, −1 h / −30 d / −2 y) → accepted (no maximum age) and always re-fetched', async () => {
      for (const ageS of [3600, 86400 * 30, 86400 * 730]) {
        assert.ok(accepted(record(`old seconds −${ageS}s`, await deliver({ header: signed(String(NOW_S - ageS)) }), 'accepted')), `seconds −${ageS}`);
        assert.ok(accepted(record(`old milliseconds −${ageS}s`, await deliver({ header: signed(String(NOW_MS - ageS * 1000 + 7)) }), 'accepted')), `ms −${ageS}`);
      }
    });
    await check('TS future within skew (seconds +1/+60/+300; milliseconds +1 ms/+60 s/+300 000 ms) → accepted', async () => {
      for (const s of [1, 60, 300]) assert.ok(accepted(record(`future seconds +${s}s`, await deliver({ header: signed(String(NOW_S + s)) }), 'accepted')), `+${s}s`);
      for (const ms of [1, 60_000, 300_000]) assert.ok(accepted(record(`future milliseconds +${ms}ms`, await deliver({ header: signed(String(NOW_MS + ms)) }), 'accepted')), `+${ms}ms`);
    });
    await check('TS absurd future (seconds +301 s/+1 d/+10 y; milliseconds +300 001 ms/+1 d/+10 y) → 401 before any provider or DB call', async () => {
      for (const s of [301, 86400, 86400 * 3650]) assert.ok(refusedEarly(record(`future seconds +${s}s`, await deliver({ header: signed(String(NOW_S + s)) }), 401)), `+${s}s`);
      for (const ms of [300_001, 86_400_000, 86400 * 3650 * 1000]) assert.ok(refusedEarly(record(`future milliseconds +${ms}ms`, await deliver({ header: signed(String(NOW_MS + ms)) }), 401)), `+${ms}ms`);
    });
    // Each malformed value is SIGNED over itself with the real secret: the refusal is the format, not the HMAC.
    const MALFORMED = [
      ['empty', ''], ['9 digits', String(NOW_S).slice(1)], ['11 digits', `${NOW_S}0`], ['12 digits', `${NOW_S}00`], ['14 digits', `${NOW_MS}0`],
      ['19 digits (overflow)', '9'.repeat(19)], ['unsafe integer (16 digits)', '9007199254740993'], ['leading zero, 10 digits', `0${String(NOW_S).slice(1)}`],
      ['leading zero, 13 digits', `0${String(NOW_MS).slice(1)}`], ['all zeros', '0000000000'], ['float', `${NOW_S}.5`], ['float ms', `${NOW_MS}.0`],
      ['exponent', '1.7902512e9'], ['exponent ms', '1.7902512e12'], ['negative', `-${NOW_S}`], ['plus sign', `+${NOW_S}`], ['leading space', ` ${NOW_S}`],
      ['trailing space', `${NOW_S} `], ['tab', `\t${NOW_S}`], ['inner space', `${String(NOW_S).slice(0, 5)} ${String(NOW_S).slice(5)}`],
      ['garbage suffix', `${NOW_S}abc`], ['garbage prefix', `x${NOW_S}`], ['hex', `0x${NOW_S.toString(16)}`], ['underscore separator', `1_790_251_200`],
      ['letters', 'abcdefghij'],
    ];
    // Not representable in an HTTP header (ByteString): refused by the parser itself.
    const NON_ASCII = [['non-ASCII digits', '١٧٩٠٢٥١٢٠٠'], ['fullwidth digits', '１７９０２５１２００']];
    await check('TS malformed ts (lengths 9/11/12/14/19, leading zero, float, exponent, sign, whitespace, garbage, non-ASCII digits) → 401 before any provider call even when HMAC-signed over itself', async () => {
      for (const [label, ts] of MALFORMED) assert.ok(refusedEarly(record(`malformed: ${label}`, await deliver({ header: signed(ts) }), 401)), label);
      for (const [label, ts] of NON_ASCII) {
        assert.equal(signatureModule.parseMercadoPagoSignature(signed(ts)), null, label);
        assert.equal(freshness.webhookTimestampMs(ts), null, label);
        T.push({ case: `malformed (parser level): ${label}`, expected: 'refused', parsed: null });
      }
      for (const [label, header] of [['missing header', null], ['ts missing', `v1=${v1Of(String(NOW_S))}`], ['v1 missing', `ts=${NOW_S}`], ['v1 not hex', `ts=${NOW_S},v1=${'z'.repeat(64)}`],
        ['part without "="', `ts=${NOW_S},v1=${v1Of(String(NOW_S))},garbage`]]) {
        assert.ok(refusedEarly(record(`malformed: ${label}`, await deliver({ header }), 401)), label);
      }
    });
    await check('TS duplicate ts / v1 keys are ambiguous → 401 (whichever occurrence is signed); unknown extra keys are ignored; key spacing is tolerated', async () => {
      const now = String(NOW_S), later = String(NOW_S + 86400);
      for (const [label, header] of [['ts future then now (signed now)', `ts=${later},ts=${now},v1=${v1Of(now)}`], ['ts now then future (signed future)', `ts=${now},ts=${later},v1=${v1Of(later)}`],
        ['ts twice identical', `ts=${now},ts=${now},v1=${v1Of(now)}`], ['v1 twice', `ts=${now},v1=${v1Of(now)},v1=${v1Of(now)}`]]) {
        assert.ok(refusedEarly(record(`duplicate: ${label}`, await deliver({ header }), 401)), label);
      }
      assert.ok(accepted(record('extra key ignored', await deliver({ header: `ts=${now},v1=${v1Of(now)},v2=abc` }), 'accepted')), 'extra key');
      assert.ok(accepted(record('space after comma (key trimmed)', await deliver({ header: `ts=${now}, v1=${v1Of(now)}` }), 'accepted')), 'key spacing');
      assert.ok(accepted(record('v1 upper-case hex', await deliver({ header: `ts=${now},v1=${v1Of(now).toUpperCase()}` }), 'accepted')), 'v1 case');
    });
    await check('TS bad signature / wrong secret / wrong request id → 401 before any provider call (10 and 13 digits)', async () => {
      for (const ts of [String(NOW_S), String(NOW_MS)]) {
        assert.ok(refusedEarly(record(`bad v1 (${ts.length})`, await deliver({ header: `ts=${ts},v1=${'0'.repeat(64)}` }), 401)));
        assert.ok(refusedEarly(record(`wrong secret (${ts.length})`, await deliver({ header: `ts=${ts},v1=${v1Of(ts, { secret: 'x'.repeat(40) })}` }), 401)));
        assert.ok(refusedEarly(record(`other request id (${ts.length})`, await deliver({ header: `ts=${ts},v1=${v1Of(ts, { requestId: 'other' })}` }), 401)));
      }
    });

    // ================================================================ raw HMAC guarantee
    const R = evidence.rawHmac;
    await check('RAW HMAC: the manifest carries the ts bytes exactly as received — a 13-digit ts signed as its seconds, or a 10-digit ts signed as milliseconds, is refused', async () => {
      const ms = String(NOW_MS + 456), s = String(NOW_S);
      const cases = [
        ['13-digit header, v1 over the raw 13 digits', `ts=${ms},v1=${v1Of(ms)}`, true],
        ['13-digit header, v1 over floor(ms/1000) seconds', `ts=${ms},v1=${v1Of(String(Math.floor(Number(ms) / 1000)))}`, false],
        ['13-digit header, v1 over the Date ISO string', `ts=${ms},v1=${v1Of(new Date(Number(ms)).toISOString())}`, false],
        ['10-digit header, v1 over the raw 10 digits', `ts=${s},v1=${v1Of(s)}`, true],
        ['10-digit header, v1 over seconds × 1000', `ts=${s},v1=${v1Of(`${s}000`)}`, false],
        ['10-digit header, v1 over the trimmed-space variant', `ts=${s},v1=${v1Of(` ${s}`)}`, false],
      ];
      for (const [label, header, ok] of cases) {
        const r = await deliver({ header });
        R.push({ case: label, expected: ok ? 'accepted' : 401, http: r.status, providerFetches: r.fetches });
        assert.ok(ok ? accepted(r) : refusedEarly(r), label);
      }
      const parsed = signatureModule.parseMercadoPagoSignature(`ts=${ms},v1=${v1Of(ms)}`);
      assert.equal(parsed.ts, ms, 'parser returns the raw ts string');
      assert.equal(typeof parsed.ts, 'string');
      assert.equal(signatureModule.mercadoPagoManifest(PAYMENT_ID, REQUEST_ID, parsed.ts), `id:${PAYMENT_ID};request-id:${REQUEST_ID};ts:${ms};`);
    });
    await check('RAW HMAC: normalisation exists only in the freshness module (seconds → ×1000, milliseconds as is) and never feeds the manifest', async () => {
      assert.equal(freshness.webhookTimestampMs(String(NOW_S)), NOW_MS);
      assert.equal(freshness.webhookTimestampMs(String(NOW_MS + 9)), NOW_MS + 9);
      for (const [, bad] of [...MALFORMED, ...NON_ASCII]) assert.equal(freshness.webhookTimestampMs(bad), null, JSON.stringify(bad));
      assert.equal(freshness.webhookTimeVerdict(String(NOW_S + 300), NOW_MS), 'ok');
      assert.equal(freshness.webhookTimeVerdict(String(NOW_S + 301), NOW_MS), 'future');
      assert.equal(freshness.webhookTimeVerdict(String(NOW_MS + 300_000), NOW_MS), 'ok');
      assert.equal(freshness.webhookTimeVerdict(String(NOW_MS + 300_001), NOW_MS), 'future');
      assert.equal(freshness.webhookTimeVerdict(String(NOW_S - 86400 * 3650), NOW_MS), 'ok');
      assert.equal(freshness.webhookTimeVerdict('1790251200.5', NOW_MS), 'malformed');
      const sig = await readFile(`${PAY_DIR}webhook-signature.ts`, 'utf8');
      const fresh = await readFile(`${PAY_DIR}webhook-freshness.ts`, 'utf8');
      const h = await readFile(`${PAY_DIR}handler.ts`, 'utf8');
      assert.ok(!/webhookTimestampMs|webhookTimeVerdict|\* ?1000|Number\(|parseInt|parseFloat|\.trim\(\)[^\n]*ts\b/.test(codeOf(sig).replace(/const TS_RE[^\n]*/, '')), 'the signature module never converts the ts');
      assert.match(codeOf(sig), /ts:\$\{ts\};/, 'the manifest interpolates the raw ts');
      assert.ok(!/crypto\.subtle|createHmac|mercadoPagoManifest/.test(codeOf(fresh)), 'the freshness module does no cryptography');
      const verify = h.indexOf('verifyMercadoPagoSignature('), fresher = h.indexOf('webhookTimeVerdict('), fetchCall = h.indexOf('fetchMercadoPagoPayment(paymentId');
      assert.ok(verify > 0 && verify < fresher && fresher < fetchCall, 'HMAC → freshness → provider re-fetch');
      assert.match(h, /webhookTimeVerdict\(signature\.ts,/, 'freshness judges the same parsed (raw) ts the HMAC covered');
      assert.ok(!/verifyMercadoPagoWebhookSignature\(/.test(codeOf(h)), 'the 10-digit-only shared verifier is no longer on the webhook path');
    });
    await check('RAW HMAC: the byte-pinned shared provider copy is untouched (no fork of the legacy file)', async () => {
      for (const [file, expected] of Object.entries({ 'paymentProvider.ts': 'da5e43266c5107cd1f6183c83046ba49e71343e9102370adb08be8abb4640a40',
        'mercadoPagoPaymentProvider.ts': '1136217d93c55c5f981d45dfa9abfd62f14b26a218df120f5f801d547e547961' })) {
        assert.equal(sha256(await readFile(`${FN_DIR}_shared/${file}`)), expected, file);
      }
    });

    // ================================================================ ORD ts never orders state
    await check('ORD the ordering RPC receives the re-fetched provider date_last_updated verbatim — never the webhook ts (10 or 13 digits) nor the body date', async () => {
      for (const ts of [String(NOW_S), String(NOW_MS + 999), String(NOW_S - 86400 * 30), String(NOW_MS + 299_000)]) {
        const r = await deliver({ header: signed(ts), bodyOver: { date_last_updated: '2099-01-01T00:00:00Z', date_created: new Date(Number(ts.length === 10 ? Number(ts) * 1000 : ts)).toISOString() } });
        const apply = r.db.find(c => c.name === 'apply_verified_tournament_payment_status');
        evidence.ordering.push({ ts, http: r.status, orderingArg: apply?.args?.[7] ?? null });
        assert.ok(accepted(r), ts);
        assert.equal(apply.args[7], PROVIDER_UPDATED, 'provider time, byte-exact');
        assert.ok(!JSON.stringify(r.db).includes(ts), 'the ts never reaches the DB');
      }
      const fresh = codeOf(await readFile(`${PAY_DIR}webhook-freshness.ts`, 'utf8')) + codeOf(await readFile(`${PAY_DIR}webhook-signature.ts`, 'utf8'));
      assert.ok(!/date_last_updated|providerUpdatedAt/.test(fresh));
    });

    // ================================================================ DD Deno Deploy readiness (static)
    const graph = new Map();
    async function walk(file) {
      if (graph.has(file)) return;
      const text = await readFile(file, 'utf8');
      graph.set(file, text);
      for (const spec of importsOf(text)) if (spec.startsWith('.')) await walk(fileURLToPath(new URL(spec, `file://${file}`)));
    }
    await check('DD module graph: both entrypoints import only relative files inside backend/torneos/supabase/functions, pinned npm:jose@6.2.12 / npm:postgres@3.4.7, and JSON with `with { type: "json" }`', async () => {
      const entries = { gateway: `${GW_DIR}index.ts`, payments: `${PAY_DIR}index.ts` };
      const summary = {};
      for (const [app, entry] of Object.entries(entries)) {
        graph.clear();
        await walk(entry);
        const specs = new Set();
        for (const [file, text] of graph) {
          assert.ok(file.startsWith(FN_DIR), `${app}: ${file} outside the functions tree`);
          for (const spec of importsOf(text)) {
            specs.add(spec.startsWith('.') ? `./${fileURLToPath(new URL(spec, `file://${file}`)).slice(FN_DIR.length)}` : spec);
            assert.ok(spec.startsWith('./') || spec.startsWith('../') || ['npm:jose@6.2.12', 'npm:postgres@3.4.7'].includes(spec), `${app}: ${file.slice(FN_DIR.length)} imports ${spec}`);
          }
          assert.ok(!/\bassert\s*\{\s*type\s*:/.test(text), `${file}: Deno 2 removed import assertions`);
          for (const m of text.matchAll(/^import[^\n]*\.json["'][^\n]*$/gm)) assert.match(m[0], /with \{ type: "json" \}/, `${file}: JSON import attribute`);
        }
        summary[app] = { files: [...graph.keys()].map(f => f.slice(FN_DIR.length)).sort(), imports: [...specs].sort() };
      }
      assert.ok(summary.payments.files.every(f => f.startsWith('torneos-payments/') || f.startsWith('_shared/')), 'payments graph = torneos-payments + _shared');
      assert.ok(summary.gateway.files.every(f => f.startsWith('torneos-gateway/') || ['torneos-payments/hmac.ts', 'torneos-payments/remote-hosts.ts'].includes(f)), 'gateway graph = torneos-gateway + 2 shared payments helpers');
      assert.ok(!summary.gateway.files.some(f => /torneos-payments\/(config|handler|db|lab-fetch|rpc|webhook-)/.test(f) || f.startsWith('_shared/')), 'the gateway never loads payments configuration or the Mercado Pago provider');
      evidence.deno.moduleGraph = summary;
    });
    await check('DD runtime APIs: only Deno.serve and Deno.env (plus Web platform APIs) — no EdgeRuntime, filesystem, subprocess, KV, cron, FFI, process.env or edge-runtime paths', async () => {
      const files = [...new Set([...(await readdir(GW_DIR)).filter(f => f.endsWith('.ts')).map(f => GW_DIR + f), ...(await readdir(PAY_DIR)).filter(f => f.endsWith('.ts')).map(f => PAY_DIR + f),
        `${FN_DIR}_shared/mercadoPagoPaymentProvider.ts`, `${FN_DIR}_shared/paymentProvider.ts`])];
      const denoApis = new Set();
      for (const file of files) {
        const code = codeOf(await readFile(file, 'utf8'));
        for (const m of code.matchAll(/\bDeno\??\.(\w+)(?:\.(\w+))?/g)) denoApis.add(m[2] && m[1] === 'env' ? `Deno.env.${m[2]}` : `Deno.${m[1]}`);
        assert.ok(!/EdgeRuntime|Supabase\.ai|supabase\/functions-js|jsr:@supabase|https:\/\/esm\.sh|https:\/\/deno\.land/.test(code), `${file}: edge-runtime-only API or remote import`);
        assert.ok(!/Deno\.(readFile|readTextFile|writeFile|writeTextFile|open|mkdir|remove|stat|lstat|readDir|Command|run|openKv|cron|dlopen|listen|connect|cwd|chdir|execPath|exit)\b/.test(code), `${file}: filesystem / process / KV / socket API`);
        assert.ok(!/process\.env|require\(|__dirname|import\.meta\.(dirname|filename|resolve)|\/home\/deno|\/tmp\//.test(code), `${file}: Node global or container path`);
        // GATEWAY/AUTH G1: topology.ts pins the Production topology (Core Production authority, Torneos data plane) as
        // VALUES TO COMPARE configuration against; nothing is fetched from them. Its *.supabase.co names may appear
        // only inside the frozen PRODUCTION pin and the Edge-Function-host refusal; every other file stays host-free.
        const hostCode = file.endsWith('/torneos-gateway/topology.ts')
          ? code.replace(/export const PRODUCTION = Object\.freeze\(\{[\s\S]*?\n\}\)/, '').replace(/\/\(\^\|\\\.\)supabase\\\.\(co\|in\|com\|net\)\$\//, '')
          : code;
        assert.ok(!/\.supabase\.co\b|deno\.dev\b|deno\.net\b/.test(hostCode), `${file}: hard-coded platform hostname`);
      }
      evidence.deno.denoApis = [...denoApis].sort();
      assert.deepEqual(evidence.deno.denoApis, ['Deno.env', 'Deno.env.toObject', 'Deno.serve'], 'Deno.serve + Deno.env only (Deno.env is the shared provider default parameter)');
    });
    await check('DD routing: /functions/v1/<app>/… is served as-is (no hostname, no platform prefix required); webhook path and notification URL contract unchanged', async () => {
      const { routePath: gwRoute } = await import(`${GW_DIR}config.ts`);
      assert.equal(gwRoute('/functions/v1/torneos-gateway'), '/');
      assert.equal(gwRoute('/functions/v1/torneos-gateway/exchange'), '/exchange');
      assert.equal(gwRoute('/functions/v1/torneos-gateway/commerce/v1/season-checkout'), '/commerce/v1/season-checkout');
      assert.equal(gwRoute('/functions/v1/torneos-payments/x'), null);
      assert.equal(payConfig.routePath('/functions/v1/torneos-payments/webhooks/mercadopago/v1'), '/webhooks/mercadopago/v1');
      assert.equal(payConfig.routePath('/functions/v1/torneos-payments/internal/v1/season-checkout-preference'), '/internal/v1/season-checkout-preference');
      assert.equal(payConfig.routePath('/functions/v1/torneos-gateway/exchange'), null);
      assert.equal(payConfig.WEBHOOK_PATH, '/webhooks/mercadopago/v1');
      const r = await deliver({ header: signed(String(NOW_S)) });
      assert.ok(accepted(r), 'a Deno Deploy style URL (any https host, /functions/v1/torneos-payments/…) reaches the webhook');
      const sources = codeOf(await readFile(`${GW_DIR}config.ts`, 'utf8')) + codeOf(await readFile(`${PAY_DIR}config.ts`, 'utf8'));
      assert.ok(!/url\.host(name)?\s*===\s*["'][a-z]/.test(sources), 'routing never compares against a hard-coded hostname');
    });
    await check('DD remote-test still demands HTTPS and the exact declared hosts (http payments URL / wrong host → CommerceConfigError)', async () => {
      const env = { TORNEOS_COMMERCE_MODE: 'test', TORNEOS_COMMERCE_DEPLOYMENT: 'remote-test', TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST: 'gw.torneos-test.example.com',
        TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: 'pay.torneos-test.example.com', TORNEOS_PAYMENTS_INTERNAL_URL: 'https://pay.torneos-test.example.com/functions/v1/torneos-payments',
        TORNEOS_PAYMENTS_INTERNAL_SECRET: sha256('r3-fixture') };
      const ctx = { baseAllowlist: new Set(), gatewayPublicUrl: 'https://gw.torneos-test.example.com/functions/v1/torneos-gateway', distinctFrom: [], dependencyUrls: ['https://core.torneos-test.example.com/auth/v1'] };
      const ok = commerce.loadCommerceConfig(env, ctx, { mode: 'test', rpcs: ['get_effective_tournament_season_entitlements', 'get_tournament_purchase'] });
      assert.deepEqual([ok.mode, ok.deployment, ok.paymentsUrl], ['test', 'remote-test', 'https://pay.torneos-test.example.com/functions/v1/torneos-payments']);
      for (const [label, e, c] of [['http payments URL', { ...env, TORNEOS_PAYMENTS_INTERNAL_URL: 'http://pay.torneos-test.example.com/functions/v1/torneos-payments' }, ctx],
        ['payments on a Deno Deploy default domain not declared', { ...env, TORNEOS_PAYMENTS_INTERNAL_URL: 'https://torneos-payments.deno.dev/functions/v1/torneos-payments' }, ctx],
        ['gateway published on an undeclared host', env, { ...ctx, gatewayPublicUrl: 'https://torneos-gateway.deno.dev/functions/v1/torneos-gateway' }],
        ['http gateway', env, { ...ctx, gatewayPublicUrl: 'http://gw.torneos-test.example.com/functions/v1/torneos-gateway' }]]) {
        assert.throws(() => commerce.loadCommerceConfig(e, c, { mode: 'test', rpcs: ['get_effective_tournament_season_entitlements', 'get_tournament_purchase'] }),
          (error) => error?.constructor?.name === 'CommerceConfigError', label);
      }
    });

    // ================================================================ ISO Deno secret isolation contract (static)
    await check('ISO contract: two separate apps, APP-level variables only, no organization variables, no database integration, no frontend secrets; certification = CODE_READY (not REMOTE_PLATFORM_CERTIFIED)', async () => {
      const path = `${EVIDENCE}deno-deploy-isolation-contract.json`;
      assert.ok(existsSync(path), 'isolation contract present');
      const c = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(c.certification, 'CODE_READY');
      assert.equal(c.remotePlatformCertified, false);
      assert.ok(Array.isArray(c.pendingRemotePlatformChecks) && c.pendingRemotePlatformChecks.length >= 5);
      assert.deepEqual(Object.keys(c.apps).sort(), ['torneos-gateway', 'torneos-payments']);
      assert.notEqual(c.apps['torneos-gateway'].app, c.apps['torneos-payments'].app, 'two different Deno Deploy apps');
      assert.equal(c.variableScope, 'app');
      assert.deepEqual(c.organizationVariables, []);
      assert.equal(c.databaseIntegration, 'none');
      assert.deepEqual(c.frontendSecrets, []);
      assert.equal(c.supabaseEdgeFunctions, 'none');
      for (const [name, app] of Object.entries(c.apps)) {
        assert.ok(existsSync(`${repo}${app.entrypoint}`), `${name} entrypoint exists`);
        assert.equal(app.appRoot, 'backend/torneos/supabase/functions', `${name}: app root below the repo-root package.json`);
        assert.deepEqual(app.routes.map(r => r.split(' ')[0]).length > 0, true);
      }
      const gw = c.apps['torneos-gateway'], pay = c.apps['torneos-payments'];
      const gwSecrets = new Set(gw.secrets), paySecrets = new Set(pay.secrets);
      assert.deepEqual([...gwSecrets].filter(n => paySecrets.has(n)), ['TORNEOS_PAYMENTS_INTERNAL_SECRET'], 'only the gateway↔payments HMAC is shared');
      for (const n of ['MERCADO_PAGO_TEST_ACCESS_TOKEN', 'MERCADO_PAGO_TEST_WEBHOOK_SECRET', 'TORNEOS_PAYMENTS_DB_URL']) assert.ok(gw.forbidden.includes(n) && !gwSecrets.has(n), `gateway never holds ${n}`);
      for (const n of PAYMENTS_FORBIDDEN) assert.ok(pay.forbidden.includes(n), `payments contract forbids ${n}`);
      for (const n of ['TORNEOS_BRIDGE_KEYS', 'TORNEOS_CONTRACT_SERVICE_SECRET', 'TORNEOS_DB_IDENTITY_WRITER_URL', 'TORNEOS_DB_CORE_ADAPTER_URL']) assert.ok(!paySecrets.has(n) && gwSecrets.has(n), n);
      assert.deepEqual(pay.forbiddenDbLogins.filter(l => l.startsWith('torneos_edge_')).sort(), ['torneos_edge_core_adapter', 'torneos_edge_identity_writer']);
      evidence.isolation.contractSha256 = sha256(await readFile(path));
    });
    await check('ISO contract ↔ code: every variable each runtime reads is declared for that app; payments boot-refuses every variable its contract forbids; the gateway boot-refuses (remote-test) every payments secret', async () => {
      const c = JSON.parse(await readFile(`${EVIDENCE}deno-deploy-isolation-contract.json`, 'utf8'));
      const envReads = (text) => new Set([...text.matchAll(/(?:env\.|env\[\s*["']|\w+\(\s*(?:env|environment)\s*,\s*["']|\.get\(\s*["'])([A-Z][A-Z0-9_]+)/g)].map(m => m[1]));
      const readsOf = async (dir, extra = []) => {
        const reads = new Set();
        for (const f of [...(await readdir(dir)).filter(n => n.endsWith('.ts')).map(n => dir + n), ...extra]) for (const n of envReads(codeOf(await readFile(f, 'utf8')))) reads.add(n);
        return reads;
      };
      const gwReads = await readsOf(GW_DIR);
      const payReads = await readsOf(PAY_DIR, [`${FN_DIR}_shared/mercadoPagoPaymentProvider.ts`]);
      // PAYMENTS TEST: the payments app's declared set is the R3 contract plus the payments-test delta (configAdded).
      const delta = JSON.parse(await readFile(new URL('../../backend/torneos/infra/torneos-payments-test/pins/payments-test-isolation-delta.json', import.meta.url), 'utf8'));
      assert.equal(delta.extends.sha256, sha256(await readFile(`${EVIDENCE}deno-deploy-isolation-contract.json`)), 'the delta extends exactly the R3 contract');
      // PLAN READ (2026-10-01): the gateway's non-secret plan-read opt-in (torneos-gateway/plan-read.ts), default off.
      // SOCIAL-V1 (2026-10-03): the gateway's non-secret Estudio Social opt-in (torneos-gateway/social.ts), default off.
      // CONNECTED-V1 (2026-10-05): the non-secret Explorar/solicitudes opt-in (torneos-gateway/connected.ts), default off.
      // BRANDING-V1 (2026-10-06): the non-secret logos opt-in and, for the local lab only, its storage targets
      // (torneos-gateway/branding.ts; hosted derives storage from TORNEOS_REST_URL and refuses any other value).
      const planReadAdded = { 'torneos-gateway': ['TORNEOS_PLAN_READ_MODE', 'TORNEOS_SOCIAL_MODE', 'TORNEOS_CONNECTED_MODE',
        'TORNEOS_BRANDING_MODE', 'TORNEOS_STORAGE_URL', 'TORNEOS_STORAGE_PUBLIC_URL'] };
      const added = (app) => [...(delta.apps[app]?.configAdded ?? []), ...(planReadAdded[app] ?? [])];
      const declared = (app) => new Set([...c.apps[app].secrets, ...c.apps[app].config, ...added(app)]);
      for (const n of gwReads) assert.ok(declared('torneos-gateway').has(n), `gateway reads undeclared ${n}`);
      for (const n of payReads) assert.ok(declared('torneos-payments').has(n) || n === 'TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN', `payments reads undeclared ${n}`);
      for (const n of c.apps['torneos-payments'].forbidden) {
        const v = payVerdict({ ...PAY_ENV, [n]: 'fixture-value-not-a-secret' });
        assert.equal(v.ok, false, `payments boots with forbidden ${n}`);
      }
      const REMOTE = { TORNEOS_COMMERCE_MODE: 'test', TORNEOS_COMMERCE_DEPLOYMENT: 'remote-test', TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST: 'gw.torneos-test.example.com',
        TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: 'pay.torneos-test.example.com', TORNEOS_PAYMENTS_INTERNAL_URL: 'https://pay.torneos-test.example.com/functions/v1/torneos-payments',
        TORNEOS_PAYMENTS_INTERNAL_SECRET: sha256('r3-fixture') };
      const ctx = { baseAllowlist: new Set(), gatewayPublicUrl: 'https://gw.torneos-test.example.com/functions/v1/torneos-gateway', distinctFrom: [], dependencyUrls: ['https://core.torneos-test.example.com/auth/v1'] };
      const doc = { mode: 'test', rpcs: ['get_effective_tournament_season_entitlements', 'get_tournament_purchase'] };
      for (const n of c.apps['torneos-payments'].secrets.filter(x => x !== 'TORNEOS_PAYMENTS_INTERNAL_SECRET')) {
        assert.throws(() => commerce.loadCommerceConfig({ ...REMOTE, [n]: 'fixture-value-not-a-secret' }, ctx, doc), (e) => e?.constructor?.name === 'CommerceConfigError', `gateway boots with ${n}`);
      }
      evidence.isolation.gatewayReads = [...gwReads].sort();
      evidence.isolation.paymentsReads = [...payReads].sort();
    });
    await check('ISO frontend: 0 secrets — src/ names no gateway, payments, Core-private, Supabase-admin or Deno Deploy secret and exposes no REACT_APP_* secret', async () => {
      const files = [];
      async function walkDir(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) await walkDir(p); else if (/\.(jsx?|tsx?|mjs|json)$/.test(e.name)) files.push(p); } }
      await walkDir(`${repo}src`);
      assert.ok(files.length > 50);
      for (const f of files) {
        const text = await readFile(f, 'utf8');
        assert.ok(!/MERCADO_PAGO_(TEST_)?(ACCESS_TOKEN|WEBHOOK_SECRET)|TORNEOS_PAYMENTS_(INTERNAL_SECRET|DB_URL)|TORNEOS_BRIDGE_KEYS|TORNEOS_CONTRACT_SERVICE_SECRET|TORNEOS_DB_(IDENTITY_WRITER|CORE_ADAPTER)_URL|CORE_(SERVICE_ROLE_KEY|JWT_SECRET)|DENO_DEPLOY_TOKEN|torneos_edge_(identity_writer|core_adapter)|REACT_APP_[A-Z_]*(SECRET|ACCESS_TOKEN|PRIVATE|SERVICE_ROLE)/.test(text), f.slice(repo.length));
      }
      evidence.isolation.frontendFilesScanned = files.length;
      evidence.isolation.frontendSecrets = 0;
    });
  } finally {
    await mkdir(EVIDENCE, { recursive: true });
    const doc = { suite: 'MP-B1.1 R3 offline', results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, ...evidence };
    await writeFile(`${EVIDENCE}offline${TAG}.json`, JSON.stringify(doc, null, 2) + '\n');
  }
});
