#!/usr/bin/env node
// INFRA-0.5 — the Core PRODUCTION contract deployment as DATA. Offline and pure: no socket, no
// credential, no file written. The Production runner (core-prod-deploy.mjs), its transport
// (mgmt-prod.mjs), its harness (probe-prod.mjs) and the tests agree on everything here.
//
// Owner decision (INFRA-0.5, 2026-09-24): Core Production may receive EXCLUSIVELY the two Core
// contract migrations 20260914120000 + 20260915120000 (explicit, limited exception to "NO modificar
// DB Core"), the Edge secret TORNEOS_CONTRACT_SERVICE_SECRET and the Edge Function
// torneos-core-contract. Nothing else. This file freezes exactly that:
//
//   • target: rcyuuoaqfwcembdajcss, pinned by identity (name, org, region, created_at); Staging and
//     every other ref refused; the tooling accepts no ref input at all;
//   • migrations: the two authorized versions, bytes + rendered apply SQL + ledger rows pinned and
//     equal to the certified Staging pins (core-contract.mjs, reused read-only, never modified);
//   • ledger: the Production baseline (236 rows) pinned by per-row digest from the last read-only
//     capture of Production; any other ledger → STOP. No repair, no mark-as-applied, no reconcile;
//   • prerequisites: the Core columns/functions the contract compiles against, with Production types;
//   • app_private: absent before (Production has no such schema), exactly the contract set after;
//   • catalog: digests of every public object + namespaces/default ACL/roles/ledger outside the
//     contract, equal before and after the apply (no other Core object may change);
//   • artifact: the 3 files of the certified Staging deploy, byte-identical;
//   • custody: Keychain arma2-torneos-prod-core-contract/contract-secret, never a non-prod entry;
//   • confirmation: DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION <ref> <plan id>, typed on /dev/tty.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as C from '../../phase3b/remote/core-contract.mjs';
import { resolveFiles } from '../../phase3b/remote/mgmt-write.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export class ProdContractError extends Error {
  constructor(code, detail) { super(code); this.code = code; if (detail !== undefined) this.detail = detail; }
}
function fail(code, detail) { throw new ProdContractError(code, detail); }
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const byteOrder = (a, b) => Buffer.compare(Buffer.from(String(a)), Buffer.from(String(b)));

// ─────────────────────────── target ───────────────────────────
export const PROD_REF = 'rcyuuoaqfwcembdajcss';
export const STAGING_REF = 'hhyvmhgpapyuzjgxfnqv';
// Identity observed read-only by R1 (phase3b/evidence/remote-inventory-20260915T154002Z.json,
// sha256 502c2c69f5d5e45649b92ffdea3b78618f6b21472ef0f8a53c30292cc5d62286). The Postgres version
// is recorded, not pinned (a platform upgrade is not a reason to stop; a different project is).
export const PRODUCTION_PROJECT = Object.freeze({
  ref: PROD_REF, name: "nicoavayu's Project", organization_slug: 'gwqrborhnqjdzzmpxulh', region: 'sa-east-1', created_at: '2025-06-30T20:57:55.045023Z',
});
export const PRODUCTION_PROJECT_SOURCE = { file: 'backend/torneos/phase3b/evidence/remote-inventory-20260915T154002Z.json', sha256: '502c2c69f5d5e45649b92ffdea3b78618f6b21472ef0f8a53c30292cc5d62286' };
export const REQUIRED_STATUS = 'ACTIVE_HEALTHY';

export function assertProductionRef(ref) {
  if (ref === undefined || ref === null || ref === '') fail('ref_empty__ABORT');
  if (typeof ref !== 'string' || !/^[a-z]{20}$/.test(ref)) fail('ref_malformed__ABORT');
  if (ref === STAGING_REF) fail('ref_is_staging__ABORT');
  if (ref !== PROD_REF) fail('ref_not_production__ABORT');
  return ref;
}
/** Identity only (status is its own gate). `p` is the projection of GET /v1/projects/{ref}. */
export function projectIdentityFailures(p) {
  if (!p || typeof p !== 'object') return ['project_missing'];
  const out = [];
  for (const k of ['ref', 'name', 'organization_slug', 'region', 'created_at']) if (p[k] !== PRODUCTION_PROJECT[k]) out.push(`${k}=${JSON.stringify(p[k] ?? null)}`);
  return out;
}

// ─────────────────────────── the two authorized migrations ───────────────────────────
// Independent literal pins (a change in core-contract.mjs cannot silently widen Production); the
// tests assert they equal the certified Staging pins field by field.
export const AUTHORIZED_MIGRATIONS = Object.freeze([
  Object.freeze({ version: '20260914120000', name: 'torneos_core_contract_v1', file: 'supabase/migrations/20260914120000_torneos_core_contract_v1.sql', sha256: '2967ae6f67e36877c4931cb7821535eab10c5b7312026846f619b14fb045672c', apply_sql_sha256: '3d3e2845987ccdfd74b77ace51195865234066bb5828280fb0c8114969b84485', statements_count: 22, ledger_digest: '09ad7d261523fa1c2bb6e203a1624467', ledger_bytes: 16688, probe: C.MIGRATIONS[0].probe }),
  Object.freeze({ version: '20260915120000', name: 'torneos_core_contract_v1_1_session', file: 'supabase/migrations/20260915120000_torneos_core_contract_v1_1_session.sql', sha256: '5256413839ad0abe9c9533a675461cc6589fd720e6b2bede3bc8d201a75ce422', apply_sql_sha256: '859fa7a30dee4a03376a662ab74427927c6a8b8a404556abdd3bfa59e5e5b78c', statements_count: 3, ledger_digest: 'b424cc66022e7ab721e8070d0b05cdc7', ledger_bytes: 12088, probe: C.MIGRATIONS[1].probe }),
]);
export const AUTHORIZED_VERSIONS = AUTHORIZED_MIGRATIONS.map((m) => m.version);
export const AUTHORIZED_APPLY_SQL_SHA256 = new Set(AUTHORIZED_MIGRATIONS.map((m) => m.apply_sql_sha256));

/** A proposed apply list must be exactly [v1, v1.1]: nothing extra, nothing missing, in order. */
export function assertAuthorizedPlan(versions) {
  if (!Array.isArray(versions)) fail('plan_not_a_list__ABORT');
  for (const v of versions) if (!AUTHORIZED_VERSIONS.includes(v)) fail(`migration_not_authorized_${String(v).slice(0, 40)}__ABORT`);
  if (new Set(versions).size !== versions.length) fail('plan_order_violation_duplicate__ABORT');
  if (versions.length !== AUTHORIZED_VERSIONS.length) fail('plan_must_be_exactly_the_two_authorized_migrations__ABORT');
  if (versions.some((v, i) => v !== AUTHORIZED_VERSIONS[i])) fail('plan_order_violation__ABORT');
  return versions;
}

/** Renders the apply documents with the certified renderer and re-checks every Production pin. */
export function renderAuthorized(repo) {
  const rendered = C.renderAll(repo); // throws core_contract_migration_hash_mismatch / apply_sql_hash_mismatch
  assertAuthorizedPlan(rendered.map((m) => m.version));
  return rendered.map((m, i) => {
    const a = AUTHORIZED_MIGRATIONS[i];
    const got = { name: m.name, file: m.file, sha256: m.migration_sha256, apply_sql_sha256: m.apply_sql_sha256, statements_count: m.row.statements_count, ledger_digest: m.row.statements_digest, ledger_bytes: m.row.statements_bytes };
    for (const k of Object.keys(got)) if (got[k] !== a[k]) fail(`authorized_pin_mismatch_${a.version}_${k}__ABORT`);
    if (m.apply_sql.includes(STAGING_REF) || m.apply_sql.includes(PROD_REF)) fail('project_ref_in_apply_sql__ABORT');
    return m;
  });
}

// ─────────────────────────── the Production ledger model ───────────────────────────
export const LEDGER_BASELINE_FILE = path.join(HERE, 'pins/production-ledger-baseline.json');
export const LEDGER_BASELINE_SHA256 = '2093dcb3c26d531e7d0722791c1a37a2df5b800b8d47d331af461a56edeb45c8';
export const LEDGER_BASELINE_SOURCE_SHA256 = 'd00faa708ab6e6659882d897511bc60930b1872e230112b07ba8bd9aadd5162d';
export function loadLedgerBaseline() {
  const bytes = fs.readFileSync(LEDGER_BASELINE_FILE);
  if (sha256(bytes) !== LEDGER_BASELINE_SHA256) fail('ledger_baseline_hash_mismatch__ABORT');
  const b = JSON.parse(bytes.toString('utf8'));
  if (b.kind !== 'CORE_PRODUCTION_LEDGER_BASELINE' || b.project !== PROD_REF || b.source?.sha256 !== LEDGER_BASELINE_SOURCE_SHA256 || !Array.isArray(b.rows) || b.rows.length !== b.totals?.rows) fail('ledger_baseline_malformed__ABORT');
  if (b.rows.some((r) => byteOrder(r.version, AUTHORIZED_VERSIONS[0]) >= 0)) fail('ledger_baseline_reaches_contract_versions__ABORT');
  return b;
}
/** Per-row digests of the WHOLE ledger (never the text), in byte order — the same expression the baseline was derived with. */
export const LEDGER_ALL_ROWS_SQL = 'select m.version, m.name, (m.statements is null) as statements_is_null, coalesce(cardinality(m.statements), 0) as statements_count, coalesce(md5(array_to_string(m.statements, chr(30))), \'\') as statements_digest, coalesce(octet_length(array_to_string(m.statements, chr(30))), 0) as statements_bytes, (m.created_by is null) as created_by_is_null, (m.idempotency_key is null) as idempotency_key_is_null, (m.rollback is null) as rollback_is_null from supabase_migrations.schema_migrations m order by m.version collate "C"';
const ROW_FIELDS = ['name', 'statements_is_null', 'statements_count', 'statements_digest', 'statements_bytes', 'created_by_is_null', 'idempotency_key_is_null', 'rollback_is_null'];
const BOOL_FIELDS = new Set(['statements_is_null', 'created_by_is_null', 'idempotency_key_is_null', 'rollback_is_null']);
const NUM_FIELDS = new Set(['statements_count', 'statements_bytes']);
function normalizeRow(r) {
  const out = { version: r?.version };
  for (const k of ROW_FIELDS) {
    const v = r?.[k];
    if (BOOL_FIELDS.has(k)) out[k] = typeof v === 'boolean' ? v : null; // 't'/'f' or missing never equals a pin
    else if (NUM_FIELDS.has(k)) out[k] = (typeof v === 'number' || (typeof v === 'string' && /^[0-9]+$/.test(v))) ? Number(v) : null;
    else out[k] = typeof v === 'string' ? v : (v === null ? null : undefined);
  }
  return out;
}
/** absent | ours | foreign for one authorized version, by the certified CLI-shaped row digest. */
export function contractRowState(rows, m) {
  const r = rows.find((x) => x.version === m.version);
  if (!r) return 'absent';
  const ours = r.name === m.name && r.statements_is_null === false && r.statements_count === m.statements_count && r.statements_digest === m.ledger_digest && r.statements_bytes === m.ledger_bytes && r.created_by_is_null === true && r.idempotency_key_is_null === true && r.rollback_is_null === true;
  return ours ? 'ours' : 'foreign';
}
export function evaluateLedger({ shape, rows, baseline = loadLedgerBaseline() }) {
  const shape_diff = C.ledgerShapeDiff(shape);
  if (!Array.isArray(rows)) return { ok: false, shape_diff, error: 'ledger_rows_unreadable' };
  const norm = rows.map(normalizeRow);
  const versions = norm.map((r) => r.version);
  const bad_versions = versions.filter((v) => typeof v !== 'string' || !/^[0-9]{1,14}$/.test(v));
  const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
  const contract = {};
  for (const m of AUTHORIZED_MIGRATIONS) contract[m.version] = contractRowState(norm, m);
  const others = norm.filter((r) => !AUTHORIZED_VERSIONS.includes(r.version));
  const obs = new Map(others.map((r) => [r.version, r]));
  const base = new Map(baseline.rows.map((r) => [r.version, r]));
  const missing = baseline.rows.filter((r) => !obs.has(r.version)).map((r) => r.version);
  const added = others.filter((r) => !base.has(r.version)).map((r) => r.version);
  const changed = [];
  for (const r of others) {
    const b = base.get(r.version);
    if (!b) continue;
    const fields = ROW_FIELDS.filter((k) => r[k] !== b[k]);
    if (fields.length) changed.push({ version: r.version, fields });
  }
  const newer_versions = others.filter((r) => byteOrder(r.version, AUTHORIZED_VERSIONS[0]) >= 0).map((r) => r.version);
  const contract_ok = Object.values(contract).every((s) => s === 'absent' || s === 'ours');
  const ok = shape_diff.length === 0 && bad_versions.length === 0 && duplicates.length === 0 && missing.length === 0 && added.length === 0 && changed.length === 0 && newer_versions.length === 0 && contract_ok;
  return { ok, shape_diff, baseline: { rows: baseline.rows.length, missing, added, changed }, bad_versions, duplicates, newer_versions, contract, observed_rows: norm.length, observed_max_version: [...versions].sort(byteOrder).pop() ?? null };
}
/** The Production decision table: apply | skip | STOP. No reconcile-ledger (= mark-as-applied), no repair. */
export function prodApplyDecision(installed, ledger) {
  if (!installed && ledger === 'absent') return 'apply';
  if (installed && ledger === 'ours') return 'skip';
  if (installed && ledger === 'absent') return 'STOP:objects_without_ledger_row (no mark-as-applied in Production)';
  if (installed && ledger === 'foreign') return 'STOP:ledger_row_not_ours';
  return 'STOP:ledger_row_without_objects';
}
export function planMigrations(states) {
  if (!Array.isArray(states) || states.length !== AUTHORIZED_MIGRATIONS.length) return { decisions: [], stop: 'STOP:migration_state_unreadable' };
  const decisions = states.map((s, i) => {
    if (s?.version !== AUTHORIZED_VERSIONS[i] || typeof s.installed !== 'boolean') return { version: s?.version ?? null, decision: 'STOP:migration_state_unreadable' };
    return { version: s.version, installed: s.installed, ledger: s.ledger, decision: prodApplyDecision(s.installed, s.ledger) };
  });
  let stop = decisions.find((d) => d.decision.startsWith('STOP:'))?.decision ?? null;
  // v1.1 re-creates the RPC defined by v1: it may never be in place while v1 still has to be applied.
  if (!stop && decisions[0].decision === 'apply' && decisions[1].decision === 'skip') stop = 'STOP:order_violation_v1_1_without_v1';
  return { decisions, stop };
}

// ─────────────────────────── prerequisites (Production types, capture 2026-09-11) ───────────────────────────
// The SQL-language helpers of v1 are compiled at CREATE time (check_function_bodies), so a missing
// column aborts the apply transaction; the preflight proves they exist first.
export const PREREQUISITES_EXPECTED = Object.freeze({
  relations: {
    'auth.sessions': { id: 'uuid', not_after: 'timestamp with time zone', user_id: 'uuid' },
    'auth.users': { banned_until: 'timestamp with time zone', deleted_at: 'timestamp with time zone', email: 'character varying(255)', email_confirmed_at: 'timestamp with time zone', id: 'uuid', is_anonymous: 'boolean' },
    'public.jugadores': { id: 'bigint', usuario_id: 'uuid' },
    'public.team_members': { jugador_id: 'bigint', team_id: 'uuid', user_id: 'uuid' },
    'public.teams': { crest_url: 'text', id: 'uuid', is_active: 'boolean', name: 'text', updated_at: 'timestamp with time zone' },
    'public.usuarios': { acepta_invitaciones: 'boolean', avatar_url: 'text', id: 'uuid', nombre: 'text', posiciones: 'text[]' },
  },
  functions: {
    'public.normalize_tournament_person_name(text)': 'text',
    'public.team_user_is_admin_or_owner(uuid,uuid)': 'boolean',
    'public.team_user_is_owner(uuid,uuid)': 'boolean',
  },
});
const relProbe = (rel, cols) => `'${rel}', (select json_object_agg(a.attname, format_type(a.atttypid, a.atttypmod) order by a.attname) from pg_attribute a where a.attrelid = to_regclass('${rel}') and a.attnum > 0 and not a.attisdropped and a.attname in (${cols.map((c) => `'${c}'`).join(', ')}))`;
export const PREREQUISITES_SQL = `select json_build_object('relations', json_build_object(${Object.entries(PREREQUISITES_EXPECTED.relations).map(([rel, cols]) => relProbe(rel, Object.keys(cols))).join(', ')}), 'functions', json_build_object(${Object.keys(PREREQUISITES_EXPECTED.functions).map((sig) => `'${sig}', pg_get_function_result(to_regprocedure('${sig}'))`).join(', ')})) as prerequisites`;
export function prerequisiteFailures(obs) {
  if (!obs || typeof obs !== 'object' || !obs.relations || !obs.functions) return ['prerequisites_unreadable'];
  const out = [];
  for (const [rel, cols] of Object.entries(PREREQUISITES_EXPECTED.relations)) {
    const got = obs.relations[rel];
    if (!got || typeof got !== 'object') { out.push(`${rel}: missing`); continue; }
    for (const [col, type] of Object.entries(cols)) if (got[col] !== type) out.push(`${rel}.${col}: ${JSON.stringify(got[col] ?? null)} (expected ${type})`);
  }
  for (const [sig, result] of Object.entries(PREREQUISITES_EXPECTED.functions)) if (obs.functions[sig] !== result) out.push(`${sig}: ${JSON.stringify(obs.functions[sig] ?? null)} (expected ${result})`);
  return out;
}

// ─────────────────────────── app_private (absent in Production before; exact contract set after) ───────────────────────────
export const APP_PRIVATE_SQL = "select json_build_object('present', to_regnamespace('app_private') is not null, 'owner', (select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'app_private'), 'acl', (select n.nspacl::text from pg_namespace n where n.nspname = 'app_private'), 'relations', coalesce((select json_agg(c.relname || '|' || c.relkind::text order by c.relname || '|' || c.relkind::text collate \"C\") from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app_private'), '[]'::json), 'functions', coalesce((select json_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' collate \"C\") from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private'), '[]'::json), 'policies', (select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app_private'), 'types', coalesce((select json_agg(t.typname order by t.typname collate \"C\") from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'app_private' and t.typrelid = 0 and t.typelem = 0), '[]'::json)) as app_private";
export const APP_PRIVATE_BEFORE = Object.freeze({ present: false, owner: null, acl: null, relations: [], functions: [], policies: 0, types: [] });
export const APP_PRIVATE_AFTER = Object.freeze({
  present: true, owner: 'postgres', acl: null, // created by the migration as postgres: owner-only, no API-role USAGE
  relations: ['torneos_contract_nonces|r', 'torneos_contract_nonces_expiry|i', 'torneos_contract_nonces_pkey|i', 'torneos_contract_rate_events|r', 'torneos_contract_rate_events_actor|i', 'torneos_contract_rate_events_id_seq|S', 'torneos_contract_rate_events_pkey|i'].sort(byteOrder),
  functions: ['torneos_contract_email(p_value text)', 'torneos_contract_importable_team(p_user_id uuid, p_team_id uuid)', 'torneos_contract_url(p_value text)', 'torneos_contract_visible_player(p_user_id uuid)'].sort(byteOrder),
  policies: 0, types: [],
});
export function appPrivateFailures(obs, { installed }) {
  if (!obs || typeof obs !== 'object' || typeof obs.present !== 'boolean' || !Array.isArray(obs.relations) || !Array.isArray(obs.functions)) return ['app_private_unreadable'];
  const want = installed ? APP_PRIVATE_AFTER : APP_PRIVATE_BEFORE;
  // A NULL nspacl and an explicit ACL holding only the owner's own default privileges ({o=UC/o}, what a
  // GRANT followed by the matching REVOKE leaves behind) mean the same thing: owner-only. Nothing else is folded.
  const ownerOnly = typeof obs.owner === 'string' && obs.acl === `{${obs.owner}=UC/${obs.owner}}`;
  const got = { ...obs, acl: ownerOnly ? null : obs.acl, policies: Number(obs.policies), types: Array.isArray(obs.types) ? obs.types : null };
  const out = [];
  for (const k of ['present', 'owner', 'acl', 'policies']) if ((got[k] ?? null) !== want[k]) out.push(`${k}=${JSON.stringify(got[k] ?? null)} (expected ${JSON.stringify(want[k])})`);
  for (const k of ['relations', 'functions', 'types']) if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) out.push(`${k}=${JSON.stringify(got[k])}`);
  return out;
}

// ─────────────────────────── catalog digest: nothing outside the contract may change ───────────────────────────
const digestOf = (expr, from) => `(select json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(x, chr(29) order by x collate "C"), ''))) from (select ${expr} as x ${from}) q)`;
export const CATALOG_CATEGORIES = ['public_functions', 'public_relations', 'public_columns', 'public_policies', 'public_triggers', 'namespaces', 'default_acl', 'roles', 'memberships', 'ledger_other'];
export const CATALOG_DIGEST_SQL = `select json_build_object(${[
  ['public_functions', "p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || p.prokind::text || '|' || md5(coalesce(p.prosrc, '')) || '|' || p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.provolatile::text", "from pg_proc p where p.pronamespace = to_regnamespace('public') and p.proname <> 'torneos_contract_execute'"],
  ['public_relations', "c.relname || '|' || c.relkind::text || '|' || coalesce(c.relacl::text, '') || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|' || pg_get_userbyid(c.relowner)", "from pg_class c where c.relnamespace = to_regnamespace('public')"],
  ['public_columns', "c.relname || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|' || coalesce(a.attacl::text, '') || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')", "from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where c.relnamespace = to_regnamespace('public') and a.attnum > 0 and not a.attisdropped"],
  ['public_policies', "c.relname || '|' || pol.polname || '|' || pol.polcmd::text || '|' || pol.polpermissive::text || '|' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') || '|' || coalesce((select string_agg(r::regrole::text, ',' order by r::regrole::text) from unnest(pol.polroles) r), '')", "from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relnamespace = to_regnamespace('public')"],
  ['public_triggers', "c.relname || '|' || t.tgname || '|' || md5(pg_get_triggerdef(t.oid)) || '|' || t.tgenabled::text", "from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = to_regnamespace('public') and not t.tgisinternal"],
  ['namespaces', "n.nspname || '|' || pg_get_userbyid(n.nspowner) || '|' || coalesce(n.nspacl::text, '')", "from pg_namespace n where n.nspname <> 'app_private' and n.nspname !~ '^pg_(toast|temp)'"],
  ['default_acl', "pg_get_userbyid(d.defaclrole) || '|' || coalesce(n.nspname, '') || '|' || d.defaclobjtype::text || '|' || coalesce(d.defaclacl::text, '')", 'from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace'],
  ['roles', "r.rolname || '|' || r.rolsuper::text || '|' || r.rolbypassrls::text || '|' || r.rolcanlogin::text || '|' || r.rolinherit::text || '|' || r.rolcreaterole::text || '|' || r.rolcreatedb::text", "from pg_roles r where r.rolname !~ '^pg_'"],
  ['memberships', "m.roleid::regrole::text || '>' || m.member::regrole::text || '|' || m.admin_option::text", 'from pg_auth_members m'],
  ['ledger_other', "l.version || '|' || coalesce(l.name, '') || '|' || coalesce(md5(array_to_string(l.statements, chr(30))), 'null') || '|' || (l.created_by is null)::text || (l.idempotency_key is null)::text || (l.rollback is null)::text", `from supabase_migrations.schema_migrations l where l.version not in (${AUTHORIZED_VERSIONS.map((v) => `'${v}'`).join(', ')})`],
].map(([k, expr, from]) => `'${k}', ${digestOf(expr, from)}`).join(', ')}) as catalog`;
export function catalogShapeOk(cat) {
  return Boolean(cat && typeof cat === 'object' && CATALOG_CATEGORIES.every((k) => cat[k] && /^[0-9a-f]{32}$/.test(cat[k].digest) && Number.isInteger(Number(cat[k].count))));
}
/** Categories whose count or digest differ (the evidence shows which, never the content). */
export function catalogDiff(before, after) {
  return CATALOG_CATEGORIES.filter((k) => Number(before?.[k]?.count) !== Number(after?.[k]?.count) || before?.[k]?.digest !== after?.[k]?.digest);
}

// ─────────────────────────── ACL / permissions after the deploy ───────────────────────────
/** The certified Staging expectations (aclFailures) + the stricter Production schema isolation. */
export function prodAclFailures(acl) {
  const out = [...C.aclFailures(acl)];
  if (!acl || typeof acl !== 'object') return out;
  for (const r of C.ROLES) if (acl.schema?.usage?.[r] !== false) out.push(`app_private: ${r} USAGE=${acl.schema?.usage?.[r]} (expected false: the schema is new in Production and owner-only)`);
  return out;
}

// ─────────────────────────── the Edge Function artifact ───────────────────────────
export const FUNCTION_ARTIFACT = Object.freeze({
  slug: C.FUNCTION_SLUG, root: 'supabase', entrypoint: 'functions/torneos-core-contract/index.ts', verify_jwt: false,
  files: [
    { path: 'functions/_shared/supabaseApiKeys.ts', bytes: 3622, sha256: '5d6cc3aec5fbcd2a3b5d46b254957d2275c811b4660ff2e8afdcfa30fc94170a' },
    { path: 'functions/_shared/torneosCoreContract.ts', bytes: 16849, sha256: '83d129020be52dbc0e28ca4aa97d27a28fe9b2eded700f9ca6af0e69507812d7' },
    { path: 'functions/torneos-core-contract/index.ts', bytes: 2828, sha256: '41e012f03b72d24e1f386ce3902bbab6aff2b2bdcf7ec96a325f588a77b0d269' },
  ],
  // The Staging deploy these bytes were certified with (SIGNED_HARNESS_PASS 9/9, ACL []).
  certified_staging_evidence: { file: 'backend/torneos/phase3b/evidence/core-contract-20260917T214621Z.json', sha256: '5255249af48a6a8714c018f9fc53f601e949210323666ff8eb82fdaa6a9e4c88', ezbr_sha256: '1072419517953eee8e8021f9691d1a5b1efb1f871c4d13290f644d119caded2c', version: 1 },
});
/** What would be deployed from this checkout: the certified import walker + the multipart metadata. */
export function localArtifact(repo) {
  const files = resolveFiles(path.join(repo, FUNCTION_ARTIFACT.root), FUNCTION_ARTIFACT.entrypoint);
  return { files: files.map((f) => ({ path: f.relPath, bytes: f.bytes.length, sha256: f.sha256 })), metadata: { name: FUNCTION_ARTIFACT.slug, entrypoint_path: FUNCTION_ARTIFACT.entrypoint, verify_jwt: FUNCTION_ARTIFACT.verify_jwt } };
}
export function artifactDiff(a) {
  const out = [];
  if (!a || !Array.isArray(a.files)) return ['artifact_unreadable'];
  if (JSON.stringify(a.files) !== JSON.stringify(FUNCTION_ARTIFACT.files)) out.push(`files=${JSON.stringify(a.files.map((f) => [f.path, f.bytes, f.sha256.slice(0, 12)]))}`);
  const md = a.metadata ?? {};
  if (md.name !== FUNCTION_ARTIFACT.slug) out.push(`metadata.name=${md.name}`);
  if (md.entrypoint_path !== FUNCTION_ARTIFACT.entrypoint) out.push(`metadata.entrypoint_path=${md.entrypoint_path}`);
  if (md.verify_jwt !== false) out.push(`metadata.verify_jwt=${md.verify_jwt}`);
  return out;
}

// ─────────────────────────── secret custody ───────────────────────────
export const SECRET_NAME = C.SECRET_NAME; // TORNEOS_CONTRACT_SERVICE_SECRET
export const SECRET_PATTERN = /^[0-9a-f]{64}$/;
export const KEYCHAIN_PROD = Object.freeze({ service: 'arma2-torneos-prod-core-contract', account: 'contract-secret' });
export const FORBIDDEN_KEYCHAIN_SERVICES = Object.freeze(['arma2-torneos-nonprod-core', 'arma2-torneos-nonprod-db', 'arma2-torneos-nonprod-bridge']);
// Read ONLY to prove the Production value is a different one (compared in memory, never printed).
export const NONPROD_CONTRACT_KEYCHAIN = Object.freeze({ service: C.KEYCHAIN.service, account: C.KEYCHAIN.account });
export function assertProdKeychainNamespace(ns) {
  if (!ns || typeof ns !== 'object') fail('keychain_namespace_missing__ABORT');
  if (FORBIDDEN_KEYCHAIN_SERVICES.includes(ns.service)) fail('keychain_namespace_is_non_production__ABORT');
  if (ns.service !== KEYCHAIN_PROD.service || ns.account !== KEYCHAIN_PROD.account) fail('keychain_namespace_not_production__ABORT');
  return ns;
}
/** Keychain (ABSENT|PRESENT) × Core secret name (absent|PRESENT) → action. Production never reconciles. */
export function secretDecision(keychain, remote, { contractInstalled }) {
  if (!['ABSENT', 'PRESENT'].includes(keychain) || !['absent', 'PRESENT'].includes(remote)) return 'STOP:SECRET_STATE_AMBIGUOUS';
  if (keychain === 'ABSENT' && remote === 'absent') return 'generate-store-set';
  if (keychain === 'PRESENT' && remote === 'absent') return 'set-from-keychain';
  if (keychain === 'ABSENT') return 'STOP:SECRET_REMOTE_PRESENT_KEYCHAIN_ABSENT (Core holds a value nobody has; never rotated silently)';
  return contractInstalled === true ? 'verify-by-probe' : 'STOP:SECRET_PRESENT_WITHOUT_CONTRACT (a Core secret this tooling did not set)';
}
export function secretEqualsNonprod(value, nonprod) {
  if (typeof value !== 'string' || typeof nonprod !== 'string') return false;
  const a = Buffer.from(value); const b = Buffer.from(nonprod);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const SECRET_FLOW = Object.freeze({
  source: `macOS Keychain ${KEYCHAIN_PROD.service}/${KEYCHAIN_PROD.account} (generated once, 32 random bytes as hex, inside keychain-prod.py; never regenerated silently)`,
  destinations_allowed: [
    `Core Production (${PROD_REF}) Edge secret ${SECRET_NAME} — this tooling`,
    `Deno Deploy app torneos-gateway, variable ${SECRET_NAME} — a LATER phase, not this tooling`,
  ],
  destinations_forbidden: ['torneos-payments', 'frontend', 'repository', 'Supabase Torneos project', 'evidence', 'logs', 'argv', 'files', 'environment variables of the shell', 'the non-production Keychain entry'],
  carriers: ['keychain-prod.py → macOS Keychain (pty, never argv)', '/usr/bin/security -w → stdout pipe → node memory', 'node memory → HTTPS body of POST /v1/projects/{prod}/secrets', 'node memory → HMAC key of the signed harness'],
});

// ─────────────────────────── confirmation ───────────────────────────
export const CONFIRMATION_PREFIX = 'DEPLOY TORNEOS CORE CONTRACT TO PRODUCTION';
export function confirmationPhrase(planId) {
  if (typeof planId !== 'string' || !/^[0-9a-f]{12}$/.test(planId)) fail('plan_id_malformed__ABORT');
  return `${CONFIRMATION_PREFIX} ${PROD_REF} ${planId}`;
}
/** Exact match only; a single trailing line terminator (from the tty read) is the only tolerance. */
export function confirmationMatches(typed, planId) {
  if (typeof typed !== 'string') return false;
  return typed.replace(/\r?\n$/, '') === confirmationPhrase(planId);
}

// ─────────────────────────── evidence gate ───────────────────────────
const LEAK_PATTERNS = [/sbp_[A-Za-z0-9_]{20,}/, /sb_secret_[A-Za-z0-9_-]{8,}/, /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, /postgres(?:ql)?:\/\/[^\s"@/]+:[^\s"@/]+@/];
export function assertNoSecrets(text, known) {
  const s = String(text);
  for (const k of known ?? []) if (typeof k === 'string' && k.length >= 8 && s.includes(k)) fail('EVIDENCE_REJECTED_SECRET_LEAK');
  for (const re of LEAK_PATTERNS) if (re.test(s)) fail('EVIDENCE_REJECTED_SECRET_LEAK');
  return true;
}

// ─────────────────────────── harness-only: read-only corroboration that the RPC is reached ───────────────────────────
// PostgREST executes torneos_contract_execute as service_role inside a `pgrst_source` statement (Staging capture
// 2026-09-24: 1703 calls; Production before the API-key fix: 0). The Management API reader runs as another role,
// so its own statement (which names the function inside a literal) is never counted. Of the 9 certified requests,
// exactly 3 reach the RPC: signed session, its replay, signed verified-email.
export const RPC_STATS_SQL = "select json_build_object('calls', coalesce((select sum(s.calls) from extensions.pg_stat_statements s where pg_get_userbyid(s.userid) = 'service_role' and s.query ilike '%pgrst%' and s.query ilike '%torneos_contract_execute%'), 0)::bigint, 'stats_reset', (select i.stats_reset::text from extensions.pg_stat_statements_info i), 'dealloc', (select i.dealloc from extensions.pg_stat_statements_info i)) as rpc_stats";
export const HARNESS_RPC_CALLS = 3;
// PROBE_EXPECT indices of the signed requests answered by the RPC (503 CORE_UNAVAILABLE before the API-key fix).
export const HARNESS_RPC_CASES = Object.freeze([3, 4, 5]);

// ─────────────────────────── invariant: the certified Staging tooling is untouched ───────────────────────────
// sha256 of each file at d62039c7; the Production tooling only IMPORTS from these, never modifies them.
export const CERTIFIED_STAGING_TOOLING_SHA256 = Object.freeze({
  'backend/torneos/phase3b/remote/core-contract.mjs': 'c4a2594e609dfbe505ac82515f0aa0241cf9b280da50645f78a2ea4e26acb0c2',
  'backend/torneos/phase3b/remote/mgmt.mjs': 'd84456650a9cd8b333b86f0d69363812c07224ee15e4523af51b6c864683f18f',
  'backend/torneos/phase3b/remote/mgmt-write.mjs': '74aae5bc9bb74a4b20164203e910def96d8ef11948b10973d32217eeec5d46d0',
  'backend/torneos/phase3b/remote/probe-core-contract.mjs': '6aa7216ba49bb59d02110a6df1098a909eb143204c7a00f5737161d1fa297015',
  'backend/torneos/phase3b/remote/deploy-core-contract.sh': '49bc34975796ccfb52edc9c430d774f181a13e9e7cbd4d00d33f1722f148e610',
  'backend/torneos/phase3b/remote/lib.sh': 'c3f5411cf1a78e321ae33b6ef8356a9c3eafdcc239e1fa65f2e8b5d63f1df68c',
  'backend/torneos/phase3b/remote/keychain.py': 'ee8f63f19b1e4672703f43365cf17ea490b8263e9e322844dbbbbf3ba9504f1b',
  'backend/torneos/phase3b/remote/cli_parser.mjs': '1ab11b26450ac384a56bd0e50532bdbfe73ae0fa28905629980e8e7a113e65dd',
  'backend/torneos/phase3b/remote/mgmt-rollback.mjs': '0032813455c156cabd20bce7127891532895db7881ae9241e62b35100475a557',
  'backend/torneos/phase3b/remote/rollback-core-contract.sh': '3f704df2c0180186f16d2e565c981645ca6addb0867a8ce0078b9eb99fd0f5ce',
  'backend/torneos/phase3b/remote/core-contract.test.mjs': 'c035c7d018784faa72602f20c08b23b2464d520798c7bf71f7ca87f3d7dcf0ac',
  'backend/torneos/phase3b/contracts/core-contract-rollback.sql': '08edcd0e5eb8b614cbc79a1af770f914e26abb523bc90e849f2ceed2a72d6853',
});
