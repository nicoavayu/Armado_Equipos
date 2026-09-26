// GATEWAY/AUTH (G2) — Production gateway/auth tooling: every pin the runner obeys.
//
// Nothing here is an argument. The runner (gateway-auth.mjs) and the wrapper (run-gateway-auth.sh) take a MODE and a
// PAT, nothing else. Architecture (definitive):
//
//   Core Production  rcyuuoaqfwcembdajcss  the HTTPS AUTHORITY only. This tooling: GET project + GET the certified
//                                          torneos-core-contract. Never a write, never a DB connection.
//   Arma2 Torneos    onzpwnqxnvlgsevivngf  the DATA plane (sa-east-1). The only project this tooling writes, and only
//                                          the writes below. 0 Supabase Edge Functions, before and after.
//   Core Staging     hhyvmhgpapyuzjgxfnqv  GET project only: must stay INACTIVE.
//   Old project      giaeztyghmhzcngskjmw  GET project only: must stay INACTIVE.
//   Torneos gateway  external app (Deno Deploy). NOT created, configured or deployed by this tooling: --deploy-preflight
//                    only proves its configuration against the real gateway config.ts, offline.
//
// The remote delta this tooling models (and applies only in its own mode, after the typed phrase):
//   W1  --auth-lockdown   PATCH /v1/projects/<torneos>/config/auth with AUTH_LOCKDOWN_BODY, exactly (6 keys).
//   W2  --db-bootstrap    ALTER ROLE authenticator SET pgrst.db_pre_request = 'private.check_token'
//   W3  --db-bootstrap    CREATE ROLE torneos_edge_identity_writer / torneos_edge_core_adapter LOGIN NOINHERIT
//                         + GRANT torneos_identity_writer / torneos_core_adapter (W2 + W3: ONE psql transaction)
//   KR  --keyring-generate  LOCAL ONLY: a new Production RS256 ring (k1 active, k2 standby) into the Keychain and the
//                         public JWKS pin (pins/production-bridge-jwks.json). No remote write.
//   W5  --b03             POST /v1/projects/<torneos>/config/auth/third-party-auth {jwks_url: B03_JWKS_URL} (the
//                         gateway's public k1+k2). Replaces, once, the superseded inline custom_jwks integration
//                         B03_SUPERSEDED_INLINE_ID (hosted never resolved it: resolved_at null, PGRST301) with a DELETE of
//                         exactly that id, then the POST. Decision of 2026-09-26 (owner, option A): iss/aud unchanged.
// No payments login, no Edge Function, no secret, no deploy, no Deno Deploy, no Mercado Pago, no migration.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as FC from '../torneos-foundation/foundation-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

export const API_HOST = 'api.supabase.com';
export const ORG_SLUG = 'gwqrborhnqjdzzmpxulh';
export const CORE_PROD_REF = 'rcyuuoaqfwcembdajcss';
export const TORNEOS_REF = 'onzpwnqxnvlgsevivngf';
export const STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
export const OLD_REF = 'giaeztyghmhzcngskjmw';
export const PROJECT_NAME = 'Arma2 Torneos';
export const REGION = 'sa-east-1';
export const REF_PATTERN = /^[a-z]{20}$/;
export const PAT_PATTERN = /^sbp_[A-Za-z0-9_]{20,160}$/;
export const WEB_ORIGIN = 'https://app.arma2.com.ar';

// Core Production contract certification (INFRA-1 harness-only, 2026-09-24): the ezbr every mode re-checks.
export const CORE_CONTRACT_SLUG = FC.CORE_CONTRACT_SLUG;
export const CORE_CONTRACT_EZBR = FC.CORE_CONTRACT_EZBR;

// The gateway topology (backend/torneos/supabase/functions/torneos-gateway/topology.ts). Duplicated on purpose (this
// tooling runs on plain Node); gateway-auth.test.mjs proves both copies equal.
export const GATEWAY_TOPOLOGY = Object.freeze({
  coreAuthUrl: `https://${CORE_PROD_REF}.supabase.co/auth/v1`,
  coreJwtIssuer: `https://${CORE_PROD_REF}.supabase.co/auth/v1`,
  coreContractUrl: `https://${CORE_PROD_REF}.supabase.co/functions/v1/torneos-core-contract`,
  torneosRestUrl: `https://${TORNEOS_REF}.supabase.co/rest/v1`,
  allowedOrigin: WEB_ORIGIN,
  identityWriterLogin: 'torneos_edge_identity_writer',
  coreAdapterLogin: 'torneos_edge_core_adapter',
});
// Bridge token constants of the certified baseline (token.ts + private.current_identity_id()). NOT changed here: if a
// remote measurement shows the host refuses them, the verdict is B03_HOST_REJECTS_BRIDGE_TOKEN and the run STOPs.
export const BRIDGE = Object.freeze({ alg: 'RS256', issuer: 'urn:arma2:local:identity-bridge', audience: 'arma2-torneos-local', ttl: 120, toleranceSeconds: 5 });

// ─────────────────────────── foundation reuse (certified, never modified) ───────────────────────────
// The foundation contract and its catalog pin are imported read-only; a drift of either stops every mode.
export const FOUNDATION_FILES = Object.freeze({
  'backend/torneos/infra/torneos-foundation/foundation-contract.mjs': '579adccdef294d1bb01b33fda69b8bfc51ba472acaa3a1a36fce59c73d34047e',
  'backend/torneos/infra/torneos-foundation/pins/expected-catalog.json': '5d66d4f418d387ac584283b7ed6d8e53ae39e88cfc0748dda51423a7458ec62b',
  'backend/torneos/infra/torneos-foundation/postgrest-probe.mjs': '112ea6482e6d2bd72b73aac9eebfc6d13a132fb23b53e3621ea5cdd943149f8c',
});
export function foundationDrift(repoRoot = REPO_ROOT) {
  return Object.entries(FOUNDATION_FILES).filter(([rel, want]) => { try { return sha256(fs.readFileSync(path.join(repoRoot, rel))) !== want; } catch { return true; } }).map(([rel]) => rel);
}
export const FOUNDATION_PIN_FILE = path.join(REPO_ROOT, 'backend/torneos/infra/torneos-foundation/pins/expected-catalog.json');
export const { CATALOG_SQL, assertReadOnlySql, getPath } = FC;
export const DELTA_PIN_FILE = path.join(HERE, 'pins/gateway-auth-delta.json');
export const JWKS_PIN_FILE = path.join(HERE, 'pins/production-bridge-jwks.json');

// ─────────────────────────── W1 — Auth lockdown ───────────────────────────
// Torneos has NO login of its own: users log in to Core only. The body is exactly these six keys.
export const AUTH_LOCKDOWN_BODY = Object.freeze({
  disable_signup: true,
  external_email_enabled: false,
  external_phone_enabled: false,
  external_anonymous_users_enabled: false,
  site_url: WEB_ORIGIN,
  mfa_totp_enroll_enabled: false,
});
// Every other sign-in / enrollment path must ALREADY be off: checks only, never in the body (if one is not false: STOP,
// a human looks). The named keys must be present and false; every other external_*_enabled / hook_*_enabled the API
// returns is checked too.
export const AUTH_MUST_BE_OFF = Object.freeze(['custom_oauth_enabled', 'external_apple_enabled', 'external_azure_enabled', 'external_github_enabled', 'external_google_enabled',
  'external_web3_ethereum_enabled', 'external_web3_solana_enabled', 'hook_custom_access_token_enabled', 'mfa_phone_enroll_enabled', 'mfa_web_authn_enroll_enabled',
  'oauth_server_enabled', 'passkey_enabled', 'saml_enabled', 'security_manual_linking_enabled']);
export const AUTH_MUST_BE_OFF_PATTERN = /^(external|hook)_[a-z0-9_]+_enabled$/;
export const authMustOffKeys = (cfg) => [...new Set([...AUTH_MUST_BE_OFF, ...Object.keys(cfg ?? {}).filter((k) => AUTH_MUST_BE_OFF_PATTERN.test(k) && !(k in AUTH_LOCKDOWN_BODY))])].sort();
export const AUTH_CONFIG_KEYS = Object.freeze(['site_url', 'uri_allow_list', 'disable_signup', 'jwt_exp', 'external_anonymous_users_enabled', 'external_email_enabled', 'external_phone_enabled',
  'mailer_autoconfirm', 'sms_autoconfirm', 'mfa_totp_enroll_enabled', ...AUTH_MUST_BE_OFF]);
export function assertAuthLockdownBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('auth_body_missing');
  if (Object.keys(body).sort().join(',') !== Object.keys(AUTH_LOCKDOWN_BODY).sort().join(',')) throw new Error('auth_body_keys');
  for (const [k, v] of Object.entries(AUTH_LOCKDOWN_BODY)) if (body[k] !== v) throw new Error(`auth_body_value_${k}`);
}
/** 'applied' | 'pending' ; problems[] = sign-in / enrollment paths outside the body that are not false. */
export function authState(cfg) {
  if (!cfg || typeof cfg !== 'object') return { state: 'unreadable', problems: ['AUTH_CONFIG_UNREADABLE'] };
  const problems = authMustOffKeys(cfg).filter((k) => cfg[k] !== false).map((k) => `AUTH_${k.toUpperCase()}_${cfg[k] === true ? 'ON' : 'NOT_FALSE'}`);
  const applied = Object.entries(AUTH_LOCKDOWN_BODY).every(([k, v]) => cfg[k] === v);
  return { state: applied ? 'applied' : 'pending', problems, differs: Object.entries(AUTH_LOCKDOWN_BODY).filter(([k, v]) => cfg[k] !== v).map(([k]) => k) };
}

// ─────────────────────────── W2 + W3 — gateway DB bootstrap ───────────────────────────
export const EDGE_LOGINS = Object.freeze([
  { login: 'torneos_edge_identity_writer', memberOf: 'torneos_identity_writer' },
  { login: 'torneos_edge_core_adapter', memberOf: 'torneos_core_adapter' },
]);
export const PRE_REQUEST = 'private.check_token';
export const PRE_REQUEST_ROLECONFIG = Object.freeze([`pgrst.db_pre_request=${PRE_REQUEST}`]);
export const DB_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{40}$/;
export const SCRAM_PATTERN = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;

/**
 * RFC 5802/7677 SCRAM-SHA-256 verifier, PostgreSQL format. The server stores exactly this, so the plaintext password
 * never reaches the server, its logs or pg_stat_statements: only the gateway's DB URL (a later, separate custody) has it.
 */
export function scramKeys(password, salt, iterations) {
  const salted = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
  return { clientKey, storedKey: crypto.createHash('sha256').update(clientKey).digest(), serverKey: crypto.createHmac('sha256', salted).update('Server Key').digest() };
}
export function scramVerifier(password, { salt = crypto.randomBytes(16), iterations = 4096 } = {}) {
  if (!DB_PASSWORD_PATTERN.test(password)) throw new Error('password_shape');
  const { storedKey, serverKey } = scramKeys(password, salt, iterations);
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** The ONLY SQL --db-bootstrap sends: one transaction, the refusal guard first, the reload inside the commit. */
export function renderBootstrapSql(verifiers) {
  for (const { login } of EDGE_LOGINS) if (!SCRAM_PATTERN.test(verifiers?.[login] ?? '')) throw new Error(`verifier_shape_${login}`);
  if (Object.keys(verifiers).sort().join(',') !== EDGE_LOGINS.map((l) => l.login).sort().join(',')) throw new Error('verifier_keys');
  return [
    'BEGIN;',
    "SET LOCAL statement_timeout = '30s';",
    `DO $guard$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (${EDGE_LOGINS.map((l) => `'${l.login}'`).join(', ')})) THEN RAISE EXCEPTION 'GATEWAY_LOGINS_ALREADY_PRESENT'; END IF; END $guard$;`,
    ...EDGE_LOGINS.map((l) => `CREATE ROLE ${l.login} LOGIN NOINHERIT PASSWORD '${verifiers[l.login]}';`),
    ...EDGE_LOGINS.map((l) => `GRANT ${l.memberOf} TO ${l.login};`),
    `ALTER ROLE authenticator SET pgrst.db_pre_request = '${PRE_REQUEST}';`,
    "NOTIFY pgrst, 'reload config';",
    "NOTIFY pgrst, 'reload schema';",
    'COMMIT;',
    '',
  ].join('\n');
}
/** The statement skeleton with the verifiers masked: what the plan prints and the evidence records (and hashes). */
export const BOOTSTRAP_SQL_TEMPLATE = renderBootstrapSql(Object.fromEntries(EDGE_LOGINS.map((l) => [l.login, `SCRAM-SHA-256$4096:${'A'.repeat(22)}==$${'A'.repeat(43)}=:${'A'.repeat(43)}=`])))
  .replace(/PASSWORD 'SCRAM-SHA-256\$[^']+'/g, "PASSWORD '<SCRAM-SHA-256 verifier>'");

// What the delta adds to the certified foundation catalog: these CATALOG_SQL paths move from the foundation pin to the
// gateway-auth delta pin; every other strict path must still equal the foundation pin.
export const DELTA_PATHS = Object.freeze(['roles', 'role_members', 'login_roles_torneos', 'authenticator_pre_request']);
export const FOUNDATION_INVARIANTS_SUPERSEDED = Object.freeze(['torneos_login_role_present']);
// Role shape the catalog cannot express (membership options, attributes, payments reachability). Read-only.
export const GATEWAY_ROLES_SQL = `select json_build_object(
 'logins', (select coalesce(json_agg(json_build_object('name', rolname, 'login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper, 'createrole', rolcreaterole, 'createdb', rolcreatedb, 'replication', rolreplication, 'bypassrls', rolbypassrls, 'connlimit', rolconnlimit, 'valid_until', rolvaliduntil, 'config', rolconfig) order by rolname), '[]'::json) from pg_roles where rolname like 'torneos%' and rolcanlogin),
 'memberships', (select coalesce(json_agg(json_build_object('role', pg_get_userbyid(m.roleid), 'member', pg_get_userbyid(m.member), 'admin', m.admin_option, 'inherit', m.inherit_option, 'set', m.set_option) order by pg_get_userbyid(m.roleid), pg_get_userbyid(m.member)), '[]'::json) from pg_auth_members m where pg_get_userbyid(m.member) like 'torneos_edge%' or pg_get_userbyid(m.roleid) like 'torneos_edge%'),
 'payment_logins', (select count(*) from pg_roles r where r.rolcanlogin and not r.rolsuper and (pg_has_role(r.oid, 'torneos_payment_service', 'SET') or pg_has_role(r.oid, 'torneos_payment_service', 'USAGE'))),
 'login_member_of_api_role', (select count(*) from pg_roles r where r.rolname like 'torneos_edge%' and exists (select 1 from pg_roles a where a.rolname in ('postgres','service_role','authenticated','anon','authenticator','supabase_admin','torneos_payment_service') and (pg_has_role(r.oid, a.oid, 'SET') or pg_has_role(r.oid, a.oid, 'USAGE')))),
 'authenticator_config', (select coalesce(json_agg(c order by c), '[]'::json) from pg_roles, unnest(coalesce(rolconfig, array[]::text[])) c where rolname = 'authenticator' and c like 'pgrst.%'),
 'auth_users', (select count(*) from auth.users),
 'installer', json_build_object('user', current_user, 'super', (select rolsuper from pg_roles where rolname = current_user), 'createrole', (select rolcreaterole from pg_roles where rolname = current_user),
   'admin_on_authenticator', pg_has_role(current_user, 'authenticator', 'MEMBER WITH ADMIN OPTION'),
   'admin_on_identity_writer', pg_has_role(current_user, 'torneos_identity_writer', 'MEMBER WITH ADMIN OPTION'),
   'admin_on_core_adapter', pg_has_role(current_user, 'torneos_core_adapter', 'MEMBER WITH ADMIN OPTION')),
 'edge_login_can_set_role', (select coalesce(json_object_agg(r.rolname, pg_has_role(r.oid, (select oid from pg_roles where rolname = case r.rolname when 'torneos_edge_identity_writer' then 'torneos_identity_writer' else 'torneos_core_adapter' end), 'SET')), '{}'::json) from pg_roles r where r.rolname in ('torneos_edge_identity_writer','torneos_edge_core_adapter'))
)`;
// GATEWAY_ROLES_SQL.installer describes the SESSION that ran the query. On the hosted Management API a read_only:true
// query runs as supabase_read_only_user, never as postgres, so that block says nothing about W2/W3 (defect found by the
// 2026-09-25 remote preflight). It stays byte-identical because the delta pin records its sha256; W2/W3 decisions use
// INSTALLER_PRIVILEGES_SQL below.

// ─────────────────────────── the W2/W3 installer, measured explicitly ───────────────────────────
// The bootstrap transaction runs as `postgres` (Supavisor user postgres.<torneos>): hosted Supabase, PG 17, a
// NON-superuser with CREATEROLE, governed by supautils. Measured on supabase/postgres 17.6.1.147 (2026-09-25, local lab):
//   CREATE ROLE                            needs CREATEROLE;
//   GRANT torneos_<x> TO <login>           needs ADMIN OPTION on torneos_<x> (PG 16+), without it: permission denied;
//   ALTER ROLE authenticator SET pgrst.*   authenticator is a supautils RESERVED role: allowed to a non-superuser only if
//                                          it is listed with `*` (settings modifiable), the installer is a member of
//                                          supautils.privileged_role and pgrst.* is in privileged_role_allowed_configs —
//                                          each of the three removed alone makes the ALTER fail; ADMIN on authenticator
//                                          is NOT what grants it. Without supautils: CREATEROLE + ADMIN on authenticator.
// Every term names `postgres` literally (pg_has_role(<name>, …) and pg_roles), never current_user/session_user, so the
// answer is the same whoever runs the read (supabase_read_only_user on the hosted API, anyone in the rehearsal).
export const INSTALLER_ROLE = 'postgres';
export const INSTALLER_PRIVILEGES_SQL = `select json_build_object(
 'measured_role', 'postgres',
 'measured_by', current_user,
 'exists', exists (select 1 from pg_roles where rolname = 'postgres'),
 'super', (select rolsuper from pg_roles where rolname = 'postgres'),
 'createrole', (select rolcreaterole from pg_roles where rolname = 'postgres'),
 'admin_on_authenticator', (select pg_has_role('postgres', 'authenticator', 'MEMBER WITH ADMIN OPTION') where exists (select 1 from pg_roles where rolname = 'authenticator')),
 'admin_on_identity_writer', (select pg_has_role('postgres', 'torneos_identity_writer', 'MEMBER WITH ADMIN OPTION') where exists (select 1 from pg_roles where rolname = 'torneos_identity_writer')),
 'admin_on_core_adapter', (select pg_has_role('postgres', 'torneos_core_adapter', 'MEMBER WITH ADMIN OPTION') where exists (select 1 from pg_roles where rolname = 'torneos_core_adapter')),
 'supautils_privileged_role', current_setting('supautils.privileged_role', true),
 'member_of_privileged_role', (select pg_has_role('postgres', r.oid, 'MEMBER') from pg_roles r where r.rolname = current_setting('supautils.privileged_role', true)),
 'supautils_reserved_roles', current_setting('supautils.reserved_roles', true),
 'supautils_allowed_configs', current_setting('supautils.privileged_role_allowed_configs', true)
)`;
for (const sql of [GATEWAY_ROLES_SQL, INSTALLER_PRIVILEGES_SQL]) assertReadOnlySql(sql);

const csv = (s) => (typeof s === 'string' ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
/**
 * What the measured `postgres` can do for EXACTLY the W2/W3 statements. `sufficient` only when every statement is
 * provable from the measurement; an unreadable or missing term counts as "cannot" (fail closed), never as "can".
 */
export function installerCapability(m) {
  if (!m || typeof m !== 'object' || m.measured_role !== INSTALLER_ROLE) return { sufficient: false, missing: ['INSTALLER_MEASUREMENT_UNREADABLE'], can: {} };
  const t = (x) => x === true;
  const supautils = typeof m.supautils_privileged_role === 'string' && m.supautils_privileged_role.length > 0;
  const reserved = csv(m.supautils_reserved_roles);
  const authReserved = reserved.some((r) => r.replace(/\*$/, '') === 'authenticator');
  const authConfigurable = reserved.includes('authenticator*');
  const allowed = csv(m.supautils_allowed_configs);
  const preRequestAllowed = allowed.includes('pgrst.*') || allowed.includes('pgrst.db_pre_request');
  let alter;
  if (t(m.super)) alter = true;
  else if (supautils && authReserved) alter = authConfigurable && t(m.member_of_privileged_role) && preRequestAllowed;
  else if (supautils) alter = t(m.createrole) && t(m.admin_on_authenticator) && preRequestAllowed;
  else alter = t(m.createrole) && t(m.admin_on_authenticator);
  const can = {
    create_role: t(m.exists) && (t(m.super) || t(m.createrole)),
    grant_identity_writer: t(m.exists) && (t(m.super) || t(m.admin_on_identity_writer)),
    grant_core_adapter: t(m.exists) && (t(m.super) || t(m.admin_on_core_adapter)),
    alter_authenticator_pre_request: t(m.exists) && alter,
  };
  const missing = Object.entries(can).filter(([, v]) => !v).map(([k]) => `INSTALLER_CANNOT_${k.toUpperCase()}`);
  return { sufficient: missing.length === 0, missing, can, model: t(m.super) ? 'superuser' : supautils ? (authReserved ? 'supautils_reserved_authenticator' : 'supautils') : 'plain_postgres' };
}

/** W2/W3 state from the catalog + the role shape. 'applied' | 'pending' | 'foreign' (anything else: STOP). */
export function dbState(catalog, roles, foundationPin, deltaPin) {
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
  const eq = (p, pin) => canon(getPath(catalog, p)) === canon(getPath(pin, p));
  if (!catalog || !roles) return { state: 'unreadable' };
  const asFoundation = DELTA_PATHS.every((p) => eq(p, foundationPin.catalog));
  const asDelta = deltaPin && DELTA_PATHS.every((p) => eq(p, deltaPin.catalog)) && canon(roles.logins) === canon(deltaPin.roles.logins) && canon(roles.memberships) === canon(deltaPin.roles.memberships);
  const preRequest = canon(catalog.authenticator_pre_request) === canon(PRE_REQUEST_ROLECONFIG) ? 'applied' : (Array.isArray(catalog.authenticator_pre_request) && catalog.authenticator_pre_request.length === 0 ? 'pending' : 'foreign');
  if (asFoundation && preRequest === 'pending') return { state: 'pending', w2: 'pending', w3: 'pending' };
  if (asDelta && preRequest === 'applied') return { state: 'applied', w2: 'applied', w3: 'applied' };
  return { state: 'foreign', w2: preRequest, w3: asFoundation ? 'pending' : 'foreign', differing: DELTA_PATHS.filter((p) => !eq(p, (deltaPin ?? foundationPin).catalog)) };
}

/** Invariants of the post-gateway/auth database, asserted independently of the pins. */
export function gatewayInvariantFailures(catalog, roles) {
  const f = FC.catalogInvariantFailures(catalog).filter((x) => !FOUNDATION_INVARIANTS_SUPERSEDED.includes(x));
  if (Number(catalog?.login_roles_torneos) !== 2) f.push('torneos_login_roles_not_exactly_2');
  const logins = roles?.logins ?? [];
  const names = logins.map((l) => l.name).sort();
  if (names.join(',') !== EDGE_LOGINS.map((l) => l.login).sort().join(',')) f.push('edge_logins_not_exact');
  for (const l of logins) {
    if (l.inherit !== false) f.push(`login_inherit_${l.name}`);
    if (l.super || l.createrole || l.createdb || l.replication || l.bypassrls) f.push(`login_privileged_${l.name}`);
    if (l.config !== null && !(Array.isArray(l.config) && l.config.length === 0)) f.push(`login_config_${l.name}`);
    if (l.valid_until !== null) f.push(`login_valid_until_${l.name}`);
  }
  for (const { login, memberOf } of EDGE_LOGINS) {
    const own = (roles?.memberships ?? []).filter((m) => m.member === login);
    if (own.length !== 1 || own[0].role !== memberOf || own[0].admin !== false || own[0].set !== true) f.push(`membership_not_exact_${login}`);
  }
  if (Number(roles?.payment_logins) !== 0) f.push('payment_login_present');
  if (Number(roles?.login_member_of_api_role) !== 0) f.push('edge_login_member_of_privileged_role');
  if (JSON.stringify(catalog?.authenticator_pre_request) !== JSON.stringify(PRE_REQUEST_ROLECONFIG)) f.push('pre_request_not_check_token');
  if (JSON.stringify(roles?.authenticator_config) !== JSON.stringify(PRE_REQUEST_ROLECONFIG)) f.push('authenticator_pgrst_config_not_exact');
  if (Number(roles?.auth_users) !== 0) f.push('torneos_auth_has_users');
  return f;
}

// ─────────────────────────── KR + W5 — Production bridge ring, custom_jwks ───────────────────────────
export const KEYCHAIN_BRIDGE_SERVICE = 'arma2-torneos-prod-bridge';
export const KEYCHAIN_GATEWAY_DB_SERVICE = 'arma2-torneos-gateway-db';
export const KEYCHAIN_DATAPLANE_DB = Object.freeze({ service: 'arma2-torneos-dataplane-db', account: 'postgres' });
// Every non-production (and Core) custody namespace: the Production ring and logins never read or write them.
export const FORBIDDEN_KEYCHAIN_SERVICES = Object.freeze([...FC.FORBIDDEN_KEYCHAIN_SERVICES, 'arma2-torneos-dataplane-db-nonprod']);
export const RING_SLOTS = Object.freeze(['k1', 'k2']);
export const KID_PATTERN = /^arma2-torneos-prod-(k1|k2)-[A-Za-z0-9_-]{16}$/;
export const RSA_MODULUS_BITS = 2048;

/** The pinned public JWKS: the PUBLIC halves of k1 (active) and k2 (standby), in that order, nothing else. */
export function customJwksBody(jwksPin) {
  const keys = (jwksPin?.keys ?? []).map((k) => ({ kty: k.kty, n: k.n, e: k.e, kid: k.kid, alg: 'RS256', use: 'sig' }));
  if (keys.length !== 2 || !keys.every((k, i) => k.kty === 'RSA' && KID_PATTERN.test(k.kid) && k.kid.includes(`-${RING_SLOTS[i]}-`))) throw new Error('jwks_pin_shape');
  return { custom_jwks: { keys } };
}
// B03 = jwks_url (owner decision 2026-09-26, option A). The hosted resolver fetches the gateway's public JWKS, which is
// derived from TORNEOS_BRIDGE_KEYS only (token.ts jwks(): trusted kids, public members) — no request input reaches it.
export const GATEWAY_HOST = 'torneos-gateway.nicoavayu.deno.net';
export const B03_JWKS_URL = `https://${GATEWAY_HOST}/functions/v1/torneos-gateway/.well-known/jwks.json`;
// The inline custom_jwks integration of 2026-09-26T00:58Z: accepted by the API, never resolved by the host. The only
// integration this tooling may ever delete, and only while it is exactly that (pinned kids + digest, unresolved).
export const B03_SUPERSEDED_INLINE_ID = 'f0a6c05e-82df-4f4b-a444-198ab78fdf45';
export const PRIVATE_JWK_MEMBERS = Object.freeze(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']);
export const jwksUrlBody = () => ({ jwks_url: B03_JWKS_URL });
/** Probes A/E need the existing shadow identity (bridge-probe.mjs); read-only, two columns. */
export const IDENTITY_PROBE_SQL = 'select id::text as id, core_user_id::text as core_user_id from public.torneos_identity order by created_at, id limit 5';
export function assertThirdPartyAuthBody(body) {
  if (JSON.stringify(body) !== JSON.stringify(jwksUrlBody())) throw new Error('tpa_body_not_the_pinned_jwks_url');
}
const pinDigest = (jwksPin) => sha256(JSON.stringify(customJwksBody(jwksPin).custom_jwks));
/** The superseded inline integration, exactly as published on 2026-09-26 (and still unresolved). */
export function isSupersededInline(row, jwksPin) {
  const kids = jwksPin ? jwksPin.keys.map((k) => k.kid) : null;
  return !!row && !!kids && row.id === B03_SUPERSEDED_INLINE_ID && !row.oidc_issuer_url && !row.jwks_url && JSON.stringify(row.custom_jwks_kids) === JSON.stringify(kids)
    && row.custom_jwks_digest === pinDigest(jwksPin) && !row.custom_jwks_private_material && row.resolved_at === null;
}
/**
 * 'pending' (0 integrations) | 'superseded-inline' (only the unresolved inline one) | 'resolving' (the pinned jwks_url,
 * not resolved yet) | 'applied' (the pinned jwks_url, resolved to exactly the pinned public k1+k2) | 'foreign'.
 */
export function b03State(tpa, jwksPin) {
  if (!Array.isArray(tpa)) return { state: 'unreadable' };
  if (tpa.length === 0) return { state: 'pending' };
  if (tpa.length !== 1 || !jwksPin) return { state: 'foreign', integrations: tpa.length };
  const r = tpa[0];
  if (isSupersededInline(r, jwksPin)) return { state: 'superseded-inline', id: r.id };
  if (r.jwks_url !== B03_JWKS_URL || r.oidc_issuer_url || r.custom_jwks_kids !== null) return { state: 'foreign', reason: 'not_the_pinned_jwks_url' };
  if (r.resolved_private_material) return { state: 'foreign', reason: 'resolved_private_material' };
  if (!r.resolved_at || r.resolved_jwks_kids === null) return { state: 'resolving', id: r.id };
  if (JSON.stringify(r.resolved_jwks_kids) !== JSON.stringify(jwksPin.keys.map((k) => k.kid)) || r.resolved_jwks_digest !== pinDigest(jwksPin)) return { state: 'foreign', reason: 'resolved_jwks_not_the_pin', id: r.id };
  return { state: 'applied', id: r.id, resolved_at: r.resolved_at };
}

// ─────────────────────────── Management API allowlist ───────────────────────────
// `fga`: scoped-PAT permissions from `x-fga-permissions` of the live spec (https://api.supabase.com/api/v1-json, read
// 2026-09-25 by the foundation and the gateway/auth prep; DELETE third-party-auth/{tpa_id} re-read 2026-09-26). PATCH
// config/auth needs BOTH auth_config_write and project_admin_write; POST and DELETE third-party-auth need
// auth_config_write. The only DELETE: the superseded inline B03 integration, by its pinned id.
const T = TORNEOS_REF;
export const ENDPOINTS = Object.freeze([
  { id: 'org', method: 'GET', re: new RegExp(`^/v1/organizations/${ORG_SLUG}$`), kind: 'read', fga: ['organization_admin_read'] },
  { id: 'projects', method: 'GET', re: /^\/v1\/projects$/, kind: 'read', fga: ['projects_read'] },
  { id: 'prod-project', method: 'GET', re: new RegExp(`^/v1/projects/${CORE_PROD_REF}$`), kind: 'read', fga: ['project_admin_read'] },
  { id: 'prod-contract-fn', method: 'GET', re: new RegExp(`^/v1/projects/${CORE_PROD_REF}/functions/${CORE_CONTRACT_SLUG}$`), kind: 'read', fga: ['edge_functions_read'] },
  { id: 'project', method: 'GET', re: new RegExp(`^/v1/projects/(${STAGING_REF}|${OLD_REF}|${T})$`), kind: 'read', fga: ['project_admin_read'] },
  { id: 'health', method: 'GET', re: new RegExp(`^/v1/projects/${T}/health\\?services=auth,db,pooler,rest,db_postgres_user$`), kind: 'read', fga: ['project_admin_read'] },
  { id: 'functions', method: 'GET', re: new RegExp(`^/v1/projects/${T}/functions$`), kind: 'read', fga: ['edge_functions_read'] },
  { id: 'secrets', method: 'GET', re: new RegExp(`^/v1/projects/${T}/secrets$`), kind: 'read', fga: ['edge_functions_secrets_read'] },
  { id: 'auth-config', method: 'GET', re: new RegExp(`^/v1/projects/${T}/config/auth$`), kind: 'read', fga: ['auth_config_read'] },
  { id: 'third-party-auth', method: 'GET', re: new RegExp(`^/v1/projects/${T}/config/auth/third-party-auth$`), kind: 'read', fga: ['auth_config_read'] },
  { id: 'postgrest', method: 'GET', re: new RegExp(`^/v1/projects/${T}/postgrest$`), kind: 'read', fga: ['data_api_config_read'] },
  { id: 'api-keys', method: 'GET', re: new RegExp(`^/v1/projects/${T}/api-keys\\?reveal=false$`), kind: 'read', fga: ['api_gateway_keys_read'] },
  { id: 'db-migrations', method: 'GET', re: new RegExp(`^/v1/projects/${T}/database/migrations$`), kind: 'read', fga: ['database_migrations_read'] },
  { id: 'pooler', method: 'GET', re: new RegExp(`^/v1/projects/${T}/config/database/pooler$`), kind: 'read', fga: ['database_pooling_config_read'] },
  { id: 'query', method: 'POST', re: new RegExp(`^/v1/projects/${T}/database/query$`), kind: 'read-sql', fga: ['database_read'] },
  { id: 'auth-lockdown', method: 'PATCH', re: new RegExp(`^/v1/projects/${T}/config/auth$`), kind: 'write:auth-lockdown', fga: ['auth_config_write', 'project_admin_write'] },
  { id: 'tpa-create', method: 'POST', re: new RegExp(`^/v1/projects/${T}/config/auth/third-party-auth$`), kind: 'write:b03', fga: ['auth_config_write'] },
  { id: 'tpa-delete', method: 'DELETE', re: new RegExp(`^/v1/projects/${T}/config/auth/third-party-auth/${B03_SUPERSEDED_INLINE_ID}$`), kind: 'write:b03-delete', fga: ['auth_config_write'] },
]);
export const FGA_LABELS = Object.freeze({
  organization_admin_read: 'Organization Settings: Read', projects_read: 'Projects (account-wide): Read', project_admin_read: 'Project Settings: Read',
  project_admin_write: 'Project Settings: Read-write', edge_functions_read: 'Edge Functions: Read', edge_functions_secrets_read: 'Edge Function Secrets: Read',
  auth_config_read: 'Auth Config: Read', auth_config_write: 'Auth Config: Read-write', data_api_config_read: 'Data API Config: Read',
  api_gateway_keys_read: 'API Keys: Read', database_migrations_read: 'Migrations: Read', database_pooling_config_read: 'Connection Pooling: Read', database_read: 'Database: Read',
});
const CORE_READS = ['org', 'projects', 'prod-project', 'prod-contract-fn', 'project'];
const TORNEOS_READS = ['health', 'functions', 'secrets', 'auth-config', 'third-party-auth', 'postgrest', 'api-keys', 'db-migrations', 'query'];
export const MODE_ENDPOINTS = Object.freeze({
  '--preflight': Object.freeze([...CORE_READS, ...TORNEOS_READS, 'pooler']),
  '--auth-lockdown': Object.freeze([...CORE_READS, 'functions', 'auth-config', 'third-party-auth', 'query', 'api-keys', 'auth-lockdown']),
  '--db-bootstrap': Object.freeze([...CORE_READS, 'functions', 'auth-config', 'third-party-auth', 'query', 'pooler']),
  '--db-certify': Object.freeze([...CORE_READS, ...TORNEOS_READS, 'pooler']),
  // --db-phase = --preflight → --db-bootstrap → --db-certify in one process (one PAT, one phrase); every step keeps its
  // own endpoint list (the client of each step is built for that step's mode). The PAT: the union, i.e. --preflight's.
  '--db-phase': Object.freeze([...CORE_READS, ...TORNEOS_READS, 'pooler']),
  '--keyring-generate': Object.freeze([...CORE_READS, 'functions', 'auth-config', 'third-party-auth', 'query']),
  '--b03': Object.freeze([...CORE_READS, 'functions', 'auth-config', 'third-party-auth', 'query', 'api-keys', 'tpa-delete', 'tpa-create']),
  '--deploy-preflight': Object.freeze([...CORE_READS, ...TORNEOS_READS, 'pooler']),
  '--certify': Object.freeze([...CORE_READS, ...TORNEOS_READS]),
});
export const MODE_WRITES = Object.freeze({
  '--preflight': null, '--auth-lockdown': 'auth-lockdown', '--db-bootstrap': 'psql', '--db-certify': null, '--db-phase': 'psql', '--keyring-generate': 'keychain', '--b03': Object.freeze(['b03-delete', 'b03']), '--deploy-preflight': null, '--certify': null,
});
export const PAT_RESOURCE_ACCESS = Object.freeze({ type: 'Organization', organization_slug: ORG_SLUG });
export function patRequirement(mode) {
  const ids = MODE_ENDPOINTS[mode];
  if (!ids) throw new Error(`mode_unknown ${mode}`);
  const hits = ids.map((id) => ENDPOINTS.find((e) => e.id === id));
  const fga = [...new Set(hits.flatMap((e) => e.fga))].sort();
  const labels = fga.map((f) => FGA_LABELS[f]);
  const permissions = labels.filter((l) => !(l.endsWith(': Read') && labels.includes(`${l}-write`))).sort();
  return { mode, resource_access: PAT_RESOURCE_ACCESS, fga, permissions, api_writes: hits.filter((e) => e.kind.startsWith('write:')).map((e) => e.id), other_writes: MODE_WRITES[mode] && !hits.some((e) => e.kind.startsWith('write:')) ? MODE_WRITES[mode] : null };
}
/** The writes a mode may arm (one at a time). */
export const modeWrites = (mode) => [MODE_WRITES[mode]].flat().filter(Boolean);
export function patRequirementText(mode) {
  const r = patRequirement(mode);
  return [`Scoped token (Account → Access Tokens), resource access: Organization ${ORG_SLUG}, expiry 24 hours.`, ...r.permissions.map((p) => `  ${p}`), '  everything else: None'].join('\n');
}

/**
 * Classifies one Management API request. Throws on: an unknown path, another method, a ref outside the pins, Core
 * Production outside its two GETs, a write outside its mode or without the arming for exactly that write, a body that is
 * not exactly the pinned one.
 */
export function classifyRequest({ method, path: reqPath, body }, { mode, armedFor = null, jwksPin = null } = {}) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new Error(`method_refused_${method}`);
  if (typeof reqPath !== 'string') throw new Error('path_invalid');
  const hit = ENDPOINTS.find((e) => e.method === method && e.re.test(reqPath));
  if (!hit) throw new Error(`endpoint_not_allowlisted ${method} ${reqPath}`);
  if (!MODE_ENDPOINTS[mode]?.includes(hit.id)) throw new Error(`endpoint_not_in_mode ${mode} ${hit.id}`);
  if (reqPath.includes(CORE_PROD_REF) && !['prod-project', 'prod-contract-fn'].includes(hit.id)) throw new Error('core_production_only_two_gets');
  const payload = body === undefined ? '' : JSON.stringify(body);
  for (const ref of [CORE_PROD_REF, STAGING_REF, OLD_REF]) if (payload.includes(ref)) throw new Error('foreign_ref_in_body');
  if (hit.kind === 'read' && body !== undefined) throw new Error('get_with_body');
  if (hit.kind === 'read-sql') {
    if (!body || body.read_only !== true || Object.keys(body).sort().join(',') !== 'query,read_only') throw new Error('sql_must_be_read_only');
    assertReadOnlySql(body.query);
  }
  if (hit.kind === 'write:auth-lockdown') { if (armedFor !== 'auth-lockdown') throw new Error('auth_lockdown_not_armed'); assertAuthLockdownBody(body); }
  if (hit.kind === 'write:b03') { if (armedFor !== 'b03' || !jwksPin) throw new Error('b03_not_armed'); assertThirdPartyAuthBody(body); }
  if (hit.kind === 'write:b03-delete') { if (armedFor !== 'b03-delete' || !jwksPin) throw new Error('b03_delete_not_armed'); if (body !== undefined) throw new Error('delete_with_body'); }
  const m = /\/v1\/projects\/([a-z]{20})/.exec(reqPath);
  return { id: hit.id, kind: hit.kind, ref: m ? m[1] : null, fga: hit.fga };
}

// ─────────────────────────── secrets in text ───────────────────────────
export const SECRET_SHAPES = [...FC.SECRET_SHAPES, /SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]{20,}\$/, /"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/, /sb_publishable_[A-Za-z0-9_-]{10,}/];
export function secretFindings(text, known = []) {
  const out = [];
  for (const k of known) if (typeof k === 'string' && k.length >= 8 && text.includes(k)) out.push('known_secret_value');
  for (const re of SECRET_SHAPES) if (re.test(text)) out.push(`shape:${re.source.slice(0, 24)}`);
  return out;
}

// ─────────────────────────── gateway deployment decisions (pending, human) ───────────────────────────
// --deploy-preflight refuses while any of these is null. They are decisions, not discoveries.
export const GATEWAY_DEPLOY_DECISIONS = Object.freeze({
  publicUrl: null,         // the external gateway URL (Deno Deploy app host + /functions/v1/torneos-gateway)
  denoDeployOrg: null,     // the Deno Deploy organization that will own the app (app-level variables only)
});
