// COMMERCE-PRODUCTION — the gateway side (torneos-gateway/commerce.ts, the module the Edge and Node gateways share).
//   Part U (offline): the production configuration matrix, TEST unchanged, the read allowlists.
//   Part E (lab): the real seasonCheckout / purchaseRefresh → PostgREST emulated over the lab database with the user's own
//          identity (SET ROLE authenticated + bridge claims, exactly what PostgREST does) → the real production payments
//          handler (HMAC) → the Mercado Pago emulator. One in-process chain from "Comprar Premium" to Premium.
//   node --test --test-concurrency=1 backend/torneos/commerce-production/gateway-commerce-production.test.mjs
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emulator, LAB_ENV, labProductionDb, SECRET_HEX, send, service, webhookRequest } from './lab/payments-harness.mjs';

const GATEWAY = new URL('../supabase/functions/torneos-gateway/', import.meta.url);
const commerce = await import(new URL('commerce.ts', GATEWAY).href);
const { loadCommerceConfig, effectiveRpcAllowlist, seasonCheckout, purchaseRefresh, CommerceConfigError } = commerce;

const BASE43 = new Set(Array.from({ length: 43 }, (_, i) => `staging_rpc_${i}`));
const HOSTED_CTX = Object.freeze({ baseAllowlist: BASE43, gatewayPublicUrl: 'https://torneos-gateway-abc123-rj.a.run.app/functions/v1/torneos-gateway',
  distinctFrom: [], dependencyUrls: ['https://core.example.com/auth/v1', 'https://core.example.com/functions/v1/torneos-core-contract',
    'https://onzpwnqxnvlgsevivngf.supabase.co/rest/v1', 'https://app.arma2.com.ar'] });
const PAYMENTS_HOST = 'torneos-payments.example-org.deno.net';
const HOSTED_ENV = Object.freeze({ TORNEOS_COMMERCE_MODE: 'production', TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST: PAYMENTS_HOST,
  TORNEOS_PAYMENTS_INTERNAL_URL: `https://${PAYMENTS_HOST}/functions/v1/torneos-payments-production`, TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX });
const refused = (env, ctx = HOSTED_CTX) => { try { loadCommerceConfig(env, ctx); return null; } catch (error) { assert.ok(error instanceof CommerceConfigError, error.message); return error.message; } };

describe('configuration', () => {
  test('production loads hosted and in the lab, with exactly three reads', () => {
    const hosted = loadCommerceConfig(HOSTED_ENV, HOSTED_CTX);
    assert.deepEqual([hosted.mode, hosted.deployment, hosted.paymentsUrl], ['production', 'production', `https://${PAYMENTS_HOST}/functions/v1/torneos-payments-production`]);
    assert.deepEqual([...hosted.readRpcs].sort(), ['get_effective_tournament_season_entitlements', 'get_tournament_purchase', 'get_tournament_season_purchases']);
    assert.equal(effectiveRpcAllowlist(BASE43, hosted).size, 46);
    const lab = loadCommerceConfig({ TORNEOS_COMMERCE_MODE: 'production', TORNEOS_COMMERCE_DEPLOYMENT: 'local-lab',
      TORNEOS_PAYMENTS_INTERNAL_URL: 'http://torneos-functions:9000/torneos-payments-production', TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX },
    { ...HOSTED_CTX, gatewayPublicUrl: 'http://127.0.0.1:58420' });
    assert.deepEqual([lab.mode, lab.deployment], ['production', 'local-lab']);
    assert.deepEqual(loadCommerceConfig({}, HOSTED_CTX), { mode: 'off' });
    assert.equal(effectiveRpcAllowlist(BASE43, { mode: 'off' }), BASE43);
  });

  test('production refuses TEST hosts, TEST names, payments secrets, loopback and foreign URLs', () => {
    for (const [label, env, ctx] of [
      ['no payments host', { ...HOSTED_ENV, TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST: '' }],
      ['TEST payments host', { ...HOSTED_ENV, TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST: 'torneos-payments-test.example-org.deno.net',
        TORNEOS_PAYMENTS_INTERNAL_URL: 'https://torneos-payments-test.example-org.deno.net/functions/v1/torneos-payments-production' }],
      ['TEST mount', { ...HOSTED_ENV, TORNEOS_PAYMENTS_INTERNAL_URL: `https://${PAYMENTS_HOST}/functions/v1/torneos-payments` }],
      ['another host in the URL', { ...HOSTED_ENV, TORNEOS_PAYMENTS_INTERNAL_URL: 'https://evil.example.com/functions/v1/torneos-payments-production' }],
      ['remote TEST names', { ...HOSTED_ENV, TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: PAYMENTS_HOST }],
      ['remote-test deployment', { ...HOSTED_ENV, TORNEOS_COMMERCE_DEPLOYMENT: 'remote-test' }],
      ['Mercado Pago token in the gateway', { ...HOSTED_ENV, MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: 'APP_USR-x' }],
      ['payments DB in the gateway', { ...HOSTED_ENV, TORNEOS_PAYMENTS_DB_URL: 'postgres://x' }],
      ['short secret', { ...HOSTED_ENV, TORNEOS_PAYMENTS_INTERNAL_SECRET: 'ab'.repeat(16) }],
      ['loopback gateway', HOSTED_ENV, { ...HOSTED_CTX, gatewayPublicUrl: 'http://127.0.0.1:58420' }],
      ['http dependency', HOSTED_ENV, { ...HOSTED_CTX, dependencyUrls: [...HOSTED_CTX.dependencyUrls, 'http://core.example.com'] }],
      ['lab deployment off loopback', { ...HOSTED_ENV, TORNEOS_COMMERCE_DEPLOYMENT: 'local-lab' }],
      ['unknown mode', { TORNEOS_COMMERCE_MODE: 'live' }],
    ]) assert.ok(refused(env, ctx), label);
    // The secret must differ from the gateway's own secrets.
    assert.match(refused(HOSTED_ENV, { ...HOSTED_CTX, distinctFrom: [SECRET_HEX] }), /distinct/);
  });

  test('TEST stays TEST: its own wrapper, never the production host variable', () => {
    assert.match(refused({ TORNEOS_COMMERCE_MODE: 'test', TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST: PAYMENTS_HOST,
      TORNEOS_PAYMENTS_INTERNAL_URL: 'http://torneos-functions:9000/torneos-payments', TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX },
    { ...HOSTED_CTX, gatewayPublicUrl: 'http://127.0.0.1:58420' }), /production only/);
    const lab = loadCommerceConfig({ TORNEOS_COMMERCE_MODE: 'test', TORNEOS_PAYMENTS_INTERNAL_URL: 'http://torneos-functions:9000/torneos-payments',
      TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX }, { ...HOSTED_CTX, gatewayPublicUrl: 'http://127.0.0.1:58420' });
    assert.equal(lab.mode, 'test');
    assert.deepEqual([...lab.readRpcs].sort(), ['get_effective_tournament_season_entitlements', 'get_tournament_purchase', 'get_tournament_season_purchases']);
  });
});

// ============================================================================ Part E — the whole chain on the lab
describe('checkout and refresh through the gateway (lab database, production payments service)', async () => {
  const lab = await import('./lab/pg-lab.mjs');
  const fx = await import('./lab/fixtures.mjs');
  const mp = emulator();
  let db;
  let payments;
  const actors = new Map();
  const PAY_URL = 'http://torneos-functions:9000/torneos-payments-production';
  const REST = 'http://torneos-rest:3000';
  const cfg = () => loadCommerceConfig({ TORNEOS_COMMERCE_MODE: 'production', TORNEOS_COMMERCE_DEPLOYMENT: 'local-lab', TORNEOS_PAYMENTS_INTERNAL_URL: PAY_URL,
    TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX }, { ...HOSTED_CTX, gatewayPublicUrl: 'http://127.0.0.1:58420' });
  const restCalls = [];
  let paymentsDown = false;

  /** PostgREST over the lab: the bearer names the identity; named arguments; refusals as PostgREST answers them. */
  async function postgrest(url, init) {
    const name = url.slice(`${REST}/rpc/`.length);
    restCalls.push(name);
    const actor = actors.get(new Headers(init.headers).get('authorization')?.slice(7));
    if (!actor) return new Response(JSON.stringify({ message: 'invalid identity token' }), { status: 401 });
    const args = JSON.parse(init.body);
    const call = `select public.${name}(${Object.entries(args).map(([k, v]) => `${k} := ${fx.lit(v)}`).join(', ')})`;
    try {
      return new Response(fx.asUser(actor, call), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      const token = /TORNEOS_[A-Z_]+/.exec(error.message)?.[0] ?? 'internal';
      return new Response(JSON.stringify({ message: token }), { status: /42501/.test(error.message) ? 403 : 400 });
    }
  }
  const doFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith(`${REST}/rpc/`)) return postgrest(url, init);
    if (url.startsWith(PAY_URL)) {
      if (paymentsDown) throw new TypeError('connect ECONNREFUSED');
      return payments.fetch(new Request(url.replace(PAY_URL, 'https://payments.unit.invalid/functions/v1/torneos-payments-production'), init));
    }
    throw new TypeError(`unexpected ${url}`);
  };
  const tokenOf = (actor) => { const token = `bridge-${actor.id}`; actors.set(token, actor); return token; };
  const hooks = () => ({
    verifyBridge: async (token) => { const a = actors.get(token); if (!a) throw new Error('bad token'); return { sub: a.id, core_user_id: a.core, session_id: randomUUID() }; },
    activeSession: async () => {}, identityExists: async () => true, isUnavailable: () => false,
    restUrl: REST, restApiKey: null, fetch: doFetch, log: () => {},
  });
  const body = (value) => { const bytes = new TextEncoder().encode(JSON.stringify(value)); return { contentLength: String(bytes.length), body: [bytes] }; };
  const checkoutAs = (actor, w, key = randomUUID(), extra = {}) => seasonCheckout({ authorization: `Bearer ${tokenOf(actor)}`, search: '',
    ...body({ organizationId: w.org, seasonId: w.season, idempotencyKey: key, ...extra }) }, cfg(), hooks());
  const refreshAs = (actor, purchaseId) => purchaseRefresh({ authorization: `Bearer ${tokenOf(actor)}`, search: '', ...body({ purchaseId }) }, cfg(), hooks());

  before(async () => {
    // A fresh database: the emulator's payment ids restart per instance (an earlier run's ids are real conflicts).
    await lab.up({ fresh: true });
    db = labProductionDb();
    payments = service({ db, mp, env: LAB_ENV });
    fx.setScope('open');
  });
  after(async () => { fx.setScope('off', 'Laboratorio cerrado al terminar'); await db?.end(); });

  test('Comprar Premium: one production purchase, a Mercado Pago checkout URL, nothing priced by the browser', async () => {
    const w = fx.world('gw-buy');
    const r = await checkoutAs(w.owner, w);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.purchase.providerEnvironment, 'production');
    assert.equal(r.body.purchase.amount, 39900);
    assert.match(r.body.preference.checkoutUrl, /^https:\/\/www\.mercadopago\.com\.ar\//);
    assert.deepEqual(restCalls.slice(-1), ['create_tournament_season_production_checkout_purchase']);
    // A body that tries to carry a price, a provider or an environment is refused before the database.
    const before = restCalls.length;
    assert.deepEqual(await checkoutAs(w.owner, w, randomUUID(), { amount: 1 }), { status: 400, body: { error: 'TORNEOS_CHECKOUT_INVALID' } });
    assert.equal(restCalls.length, before);
  });

  test('double tap and retry: the same purchase and the same Preference', async () => {
    const w = fx.world('gw-double');
    const key = randomUUID();
    const [a, b] = await Promise.all([checkoutAs(w.owner, w, key), checkoutAs(w.owner, w, key)]);
    const c = await checkoutAs(w.owner, w, key);
    const ok = [a, b, c].filter((r) => r.status === 200);
    assert.ok(ok.length >= 2, JSON.stringify([a, b, c].map((r) => r.body)));
    assert.equal(new Set(ok.map((r) => r.body.purchase.id)).size, 1);
    assert.equal(new Set(ok.map((r) => r.body.preference.preferenceId)).size, 1);
  });

  test('closed switch, collaborators and outsiders never reach Mercado Pago', async () => {
    const w = fx.world('gw-refuse');
    const posts = () => mp.calls.filter((c) => c === 'POST /checkout/preferences').length;
    const start = posts();
    fx.setScope('off');
    assert.deepEqual(await checkoutAs(w.owner, w), { status: 409, body: { error: 'TORNEOS_BILLING_DISABLED' } });
    fx.setScope('open');
    const collaborator = fx.member(w.org, 'collaborator', [w.season]);
    assert.deepEqual(await checkoutAs(collaborator, w), { status: 403, body: { error: 'TORNEOS_BILLING_FORBIDDEN' } });
    assert.deepEqual(await checkoutAs(fx.identity('gw-outsider'), w), { status: 403, body: { error: 'TORNEOS_BILLING_FORBIDDEN' } });
    assert.deepEqual(await seasonCheckout({ authorization: 'Bearer forged', search: '', ...body({ organizationId: w.org, seasonId: w.season, idempotencyKey: randomUUID() }) }, cfg(), hooks()),
      { status: 401, body: { error: 'access denied' } });
    assert.equal(posts(), start);
  });

  test('"I already paid": refresh asks Mercado Pago and shows Premium; others cannot refresh it', async () => {
    const w = fx.world('gw-refresh');
    const r = await checkoutAs(w.owner, w);
    mp.pay(r.body.preference.preferenceId, { status: 'approved', statusDetail: 'accredited', at: new Date(Date.now() - 5000).toISOString() });
    const refreshed = await refreshAs(w.owner, r.body.purchase.id);
    assert.deepEqual([refreshed.status, refreshed.body.refresh, refreshed.body.purchase.status], [200, 'verified', 'approved']);
    assert.equal(fx.planOf(w.org, w.season), 'PREMIUM');
    const other = fx.world('gw-refresh-other');
    assert.deepEqual(await refreshAs(other.owner, r.body.purchase.id), { status: 403, body: { error: 'TORNEOS_PURCHASE_FORBIDDEN' } });
    assert.deepEqual(await refreshAs(fx.identity('gw-refresh-outsider'), r.body.purchase.id), { status: 403, body: { error: 'TORNEOS_PURCHASE_FORBIDDEN' } });
    // Approved: a new checkout of the season is refused (Premium already active).
    assert.deepEqual(await checkoutAs(w.owner, w), { status: 409, body: { error: 'TORNEOS_SEASON_ALREADY_PREMIUM' } });
  });

  test('payments service down: checkout fails cleanly, refresh still shows the purchase', async () => {
    const w = fx.world('gw-down');
    const first = await checkoutAs(w.owner, w);
    paymentsDown = true;
    try {
      const w2 = fx.world('gw-down-2');
      const again = await checkoutAs(w2.owner, w2);
      assert.deepEqual(again, { status: 503, body: { error: 'TORNEOS_PAYMENTS_UNAVAILABLE' } });
      const refreshed = await refreshAs(w.owner, first.body.purchase.id);
      assert.deepEqual([refreshed.status, refreshed.body.refresh, refreshed.body.purchase.status], [200, 'unavailable', 'preference_created']);
    } finally {
      paymentsDown = false;
    }
  });

  test('a webhook after the refresh changes nothing; refund removes Premium and the season can be bought again', async () => {
    const w = fx.world('gw-refund');
    const r = await checkoutAs(w.owner, w);
    const paymentId = mp.pay(r.body.preference.preferenceId, { status: 'approved', statusDetail: 'accredited', at: new Date(Date.now() - 60_000).toISOString() });
    assert.equal((await refreshAs(w.owner, r.body.purchase.id)).body.purchase.status, 'approved');
    assert.equal((await send(payments, webhookRequest({ dataId: paymentId }))).body.outcome, 'provider_snapshot_duplicate');
    mp.panelRefund(paymentId, { at: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await send(payments, webhookRequest({ dataId: paymentId }))).body.outcome, 'reversal_applied');
    assert.equal(fx.planOf(w.org, w.season), 'FREE');
    const again = await checkoutAs(w.owner, w);
    assert.equal(again.status, 200);
    assert.notEqual(again.body.purchase.id, r.body.purchase.id);
  });
});
