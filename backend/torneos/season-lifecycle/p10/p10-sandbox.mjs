// P10 — 0018 + 0013 + 0019 against the CURRENT Mercado Pago sandbox, in an isolated lab. Nothing touches Production.
//
//   Run it through the launcher (clean checkout, exact head, Node, Docker and network checks, hidden token prompt):
//     ~/Arma2Backups/p10-run.sh [A,B,C,D]
//   which ends in: printf token | node backend/torneos/season-lifecycle/p10/p10-sandbox.mjs --token-stdin --cases A,B,C,D
//
// What runs where:
//   database   a fresh local lab (pg-lab, container arma2-season-p10-db) with every migration of this branch, 0000→0019;
//   runtime    the REAL torneos-payments-production handler (same tree, same rpc.ts statements, production LOGIN with
//              SET LOCAL ROLE), as payments-harness wires it for the offline suites;
//   provider   the real api.mercadopago.com with the TEST seller's access token of the Arma2 app (typed by the operator in
//              the launcher's hidden prompt, piped on stdin, kept in memory only, never logged or written).
// The buyer side is a person: the operator pays each Checkout Pro link logged in as the TEST buyer, with the test cards
// (holder name APRO approved, OTHE rejected, CONT pending), and makes the refund of case C in the TEST seller's panel
// (the sandbox answers 401 to an API refund of a live_mode payment, and this script never moves money anyway).
// Mercado Pago cannot reach a local machine, so state comes in by the authoritative read the runtime already uses: the
// buyer's refresh route (/internal/v1/purchase-reconcile → /v1/payments/search by external_reference). Notifications
// are not part of P10: the webhook signature is covered by webhook-signature-sdk.test.mjs and the certified TEST chain
// of 2026-09-26.
//
// Lab-only adjustments, all in the fetcher below, and why:
//   1. Attestation. The production runtime refuses a TEST user (tag `test_user` on /users/me). The script first REQUIRES
//      that tag and that the token's seller is the account answering (a real seller stops the run before the lab is
//      built), then hands the runtime the same answer without that one tag. The sandbox already reports live_mode=true
//      for TEST-seller payments (observed 2026-09-26), so payments are not touched.
//   2. Return URLs. In its lab shape the runtime builds back_urls on `https://app.unit.invalid` (it never sends a buyer
//      anywhere real). For the person paying, the Preference sent to Mercado Pago carries the same paths on
//      RETURN_ORIGIN instead: the certified TEST host, whose router answers 404 to every path but its two routes (no
//      frontend, no database read, nothing of Production). The path builder itself is pinned by the unit suites.
//   3. notification_url stays the runtime's lab value (`*.invalid`: no traffic anywhere). Only if Mercado Pago refuses
//      the Preference BECAUSE of that field, the same Preference is sent once more with NOTIFICATION_SINK (a 404 path of
//      the same host, nothing listens) and the evidence says so. Never omitted: without it Mercado Pago could fall back to
//      the app-level webhook (the certified TEST app), which P10 must not drive.
// The fetcher is origin-locked to https://api.mercadopago.com and allows only the calls the runtime makes (GETs and the
// Preference POST): no refund, no payment creation.
import { appendFileSync, createReadStream, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MP_ORIGIN = 'https://api.mercadopago.com';
export const DEFAULT_CONTAINER = 'arma2-season-p10-db';
export const LAB_APP_ORIGIN = 'https://app.unit.invalid';
export const RETURN_ORIGIN = 'https://torneos-payments-test.nicoavayu.deno.net';
export const NOTIFICATION_SINK = `${RETURN_ORIGIN}/p10/notification-sink`;
export const ALL_CASES = Object.freeze(['A', 'B', 'C', 'D']);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_DIR = process.env.P10_EVIDENCE_DIR || path.resolve(HERE, '../../../../docs/torneos/commercial-season/evidence');

export const CASES = Object.freeze({
  A: 'open season: APRO → Premium for that season only',
  B: 'rejected (OTHE) keeps the purchase open and FREE, then pending (CONT) stays FREE',
  C: 'season closed before paying: APRO → approved + season_closed, manual refund, FREE; panel refund → refunded, FREE',
  D: 'double payment: a second APRO on case A\'s link → manual refund, still one grant',
});

/** The seller id is the last segment of a Mercado Pago access token (as the certified TEST session reads it). */
export const sellerOfToken = (token) => /-(\d{6,20})$/.exec(token ?? '')?.[1] ?? null;

/** Refuses anything that is not a TEST seller of site MLA (and, given the token, not that token's own seller). */
export function requireTestSeller(me, token = null) {
  const tags = Array.isArray(me?.tags) ? me.tags.map(String) : [];
  const id = typeof me?.id === 'number' || typeof me?.id === 'string' ? String(me.id) : '';
  if (!/^[1-9]\d{3,19}$/.test(id)) throw new Error('P10_SELLER_INVALID: /users/me has no numeric id');
  if (me.site_id !== 'MLA') throw new Error(`P10_SELLER_INVALID: site ${me.site_id}, expected MLA`);
  if (!tags.includes('test_user')) throw new Error('P10_NOT_A_TEST_SELLER: this token is not a Mercado Pago TEST user; P10 never runs with a real seller');
  if (token !== null && sellerOfToken(token) !== id) throw new Error('P10_SELLER_MISMATCH: the token does not belong to the account that answered /users/me');
  return id;
}

/** The runtime's lab back_urls moved to RETURN_ORIGIN (same paths); anything else in them is refused. */
export function returnUrls(backUrls) {
  const out = {};
  for (const [k, v] of Object.entries(backUrls ?? {})) {
    const u = new URL(String(v));
    if (u.origin !== LAB_APP_ORIGIN) throw new Error(`P10_BACK_URL_UNEXPECTED ${k}`);
    out[k] = `${RETURN_ORIGIN}${u.pathname}`;
  }
  return out;
}

/**
 * The runtime's fetcher: api.mercadopago.com only, the runtime's own calls only, plus the three adjustments above.
 * `stats` is evidence: calls per route, rewrites, and every Preference answer of Mercado Pago (status, what it stored).
 */
export function sandboxFetcher(baseFetch, { token = null } = {}) {
  const stats = { calls: {}, attestationRewrites: 0, preferences: [], notificationUrl: 'lab-invalid' };
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.origin !== MP_ORIGIN) throw new Error(`P10_ORIGIN_REFUSED ${url.origin}`);
    const isPreferencePost = method === 'POST' && url.pathname === '/checkout/preferences';
    if (method !== 'GET' && !isPreferencePost) throw new Error(`P10_CALL_REFUSED ${method} ${url.pathname}`);
    const key = `${method} ${url.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/\d+-[0-9a-f-]{36}$/, '/{id}')}`;
    stats.calls[key] = (stats.calls[key] ?? 0) + 1;
    if (isPreferencePost) return await postPreference(input, init);
    const response = await baseFetch(input, init);
    if (!response.ok) return response;
    if (url.pathname === '/users/me') {
      const me = await response.json();
      requireTestSeller(me, token);
      stats.attestationRewrites += 1;
      return new Response(JSON.stringify({ ...me, tags: me.tags.filter((t) => t !== 'test_user') }),
        { status: response.status, headers: { 'content-type': 'application/json' } });
    }
    if (/^\/checkout\/preferences\/[^/]+$/.test(url.pathname)) {
      const stored = await response.clone().json().catch(() => null);
      const entry = stats.preferences.find((p) => p.id === stored?.id);
      if (entry && !entry.stored) {
        entry.stored = { backUrlsOrigin: [...new Set(Object.values(stored.back_urls ?? {}).map((u) => new URL(u).origin))],
          notificationHost: stored.notification_url ? new URL(stored.notification_url).host : null, autoReturn: stored.auto_return ?? null };
      }
    }
    return response;
  };
  async function postPreference(input, init) {
    const body = JSON.parse(String(init.body));
    const sent = { ...body, back_urls: returnUrls(body.back_urls) };
    let response = await baseFetch(input, { ...init, body: JSON.stringify(sent) });
    let refusal = response.ok ? null : await response.clone().text().catch(() => '');
    const record = { status: response.status, accepted: response.ok, backUrlsOrigin: RETURN_ORIGIN, notificationUrl: 'lab-invalid' };
    if (!response.ok && /notification_url/i.test(refusal)) {
      record.refusedFirst = { status: response.status, message: refusal.slice(0, 300) };
      const headers = { ...(init.headers ?? {}) };
      if (headers['X-Idempotency-Key']) headers['X-Idempotency-Key'] = `${headers['X-Idempotency-Key']}:p10-sink`;
      response = await baseFetch(input, { ...init, headers, body: JSON.stringify({ ...sent, notification_url: NOTIFICATION_SINK }) });
      refusal = response.ok ? null : await response.clone().text().catch(() => '');
      Object.assign(record, { status: response.status, accepted: response.ok, notificationUrl: 'sink' });
      stats.notificationUrl = 'sink';
    }
    if (!response.ok) record.message = refusal.slice(0, 300);
    else record.id = (await response.clone().json().catch(() => ({}))).id ?? null;
    stats.preferences.push(record);
    return response;
  }
  return { fetcher, stats };
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** The person could not do a step in Mercado Pago (they say so at the prompt): the case is PENDING, not failed. */
export class NotPerformed extends Error {
  constructor(reason) { super(`P10_NOT_PERFORMED: ${reason}`); this.reason = reason; }
}

/**
 * P10_PASS only with every case A–D run to the end and passed. A passing run with cases left out or not performed is
 * P10_PARTIAL, naming them; any failed check is P10_FAIL.
 */
export function verdictOf(checks, cases, notPerformed = []) {
  if (!checks.length || checks.some((c) => !c.ok)) return { verdict: 'P10_FAIL', pending: [] };
  const pending = ALL_CASES.filter((c) => !cases.includes(c) || notPerformed.some((n) => n.caseId === c));
  return pending.length ? { verdict: 'P10_PARTIAL', pending } : { verdict: 'P10_PASS', pending };
}

/**
 * Runs the chosen cases. `human.pay({ caseId, initPoint, card, note })` and `human.refund({ caseId, paymentId })` are
 * the buyer/seller steps (a person in the CLI, the emulator in the offline test). `provider` names what answered as
 * Mercado Pago ('mercadopago' only for the real API). Returns the evidence object.
 */
export async function runP10({ accessToken, baseFetch, human, provider, cases = ALL_CASES, pollMs = 20000, maxPolls = 45,
  ageClaims = false, fresh = true, log = () => {}, onSeller = () => {} }) {
  if (!['mercadopago', 'emulator'].includes(provider)) throw new Error('P10_PROVIDER_REQUIRED');
  // The seller first: a token that is not a TEST user stops the run before the lab is even built.
  const meResponse = await baseFetch(`${MP_ORIGIN}/users/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
  if (!meResponse.ok) throw new Error(`P10_TOKEN_REFUSED: /users/me answered ${meResponse.status}`);
  const me = await meResponse.json();
  const sellerId = requireTestSeller(me, accessToken);
  await onSeller({ id: sellerId, nickname: String(me.nickname ?? '') });
  const lab = await import('../../commerce-production/lab/pg-lab.mjs');
  const fx = await import('../../commerce-production/lab/fixtures.mjs');
  const H = await import('../../commerce-production/lab/payments-harness.mjs');
  const { fetcher, stats } = sandboxFetcher(baseFetch, { token: accessToken });

  const started = new Date().toISOString();
  const migrations = await lab.up({ fresh });
  fx.setScope('open', 'P10 sandbox');
  const db = H.labProductionDb();
  const env = { ...H.LAB_ENV, MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: accessToken, MERCADO_PAGO_PRODUCTION_SELLER_ID: sellerId };
  const svc = H.createProductionPaymentsService({ env, connectDb: () => db, fetcher, log: () => {} });
  const lit = fx.lit;
  const offer = fx.j(fx.admin(`select to_jsonb(o) from public.tournament_commercial_offers o where product_code = 'torneos_premium'
    and availability = 'available' order by valid_from desc, offer_version desc limit 1`));
  const evidence = { started, provider: { kind: provider, sellerIsTestUser: true, stats }, cases: {}, checks: [], casesRun: cases, notPerformed: [],
    lab: { container: lab.CONTAINER, migrationsApplied: migrations.applied?.length ?? null },
    offer: { amount: offer.amount, list: offer.list_amount, label: offer.offer_label } };
  const check = (caseId, name, ok, got) => { evidence.checks.push({ caseId, name, ok: Boolean(ok), got }); log(`${ok ? 'PASS' : 'FAIL'} ${caseId} ${name} ${JSON.stringify(got)}`); };
  const activate = (w) => fx.asUserJson(w.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_status => 'active')`);
  const close = (w) => fx.asUserJson(w.owner, `select public.update_tournament_season(${lit(w.org)}, ${lit(w.season)}, p_status => 'completed', p_confirm_media_deletion => true)`);

  async function prepared(caseId, label, { closeBeforePaying = false } = {}) {
    const w = fx.world(`p10-${label}`);
    activate(w);
    const p = fx.checkout(w.owner, w);
    const r = await H.send(svc, H.internalRequest(H.PREFERENCE_PATH, { purchase_id: p.id }));
    const answer = stats.preferences.at(-1) ?? null;
    check(caseId, 'Mercado Pago accepted the Preference', r.status === 200 && answer?.accepted === true,
      { runtime: r.status, mercadoPago: answer && { status: answer.status, notificationUrl: answer.notificationUrl, message: answer.message ?? null } });
    if (r.status !== 200) throw new Error(`P10_PREFERENCE_FAILED ${label}: ${r.status} ${JSON.stringify(r.body)}`);
    if (closeBeforePaying) close(w);
    return { ...w, id: p.id, initPoint: r.body.checkoutUrl, preferenceId: r.body.preferenceId, amount: fx.purchaseRow(p.id).amount_snapshot };
  }
  /** The buyer's refresh until `done(row, answer)`; each poll is one real reconcile through the runtime. */
  async function until(p, done, what) {
    let answer = null;
    for (let i = 0; i < maxPolls; i += 1) {
      if (ageClaims) fx.admin(`UPDATE public.tournament_purchase_provider_checks SET last_claimed_at = last_claimed_at - interval '1 minute' WHERE purchase_id = ${lit(p.id)}`);
      answer = await H.send(svc, H.internalRequest(H.RECONCILE_PATH, { purchase_id: p.id }));
      const row = fx.purchaseRow(p.id);
      if (answer.body?.outcome !== 'recently_checked' && done(row, answer.body ?? {})) return { row, answer: answer.body };
      await sleep(pollMs);
    }
    throw new Error(`P10_TIMEOUT waiting for ${what} on ${p.id} (last ${JSON.stringify(answer?.body)})`);
  }
  async function paymentIds(p) {
    const q = new URLSearchParams({ external_reference: fx.purchaseRow(p.id).external_reference, sort: 'date_created', criteria: 'asc', limit: '50' });
    const r = await fetcher(`${MP_ORIGIN}/v1/payments/search?${q}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } });
    return ((await r.json()).results ?? []).map((x) => String(x.id));
  }
  const grants = (p) => Number(fx.admin(`select count(*) from public.tournament_season_plan_grants where origin_purchase_id = ${lit(p.id)}`));
  const record = (caseId, p, extra = {}) => { evidence.cases[caseId] = { purchaseId: p.id, preferenceId: p.preferenceId, amount: p.amount, ...evidence.cases[caseId], ...extra }; };

  // A case that fails (a timeout, a refused Preference) is recorded as a FAIL and the next one still runs.
  async function stage(caseId, fn) {
    if (!cases.includes(caseId)) return;
    try {
      await fn();
    } catch (error) {
      if (error instanceof NotPerformed) { evidence.notPerformed.push({ caseId, reason: error.reason }); log(`PENDING ${caseId} ${error.reason}`); return; }
      check(caseId, 'completed', false, String(error.message).replaceAll(accessToken, '[token]'));
    }
  }
  try {
    let a = null;
    await stage(cases.includes('A') ? 'A' : 'D', async () => {
      a = await prepared('A', 'approved');
      const other = fx.season(a.owner, a.org, 'p10-other');
      record('A', a);
      check('A', 'purchase priced from the offer in force', a.amount === offer.amount, a.amount);
      await human.pay({ caseId: 'A', initPoint: a.initPoint, card: 'APRO', note: 'tarjeta aprobada' });
      const { row, answer } = await until(a, (r) => r.status === 'approved', 'approved');
      check('A', 'approved and verified', row.status === 'approved' && answer.outcome === 'verified', { status: row.status, outcome: answer.outcome });
      check('A', 'Premium for that season', fx.planOf(a.org, a.season) === 'PREMIUM', fx.planOf(a.org, a.season));
      check('A', 'another season of the same organization stays FREE', fx.planOf(a.org, other) === 'FREE', fx.planOf(a.org, other));
      check('A', 'exactly one grant', grants(a) === 1, grants(a));
      record('A', a, { paymentIds: await paymentIds(a) });
    });
    await stage('B', async () => {
      const b = await prepared('B', 'rejected-pending');
      record('B', b);
      await human.pay({ caseId: 'B', initPoint: b.initPoint, card: 'OTHE', note: 'tarjeta rechazada' });
      const first = await until(b, (r, x) => x.outcome !== 'no_payment', 'the rejected attempt');
      check('B', 'rejected attempt keeps the purchase open', ['preference_created', 'pending'].includes(first.row.status), { status: first.row.status, outcome: first.answer.outcome });
      check('B', 'FREE after the rejection', fx.planOf(b.org, b.season) === 'FREE', fx.planOf(b.org, b.season));
      await human.pay({ caseId: 'B', initPoint: b.initPoint, card: 'CONT', note: 'pago pendiente, MISMO link' });
      const ids = await paymentIds(b);
      const second = await until(b, (r) => ids.length >= 2 || r.status === 'pending', 'the pending attempt');
      const after = await paymentIds(b);
      check('B', 'pending attempt recorded, still FREE', fx.planOf(b.org, b.season) === 'FREE' && second.row.status !== 'approved',
        { status: second.row.status, outcome: second.answer.outcome, payments: after.length });
      record('B', b, { paymentIds: after });
    });
    await stage('C', async () => {
      const c = await prepared('C', 'late', { closeBeforePaying: true });
      record('C', c);
      check('C', 'the season is closed before paying', fx.admin(`select status from public.tournament_seasons where id = ${lit(c.season)}`).trim() === 'completed', null);
      await human.pay({ caseId: 'C', initPoint: c.initPoint, card: 'APRO', note: 'tarjeta aprobada, con la temporada YA cerrada' });
      const late = await until(c, (r) => r.status === 'approved', 'the late approval');
      check('C', 'approved + season_closed, manual refund', late.row.activation_error_code === 'season_closed' && late.answer.outcome === 'requires_manual_refund',
        { status: late.row.status, activation: late.row.activation_error_code, outcome: late.answer.outcome });
      check('C', 'no Premium, no grant', fx.planOf(c.org, c.season) === 'FREE' && grants(c) === 0, { plan: fx.planOf(c.org, c.season), grants: grants(c) });
      const [paymentId] = await paymentIds(c);
      record('C', c, { paymentIds: [paymentId] });
      await human.refund({ caseId: 'C', paymentId, amount: c.amount });
      const refunded = await until(c, (r) => r.status === 'refunded', 'the refund');
      check('C', 'refunded once, still FREE', refunded.row.status === 'refunded' && Boolean(refunded.row.refunded_at) && fx.planOf(c.org, c.season) === 'FREE',
        { status: refunded.row.status, plan: fx.planOf(c.org, c.season) });
      const events = fx.eventTypes(c.id);
      check('C', 'one late-payment event and one refund event',
        events.filter((e) => e === 'payment.approved_season_closed').length === 1 && events.filter((e) => e === 'payment.season_closed_refunded').length === 1, events);
    });
    await stage('D', async () => {
      if (!a) throw new Error('P10_SKIPPED: case A did not prepare its purchase');
      const before = (await paymentIds(a)).length;
      await human.pay({ caseId: 'D', initPoint: a.initPoint, card: 'APRO', note: 'un SEGUNDO pago aprobado sobre el link del caso A' });
      const dbl = await until(a, () => true, 'the second payment');
      const after = await paymentIds(a);
      check('D', 'second payment seen by the search', after.length === before + 1, { before, after: after.length });
      check('D', 'it asks for a manual refund, still one grant, still Premium', dbl.answer.outcome === 'requires_manual_refund' && grants(a) === 1 && fx.planOf(a.org, a.season) === 'PREMIUM',
        { outcome: dbl.answer.outcome, grants: grants(a), plan: fx.planOf(a.org, a.season) });
      record('D', a, { paymentIds: after });
    });
  } finally {
    fx.setScope('off', 'P10 terminado');
    await db.end();
    await H.tree.cleanup?.();
  }
  evidence.finished = new Date().toISOString();
  Object.assign(evidence, verdictOf(evidence.checks, cases, evidence.notPerformed));
  // What only the real provider can show; an emulator run proves the wrapper, never these.
  evidence.realProviderFacts = provider === 'mercadopago'
    ? { preferenceAcceptance: stats.preferences.map(({ status, accepted, notificationUrl, stored }) => ({ status, accepted, notificationUrl, stored: stored ?? null })) }
    : 'not established (emulator run)';
  return evidence;
}

// ------------------------------------------------------------------------------------------------ CLI (a person)
/** A line typed on the terminal itself (stdin carries the token). */
async function ask(prompt) {
  const { createInterface } = await import('node:readline/promises');
  const input = createReadStream('/dev/tty');
  const rl = createInterface({ input, output: process.stdout });
  const answer = await rl.question(prompt); rl.close(); input.destroy();
  return answer.trim();
}
const enter = async (prompt) => { await ask(prompt); };
/** Enter = done; `n` + a reason = it could not be done in Mercado Pago (the case stays PENDING with that reason). */
async function doneOrNot(caseId, what) {
  const answer = await ask(`[${caseId}] Enter cuando ${what}. Si Mercado Pago NO lo permitió, escribí  n <motivo>  y Enter: `);
  if (/^n\b/i.test(answer)) throw new NotPerformed(answer.replace(/^n\s*/i, '').slice(0, 200) || 'sin motivo');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--token-stdin')) {
    console.error('P10_USE_LAUNCHER: run ~/Arma2Backups/p10-run.sh (it checks the checkout, Docker and networks, and asks the token hidden)');
    process.exit(2);
  }
  process.env.COMMERCE_PRODUCTION_LAB_CONTAINER ||= DEFAULT_CONTAINER;
  const casesArg = process.argv.includes('--cases') ? process.argv[process.argv.indexOf('--cases') + 1] : ALL_CASES.join(',');
  const cases = ALL_CASES.filter((c) => casesArg.toUpperCase().split(',').map((s) => s.trim()).includes(c));
  let accessToken = readFileSync(0, 'utf8').trim();
  if (!/^APP_USR-\d{6,20}-\d{6}-[0-9a-f]{32}-\d{6,20}$/.test(accessToken)) { console.error('P10_TOKEN_SHAPE'); process.exit(2); }
  const human = {
    async pay({ caseId, initPoint, card, note }) {
      console.log(`\n[${caseId}] Pagá este link en la ventana privada del COMPRADOR de prueba, con la tarjeta de prueba y titular ${card} (${note}):\n\n      ${initPoint}\n\n      Al terminar, Mercado Pago te manda a torneos-payments-test…deno.net y ves un 404: es lo esperado.`);
      await doneOrNot(caseId, 'Mercado Pago haya mostrado el resultado');
    },
    async refund({ caseId, paymentId, amount }) {
      console.log(`\n[${caseId}] En la ventana del VENDEDOR de prueba: Tu actividad → el pago ${paymentId} ($ ${amount}) → Devolver dinero → devolución total.`);
      await doneOrNot(caseId, 'el panel lo muestre devuelto');
    },
  };
  const onSeller = async ({ id, nickname }) => {
    console.log(`\nVendedor de prueba comprobado por Mercado Pago: ${nickname} (id ${id}, tag test_user, MLA). Tiene que ser el mismo usuario de la ventana del vendedor.`);
    await enter('Apretá Enter para crear el laboratorio y el primer link… ');
  };
  try {
    console.log(`P10 — sandbox de Mercado Pago contra un laboratorio local (0000→0019). Producción no se toca.\nCasos: ${cases.map((c) => `\n  ${c}  ${CASES[c]}`).join('')}${cases.length < ALL_CASES.length ? '\n  (corrida PARCIAL: los casos que falten quedan pendientes, no certificados)' : ''}\n`);
    const evidence = await runP10({ accessToken, baseFetch: fetch, provider: 'mercadopago', human, cases, onSeller, log: (line) => console.log(line) });
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const file = path.join(EVIDENCE_DIR, `p10-sandbox-${evidence.started.replace(/[-:]/g, '').slice(0, 15)}Z.txt`);
    const text = `${JSON.stringify(evidence, null, 2)}\n`;
    if (text.includes(accessToken)) throw new Error('P10_EVIDENCE_WOULD_CONTAIN_THE_TOKEN');
    appendFileSync(file, text);
    console.log(`\n${evidence.verdict}${evidence.pending.length ? ` (pendientes: ${evidence.pending.join(', ')})` : ''} — evidencia ${file}`);
    accessToken = '';
    process.exit(evidence.verdict === 'P10_PASS' ? 0 : evidence.verdict === 'P10_PARTIAL' ? 3 : 1);
  } catch (error) {
    console.error(String(error.message).replaceAll(accessToken, '[token]'));
    process.exit(1);
  }
}
