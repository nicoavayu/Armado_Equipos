#!/usr/bin/env node
// MP-A5.2 — focal browser repro adapted from the certified MP-A5 harness. Lab only, loopback only.
//
//   node docs/evidence/mp-a5-2/browser.mjs   (app started with REACT_APP_TORNEOS_BILLING_MODE=test)
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
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pl = await import(path.join(root, 'integration/torneos-core-contracts/payments-lab.mjs'));
const { chromium } = await import('playwright');

const APP = 'http://localhost:3000';
const CORE = 'http://127.0.0.1:58424';        // lab Core API (fixtures only; the app goes through the bridge 58422)
const GATEWAY = 'http://127.0.0.1:58420';     // lab Node gateway (fixtures only; the app goes through the bridge 58423)
const STUB = 'http://127.0.0.1:58426';
const LAB_APP_PUBLIC_ORIGIN = 'https://torneos-mp-a3.lab.invalid';   // APP_PUBLIC_URL of the lab payments service
const OUT = path.join(root, 'docs/evidence/mp-a5-2');
const RUN = `mpa5${randomBytes(2).toString('hex')}`;
const cfg = pl.cfg;
if (!cfg?.mpa) throw new Error('commerce lab .runtime missing (TORNEOS_LAB_MODE=commerce node lab.mjs up)');
const LOOPBACK = new Set(['localhost', '127.0.0.1']);
const isCheckoutPro = (host) => host === 'mercadopago.com' || host.endsWith('.mercadopago.com')
  || host === 'mercadopago.com.ar' || host.endsWith('.mercadopago.com.ar');

const results = [];
const evidence = { suite: 'MP-A5.2 focal browser repro', run: RUN, app: APP, steps: [], network: {}, db: {} };
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
const heading = (page, name) => page.getByRole('heading', { name }).first();

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



const browser = await chromium.launch();
try {
  const owner = await coreUser('owner');
  const token = await bridgeToken(owner);
  const org = await rpc(token, 'create_tournament_organization', { p_name: `MP-A52 ${RUN}`, p_slug: `mp-a52-${RUN}`, p_idempotency_key: randomUUID() });
  expect(org.status === 200, 'organization');
  const ORG = org.json.organization.id;
  const response = await rpc(token, 'create_tournament_season', { p_organization_id: ORG, p_name: `Season ${RUN}`, p_slug: RUN, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() });
  expect(response.status === 200, 'season');
  const season = { id: response.json.id, name: `Season ${RUN}` };
  const context = await newContext(browser);
  const page = await context.newPage();
  await login(page, owner);
  await page.goto(`${APP}/torneos/organizacion/${ORG}/temporada/${season.id}/plan`);
  await heading(page, 'Arma2 Torneos Free').waitFor();
  await page.getByRole('button', { name: /Comprar Premium/ }).click();
  const pay = await checkoutMock(page, { status: 'in_process', statusDetail: 'pending_contingency', backUrl: 'pending' });
  await heading(page, /esperando confirmación/).waitFor();
  const purchaseId = pay.backPath.split('/').at(-2);
  const marker = randomUUID();
  await page.evaluate((value) => { window.__mpa52Document = value; }, marker);
  await check('pending → approved while open → Plan Premium without reload', async () => {
    await pl.stub('/__lab/payment-state', { paymentId: pay.paymentId, status: 'approved', statusDetail: 'accredited' });
    expect((await pl.webhook({ dataId: pay.paymentId })).status === 200, 'approval webhook');
    await heading(page, 'Premium ya está activo').waitFor({ timeout: 20000 });
    expect(pl.grantEffective(purchaseId), 'effective grant');
    expect(Number(pl.admin(`select count(*) from public.tournament_season_plan_grants where origin_purchase_id = ${pl.lit(purchaseId)}`).trim()) === 1, 'one grant');
    await page.getByRole('link', { name: 'Volver al Plan' }).click();
    await heading(page, 'Arma2 Torneos Premium').waitFor();
    expect(await page.evaluate(() => window.__mpa52Document) === marker, 'same document');
    expect(await page.getByRole('button', { name: /Comprar Premium/ }).count() === 0, 'no buy button');
  });
  await page.goBack();
  await heading(page, 'Premium ya está activo').waitFor();
  await check('refund while open → refetch → Plan Free without reload', async () => {
    await pl.stub('/__lab/payment-state', { paymentId: pay.paymentId, status: 'refunded', statusDetail: 'refunded' });
    expect((await pl.webhook({ dataId: pay.paymentId })).status === 200, 'refund webhook');
    await page.getByRole('button', { name: 'Actualizar' }).click();
    await heading(page, 'El pago fue reembolsado').waitFor();
    await page.getByRole('link', { name: 'Volver al Plan' }).click();
    await heading(page, 'Arma2 Torneos Free').waitFor();
    expect(await page.evaluate(() => window.__mpa52Document) === marker, 'same document');
  });
  await check('one purchase, one Preference, no effective grant after refund', async () => {
    const purchases = Number(pl.admin(`select count(*) from public.tournament_purchases where season_id = ${pl.lit(season.id)}`).trim());
    expect(purchases === 1, 'one purchase');
    expect(checkoutPages.length === 1, 'one checkout');
    expect(net.filter((r) => r.path === '/commerce/v1/season-checkout').length === 1, 'one checkout request');
    expect(pl.purchaseRow(purchaseId).status === 'refunded', 'refunded purchase');
    expect(!pl.grantEffective(purchaseId), 'no effective grant after refund');
    expect(pl.purchaseRow(purchaseId).provider_preference_id === pay.preferenceId, 'same Preference');
    evidence.db = { purchases, purchaseId, preferenceId: pay.preferenceId, status: 'refunded' };
  });
} finally {
  await browser.close();
  evidence.results = results;
  evidence.network = { checkoutMockPages: checkoutPages.length, blockedHosts: [...new Set(blocked.map((r) => r.host))], allowedHosts: ['localhost', '127.0.0.1'], externalCheckoutFulfilledLocally: true };
  const output = JSON.stringify(evidence, null, 2);
  pl.assertNoLeak(output);
  fs.writeFileSync(path.join(OUT, 'browser.json'), output);
  if (results.some((r) => r.status !== 'PASS') || results.length !== 3) process.exitCode = 1;
}
