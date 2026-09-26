#!/usr/bin/env node
// PAYMENTS TEST — OFFLINE REHEARSAL. Nothing leaves this machine: no Supabase, no Deno Deploy, no Mercado Pago, no Core.
//
//   • DB: a throwaway supabase/postgres:17.6.1.147 (published on 127.0.0.1 only), migrations 0000–0003 installed as the
//     non-superuser installer `postgres` (certified bytes), then the certified gateway W2+W3 bootstrap → the
//     GATEWAY_AUTH_CERTIFIED database. Read-only measurements run as supabase_read_only_user in a READ ONLY transaction
//     (exactly the hosted Management API `database/query read_only:true` session).
//   • PB: the exact payments-login transaction, applied as `postgres`; replay refused; the payments delta pin is derived
//     here (--derive-pin) or compared with pins/payments-test-delta.json.
//   • PB-cert: the payments login probe (payments-db.mjs) as torneos_payments_test.
//   • QA: identity + QA org + S1/S2 + two checkout purchases through the REAL client RPCs (authenticated + bridge claims),
//     plus a non-QA control tenant; the census proves every commercial row is QA / MP TEST.
//   • ORD: the ordering permutations on the functions, as the payments login, every transaction rolled back.
//   • RT: the REAL payments sources (config.ts / handler.ts / db.ts, postgres.js 3.4.7 from the local Deno cache) in the
//     hosted remote-test configuration, against the in-process Mercado Pago emulator: Preference (39.900 ARS), rejected
//     attempt, approved + Premium grant, duplicates / replays (10- and 13-digit ts), stale snapshots, dispute →
//     restore → old dispute, refund → revoke, every security negative, the LIVE guard and provider outages. Like the real
//     Mercado Pago sandbox, the emulator answers live_mode=true: the lifecycle runs through the remote-test sandbox policy
//     (attested seller, exact resources, pinned QA organization); outside remote-test live_mode=true stays refused.
// Evidence: backend/torneos/mp-b/evidence/payments-test/rehearsal-<stamp>/ (secret-scanned).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as FC from '../torneos-foundation/foundation-contract.mjs';
import { foundationDiff } from '../torneos-gateway-auth/gateway-auth.mjs';
import { loadGatewayTree } from '../torneos-gateway-auth/gateway-loader.mjs';
import * as C from './payments-test-contract.mjs';
import * as D from './payments-db.mjs';
import { makeMercadoPago, signedNotification, signedInternal } from './mp-emulator.mjs';

const DERIVE_PIN = process.argv.includes('--derive-pin');
const DOCKER = ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
const DB_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.147';
const PG_JS = path.join(os.homedir(), 'Library/Caches/deno/npm/registry.npmjs.org/postgres/3.4.7/src/index.js');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const NET = `pt-net-${process.pid}`; const DB = `pt-db-${process.pid}`;
// Throwaway values of throwaway containers and fixtures (they die with the run); not credentials of anything real.
const LOCAL_PW = crypto.randomBytes(18).toString('base64url');
const PAY_PW = crypto.randomBytes(30).toString('base64url');
const EDGE_PW = Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, crypto.randomBytes(30).toString('base64url')]));
const SELLER = '3141592653';
const MP_TOKEN = `APP_USR-${crypto.randomInt(1e12, 9e12)}${crypto.randomInt(1000, 9999)}-092611-${crypto.randomBytes(16).toString('hex')}-${SELLER}`;
const MP_SECRET = crypto.randomBytes(32).toString('hex');
const INTERNAL_HEX = crypto.randomBytes(32).toString('hex');
const CA_FIXTURE = Buffer.from('-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----\n').toString('base64');
const POOLER = 'aws-0-sa-east-1.pooler.supabase.com';
const known = [LOCAL_PW, PAY_PW, ...Object.values(EDGE_PW), MP_TOKEN, MP_SECRET, INTERNAL_HEX];
const docker = (args) => execFileSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const lines = [];
const log = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phases = [];
const record = (label, pass, verdict, detail = null) => { phases.push({ label, pass, verdict, detail }); log(`[${pass ? 'PASS' : 'FAIL'}] ${label}: ${verdict}${pass ? '' : ` ${JSON.stringify(detail).slice(0, 900)}`}`); };

function psql(sql, { user = 'postgres', password = LOCAL_PW, file = null } = {}) {
  const r = spawnSync(DOCKER, ['exec', '-i', '-e', `PGPASSWORD=${password}`, DB, 'psql', '-U', user, '-h', 'localhost', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: file ? fs.readFileSync(file) : sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), code: r.status };
}
const readOnly = (select) => {
  const r = psql(`BEGIN READ ONLY;\nSET LOCAL ROLE supabase_read_only_user;\nselect row_to_json(t) from (${select}) t;\nCOMMIT;\n`, { user: 'supabase_admin' });
  if (!r.ok) throw new Error(`read_only_failed ${r.err.slice(0, 300)}`);
  const o = JSON.parse(r.out);
  return o.json_build_object ?? o.trail ?? o;
};
/** runPsqlProbe replacement: the same script on stdin, as the payments login, inside the container. */
const runAsPaymentLogin = async ({ script }) => {
  const r = spawnSync(DOCKER, ['exec', '-i', '-e', `PGPASSWORD=${PAY_PW}`, DB, 'psql', '-U', C.PAYMENT_LOGIN, '-h', 'localhost', '-d', 'postgres', '-X', '--no-psqlrc', '-q', '-A', '-t', '-f', '-'],
    { input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr_tail: (r.stderr ?? '').split('\n').filter((l) => /FATAL|could not/.test(l)).slice(-3).join('\n') };
};
function asUser({ identity, coreUserId }, sql) {
  const now = Math.floor(Date.now() / 1000);
  const claims = JSON.stringify({ role: 'authenticated', iss: G.BRIDGE.issuer, aud: G.BRIDGE.audience, sub: identity, core_user_id: coreUserId, session_id: crypto.randomUUID(), jti: crypto.randomUUID(), iat: now, nbf: now, exp: now + 120 });
  const r = psql(`BEGIN;\nSET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '${claims}', true) \\g /dev/null\n${sql};\nCOMMIT;\n`);
  if (!r.ok) throw new Error(`as_user_failed ${r.err.slice(0, 400)}`);
  return JSON.parse(r.out.split('\n').pop());
}

async function main() {
  if (!DOCKER) throw new Error('docker not found');
  const evDir = path.join(C.EVIDENCE_DIR, `rehearsal-${stamp}`);
  let tree = null;
  const results = {};
  try {
    // ── R00 database = certified foundation ──
    docker(['network', 'create', NET]);
    docker(['run', '-d', '--rm', '--network', NET, '-p', '127.0.0.1::5432', '--name', DB, '-e', `POSTGRES_PASSWORD=${LOCAL_PW}`, '--pull', 'never', DB_IMAGE]);
    for (let i = 0; i < 90; i++) { if (psql('select 1').ok) break; await sleep(1000); }
    await sleep(2000);
    for (let i = 0; i < 30 && !psql('select 1').ok; i++) await sleep(1000);
    for (const m of FC.loadMigrations(G.REPO_ROOT)) { const r = psql(null, { file: m.abs }); if (!r.ok) throw new Error(`migration ${m.seq}: ${r.err.slice(0, 300)}`); }
    const foundationPin = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8'));
    const gatewayDeltaPin = JSON.parse(fs.readFileSync(G.DELTA_PIN_FILE, 'utf8'));
    let cat = readOnly(G.CATALOG_SQL);
    record('R00 0000–0003 installed as postgres = certified foundation pin', FC.catalogDiff(cat, foundationPin.catalog).length === 0, 'FOUNDATION_PIN_MATCH', FC.catalogDiff(cat, foundationPin.catalog));

    // ── R01 the GATEWAY_AUTH_CERTIFIED database (certified W2+W3 SQL) ──
    const gw = psql(G.renderBootstrapSql(Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, G.scramVerifier(EDGE_PW[l.login])]))));
    cat = readOnly(G.CATALOG_SQL);
    let gwRoles = readOnly(G.GATEWAY_ROLES_SQL);
    let payRoles = readOnly(C.PAYMENT_ROLES_SQL);
    const gwState = G.dbState(cat, gwRoles, foundationPin, gatewayDeltaPin);
    const pre = C.paymentsDeltaFailures(cat, gwRoles, payRoles, { expectLogin: false });
    record('R01 certified gateway W2+W3 → dbState applied, 0 gateway invariant failures, payments login absent', gw.ok && gwState.state === 'applied' && G.gatewayInvariantFailures(cat, gwRoles).length === 0 && pre.length === 0 && C.paymentLoginState(payRoles) === 'absent',
      `db=${gwState.state} login=${C.paymentLoginState(payRoles)}`, { gw: gw.err.slice(0, 200), state: gwState, pre });
    results.before = { role_executes: payRoles.role_executes, payment_logins: payRoles.payment_logins };

    // ── R02 installer ──
    const inst = readOnly(C.INSTALLER_SQL);
    record('R02 installer postgres measured by name: CREATEROLE + ADMIN on torneos_payment_service', C.installerCan(inst), JSON.stringify(inst), inst);

    // ── R03/R04 PB ──
    const verifier = G.scramVerifier(PAY_PW);
    const sql = C.renderPaymentBootstrapSql(verifier);
    const pb = psql(sql);
    record('R03 PB transaction as postgres (SCRAM verifier only)', pb.ok, pb.ok ? 'APPLIED' : 'FAILED', pb.err.slice(0, 300));
    const again = psql(sql);
    record('R04 PB replay refused by its own guard (no blind re-apply)', !again.ok && /PAYMENTS_LOGIN_ALREADY_PRESENT/.test(again.err), 'PAYMENTS_LOGIN_ALREADY_PRESENT', again.err.slice(0, 200));

    // ── R05 allowed delta = exact ──
    cat = readOnly(G.CATALOG_SQL); gwRoles = readOnly(G.GATEWAY_ROLES_SQL); payRoles = readOnly(C.PAYMENT_ROLES_SQL);
    const fd = foundationDiff(cat, foundationPin);
    const delta = C.paymentsDeltaFailures(cat, gwRoles, payRoles);
    const pinBody = { purpose: 'PAYMENTS TEST — GATEWAY_AUTH + PB catalog delta paths, gateway role view and payments role view (derived from a rehearsal run of the exact PB SQL)',
      foundation_pin_sha256: G.FOUNDATION_FILES['backend/torneos/infra/torneos-foundation/pins/expected-catalog.json'], gateway_delta_pin_sha256: G.sha256(fs.readFileSync(G.DELTA_PIN_FILE)),
      bootstrap_sql_template_sha256: G.sha256(C.BOOTSTRAP_SQL_TEMPLATE), catalog: Object.fromEntries(G.DELTA_PATHS.map((p) => [p, G.getPath(cat, p)])),
      gateway_roles: { logins: gwRoles.logins, memberships: gwRoles.memberships, payment_logins: gwRoles.payment_logins }, payment_roles: payRoles };
    if (DERIVE_PIN) { fs.writeFileSync(C.DELTA_PIN_FILE, `${JSON.stringify(pinBody, null, 1)}\n`); log(`derived ${path.basename(C.DELTA_PIN_FILE)} ${G.sha256(fs.readFileSync(C.DELTA_PIN_FILE))}`); }
    const pin = C.readDeltaPin();
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
    const pinMatch = !!pin && canon({ c: pin.catalog, g: pin.gateway_roles, p: pin.payment_roles }) === canon({ c: pinBody.catalog, g: pinBody.gateway_roles, p: pinBody.payment_roles });
    record('R05 after PB: foundation strict paths unchanged, gateway invariants hold, payments delta exact, = delta pin', fd.length === 0 && delta.length === 0 && pinMatch,
      `foundation_diff=${fd.length} delta_failures=${delta.length} pin=${pinMatch}`, { fd, delta, payRoles });
    results.after = { role_executes: payRoles.role_executes, login: payRoles.login, memberships: payRoles.login_memberships, reachable: payRoles.reachable_roles };

    // ── R06 login probe ──
    const checks = D.loginChecks();
    const lp = D.evaluateLoginProbe(checks, (await runAsPaymentLogin({ script: D.loginProbeScript(checks) })).stdout);
    record(`R06 payments login probe (${checks.before.length + checks.own.length} checks)`, lp.pass, lp.pass ? 'LOGIN_EXACT' : 'LOGIN_PROBE_FAILED', lp.failures);
    results.login_probe = lp;

    // ── R07 QA fixtures through the real client RPCs + a non-QA control tenant ──
    const mk = (core) => ({ coreUserId: core, identity: psql(`insert into public.torneos_identity(core_user_id) values ('${core}') returning id`).out });
    const operator = mk(crypto.randomUUID()); const control = mk(crypto.randomUUID());
    const slug = `${C.QA.orgSlugPrefix}${crypto.randomBytes(4).toString('hex')}`;
    const org = asUser(operator, `SELECT public.create_tournament_organization('${C.QA.orgName}', '${slug}', '${crypto.randomUUID()}')`);
    const orgId = org.id ?? org.organization?.id ?? org.organizationId;
    const season = (s) => asUser(operator, `SELECT public.create_tournament_season('${orgId}', '${s.name}', '${s.slugPrefix}${crypto.randomBytes(3).toString('hex')}', NULL, NULL, '${crypto.randomUUID()}')`);
    const S1 = season(C.QA.seasons[0]); const S2 = season(C.QA.seasons[1]);
    const sid = (s) => s.id ?? s.season?.id ?? s.seasonId;
    const buy = (s) => asUser(operator, `SELECT public.create_tournament_season_checkout_purchase('${orgId}', '${sid(s)}', '${crypto.randomUUID()}')`);
    const P1 = buy(S1); const P2 = buy(S2);
    const pid = (p) => p.id ?? p.purchase?.id ?? p.purchaseId;
    const corg = asUser(control, `SELECT public.create_tournament_organization('Control Tenant Real', 'control-tenant-${crypto.randomBytes(3).toString('hex')}', '${crypto.randomUUID()}')`);
    asUser(control, `SELECT public.create_tournament_season('${corg.id ?? corg.organization?.id}', 'Control season real', 'control-season', NULL, NULL, '${crypto.randomUUID()}')`);
    const fx = { org: orgId, S1: sid(S1), S2: sid(S2), P1: pid(P1), P2: pid(P2) };
    record('R07 QA org / S1 / S2 / purchases via the real client RPCs (amount 39900 ARS, MERCADO_PAGO test)', Object.values(fx).every((v) => /^[0-9a-f-]{36}$/.test(v ?? '')) && P1.amount === 39900 && P1.currency === 'ARS' && P1.provider === 'MERCADO_PAGO' && P1.providerEnvironment === 'test',
      JSON.stringify({ P1: { amount: P1.amount, currency: P1.currency, status: P1.status } }), { org, S1, P1 });
    results.fixtures = { slug, keys: Object.keys(fx) };
    let census = readOnly(C.CENSUS_SQL);
    record('R08 census: every commercial row is QA / MP TEST; a real (non-QA) tenant exists and is untouched', C.censusFailures(census).length === 0 && census.organizations === 2 && census.organizations_qa === 1 && census.seasons_outside_qa === 1,
      JSON.stringify(census), C.censusFailures(census));

    // ── R09 ordering, rolled back ──
    const ord = D.evaluateOrdering((await runAsPaymentLogin({ script: D.orderingScript({ purchaseId: fx.P2 }) })).stdout);
    record(`R09 ordering / watermark on the functions as the payments login (${ord.cases.length} cases, every transaction rolled back)`, ord.pass, ord.pass ? 'ORDERING_PASS' : 'ORDERING_FAILED', ord.failures);
    results.ordering = ord;
    const trailAfterOrdering = readOnly(C.QA_TRAIL_SQL);
    const p2 = trailAfterOrdering.find((x) => x.purchase === fx.P2);
    record('R09b the ordering run left no trace (P2 still created, 1 event, 0 grants, 0 watermarks)', !!p2 && p2.status === 'created' && p2.events.length === 1 && p2.grants.length === 0 && p2.watermarks.length === 0,
      JSON.stringify(p2 && { status: p2.status, events: p2.events.length, grants: p2.grants.length, watermarks: p2.watermarks.length }));

    // ── R10 the real payments sources, hosted remote-test configuration, against the emulator ──
    const port = Number(docker(['port', DB, '5432/tcp']).trim().split('\n')[0].split(':').pop());
    tree = await loadGatewayTree({ postgresModule: `export { default } from ${JSON.stringify(pathToFileURL(PG_JS).href)};` });
    const { createPaymentsService } = await tree.import('torneos-payments/handler.ts');
    const { createPaymentsDb } = await tree.import('torneos-payments/db.ts');
    const REMOTE_ENV = { TORNEOS_PAYMENT_PROVIDER: 'MERCADO_PAGO', MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_TEST_ACCESS_TOKEN: MP_TOKEN, MERCADO_PAGO_TEST_WEBHOOK_SECRET: MP_SECRET,
      MERCADO_PAGO_TEST_SELLER_ID: SELLER, APP_PUBLIC_URL: C.APP_PUBLIC_URL, TORNEOS_PAYMENTS_NOTIFICATION_URL: C.WEBHOOK_URL, TORNEOS_PAYMENTS_INTERNAL_SECRET: INTERNAL_HEX,
      TORNEOS_PAYMENTS_DB_URL: `postgres://${C.PAYMENT_LOGIN}.${C.TORNEOS_REF}:${PAY_PW}@${POOLER}:6543/postgres`, TORNEOS_PAYMENTS_DB_SSL_CA: CA_FIXTURE, TORNEOS_PAYMENTS_DEPLOYMENT: 'remote-test',
      TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID: fx.org };
    const mp = makeMercadoPago({ sellerId: SELLER, accessToken: MP_TOKEN });
    const logs = [];
    const dbs = [];
    const service = createPaymentsService({ env: REMOTE_ENV, log: (e) => logs.push(e), fetcher: (u, i) => mp.fetch(u, i), connectDb: (url, ca) => {
      if (url !== REMOTE_ENV.TORNEOS_PAYMENTS_DB_URL || !ca) throw new Error('rehearsal: the service must connect with the pinned pooler URL and a CA');
      const db = createPaymentsDb(`postgres://${C.PAYMENT_LOGIN}:${encodeURIComponent(PAY_PW)}@127.0.0.1:${port}/postgres`, undefined); dbs.push(db); return db;
    } });
    const call = async ({ url, init }) => { const res = await service(new Request(url, init)); return { status: res.status, body: await res.json() }; };
    const internal = (purchaseId, over = {}) => call(signedInternal({ url: C.INTERNAL_URL, secretHex: INTERNAL_HEX, body: JSON.stringify({ purchase_id: purchaseId }), ...over }));
    const notify = (dataId, over = {}) => call(signedNotification({ base: C.PAYMENTS_BASE, secret: MP_SECRET, dataId, sellerId: SELLER, ...over }));
    const trailOf = (id) => readOnly(C.QA_TRAIL_SQL).find((x) => x.purchase === id);
    const at = (s) => `2026-09-26T12:00:${String(s).padStart(2, '0')}.000-03:00`;
    const rt = [];
    const check = (name, pass, detail = null) => { rt.push({ name, pass: !!pass, detail: pass ? null : detail }); if (!pass) log(`   ✗ ${name} ${JSON.stringify(detail).slice(0, 500)}`); };

    // Preference
    let r = await internal(fx.P1);
    const pref = mp.preference(r.body.preferenceId);
    const b = pref?.body;
    check('RT01 internal preference → 200 preference_created', r.status === 200 && typeof r.body.preferenceId === 'string', r);
    check('RT02 provider body: one item torneos_premium "Arma2 Torneos Premium" qty 1 ARS unit_price 39900', b && b.items.length === 1 && b.items[0].id === 'torneos_premium' && b.items[0].title === C.PRODUCT.title && b.items[0].quantity === 1 && b.items[0].currency_id === 'ARS' && b.items[0].unit_price === 39900, b?.items);
    check('RT03 external_reference, metadata {purchase_id} only, notification_url = the TEST webhook, back_urls on the TEST host, auto_return, expiry, no payer / PII',
      b && b.external_reference === `arma2:season:purchase:${fx.P1}` && JSON.stringify(b.metadata) === JSON.stringify({ purchase_id: fx.P1 }) && b.notification_url === C.WEBHOOK_URL
      && Object.values(b.back_urls).every((u) => u.startsWith(`${C.APP_PUBLIC_URL}/torneos/organizacion/${fx.org}/temporada/${fx.S1}/plan/compra/${fx.P1}/`)) && b.auto_return === 'approved' && b.expires === true && !('payer' in b), b);
    check('RT04 idempotency: X-Idempotency-Key = purchase id', pref?.idempotencyKey === fx.P1);
    const r2 = await internal(fx.P1);
    check('RT05 second call → 200 preference_reused, same preference, no new POST', r2.status === 200 && r2.body.preferenceId === r.body.preferenceId && mp.calls.filter((x) => x.startsWith('POST /checkout/preferences')).length === 1, r2);
    check('RT06 attestation: exactly one GET /users/me', mp.calls.filter((x) => x === 'GET /users/me').length === 1);
    const prefId = r.body.preferenceId;
    let t = trailOf(fx.P1);
    check('RT07 DB: preference_created with the preference id', t.status === 'preference_created' && t.preference_id === prefId, t);

    // Security negatives BEFORE any payment (nothing may change)
    const snap = () => JSON.stringify(trailOf(fx.P1));
    const s0 = snap();
    const neg = async (name, req, status, error) => { const x = await req; check(`${name} → ${status}${error ? ` ${error}` : ''}`, x.status === status && (!error || x.body.error === error), x); };
    const unsignedBody = JSON.stringify({ type: 'payment', data: { id: '1' }, live_mode: false, user_id: Number(SELLER) });
    await neg('NEG01 webhook without x-signature', call({ url: `${C.WEBHOOK_URL}?data.id=1&type=payment`, init: { method: 'POST', body: unsignedBody, headers: { 'content-type': 'application/json', 'x-request-id': 'r' } } }), 401, 'invalid_signature');
    const forged = signedNotification({ base: C.PAYMENTS_BASE, secret: 'not-the-secret-000000000000000000', dataId: '1', sellerId: SELLER });
    await neg('NEG02 webhook with a bad signature', call(forged), 401, 'invalid_signature');
    await neg('NEG03 future ts (+10 min)', notify('1', { ts: String(Date.now() + 600_000) }), 401, 'invalid_signature');
    await neg('NEG04 malformed ts (float)', notify('1', { ts: '1790000000.5' }), 401, 'invalid_signature');
    await neg('NEG05 malformed JSON body', call({ url: `${C.WEBHOOK_URL}?data.id=1&type=payment`, init: { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } } }), 400, 'invalid_request');
    await neg('NEG06 live_mode not a boolean ("true")', notify('1', { body: { type: 'payment', data: { id: '1' }, live_mode: 'true', user_id: Number(SELLER) } }), 400, 'invalid_notification');
    await neg('NEG06b live_mode true on an unknown payment: the body is not authority, the provider lookup decides', notify('1', { body: { type: 'payment', data: { id: '1' }, live_mode: true, user_id: Number(SELLER) } }), 422, 'payment_verification_failed');
    await neg('NEG07 another seller (user_id)', notify('1', { body: { type: 'payment', data: { id: '1' }, live_mode: false, user_id: 1234 } }), 400, 'invalid_notification');
    await neg('NEG08 unknown topic', notify('1', { type: 'merchant_order' }), 400, 'invalid_notification');
    await neg('NEG09 body data.id ≠ signed query data.id', notify('1', { body: { type: 'payment', data: { id: '2' }, live_mode: false, user_id: Number(SELLER) } }), 400, 'invalid_notification');
    await neg('NEG10 unknown payment (provider 404)', notify('77777777'), 422, 'payment_verification_failed');
    await neg('NEG11 chargeback not of Checkout Pro', notify('1', { type: 'topic_chargebacks_wh', body: { type: 'topic_chargebacks_wh', data: { id: '1', checkout: 'API' }, live_mode: false, user_id: Number(SELLER) } }), 400, 'invalid_notification');
    await neg('NEG12 oversized webhook body', call({ url: `${C.WEBHOOK_URL}?data.id=1`, init: { method: 'POST', body: 'x'.repeat(40 * 1024), headers: { 'content-type': 'application/json' } } }), 413, 'payload_too_large');
    // binding mismatches: real emulator payments on the P1 preference that lie about one field each
    for (const [label, opts] of [['wrong amount (100)', { amount: 100 }], ['wrong currency (USD)', { currency: 'USD' }], ['external_reference of another purchase (P2 / S2)', { externalReference: `arma2:season:purchase:${fx.P2}`, metadataPurchase: fx.P2 }],
      ['malformed external_reference', { externalReference: 'arma2:season:purchase:not-a-uuid' }], ['metadata of another purchase', { metadataPurchase: fx.P2 }], ['another collector', { collector: '999999' }],
      ['another application (payment application_id)', { paymentApplication: '999999' }], ['live_mode not a boolean', { liveMode: 'true' }],
      ['payment not in its merchant order', { inOrder: false }]]) {
      const id = mp.pay(prefId, { status: 'approved', statusDetail: 'accredited', at: at(1), ...opts });
      await neg(`NEG binding: ${label}`, notify(id), 422, 'payment_verification_failed');
    }
    mp.setDown(500); await neg('NEG provider 5xx', notify('1'), 503, 'provider_unavailable');
    mp.setDown(429); await neg('NEG provider 429', notify('1'), 503, 'provider_unavailable');
    mp.setDown('network'); await neg('NEG provider unreachable', notify('1'), 503, 'provider_unavailable'); mp.setDown(null);
    // internal route negatives
    const good = signedInternal({ url: C.INTERNAL_URL, secretHex: INTERNAL_HEX, body: JSON.stringify({ purchase_id: fx.P1 }) });
    await neg('NEG internal without HMAC headers', call({ url: C.INTERNAL_URL, init: { method: 'POST', body: good.init.body, headers: { 'content-type': 'application/json' } } }), 401, 'unauthorized');
    await neg('NEG internal bad signature', internal(fx.P1, { secretHex: crypto.randomBytes(32).toString('hex') }), 401, 'unauthorized');
    await neg('NEG internal stale time', internal(fx.P1, { time: String(Math.floor(Date.now() / 1000) - 120) }), 401, 'unauthorized');
    await call(good); await neg('NEG internal replayed nonce', call(good), 401, 'unauthorized');
    await neg('NEG internal with a browser Origin', call({ url: C.INTERNAL_URL, init: { ...good.init, headers: { ...good.init.headers, origin: 'https://app.arma2.com.ar' } } }), 403, 'forbidden');
    await neg('NEG internal wrong host', call({ ...good, url: C.INTERNAL_URL.replace(C.PAYMENTS_HOST, 'torneos-gateway.nicoavayu.deno.net') }), 403, 'forbidden');
    await neg('NEG internal unknown purchase', internal(crypto.randomUUID()), 404, 'purchase_not_found');
    await neg('NEG GET / unknown paths → 404', call({ url: `${C.PAYMENTS_BASE}/`, init: { method: 'GET' } }), 404, 'not_found');
    check('NEG no negative changed the purchase, its events, grants or watermarks', snap() === s0, { before: JSON.parse(s0).events.length, after: trailOf(fx.P1).events.length });

    // Lifecycle: rejected attempt → approved → grant → duplicates → stale → dispute → restore → old dispute → refund → revoke
    const rej = mp.pay(prefId, { status: 'rejected', statusDetail: 'cc_rejected_other_reason', at: at(10) });
    r = await notify(rej); t = trailOf(fx.P1);
    check('LC01 rejected attempt → 200; purchase stays payable (preference_created), payment.attempt_rejected', r.status === 200 && t.status === 'preference_created' && t.events.some((e) => e.type === 'payment.attempt_rejected'), { r, status: t.status });
    const pay = mp.pay(prefId, { status: 'approved', statusDetail: 'accredited', at: at(20) });
    r = await notify(pay); t = trailOf(fx.P1);
    check('LC02a the approved sandbox payment reports live_mode=true (as Mercado Pago sandbox does)', mp.state.payments.get(pay).base.live_mode === true);
    check('LC02 approved → 200; purchase approved, one Premium grant, effective', r.status === 200 && t.status === 'approved' && t.approved_payment === pay && t.grants.length === 1 && t.grants[0].effective === true
      && JSON.stringify(t.grants[0].events.map((e) => e.type)) === '["granted"]', { r, t: { status: t.status, grants: t.grants } });
    r = await notify(pay);
    check('LC03 duplicate approved (13-digit ts) → provider_snapshot_duplicate, nothing new', r.status === 200 && r.body.outcome === 'provider_snapshot_duplicate' && trailOf(fx.P1).grants[0].events.length === 1, r);
    r = await notify(pay, { ts: String(Math.floor(Date.now() / 1000)) });
    check('LC04 replay with a 10-digit ts → accepted, still a duplicate', r.status === 200 && r.body.outcome === 'provider_snapshot_duplicate', r);
    const oldTs = String(Date.now() - 3 * 86400_000);
    r = await notify(pay, { ts: oldTs });
    check('LC05 old authentic notification (3 days) → re-fetched, duplicate (no max age, ts never orders)', r.status === 200 && r.body.outcome === 'provider_snapshot_duplicate', r);
    mp.update(pay, { status: 'in_process', statusDetail: 'pending_review_manual', at: at(15) }); // an older provider snapshot served late
    r = await notify(pay); t = trailOf(fx.P1);
    check('LC06 older provider snapshot (pending @15 < approved @20) → stale_ignored, still approved + effective', r.body.outcome === 'stale_ignored' && t.status === 'approved' && t.grants[0].effective, { r, status: t.status });
    mp.state.payments.get(pay).snapshots.pop();
    mp.update(pay, { status: 'charged_back', statusDetail: 'in_process', at: at(30) });
    const cb = mp.chargeback(pay);
    r = await notify(cb, { type: 'topic_chargebacks_wh' }); t = trailOf(fx.P1);
    check('LC07 dispute (chargeback notification → payment charged_back @30) → grant suspended, not effective', r.status === 200 && t.status === 'charged_back' && t.grants[0].events.at(-1).type === 'suspended' && t.grants[0].effective === false, { r, t: { status: t.status, ge: t.grants[0].events } });
    mp.update(pay, { status: 'charged_back', statusDetail: 'reimbursed', at: at(40) });
    r = await notify(cb, { type: 'topic_chargebacks_wh' }); t = trailOf(fx.P1);
    check('LC08 restored (reimbursed @40) → approved, grant restored, effective', r.status === 200 && t.status === 'approved' && t.grants[0].events.at(-1).type === 'restored' && t.grants[0].effective === true, { r, t: { status: t.status, ge: t.grants[0].events } });
    mp.serve(pay, 1); // the OLD dispute snapshot (@30) arrives after the restoration
    r = await notify(cb, { type: 'topic_chargebacks_wh' }); t = trailOf(fx.P1);
    check('LC09 HISTORICAL BUG (0003): old dispute after restore → stale_ignored; still approved, grant effective, no new grant event', r.body.outcome === 'stale_ignored' && t.status === 'approved' && t.grants[0].effective === true
      && JSON.stringify(t.grants[0].events.map((e) => e.type)) === '["granted","suspended","restored"]', { r, t: { status: t.status, ge: t.grants[0].events } });
    r = await notify(pay); // same stale snapshot through the payment topic too
    check('LC10 same old dispute via the payment topic → stale_ignored', r.body.outcome === 'stale_ignored', r);
    mp.serve(pay, null);
    const refundCall = await mp.fetch(`https://api.mercadopago.com/v1/payments/${pay}/refunds`, { method: 'POST', headers: { authorization: `Bearer ${MP_TOKEN}` }, body: '{}' });
    r = await notify(pay); t = trailOf(fx.P1);
    check('LC11 refund (provider refunded, newer) → refunded, grant revoked, not effective', refundCall.status === 201 && r.status === 200 && t.status === 'refunded' && t.grants[0].events.at(-1).type === 'revoked' && t.grants[0].effective === false, { r, t: { status: t.status, ge: t.grants[0].events } });
    mp.serve(pay, 0);
    r = await notify(pay); t = trailOf(fx.P1);
    check('LC12 old approved after refund → stale_ignored; revoked never revives', r.body.outcome === 'stale_ignored' && t.status === 'refunded' && t.grants[0].effective === false && t.grants.length === 1, { r, status: t.status });
    mp.serve(pay, null);
    check('LC13 exactly one grant for the season, one watermark per provider payment', t.grants.length === 1 && t.watermarks.length === 2 && new Set(t.watermarks.map((w) => w.payment)).size === 2, t.watermarks);
    check('LC14 P2 (ordering purchase) untouched by the whole lifecycle', trailOf(fx.P2).status === 'created' && trailOf(fx.P2).events.length === 1);

    // live_mode=true outside remote-test: the same sources, deployment unset (offline DB host) → the certified guard refuses
    const labEnv = { ...REMOTE_ENV, TORNEOS_PAYMENTS_DB_URL: `postgres://${C.PAYMENT_LOGIN}:${encodeURIComponent(PAY_PW)}@127.0.0.1:${port}/postgres` };
    delete labEnv.TORNEOS_PAYMENTS_DEPLOYMENT; delete labEnv.TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID; delete labEnv.TORNEOS_PAYMENTS_DB_SSL_CA;
    const labService = createPaymentsService({ env: labEnv, log: () => {}, fetcher: (u, i) => mp.fetch(u, i), connectDb: (url) => { const db = createPaymentsDb(url, undefined); dbs.push(db); return db; } });
    const labCall = async ({ url, init }) => { const res = await labService(new Request(url, init)); return { status: res.status, body: await res.json() }; };
    const before = snap();
    let lr0 = await labCall(signedNotification({ base: C.PAYMENTS_BASE, secret: MP_SECRET, dataId: pay, sellerId: SELLER }));
    check('LIVE-OUT live_mode=true outside remote-test → 400 invalid_notification (certified guard)', lr0.status === 400 && lr0.body.error === 'invalid_notification', lr0);
    lr0 = await labCall(signedNotification({ base: C.PAYMENTS_BASE, secret: MP_SECRET, dataId: pay, sellerId: SELLER, liveMode: false }));
    check('LIVE-OUT provider payment live_mode=true outside remote-test → 422 (byte-pinned provider binding)', lr0.status === 422 && lr0.body.error === 'payment_verification_failed', lr0);
    // the QA pin: the same app pinned to another organization serves neither route for P1
    const otherQa = createPaymentsService({ env: { ...REMOTE_ENV, TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID: crypto.randomUUID() }, log: () => {}, fetcher: (u, i) => mp.fetch(u, i), connectDb: () => {
      const db = createPaymentsDb(`postgres://${C.PAYMENT_LOGIN}:${encodeURIComponent(PAY_PW)}@127.0.0.1:${port}/postgres`, undefined); dbs.push(db); return db; } });
    const oq = async ({ url, init }) => { const res = await otherQa(new Request(url, init)); return { status: res.status, body: await res.json() }; };
    const q1 = await oq(signedNotification({ base: C.PAYMENTS_BASE, secret: MP_SECRET, dataId: pay, sellerId: SELLER }));
    const q2 = await oq(signedInternal({ url: C.INTERNAL_URL, secretHex: INTERNAL_HEX, body: JSON.stringify({ purchase_id: fx.P1 }) }));
    check('QA-PIN an app pinned to another organization: webhook 422, preference 422; nothing changed', q1.status === 422 && q2.status === 422 && q2.body.error === 'purchase_invalid' && snap() === before, { q1, q2 });

    // LIVE guard with the real sources: a production (non-test) seller token
    const live = makeMercadoPago({ sellerId: SELLER, accessToken: MP_TOKEN, me: { id: Number(SELLER), site_id: 'MLA', tags: ['normal'] } });
    const liveLogs = []; let liveDb = 0;
    const liveService = createPaymentsService({ env: REMOTE_ENV, log: (e) => liveLogs.push(e), fetcher: (u, i) => live.fetch(u, i), connectDb: () => ({ async call() { liveDb += 1; throw new Error('must not be called'); } }) });
    const lr = await liveService(new Request(signedInternal({ url: C.INTERNAL_URL, secretHex: INTERNAL_HEX, body: JSON.stringify({ purchase_id: fx.P1 }) }).url, signedInternal({ url: C.INTERNAL_URL, secretHex: INTERNAL_HEX, body: JSON.stringify({ purchase_id: fx.P1 }) }).init));
    check('LIVE a non-test seller token → 503, only /users/me reached the provider, 0 DB calls', lr.status === 503 && live.calls.join() === 'GET /users/me' && liveDb === 0, { status: lr.status, calls: live.calls });
    const secretLeak = C.secretFindings(JSON.stringify(logs), known);
    check('LOG service logs: route/status/code only, no secret', secretLeak.length === 0 && logs.every((l) => Object.keys(l).every((k) => ['fn', 'route', 'status', 'code', 'ms', 'event'].includes(k))), secretLeak);
    const failed = rt.filter((x) => !x.pass);
    record(`R10 real payments sources in remote-test vs Mercado Pago emulator (${rt.length} checks)`, failed.length === 0, `${rt.length - failed.length}/${rt.length}`, failed.map((x) => x.name));
    results.runtime = rt;
    results.trail = trailOf(fx.P1);
    census = readOnly(C.CENSUS_SQL);
    record('R11 census after everything: commercial rows only in QA, only MP TEST; control tenant has none', C.censusFailures(census).length === 0, JSON.stringify(census), C.censusFailures(census));
    results.census = census;
    for (const db of dbs) await db.end?.().catch(() => {});
  } catch (e) {
    record('REHEARSAL aborted', false, 'EXCEPTION', String(e?.stack ?? e).slice(0, 1500));
  } finally {
    spawnSync(DOCKER, ['rm', '-f', DB], { stdio: 'ignore' });
    spawnSync(DOCKER, ['network', 'rm', NET], { stdio: 'ignore' });
    if (tree) await tree.cleanup();
  }
  const pass = phases.every((p) => p.pass);
  const body = { tool: 'backend/torneos/infra/torneos-payments-test/offline-rehearsal.mjs', generated_at: new Date().toISOString(), verdict: pass ? 'PAYMENTS_TEST_REHEARSAL_PASS' : 'PAYMENTS_TEST_REHEARSAL_FAIL',
    image: DB_IMAGE, remote_calls: 0, passed: phases.filter((p) => p.pass).length, total: phases.length, phases, results, cleanup: { container: DB, network: NET, removed: true } };
  const text = `${JSON.stringify(body, null, 1)}\n`;
  const leaks = C.secretFindings(text, known);
  fs.mkdirSync(evDir, { recursive: true });
  if (leaks.length) { log(`EVIDENCE WITHHELD: secret findings ${leaks.join(',')}`); process.exit(3); }
  fs.writeFileSync(path.join(evDir, 'REHEARSAL-result.json'), text);
  fs.writeFileSync(path.join(evDir, 'REHEARSAL-console.txt'), `${lines.join('\n')}\n`);
  log(`\n${body.verdict} ${body.passed}/${body.total} → ${path.relative(G.REPO_ROOT, evDir)} (sha256 ${G.sha256(text).slice(0, 16)})`);
  process.exit(pass ? 0 : 1);
}
main();
