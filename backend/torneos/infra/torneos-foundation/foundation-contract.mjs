// INFRA-1 R3 — Staging retirement + Arma2 Torneos Supabase foundation: every pin the runner obeys.
//
// Nothing here is an argument. The refs, the organization, the project name, the region, the four
// migration hashes, the Keychain namespace and the endpoint allowlist are constants of this file;
// the runner (foundation.mjs) and the wrapper (run-foundation.sh) take a MODE and a PAT, nothing else.
//
//   Core Production  rcyuuoaqfwcembdajcss  READ ONLY: GET project + GET torneos-core-contract. Never a write.
//   Core Staging     hhyvmhgpapyuzjgxfnqv  read-only probes; the ONE write is POST …/pause (no delete, no restore)
//   Old project      giaeztyghmhzcngskjmw  GET project only (must stay INACTIVE)
//   Arma2 Torneos    <created>             POST /v1/projects once; then GETs + read-only SQL; migrations by psql
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../..');

export const API_HOST = 'api.supabase.com';
export const PROD_REF = 'rcyuuoaqfwcembdajcss';
export const STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
export const OLD_REF = 'giaeztyghmhzcngskjmw';
export const ORG_SLUG = 'gwqrborhnqjdzzmpxulh';
export const PROJECT_NAME = 'Arma2 Torneos';
export const REGION = 'sa-east-1';
export const KNOWN_REFS = Object.freeze([PROD_REF, STAGING_REF, OLD_REF]);
export const REF_PATTERN = /^[a-z]{20}$/;
export const PAT_PATTERN = /^sbp_[A-Za-z0-9_]{20,160}$/;

// Core Production certification (INFRA-1 harness-only, 2026-09-24T22:26:36Z) — read-only reference.
export const CORE_CONTRACT_SLUG = 'torneos-core-contract';
export const CORE_CONTRACT_EZBR = '1072419517953eee8e8021f9691d1a5b1efb1f871c4d13290f644d119caded2c';
export const CORE_PROD_CERTIFICATION = Object.freeze({
  verdict: 'CORE_PROD_TORNEOS_CONTRACT_PASS',
  worktree: 'arma2-core-prod-contract-enablement @ beea9590',
  evidence: {
    'core-prod-harness-only-result-20260924T222636Z.json': 'b995a8f8129903b54a8e6b8d4fd13ae434b5682e888845beabccd71d22faeb04',
    'core-prod-harness-only-pre-acl-20260924T222636Z.json': 'c0703a17f540beb1cca3af80eada31d8e810c8129e176093b3599a14083e0099',
    'core-prod-harness-only-post-acl-20260924T222636Z.json': 'da12a26245cef4fe74fb75c26adf6c282fdd36917da5f74f85e4e149f850549b',
  },
});

// Custody of the new project's database password. Exclusive namespace: no Core, no Staging, no nonprod.
export const KEYCHAIN_DB = Object.freeze({ service: 'arma2-torneos-dataplane-db', account: 'postgres' });
export const FORBIDDEN_KEYCHAIN_SERVICES = Object.freeze([
  'arma2-torneos-prod-core-contract', 'arma2-torneos-nonprod-core', 'arma2-torneos-nonprod-db', 'arma2-torneos-nonprod-bridge',
  'arma2-torneos-staging', 'arma2-torneos-staging-cert-db', 'arma2-torneos-staging-final-db', 'arma2-torneos-staging-db-readonly',
]);
export const DB_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{40}$/;

export const MIGRATIONS_DIR = 'backend/torneos/supabase/migrations';
export const MIGRATIONS = Object.freeze([
  { seq: '0000', file: '00000000000000_torneos_baseline_v1.sql', sha256: 'f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f' },
  { seq: '0001', file: '00000000000001_staging_v1_rpc_exposure.sql', sha256: '3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62' },
  { seq: '0002', file: '00000000000002_mercadopago_checkout_pro_test.sql', sha256: '06378f12b57620e8ae550a0d881ad66464ffdc0a734ad621cba8a6ba3e6d6078' },
  { seq: '0003', file: '00000000000003_mercadopago_provider_ordering.sql', sha256: 'd54b3293da53aea1202d3daed9a70e45d86e306a56a1fdd58107fc5719e36714' },
]);

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Reads and hash-checks the four files. Any drift (or an extra/missing file in the list) → throws. */
export function loadMigrations(repoRoot = REPO_ROOT) {
  return MIGRATIONS.map((m) => {
    const abs = path.join(repoRoot, MIGRATIONS_DIR, m.file);
    const bytes = fs.readFileSync(abs);
    const actual = sha256(bytes);
    if (actual !== m.sha256) throw new Error(`MIGRATION_HASH_MISMATCH ${m.file} ${actual}`);
    return { ...m, abs, bytes: bytes.length, actual };
  });
}

// ─────────────────────────── endpoint allowlist ───────────────────────────
// Each entry: method, a path regex, and the class of the request. `write:*` classes are only sent by
// an ARMED client in the mode that owns them. Production appears in exactly two GET paths.
const REF = '([a-z]{20})';
export const ENDPOINTS = Object.freeze([
  { id: 'orgs', method: 'GET', re: /^\/v1\/organizations$/, kind: 'read' },
  { id: 'org', method: 'GET', re: new RegExp(`^/v1/organizations/${ORG_SLUG}$`), kind: 'read' },
  { id: 'projects', method: 'GET', re: /^\/v1\/projects$/, kind: 'read' },
  { id: 'regions', method: 'GET', re: new RegExp(`^/v1/projects/available-regions\\?organization_slug=${ORG_SLUG}&continent=SA$`), kind: 'read' },
  { id: 'prod-project', method: 'GET', re: new RegExp(`^/v1/projects/${PROD_REF}$`), kind: 'read' },
  { id: 'prod-contract-fn', method: 'GET', re: new RegExp(`^/v1/projects/${PROD_REF}/functions/${CORE_CONTRACT_SLUG}$`), kind: 'read' },
  { id: 'project', method: 'GET', re: new RegExp(`^/v1/projects/${REF}$`), kind: 'read' },
  { id: 'functions', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/functions$`), kind: 'read' },
  { id: 'branches', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/branches$`), kind: 'read' },
  { id: 'health', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/health\\?services=auth,db,pooler,rest,db_postgres_user$`), kind: 'read' },
  { id: 'pooler', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/config/database/pooler$`), kind: 'read' },
  { id: 'third-party-auth', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/config/auth/third-party-auth$`), kind: 'read' },
  { id: 'auth-config', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/config/auth$`), kind: 'read' },
  { id: 'postgrest', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/postgrest$`), kind: 'read' },
  { id: 'api-keys', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/api-keys\\?reveal=false$`), kind: 'read' },
  { id: 'secrets', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/secrets$`), kind: 'read' },
  { id: 'db-migrations', method: 'GET', re: new RegExp(`^/v1/projects/${REF}/database/migrations$`), kind: 'read' },
  { id: 'query', method: 'POST', re: new RegExp(`^/v1/projects/${REF}/database/query$`), kind: 'read-sql' },
  { id: 'pause', method: 'POST', re: new RegExp(`^/v1/projects/${STAGING_REF}/pause$`), kind: 'write:pause' },
  { id: 'create', method: 'POST', re: /^\/v1\/projects$/, kind: 'write:create' },
]);

// Read-only SQL guard (same contract as the certified phase3b/mgmt.mjs guard, own copy: this file must
// not import non-production tooling that hard-refuses Production).
export const WRITE_VERBS = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|reindex|cluster|refresh|call|do|merge|lock|comment|security|set\s+role|reset|notify|listen|unlisten|prepare|execute|deallocate|discard|begin|commit|rollback|savepoint)\b/i;
// Functions with an effect outside the statement, callable from a SELECT (a read-only transaction refuses most of
// them server-side; this is the client-side half of the same rule).
export const SIDE_EFFECT_FUNCTIONS = /\b(pg_notify|pg_terminate_backend|pg_cancel_backend|set_config|nextval|setval|pg_reload_conf|pg_rotate_logfile|pg_sleep\w*|pg_advisory\w*|lo_\w+|dblink\w*|pg_read_\w*file|pg_ls_\w+|pg_stat_reset\w*|pg_switch_wal|pg_create_\w+|pg_drop_\w+|http\w*|net\.\w+)\s*\(/i;
export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('sql_empty');
  if (sql.includes(';')) throw new Error('sql_multi_statement');
  if (WRITE_VERBS.test(sql.replace(/'[^']*'/g, "''"))) throw new Error('sql_write_verb');
  if (SIDE_EFFECT_FUNCTIONS.test(sql.replace(/'[^']*'/g, "''"))) throw new Error('sql_side_effect_function');
  if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('sql_not_a_select');
  return sql;
}

/**
 * Classifies one Management API request against the allowlist. Returns { id, kind, ref }.
 * Throws on anything else: unknown path, another method, Production outside its two GETs, a write
 * without the arming for exactly that write, a POST body that is not what the class allows.
 */
export function classifyRequest({ method, path: reqPath, body }, { armedFor = null, createdRef = null } = {}) {
  if (method !== 'GET' && method !== 'POST') throw new Error(`method_refused_${method}`);
  if (typeof reqPath !== 'string') throw new Error('path_invalid');
  const hit = ENDPOINTS.find((e) => e.method === method && e.re.test(reqPath));
  if (!hit) throw new Error(`endpoint_not_allowlisted ${method} ${reqPath}`);
  const m = hit.re.exec(reqPath);
  const ref = m && m[1] && REF_PATTERN.test(m[1]) ? m[1] : null;
  const isProdPath = reqPath.includes(PROD_REF);
  if (isProdPath && hit.id !== 'prod-project' && hit.id !== 'prod-contract-fn') throw new Error('production_only_two_gets');
  if (ref && ![STAGING_REF, OLD_REF].includes(ref) && ref !== createdRef && hit.id !== 'prod-project' && hit.id !== 'prod-contract-fn') {
    throw new Error(`ref_not_in_scope ${ref}`);
  }
  if (ref === OLD_REF && hit.id !== 'project') throw new Error('old_project_get_only');
  const payload = body === undefined ? '' : JSON.stringify(body);
  if (payload.includes(PROD_REF)) throw new Error('production_ref_in_body');
  if (hit.kind === 'read' && body !== undefined) throw new Error('get_with_body');
  if (hit.kind === 'read-sql') {
    if (!body || body.read_only !== true || Object.keys(body).sort().join(',') !== 'query,read_only') throw new Error('sql_must_be_read_only');
    assertReadOnlySql(body.query);
  }
  if (hit.kind === 'write:pause') {
    if (armedFor !== 'pause') throw new Error('pause_not_armed');
    if (body !== undefined) throw new Error('pause_takes_no_body');
  }
  if (hit.kind === 'write:create') {
    if (armedFor !== 'create') throw new Error('create_not_armed');
    assertCreateBody(body);
  }
  return { id: hit.id, kind: hit.kind, ref };
}

export function createProjectBody(dbPass) {
  return { organization_slug: ORG_SLUG, name: PROJECT_NAME, region_selection: { type: 'specific', code: REGION }, db_pass: dbPass };
}
/** Exactly the four keys, exactly the pinned values; no plan, no instance size, no template, no add-on. */
export function assertCreateBody(body) {
  if (!body || typeof body !== 'object') throw new Error('create_body_missing');
  if (Object.keys(body).sort().join(',') !== 'db_pass,name,organization_slug,region_selection') throw new Error('create_body_keys');
  if (body.organization_slug !== ORG_SLUG || body.name !== PROJECT_NAME) throw new Error('create_body_identity');
  const rs = body.region_selection;
  if (!rs || Object.keys(rs).sort().join(',') !== 'code,type' || rs.type !== 'specific' || rs.code !== REGION) throw new Error('create_body_region');
  if (typeof body.db_pass !== 'string' || !DB_PASSWORD_PATTERN.test(body.db_pass)) throw new Error('create_body_db_pass');
}

// ─────────────────────────── secrets in text ───────────────────────────
export const SECRET_SHAPES = [
  /sbp_[A-Za-z0-9_]{20,}/, /sb_secret_[A-Za-z0-9_-]{10,}/, /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/,
  /postgres(?:ql)?:\/\/[^\s"'@/]+:[^\s"'@]+@/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /APP_USR-[0-9A-Za-z-]{20,}/,
];
export function secretFindings(text, known = []) {
  const out = [];
  for (const k of known) if (typeof k === 'string' && k.length >= 8 && text.includes(k)) out.push('known_secret_value');
  for (const re of SECRET_SHAPES) if (re.test(text)) out.push(`shape:${re.source.slice(0, 24)}`);
  return out;
}

// ─────────────────────────── read-only SQL ───────────────────────────
// Staging pre-pause: what would stop working when Staging stops. Cron commands are reduced to the hosts
// they reach and a digest (a command may embed a key); no value leaves the database.
export const STAGING_PREPAUSE_SQL = `select json_build_object(
 'now', now(),
 'cron_available', to_regclass('cron.job') is not null,
 'auth_activity', json_build_object(
   'last_sign_in_at', (select max(last_sign_in_at) from auth.users),
   'sessions_total', (select count(*) from auth.sessions),
   'sessions_touched_60m', (select count(*) from auth.sessions where coalesce(refreshed_at, updated_at, created_at) > now() - interval '60 minutes'),
   'sessions_touched_24h', (select count(*) from auth.sessions where coalesce(refreshed_at, updated_at, created_at) > now() - interval '24 hours'),
   'sign_ins_60m', (select count(*) from auth.users where last_sign_in_at > now() - interval '60 minutes'),
   'sign_ins_24h', (select count(*) from auth.users where last_sign_in_at > now() - interval '24 hours')),
 'client_connections', (select coalesce(json_agg(json_build_object('usename', usename, 'application_name', left(application_name, 60), 'state', state, 'backend_type', backend_type, 'since', backend_start) order by backend_start), '[]'::json)
   from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid()
   and coalesce(usename, '') not in ('supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin', 'authenticator', 'supabase_realtime_admin', 'supabase_replication_admin', 'pgbouncer', 'supabase_read_only_user', 'supabase_etl_admin'))
)`;
export const STAGING_CRON_SQL = `select coalesce(json_agg(json_build_object('jobid', j.jobid, 'jobname', j.jobname, 'schedule', j.schedule, 'active', j.active,
   'hosts', (select coalesce(json_agg(distinct h[1]), '[]'::json) from regexp_matches(j.command, 'https?://([A-Za-z0-9.-]+)', 'g') as h),
   'command_md5', md5(j.command),
   'runs_24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '24 hours'),
   'failed_24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '24 hours' and d.status <> 'succeeded'),
   'last_run', (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid)) order by j.jobid), '[]'::json) as jobs from cron.job j`;

// Torneos project, before the first migration: the database must be a fresh Supabase database.
export const TORNEOS_EMPTY_SQL = `select json_build_object(
 'server_version', current_setting('server_version'),
 'api_role', current_user,
 'public_relations', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m','S','p','f')),
 'public_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
 'private_schema', (select count(*) from pg_namespace where nspname = 'private'),
 'torneos_roles', (select count(*) from pg_roles where rolname like 'torneos%'),
 'pgcrypto_available', (select count(*) from pg_available_extensions where name = 'pgcrypto'),
 'migrations_ledger', to_regclass('supabase_migrations.schema_migrations') is not null
)`;

// Torneos project, after 0003: the certification fingerprint. The expected values are pinned in
// pins/expected-catalog.json, derived from the offline rehearsal (same image family, installer postgres).
// PostgREST probe targets that anon must NOT reach (asserted in the catalog too), and RPCs anon must not run.
export const PROBE_DENIED_TABLES = Object.freeze(['torneos_identity', 'tournament_payment_provider_watermarks', 'tournament_purchases', 'tournament_purchase_events']);
export const PROBE_DENIED_RPCS = Object.freeze(['get_my_tournament_memberships', 'create_tournament_season_checkout_purchase', 'apply_verified_tournament_payment_status', 'record_tournament_purchase_preference']);
export const PROBE_ANON_READ_TABLE = 'tournament_competition_formats';
export const API_ROLES = Object.freeze(['anon', 'authenticated', 'service_role', 'torneos_payment_service', 'torneos_identity_writer', 'torneos_core_adapter']);
export const PAYMENT_SERVICE_EXECUTE = Object.freeze([
  'apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamp with time zone)',
  'apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamp with time zone)',
  'get_provider_tournament_purchase(text,text,text)',
  'record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)',
]);
const ROLE_VALUES = API_ROLES.map((r) => `('${r}')`).join(',');
export const CATALOG_SQL = `with
 roles(r) as (values ${ROLE_VALUES}),
 fns as (select p.oid, n.nspname, p.oid::regprocedure::text as sig, p.prokind, p.prosecdef, p.proacl, pg_get_userbyid(p.proowner) as owner, md5(p.prosrc) as body
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')),
 rels as (select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl, pg_get_userbyid(c.relowner) as owner
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S','f')),
 tabs as (select * from rels where relkind in ('r','p','v','m','f')),
 privs(p) as (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'))
select json_build_object(
 'server_version', current_setting('server_version'),
 'schemas', (select json_agg(json_build_object('name', nspname, 'owner', pg_get_userbyid(nspowner), 'acl', nspacl::text) order by nspname) from pg_namespace where nspname in ('public','private','extensions')),
 'roles', (select json_agg(json_build_object('name', rolname, 'login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper, 'bypassrls', rolbypassrls, 'createrole', rolcreaterole, 'createdb', rolcreatedb) order by rolname) from pg_roles where rolname like 'torneos%'),
 'role_members', (select coalesce(json_agg(json_build_object('role', pg_get_userbyid(m.roleid), 'member', pg_get_userbyid(m.member)) order by pg_get_userbyid(m.roleid), pg_get_userbyid(m.member)), '[]'::json) from pg_auth_members m where pg_get_userbyid(m.roleid) like 'torneos%' or pg_get_userbyid(m.member) like 'torneos%'),
 'login_roles_torneos', (select count(*) from pg_roles where rolname like 'torneos%' and rolcanlogin),
 'tables', json_build_object(
   'public_tables', (select count(*) from tabs where nspname = 'public' and relkind in ('r','p')),
   'public_views', (select count(*) from tabs where nspname = 'public' and relkind in ('v','m')),
   'private_tables', (select count(*) from tabs where nspname = 'private' and relkind in ('r','p')),
   'sequences', (select count(*) from rels where relkind = 'S'),
   'public_tables_without_rls', (select coalesce(json_agg(relname order by relname), '[]'::json) from tabs where nspname = 'public' and relkind in ('r','p') and not relrowsecurity),
   'public_tables_forced_rls', (select count(*) from tabs where nspname = 'public' and relkind in ('r','p') and relforcerowsecurity),
   'names_md5', (select md5(string_agg(nspname || '.' || relname || ':' || relkind::text, ',' order by nspname, relname)) from rels),
   'owners', (select json_object_agg(owner, n) from (select owner, count(*) as n from rels group by owner) o)),
 'policies', json_build_object(
   'count', (select count(*) from pg_policies where schemaname in ('public','private')),
   'md5', (select md5(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by schemaname, tablename, policyname)) from pg_policies where schemaname in ('public','private'))),
 'functions', json_build_object(
   'public', (select count(*) from fns where nspname = 'public' and prokind in ('f','w')),
   'private', (select count(*) from fns where nspname = 'private' and prokind in ('f','w')),
   'procedures', (select count(*) from fns where prokind = 'p'),
   'aggregates', (select count(*) from fns where prokind = 'a'),
   'definer', (select count(*) from fns where prosecdef),
   'signatures_md5', (select md5(string_agg(sig, ',' order by sig)) from fns),
   'bodies_md5', (select md5(string_agg(sig || '=' || body, ',' order by sig)) from fns),
   'owners', (select json_object_agg(owner, n) from (select owner, count(*) as n from fns group by owner) o),
   'public_acl_default', (select count(*) from fns where proacl is null),
   'public_execute_by_public_role', (select count(*) from fns f where exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', (select proowner from pg_proc where oid = f.oid)))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
 'execute', (select json_object_agg(r, x) from (select r, json_build_object('count', count(*) filter (where has_function_privilege(r, fns.oid, 'EXECUTE')), 'md5', md5(coalesce(string_agg(fns.sig, ',' order by fns.sig) filter (where has_function_privilege(r, fns.oid, 'EXECUTE')), ''))) as x from roles cross join fns group by r) e),
 'execute_payment_service', (select coalesce(json_agg(regexp_replace(sig, '^public\\.', '') order by sig), '[]'::json) from fns where has_function_privilege('torneos_payment_service', oid, 'EXECUTE')),
 'execute_anon', (select coalesce(json_agg(sig order by sig), '[]'::json) from fns where has_function_privilege('anon', oid, 'EXECUTE')),
 'table_privileges', (select json_object_agg(r, x) from (select r, json_build_object('count', count(*) filter (where has_table_privilege(r, tabs.oid, privs.p)), 'md5', md5(coalesce(string_agg(tabs.nspname || '.' || tabs.relname || ':' || privs.p, ',' order by tabs.nspname, tabs.relname, privs.p) filter (where has_table_privilege(r, tabs.oid, privs.p)), ''))) as x from roles cross join tabs cross join privs group by r) t),
 'anon_table_privileges', (select coalesce(json_agg(tabs.relname || ':' || privs.p order by tabs.relname, privs.p), '[]'::json) from tabs cross join privs where has_table_privilege('anon', tabs.oid, privs.p)),
 'acl_md5', json_build_object(
   'relations', (select md5(string_agg(nspname || '.' || relname || '=' || coalesce(relacl::text, '-'), ',' order by nspname, relname)) from rels),
   'functions', (select md5(string_agg(sig || '=' || coalesce(proacl::text, '-'), ',' order by sig)) from fns)),
 'watermark', json_build_object(
   'exists', to_regclass('public.tournament_payment_provider_watermarks') is not null,
   'rls', (select relrowsecurity from pg_class where oid = to_regclass('public.tournament_payment_provider_watermarks')),
   'api_privileges', (select count(*) from roles cross join privs where to_regclass('public.tournament_payment_provider_watermarks') is not null and has_table_privilege(r, 'public.tournament_payment_provider_watermarks', p)),
   'requires_manual_review', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tournament_payment_provider_watermarks' and column_name = 'requires_manual_review' and data_type = 'boolean' and is_nullable = 'NO'),
   'date_last_updated', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tournament_payment_provider_watermarks' and column_name = 'date_last_updated' and data_type = 'timestamp with time zone')),
 'provider_ordering', json_build_object(
   'order_verified', to_regprocedure('public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamptz)') is not null,
   'apply_status_ordered', to_regprocedure('public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamptz)') is not null,
   'apply_reversal_ordered', to_regprocedure('public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamptz)') is not null,
   'apply_status_unordered_absent', to_regprocedure('public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)') is null,
   'apply_reversal_unordered_absent', to_regprocedure('public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)') is null,
   'unordered_wrapped', to_regprocedure('public.unordered_tournament_payment_status(uuid,text,text,text,text,text,text)') is not null and to_regprocedure('public.unordered_tournament_payment_reversal(uuid,text,text,text,text,text,text)') is not null),
 'audit', json_build_object(
   'purchase_events_append_only', (select count(*) from pg_trigger where tgrelid = to_regclass('public.tournament_purchase_events') and tgname = 'tournament_purchase_events_append_only' and tgenabled = 'O'),
   'grant_events_append_only', (select count(*) from pg_trigger where tgrelid = to_regclass('public.tournament_season_plan_grant_events') and tgname = 'tournament_season_plan_grant_events_append_only' and tgenabled = 'O')),
 'identity', json_build_object(
   'current_identity_id', to_regprocedure('private.current_identity_id()') is not null,
   'check_token', to_regprocedure('private.check_token()') is not null,
   'bridge_issuer_pinned', (select count(*) from pg_proc where oid = to_regprocedure('private.current_identity_id()') and prosrc like '%urn:arma2:local:identity-bridge%' and prosrc like '%arma2-torneos-local%')),
 'authenticator_pre_request', (select coalesce(json_agg(c order by c), '[]'::json) from pg_roles, unnest(coalesce(rolconfig, array[]::text[])) c where rolname = 'authenticator' and c like 'pgrst.db_pre_request%'),
 'extensions', (select json_agg(json_build_object('name', e.extname, 'schema', n.nspname) order by e.extname) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('pgcrypto','pg_cron','pg_net','http','dblink','postgres_fdw')),
 'foreign_servers', (select count(*) from pg_foreign_server),
 'user_mappings', (select count(*) from pg_user_mappings),
 'migrations_ledger', to_regclass('supabase_migrations.schema_migrations') is not null
)`;
for (const sql of [STAGING_PREPAUSE_SQL, STAGING_CRON_SQL, TORNEOS_EMPTY_SQL, CATALOG_SQL]) assertReadOnlySql(sql);

/** Fields of the catalog that must equal the rehearsal pin exactly (environment-independent). */
export const STRICT_CATALOG_PATHS = Object.freeze([
  'roles', 'role_members', 'login_roles_torneos',
  'tables.public_tables', 'tables.public_views', 'tables.private_tables', 'tables.sequences', 'tables.public_tables_without_rls',
  'tables.public_tables_forced_rls', 'tables.names_md5',
  'policies.count', 'policies.md5',
  'functions.public', 'functions.private', 'functions.procedures', 'functions.aggregates', 'functions.definer',
  'functions.signatures_md5', 'functions.bodies_md5', 'functions.public_acl_default', 'functions.public_execute_by_public_role',
  'execute', 'execute_payment_service', 'execute_anon', 'table_privileges', 'anon_table_privileges',
  'watermark', 'provider_ordering', 'audit', 'identity', 'authenticator_pre_request', 'foreign_servers', 'user_mappings',
]);
export const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
export function catalogDiff(actual, expected) {
  const diffs = [];
  for (const p of STRICT_CATALOG_PATHS) {
    const a = getPath(actual, p); const e = getPath(expected, p);
    if (e === undefined) diffs.push({ path: p, error: 'pin_missing' });
    else if (canon(a) !== canon(e)) diffs.push({ path: p, expected: e, actual: a ?? null });
  }
  return diffs;
}
/** Invariants asserted independently of the pin (so a wrong pin can never certify a wrong database). */
export function catalogInvariantFailures(c) {
  const f = [];
  if (!c || typeof c !== 'object') return ['catalog_unreadable'];
  const pay = c.execute_payment_service;
  if (!Array.isArray(pay) || pay.length !== 4 || canon([...pay].sort()) !== canon([...PAYMENT_SERVICE_EXECUTE].sort())) f.push('payment_service_execute_not_exactly_4');
  if (getPath(c, 'execute.torneos_payment_service.count') !== 4) f.push('payment_service_execute_count_not_4');
  if (getPath(c, 'watermark.exists') !== true || getPath(c, 'watermark.rls') !== true) f.push('watermark_missing_or_no_rls');
  if (Number(getPath(c, 'watermark.api_privileges')) !== 0) f.push('watermark_api_privileges');
  if (Number(getPath(c, 'watermark.requires_manual_review')) !== 1) f.push('requires_manual_review_column');
  if (Number(getPath(c, 'watermark.date_last_updated')) !== 1) f.push('durable_watermark_timestamp');
  const po = c.provider_ordering ?? {};
  for (const k of ['order_verified', 'apply_status_ordered', 'apply_reversal_ordered', 'apply_status_unordered_absent', 'apply_reversal_unordered_absent', 'unordered_wrapped']) if (po[k] !== true) f.push(`provider_ordering_${k}`);
  if (Number(getPath(c, 'audit.purchase_events_append_only')) !== 1) f.push('durable_audit_purchase_events');
  if (Number(getPath(c, 'audit.grant_events_append_only')) !== 1) f.push('durable_audit_grant_events');
  if (getPath(c, 'identity.current_identity_id') !== true || Number(getPath(c, 'identity.bridge_issuer_pinned')) !== 1) f.push('identity_gate');
  const noRls = getPath(c, 'tables.public_tables_without_rls');
  if (!Array.isArray(noRls) || noRls.length !== 0) f.push('public_table_without_rls');
  if (Number(c.login_roles_torneos) !== 0) f.push('torneos_login_role_present');
  for (const r of c.roles ?? []) if (r.super || r.bypassrls || r.createrole || r.createdb) f.push(`role_privileged_${r.name}`);
  if (Number(getPath(c, 'functions.procedures')) !== 0) f.push('unexpected_procedures');
  if (Number(getPath(c, 'functions.public_execute_by_public_role')) !== 0) f.push('function_executable_by_PUBLIC');
  if (Number(c.foreign_servers) !== 0 || Number(c.user_mappings) !== 0) f.push('db_to_db_objects_present');
  for (const e of c.extensions ?? []) if (['dblink', 'postgres_fdw'].includes(e.name)) f.push(`db_to_db_extension_${e.name}`);
  // anon SELECT on the public-page tables is by design (RLS on every public table); the exact set is pinned.
  for (const t of PROBE_DENIED_TABLES) if ((c.anon_table_privileges ?? []).some((x) => x.startsWith(`${t}:`))) f.push(`anon_privilege_on_internal_${t}`);
  return f;
}
