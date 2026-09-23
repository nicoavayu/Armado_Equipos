// MP-A3 — shared helpers of the torneos-payments suites (T3/T4/T5) on the local commerce lab
// (TORNEOS_LAB_MODE=commerce node lab.mjs up). Local only: the payments function is reached on the
// loopback edge-runtime port, the Mercado Pago API is the lab mp-stub, the database is the lab Torneos
// DB (0000 → 0001 → 0002). Secrets come from the ignored .runtime and are never printed; every suite
// scans its own evidence and the container logs for them.
import assert from 'node:assert/strict';
import { createHmac, randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { config, sql, sqlTry, dc, repo, root, PAYMENTS_BASE, MP_STUB_BASE } from './lab.mjs';

export const cfg = await config().catch(() => null);
export const RUN = 'mpa3' + randomBytes(2).toString('hex');
export const INTERNAL_PATH = '/internal/v1/season-checkout-preference';
export const WEBHOOK_PATH = '/webhooks/mercadopago/v1';
export const EVIDENCE = `${repo}backend/torneos/mp-a/evidence/mp-a3/`;
export const TAG = process.env.MP_A3_EVIDENCE_TAG ? `-${process.env.MP_A3_EVIDENCE_TAG}` : '';
export const PAY = 'torneos_payment_service';

// ---------------------------------------------------------------- secrets (for leak scans only)
export function labSecrets() {
  if (!cfg) return [];
  const m = cfg.mpa ?? {};
  return [cfg.dbPassword, cfg.readerPassword, cfg.writerPassword, cfg.adapterPassword, cfg.paymentServicePassword, cfg.coreSecret,
    cfg.serviceRoleKey, cfg.anonKey, cfg.coreContractSecret, ...(cfg.keys ?? []).map(k => k.privateKey),
    m.internalSecret, m.webhookSecret, m.accessToken, m.stubControlToken].filter(Boolean);
}
/** Values that must never leave the service: lab secrets plus payer data that exists only inside the stub. */
export function assertNoLeak(text, extra = [], label = 'text') {
  for (const s of [...labSecrets(), ...extra]) assert.ok(!String(text).includes(s), `${label} leaks a secret/PII value (${createHash('sha256').update(s).digest('hex').slice(0, 8)})`);
  assert.ok(!/lab-payer-[0-9]+@payer\.invalid/.test(text), `${label} leaks payer e-mail`);
  assert.ok(!/postgres(ql)?:\/\/[^\s"']*:[^\s"'@]+@/.test(text), `${label} leaks a DB URL with password`);
  assert.ok(!/Bearer\s+TEST-/.test(text), `${label} leaks the MP bearer`);
}

// ---------------------------------------------------------------- internal HMAC client (the gateway's future call)
export function signInternal({ path = INTERNAL_PATH, time = Math.floor(Date.now() / 1000), nonce = randomUUID(), body, secretHex = cfg.mpa.internalSecret }) {
  const signature = createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${path}\n${time}\n${nonce}\n${body}`).digest('hex');
  return { 'x-time': String(time), 'x-nonce': nonce, 'x-signature': signature };
}
export async function http(path, { method = 'POST', headers = {}, body, query = '' } = {}) {
  const r = await fetch(`${PAYMENTS_BASE}${path}${query}`, { method, headers: { connection: 'close', ...headers }, body });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, text, body: json, headers: Object.fromEntries(r.headers) };
}
/** Signed internal call. `sign` overrides what is signed; `send` overrides what is sent. */
export async function internal(payload, { sign = {}, headers = {}, rawBody } = {}) {
  const body = rawBody ?? JSON.stringify(payload);
  const signed = signInternal({ body, ...sign });
  return http(INTERNAL_PATH, { headers: { 'content-type': 'application/json', ...signed, ...headers }, body });
}

// ---------------------------------------------------------------- Mercado Pago webhook client (official manifest)
export function mpSignature({ dataId, requestId, ts = Math.floor(Date.now() / 1000), secret = cfg.mpa.webhookSecret }) {
  const v1 = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${v1}`;
}
export async function webhook({ dataId, type = 'payment', payload, requestId = randomUUID(), signature, headers = {}, query, signId } = {}) {
  const body = payload ?? { action: type === 'payment' ? 'payment.updated' : 'chargeback.updated', api_version: 'v1', type,
    data: type === 'payment' ? { id: dataId } : { id: dataId, checkout: 'PRO' }, live_mode: false, user_id: Number(cfg.mpa.sellerId),
    date_created: new Date().toISOString(), id: Number(String(Date.now()).slice(-9)) };
  const q = query ?? `?data.id=${encodeURIComponent(dataId)}&type=${type}`;
  const sig = signature === undefined ? mpSignature({ dataId: signId ?? dataId, requestId }) : signature;
  return http(WEBHOOK_PATH, { query: q, headers: { 'content-type': 'application/json', ...(requestId !== null ? { 'x-request-id': requestId } : {}),
    ...(sig !== null ? { 'x-signature': sig } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

// ---------------------------------------------------------------- mp-stub control
export async function stub(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${MP_STUB_BASE}${path}`, { method, headers: { 'content-type': 'application/json', 'x-mp-stub-control': cfg.mpa.stubControlToken },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json();
  assert.equal(r.status, 200, `stub ${path}: ${JSON.stringify(json)}`);
  return json;
}
export const stubCalls = async () => (await stub('/__lab/calls')).calls;

// ---------------------------------------------------------------- lab DB fixtures (same actors/paths as T10)
export const lit = (v) => (v === null || v === undefined) ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
export const admin = (q) => sql('torneos-db', q);
/** Raw SQL as the installer; returns { ok, out, error } (never throws). */
export const sqlRaw = (q) => sqlTry('torneos-db', `\\set VERBOSITY verbose\n${q}`);
export const j = (s) => JSON.parse(s);
export function run(role, claims, query) {
  const r = sqlTry('torneos-db', `\\set VERBOSITY verbose\nBEGIN; ${role ? `SET LOCAL ROLE ${role};` : ''} SELECT set_config('request.jwt.claims', ${lit(claims ? JSON.stringify(claims) : '')}, true); ${query}; COMMIT;`);
  if (!r.ok) throw new Error(r.error || 'sql failed');
  return r.out.trim().split('\n').pop();
}
function claimsOf(actor) {
  const now = Math.floor(Date.now() / 1000);
  return { role: 'authenticated', iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local', sub: actor.id, core_user_id: actor.core,
    session_id: randomUUID(), jti: randomUUID(), iat: now, nbf: now, exp: now + 120 };
}
export function identity(label) {
  const a = { label, id: randomUUID(), core: randomUUID() };
  admin(`SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id, core_user_id) VALUES (${lit(a.id)}, ${lit(a.core)}); RESET ROLE;`);
  return a;
}
export const asUser = (actor, q) => run('authenticated', claimsOf(actor), q);
export const asPay = (q) => run(PAY, null, q);
let fixture;
/** One owner + organization per suite run; each call gives a fresh season (one purchase per season). */
export function newSeason(label) {
  if (!fixture) {
    const owner = identity('owner');
    const org = j(asUser(owner, `select public.create_tournament_organization(${lit(`MP-A3 ${RUN}`)}, ${lit(`mpa3-${RUN}`)}, ${lit(randomUUID())})`)).organization.id;
    fixture = { owner, org };
  }
  const season = j(asUser(fixture.owner, `select public.create_tournament_season(${lit(fixture.org)}, ${lit(`MP ${label} ${RUN}`)}, ${lit(`mp-${label}-${RUN}-${randomBytes(2).toString('hex')}`)}, null, null, ${lit(randomUUID())})`)).id;
  return { ...fixture, season };
}
/** A real MP TEST purchase created through the client wrapper (status created, price from the DB offer). */
export function newPurchase(label) {
  const f = newSeason(label);
  const p = j(asUser(f.owner, `select public.create_tournament_season_checkout_purchase(${lit(f.org)}, ${lit(f.season)}, ${lit(randomUUID())})`));
  return { ...f, id: p.id, externalReference: p.externalReference, amount: p.amount, currency: p.currency };
}
export const purchaseRow = (id) => j(admin(`select to_jsonb(x) from public.tournament_purchases x where id = ${lit(id)}`));
export const eventTypes = (id) => j(admin(`select coalesce(json_agg(event_type order by id), '[]') from public.tournament_purchase_events where purchase_id = ${lit(id)}`));
export const grantEvents = (id) => j(admin(`select coalesce(json_agg(e.event_type order by e.id), '[]') from public.tournament_season_plan_grant_events e join public.tournament_season_plan_grants g on g.id = e.season_grant_id where g.origin_purchase_id = ${lit(id)}`));
export const grantEffective = (id) => admin(`select coalesce(bool_or(public.is_tournament_season_plan_grant_effective(g.id)), false) from public.tournament_season_plan_grants g where g.origin_purchase_id = ${lit(id)}`).trim() === 't';
/** Commerce-table fingerprint of one purchase: status, preference, events, grant events. */
export const snapshot = (id) => JSON.stringify([purchaseRow(id), eventTypes(id), grantEvents(id)]);

/** Creates the preference of a fresh purchase through the real function; returns purchase + preference. */
export async function preparedPurchase(label) {
  const p = newPurchase(label);
  const r = await internal({ purchase_id: p.id });
  assert.equal(r.status, 200, `preference for ${label}: ${r.text}`);
  return { ...p, preferenceId: r.body.preferenceId };
}
export async function payAndNotify(p, status, statusDetail = null, extra = {}) {
  const pay = await stub('/__lab/payments', { preferenceId: p.preferenceId, status, statusDetail, ...extra });
  const r = await webhook({ dataId: pay.paymentId });
  return { pay, r };
}

// ---------------------------------------------------------------- readiness / logs / evidence
export async function waitPayments() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${PAYMENTS_BASE}${INTERNAL_PATH}`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(90000) });
      if (r.status !== 503) return r.status;
    } catch { /* worker booting */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return 503;
}
export function containerLogs(...services) {
  return dc(['logs', '--no-color', ...services], undefined, true);
}
/** Resolved environment of one lab service (compose config, env_file included), as text; kept in memory only. */
export function containerEnv(service) {
  const doc = JSON.parse(dc(['config', '--format', 'json'], undefined, true));
  return JSON.stringify(doc.services?.[service]?.environment ?? {});
}
export async function writeEvidence(name, doc) {
  await mkdir(EVIDENCE, { recursive: true });
  const text = JSON.stringify(doc, null, 2) + '\n';
  assertNoLeak(text, [], `evidence ${name}`);
  await writeFile(`${EVIDENCE}${name}${TAG}.json`, text);
  return text;
}
export async function sourceOf(relative) { return readFile(`${repo}${relative}`, 'utf8'); }
export { root, repo, randomUUID, randomBytes, createHash };
