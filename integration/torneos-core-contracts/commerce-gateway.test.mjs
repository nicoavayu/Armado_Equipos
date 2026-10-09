// MP-A4 — T6: gateway commerce (POST /commerce/v1/season-checkout + the commerce TEST read allowlist).
//
//   Part U (offline, every phase): the shared commerce module (torneos-gateway/commerce.ts), the ONE implementation
//     both gateways run. Config (T6-B), allowlist (T6-C), auth order with recording hooks (T6-D), response whitelist
//     (T6-E), error mapping (T6-G/H), body/HMAC/timeouts (T6-I), Node/Edge wiring, secret separation and scope guards.
//   Part OFF  (MP_A4_PHASE=off, default lab):  T6-A — commerce OFF is the certified gateway, on both gateways.
//   Part TEST (MP_A4_PHASE=test, TORNEOS_LAB_MODE=commerce lab): T6-B live fail-closed, T6-C 43+2, T6-D…T6-I and the
//     §17 journey, each on BOTH gateways (Node :58420, Edge :58421) with the same requests and the same verdicts.
//
// Local only: Core = lab GoTrue + contract, Torneos = lab DB 0000 → 0001 → 0002, payments = the MP-A3 function, Mercado
// Pago = the lab mp-stub. Results: backend/torneos/mp-a/evidence/mp-a4/t6-<phase>[-tag].json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, createHmac, randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const GW_DIR = `${repo}backend/torneos/supabase/functions/torneos-gateway/`;
const PAY_DIR = `${repo}backend/torneos/supabase/functions/torneos-payments/`;
const EVIDENCE = `${repo}backend/torneos/mp-a/evidence/mp-a4/`;
const BASE_COMMIT = '88cb6ab95e7b1a9bd5cd13e26904c5922395ad50';
const PHASE = process.env.MP_A4_PHASE ?? 'unit';
if (!['unit', 'off', 'test'].includes(PHASE)) throw new Error('MP_A4_PHASE must be unit | off | test');
const TAG = process.env.MP_A4_EVIDENCE_TAG ? `-${process.env.MP_A4_EVIDENCE_TAG}` : '';
const ROUTE = '/commerce/v1/season-checkout';
const INTERNAL_PATH = '/internal/v1/season-checkout-preference';
const CHECKOUT_RPC = 'create_tournament_season_checkout_purchase';
// COMMERCE-PRODUCTION (2026-10-07): + get_tournament_season_purchases, the read-only purchase list of the season (Mi plan).
const READ_RPCS = ['get_effective_tournament_season_entitlements', 'get_tournament_purchase', 'get_tournament_season_purchases'];
const STAGING_ALLOWLISTS = ['backend/torneos/phase2d/staging-v1-rpc-allowlist.json', 'backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json'];
const STAGING_ALLOWLIST_SHA = '149c7659f27aa6d61b512c44e1b0b0fa1bff700d4a0a3f9bdb4024418227b78c';
const MIGRATION_SHA = {
  '00000000000000_torneos_baseline_v1.sql': 'f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f',
  '00000000000001_staging_v1_rpc_exposure.sql': '3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62',
  '00000000000002_mercadopago_checkout_pro_test.sql': '06378f12b57620e8ae550a0d881ad66464ffdc0a734ad621cba8a6ba3e6d6078',
};
// Business refusals: permanent, never 503.
const BUSINESS = {
  TORNEOS_BILLING_FORBIDDEN: 403, TORNEOS_PURCHASE_FORBIDDEN: 403,
  TORNEOS_SEASON_ALREADY_PREMIUM: 409, TORNEOS_SEASON_PREMIUM_SUSPENDED: 409, TORNEOS_IDEMPOTENCY_CONFLICT: 409,
  TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT: 409, TORNEOS_CHECKOUT_EXPIRED: 409,
};
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const results = [];
const evidence = { phase: PHASE, parity: [], journey: [] };

// ======================================================================== Part U fixtures (offline)
const commerceMod = await import(`${GW_DIR}commerce.ts`).catch(() => null);
function mod() {
  if (!commerceMod) throw new assert.AssertionError({ message: 'torneos-gateway/commerce.ts is missing' });
  return commerceMod;
}
const stagingDoc = JSON.parse(await readFile(`${GW_DIR}staging-v1-rpc-allowlist.json`, 'utf8'));
const BASE43 = new Set(Object.values(stagingDoc.features).flat());
// Fixture values only: derived, never a lab or real secret.
const UNIT_SECRET = sha256('mp-a4-unit-internal-secret-fixture');
const UNIT_CONTRACT_SECRET = sha256('mp-a4-unit-contract-secret-fixture');
const UNIT_BRIDGE_DOC = JSON.stringify({ keys: [{ kid: 'unit', privateKey: '-----BEGIN PRIVATE KEY-----\nMIIunitbridgefixture\n-----END PRIVATE KEY-----' }], activeKid: 'unit' });
const UNIT_ENV = Object.freeze({
  TORNEOS_COMMERCE_MODE: 'test', TORNEOS_PAYMENTS_INTERNAL_URL: 'http://torneos-functions:9000/torneos-payments', TORNEOS_PAYMENTS_INTERNAL_SECRET: UNIT_SECRET,
});
const unitCtx = (over = {}) => ({ baseAllowlist: BASE43, gatewayPublicUrl: 'http://127.0.0.1:58421/torneos-gateway',
  distinctFrom: [UNIT_CONTRACT_SECRET, UNIT_BRIDGE_DOC, 'anon-key-fixture'], ...over });
const ORG = '10000000-0000-4000-8000-0000000000b1';
const SEASON = '20000000-0000-4000-8000-0000000000b1';
const KEY = '30000000-0000-4000-8000-0000000000b1';
const PID = '50000000-0000-4000-8000-0000000000b1';
const CLAIMS = { sub: '60000000-0000-4000-8000-0000000000b1', core_user_id: '70000000-0000-4000-8000-0000000000b1', session_id: '80000000-0000-4000-8000-0000000000b1' };
const PROJECTION_KEYS = ['schemaVersion', 'id', 'organizationId', 'seasonId', 'tournamentId', 'productCode', 'offerCode', 'offerVersion', 'listAmount', 'amount',
  'currency', 'provider', 'providerEnvironment', 'providerPreferenceId', 'externalReference', 'status', 'providerStatus', 'providerStatusDetail',
  'preferenceExpiresAt', 'approvedAt', 'entitlementActivatedAt', 'activationErrorCode', 'createdAt', 'updatedAt'];
const projection = (over = {}) => ({ schemaVersion: 3, id: PID, organizationId: ORG, seasonId: SEASON, tournamentId: null, productCode: 'torneos_premium',
  offerCode: 'premium_launch', offerVersion: 1, listAmount: 49900, amount: 39900, currency: 'ARS', provider: 'MERCADO_PAGO', providerEnvironment: 'test',
  providerPreferenceId: null, externalReference: `arma2:season:purchase:${PID}`, status: 'created', providerStatus: null, providerStatusDetail: null,
  preferenceExpiresAt: '2026-09-23T12:30:00.000Z', approvedAt: null, entitlementActivatedAt: null, activationErrorCode: null,
  createdAt: '2026-09-23T12:00:00.000Z', updatedAt: '2026-09-23T12:00:00.000Z', idempotentReplay: false, existingOpenPurchase: false, expiredStalePurchases: 0, ...over });
const PREF = { provider: 'MERCADO_PAGO', preferenceId: 'lab-pref-unit', checkoutUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=lab-pref-unit', expiresAt: '2026-09-23T12:30:00.000Z' };
const resp = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const REST_UNIT = 'http://torneos-rest.unit.invalid:3000';
const NOW = Date.parse('2026-09-23T12:00:05.000Z');
const validBody = (over = {}) => JSON.stringify({ organizationId: ORG, seasonId: SEASON, idempotencyKey: KEY, ...over });
function bodyOf(content) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { bytes, consumed: false, async *[Symbol.asyncIterator]() { this.consumed = true; yield bytes; } };
}
/** Recording hooks: the order of the gateway's own primitives and of every outbound call. */
function harness({ bridge = 'ok', session = 'ok', identity = true, rest, payments, timeouts, restApiKey = null } = {}) {
  const h = { calls: [], requests: [], logs: [] };
  const unavailable = () => Object.assign(new Error('dependency down'), { unitUnavailable: true });
  h.cfg = mod().loadCommerceConfig(UNIT_ENV, unitCtx());
  h.hooks = {
    verifyBridge: async (token) => { h.calls.push('bridge'); if (bridge !== 'ok' || token !== 'bridge-token-fixture') throw new Error('invalid token'); return CLAIMS; },
    activeSession: async (claims) => { h.calls.push('core'); assert.deepEqual(claims, CLAIMS);
      if (session === 'revoked') throw new Error('inactive session'); if (session === 'down') throw unavailable(); },
    identityExists: async (claims) => { h.calls.push('identity'); assert.deepEqual(claims, CLAIMS); if (identity === 'down') throw unavailable(); return identity; },
    isUnavailable: (error) => error?.unitUnavailable === true,
    restUrl: REST_UNIT, restApiKey,
    fetch: async (url, init) => {
      const kind = String(url).startsWith(`${REST_UNIT}/`) ? 'db' : 'payments';
      h.calls.push(kind); h.requests.push({ kind, url: String(url), init });
      const fn = kind === 'db' ? (rest ?? (() => resp(200, projection()))) : (payments ?? (() => resp(200, PREF)));
      return await fn(init, h);
    },
    now: () => NOW, log: (entry) => h.logs.push(entry),
    ...(timeouts ? { timeouts } : {}),
  };
  return h;
}
async function unitCall(h, { authorization = 'Bearer bridge-token-fixture', body = validBody(), search = '', contentLength } = {}) {
  const b = body === null ? null : bodyOf(body);
  const r = await mod().seasonCheckout({ authorization, search, contentLength: contentLength !== undefined ? contentLength : (b ? String(b.bytes.length) : null), body: b }, h.cfg, h.hooks);
  return { ...r, bodyConsumed: b?.consumed ?? false };
}
const hangUntilAbort = (init) => new Promise((_, reject) => {
  if (init.signal?.aborted) return reject(init.signal.reason);
  init.signal?.addEventListener('abort', () => reject(init.signal.reason));
});

// ======================================================================== the suite
test(`MP-A4 — T6 gateway commerce (${PHASE})`, async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 400) }); throw error; }
    });
  }
  try {
    // ==================================================================== U. T6-B config (shared loader)
    await check('U T6-B config: unset / blank TORNEOS_COMMERCE_MODE → commerce OFF, and OFF reads nothing else (stray payments variables are ignored, as today)', async () => {
      const { loadCommerceConfig } = mod();
      for (const env of [{}, { TORNEOS_COMMERCE_MODE: '' }, { TORNEOS_COMMERCE_MODE: '   ' },
        { TORNEOS_PAYMENTS_INTERNAL_URL: 'https://rcyuuoaqfwcembdajcss.supabase.co/functions/v1/torneos-payments', TORNEOS_PAYMENTS_INTERNAL_SECRET: 'short' }]) {
        assert.deepEqual(loadCommerceConfig(env, unitCtx()), { mode: 'off' }, JSON.stringify(Object.keys(env)));
      }
    });
    await check('U T6-B config: TORNEOS_COMMERCE_MODE=test with a lab internal URL and a strong distinct secret → commerce TEST (URL = the payments mount, 32-byte key, the 3 read RPCs)', async () => {
      const c = mod().loadCommerceConfig({ ...UNIT_ENV }, unitCtx());
      assert.equal(c.mode, 'test');
      assert.equal(c.paymentsUrl, 'http://torneos-functions:9000/torneos-payments');
      assert.ok(c.secret instanceof Uint8Array); assert.equal(Buffer.from(c.secret).toString('hex'), UNIT_SECRET);
      assert.deepEqual([...c.readRpcs].sort(), READ_RPCS);
      for (const url of ['http://localhost:9000/torneos-payments', 'http://127.0.0.1:9000/functions/v1/torneos-payments', 'http://torneos-functions:9000/torneos-payments/']) {
        assert.equal(mod().loadCommerceConfig({ ...UNIT_ENV, TORNEOS_PAYMENTS_INTERNAL_URL: url }, unitCtx()).mode, 'test', url);
      }
    });
    const expectReject = (env, label, ctx = unitCtx()) => {
      const { loadCommerceConfig, CommerceConfigError } = mod();
      let caught = null;
      try { loadCommerceConfig(env, ctx); } catch (error) { caught = error; }
      assert.ok(caught instanceof CommerceConfigError, `${label}: fail closed with CommerceConfigError (got ${caught ? caught.constructor.name : 'a config'})`);
      for (const value of Object.values(env)) if (typeof value === 'string' && value.length >= 8) assert.ok(!caught.message.includes(value), `${label}: the error names no value`);
    };
    await check('U T6-B config: live / prod / any value other than exactly "test" or "production" → fail closed; "production" with this TEST lab configuration → fail closed', async () => {
      for (const v of ['live', 'prod', 'PRODUCTION', 'Production', 'LIVE', 'Test', 'TEST', 'sandbox', 'qa', 'off', 'on', 'true', '1', 'test,live']) expectReject({ ...UNIT_ENV, TORNEOS_COMMERCE_MODE: v }, v);
      // COMMERCE-PRODUCTION: production is its own mode. Without its hosted configuration it defaults to hosted and refuses;
      // in local-lab it still refuses the TEST payments mount. (The mode name itself may appear in the error: it is not a secret.)
      for (const extra of [{}, { TORNEOS_COMMERCE_DEPLOYMENT: 'local-lab' }]) {
        const { TORNEOS_COMMERCE_MODE: _mode, ...rest } = { ...UNIT_ENV, ...extra };
        const env = { ...rest, TORNEOS_COMMERCE_MODE: 'production' };
        const { loadCommerceConfig, CommerceConfigError } = mod();
        let caught = null;
        try { loadCommerceConfig(env, unitCtx()); } catch (error) { caught = error; }
        assert.ok(caught instanceof CommerceConfigError, `production ${JSON.stringify(extra)}: fail closed`);
        for (const value of Object.values(rest)) if (typeof value === 'string' && value.length >= 8) assert.ok(!caught.message.includes(value), 'the error names no value');
      }
    });
    await check('U T6-B config: missing / blank URL or secret → fail closed', async () => {
      for (const name of ['TORNEOS_PAYMENTS_INTERNAL_URL', 'TORNEOS_PAYMENTS_INTERNAL_SECRET']) {
        for (const v of [undefined, '', '   ']) expectReject({ ...UNIT_ENV, [name]: v }, `${name}=${JSON.stringify(v)}`);
      }
    });
    await check('U T6-B config: weak secret (short, non-hex, uppercase, odd length, degenerate, low entropy) → fail closed', async () => {
      for (const v of ['ab'.repeat(31), 'zz'.repeat(32), UNIT_SECRET.toUpperCase(), `${UNIT_SECRET}a`, '00'.repeat(32), 'aa'.repeat(40), '0123456789abcdef'.repeat(4)]) {
        expectReject({ ...UNIT_ENV, TORNEOS_PAYMENTS_INTERNAL_SECRET: v }, `secret ${v.slice(0, 6)}…(${v.length})`);
      }
    });
    await check('U T6-B config: the internal secret must differ from the Core contract secret, the bridge signing keys and the public keys', async () => {
      expectReject({ ...UNIT_ENV, TORNEOS_PAYMENTS_INTERNAL_SECRET: UNIT_CONTRACT_SECRET }, 'contract secret reuse');
      expectReject({ ...UNIT_ENV }, 'secret inside the bridge key document', unitCtx({ distinctFrom: [UNIT_CONTRACT_SECRET, `{"keys":[{"privateKey":"${UNIT_SECRET}"}]}`] }));
      expectReject({ ...UNIT_ENV }, 'secret equal to a public key value', unitCtx({ distinctFrom: [UNIT_SECRET.toUpperCase()] }));
    });
    await check('U T6-B config: internal URL outside the lab (Production ref, Staging, any https or public host), wrong mount, query, credentials → fail closed', async () => {
      for (const v of ['https://rcyuuoaqfwcembdajcss.supabase.co/functions/v1/torneos-payments', 'http://rcyuuoaqfwcembdajcss.torneos-functions:9000/torneos-payments',
        'https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-payments', 'https://torneos-functions:9000/torneos-payments',
        'http://evil.invalid:9000/torneos-payments', 'http://mp-stub:8080/torneos-payments', 'http://torneos-functions:9000/torneos-gateway',
        'http://torneos-functions:9000/torneos-payments/internal/v1/season-checkout-preference', 'http://torneos-functions:9000/torneos-payments?x=1',
        'http://torneos-functions:9000/torneos-payments#x', 'http://user:pw@torneos-functions:9000/torneos-payments', 'ftp://torneos-functions/torneos-payments', 'not a url']) {
        expectReject({ ...UNIT_ENV, TORNEOS_PAYMENTS_INTERNAL_URL: v }, v);
      }
    });
    await check('U T6-B config: commerce TEST is lab-only — a gateway published outside loopback (hosted Staging / Production) refuses it', async () => {
      for (const url of ['https://hhyvmhgpapyuzjgxfnqv.supabase.co/functions/v1/torneos-gateway', 'https://rcyuuoaqfwcembdajcss.supabase.co/functions/v1/torneos-gateway', 'https://gateway.example/torneos-gateway']) {
        expectReject({ ...UNIT_ENV }, url, unitCtx({ gatewayPublicUrl: url }));
      }
    });
    await check('U T6-B config: in TEST the gateway refuses to boot with Mercado Pago credentials or the payment-service DB login in its environment', async () => {
      for (const name of ['MERCADO_PAGO_TEST_ACCESS_TOKEN', 'MERCADO_PAGO_TEST_WEBHOOK_SECRET', 'MERCADO_PAGO_TEST_SELLER_ID', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_ENVIRONMENT',
        'TORNEOS_PAYMENTS_DB_URL', 'TORNEOS_PAYMENTS_DB_SSL_CA', 'TORNEOS_PAYMENT_PROVIDER', 'TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN', 'TORNEOS_PAYMENTS_NOTIFICATION_URL']) {
        expectReject({ ...UNIT_ENV, [name]: 'fixture-value-not-a-secret' }, name);
      }
    });

    // ==================================================================== U. T6-C allowlist
    await check('U T6-C allowlist: staging-v1 copies byte-identical (sha 149c7659), 43 names; commerce file exactly the 3 reads; intersection 0; the creation RPC in neither', async () => {
      for (const f of STAGING_ALLOWLISTS) assert.equal(sha256(await readFile(`${repo}${f}`, 'utf8')), STAGING_ALLOWLIST_SHA, f);
      assert.equal(BASE43.size, 43); assert.equal(Object.values(stagingDoc.features).flat().length, 43);
      const doc = JSON.parse(await readFile(`${GW_DIR}commerce-test-rpc-allowlist.json`, 'utf8'));
      assert.deepEqual([...doc.rpcs].sort(), READ_RPCS); assert.equal(doc.rpcs.length, 3); assert.equal(doc.mode, 'test');
      assert.deepEqual(doc.rpcs.filter(n => BASE43.has(n)), []);
      assert.ok(!BASE43.has(CHECKOUT_RPC) && !doc.rpcs.includes(CHECKOUT_RPC));
      assert.deepEqual([...mod().validateCommerceAllowlist(doc, BASE43)].sort(), READ_RPCS);
    });
    await check('U T6-C allowlist: OFF → exactly the 43 (the same set); TEST → 43 + 3 = 46; the creation RPC never in the generic proxy set', async () => {
      const { effectiveRpcAllowlist, loadCommerceConfig } = mod();
      const off = effectiveRpcAllowlist(BASE43, { mode: 'off' });
      assert.equal(off.size, 43); assert.deepEqual([...off].sort(), [...BASE43].sort());
      const on = effectiveRpcAllowlist(BASE43, loadCommerceConfig({ ...UNIT_ENV }, unitCtx()));
      assert.equal(on.size, 46); assert.deepEqual([...on].filter(n => !BASE43.has(n)).sort(), READ_RPCS);
      assert.ok(!on.has(CHECKOUT_RPC) && !off.has(CHECKOUT_RPC));
      assert.equal(BASE43.size, 43, 'the base set is never mutated');
    });
    await check('U T6-C allowlist: boot refuses a commerce list with an extra name, a duplicate of the 43, a write, a missing read, a repeated entry, a non-test mode or a bad shape', async () => {
      const { validateCommerceAllowlist, CommerceConfigError } = mod();
      const bad = {
        extra: { mode: 'test', rpcs: [...READ_RPCS, 'get_tournament_public_catalog'] },
        duplicate_of_43: { mode: 'test', rpcs: [...READ_RPCS, 'has_tournament_capability'] },
        write_checkout: { mode: 'test', rpcs: [...READ_RPCS, CHECKOUT_RPC] },
        write_cancel: { mode: 'test', rpcs: ['get_tournament_purchase', 'cancel_tournament_purchase'] },
        missing: { mode: 'test', rpcs: ['get_tournament_purchase'] },
        repeated: { mode: 'test', rpcs: ['get_tournament_purchase', 'get_tournament_purchase', 'get_effective_tournament_season_entitlements'] },
        mode_live: { mode: 'live', rpcs: [...READ_RPCS] },
        not_array: { mode: 'test', rpcs: 'get_tournament_purchase' },
        bad_name: { mode: 'test', rpcs: ['get_tournament_purchase', 'get_effective_tournament_season_entitlements; drop'] },
        empty: {},
      };
      for (const [label, doc] of Object.entries(bad)) assert.throws(() => validateCommerceAllowlist(doc, BASE43), (e) => e instanceof CommerceConfigError, label);
      assert.throws(() => mod().loadCommerceConfig({ ...UNIT_ENV }, unitCtx(), bad.extra), (e) => e instanceof CommerceConfigError, 'loader applies the validation');
    });

    // ==================================================================== U. T6-D auth order
    await check('U T6-D order: no bearer / non-Bearer → 401 before anything (0 calls, body unread)', async () => {
      for (const authorization of [null, '', 'Basic abc', 'bearer bridge-token-fixture', `Bearer ${'x'.repeat(12001)}`]) {
        const h = harness();
        const r = await unitCall(h, { authorization });
        assert.deepEqual([r.status, r.body], [401, { error: 'access denied' }], String(authorization).slice(0, 20));
        assert.deepEqual(h.calls, []); assert.equal(r.bodyConsumed, false);
      }
    });
    await check('U T6-D order: invalid bridge → 401 after verifyBridge only; revoked Core session → 401 after core; Core down → 503 CORE_UNAVAILABLE; 0 DB, 0 payments, body unread', async () => {
      for (const [opts, expected, calls] of [
        [{ bridge: 'bad' }, [401, 'access denied'], ['bridge']],
        [{ session: 'revoked' }, [401, 'access denied'], ['bridge', 'core']],
        [{ session: 'down' }, [503, 'CORE_UNAVAILABLE'], ['bridge', 'core']],
      ]) {
        const h = harness(opts);
        const r = await unitCall(h);
        assert.deepEqual([r.status, r.body?.error], expected, JSON.stringify(opts));
        assert.deepEqual(h.calls, calls); assert.equal(r.bodyConsumed, false);
      }
    });
    await check('U T6-D order: unknown identity → 401 (identity checked after Core, before the body); Torneos identity store down → 503 TORNEOS_UNAVAILABLE', async () => {
      const h = harness({ identity: false });
      const r = await unitCall(h);
      assert.deepEqual([r.status, r.body], [401, { error: 'access denied' }]); assert.deepEqual(h.calls, ['bridge', 'core', 'identity']); assert.equal(r.bodyConsumed, false);
      const d = harness({ identity: 'down' });
      const rd = await unitCall(d);
      assert.deepEqual([rd.status, rd.body], [503, { error: 'TORNEOS_UNAVAILABLE' }]); assert.deepEqual(d.calls, ['bridge', 'core', 'identity']);
    });
    await check('U T6-D order: invalid body with a bad bearer / revoked session is still 401 (auth first); invalid body with valid auth → 400 after identity, 0 DB', async () => {
      for (const opts of [{ bridge: 'bad' }, { session: 'revoked' }]) {
        const h = harness(opts);
        const r = await unitCall(h, { body: '{"amount":1}' });
        assert.equal(r.status, 401);
      }
      const h = harness();
      const r = await unitCall(h, { body: '{"amount":1}' });
      assert.deepEqual([r.status, r.body], [400, { error: 'TORNEOS_CHECKOUT_INVALID' }]); assert.deepEqual(h.calls, ['bridge', 'core', 'identity']);
    });
    await check('U T6-D order: DB authorization refusal (no billing.manage) → 403, payments never called; happy path order = bridge → core → identity → DB → payments', async () => {
      const f = harness({ rest: () => resp(403, { code: '42501', details: null, hint: null, message: 'TORNEOS_BILLING_FORBIDDEN' }) });
      const rf = await unitCall(f);
      assert.deepEqual([rf.status, rf.body], [403, { error: 'TORNEOS_BILLING_FORBIDDEN' }]); assert.deepEqual(f.calls, ['bridge', 'core', 'identity', 'db']);
      const h = harness();
      const r = await unitCall(h);
      assert.equal(r.status, 200); assert.deepEqual(h.calls, ['bridge', 'core', 'identity', 'db', 'payments']);
    });

    // ==================================================================== U. T6-E response / DB call shape
    await check('U T6-E DB call: POST <rest>/rpc/create_tournament_season_checkout_purchase with the USER bearer and exactly {p_organization_id, p_season_id, p_idempotency_key}; no service credential; redirects refused', async () => {
      const h = harness({ restApiKey: 'torneos-anon-fixture' });
      await unitCall(h, { body: JSON.stringify({ organizationId: ORG.toUpperCase(), seasonId: SEASON, idempotencyKey: KEY }) });
      const db = h.requests.find(r => r.kind === 'db');
      assert.equal(db.url, `${REST_UNIT}/rpc/${CHECKOUT_RPC}`); assert.equal(db.init.method, 'POST'); assert.equal(db.init.redirect, 'error');
      const headers = new Headers(db.init.headers);
      assert.equal(headers.get('authorization'), 'Bearer bridge-token-fixture'); assert.equal(headers.get('apikey'), 'torneos-anon-fixture');
      assert.deepEqual(JSON.parse(db.init.body), { p_organization_id: ORG, p_season_id: SEASON, p_idempotency_key: KEY });
      assert.ok(![...headers.keys()].some(k => /service|x-signature|x-nonce|x-time/.test(k)));
    });
    await check('U T6-E response: exactly {purchase, preference}; purchase = the whitelisted projection (+ idempotentReplay/existingOpenPurchase); preference = exactly provider/preferenceId/checkoutUrl/expiresAt; provider extras never pass', async () => {
      const h = harness({ rest: () => resp(200, projection({ buyerUserId: CLAIMS.sub, internalNote: 'x', token: 'secret-fixture' })),
        payments: () => resp(200, { ...PREF, raw: { payer: { email: 'lab-payer-1@payer.invalid' } }, accessToken: 'TEST-fixture' }) });
      const r = await unitCall(h);
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.body).sort(), ['preference', 'purchase']);
      assert.deepEqual(Object.keys(r.body.purchase).sort(), [...PROJECTION_KEYS, 'existingOpenPurchase', 'idempotentReplay'].sort());
      assert.deepEqual(r.body.preference, PREF);
      assert.ok(!JSON.stringify(r.body).includes('payer') && !JSON.stringify(r.body).includes('TEST-fixture') && !JSON.stringify(r.body).includes('secret-fixture'));
    });
    await check('U T6-E status routing: created / preference_created → payments; pending / approved / cancelled / refunded / charged_back → preference null (0 payments); expired → 409 TORNEOS_CHECKOUT_EXPIRED (0 payments)', async () => {
      for (const status of ['created', 'preference_created']) {
        const h = harness({ rest: () => resp(200, projection({ status })) });
        const r = await unitCall(h);
        assert.equal(r.status, 200, status); assert.equal(h.calls.at(-1), 'payments'); assert.deepEqual(r.body.preference, PREF);
      }
      for (const status of ['pending', 'approved', 'cancelled', 'rejected', 'refunded', 'charged_back']) {
        const h = harness({ rest: () => resp(200, projection({ status, idempotentReplay: true })) });
        const r = await unitCall(h);
        assert.deepEqual([status, r.status, r.body?.preference], [status, 200, null]); assert.ok(!h.calls.includes('payments'), status);
      }
      const e = harness({ rest: () => resp(200, projection({ status: 'expired', idempotentReplay: true })) });
      const re = await unitCall(e);
      assert.deepEqual([re.status, re.body], [409, { error: 'TORNEOS_CHECKOUT_EXPIRED' }]); assert.ok(!e.calls.includes('payments'));
    });

    // ==================================================================== U. T6-G / T6-H error mapping
    await check('U T6-G mapping: DB business refusals keep their code (403 / 409), whatever PostgREST status they arrive with — never 503', async () => {
      const cases = [
        [403, '42501', 'TORNEOS_BILLING_FORBIDDEN'], [403, '42501', 'TORNEOS_PURCHASE_FORBIDDEN'],
        [500, '55000', 'TORNEOS_SEASON_ALREADY_PREMIUM'], [500, '55000', 'TORNEOS_SEASON_PREMIUM_SUSPENDED'],
        [400, '22023', 'TORNEOS_IDEMPOTENCY_CONFLICT'], [500, '55000', 'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT'],
        [400, '22023', 'TORNEOS_PRODUCT_UNAVAILABLE', 409], [400, '22023', 'TORNEOS_OFFER_UNAVAILABLE', 409],
      ];
      for (const [restStatus, code, message, expected = BUSINESS[message]] of cases) {
        const h = harness({ rest: () => resp(restStatus, { code, details: null, hint: null, message }) });
        const r = await unitCall(h);
        assert.deepEqual([message, r.status, r.body], [message, expected, { error: message }]); assert.ok(!h.calls.includes('payments'), message);
      }
      for (const [code, status] of Object.entries(BUSINESS)) assert.notEqual(status, 503, code);
    });
    await check('U T6-G mapping: DB auth / input refusals — TORNEOS_AUTH_REQUIRED or a PostgREST JWT refusal → 401 (one re-exchange); TORNEOS_PURCHASE_INVALID → 400; unknown 4xx / malformed 200 → 502 TORNEOS_CHECKOUT_FAILED', async () => {
      for (const [rest, expected] of [
        [() => resp(401, { code: '42501', message: 'TORNEOS_AUTH_REQUIRED' }), [401, 'access denied']],
        [() => resp(401, { code: 'PGRST303', message: 'JWT not yet valid' }), [401, 'access denied']],
        [() => resp(400, { code: '22023', message: 'TORNEOS_PURCHASE_INVALID' }), [400, 'TORNEOS_CHECKOUT_INVALID']],
        [() => resp(400, { code: '22P02', message: 'invalid input syntax' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(404, { code: 'PGRST202', message: 'Could not find the function' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(200, '[]'), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(200, { status: 'created' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(200, projection({ provider: 'FAKE', providerEnvironment: 'local' })), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(200, 'not json'), [502, 'TORNEOS_CHECKOUT_FAILED']],
      ]) {
        const h = harness({ rest });
        const r = await unitCall(h);
        assert.deepEqual([r.status, r.body?.error], expected); assert.ok(!h.calls.includes('payments'));
      }
    });
    await check('U T6-H mapping: Torneos REST down / 5xx without a business code / timeout (4 s) → 503 TORNEOS_UNAVAILABLE; no retry (one DB call), no payments', async () => {
      for (const rest of [() => { throw new TypeError('fetch failed'); }, () => resp(503, { code: 'PGRST001', message: 'Database client error' }),
        () => resp(500, { code: '57014', message: 'canceling statement due to statement timeout' }), () => resp(502, '<html>bad gateway</html>'), hangUntilAbort]) {
        const h = harness({ rest, timeouts: { restMs: 40, paymentsMs: 40 } });
        const r = await unitCall(h);
        assert.deepEqual([r.status, r.body], [503, { error: 'TORNEOS_UNAVAILABLE' }]);
        assert.equal(h.calls.filter(c => c === 'db').length, 1); assert.ok(!h.calls.includes('payments'));
      }
    });
    await check('U T6-H mapping: payments 503 / down / timeout (8 s) → 503 TORNEOS_PAYMENTS_UNAVAILABLE; 409 preference_expired → 409 TORNEOS_CHECKOUT_EXPIRED; not payable / conflict → 409; contract faults → 502; exactly one payments call (no retry)', async () => {
      for (const [payments, expected] of [
        [() => resp(503, { error: 'provider_unavailable' }), [503, 'TORNEOS_PAYMENTS_UNAVAILABLE']],
        [() => resp(503, { error: 'service_unavailable' }), [503, 'TORNEOS_PAYMENTS_UNAVAILABLE']],
        [() => { throw new TypeError('fetch failed'); }, [503, 'TORNEOS_PAYMENTS_UNAVAILABLE']],
        [hangUntilAbort, [503, 'TORNEOS_PAYMENTS_UNAVAILABLE']],
        [() => resp(409, { error: 'preference_expired' }), [409, 'TORNEOS_CHECKOUT_EXPIRED']],
        [() => resp(409, { error: 'purchase_not_payable' }), [409, 'TORNEOS_PURCHASE_NOT_PAYABLE']],
        [() => resp(409, { error: 'preference_conflict' }), [409, 'TORNEOS_PREFERENCE_CONFLICT']],
        [() => resp(401, { error: 'unauthorized' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(422, { error: 'purchase_invalid' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(502, { error: 'provider_response_invalid' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(404, { error: 'not_found' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(200, { ...PREF, checkoutUrl: 'http://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(200, { ...PREF, provider: 'FAKE' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(200, { ...PREF, preferenceId: '' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
        [() => resp(200, { ...PREF, expiresAt: 'soon' }), [502, 'TORNEOS_CHECKOUT_FAILED']],
      ]) {
        const h = harness({ payments, timeouts: { restMs: 40, paymentsMs: 40 } });
        const r = await unitCall(h);
        assert.deepEqual([r.status, r.body?.error], expected, JSON.stringify(expected));
        assert.equal(h.calls.filter(c => c === 'payments').length, 1, 'no automatic retry');
      }
    });
    await check('U T6-H timeouts: defaults are Torneos REST 4000 ms and payments 8000 ms, applied as abort signals on exactly those calls', async () => {
      assert.deepEqual(mod().COMMERCE_TIMEOUTS, { restMs: 4000, paymentsMs: 8000 });
      const original = AbortSignal.timeout;
      const seen = [];
      AbortSignal.timeout = (ms) => { seen.push(ms); return original.call(AbortSignal, ms); };
      try {
        const h = harness();
        assert.equal((await unitCall(h)).status, 200);
        assert.deepEqual(seen, [4000, 8000]);
        for (const r of h.requests) assert.ok(r.init.signal instanceof AbortSignal, r.kind);
      } finally { AbortSignal.timeout = original; }
    });

    // ==================================================================== U. T6-I body / HMAC / logs
    await check('U T6-I body: exactly {organizationId, seasonId, idempotencyKey} as UUID strings; extras (price, amount, provider, environment, product, URLs), missing, non-UUID, non-object, non-JSON, invalid UTF-8, query → 400; > 1 KiB → 413; 1 KiB exactly accepted', async () => {
      const bad = [
        validBody({ amount: 39900 }), validBody({ price: 1 }), validBody({ currency: 'ARS' }), validBody({ provider: 'MERCADO_PAGO' }), validBody({ environment: 'test' }),
        validBody({ product: 'torneos_premium' }), validBody({ productCode: 'torneos_premium' }), validBody({ returnUrl: 'https://x.invalid' }), validBody({ back_urls: {} }),
        validBody({ webhookUrl: 'https://x.invalid' }), validBody({ notificationUrl: 'https://x.invalid' }), validBody({ paymentsUrl: 'http://evil.invalid' }), validBody({ purchase_id: PID }),
        JSON.stringify({ organizationId: ORG, seasonId: SEASON }), validBody({ seasonId: 'not-a-uuid' }), validBody({ idempotencyKey: 12345 }), validBody({ organizationId: null }),
        '[]', 'null', '"x"', '{', '', new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
      ];
      for (const body of bad) {
        const h = harness();
        const r = await unitCall(h, { body });
        assert.deepEqual([r.status, r.body], [400, { error: 'TORNEOS_CHECKOUT_INVALID' }], String(body).slice(0, 60)); assert.ok(!h.calls.includes('db'));
      }
      const q = harness();
      assert.equal((await unitCall(q, { search: '?amount=1' })).status, 400); assert.ok(!q.calls.includes('db'));
      const padded = `${validBody().slice(0, -1)}${' '.repeat(1024 - validBody().length)}}`;
      assert.equal(Buffer.byteLength(padded), 1024);
      const ok = harness();
      assert.equal((await unitCall(ok, { body: padded })).status, 200, '1024 bytes accepted');
      for (const [body, contentLength] of [[`${padded} `, undefined], [padded, '1025'], [`${padded} `, null]]) {
        const h = harness();
        const r = await unitCall(h, { body, contentLength });
        assert.deepEqual([r.status, r.body], [413, { error: 'TORNEOS_CHECKOUT_TOO_LARGE' }], String(contentLength)); assert.ok(!h.calls.includes('db'));
      }
    });
    await check('U T6-I HMAC: one POST to <internal url>/internal/v1/season-checkout-preference, body exactly {"purchase_id"}, X-Time/X-Nonce/X-Signature over path\\ntime\\nnonce\\nbody accepted by the MP-A3 verifier; no Authorization/Origin; fresh nonce per call; redirects refused', async () => {
      const { verifyInternalRequest, NonceCache } = await import(`${PAY_DIR}hmac.ts`);
      const nonces = new NonceCache();
      const seen = new Set();
      for (let i = 0; i < 3; i += 1) {
        const h = harness();
        assert.equal((await unitCall(h)).status, 200);
        const p = h.requests.find(r => r.kind === 'payments');
        assert.equal(p.url, `http://torneos-functions:9000/torneos-payments${INTERNAL_PATH}`); assert.equal(p.init.method, 'POST'); assert.equal(p.init.redirect, 'error');
        assert.equal(p.init.body, JSON.stringify({ purchase_id: PID }));
        const headers = new Headers(p.init.headers);
        assert.ok(!headers.has('authorization') && !headers.has('origin') && !headers.has('cookie'));
        const [time, nonce, signature] = ['x-time', 'x-nonce', 'x-signature'].map(n => headers.get(n));
        assert.equal(time, String(Math.floor(NOW / 1000)));
        assert.equal(signature, createHmac('sha256', Buffer.from(UNIT_SECRET, 'hex')).update(`${INTERNAL_PATH}\n${time}\n${nonce}\n${p.init.body}`).digest('hex'));
        assert.equal(await verifyInternalRequest({ secret: Buffer.from(UNIT_SECRET, 'hex'), path: INTERNAL_PATH, time, nonce, signature, body: p.init.body, nowS: Math.floor(NOW / 1000), nonces }), 'ok');
        assert.ok(!seen.has(nonce), 'nonce is never reused'); seen.add(nonce);
      }
      const { INTERNAL_PATH: paymentsPath } = await import(`${PAY_DIR}config.ts`);
      assert.equal(mod().PAYMENTS_INTERNAL_PATH, paymentsPath, 'the gateway targets the MP-A3 route constant');
    });
    await check('U T6-I logs: one line per request with only request id, purchase id, result code, status and timing — never bearer, body, HMAC, secret or checkout URL', async () => {
      const h = harness();
      await unitCall(h);
      const f = harness({ bridge: 'bad' });
      await unitCall(f);
      for (const log of [...h.logs, ...f.logs]) {
        assert.deepEqual(Object.keys(log).sort(), ['code', 'fn', 'ms', 'purchaseId', 'rid', 'route', 'status']);
        const text = JSON.stringify(log);
        for (const secret of ['bridge-token-fixture', UNIT_SECRET, PREF.checkoutUrl, 'pref_id', ORG, KEY]) assert.ok(!text.includes(secret), `log leaks ${secret.slice(0, 12)}`);
      }
      assert.equal(h.logs.length, 1); assert.equal(h.logs[0].purchaseId, PID); assert.equal(f.logs[0].purchaseId, null);
    });

    // ==================================================================== U. wiring, parity, separation, scope
    const sources = {
      edgeIndex: await readFile(`${GW_DIR}index.ts`, 'utf8'), edgeConfig: await readFile(`${GW_DIR}config.ts`, 'utf8'),
      commerce: await readFile(`${GW_DIR}commerce.ts`, 'utf8').catch(() => ''), node: await readFile(`${here}gateway.mjs`, 'utf8'),
    };
    await check('U parity wiring: Edge index.ts and Node gateway.mjs both run the SAME commerce module (loadCommerceConfig, effectiveRpcAllowlist, seasonCheckout); only it knows the payments route and the HMAC', async () => {
      assert.match(sources.edgeIndex, /from "\.\/commerce\.ts"/);
      assert.match(sources.node, /import\(['"]\.\/functions\/torneos-gateway\/commerce\.ts['"]\)/);
      for (const fn of ['loadCommerceConfig(', 'effectiveRpcAllowlist(']) {
        assert.ok(sources.edgeIndex.includes(fn), `index.ts calls ${fn}`); assert.ok(sources.node.includes(fn), `gateway.mjs calls ${fn}`);
      }
      // COMMERCE-PRODUCTION: both dispatch the checkout and (production only) the purchase refresh to the same module.
      for (const fn of ['seasonCheckout', 'purchaseRefresh']) {
        assert.ok(sources.edgeIndex.includes(fn), `index.ts dispatches ${fn}`); assert.ok(sources.node.includes(`commerceModule.${fn}`), `gateway.mjs dispatches ${fn}`);
      }
      for (const [label, text] of [['index.ts', sources.edgeIndex], ['gateway.mjs', sources.node]]) {
        assert.ok(!/season-checkout-preference|x-signature|createHmac|TORNEOS_PAYMENTS_INTERNAL_SECRET/.test(text), `${label} carries no own payments/HMAC code`);
        assert.ok(!text.includes(CHECKOUT_RPC), `${label} never names the creation RPC (only commerce.ts does)`);
      }
      assert.match(sources.commerce, /from "\.\.\/torneos-payments\/hmac\.ts"/, 'the MP-A3 signer is reused, not re-implemented');
      assert.ok(!/npm:|jsr:|https:\/\/|mercadoPagoPaymentProvider|torneos-payments\/config/.test(sources.commerce.split('\n').filter(l => /^\s*import\b/.test(l)).join('\n')), 'commerce.ts imports nothing else remote');
    });
    await check('U separation: gateway sources never read Mercado Pago credentials or the payment-service DB login (only commerce.ts names them, in its refusal list)', async () => {
      const deny = /const FORBIDDEN_GATEWAY_ENV[\s\S]*?\]\)?/;
      for (const [label, text] of Object.entries(sources)) {
        const code = text.replace(deny, '').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/MERCADO_PAGO_|TORNEOS_PAYMENTS_DB_|lab_payment_service|torneos_payment_service|TORNEOS_PAYMENT_PROVIDER/.test(code), label);
      }
      assert.match(sources.commerce, /const FORBIDDEN_GATEWAY_ENV/);
    });
    await check('U separation (edge-main env): OFF → the gateway worker gets no payments variable (MP-A3 isolation intact); TEST → exactly TORNEOS_PAYMENTS_INTERNAL_URL + _SECRET more; payments worker never gets Core/bridge/gateway-DB/commerce-mode values', async () => {
      const { workerEnv } = await import(`${here}torneos-edge-main/env.ts`);
      const gatewayVars = { TORNEOS_GATEWAY_PUBLIC_URL: 'x', TORNEOS_ALLOWED_ORIGIN: 'x', CORE_AUTH_URL: 'x', CORE_JWT_ISSUER: 'x', CORE_ANON_KEY: 'x', CORE_CONTRACT_URL: 'x',
        TORNEOS_CONTRACT_SERVICE_SECRET: 'x', TORNEOS_REST_URL: 'x', TORNEOS_ANON_KEY: 'x', TORNEOS_DB_IDENTITY_WRITER_URL: 'x', TORNEOS_DB_CORE_ADAPTER_URL: 'x', TORNEOS_BRIDGE_KEYS: 'x' };
      const paymentsVars = { TORNEOS_PAYMENT_PROVIDER: 'x', MERCADO_PAGO_ENVIRONMENT: 'x', MERCADO_PAGO_TEST_ACCESS_TOKEN: 'x', MERCADO_PAGO_TEST_WEBHOOK_SECRET: 'x',
        MERCADO_PAGO_TEST_SELLER_ID: 'x', APP_PUBLIC_URL: 'x', TORNEOS_PAYMENTS_NOTIFICATION_URL: 'x', TORNEOS_PAYMENTS_INTERNAL_SECRET: 'x', TORNEOS_PAYMENTS_DB_URL: 'x',
        TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: 'x' };
      const off = { ...gatewayVars, ...paymentsVars, SUPABASE_SERVICE_ROLE_KEY: 'x', PATH: '/bin' };
      const on = { ...off, TORNEOS_COMMERCE_MODE: 'test', TORNEOS_PAYMENTS_INTERNAL_URL: 'x' };
      const gwOff = workerEnv('torneos-gateway', off).map(([k]) => k).sort();
      const gwOn = workerEnv('torneos-gateway', on).map(([k]) => k).sort();
      assert.deepEqual(gwOff, Object.keys(gatewayVars).sort());
      assert.deepEqual(gwOn, [...Object.keys(gatewayVars), 'TORNEOS_COMMERCE_MODE', 'TORNEOS_PAYMENTS_INTERNAL_SECRET', 'TORNEOS_PAYMENTS_INTERNAL_URL'].sort());
      const payOn = workerEnv('torneos-payments', on).map(([k]) => k).sort();
      assert.deepEqual(payOn, Object.keys(paymentsVars).sort(), 'payments env unchanged by commerce mode');
    });
    await check('U scope: MP-A3 payments service + provider copies and 0000/0001/0002 byte-identical to the base; config.toml, Core contract and frontend untouched; only MP-A4 paths changed', async () => {
      const changed = [...git('diff', '--name-only', BASE_COMMIT).stdout.split('\n'), ...git('ls-files', '--others', '--exclude-standard').stdout.split('\n')].filter(Boolean);
      const allowed = [/^backend\/torneos\/supabase\/functions\/torneos-gateway\/(index|config|commerce)\.ts$/, /^backend\/torneos\/supabase\/functions\/torneos-gateway\/commerce-test-rpc-allowlist\.json$/,
        /^integration\/torneos-core-contracts\/(gateway\.mjs|lab\.mjs|compose\.mpa\.yaml|commerce-gateway\.test\.mjs|README\.md)$/, /^integration\/torneos-core-contracts\/torneos-edge-main\/env\.ts$/,
        /^backend\/torneos\/mp-a\/evidence\/mp-a4\//];
      assert.deepEqual(changed.filter(f => !allowed.some(re => re.test(f))), [], 'no file outside the MP-A4 scope changed');
      for (const [name, sha] of Object.entries(MIGRATION_SHA)) assert.equal(sha256(await readFile(`${repo}backend/torneos/supabase/migrations/${name}`, 'utf8')), sha, name);
      assert.deepEqual((await readdir(`${repo}backend/torneos/supabase/migrations`)).sort(), Object.keys(MIGRATION_SHA));
      const frozen = git('diff', '--name-only', BASE_COMMIT, '--', 'backend/torneos/supabase/functions/torneos-payments', 'backend/torneos/supabase/functions/_shared',
        'backend/torneos/supabase/config.toml', 'supabase', 'src', 'public', 'scripts', ...STAGING_ALLOWLISTS, 'backend/torneos/supabase/functions/torneos-gateway/core-client.ts',
        'backend/torneos/supabase/functions/torneos-gateway/token.ts', 'backend/torneos/supabase/functions/torneos-gateway/adapter.ts', 'integration/torneos-sso',
        'integration/torneos-core-contracts/core-client.mjs', 'integration/torneos-core-contracts/adapter.mjs', 'integration/torneos-core-contracts/mp-stub.mjs').stdout.trim();
      assert.equal(frozen, '', 'frozen paths unchanged');
    });

    // ==================================================================== lab phases
    if (PHASE === 'unit') return;
    const lab = await import('./lab.mjs');
    const { config, dc, sql, BASE, EDGE_BASE, COMMERCE } = lab;
    const pl = await import('./payments-lab.mjs');
    const cfg = await config();
    const RUN = 'mpa4' + randomBytes(2).toString('hex');
    const GWS = [{ name: 'node', base: BASE }, { name: 'edge', base: EDGE_BASE }];
    const NODE_GW = GWS[0];
    const seen = [];
    const responses = [];
    const { SignJWT, importPKCS8, decodeJwt } = await import('jose');
    const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
    const admin = (q) => sql('torneos-db', q);

    async function http(base, path, { method = 'GET', token, body, headers = {} } = {}) {
      const r = await fetch(`${base}${path}`, { method, headers: { connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)) });
      const text = await r.text();
      responses.push(text);
      let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: r.status, body: json, text, headers: Object.fromEntries(r.headers) };
    }
    const co = (gw, token, payload, opts = {}) => http(gw.base, `${opts.path ?? ROUTE}${opts.query ?? ''}`, { method: opts.method ?? 'POST', token,
      body: opts.raw !== undefined ? opts.raw : payload, headers: opts.headers });
    const rpc = (gw, token, name, params) => http(gw.base, `/torneos/rest/v1/rpc/${name}`, { method: 'POST', token, body: params ?? {} });
    const verdict = (r) => [r.status, r.status === 200 ? 'ok' : (r.body?.error ?? r.body?.message ?? null)];
    /** Runs fn per gateway (same inputs), asserts the same verdict on both and, optionally, the expected one. */
    async function onBoth(name, fn, expected) {
      const out = {};
      for (const gw of GWS) out[gw.name] = await fn(gw);
      evidence.parity.push({ name, node: verdict(out.node), edge: verdict(out.edge) });
      assert.deepEqual(verdict(out.node), verdict(out.edge), `${name}: node ≡ edge`);
      if (expected) assert.deepEqual(verdict(out.node), expected, name);
      return out;
    }
    async function signup(label) {
      const email = `${RUN}-${label}-${randomUUID().slice(0, 8)}@example.test`;
      const password = `${randomUUID()}Aa!`;
      const r = await http(BASE, '/auth/v1/signup', { method: 'POST', body: { email, password, data: { full_name: `${RUN} ${label}` } } });
      assert.equal(r.status, 200, `signup ${label}`);
      seen.push(r.body.access_token, r.body.refresh_token, password);
      return { label, coreToken: r.body.access_token, coreUserId: r.body.user.id, sessionId: decodeJwt(r.body.access_token).session_id, tokens: {} };
    }
    async function tok(user, gw = NODE_GW) {
      const cached = user.tokens[gw.name];
      if (cached && Date.now() - cached.at < 80_000) return cached.token;
      const r = await http(gw.base, '/exchange', { method: 'POST', token: user.coreToken });
      assert.equal(r.status, 200, `exchange ${user.label}@${gw.name}: ${r.text.slice(0, 80)}`);
      seen.push(r.body.access_token);
      user.identity = decodeJwt(r.body.access_token).sub;
      user.tokens[gw.name] = { token: r.body.access_token, at: Date.now() };
      return r.body.access_token;
    }
    async function forged(payload, kid = 'p3a-k1') {
      const key = cfg.keys.find(k => k.kid === kid);
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ role: 'authenticated', ...payload }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
        .setIssuer('urn:arma2:local:identity-bridge').setAudience('arma2-torneos-local').setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120).setJti(randomUUID())
        .sign(await importPKCS8(key.privateKey, 'RS256'));
      seen.push(token);
      return token;
    }
    const purchasesTotal = () => Number(admin('select count(*) from public.tournament_purchases').trim());
    const purchasesIn = (season) => Number(admin(`select count(*) from public.tournament_purchases where season_id = ${lit(season)}`).trim());
    function paymentsInternalCount() {
      const logs = dc(['logs', '--no-color', '--no-log-prefix', 'torneos-functions'], undefined, true);
      return (logs.match(/"fn":"torneos-payments","route":"internal"/g) ?? []).length;
    }
    async function waitFor(label, probe, tries = 90) {
      for (let i = 0; i < tries; i += 1) {
        try { if (await probe()) return; } catch { /* restarting */ }
        await new Promise(r => setTimeout(r, 1000));
      }
      throw new Error(`${label} did not become ready`);
    }
    const healthy = async (gw) => (await fetch(`${gw.base}/health`, { signal: AbortSignal.timeout(60000) })).status === 200;
    async function waitGateways() { for (const gw of GWS) await waitFor(`${gw.name} gateway`, () => healthy(gw)); }

    let owner; let outsider; let org;
    async function setupOwner() {
      owner = await signup('owner'); outsider = await signup('outsider');
      for (const gw of GWS) { await tok(owner, gw); await tok(outsider, gw); }
      const r = await rpc(NODE_GW, await tok(owner), 'create_tournament_organization', { p_name: `MP-A4 ${RUN}`, p_slug: `mpa4-${RUN}`, p_idempotency_key: randomUUID() });
      assert.equal(r.status, 200, `org: ${r.text.slice(0, 120)}`);
      org = r.body.organization.id;
    }
    async function newSeason(label, user = owner, organization = org) {
      const r = await rpc(NODE_GW, await tok(user), 'create_tournament_season', { p_organization_id: organization, p_name: `MP-A4 ${label} ${RUN}`,
        p_slug: `mpa4-${label}-${RUN}-${randomBytes(2).toString('hex')}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() });
      assert.equal(r.status, 200, `season ${label}: ${r.text.slice(0, 120)}`);
      return r.body.id;
    }

    // ==================================================================== OFF (default lab)
    if (PHASE === 'off') {
      await check('OFF lab: default mode — no commerce overlay, no payments config, no gateway commerce file; both gateways healthy', async () => {
        assert.equal(COMMERCE, false, 'run without TORNEOS_LAB_MODE');
        assert.equal(cfg.mpa, undefined, 'no payments / Mercado Pago secrets were ever generated for this lab');
        await assert.rejects(readFile(`${here}.runtime/server/commerce.env`), { code: 'ENOENT' });
        const edgeEnv = await readFile(`${here}.runtime/torneos-gateway.env`, 'utf8');
        assert.ok(!/TORNEOS_COMMERCE_MODE|TORNEOS_PAYMENTS|MERCADO_PAGO/.test(edgeEnv));
        for (const service of ['gateway', 'torneos-functions']) assert.ok(!/TORNEOS_COMMERCE_MODE|TORNEOS_PAYMENTS|MERCADO_PAGO/.test(pl.containerEnv(service)), service);
        const ps = JSON.parse(`[${dc(['ps', '--format', 'json'], undefined, true).trim().split('\n').join(',')}]`);
        assert.ok(!ps.some(s => s.Service === 'mp-stub'), 'no mp-stub');
        for (const gw of GWS) assert.ok(await healthy(gw), gw.name);
      });
      await check('OFF fixtures: Core users (GoTrue), exchange on both gateways, organization through the gateway', setupOwner);
      await check('OFF T6-A: POST /commerce/v1/season-checkout → 404 {"error":"not found"}, byte-identical to an unknown route, with or without a valid bearer; 0 purchases', async () => {
        const season = await newSeason('off');
        const before = purchasesTotal();
        for (const gw of GWS) {
          const token = await tok(owner, gw);
          const unknown = await http(gw.base, '/commerce/v1/unknown-route', { method: 'POST', token, body: validBody({ seasonId: season, organizationId: org }) });
          for (const [label, r] of [['anonymous', await co(gw, null, undefined, { raw: '{}' })], ['bearer', await co(gw, token, undefined, { raw: JSON.stringify({ organizationId: org, seasonId: season, idempotencyKey: randomUUID() }) })],
            ['GET', await co(gw, token, undefined, { method: 'GET' })], ['PUT', await co(gw, token, undefined, { method: 'PUT', raw: '{}' })]]) {
            assert.deepEqual([r.status, r.text, r.headers['cache-control']], [404, '{"error":"not found"}', unknown.headers['cache-control']], `${gw.name} ${label}`);
            assert.equal(r.text, unknown.text);
          }
          evidence.parity.push({ name: 'OFF route 404', gateway: gw.name, status: 404 });
        }
        assert.equal(purchasesTotal(), before);
      });
      await check('OFF T6-A: get_tournament_purchase, get_effective_tournament_season_entitlements and the creation RPC stay 403 "rpc not enabled" through the proxy (valid Core session + bearer)', async () => {
        for (const name of [...READ_RPCS, CHECKOUT_RPC]) {
          await onBoth(`OFF proxy ${name}`, async (gw) => rpc(gw, await tok(owner, gw), name, {}), [403, 'rpc not enabled']);
        }
      });
      await check('OFF T6-A: the 43 staging-v1 RPCs still pass the gateway allowlist on both gateways (none answers "rpc not enabled")', async () => {
        for (const gw of GWS) {
          const token = await tok(owner, gw);
          const refused = [];
          for (const name of BASE43) {
            const r = await rpc(gw, token, name, {});
            if (r.status === 403 && r.body?.error === 'rpc not enabled') refused.push(name);
          }
          assert.deepEqual(refused, [], gw.name);
        }
      });
      return;
    }

    // ==================================================================== TEST (commerce lab)
    assert.equal(COMMERCE, true, 'the TEST phase runs on TORNEOS_LAB_MODE=commerce');
    const NODE_FILE = `${here}.runtime/server/commerce.env`;
    const EDGE_FILE = `${here}.runtime/torneos-gateway-commerce.env`;
    const stubCalls = async () => (await pl.stub('/__lab/calls')).calls;
    async function counters() { return { purchases: purchasesTotal(), payments: paymentsInternalCount(), stub: (await stubCalls()).length }; }
    function recreateGateways() { dc(['up', '-d', '--force-recreate', '--no-deps', 'gateway', 'torneos-functions'], undefined, true); }
    async function answering(gw) { try { await fetch(`${gw.base}/health`, { signal: AbortSignal.timeout(60000) }); return true; } catch { return false; } }
    const payBody = (season, key) => ({ organizationId: org, seasonId: season, idempotencyKey: key });

    await check('TEST fixtures: Core users (GoTrue), exchange on both gateways, organization through the gateway', async () => {
      assert.ok(cfg.mpa, 'commerce lab secrets');
      await pl.stub('/__lab/reset', {});
      await setupOwner();
    });
    await check('TEST lab: commerce lab up — mp-stub, both gateways healthy; gateway commerce config = exactly TORNEOS_COMMERCE_MODE / _INTERNAL_URL / _INTERNAL_SECRET (shared key), never Mercado Pago or payment-DB values', async () => {
      assert.ok(cfg.mpa, 'commerce lab secrets');
      await pl.stub('/__lab/reset', {});
      for (const file of [NODE_FILE, EDGE_FILE]) {
        const text = await readFile(file, 'utf8');
        const vars = Object.fromEntries(text.trim().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
        assert.deepEqual(Object.keys(vars).sort(), ['TORNEOS_COMMERCE_MODE', 'TORNEOS_PAYMENTS_INTERNAL_SECRET', 'TORNEOS_PAYMENTS_INTERNAL_URL'], file);
        assert.deepEqual([vars.TORNEOS_COMMERCE_MODE, vars.TORNEOS_PAYMENTS_INTERNAL_URL], ['test', 'http://torneos-functions:9000/torneos-payments']);
        assert.equal(vars.TORNEOS_PAYMENTS_INTERNAL_SECRET, cfg.mpa.internalSecret, 'the gateway holds the internal HMAC key');
        for (const secret of [cfg.mpa.accessToken, cfg.mpa.webhookSecret, cfg.mpa.stubControlToken, cfg.paymentServicePassword, cfg.mpa.sellerId]) assert.ok(!text.includes(secret), `${file}: MP / payment DB value`);
        const st = spawnSync('stat', ['-f', '%Lp', file], { encoding: 'utf8' });
        assert.equal(st.stdout.trim(), '600', file);
      }
      const gwContainer = lab.inGateway(`import { readdir } from 'node:fs/promises'; console.log(JSON.stringify({ env: Object.keys(process.env).filter(k => /MERCADO|PAYMENT|COMMERCE/.test(k)), files: (await readdir('/lab/.runtime/server')).sort() }));`);
      assert.deepEqual(JSON.parse(gwContainer.trim().split('\n').pop()), { env: [], files: ['commerce.env', 'config.json'] }, 'Node gateway: no MP env; its private config dir has only its own two files');
      for (const gw of GWS) assert.ok(await healthy(gw), gw.name);
    });

    await check('TEST T6-B live: mode "live", a short secret or a Production internal URL disables BOTH gateways at boot (503 on health, RPC and checkout); the valid config restores them', async () => {
      const good = [await readFile(NODE_FILE, 'utf8'), await readFile(EDGE_FILE, 'utf8')];
      const variants = {
        live: good[0].replace('TORNEOS_COMMERCE_MODE=test', 'TORNEOS_COMMERCE_MODE=live'),
        short_secret: good[0].replace(/TORNEOS_PAYMENTS_INTERNAL_SECRET=.*/, 'TORNEOS_PAYMENTS_INTERNAL_SECRET=abcd'),
        production_url: good[0].replace(/TORNEOS_PAYMENTS_INTERNAL_URL=.*/, 'TORNEOS_PAYMENTS_INTERNAL_URL=https://rcyuuoaqfwcembdajcss.supabase.co/functions/v1/torneos-payments'),
      };
      try {
        for (const [label, text] of Object.entries(variants)) {
          await writeFile(NODE_FILE, text, { mode: 0o600 }); await writeFile(EDGE_FILE, text, { mode: 0o600 });
          recreateGateways();
          for (const gw of GWS) await waitFor(`${gw.name} answering`, () => answering(gw));
          await onBoth(`fail-closed ${label} /health`, (gw) => http(gw.base, '/health'), [503, 'access denied']);
          await onBoth(`fail-closed ${label} checkout`, (gw) => co(gw, 'x', payBody(randomUUID(), randomUUID())), [503, 'access denied']);
          await onBoth(`fail-closed ${label} rpc`, (gw) => rpc(gw, 'x', 'get_my_tournament_memberships', {}), [503, 'access denied']);
          // The refusal is the gateways' own boot verdict (logged once, without values), not a router fault.
          assert.match(dc(['logs', '--no-color', 'gateway'], undefined, true), /\[gateway\] disabled: /, `${label}: Node gateway disabled`);
          assert.match(dc(['logs', '--no-color', 'torneos-functions'], undefined, true), /\[torneos-gateway\] disabled: /, `${label}: Edge gateway disabled`);
        }
      } finally {
        await writeFile(NODE_FILE, good[0], { mode: 0o600 }); await writeFile(EDGE_FILE, good[1], { mode: 0o600 });
        recreateGateways();
        await waitGateways();
        await pl.waitPayments();
      }
      for (const gw of GWS) assert.ok(await healthy(gw));
    });

    let happy = {};
    await check('TEST T6-E happy path (both gateways): Core → exchange → checkout → DB wrapper → purchase MP/test → HMAC → payments → mp-stub Preference → DB preference recorded → whitelisted response; price 39900 from the DB offer; X-Idempotency-Key = purchase.id', async () => {
      const offer = Number(admin(`select amount from public.tournament_commercial_offers where product_code = 'torneos_premium' and availability = 'available' order by valid_from desc, offer_version desc limit 1`).trim());
      assert.equal(offer, 39900);
      for (const gw of GWS) {
        const season = await newSeason(`happy-${gw.name}`);
        const key = randomUUID();
        const before = await counters();
        const r = await co(gw, await tok(owner, gw), payBody(season, key));
        assert.equal(r.status, 200, `${gw.name}: ${r.text.slice(0, 200)}`);
        assert.deepEqual(Object.keys(r.body).sort(), ['preference', 'purchase']);
        const { purchase, preference } = r.body;
        assert.deepEqual(Object.keys(preference).sort(), ['checkoutUrl', 'expiresAt', 'preferenceId', 'provider']);
        assert.deepEqual([purchase.amount, purchase.currency, purchase.provider, purchase.providerEnvironment, purchase.productCode, purchase.seasonId, purchase.organizationId],
          [39900, 'ARS', 'MERCADO_PAGO', 'test', 'torneos_premium', season, org]);
        assert.equal(preference.provider, 'MERCADO_PAGO');
        const url = new URL(preference.checkoutUrl);
        assert.deepEqual([url.protocol, url.hostname, url.searchParams.get('pref_id')], ['https:', 'www.mercadopago.com.ar', preference.preferenceId]);
        const ttl = Date.parse(preference.expiresAt) - Date.now();
        assert.ok(ttl > 25 * 60_000 && ttl <= 31 * 60_000, `expiry ≈ now + 30 min (${ttl})`);
        const row = pl.purchaseRow(purchase.id);
        assert.deepEqual([row.status, row.provider_preference_id, row.amount_snapshot, row.buyer_user_id], ['preference_created', preference.preferenceId, 39900, owner.identity]);
        assert.deepEqual(pl.eventTypes(purchase.id), ['purchase.created', 'preference.created']);
        assert.deepEqual(pl.grantEvents(purchase.id), []);
        const created = (await stubCalls()).filter(c => c.route === '/checkout/preferences');
        const mine = created.at(-1);
        assert.deepEqual([mine.idempotencyKey, mine.body.unit_price, mine.body.currency_id, mine.body.external_reference, mine.status],
          [purchase.id, 39900, 'ARS', `arma2:season:purchase:${purchase.id}`, 201]);
        const after = await counters();
        assert.deepEqual([after.purchases - before.purchases, after.payments - before.payments], [1, 1], 'one purchase, one internal payments call');
        pl.assertNoLeak(r.text, seen.filter(Boolean), `${gw.name} response`);
        happy[gw.name] = { season, key, purchaseId: purchase.id, preferenceId: preference.preferenceId };
        evidence.parity.push({ name: 'happy path', gateway: gw.name, status: 200, amount: purchase.amount, checkoutHost: url.hostname });
      }
    });

    await check('TEST T6-F idempotency: the same key repeated (either gateway) → same purchase, same Preference, no new Preference at Mercado Pago, no second grant; a new key while open → the same open purchase (no artificial conflict)', async () => {
      for (const gw of GWS) {
        const h = happy[gw.name];
        const posts = (await stubCalls()).filter(c => c.route === '/checkout/preferences').length;
        for (const target of GWS) {
          const r = await co(target, await tok(owner, target), payBody(h.season, h.key));
          assert.equal(r.status, 200, `${gw.name}→${target.name}: ${r.text.slice(0, 160)}`);
          assert.deepEqual([r.body.purchase.id, r.body.purchase.idempotentReplay, r.body.preference.preferenceId], [h.purchaseId, true, h.preferenceId]);
        }
        const other = await co(gw, await tok(owner, gw), payBody(h.season, randomUUID()));
        assert.deepEqual([other.status, other.body.purchase.id, other.body.purchase.existingOpenPurchase, other.body.preference.preferenceId], [200, h.purchaseId, true, h.preferenceId]);
        assert.equal((await stubCalls()).filter(c => c.route === '/checkout/preferences').length, posts, 'no new Preference created');
        assert.equal(purchasesIn(h.season), 1); assert.deepEqual(pl.eventTypes(h.purchaseId), ['purchase.created', 'preference.created']); assert.deepEqual(pl.grantEvents(h.purchaseId), []);
      }
    });
    await check('TEST T6-F concurrency: 3 parallel checkouts with the same fresh key (each gateway) → the same purchase and the same Preference; 1 purchase, 1 preference.created, 1 Preference at Mercado Pago', async () => {
      for (const gw of GWS) {
        const season = await newSeason(`conc-${gw.name}`);
        const key = randomUUID();
        const token = await tok(owner, gw);
        const rs = await Promise.all([0, 1, 2].map(() => co(gw, token, payBody(season, key))));
        assert.deepEqual(rs.map(r => r.status), [200, 200, 200], rs.map(r => r.text.slice(0, 100)).join(' | '));
        assert.equal(new Set(rs.map(r => r.body.purchase.id)).size, 1); assert.equal(new Set(rs.map(r => r.body.preference.preferenceId)).size, 1);
        const pid = rs[0].body.purchase.id;
        assert.equal(purchasesIn(season), 1); assert.deepEqual(pl.eventTypes(pid), ['purchase.created', 'preference.created']);
        const posts = (await stubCalls()).filter(c => c.route === '/checkout/preferences' && c.idempotencyKey === pid);
        assert.equal(posts.filter(c => c.status === 201 && !c.idempotentReplay).length, 1, 'exactly one Preference created at Mercado Pago');
        assert.equal(pl.purchaseRow(pid).provider_preference_id, rs[0].body.preference.preferenceId);
      }
    });

    await check('TEST T6-C live: commerce TEST proxy = 43 + 3 — the three reads reach the DB; the creation RPC and every other commercial RPC stay 403 "rpc not enabled"; the 43 still pass', async () => {
      const h = happy.node;
      const r = await onBoth('proxy get_tournament_purchase', async (gw) => rpc(gw, await tok(owner, gw), 'get_tournament_purchase', { p_purchase_id: h.purchaseId }), [200, 'ok']);
      assert.equal(r.node.body.id, h.purchaseId); assert.deepEqual(r.node.body, r.edge.body);
      const e = await onBoth('proxy entitlements', async (gw) => rpc(gw, await tok(owner, gw), 'get_effective_tournament_season_entitlements', { p_organization_id: org, p_season_id: h.season }), [200, 'ok']);
      assert.equal(e.node.body.plan, 'FREE');
      for (const name of [CHECKOUT_RPC, 'create_tournament_season_purchase', 'create_fake_tournament_season_purchase', 'cancel_tournament_purchase', 'get_provider_tournament_purchase',
        'record_tournament_purchase_preference', 'apply_verified_tournament_payment_status', 'apply_verified_tournament_payment_reversal', 'activate_verified_tournament_purchase']) {
        const before = purchasesTotal();
        await onBoth(`proxy refuses ${name}`, async (gw) => rpc(gw, await tok(owner, gw), name, { p_organization_id: org, p_season_id: h.season, p_idempotency_key: randomUUID() }), [403, 'rpc not enabled']);
        assert.equal(purchasesTotal(), before);
      }
      for (const gw of GWS) {
        const token = await tok(owner, gw);
        const refused = [];
        for (const name of [...BASE43, ...READ_RPCS]) {
          const x = await rpc(gw, token, name, {});
          if (x.status === 403 && x.body?.error === 'rpc not enabled') refused.push(name);
        }
        assert.deepEqual(refused, [], `${gw.name}: all 46 pass the allowlist`);
      }
    });

    await check('TEST T6-D auth order (both gateways): no bearer / garbage / untrusted kid / Core token as bearer → 401; revoked Core session → 401; unknown identity → 401; outsider without billing.manage → 403; bad bodies never beat auth — 0 purchases, 0 payments, 0 Mercado Pago calls', async () => {
      const season = await newSeason('order');
      const body = payBody(season, randomUUID());
      const revoked = await signup('revoked');
      for (const gw of GWS) await tok(revoked, gw);
      const live = await signup('ghost');
      const ghostToken = await forged({ sub: randomUUID(), core_user_id: live.coreUserId, session_id: live.sessionId });
      const untrusted = await forged({ sub: randomUUID(), core_user_id: live.coreUserId, session_id: live.sessionId }, 'p3a-k2');
      const before = await counters();
      await onBoth('no bearer', (gw) => co(gw, null, body), [401, 'access denied']);
      await onBoth('garbage bearer', (gw) => co(gw, 'not-a-jwt', body), [401, 'access denied']);
      await onBoth('untrusted kid', (gw) => co(gw, untrusted, body), [401, 'access denied']);
      await onBoth('Core token as bearer', (gw) => co(gw, live.coreToken, body), [401, 'access denied']);
      await onBoth('unknown identity (valid kid, live Core session)', (gw) => co(gw, ghostToken, body), [401, 'access denied']);
      await onBoth('no bearer + oversized body', (gw) => co(gw, null, undefined, { raw: 'x'.repeat(4096) }), [401, 'access denied']);
      await onBoth('garbage bearer + extra fields', (gw) => co(gw, 'not-a-jwt', { ...body, amount: 1 }), [401, 'access denied']);
      const logout = await http(BASE, '/auth/v1/logout', { method: 'POST', token: revoked.coreToken });
      assert.ok([200, 204].includes(logout.status), `logout ${logout.status}`);
      await onBoth('revoked Core session', async (gw) => co(gw, revoked.tokens[gw.name].token, body), [401, 'access denied']);
      await onBoth('revoked Core session + invalid body', async (gw) => co(gw, revoked.tokens[gw.name].token, undefined, { raw: '{"amount":1}' }), [401, 'access denied']);
      await onBoth('outsider without billing.manage', async (gw) => co(gw, await tok(outsider, gw), body), [403, 'TORNEOS_BILLING_FORBIDDEN']);
      await onBoth('valid auth + invalid body', async (gw) => co(gw, await tok(owner, gw), { ...body, amount: 1 }), [400, 'TORNEOS_CHECKOUT_INVALID']);
      assert.deepEqual(await counters(), before, 'no purchase, no payments call, no Mercado Pago call');
      assert.equal(purchasesIn(season), 0);
    });
    await check('TEST T6-D/H Core unavailable (GoTrue stopped) → 503 CORE_UNAVAILABLE on both, 0 purchases, 0 payments; after recovery the same key completes', async () => {
      const season = await newSeason('core-down');
      const key = randomUUID();
      const tokens = {};
      for (const gw of GWS) tokens[gw.name] = await tok(owner, gw);
      const before = await counters();
      dc(['stop', 'core-auth'], undefined, true);
      try {
        await onBoth('Core down', (gw) => co(gw, tokens[gw.name], payBody(season, key)), [503, 'CORE_UNAVAILABLE']);
        assert.deepEqual(await counters(), before);
      } finally {
        dc(['start', 'core-auth'], undefined, true);
        await waitGateways();
      }
      const r = await co(NODE_GW, await tok(owner), payBody(season, key));
      assert.equal(r.status, 200, r.text.slice(0, 160)); assert.equal(purchasesIn(season), 1);
    });

    await check('TEST T6-G business errors (both gateways): already premium, premium suspended, idempotency conflict, open purchase of another provider, checkout expired (in grace and swept), no access — each a 403/409 with its code, never 503, no purchase written', async () => {
      for (const gw of GWS) {
        const token = await tok(owner, gw);
        // already premium: pay the happy purchase of this gateway.
        const h = happy[gw.name];
        const approved = await pl.payAndNotify({ preferenceId: h.preferenceId }, 'approved', 'accredited');
        assert.equal(approved.r.status, 200, approved.r.text);
        assert.equal(pl.grantEffective(h.purchaseId), true);
        h.paymentId = approved.pay.paymentId;
        const refuse = async (label, body, expected, user = owner) => {
          const n = purchasesTotal();
          const p = paymentsInternalCount();
          const r = await co(gw, await tok(user, gw), body);
          assert.deepEqual(verdict(r), expected, `${gw.name} ${label}`);
          assert.notEqual(r.status, 503, label);
          assert.deepEqual([purchasesTotal(), paymentsInternalCount()], [n, p], `${gw.name} ${label}: no purchase written, payments not called`);
          evidence.parity.push({ name: `business ${label}`, gateway: gw.name, verdict: verdict(r) });
        };
        await refuse('already premium', payBody(h.season, randomUUID()), [409, 'TORNEOS_SEASON_ALREADY_PREMIUM']);
        await refuse('already premium (same key)', payBody(h.season, h.key), [409, 'TORNEOS_SEASON_ALREADY_PREMIUM']);
        // premium suspended: a disputed chargeback on a fresh paid season.
        const sSeason = await newSeason(`susp-${gw.name}`);
        const s = await co(gw, token, payBody(sSeason, randomUUID()));
        assert.equal(s.status, 200);
        const sp = await pl.payAndNotify({ preferenceId: s.body.preference.preferenceId }, 'approved', 'accredited');
        await pl.stub('/__lab/payment-state', { paymentId: sp.pay.paymentId, status: 'charged_back', statusDetail: 'in_process' });
        const cb = await pl.stub('/__lab/chargebacks', { paymentId: sp.pay.paymentId });
        assert.equal((await pl.webhook({ dataId: cb.chargebackId, type: 'topic_chargebacks_wh' })).status, 200);
        assert.deepEqual(pl.grantEvents(s.body.purchase.id), ['granted', 'suspended']);
        await refuse('premium suspended', payBody(sSeason, randomUUID()), [409, 'TORNEOS_SEASON_PREMIUM_SUSPENDED']);
        // idempotency conflict: a key of season A replayed on season B.
        const iSeason = await newSeason(`idem-${gw.name}`);
        const iKey = randomUUID();
        assert.equal((await co(gw, token, payBody(iSeason, iKey))).status, 200);
        const otherSeason = await newSeason(`idem2-${gw.name}`);
        await refuse('idempotency conflict', payBody(otherSeason, iKey), [409, 'TORNEOS_IDEMPOTENCY_CONFLICT']);
        // open purchase of another provider (FAKE, created in the DB as the owner).
        const fSeason = await newSeason(`fake-${gw.name}`);
        const fake = JSON.parse(pl.run(null, { role: 'authenticated', iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local', sub: owner.identity, core_user_id: owner.coreUserId,
          session_id: randomUUID(), jti: randomUUID(), iat: Math.floor(Date.now() / 1000), nbf: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 120 },
        `select public.create_fake_tournament_season_purchase(${lit(org)}, ${lit(fSeason)}, 'torneos_premium', ${lit(randomUUID())}, 'local')`));
        assert.equal(fake.provider, 'FAKE');
        await refuse('open purchase of another provider', payBody(fSeason, randomUUID()), [409, 'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT']);
        // checkout expired: preference past its expiry inside the 15-min grace (payments refuses), then swept (DB status expired).
        const eSeason = await newSeason(`exp-${gw.name}`);
        const eKey = randomUUID();
        const e = await co(gw, token, payBody(eSeason, eKey));
        assert.equal(e.status, 200);
        admin(`update public.tournament_purchases set preference_expires_at = now() - interval '1 minute' where id = ${lit(e.body.purchase.id)}`);
        const inGrace = await co(gw, token, payBody(eSeason, eKey));
        assert.deepEqual(verdict(inGrace), [409, 'TORNEOS_CHECKOUT_EXPIRED'], `${gw.name} expired in grace (payments refuses the stale Preference)`);
        admin(`update public.tournament_purchases set preference_expires_at = now() - interval '16 minutes' where id = ${lit(e.body.purchase.id)}`);
        await refuse('checkout expired (swept)', payBody(eSeason, eKey), [409, 'TORNEOS_CHECKOUT_EXPIRED']);
        assert.equal(pl.purchaseRow(e.body.purchase.id).status, 'expired');
        const fresh = await co(gw, token, payBody(eSeason, randomUUID()));
        assert.equal(fresh.status, 200, 'a new key starts a new checkout'); assert.notEqual(fresh.body.purchase.id, e.body.purchase.id);
        // no access: outsider on the owner's season; outsider reading the owner's purchase through the proxy.
        await refuse('no access (outsider)', payBody(eSeason, randomUUID()), [403, 'TORNEOS_BILLING_FORBIDDEN'], outsider);
        const read = await rpc(gw, await tok(outsider, gw), 'get_tournament_purchase', { p_purchase_id: h.purchaseId });
        assert.deepEqual([read.status, read.body?.message], [403, 'TORNEOS_PURCHASE_FORBIDDEN']);
        assert.equal(purchasesIn(h.season), 1); assert.equal(purchasesIn(sSeason), 1); assert.equal(purchasesIn(otherSeason), 0); assert.equal(purchasesIn(fSeason), 1);
      }
    });

    await check('TEST T6-H Mercado Pago 5xx → payments 503 → gateway 503 TORNEOS_PAYMENTS_UNAVAILABLE (one call, no retry); the same key then completes with one Preference', async () => {
      for (const gw of GWS) {
        const season = await newSeason(`mp5xx-${gw.name}`);
        const key = randomUUID();
        const token = await tok(owner, gw);
        await pl.stub('/__lab/fail', { method: 'POST', route: '/checkout/preferences', status: 500, times: 1 });
        const p0 = paymentsInternalCount();
        assert.deepEqual(verdict(await co(gw, token, payBody(season, key))), [503, 'TORNEOS_PAYMENTS_UNAVAILABLE'], gw.name);
        assert.equal(paymentsInternalCount() - p0, 1, 'exactly one internal call');
        const r = await co(gw, token, payBody(season, key));
        assert.equal(r.status, 200, r.text.slice(0, 160));
        assert.equal(purchasesIn(season), 1); assert.deepEqual(pl.eventTypes(r.body.purchase.id), ['purchase.created', 'preference.created']);
      }
    });
    await check('TEST T6-H Mercado Pago slow → the gateway gives up at 8 s → 503 TORNEOS_PAYMENTS_UNAVAILABLE; the same key then completes', async () => {
      for (const gw of GWS) {
        const season = await newSeason(`slow-${gw.name}`);
        const key = randomUUID();
        const token = await tok(owner, gw);
        await pl.stub('/__lab/preference-mode', { delayMs: 10_000, times: 1 });
        const started = Date.now();
        const r = await co(gw, token, payBody(season, key));
        const elapsed = Date.now() - started;
        assert.deepEqual(verdict(r), [503, 'TORNEOS_PAYMENTS_UNAVAILABLE'], gw.name);
        assert.ok(elapsed >= 7_500 && elapsed < 9_900, `${gw.name}: gave up after ${elapsed} ms`);
        await new Promise(res => setTimeout(res, 2500));
        const again = await co(gw, token, payBody(season, key));
        assert.equal(again.status, 200, again.text.slice(0, 160)); assert.equal(purchasesIn(season), 1);
      }
    });
    await check('TEST T6-H payments unavailable (its DB login refused) → 503 TORNEOS_PAYMENTS_UNAVAILABLE on both; payments unreachable (stopped) → 503 on Node; the same key then completes', async () => {
      const seasons = {};
      const keys = {};
      admin(`ALTER ROLE lab_payment_service NOLOGIN; SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'lab_payment_service';`);
      try {
        await onBoth('payments DB down', async (gw) => {
          seasons[gw.name] = await newSeason(`paydb-${gw.name}`); keys[gw.name] = randomUUID();
          return co(gw, await tok(owner, gw), payBody(seasons[gw.name], keys[gw.name]));
        }, [503, 'TORNEOS_PAYMENTS_UNAVAILABLE']);
      } finally {
        admin('ALTER ROLE lab_payment_service LOGIN;');
      }
      for (const gw of GWS) {
        const r = await co(gw, await tok(owner, gw), payBody(seasons[gw.name], keys[gw.name]));
        assert.equal(r.status, 200, `${gw.name}: ${r.text.slice(0, 160)}`); assert.equal(purchasesIn(seasons[gw.name]), 1);
      }
      const season = await newSeason('payments-stopped');
      const key = randomUUID();
      const token = await tok(owner);
      dc(['stop', 'torneos-functions'], undefined, true);
      try {
        assert.deepEqual(verdict(await co(NODE_GW, token, payBody(season, key))), [503, 'TORNEOS_PAYMENTS_UNAVAILABLE']);
      } finally {
        dc(['start', 'torneos-functions'], undefined, true);
        await waitGateways();
        await pl.waitPayments();
      }
      const r = await co(NODE_GW, await tok(owner), payBody(season, key));
      assert.equal(r.status, 200, r.text.slice(0, 160)); assert.equal(purchasesIn(season), 1);
    });
    await check('TEST T6-H Torneos REST down → 503 TORNEOS_UNAVAILABLE on both, 0 purchases, 0 payments; after recovery the same key completes', async () => {
      const season = await newSeason('rest-down');
      const key = randomUUID();
      const tokens = {};
      for (const gw of GWS) tokens[gw.name] = await tok(owner, gw);
      const before = await counters();
      dc(['stop', 'torneos-rest'], undefined, true);
      try {
        await onBoth('REST down', (gw) => co(gw, tokens[gw.name], payBody(season, key)), [503, 'TORNEOS_UNAVAILABLE']);
        assert.deepEqual(await counters(), before);
      } finally {
        dc(['start', 'torneos-rest'], undefined, true);
        await waitFor('torneos-rest', async () => (await rpc(NODE_GW, await tok(owner), 'get_my_tournament_memberships', {})).status === 200);
      }
      for (const gw of GWS) {
        const r = await co(gw, await tok(owner, gw), payBody(season, key));
        assert.equal(r.status, 200, `${gw.name}: ${r.text.slice(0, 160)}`);
      }
      assert.equal(purchasesIn(season), 1);
    });

    await check('TEST T6-I security (both gateways): extra / missing / non-UUID fields → 400; > 1 KiB → 413 (1 KiB exactly passes validation); query → 400; other methods and a trailing slash → 404; 0 purchases', async () => {
      const season = await newSeason('security');
      const before = purchasesTotal();
      for (const extra of [{ amount: 1 }, { price: 1 }, { currency: 'USD' }, { provider: 'FAKE' }, { environment: 'production' }, { product: 'x' }, { returnUrl: 'https://evil.invalid' },
        { webhookUrl: 'https://evil.invalid' }, { paymentsUrl: 'http://evil.invalid' }, { purchase_id: randomUUID() }]) {
        await onBoth(`extra ${Object.keys(extra)[0]}`, async (gw) => co(gw, await tok(owner, gw), { ...payBody(season, randomUUID()), ...extra }), [400, 'TORNEOS_CHECKOUT_INVALID']);
      }
      for (const [label, raw] of [['missing', JSON.stringify({ organizationId: org, seasonId: season })], ['non-uuid', JSON.stringify(payBody('x', randomUUID()))], ['array', '[]'],
        ['non-json', '{'], ['empty', ''], ['utf8', new Uint8Array([0x7b, 0xff, 0x7d])]]) {
        await onBoth(`invalid ${label}`, async (gw) => co(gw, await tok(owner, gw), undefined, { raw }), [400, 'TORNEOS_CHECKOUT_INVALID']);
      }
      const exact = `${JSON.stringify(payBody(season, randomUUID())).slice(0, -1)}${' '.repeat(1024 - JSON.stringify(payBody(season, randomUUID())).length)}}`;
      assert.equal(Buffer.byteLength(exact), 1024);
      await onBoth('1 KiB exactly (outsider → validated, then DB refuses)', async (gw) => co(gw, await tok(outsider, gw), undefined, { raw: exact }), [403, 'TORNEOS_BILLING_FORBIDDEN']);
      await onBoth('1 KiB + 1', async (gw) => co(gw, await tok(owner, gw), undefined, { raw: `${exact} ` }), [413, 'TORNEOS_CHECKOUT_TOO_LARGE']);
      await onBoth('query string', async (gw) => co(gw, await tok(owner, gw), payBody(season, randomUUID()), { query: '?amount=1' }), [400, 'TORNEOS_CHECKOUT_INVALID']);
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
        await onBoth(`method ${method}`, async (gw) => co(gw, await tok(owner, gw), method === 'GET' ? undefined : payBody(season, randomUUID()), { method }), [404, 'not found']);
      }
      await onBoth('trailing slash', async (gw) => co(gw, await tok(owner, gw), payBody(season, randomUUID()), { path: `${ROUTE}/` }), [404, 'not found']);
      assert.equal(purchasesTotal(), before);
    });
    await check('TEST T6-I CORS unchanged: foreign Origin → 403 on both; Edge preflight on the commerce route = preflight on an RPC route; the allowed origin gets the same CORS headers', async () => {
      await onBoth('foreign origin', async (gw) => co(gw, await tok(owner, gw), payBody(randomUUID(), randomUUID()), { headers: { origin: 'https://evil.invalid' } }), [403, 'origin rejected']);
      const pre = async (path) => { const r = await fetch(`${EDGE_BASE}${path}`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:58421', 'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type', connection: 'close' } }); await r.text(); return [r.status, Object.fromEntries([...r.headers].filter(([k]) => k.startsWith('access-control') || k === 'vary'))]; };
      assert.deepEqual(await pre(ROUTE), await pre('/torneos/rest/v1/rpc/get_my_tournament_memberships'));
      const season = await newSeason('cors');
      const r = await co(GWS[1], await tok(owner, GWS[1]), payBody(season, randomUUID()), { headers: { origin: 'http://127.0.0.1:58421' } });
      assert.equal(r.status, 200); assert.equal(r.headers['access-control-allow-origin'], 'http://127.0.0.1:58421');
    });

    await check('TEST §17 journey (both gateways): Core session → /exchange → org + season → checkout → payments → mp-stub Preference → webhook approved → purchase approved + Premium (read through the 2 commerce reads) → refund → Premium revoked', async () => {
      for (const gw of GWS) {
        const user = await signup(`journey-${gw.name}`);
        const token = await tok(user, gw);
        const o = await rpc(gw, token, 'create_tournament_organization', { p_name: `Journey ${gw.name} ${RUN}`, p_slug: `journey-${gw.name}-${RUN}`, p_idempotency_key: randomUUID() });
        assert.equal(o.status, 200);
        const orgId = o.body.organization.id;
        const s = await rpc(gw, token, 'create_tournament_season', { p_organization_id: orgId, p_name: `Journey ${RUN}`, p_slug: `journey-${gw.name}-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() });
        assert.equal(s.status, 200);
        const seasonId = s.body.id;
        const c = await co(gw, token, { organizationId: orgId, seasonId, idempotencyKey: randomUUID() });
        assert.equal(c.status, 200, c.text.slice(0, 160));
        const purchaseId = c.body.purchase.id;
        const step = (name, extra = {}) => evidence.journey.push({ gateway: gw.name, step: name, ...extra });
        step('checkout', { status: c.status, purchaseStatus: c.body.purchase.status, amount: c.body.purchase.amount, checkoutHost: new URL(c.body.preference.checkoutUrl).hostname });
        const paid = await pl.payAndNotify({ preferenceId: c.body.preference.preferenceId }, 'approved', 'accredited');
        assert.equal(paid.r.status, 200); step('webhook approved', { webhookStatus: paid.r.status, outcome: paid.r.body?.outcome });
        const read = async () => ({
          purchase: await rpc(gw, await tok(user, gw), 'get_tournament_purchase', { p_purchase_id: purchaseId }),
          ent: await rpc(gw, await tok(user, gw), 'get_effective_tournament_season_entitlements', { p_organization_id: orgId, p_season_id: seasonId }),
        });
        const a = await read();
        assert.deepEqual([a.purchase.status, a.purchase.body.status, a.ent.status, a.ent.body.plan], [200, 'approved', 200, 'PREMIUM']);
        step('read after approval', { purchaseStatus: a.purchase.body.status, plan: a.ent.body.plan });
        await pl.stub('/__lab/payment-state', { paymentId: paid.pay.paymentId, status: 'refunded', statusDetail: 'refunded' });
        const refund = await pl.webhook({ dataId: paid.pay.paymentId });
        assert.equal(refund.status, 200); step('webhook refund', { webhookStatus: refund.status, outcome: refund.body?.outcome });
        const b = await read();
        assert.deepEqual([b.purchase.body.status, b.ent.body.plan], ['refunded', 'FREE']);
        assert.deepEqual(pl.grantEvents(purchaseId), ['granted', 'revoked']);
        step('read after refund', { purchaseStatus: b.purchase.body.status, plan: b.ent.body.plan });
      }
    });

    await check('TEST secrets: no response, gateway log or payments log carries a lab secret, bearer, HMAC value or payer data; commerce log lines carry only rid / purchase id / code / status / timing', async () => {
      const all = responses.join('\n');
      pl.assertNoLeak(all, [], 'responses');
      const logs = dc(['logs', '--no-color', '--no-log-prefix', 'gateway', 'torneos-functions'], undefined, true);
      pl.assertNoLeak(logs, seen.filter(Boolean), 'logs');
      const lines = logs.split('\n').filter(l => l.includes('"route":"commerce.season_checkout"'));
      assert.ok(lines.length > 20, `commerce log lines present (${lines.length})`);
      for (const line of lines) {
        const entry = JSON.parse(line.slice(line.indexOf('{')));
        assert.deepEqual(Object.keys(entry).sort(), ['code', 'fn', 'ms', 'purchaseId', 'rid', 'route', 'status']);
      }
      assert.ok(!/mercadopago\.com\.ar\/checkout/.test(logs), 'no checkout URL in logs');
    });
  } finally {
    await mkdir(EVIDENCE, { recursive: true });
    const doc = { suite: `MP-A4 T6 gateway commerce — ${PHASE}`, base: BASE_COMMIT, results,
      passed: results.filter(r => r.status === 'PASS').length, total: results.length, ...evidence };
    const text = JSON.stringify(doc, null, 2) + '\n';
    if (PHASE !== 'unit') {
      const pl = await import('./payments-lab.mjs');
      pl.assertNoLeak(text, [], 'T6 evidence');
    }
    await writeFile(`${EVIDENCE}t6-${PHASE}${TAG}.json`, text);
  }
});
