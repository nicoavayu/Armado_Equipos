#!/usr/bin/env node
// MP-A5 — local browser journey of the hybrid Premium checkout. Lab only, loopback only.
//
//   node scripts/torneos-frontend/mp-a5-browser-journey.mjs billing   (app started with REACT_APP_TORNEOS_BILLING_MODE=test)
//   node scripts/torneos-frontend/mp-a5-browser-journey.mjs off       (app started without it)
//
// Needs the commerce lab (PHASE3A_LAB_PROJECT=arma2-b04-hybrid-lab TORNEOS_LAB_MODE=commerce node lab.mjs up, plus the
// compose.b04.yaml core-api port) and the app of start-hybrid-lab-app.mjs --start on http://localhost:3000.
//
// What is real: Core GoTrue sessions, the app bundle, /exchange, the Node gateway (commerce TEST), the DB wrapper,
// torneos-payments, the mp-stub Preference and the signed Mercado Pago webhook. What is mocked: only the Checkout Pro
// page itself. The browser never leaves loopback: every other host is aborted and recorded, and the Checkout Pro URL
// (validated by the app before it navigates) is fulfilled here by a local page; the harness then pays through the
// stub, sends the signed webhook and follows the Preference's own back_urls with its origin rewritten to the app.
// Lab tokens and keys are read from the ignored .runtime, kept in memory and never printed or written.
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.PHASE3A_LAB_PROJECT ||= 'arma2-b04-hybrid-lab';
process.env.TORNEOS_LAB_MODE ||= 'commerce';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pl = await import(path.join(root, 'integration/torneos-core-contracts/payments-lab.mjs'));
const { chromium } = await import('playwright');

const MODE = process.argv[2] || 'billing';
if (!['billing', 'off'].includes(MODE)) throw new Error('mode: billing | off');
const APP = 'http://localhost:3000';
const CORE = 'http://127.0.0.1:58424';        // lab Core API (fixtures only; the app goes through the bridge 58422)
const GATEWAY = 'http://127.0.0.1:58420';     // lab Node gateway (fixtures only; the app goes through the bridge 58423)
const STUB = 'http://127.0.0.1:58426';
const LAB_APP_PUBLIC_ORIGIN = 'https://torneos-mp-a3.lab.invalid';   // APP_PUBLIC_URL of the lab payments service
const OUT = process.env.MP_A5_JOURNEY_OUT || path.join(root, 'backend/torneos/mp-a/evidence/mp-a5');
const SHOTS = process.env.MP_A5_SCREENSHOTS || null;
const RUN = `mpa5${randomBytes(2).toString('hex')}`;
const cfg = pl.cfg;
if (!cfg?.mpa) throw new Error('commerce lab .runtime missing (TORNEOS_LAB_MODE=commerce node lab.mjs up)');
const LOOPBACK = new Set(['localhost', '127.0.0.1']);
const isCheckoutPro = (host) => host === 'mercadopago.com' || host.endsWith('.mercadopago.com')
  || host === 'mercadopago.com.ar' || host.endsWith('.mercadopago.com.ar');
const COMMERCE_READS = ['get_effective_tournament_season_entitlements', 'get_tournament_purchase'];

const results = [];
const evidence = { suite: `MP-A5 browser journey — ${MODE}`, run: RUN, app: APP, steps: [], network: {}, db: {} };
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', ms: Date.now() - started, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', ms: Date.now() - started, error: String(error?.message || error).slice(0, 400) });
    console.log(`FAIL ${name}\n     ${String(error?.message || error).split('\n')[0]}`);
  }
}
const expect = (condition, message) => { if (!condition) throw new Error(message); };

// ---------------------------------------------------------------- Core users + gateway fixtures (lab API, not the UI)
async function core(pathname, { body, bearer = cfg.anonKey } = {}) {
  const r = await fetch(`${CORE}${pathname}`, {
    method: 'POST', headers: { apikey: cfg.anonKey, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
async function coreUser(label) {
  const email = `${RUN}-${label}@lab.test`;
  const signup = await core('/auth/v1/signup', { body: { email, password: `pw-${randomUUID()}`, data: { full_name: `MP-A5 ${label}`, nombre: `MP-A5 ${label}` } } });
  expect(signup.status === 200 && signup.json?.user?.id, `signup ${label} → ${signup.status}`);
  return { label, email, coreId: signup.json.user.id };
}
async function coreSession(user) {
  const link = await core('/auth/v1/admin/generate_link', { bearer: cfg.serviceRoleKey, body: { type: 'magiclink', email: user.email } });
  expect(link.status === 200 && link.json?.hashed_token, `generate_link → ${link.status}`);
  const verified = await core('/auth/v1/verify', { body: { type: 'magiclink', token_hash: link.json.hashed_token } });
  expect(verified.status === 200 && verified.json?.access_token, `verify → ${verified.status}`);
  return verified.json;
}
async function gateway(pathname, token, body) {
  const r = await fetch(`${GATEWAY}${pathname}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: r.status, json };
}
async function bridgeToken(user) {
  const session = await coreSession(user);
  const r = await gateway('/exchange', session.access_token);
  expect(r.status === 200, `exchange ${user.label} → ${r.status}`);
  return r.json.access_token;
}
const rpc = async (token, name, params) => gateway(`/torneos/rest/v1/rpc/${name}`, token, params);

// ---------------------------------------------------------------- browser
const net = [];
const blocked = [];
const checkoutPages = [];
let phase = 'setup';
async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (isCheckoutPro(url.hostname)) {
      checkoutPages.push({ phase, host: url.hostname, path: url.pathname });
      return route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>Checkout mock (lab)</title><main><h1>Checkout Pro — mock local del lab</h1>'
          + '<p>Ningún pago real. El harness MP-A5 resuelve este pago con el mp-stub y el webhook firmado.</p></main>',
      });
    }
    if (LOOPBACK.has(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    blocked.push({ phase, host: url.hostname });
    return route.abort('blockedbyclient');
  });
  context.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    const entry = { phase, method: request.method(), host: url.host, path: url.pathname };
    if (url.pathname === '/commerce/v1/season-checkout') {
      try { entry.body = JSON.parse(request.postData() || 'null'); } catch { entry.body = 'unparseable'; }
    }
    net.push(entry);
  });
  return context;
}
async function login(page, user) {
  const s = await coreSession(user);
  const fragment = new URLSearchParams({ access_token: s.access_token, refresh_token: s.refresh_token, token_type: 'bearer', type: 'magiclink', expires_in: String(s.expires_in) });
  await page.goto(`${APP}/auth/callback#${fragment.toString()}`);
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/callback'), { timeout: 30000 });
}
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${MODE}-${name}.png`), fullPage: true });
}
const heading = (page, name) => page.getByRole('heading', { name }).first();
const commerceRequests = (p = phase) => net.filter((e) => e.phase === p && e.path === '/commerce/v1/season-checkout');
const rpcRequests = (name, p = phase) => net.filter((e) => e.phase === p && e.path === `/torneos/rest/v1/rpc/${name}`);

async function openPlan(page, org, season) {
  await page.goto(`${APP}/torneos/organizacion/${org}/torneos?intent=premium`);
  await page.getByRole('link', { name: new RegExp(season.name) }).first().click();
  await page.waitForURL((u) => u.pathname === `/torneos/organizacion/${org}/temporada/${season.id}/plan`, { timeout: 20000 });
}

// The Checkout Pro page: pay through the stub, send the signed webhook, follow the Preference's back URL.
async function checkoutMock(page, { status, statusDetail, backUrl }) {
  await page.waitForURL((u) => isCheckoutPro(u.hostname), { timeout: 30000 });
  const checkout = new URL(page.url());
  const preferenceId = checkout.searchParams.get('pref_id');
  expect(checkout.protocol === 'https:' && preferenceId, 'Checkout Pro URL with pref_id');
  const pref = await (await fetch(`${STUB}/checkout/preferences/${encodeURIComponent(preferenceId)}`, { headers: { authorization: `Bearer ${cfg.mpa.accessToken}` } })).json();
  expect(pref?.back_urls?.success?.startsWith(`${LAB_APP_PUBLIC_ORIGIN}/`), 'Preference back_urls come from the payments service');
  const pay = await pl.stub('/__lab/payments', { preferenceId, status, statusDetail });
  const hook = await pl.webhook({ dataId: pay.paymentId });
  expect(hook.status === 200, `webhook ${status} → ${hook.status}`);
  const target = new URL(pref.back_urls[backUrl].replace(LAB_APP_PUBLIC_ORIGIN, APP));
  // What Mercado Pago appends to a back URL. The app must ignore every one of these for the state.
  for (const [k, v] of Object.entries({ collection_id: pay.paymentId, collection_status: status, payment_id: pay.paymentId, status,
    external_reference: pref.external_reference, payment_type: 'credit_card', merchant_order_id: pay.orderId, preference_id: preferenceId,
    site_id: 'MLA', processing_mode: 'aggregator' })) target.searchParams.set(k, String(v));
  await page.goto(target.toString());
  return { preferenceId, paymentId: pay.paymentId, webhook: hook.status, outcome: hook.body?.outcome, backPath: target.pathname };
}

async function settle(ms) { await new Promise((r) => setTimeout(r, ms)); }

// ================================================================= run
const browser = await chromium.launch();
try {
  const owner = await coreUser('owner');
  const ownerToken = await bridgeToken(owner);
  const org = await rpc(ownerToken, 'create_tournament_organization', { p_name: `MP-A5 ${RUN}`, p_slug: `mp-a5-${RUN}`, p_idempotency_key: randomUUID() });
  expect(org.status === 200, `organization → ${org.status}`);
  const ORG = org.json.organization.id;
  const seasons = {};
  for (const [key, name] of MODE === 'billing'
    ? [['approved', `Apertura ${RUN}`], ['pending', `Clausura ${RUN}`], ['rejected', `Invierno ${RUN}`], ['collab', `Verano ${RUN}`]]
    : [['off', `Apertura ${RUN}`], ['off2', `Clausura ${RUN}`]]) {
    // eslint-disable-next-line no-await-in-loop
    const s = await rpc(ownerToken, 'create_tournament_season', { p_organization_id: ORG, p_name: name, p_slug: `${key}-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() });
    expect(s.status === 200, `season ${key} → ${s.status}`);
    seasons[key] = { id: s.json.id, name };
  }
  evidence.fixture = { organizationId: ORG, seasons: Object.fromEntries(Object.entries(seasons).map(([k, v]) => [k, v.id])) };
  const context = await newContext(browser);
  const page = await context.newPage();
  phase = 'login';
  await login(page, owner);

  if (MODE === 'off') {
    // ------------------------------------------------------------- hybrid without the billing overlay
    phase = 'off';
    await check('OFF — login Core → Torneos → organization: exchange + staging-v1 RPCs work (B04 smoke)', async () => {
      await page.goto(`${APP}/torneos/organizacion/${ORG}/torneos`);
      await page.getByText(`MP-A5 ${RUN} · mp-a5-${RUN}`).first().waitFor({ timeout: 30000 });
      await settle(1500);
      const exchanges = net.filter((e) => e.path === '/exchange' && e.host === '127.0.0.1:58423').length;
      expect(exchanges >= 1, 'exchange through the gateway');
      for (const name of ['get_tournament_workspace_context', 'get_tournament_competition_context']) expect(rpcRequests(name).length >= 1, `${name} via gateway`);
      await shot(page, 'off-organization');
      return { exchanges };
    });
    await check('OFF — season plan and purchase routes render «no disponible»; settings offer no Plan link', async () => {
      await page.goto(`${APP}/torneos/organizacion/${ORG}/temporada/${seasons.off.id}/plan`);
      await page.getByText(/todavía no está habilitada/).first().waitFor({ timeout: 20000 });
      await page.goto(`${APP}/torneos/organizacion/${ORG}/temporada/${seasons.off.id}/plan/compra/${randomUUID()}/exito`);
      await page.getByText(/todavía no está habilitada/).first().waitFor({ timeout: 20000 });
      await page.goto(`${APP}/torneos/organizacion/${ORG}/configuracion`);
      await page.getByLabel('Nombre').waitFor({ timeout: 20000 });
      expect(await page.getByRole('link', { name: 'Plan', exact: true }).count() === 0, 'no Plan link');
      await shot(page, 'off-plan-unavailable');
    });
    await settle(1500);
  } else {
    // ------------------------------------------------------------- A: payments unavailable → retry (same key) → approved → Premium → refund → Free
    phase = 'A';
    let purchaseA;
    await check('A1 — Torneos → temporada → Plan: FREE with the server-side list/launch price and one-time payment', async () => {
      await openPlan(page, ORG, seasons.approved);
      await heading(page, 'Arma2 Torneos Free').waitFor({ timeout: 30000 });
      const text = await page.locator('#torneos-main').innerText();
      expect(/Precio habitual:\s*\$\s*49\.900/.test(text), 'list price 49.900 from the entitlement projection');
      expect(/\$\s*39\.900/.test(text), 'launch price 39.900 from the entitlement projection');
      expect(text.includes('Pago único para esta temporada · Sin suscripción'), 'one-time payment');
      expect(rpcRequests('get_effective_tournament_season_entitlements').length >= 1, 'entitlements read through the gateway');
      await shot(page, 'A1-plan-free');
    });
    await check('A2 — payments unavailable: a double click sends ONE checkout; the page shows the 503 copy and no redirect', async () => {
      await pl.stub('/__lab/fail', { method: 'POST', route: '/checkout/preferences', status: 502, times: 1 });
      await page.getByRole('button', { name: /Comprar Premium/ }).dblclick();
      await page.getByText(/servicio de pagos no está disponible/).waitFor({ timeout: 30000 });
      expect(commerceRequests().length === 1, `one checkout request (got ${commerceRequests().length})`);
      expect(checkoutPages.length === 0, 'no Checkout Pro navigation');
      await shot(page, 'A2-payments-unavailable');
      return { checkoutRequests: commerceRequests().length };
    });
    await check('A3 — retry reuses the same idempotency key; stale `created` purchase + valid Preference → validated Checkout Pro redirect', async () => {
      await page.getByRole('button', { name: /Comprar Premium/ }).click();
      await page.waitForURL((u) => isCheckoutPro(u.hostname), { timeout: 30000 });
      const [first, second] = commerceRequests();
      expect(second, 'second checkout request');
      expect(JSON.stringify(Object.keys(first.body)) === JSON.stringify(['organizationId', 'seasonId', 'idempotencyKey']), 'exact body keys');
      expect(first.body.idempotencyKey === second.body.idempotencyKey, 'same idempotency key on retry');
      expect(first.body.organizationId === ORG && first.body.seasonId === seasons.approved.id, 'org + season');
      expect(new URL(page.url()).hostname === 'www.mercadopago.com.ar', 'Checkout Pro host');
      const row = pl.purchaseRow(pl.j(pl.admin(`select to_jsonb(id) from public.tournament_purchases where season_id = ${pl.lit(seasons.approved.id)}`)));
      purchaseA = row.id;
      expect(row.status === 'preference_created', `DB purchase after checkout = ${row.status}`);
      return { idempotencyKeyReused: true, purchaseCount: Number(pl.admin(`select count(*) from public.tournament_purchases where season_id = ${pl.lit(seasons.approved.id)}`).trim()) };
    });
    let payA;
    await check('A4 — checkout mock → mp-stub approved → signed webhook → back URL /exito (with MP query params) → PurchaseStatus → Premium visible', async () => {
      payA = await checkoutMock(page, { status: 'approved', statusDetail: 'accredited', backUrl: 'success' });
      expect(payA.backPath.endsWith(`/plan/compra/${purchaseA}/exito`), 'back URL is the season purchase success route');
      await heading(page, 'Premium ya está activo').waitFor({ timeout: 30000 });
      const planCell = await page.getByText('Plan de la temporada').locator('xpath=following-sibling::dd').innerText();
      expect(planCell.trim() === 'Premium', `plan cell ${planCell}`);
      expect(rpcRequests('get_tournament_purchase').length >= 1, 'purchase read through the gateway');
      await shot(page, 'A4-premium-active');
      return { webhookOutcome: payA.outcome };
    });
    await check('A5 — Plan shows Premium as the current plan (server entitlement) and no purchase button', async () => {
      await page.getByRole('link', { name: 'Volver al Plan' }).click();
      await heading(page, 'Arma2 Torneos Premium').waitFor({ timeout: 30000 });
      expect(await page.getByRole('button', { name: /Comprar Premium/ }).count() === 0, 'no buy button');
      await shot(page, 'A5-plan-premium');
    });
    await check('A6 — refund mock → signed webhook → refresh: PurchaseStatus «reembolsado», Plan back to Free', async () => {
      await pl.stub('/__lab/payment-state', { paymentId: payA.paymentId, status: 'refunded', statusDetail: 'refunded' });
      const hook = await pl.webhook({ dataId: payA.paymentId });
      expect(hook.status === 200, `refund webhook ${hook.status}`);
      await page.goto(`${APP}/torneos/organizacion/${ORG}/temporada/${seasons.approved.id}/plan/compra/${purchaseA}/exito`);
      await heading(page, /pago fue reembolsado/).waitFor({ timeout: 30000 });
      expect(new URL(page.url()).pathname.endsWith('/fallo'), 'canonical failure route');
      const planCell = await page.getByText('Plan de la temporada').locator('xpath=following-sibling::dd').innerText();
      expect(planCell.trim() === 'Free', `plan cell ${planCell}`);
      await shot(page, 'A6-refunded');
      await page.getByRole('link', { name: 'Volver al Plan' }).click();
      await heading(page, 'Arma2 Torneos Free').waitFor({ timeout: 30000 });
      await shot(page, 'A6-plan-free-again');
      return { refundOutcome: hook.body?.outcome };
    });

    // ------------------------------------------------------------- B: pending → polling → approved while open → polling stops
    phase = 'B';
    let purchaseB;
    let payB;
    await check('B1 — checkout → mock in_process → back URL /pendiente → «esperando confirmación», polling every ~4 s, no Premium', async () => {
      await openPlan(page, ORG, seasons.pending);
      await heading(page, 'Arma2 Torneos Free').waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: /Comprar Premium/ }).click();
      payB = await checkoutMock(page, { status: 'in_process', statusDetail: 'pending_contingency', backUrl: 'pending' });
      await heading(page, /esperando confirmación/).waitFor({ timeout: 30000 });
      purchaseB = payB.backPath.split('/').at(-2);
      const before = rpcRequests('get_tournament_purchase').length;
      await settle(9000);
      const after = rpcRequests('get_tournament_purchase').length;
      expect(after - before >= 2, `polling (${after - before} reads in 9 s)`);
      expect(!(await page.locator('body').innerText()).includes('Premium ya está activo'), 'no Premium while pending');
      expect(pl.purchaseRow(purchaseB).status === 'pending', 'DB purchase pending');
      await shot(page, 'B1-pending');
      return { pollsIn9s: after - before };
    });
    await check('B2 — approval arrives while the page is open: polling shows Premium, then stops', async () => {
      await pl.stub('/__lab/payment-state', { paymentId: payB.paymentId, status: 'approved', statusDetail: 'accredited' });
      const hook = await pl.webhook({ dataId: payB.paymentId });
      expect(hook.status === 200, `webhook ${hook.status}`);
      await heading(page, 'Premium ya está activo').waitFor({ timeout: 20000 });
      expect(new URL(page.url()).pathname.endsWith('/exito'), 'canonical success route');
      const settled = rpcRequests('get_tournament_purchase').length;
      await settle(9000);
      expect(rpcRequests('get_tournament_purchase').length === settled, 'polling stopped at the final state');
      await shot(page, 'B2-approved-by-polling');
    });

    // ------------------------------------------------------------- C: rejected
    phase = 'C';
    await check('C1 — checkout → mock rejected → back URL /fallo: the purchase stays open (MP-A2.1) → pending route with the rejection notice, no Premium, Plan Free', async () => {
      await openPlan(page, ORG, seasons.rejected);
      await heading(page, 'Arma2 Torneos Free').waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: /Comprar Premium/ }).click();
      const pay = await checkoutMock(page, { status: 'rejected', statusDetail: 'cc_rejected_other_reason', backUrl: 'failure' });
      expect(pay.backPath.endsWith('/fallo'), 'back URL is the failure route');
      await heading(page, /último intento de pago no fue aprobado/).waitFor({ timeout: 30000 });
      expect(new URL(page.url()).pathname.endsWith('/pendiente'), 'the server state (open) decides the route, not /fallo');
      expect(!(await page.locator('body').innerText()).includes('Premium ya está activo'), 'no Premium');
      const row = pl.purchaseRow(pay.backPath.split('/').at(-2));
      expect(row.status === 'preference_created' && row.provider_status === 'rejected', `DB purchase ${row.status}/${row.provider_status}`);
      await shot(page, 'C1-rejected-attempt');
      await page.getByRole('link', { name: 'Volver al Plan' }).click();
      await heading(page, 'Arma2 Torneos Free').waitFor({ timeout: 30000 });
      return { purchaseStatus: row.status, providerStatus: row.provider_status };
    });

    // ------------------------------------------------------------- D: permission
    phase = 'D';
    await check('D1 — collaborator without billing.manage: sees the plan, cannot buy (UI), server refuses the checkout (403)', async () => {
      const collab = await coreUser('collab');
      const collabToken = await bridgeToken(collab);
      const ownerIdentity = pl.admin(`select id from public.torneos_identity where core_user_id = ${pl.lit(owner.coreId)}`).trim();
      const collabIdentity = pl.admin(`select id from public.torneos_identity where core_user_id = ${pl.lit(collab.coreId)}`).trim();
      expect(collabIdentity && ownerIdentity, 'identities exist after exchange');
      // Admin memberships have no RPC in staging v1 (B04): SQL, like R5.
      const membership = pl.admin(`insert into public.tournament_organization_members(organization_id, user_id, role, status, joined_at, invited_by) values (${pl.lit(ORG)}, ${pl.lit(collabIdentity)}, 'collaborator', 'active', now(), ${pl.lit(ownerIdentity)}) returning id`).trim();
      const assigned = await rpc(ownerToken, 'assign_tournament_season_member', { p_organization_id: ORG, p_season_id: seasons.collab.id, p_membership_id: membership });
      expect(assigned.status === 200, `assign season → ${assigned.status}`);
      const refused = await gateway('/commerce/v1/season-checkout', collabToken, { organizationId: ORG, seasonId: seasons.collab.id, idempotencyKey: randomUUID() });
      expect(refused.status === 403 && refused.json?.error === 'TORNEOS_BILLING_FORBIDDEN', `server checkout → ${refused.status} ${refused.json?.error}`);
      const collabContext = await newContext(browser);
      const collabPage = await collabContext.newPage();
      await login(collabPage, collab);
      await collabPage.goto(`${APP}/torneos/organizacion/${ORG}/temporada/${seasons.collab.id}/plan`);
      await heading(collabPage, 'Arma2 Torneos Free').waitFor({ timeout: 30000 });
      const button = collabPage.getByRole('button', { name: /Comprar Premium/ });
      expect(await button.isDisabled(), 'buy button disabled');
      await collabPage.getByText(/Sólo el Propietario o un Administrador pueden comprar/).waitFor();
      await shot(collabPage, 'D1-collaborator-plan');
      expect(commerceRequests().length === 0, 'no checkout request from the collaborator UI');
      await collabPage.goto(`${APP}/torneos/organizacion/${ORG}/temporada/${seasons.approved.id}/plan/compra/${purchaseA}/exito`);
      await collabPage.getByText(/No encontramos esa compra o no tenés permiso para verla/).waitFor({ timeout: 30000 });
      expect(!(await collabPage.locator('body').innerText()).includes('Premium ya está activo'), 'no Premium');
      await shot(collabPage, 'D1-collaborator-purchase-forbidden');
      await collabContext.close();
      return { serverCheckout: [refused.status, refused.json?.error] };
    });
    evidence.db = {
      purchases: pl.j(pl.admin(`select coalesce(json_agg(json_build_object('season', s.name, 'status', p.status, 'amount', p.amount_snapshot, 'provider', p.provider, 'environment', p.provider_environment) order by p.created_at), '[]') from public.tournament_purchases p join public.tournament_seasons s on s.id = p.season_id where p.organization_id = ${pl.lit(ORG)}`)),
    };
  }

  // ------------------------------------------------------------- network invariants (both modes)
  phase = 'network';
  await check(`${MODE === 'off' ? 'OFF' : 'N'} — network: loopback only; Checkout Pro only as the local mock; no Torneos or commerce traffic to Core; commerce only through the gateway`, async () => {
    const hosts = [...new Set(net.map((e) => e.host))].sort();
    // Requests the harness aborted (route) still emit a request event: they never left the browser.
    const blockedHosts = new Set(blocked.map((b) => b.host));
    const outside = net.filter((e) => !['localhost:3000', '127.0.0.1:58422', '127.0.0.1:58423'].includes(e.host)
      && !isCheckoutPro(e.host.split(':')[0]) && !blockedHosts.has(e.host));
    expect(outside.length === 0, `non-lab hosts reached: ${JSON.stringify(outside.slice(0, 3))}`);
    // The general Arma2 shell reads its own Core data (profile); Torneos and commerce never go to Core:
    // no Edge Function (legacy tournament-checkout), no tournament table/RPC, nothing commercial.
    const coreRequests = net.filter((e) => e.host === '127.0.0.1:58422');
    const corePaths = [...new Set(coreRequests.map((e) => `${e.method} ${e.path}`))].sort();
    const coreTorneos = coreRequests.filter((e) => e.path.startsWith('/functions/v1/') || e.path.startsWith('/storage/v1/')
      || /tournament|torneos|purchase|entitlement|checkout|payment/i.test(e.path));
    expect(coreTorneos.length === 0, `Torneos/commerce requests to Core: ${JSON.stringify(coreTorneos.slice(0, 3))}`);
    const gatewayPaths = net.filter((e) => e.host === '127.0.0.1:58423');
    const rpcNames = [...new Set(gatewayPaths.filter((e) => e.path.startsWith('/torneos/rest/v1/rpc/')).map((e) => e.path.split('/').pop()))].sort();
    const commerce = net.filter((e) => e.path === '/commerce/v1/season-checkout');
    const commerceReads = rpcNames.filter((n) => COMMERCE_READS.includes(n));
    if (MODE === 'off') {
      expect(commerce.length === 0 && commerceReads.length === 0, `commerce requests with billing off: ${commerce.length} checkout, ${commerceReads}`);
      expect(checkoutPages.length === 0, 'no Checkout Pro');
    } else {
      expect(commerce.every((e) => e.host === '127.0.0.1:58423' && e.method === 'POST'), 'checkout only via the gateway');
      expect(checkoutPages.every((p) => p.host === 'www.mercadopago.com.ar'), 'Checkout Pro host');
    }
    evidence.network = { hosts, corePaths, blockedNonLoopback: [...blockedHosts].map((host) => ({ host, aborted: blocked.filter((b) => b.host === host).length })), checkoutProMockPages: checkoutPages.length, rpcNames, commerceCheckoutRequests: commerce.length,
      commerceCheckoutBodies: commerce.map((e) => ({ phase: e.phase, keys: Object.keys(e.body || {}) })), requests: net.length };
    return { hosts, blocked: blocked.length, rpcNames: rpcNames.length, commerceCheckoutRequests: commerce.length };
  });
} finally {
  await browser.close();
  evidence.results = results;
  evidence.passed = results.filter((r) => r.status === 'PASS').length;
  evidence.total = results.length;
  const text = JSON.stringify(evidence, null, 2) + '\n';
  pl.assertNoLeak(text, [], 'MP-A5 journey evidence');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `browser-journey-${MODE}.json`), text);
  console.log(`\n${evidence.passed}/${evidence.total} PASS — evidence ${path.relative(root, path.join(OUT, `browser-journey-${MODE}.json`))}`);
  if (evidence.passed !== evidence.total) process.exitCode = 1;
}
