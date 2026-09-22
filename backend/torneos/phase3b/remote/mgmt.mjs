#!/usr/bin/env node
// Phase 3B — read-only Supabase Management API inventory transport.
//
// Purpose: answer Fase 1 ("qué infraestructura NON-PRODUCTION existe realmente") from
// the control plane instead of from documentation, without the Supabase CLI, without
// `--linked`, and without any credential touching argv, the environment or disk.
//
// Enforced here, not merely documented:
//   • the ONLY HTTP methods this file can send are GET and one POST to
//     /database/query with {"read_only": true}; there is no code path that writes
//   • every SQL text is scanned for write verbs before it is sent
//   • the Production ref may never appear in the host, path, body or token; any
//     per-project op is bound to an explicit non-production ref
//   • redirects are refused (a 3xx could carry the Authorization header elsewhere)
//   • output passes through redact(); API keys, secret values and auth secrets are
//     projected away before they can reach stdout
//
// Credentials arrive as ONE JSON document on STDIN: {"op": ..., "pat": "...", "ref"?: ...}.
//   op = orgs | org | projects | project | project-inventory
//      | core-ledger | core-contract-acl | secret-names | function | core-qa-users | core-session-exists | core-team-exists
//        (Phase 3B R3: read-only preflight/postflight of the Core contract on Core staging;
//        the SQL comes from core-contract.mjs and passes the same read-only guard)
// Output: one JSON line on stdout. The PAT never appears in it.

import https from 'node:https';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { LEDGER_SHAPE_SQL, LEDGER_ALL_VERSIONS_SQL, WRITER_PRIVILEGES_SQL, ledgerRowsSql, CLI_WRITTEN_VERSIONS, VERSIONS, MIGRATIONS, CONTRACT_ACL_SQL, FUNCTION_SLUG } from './core-contract.mjs';

export const PROD_REF = 'rcyuuoaqfwcembdajcss';
export const API_HOST = 'api.supabase.com';
export const REF_PATTERN = /^[a-z]{20}$/;
export const PAT_PATTERN = /^sbp_[A-Za-z0-9_]{20,160}$/;

const CONNECT_TIMEOUT_MS = 15000;
const DEADLINE_MS = 90000;

// ─────────────────────────────── redaction ──────────────────────────────────
const SECRETS = [];
export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 6) SECRETS.push(value);
}
export function redact(text, extra = []) {
  let out = String(text);
  for (const value of [...SECRETS, ...extra]) {
    if (typeof value === 'string' && value.length >= 6) out = out.split(value).join('«REDACTED»');
  }
  return out;
}
export class AbortError extends Error {}
function fail(error) { throw new AbortError(redact(error)); }

export function assertNoProduction(label, value) {
  if (typeof value === 'string' && value.includes(PROD_REF)) fail(`production_ref_in_${label}__ABORT`);
}
export function assertNonProductionRef(ref) {
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) fail('ref_malformed__ABORT');
  if (ref === PROD_REF) fail('ref_is_production__ABORT');
  assertNoProduction('ref', ref);
  return ref;
}

// ───────────────────────────── SQL: reads only ──────────────────────────────
// Each probe is one statement, no `;`, no write verb. A probe that errors on a given
// project (missing schema, denied catalog) is recorded as an error for that probe and
// never aborts the inventory: absence of an object is itself evidence.
export const WRITE_VERBS = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|reindex|cluster|refresh|call|do|merge|lock|comment|security|set\s+role|reset|notify|listen|unlisten|prepare|execute|deallocate|discard)\b/i;
export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) fail('sql_empty__ABORT');
  if (sql.includes(';')) fail('sql_multi_statement__ABORT');
  // Scan the statement with its string literals blanked: 'EXECUTE' as a privilege name is
  // data, not a verb. Identifiers are scanned as written.
  if (WRITE_VERBS.test(sql.replace(/'[^']*'/g, "''"))) fail('sql_write_verb__ABORT');
  if (!/^\s*(select|with)\b/i.test(sql)) fail('sql_not_a_select__ABORT');
  return sql;
}

export const PROBES = {
  server: "select current_setting('server_version') as server_version, current_user as api_role, current_database() as database",
  extensions: 'select e.extname, e.extversion, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by e.extname',
  migrations: 'select version, name from supabase_migrations.schema_migrations order by version',
  schemas: "select nspname from pg_namespace where nspname not in ('pg_catalog','information_schema') and nspname not like 'pg_toast%' and nspname not like 'pg_temp%' order by nspname",
  core_contract_objects: "select to_regprocedure('public.torneos_contract_execute(text,text,jsonb)') is not null as contract_execute, to_regclass('app_private.torneos_contract_nonces') is not null as contract_nonces, to_regclass('app_private.torneos_contract_rate_events') is not null as contract_rate_events",
  core_schema_objects: "select to_regclass('public.usuarios') is not null as usuarios, to_regclass('public.teams') is not null as teams, to_regclass('public.team_members') is not null as team_members, to_regclass('public.partidos') is not null as partidos, to_regclass('public.jugadores') is not null as jugadores",
  torneos_baseline_objects: "select to_regclass('public.torneos_identity') is not null as torneos_identity, to_regproc('private.check_token') is not null as check_token, to_regproc('private.current_identity_id') is not null as current_identity_id, to_regclass('private.core_contract_attestations') is not null as core_contract_attestations, to_regproc('private.authorize_core_contract') is not null as authorize_core_contract, to_regclass('public.tournament_organizations') is not null as tournament_organizations, to_regclass('public.tournament_team_entries') is not null as tournament_team_entries",
  application_roles: "select rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit from pg_roles where rolname !~ '^pg_' and rolname not in ('supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_replication_admin','supabase_read_only_user','supabase_realtime_admin','supabase_functions_admin','supabase_etl_admin','dashboard_user','authenticator','anon','authenticated','service_role','postgres','pgbouncer','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker') order by rolname",
  counts: "select (select count(*) from auth.users) as auth_users, (select count(*) from auth.sessions) as auth_sessions, (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as public_functions, (select count(*) from pg_tables where schemaname = 'public') as public_tables, (select count(*) from pg_tables where schemaname = 'public' and tablename like 'tournament%') as tournament_tables",
  anon_execute: "select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_execute, count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_execute, count(*) filter (where p.prosecdef) as security_definer, count(*) as total from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
  cron_jobs: 'select jobid, jobname, schedule, active from cron.job order by jobid',
  storage_buckets: 'select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id',
  api_role_config: "select rolname, rolconfig from pg_roles where rolname in ('authenticator','anon','authenticated','service_role') order by rolname",
  staging_gate_functions: "select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_execute, count(*) as present from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('review_tournament_team_entry','auto_schedule_tournament_matches','update_draft_fixture','schedule_tournament_match','publish_tournament_fixture')",
};
for (const sql of Object.values(PROBES)) assertReadOnlySql(sql);

// ───────────────────────────── projections ──────────────────────────────────
// Only these auth config keys may leave this process. Everything else in the
// /config/auth document (SMTP passwords, provider secrets, hook secrets, SAML) is
// dropped before emit, not merely redacted.
export const AUTH_CONFIG_KEYS = ['site_url', 'uri_allow_list', 'disable_signup', 'jwt_exp',
  'external_anonymous_users_enabled', 'mailer_autoconfirm', 'external_email_enabled',
  'external_phone_enabled', 'external_google_enabled', 'external_apple_enabled',
  'refresh_token_rotation_enabled', 'security_refresh_token_reuse_interval',
  'sessions_timebox', 'sessions_inactivity_timeout', 'sessions_single_per_user',
  'security_manual_linking_enabled', 'api_max_request_duration', 'db_max_pool_size'];
// PostgREST reads in-database config from rolconfig: `pgrst.jwt_secret` is a real secret
// carrier there, so only the db_/server_/openapi families are allowed through.
export const ROLCONFIG_SAFE_PREFIXES = ['pgrst.db_', 'pgrst.server_', 'pgrst.openapi', 'statement_timeout', 'lock_timeout',
  'idle_in_transaction_session_timeout', 'search_path', 'session_preload_libraries', 'log_'];

export function projectProject(p) {
  if (!p || typeof p !== 'object') return null;
  // The Management API (OpenAPI 2026-09-15) deprecates `id` for `ref` and `organization_id` for
  // `organization_slug`; both pairs carry the same value today. `id` stays the key of every
  // consumer (evidence, summarize.py) and is filled from whichever the API still sends.
  const ref = p.ref ?? p.id ?? null;
  return {
    id: ref, name: p.name ?? null, organization_id: p.organization_id ?? p.organization_slug ?? null,
    organization_slug: p.organization_slug ?? p.organization_id ?? null,
    region: p.region ?? null, status: p.status ?? null, created_at: p.created_at ?? null,
    database: p.database ? { version: p.database.version ?? null, postgres_engine: p.database.postgres_engine ?? null,
      release_channel: p.database.release_channel ?? null } : null,
    classification: ref === PROD_REF ? 'PRODUCTION (denylisted)' : 'NON_PRODUCTION',
  };
}
export const ORG_PLANS = new Set(['free', 'pro', 'team', 'enterprise', 'platform']);
export function projectOrganization(o) {
  if (!o || typeof o !== 'object') return null;
  // plan and release channels only: billing addresses, members and tags never leave this process
  return { id: o.id ?? o.slug ?? null, slug: o.slug ?? o.id ?? null, name: o.name ?? null,
    plan: typeof o.plan === 'string' && ORG_PLANS.has(o.plan) ? o.plan : null,
    allowed_release_channels: Array.isArray(o.allowed_release_channels) ? o.allowed_release_channels.filter((c) => typeof c === 'string') : null };
}
export function projectFunction(fn) {
  if (!fn || typeof fn !== 'object') return null;
  return { slug: fn.slug ?? null, name: fn.name ?? null, status: fn.status ?? null, version: fn.version ?? null,
    verify_jwt: fn.verify_jwt ?? null, updated_at: fn.updated_at ?? null, ezbr_sha256: fn.ezbr_sha256 ?? null,
    entrypoint_path: fn.entrypoint_path ?? null };
}
export function projectApiKey(k) {
  if (!k || typeof k !== 'object') return null;
  // never api_key, never hash
  return { id: k.id ?? null, name: k.name ?? null, type: k.type ?? null, description: k.description ?? null };
}
export function projectAuthConfig(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  for (const key of AUTH_CONFIG_KEYS) if (key in c) out[key] = c[key];
  return out;
}
export function projectRolconfig(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => ({ rolname: r.rolname, rolconfig: Array.isArray(r.rolconfig) ? r.rolconfig.map((entry) => {
    const s = String(entry);
    return ROLCONFIG_SAFE_PREFIXES.some((p) => s.startsWith(p)) ? s : `<omitted:${s.split('=')[0]}>`;
  }) : r.rolconfig }));
}
export function projectPostgrest(c) {
  if (!c || typeof c !== 'object') return null;
  return { db_schema: c.db_schema ?? null, db_extra_search_path: c.db_extra_search_path ?? null,
    max_rows: c.max_rows ?? null, db_pool: c.db_pool ?? null };
}

// ─────────────────────────────── transport ──────────────────────────────────
export function assertRequestEnvelope({ method, path, body }) {
  if (method !== 'GET' && method !== 'POST') fail(`method_not_allowed_${method}__ABORT`);
  if (typeof path !== 'string' || !path.startsWith('/v1/')) fail('path_not_v1__ABORT');
  assertNoProduction('path', path);
  if (method === 'POST') {
    if (!/^\/v1\/projects\/[a-z]{20}\/database\/query$/.test(path)) fail('post_only_database_query__ABORT');
    if (!body || body.read_only !== true) fail('post_requires_read_only__ABORT');
    assertReadOnlySql(body.query);
  }
  const payload = body === undefined ? null : JSON.stringify(body);
  if (payload !== null) assertNoProduction('body', payload);
  return payload;
}

export function httpsRequest({ pat, method, path, body }) {
  assertNoProduction('token', pat);
  const payload = assertRequestEnvelope({ method, path, body });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'User-Agent': 'arma2-torneos-phase3b-inventory/1' };
    if (payload !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = https.request({ host: API_HOST, servername: API_HOST, port: 443, method, path, headers,
      rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new AbortError(`redirect_refused_status_${res.statusCode}__ABORT`)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(new Error('idle_timeout')));
    // The failure line carries where and when (never the token): the shell runner persists it verbatim.
    req.on('error', (err) => { const e = new AbortError(redact(`request_failed_${err.message}`)); e.detail = { method, path, code: err.code ?? null, elapsed_ms: Date.now() - started, idle_timeout_ms: CONNECT_TIMEOUT_MS }; reject(e); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ─────────────────────────────── operations ─────────────────────────────────
export async function opOrgs(transport, pat) {
  const res = await transport({ pat, method: 'GET', path: '/v1/organizations' });
  if (res.status !== 200) fail(`organizations_status_${res.status}`);
  return { organizations: (Array.isArray(res.body) ? res.body : []).map((o) => ({ id: o.id ?? o.slug ?? null, slug: o.slug ?? o.id ?? null, name: o.name ?? null })) };
}

// R2 preflight: the plan decides whether a third active project can exist at all (Free: 2 active
// projects) and what it costs (paid: one more Micro, billed hourly). Read-only GET.
export const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export async function opOrg(transport, pat, slug) {
  if (typeof slug !== 'string' || !ORG_SLUG_PATTERN.test(slug)) fail('org_slug_malformed__ABORT');
  assertNoProduction('org', slug);
  const res = await transport({ pat, method: 'GET', path: `/v1/organizations/${slug}` });
  if (res.status !== 200) fail(`organization_status_${res.status}`);
  const org = projectOrganization(res.body);
  if (!org?.plan) fail('organization_plan_unreadable__ABORT');
  return { organization: org };
}

export async function opProjects(transport, pat) {
  const res = await transport({ pat, method: 'GET', path: '/v1/projects' });
  if (res.status !== 200) fail(`projects_status_${res.status}`);
  const rows = (Array.isArray(res.body) ? res.body : []).map(projectProject).filter(Boolean);
  return {
    projects: rows,
    production_present: rows.some((r) => r.id === PROD_REF),
    non_production_refs: rows.filter((r) => r.id !== PROD_REF).map((r) => r.id),
  };
}

export async function opProject(transport, pat, ref) {
  assertNonProductionRef(ref);
  const res = await transport({ pat, method: 'GET', path: `/v1/projects/${ref}` });
  if (res.status !== 200) fail(`project_status_${res.status}`);
  return { project: projectProject(res.body) };
}

export async function opProjectInventory(transport, pat, ref) {
  assertNonProductionRef(ref);
  const base = `/v1/projects/${ref}`;
  const out = { ref, control_plane: {}, database: {} };
  const get = async (name, path, project) => {
    try {
      const res = await transport({ pat, method: 'GET', path });
      out.control_plane[name] = res.status === 200 ? project(res.body) : { error: `status_${res.status}` };
    } catch (error) { out.control_plane[name] = { error: redact(error?.message ?? 'error') }; }
  };
  await get('project', base, projectProject);
  await get('functions', `${base}/functions`, (b) => (Array.isArray(b) ? b.map(projectFunction) : { unexpected: true }));
  await get('secret_names', `${base}/secrets`, (b) => (Array.isArray(b) ? b.map((s) => s.name ?? null).filter(Boolean).sort() : { unexpected: true }));
  await get('api_keys', `${base}/api-keys?reveal=false`, (b) => (Array.isArray(b) ? b.map(projectApiKey) : { unexpected: true }));
  await get('postgrest', `${base}/postgrest`, projectPostgrest);
  await get('auth_config', `${base}/config/auth`, projectAuthConfig);
  for (const [name, query] of Object.entries(PROBES)) {
    try {
      const res = await transport({ pat, method: 'POST', path: `${base}/database/query`, body: { query, read_only: true } });
      if (res.status !== 200 && res.status !== 201) { out.database[name] = { error: `status_${res.status}`, message: typeof res.body?.message === 'string' ? redact(res.body.message).slice(0, 200) : null }; continue; }
      const rows = Array.isArray(res.body) ? res.body : (Array.isArray(res.body?.result) ? res.body.result : res.body);
      out.database[name] = name === 'api_role_config' ? projectRolconfig(rows) : rows;
    } catch (error) { out.database[name] = { error: redact(error?.message ?? 'error') }; }
  }
  return out;
}

// ───────────────────────── Phase 3B R3: Core contract read-only probes ─────────────────────────
// One read-only POST per probe; a failed probe is recorded, never inferred. All SQL is data from
// core-contract.mjs and is scanned by assertReadOnlySql like every other probe here.
async function readSql(transport, pat, ref, query) {
  assertReadOnlySql(query);
  const res = await transport({ pat, method: 'POST', path: `/v1/projects/${ref}/database/query`, body: { query, read_only: true } });
  if (res.status !== 200 && res.status !== 201) return { error: `status_${res.status}`, message: typeof res.body?.message === 'string' ? redact(res.body.message).slice(0, 200) : null };
  return { rows: Array.isArray(res.body) ? res.body : (Array.isArray(res.body?.result) ? res.body.result : [res.body]) };
}
export async function opCoreLedger(transport, pat, ref) {
  assertNonProductionRef(ref);
  const shape = await readSql(transport, pat, ref, LEDGER_SHAPE_SQL);
  const rows = await readSql(transport, pat, ref, ledgerRowsSql([...CLI_WRITTEN_VERSIONS, ...VERSIONS]));
  const all = await readSql(transport, pat, ref, LEDGER_ALL_VERSIONS_SQL);
  const writer = await readSql(transport, pat, ref, WRITER_PRIVILEGES_SQL);
  const installed = {};
  for (const m of MIGRATIONS) {
    const r = await readSql(transport, pat, ref, m.probe);
    installed[m.version] = r.error ? { error: r.error } : { installed: r.rows[0]?.installed === true };
  }
  return { ref, shape: shape.error ? shape : (shape.rows[0]?.shape ?? null), rows: rows.error ? rows : rows.rows, all_versions: all.error ? all : all.rows, writer: writer.error ? writer : (writer.rows[0]?.writer ?? null), installed };
}
export async function opCoreContractAcl(transport, pat, ref) {
  assertNonProductionRef(ref);
  const acl = await readSql(transport, pat, ref, CONTRACT_ACL_SQL);
  return { ref, acl: acl.error ? acl : (acl.rows[0]?.acl ?? null) };
}
export async function opSecretNames(transport, pat, ref) {
  assertNonProductionRef(ref);
  const res = await transport({ pat, method: 'GET', path: `/v1/projects/${ref}/secrets` });
  if (res.status !== 200) fail(`secrets_status_${res.status}`);
  return { ref, secret_names: (Array.isArray(res.body) ? res.body : []).map((s) => s.name ?? null).filter(Boolean).sort() };
}
export async function opFunction(transport, pat, ref, slug) {
  assertNonProductionRef(ref);
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,64}$/.test(slug)) fail('slug_malformed__ABORT');
  const res = await transport({ pat, method: 'GET', path: `/v1/projects/${ref}/functions/${slug}` });
  if (res.status === 404) return { ref, slug, present: false, fn: null };
  if (res.status !== 200) fail(`function_status_${res.status}`);
  return { ref, slug, present: true, fn: projectFunction(res.body) };
}
// D1 positive test (decision C, 2026-09-15): candidates for a DEDICATED QA user, masked. The
// operator picks by typing the email; the runner never picks and never creates a user.
export const QA_USERS_SQL = "select left(u.id::text, 8) as id_prefix, regexp_replace(u.email, '^(.).*(@.*)$', '\\1***\\2') as email_masked, (u.email ~* '(^|[._+-])(qa|test|synthetic|phase3b|e2e)([._+-]|@)') as looks_like_qa, (u.email_confirmed_at is not null) as confirmed, (u.encrypted_password is not null and u.encrypted_password <> '') as has_password, (u.deleted_at is null) as live, (u.banned_until is null or u.banned_until <= now()) as not_banned, coalesce(u.is_anonymous, false) as anonymous, (select count(*) from auth.sessions s where s.user_id = u.id) as sessions, u.last_sign_in_at, u.created_at from auth.users u order by u.created_at";
assertReadOnlySql(QA_USERS_SQL);
export async function opCoreQaUsers(transport, pat, ref) {
  assertNonProductionRef(ref);
  const r = await readSql(transport, pat, ref, QA_USERS_SQL);
  if (r.error) fail(`qa_users_${r.error}`);
  const users = r.rows.map((u) => ({ ...u, sessions: Number(u.sessions) }));
  return { ref, users, dedicated_candidates: users.filter((u) => u.looks_like_qa && u.confirmed && u.has_password && u.live && u.not_banned && !u.anonymous).map((u) => u.email_masked) };
}
export function sessionExistsSql(sessionId, userId) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!UUID.test(sessionId) || !UUID.test(userId)) fail('uuid_malformed__ABORT');
  return `select exists (select 1 from auth.sessions s where s.id = '${sessionId}') as session_present, (select count(*) from auth.sessions s where s.user_id = '${userId}') as user_sessions`;
}
export async function opCoreSessionExists(transport, pat, ref, sessionId, userId) {
  assertNonProductionRef(ref);
  const r = await readSql(transport, pat, ref, sessionExistsSql(sessionId, userId));
  if (r.error) fail(`session_probe_${r.error}`);
  return { ref, session_present: r.rows[0]?.session_present === true, user_sessions: Number(r.rows[0]?.user_sessions) };
}

// Phase 3B R5: the Core team fixture the R5 journey creates in Core staging (as the QA owner) must be gone
// after cleanup. Read-only existence probe, same transport and guards as the session probe.
export function teamExistsSql(teamId) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!UUID.test(teamId)) fail('uuid_malformed__ABORT');
  return `select exists (select 1 from public.teams t where t.id = '${teamId}') as team_present, (select count(*) from public.team_members m where m.team_id = '${teamId}') as team_members`;
}
export async function opCoreTeamExists(transport, pat, ref, teamId) {
  assertNonProductionRef(ref);
  const r = await readSql(transport, pat, ref, teamExistsSql(teamId));
  if (r.error) fail(`team_probe_${r.error}`);
  return { ref, team_present: r.rows[0]?.team_present === true, team_members: Number(r.rows[0]?.team_members) };
}

export async function run(request, transport = httpsRequest) {
  const { op, pat, ref, slug, session_id, user_id, team_id } = request ?? {};
  if (typeof pat !== 'string' || !PAT_PATTERN.test(pat)) fail('missing_or_malformed_pat');
  registerSecret(pat);
  assertNoProduction('token', pat);
  if (op === 'orgs') return opOrgs(transport, pat);
  if (op === 'org') return opOrg(transport, pat, slug);
  if (op === 'projects') return opProjects(transport, pat);
  if (op === 'project') return opProject(transport, pat, ref);
  if (op === 'project-inventory') return opProjectInventory(transport, pat, ref);
  if (op === 'core-ledger') return opCoreLedger(transport, pat, ref);
  if (op === 'core-contract-acl') return opCoreContractAcl(transport, pat, ref);
  if (op === 'secret-names') return opSecretNames(transport, pat, ref);
  if (op === 'function') return opFunction(transport, pat, ref, slug ?? FUNCTION_SLUG);
  if (op === 'core-qa-users') return opCoreQaUsers(transport, pat, ref);
  if (op === 'core-session-exists') return opCoreSessionExists(transport, pat, ref, session_id, user_id);
  if (op === 'core-team-exists') return opCoreTeamExists(transport, pat, ref, team_id);
  fail('unknown_op');
}

async function main() {
  const stdin = await new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
  let request;
  try { request = JSON.parse(stdin); } catch { process.stdout.write('{"ok":false,"error":"stdin_not_json"}\n'); process.exit(1); }
  if (request?.pat) registerSecret(request.pat);
  const startedAt = Date.now();
  const deadline = setTimeout(() => { process.stdout.write(JSON.stringify({ ok: false, op: request?.op ?? null, error: 'deadline_exceeded', detail: { deadline_ms: DEADLINE_MS, elapsed_ms: Date.now() - startedAt } }) + '\n'); process.exit(1); }, DEADLINE_MS);
  deadline.unref?.();
  try {
    const result = await run(request);
    clearTimeout(deadline);
    process.stdout.write(redact(JSON.stringify({ ok: true, op: request.op, ...result })) + '\n');
  } catch (error) {
    clearTimeout(deadline);
    process.stdout.write(redact(JSON.stringify({ ok: false, op: request?.op ?? null, error: error?.message ?? 'error', detail: error?.detail ?? null, elapsed_ms: Date.now() - startedAt })) + '\n');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
