// PAYMENTS TEST — every pin of the hosted Mercado Pago Checkout Pro TEST certification. Nothing here is an argument.
//
// Topology (certified design MP-B1.1 R3 + GATEWAY_AUTH_CERTIFIED; delta pinned in pins/payments-test-isolation-delta.json):
//   Core Production     rcyuuoaqfwcembdajcss   read-only (2 GETs through the certified gateway-auth client); never written.
//   Arma2 Torneos       onzpwnqxnvlgsevivngf   the data plane. The ONLY write here: one dedicated payments login
//                                              (PB), created by the installer `postgres` in one psql transaction.
//   torneos-gateway     Deno Deploy (certified) commerce OFF — never receives MERCADO_PAGO_* / TORNEOS_PAYMENT* / commerce.
//   torneos-payments-test  Deno Deploy, NEW    the certified torneos-payments sources, TORNEOS_PAYMENTS_DEPLOYMENT=remote-test,
//                                              Mercado Pago TEST seller credentials only, its own login, its own HMAC key.
//                                              Its internal route is called by this operator session (HMAC), never by the
//                                              gateway and never by a browser; no frontend, no public checkout.
//   Mercado Pago        api.mercadopago.com    TEST seller account (attested test_user, MLA); reads + one armed refund.
// QA isolation: fixtures are created by the operator's own Torneos identity through the certified gateway (org/season)
// and PostgREST (the checkout purchase RPC granted to authenticated by 0002) under the QA prefixes below; every payments
// row is provider MERCADO_PAGO / environment test by schema. Ordering permutations run on the hosted functions inside
// transactions that END IN ROLLBACK (no synthetic provider event survives).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const FUNCTIONS_DIR = path.join(REPO_ROOT, 'backend/torneos/supabase/functions');
export const EVIDENCE_DIR = path.join(REPO_ROOT, 'backend/torneos/mp-b/evidence/payments-test');
export const DELTA_PIN_FILE = path.join(HERE, 'pins/payments-test-delta.json');
export const ISOLATION_DELTA_FILE = path.join(HERE, 'pins/payments-test-isolation-delta.json');
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const { TORNEOS_REF, CORE_PROD_REF, ORG_SLUG, PAT_PATTERN } = G;

// ─────────────────────────── the TEST app ───────────────────────────
export const DENO_API_HOST = 'api.deno.com';
export const DENO_TOKEN_PATTERN = /^dd[op]_[A-Za-z0-9_-]{20,200}$/;
export const DENO_ORG = /^torneos-gateway\.([a-z0-9-]+)\.deno\.net$/.exec(G.GATEWAY_HOST)[1];
export const GATEWAY_APP_SLUG = 'torneos-gateway';
export const APP_SLUG = 'torneos-payments-test';
export const PAYMENTS_HOST = `${APP_SLUG}.${DENO_ORG}.deno.net`;
export const PAYMENTS_BASE = `https://${PAYMENTS_HOST}/functions/v1/torneos-payments`;
export const INTERNAL_PATH = '/internal/v1/season-checkout-preference';
export const WEBHOOK_PATH = '/webhooks/mercadopago/v1';
export const INTERNAL_URL = `${PAYMENTS_BASE}${INTERNAL_PATH}`;
export const WEBHOOK_URL = `${PAYMENTS_BASE}${WEBHOOK_PATH}`;
// back_urls base: the TEST app itself (GET there is a 404): buyers are never sent to a frontend, there is no public checkout.
export const APP_PUBLIC_URL = `https://${PAYMENTS_HOST}`;
export const ENTRYPOINT = 'torneos-payments/index.ts';
export const APP_CONFIG = Object.freeze({ install: null, build: null, predeploy: null, runtime: Object.freeze({ type: 'dynamic', entrypoint: ENTRYPOINT }), crons: false });
export const APP_LABELS = Object.freeze({ 'custom.component': 'arma2-torneos-payments', 'custom.environment': 'mercadopago-test' });

export const SECRET_NAMES = Object.freeze(['MERCADO_PAGO_TEST_ACCESS_TOKEN', 'MERCADO_PAGO_TEST_WEBHOOK_SECRET', 'TORNEOS_PAYMENTS_DB_URL', 'TORNEOS_PAYMENTS_INTERNAL_SECRET']);
export const CONFIG_NAMES = Object.freeze(['TORNEOS_PAYMENT_PROVIDER', 'MERCADO_PAGO_ENVIRONMENT', 'MERCADO_PAGO_TEST_SELLER_ID', 'APP_PUBLIC_URL',
  'TORNEOS_PAYMENTS_NOTIFICATION_URL', 'TORNEOS_PAYMENTS_DB_SSL_CA', 'TORNEOS_PAYMENTS_DEPLOYMENT']);
export const ENV_NAMES = Object.freeze([...SECRET_NAMES, ...CONFIG_NAMES].sort());
// SANDBOX decision (2026-09-26): the QA organization pin the remote-test sandbox policy requires. It is added after the QA
// fixtures exist (redeploy: one PATCH of exactly this public variable, merged into the app env, then a new revision).
export const QA_ORG_ENV = 'TORNEOS_PAYMENTS_TEST_QA_ORGANIZATION_ID';
export const ENV_NAMES_SCOPED = Object.freeze([...ENV_NAMES, QA_ORG_ENV].sort());
/** 'created' = the 11 names of `create`; 'scoped' = + the QA pin (after `redeploy`); anything else is a failure. */
export const envShapeOf = (names) => { const n = [...names].sort().join(','); return n === ENV_NAMES.join(',') ? 'created' : n === ENV_NAMES_SCOPED.join(',') ? 'scoped' : 'other'; };
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Never in the TEST app, by name or by pattern. */
export const FORBIDDEN_ENV = Object.freeze([/^CORE_/, /^SUPABASE_/, /^DATABASE_/, /^PG[A-Z_]*$/, /^TORNEOS_COMMERCE_/, /^TORNEOS_GATEWAY_/, /^TORNEOS_BRIDGE_/,
  /^TORNEOS_CONTRACT_/, /^TORNEOS_DB_/, /^TORNEOS_REST_/, /^TORNEOS_ANON_/, /^TORNEOS_ALLOWED_/, /^TORNEOS_PAYMENTS_LAB_/, /^MERCADO_PAGO_(?!ENVIRONMENT$|TEST_)/]);
export const forbiddenEnvNames = (names) => names.filter((n) => FORBIDDEN_ENV.some((re) => re.test(n)));
/** The gateway app must hold none of these (commerce OFF, secret scopes disjoint). */
export const GATEWAY_MUST_NOT_HOLD = Object.freeze([/^MERCADO_PAGO_/, /^TORNEOS_PAYMENT/, /^TORNEOS_COMMERCE_/]);

// ─────────────────────────── Mercado Pago TEST ───────────────────────────
export const MP_API_HOST = 'api.mercadopago.com';
export const MP_TOKEN_PATTERN = /^APP_USR-\d{6,20}-\d{6}-[0-9a-f]{32}-\d{6,20}$/;
export const MP_SECRET_PATTERN = /^[A-Za-z0-9]{32,128}$/;
export const MP_SELLER_PATTERN = /^[1-9]\d{3,19}$/;
export const PRODUCT = Object.freeze({ code: 'torneos_premium', title: 'Arma2 Torneos Premium', currency: 'ARS', listAmount: 49900, amount: 39900, quantity: 1 });
const ID = '\\d{1,32}';
export const MP_ENDPOINTS = Object.freeze([
  { id: 'users-me', method: 'GET', re: /^\/users\/me$/, kind: 'read' },
  { id: 'preference', method: 'GET', re: /^\/checkout\/preferences\/\d{1,20}-[0-9a-f-]{36}$/, kind: 'read' },
  { id: 'payment', method: 'GET', re: new RegExp(`^/v1/payments/${ID}$`), kind: 'read' },
  { id: 'payments-search', method: 'GET', re: /^\/v1\/payments\/search\?external_reference=arma2%3Aseason%3Apurchase%3A[0-9a-f-]{36}&sort=date_created&criteria=asc&limit=20$/, kind: 'read' },
  { id: 'merchant-order', method: 'GET', re: new RegExp(`^/merchant_orders/${ID}$`), kind: 'read' },
  { id: 'refund', method: 'POST', re: new RegExp(`^/v1/payments/${ID}/refunds$`), kind: 'write:refund' },
]);
export function classifyMpRequest({ method, path: p, body }, { armedFor = null } = {}) {
  const hit = MP_ENDPOINTS.find((e) => e.method === method && e.re.test(p));
  if (!hit) throw new Error(`mp_endpoint_not_allowlisted ${method} ${p}`);
  if (hit.kind === 'read' && body !== undefined) throw new Error('mp_get_with_body');
  if (hit.kind === 'write:refund') {
    if (armedFor !== `refund:${p.split('/')[3]}`) throw new Error('mp_refund_not_armed');
    if (JSON.stringify(body) !== '{}') throw new Error('mp_refund_body_must_be_full_refund');
  }
  return { id: hit.id, kind: hit.kind };
}
/** The attestation (same rule as remote-test.ts): the configured seller, tagged test_user, MLA. */
export function attestationOf(me, sellerId) {
  const tags = Array.isArray(me?.tags) ? me.tags.map(String) : [];
  return { seller_matches: String(me?.id ?? '') === sellerId, test_user: tags.includes('test_user'), site: typeof me?.site_id === 'string' ? me.site_id : null,
    pass: String(me?.id ?? '') === sellerId && tags.includes('test_user') && me?.site_id === 'MLA' };
}

// ─────────────────────────── QA fixtures ───────────────────────────
export const QA = Object.freeze({
  orgName: 'QA PAYMENTS TEST (Mercado Pago sandbox)', orgSlugPrefix: 'qa-payments-test-',
  seasons: Object.freeze([
    { key: 'S1', name: 'QA PAYMENTS TEST S1 checkout sandbox', slugPrefix: 'qa-pt-s1-', purpose: 'real Mercado Pago TEST checkout: rejected attempt, approved, grant, duplicate, refund' },
    { key: 'S2', name: 'QA PAYMENTS TEST S2 ordering rollback', slugPrefix: 'qa-pt-s2-', purpose: 'ordering / watermark permutations on the hosted functions, every transaction rolled back' },
  ]),
});
export const QA_SLUG_RE = /^qa-payments-test-[a-z0-9]{6,12}$/;

// ─────────────────────────── PB — the payments login ───────────────────────────
export const PAYMENT_LOGIN = 'torneos_payments_test';
export const PAYMENT_ROLE = 'torneos_payment_service';
export const KEYCHAIN_SERVICE = 'arma2-torneos-payments-test';
export const KEYCHAIN_ACCOUNTS = Object.freeze({ dbPassword: PAYMENT_LOGIN, internalSecret: 'internal-hmac-key' });
export const INTERNAL_SECRET_PATTERN = /^[0-9a-f]{64}$/;
export const PAYMENT_EXECUTES = Object.freeze([
  'apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamp with time zone)',
  'apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamp with time zone)',
  'get_provider_tournament_purchase(text,text,text)',
  'record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)',
]);

/** The ONLY SQL of PB: one transaction; guards first (login absent, no other payment login, role shape), SCRAM only. */
export function renderPaymentBootstrapSql(verifier) {
  if (!G.SCRAM_PATTERN.test(verifier ?? '')) throw new Error('verifier_shape');
  return [
    'BEGIN;',
    "SET LOCAL statement_timeout = '30s';",
    `DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PAYMENT_LOGIN}') THEN RAISE EXCEPTION 'PAYMENTS_LOGIN_ALREADY_PRESENT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PAYMENT_ROLE}' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls) THEN RAISE EXCEPTION 'PAYMENT_ROLE_SHAPE_UNEXPECTED'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolcanlogin AND NOT r.rolsuper AND (pg_has_role(r.oid, '${PAYMENT_ROLE}', 'SET') OR pg_has_role(r.oid, '${PAYMENT_ROLE}', 'USAGE'))) THEN RAISE EXCEPTION 'PAYMENT_LOGIN_ALREADY_PRESENT'; END IF;
END $guard$;`.replace(/\n/g, ' '),
    `CREATE ROLE ${PAYMENT_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}';`,
    `GRANT ${PAYMENT_ROLE} TO ${PAYMENT_LOGIN} WITH INHERIT FALSE, SET TRUE;`,
    'COMMIT;',
    '',
  ].join('\n');
}
export const BOOTSTRAP_SQL_TEMPLATE = renderPaymentBootstrapSql(`SCRAM-SHA-256$4096:${'A'.repeat(22)}==$${'A'.repeat(43)}=:${'A'.repeat(43)}=`)
  .replace(/PASSWORD 'SCRAM-SHA-256\$[^']+'/, "PASSWORD '<SCRAM-SHA-256 verifier>'");

/** The installer (`postgres`), measured by name (never current_user): can it create the login and grant the role? */
export const INSTALLER_SQL = `select json_build_object(
 'createrole', (select rolcreaterole from pg_roles where rolname = 'postgres'),
 'super', (select rolsuper from pg_roles where rolname = 'postgres'),
 'admin_on_payment_role', (select pg_has_role('postgres', r.oid, 'MEMBER WITH ADMIN OPTION') from pg_roles r where r.rolname = '${PAYMENT_ROLE}')
)`;
export const installerCan = (m) => m?.super === true || (m?.createrole === true && m?.admin_on_payment_role === true);

/** Everything about the payments login and role the catalog pin cannot express. Read-only. */
export const PAYMENT_ROLES_SQL = `select json_build_object(
 'login', (select json_build_object('name', rolname, 'login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper, 'createrole', rolcreaterole, 'createdb', rolcreatedb,
   'replication', rolreplication, 'bypassrls', rolbypassrls, 'connlimit', rolconnlimit, 'valid_until', rolvaliduntil, 'config', rolconfig) from pg_roles where rolname = '${PAYMENT_LOGIN}'),
 'login_memberships', (select coalesce(json_agg(json_build_object('role', pg_get_userbyid(m.roleid), 'admin', m.admin_option, 'inherit', m.inherit_option, 'set', m.set_option) order by pg_get_userbyid(m.roleid)), '[]'::json)
   from pg_auth_members m join pg_roles l on l.oid = m.member where l.rolname = '${PAYMENT_LOGIN}'),
 'login_members', (select coalesce(json_agg(json_build_object('member', pg_get_userbyid(m.member), 'admin', m.admin_option, 'inherit', m.inherit_option, 'set', m.set_option) order by pg_get_userbyid(m.member)), '[]'::json)
   from pg_auth_members m join pg_roles l on l.oid = m.roleid where l.rolname = '${PAYMENT_LOGIN}'),
 'reachable_roles', (select coalesce(json_agg(r.rolname order by r.rolname), '[]'::json) from pg_roles l, pg_roles r
   where l.rolname = '${PAYMENT_LOGIN}' and r.oid <> l.oid and (pg_has_role(l.oid, r.oid, 'SET') or pg_has_role(l.oid, r.oid, 'USAGE'))),
 'payment_logins', (select coalesce(json_agg(r.rolname order by r.rolname), '[]'::json) from pg_roles r where r.rolcanlogin and not r.rolsuper
   and (pg_has_role(r.oid, '${PAYMENT_ROLE}', 'SET') or pg_has_role(r.oid, '${PAYMENT_ROLE}', 'USAGE'))),
 'role', (select json_build_object('login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper, 'bypassrls', rolbypassrls, 'createrole', rolcreaterole) from pg_roles where rolname = '${PAYMENT_ROLE}'),
 'role_executes', (select coalesce(json_agg(regexp_replace(p.oid::regprocedure::text, '^public\\.', '') order by p.oid::regprocedure::text), '[]'::json) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('${PAYMENT_ROLE}', p.oid, 'EXECUTE')),
 'role_table_privileges', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private', 'auth', 'storage') and c.relkind in ('r', 'v', 'm', 'p', 'S')
   and (has_table_privilege('${PAYMENT_ROLE}', c.oid, 'SELECT') or has_table_privilege('${PAYMENT_ROLE}', c.oid, 'INSERT') or has_table_privilege('${PAYMENT_ROLE}', c.oid, 'UPDATE') or has_table_privilege('${PAYMENT_ROLE}', c.oid, 'DELETE'))),
 'role_schema_create', (select coalesce(json_agg(n.nspname order by n.nspname), '[]'::json) from pg_namespace n where n.nspname in ('public', 'private', 'app_private') and has_schema_privilege('${PAYMENT_ROLE}', n.oid, 'CREATE'))
)`;

/** Data-plane census: counts only, QA scoped by the pinned slug prefix. No PII, no values. */
const QA_ORGS = `(select id from public.tournament_organizations where slug like '${QA.orgSlugPrefix}%')`;
export const CENSUS_SQL = `select json_build_object(
 'auth_users', (select count(*) from auth.users),
 'identities', (select count(*) from public.torneos_identity),
 'organizations', (select count(*) from public.tournament_organizations),
 'organizations_qa', (select count(*) from public.tournament_organizations where slug like '${QA.orgSlugPrefix}%'),
 'organization_members', (select count(*) from public.tournament_organization_members),
 'seasons', (select count(*) from public.tournament_seasons),
 'seasons_outside_qa', (select count(*) from public.tournament_seasons where organization_id not in ${QA_ORGS}),
 'tournaments', (select count(*) from public.tournaments),
 'purchases', (select count(*) from public.tournament_purchases),
 'purchases_outside_qa', (select count(*) from public.tournament_purchases where organization_id not in ${QA_ORGS}),
 'purchases_not_mp_test', (select count(*) from public.tournament_purchases where provider <> 'MERCADO_PAGO' or provider_environment <> 'test'),
 'purchase_events', (select count(*) from public.tournament_purchase_events),
 'purchase_events_outside_qa', (select count(*) from public.tournament_purchase_events where organization_id not in ${QA_ORGS}),
 'season_grants', (select count(*) from public.tournament_season_plan_grants),
 'season_grants_outside_qa', (select count(*) from public.tournament_season_plan_grants where organization_id not in ${QA_ORGS}),
 'grant_events', (select count(*) from public.tournament_season_plan_grant_events),
 'watermarks', (select count(*) from public.tournament_payment_provider_watermarks),
 'watermarks_outside_qa', (select count(*) from public.tournament_payment_provider_watermarks w join public.tournament_purchases p on p.id = w.purchase_id where p.organization_id not in ${QA_ORGS})
)`;
/** The QA purchases with their whole commercial trail (ids, states, amounts, provider ids and times; no PII). */
export const QA_TRAIL_SQL = `select coalesce(json_agg(json_build_object(
  'purchase', p.id, 'season', p.season_id, 'season_slug', s.slug, 'status', p.status, 'provider', p.provider, 'environment', p.provider_environment, 'product', p.product_code,
  'offer', p.offer_code, 'amount', p.amount_snapshot, 'list_amount', p.list_amount_snapshot, 'currency', p.currency, 'external_reference', p.external_reference,
  'preference_id', p.provider_preference_id, 'approved_payment', p.approved_provider_payment_id, 'provider_status', p.provider_status, 'provider_status_detail', p.provider_status_detail,
  'created_at', p.created_at, 'approved_at', p.approved_at, 'refunded_at', p.refunded_at, 'charged_back_at', p.charged_back_at, 'entitlement_activated_at', p.entitlement_activated_at,
  'events', (select coalesce(json_agg(json_build_object('id', e.id, 'type', e.event_type, 'from', e.from_status, 'to', e.to_status, 'actor', e.actor_type, 'provider_status', e.provider_status,
     'payment', e.metadata->>'providerPaymentId', 'provider_time', e.metadata->>'providerDateLastUpdated') order by e.id), '[]'::json) from public.tournament_purchase_events e where e.purchase_id = p.id),
  'grants', (select coalesce(json_agg(json_build_object('grant', g.id, 'plan', g.plan_code, 'source', g.source,
     'events', (select coalesce(json_agg(json_build_object('type', ge.event_type, 'reason_code', ge.reason_code, 'actor', ge.actor_type) order by ge.id), '[]'::json)
       from public.tournament_season_plan_grant_events ge where ge.season_grant_id = g.id),
     -- = public.is_tournament_season_plan_grant_effective (service_role only), inlined for the read-only session
     'effective', coalesce((select ge.event_type not in ('suspended', 'revoked') from public.tournament_season_plan_grant_events ge where ge.season_grant_id = g.id order by ge.id desc limit 1), true)) order by g.created_at), '[]'::json) from public.tournament_season_plan_grants g where g.origin_purchase_id = p.id),
  'watermarks', (select coalesce(json_agg(json_build_object('payment', w.provider_payment_id, 'date_last_updated', w.date_last_updated, 'state', w.snapshot_state,
     'manual_refund', w.requires_manual_refund, 'manual_review', w.requires_manual_review) order by w.provider_payment_id), '[]'::json) from public.tournament_payment_provider_watermarks w where w.purchase_id = p.id)
 ) order by p.created_at), '[]'::json) as trail
 from public.tournament_purchases p join public.tournament_seasons s on s.id = p.season_id
 where p.organization_id in ${QA_ORGS}`;
for (const sql of [INSTALLER_SQL, PAYMENT_ROLES_SQL, CENSUS_SQL, QA_TRAIL_SQL]) G.assertReadOnlySql(sql);

// ─────────────────────────── the allowed delta ───────────────────────────
/**
 * Invariants of the database after GATEWAY_AUTH + PB. The certified gateway invariants hold unchanged except the three
 * that, by construction, count the new login (all logins, exactly 2 torneos logins, 0 payment logins); those are replaced
 * by exact statements about the two gateway logins AND the payments login.
 */
export const GATEWAY_INVARIANTS_REPLACED = Object.freeze(['torneos_login_roles_not_exactly_2', 'edge_logins_not_exact', 'payment_login_present']);
export function paymentsDeltaFailures(catalog, gatewayRoles, paymentRoles, { expectLogin = true } = {}) {
  const f = G.gatewayInvariantFailures(catalog, gatewayRoles).filter((x) => !GATEWAY_INVARIANTS_REPLACED.includes(x));
  const logins = (gatewayRoles?.logins ?? []).map((l) => l.name).sort();
  const edge = G.EDGE_LOGINS.map((l) => l.login).sort();
  const want = expectLogin ? [...edge, PAYMENT_LOGIN].sort() : edge;
  if (JSON.stringify(logins) !== JSON.stringify(want)) f.push('torneos_logins_not_exact');
  if (Number(catalog?.login_roles_torneos) !== want.length) f.push(`torneos_login_roles_not_exactly_${want.length}`);
  if (!expectLogin) {
    if (Number(gatewayRoles?.payment_logins) !== 0 || paymentRoles?.login !== null) f.push('payment_login_present');
    return f;
  }
  const l = paymentRoles?.login;
  if (!l || l.login !== true || l.inherit !== false || l.super || l.createrole || l.createdb || l.replication || l.bypassrls) f.push('payment_login_attributes');
  if (l && (l.connlimit !== -1 || l.valid_until !== null || !(l.config === null || (Array.isArray(l.config) && l.config.length === 0)))) f.push('payment_login_settings');
  if (JSON.stringify(paymentRoles?.login_memberships) !== JSON.stringify([{ role: PAYMENT_ROLE, admin: false, inherit: false, set: true }])) f.push('payment_login_membership_not_exact');
  // PG 16+: a CREATEROLE creator is granted ADMIN on the role it creates (INHERIT/SET false): exactly that, nothing else.
  if (JSON.stringify(paymentRoles?.login_members) !== JSON.stringify([{ member: 'postgres', admin: true, inherit: false, set: false }])) f.push('payment_login_members_not_only_the_installer_admin');
  if (JSON.stringify(paymentRoles?.reachable_roles) !== JSON.stringify([PAYMENT_ROLE])) f.push('payment_login_reaches_other_roles');
  if (JSON.stringify(paymentRoles?.payment_logins) !== JSON.stringify([PAYMENT_LOGIN])) f.push('payment_logins_not_exactly_the_test_login');
  if (Number(gatewayRoles?.payment_logins) !== 1) f.push('gateway_view_payment_logins_not_1');
  const r = paymentRoles?.role;
  if (!r || r.login || r.inherit || r.super || r.bypassrls || r.createrole) f.push('payment_role_shape');
  if (JSON.stringify(paymentRoles?.role_executes) !== JSON.stringify(PAYMENT_EXECUTES)) f.push('payment_role_executes_not_exact');
  if (Number(paymentRoles?.role_table_privileges) !== 0) f.push('payment_role_table_privileges');
  if ((paymentRoles?.role_schema_create ?? ['?']).length !== 0) f.push('payment_role_schema_create');
  return f;
}
/** 'absent' | 'present' | 'foreign' from the census of payment logins. */
export function paymentLoginState(paymentRoles) {
  const names = paymentRoles?.payment_logins;
  if (!Array.isArray(names)) return 'unreadable';
  if (names.length === 0 && paymentRoles.login === null) return 'absent';
  if (JSON.stringify(names) === JSON.stringify([PAYMENT_LOGIN]) && paymentRoles.login) return 'present';
  return 'foreign';
}
/** Data-plane isolation verdict of a census: everything commercial is QA-scoped and MP TEST. */
export function censusFailures(c, { allowQa = true } = {}) {
  const f = [];
  if (!c) return ['census_unreadable'];
  if (Number(c.auth_users) !== 0) f.push('torneos_auth_has_users');
  for (const k of ['purchases_outside_qa', 'purchase_events_outside_qa', 'season_grants_outside_qa', 'watermarks_outside_qa', 'purchases_not_mp_test']) if (Number(c[k]) !== 0) f.push(`census_${k}`);
  if (!allowQa && (Number(c.organizations_qa) !== 0)) f.push('census_qa_present');
  return f;
}

// ─────────────────────────── Deno Deploy allowlist (the TEST app; the gateway app read-only) ───────────────────────────
const A = APP_SLUG;
export const DENO_ENDPOINTS = Object.freeze([
  { id: 'apps', method: 'GET', re: /^\/v2\/apps(\?limit=100)?$/, kind: 'read' },
  { id: 'app', method: 'GET', re: new RegExp(`^/v2/apps/(${A}|${GATEWAY_APP_SLUG})$`), kind: 'read' },
  { id: 'layers', method: 'GET', re: /^\/v2\/layers$/, kind: 'read' },
  { id: 'revisions', method: 'GET', re: new RegExp(`^/v2/apps/(${A}|${GATEWAY_APP_SLUG})/revisions(\\?limit=\\d{1,3})?$`), kind: 'read' },
  { id: 'revision', method: 'GET', re: /^\/v2\/revisions\/[A-Za-z0-9_-]{4,80}$/, kind: 'read' },
  { id: 'revision-timelines', method: 'GET', re: /^\/v2\/revisions\/[A-Za-z0-9_-]{4,80}\/timelines$/, kind: 'read' },
  { id: 'logs', method: 'GET', re: new RegExp(`^/v2/apps/${A}/logs\\?start=[0-9A-Z:.%-]+&end=[0-9A-Z:.%-]+(&limit=\\d{1,4})?$`), kind: 'read' },
  { id: 'app-create', method: 'POST', re: /^\/v2\/apps$/, kind: 'write:app-create' },
  { id: 'deploy', method: 'POST', re: new RegExp(`^/v2/apps/${A}/deploy$`), kind: 'write:deploy' },
  { id: 'app-env', method: 'PATCH', re: new RegExp(`^/v2/apps/${A}$`), kind: 'write:app-env' },
]);
export function classifyDenoRequest({ method, path: p, body }, { armedFor = null } = {}) {
  const hit = DENO_ENDPOINTS.find((e) => e.method === method && e.re.test(p));
  if (!hit) throw new Error(`deno_endpoint_not_allowlisted ${method} ${p}`);
  if (hit.kind === 'read' && body !== undefined) throw new Error('deno_get_with_body');
  if (hit.kind.startsWith('write:')) {
    const w = hit.kind.slice(6);
    if (armedFor !== w) throw new Error(`deno_write_not_armed ${w}`);
    assertDenoWriteBody(w, body);
  }
  return { id: hit.id, kind: hit.kind };
}
export function assertDenoWriteBody(w, body) {
  if (!body || typeof body !== 'object') throw new Error('deno_body_missing');
  if (w === 'app-create') {
    if (Object.keys(body).sort().join(',') !== 'config,env_vars,labels,layers,slug' || body.slug !== APP_SLUG) throw new Error('deno_create_shape');
    if (JSON.stringify(body.config) !== JSON.stringify(APP_CONFIG)) throw new Error('deno_create_config');
    if (!(Array.isArray(body.layers) && body.layers.length === 0)) throw new Error('deno_layers_refused');
    if (JSON.stringify(body.labels) !== JSON.stringify(APP_LABELS)) throw new Error('deno_create_labels');
    const keys = body.env_vars.map((e) => e.key);
    const bad = forbiddenEnvNames(keys);
    if (bad.length) throw new Error(`deno_env_forbidden ${bad.join(',')}`);
    if ([...keys].sort().join(',') !== ENV_NAMES.join(',') || new Set(keys).size !== keys.length) throw new Error('deno_env_not_exact');
    for (const e of body.env_vars) {
      if (Object.keys(e).sort().join(',') !== 'contexts,key,secret,value') throw new Error('deno_env_entry_shape');
      if (e.secret !== SECRET_NAMES.includes(e.key)) throw new Error('deno_env_secret_flag');
      if (e.contexts !== 'all' || typeof e.value !== 'string' || !e.value) throw new Error('deno_env_value');
    }
    const v = Object.fromEntries(body.env_vars.map((e) => [e.key, e.value]));
    if (v.TORNEOS_PAYMENT_PROVIDER !== 'MERCADO_PAGO' || v.MERCADO_PAGO_ENVIRONMENT !== 'test' || v.TORNEOS_PAYMENTS_DEPLOYMENT !== 'remote-test') throw new Error('deno_env_mode');
    if (v.APP_PUBLIC_URL !== APP_PUBLIC_URL || v.TORNEOS_PAYMENTS_NOTIFICATION_URL !== WEBHOOK_URL) throw new Error('deno_env_urls');
    if (!MP_TOKEN_PATTERN.test(v.MERCADO_PAGO_TEST_ACCESS_TOKEN) || !MP_SECRET_PATTERN.test(v.MERCADO_PAGO_TEST_WEBHOOK_SECRET) || !MP_SELLER_PATTERN.test(v.MERCADO_PAGO_TEST_SELLER_ID)) throw new Error('deno_env_mp_shape');
    if (!INTERNAL_SECRET_PATTERN.test(v.TORNEOS_PAYMENTS_INTERNAL_SECRET)) throw new Error('deno_env_internal_shape');
    const db = new URL(v.TORNEOS_PAYMENTS_DB_URL);
    if (decodeURIComponent(db.username) !== `${PAYMENT_LOGIN}.${TORNEOS_REF}` || !/^aws-\d{1,2}-sa-east-1\.pooler\.supabase\.com$/.test(db.hostname) || db.port !== '6543' || db.pathname !== '/postgres' || db.search) throw new Error('deno_env_db_url');
  } else if (w === 'app-env') {
    // exactly the one public QA pin; Deno merges a PATCH env_vars list into the app env (certified by the gateway R2 run)
    if (Object.keys(body).join(',') !== 'env_vars' || !Array.isArray(body.env_vars) || body.env_vars.length !== 1) throw new Error('deno_env_update_only_qa_pin');
    const [e] = body.env_vars;
    if (Object.keys(e).sort().join(',') !== 'contexts,key,secret,value' || e.key !== QA_ORG_ENV || e.secret !== false || e.contexts !== 'all' || !UUID_PATTERN.test(e.value)) throw new Error('deno_env_update_only_qa_pin');
  } else if (w === 'deploy') {
    if (Object.keys(body).sort().join(',') !== 'assets,labels,preview,production') throw new Error('deno_deploy_shape');
    if (body.production !== true || body.preview !== false) throw new Error('deno_deploy_timelines');
    assertAssets(body.assets);
  } else throw new Error(`deno_write_unknown ${w}`);
  return true;
}
/** Deploy assets: the payments module graph only (torneos-payments/* + _shared/*), utf-8, nothing secret-shaped. */
export function assertAssets(assets) {
  const keys = Object.keys(assets ?? {});
  if (!keys.includes(ENTRYPOINT)) throw new Error('deno_assets_no_entrypoint');
  for (const k of keys) {
    if (!/^(torneos-payments\/[a-z0-9-]+\.ts|_shared\/[A-Za-z]+\.ts)$/.test(k)) throw new Error(`deno_asset_outside_graph ${k}`);
    const a = assets[k];
    if (a.kind !== 'file' || a.encoding !== 'utf-8' || typeof a.content !== 'string') throw new Error('deno_asset_shape');
    const scanned = a.content.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----(?!\s*[A-Za-z0-9+/]{40})/g, '«pem-header-literal»');
    if (G.secretFindings(scanned).length) throw new Error(`deno_asset_secret_shaped ${k}`);
  }
  return true;
}

// ─────────────────────────── phrases, PAT, secret scan ───────────────────────────
export const PHRASES = Object.freeze({
  bootstrap: (id) => `CREATE TORNEOS PAYMENTS TEST LOGIN ${PAYMENT_LOGIN} ${id}`,
  create: (id) => `CREATE TORNEOS PAYMENTS TEST DENO APP ${APP_SLUG} ${id}`,
  redeploy: (id) => `REDEPLOY TORNEOS PAYMENTS TEST DENO APP ${APP_SLUG} ${id}`,
  preference: (id) => `CREATE MERCADO PAGO TEST PREFERENCE ${id}`,
  refund: (id) => `REFUND MERCADO PAGO TEST PAYMENT ${id}`,
});
/** Read-only Supabase PAT: exactly the certified --db-certify reads (catalog, pooler, functions, B03, Core Prod status). */
export const SUPABASE_MODE = '--db-certify';
export function patText() {
  return [`Supabase scoped token (READ-ONLY), resource access: Organization ${ORG_SLUG}, expiry 24 hours:`, ...G.patRequirement(SUPABASE_MODE).permissions.map((p) => `  ${p}`), '  everything else: None'].join('\n');
}
export const SECRET_SHAPES = [...G.SECRET_SHAPES, /APP_USR-\d{6,20}-\d{6}-[0-9a-f]{32}-\d{6,20}/, /TEST-\d{6,20}-\d{6}-[0-9a-f]{32}-\d{6,20}/];
export function secretFindings(text, known = []) {
  const out = G.secretFindings(text, known);
  for (const re of SECRET_SHAPES.slice(G.SECRET_SHAPES.length)) if (re.test(text)) out.push(`shape:${re.source.slice(0, 24)}`);
  return out;
}
export function readDeltaPin(file = DELTA_PIN_FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
