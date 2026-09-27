// COMPETITION-V1 REMOTE — every pin of the Production enablement of the full-competition contract (Phase G).
//
//   G1  read-only   Torneos Production DB state (psql READ ONLY as the installer, Keychain password), Deno Deploy
//                   observation (app, revisions, env names/flags), public + bridge-token gateway probes.
//   W1  one write   psql: 00000000000004_competition_v1_rpc_exposure.sql, the certified bytes, ONE transaction.
//   W2  one write   Deno Deploy: one production revision of the candidate gateway source (assets only — the app-level
//                   env is not part of the request, so it cannot change).
//   rollback        W2 → redeploy of the pinned previous source (bea307a3, digest 723c5d39…); W1 → the documented
//                   rollback script (REVOKE of the 15; the two function fixes stay). Order: gateway first, then DB.
//
// Nothing here is an argument: refs, hosts, files, hashes, function sets, counts and phrases are pins. No credential
// lives in this directory: the installer password and the bridge ring are read from the Keychain into memory, the Deno
// token is typed on the tty (run-competition-session.sh).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { assertReadOnlySql } from '../torneos-foundation/foundation-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const EVIDENCE_DIR = path.join(REPO_ROOT, 'backend/torneos/competition-v1/evidence/remote');
export const DELTA_PIN_FILE = path.join(HERE, 'pins/competition-v1-db-delta.json');
export const CANDIDATE_PIN_FILE = path.join(HERE, 'pins/competition-v1-gateway-candidate.json');
export const CURRENT_DEPLOY_PIN_FILE = path.join(REPO_ROOT, 'backend/torneos/infra/torneos-gateway-remote/pins/gateway-deploy.json');

// ─────────────────────────── target ───────────────────────────
export const TORNEOS_REF = G.TORNEOS_REF;
if (TORNEOS_REF !== 'onzpwnqxnvlgsevivngf') throw new Error('torneos_ref_pin');
/** The Supavisor host of Arma2 Torneos, measured by the Management API in INFRA-1 and every later preflight (sa-east-1). */
export const POOLER_HOST = 'aws-0-sa-east-1.pooler.supabase.com';
export const POOLER_PORT = 5432;
export const INSTALLER = 'postgres';
export const KEYCHAIN_INSTALLER = Object.freeze({ service: 'arma2-torneos-dataplane-db', account: 'postgres' });

// ─────────────────────────── database delta ───────────────────────────
export const MIGRATION = Object.freeze({
  seq: '0004', file: 'backend/torneos/supabase/migrations/00000000000004_competition_v1_rpc_exposure.sql',
  sha256: '36e45eddf57690470d80a0284f454a74ebfe4135cf89cbc0f4274ffdf41e3729',
});
export const ROLLBACK = Object.freeze({
  file: 'backend/torneos/competition-v1/rollback/00000000000004_competition_v1_rpc_exposure.rollback.sql',
  sha256: '29d84770d6f886f3bec19e2f6a87d1185a7fa7968755a9c94e53653103885c82',
});
/** The certified 0000–0003 of the Torneos project (INFRA-1 pin); 0004 is applied only on top of exactly these. */
export const APPLIED_BEFORE = Object.freeze(['f857bd09', '3df4b96e', '06378f12', 'd54b3293']);

const contract = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'backend/torneos/competition-v1/contract.json'), 'utf8'));
export const GRANTED = Object.freeze([...contract.acl.granted_by_0004]);
export const KEPT_REVOKED = Object.freeze([...contract.acl.kept_revoked]);
export const SERVICE_ONLY = Object.freeze([...contract.acl.service_only]);
export const FIXES = Object.freeze(contract.acl.function_fixes.map((f) => Object.freeze({ fn: f.function, before: f.body_md5_before, after: f.body_md5_after })));
export const COUNTS = Object.freeze({ authenticatedBefore: contract.acl.authenticated_public_before, authenticatedAfter: contract.acl.authenticated_public_after, anon: contract.acl.anon_public });
if (GRANTED.length !== 15 || KEPT_REVOKED.length !== 17 || SERVICE_ONLY.length !== 6 || FIXES.length !== 2) throw new Error('competition_v1_contract_shape');
if (COUNTS.authenticatedAfter - COUNTS.authenticatedBefore !== GRANTED.length) throw new Error('competition_v1_counts');
/** Fixed functions that are not among the 15 (publish_tournament_document_version: baseline authenticated, body fixed). */
export const FIXED_ONLY = Object.freeze(FIXES.map((f) => f.fn).filter((s) => !GRANTED.includes(s)));
/** Roles that must never execute any of the 38 (server roles of the Torneos project; checked when they exist). */
export const SERVER_ROLES = Object.freeze(['torneos_core_adapter', 'torneos_identity_writer', 'torneos_payment_service']);

export function assertFileHash(rel, expected) {
  const bytes = fs.readFileSync(path.join(REPO_ROOT, rel));
  const got = sha256(bytes);
  if (got !== expected) throw new Error(`file_hash_mismatch ${rel} ${got.slice(0, 12)}`);
  return bytes;
}

// ─────────────────────────── read-only state SQL ───────────────────────────
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const fnRows = (list) => list.map((s) => `(${lit(s)})`).join(',');
const acl = (role) => `has_function_privilege(${lit(role)}, p.oid, 'EXECUTE')`;
/**
 * One SELECT (no side effect, no write verb): the 38 functions of the contract with their grants, owner, definer
 * setting and body md5; the public EXECUTE counts; the installer's position. Runs inside BEGIN READ ONLY … ROLLBACK
 * with default_transaction_read_only=on.
 */
export const STATE_SQL = `with
 wanted(kind, sig) as (select 'granted', s from (values ${fnRows(GRANTED)}) v(s) union all select 'kept', s from (values ${fnRows(KEPT_REVOKED)}) v(s) union all select 'service_only', s from (values ${fnRows(SERVICE_ONLY)}) v(s) union all select 'fixed', s from (values ${fnRows(FIXED_ONLY)}) v(s)),
 fns as (select w.kind, w.sig, p.oid, p.prosecdef, p.proconfig, p.proowner, p.proacl, md5(p.prosrc) as body from wanted w left join pg_proc p on p.oid = to_regprocedure('public.' || w.sig)),
 pub as (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f')
select json_build_object(
 'server_version', current_setting('server_version'),
 'read_only', current_setting('transaction_read_only'),
 'current_user', current_user,
 'functions', (select json_agg(json_build_object('kind', f.kind, 'sig', f.sig, 'exists', f.oid is not null,
    'anon', f.oid is not null and ${acl('anon').replace('p.oid', 'f.oid')}, 'authenticated', f.oid is not null and ${acl('authenticated').replace('p.oid', 'f.oid')},
    'service_role', f.oid is not null and ${acl('service_role').replace('p.oid', 'f.oid')},
    'public', f.oid is not null and exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'),
    'server_roles', (select coalesce(json_agg(r.rolname order by r.rolname), '[]'::json) from pg_roles r where f.oid is not null and r.rolname in (${SERVER_ROLES.map(lit).join(',')}) and has_function_privilege(r.oid, f.oid, 'EXECUTE')),
    'definer', f.prosecdef, 'search_path_pinned', coalesce(f.proconfig @> array['search_path=""'], false),
    'owner', case when f.oid is null then null else pg_get_userbyid(f.proowner) end,
    'installer_owns', f.oid is not null and pg_has_role(current_user, f.proowner, 'USAGE'),
    'body_md5', f.body) order by f.kind, f.sig) from fns f),
 'counts', json_build_object('authenticated_public', (select count(*) from pub p where ${acl('authenticated')}), 'anon_public', (select count(*) from pub p where ${acl('anon')})),
 'ledger', to_regclass('supabase_migrations.schema_migrations') is not null,
 'role_settings', (select json_object_agg(rolname, coalesce(rolconfig, array[]::text[])) from pg_roles where rolname in ('anon', 'authenticated', 'authenticator'))
)`;
assertReadOnlySql(STATE_SQL);
if (/;/.test(STATE_SQL)) throw new Error('state_sql_multi_statement');

/** psql script: the SELECT inside an explicit READ ONLY transaction that always ends in ROLLBACK. */
export const readOnlyScript = (select) => `BEGIN TRANSACTION READ ONLY;\n${assertReadOnlySql(select)};\nROLLBACK;\n`;

/**
 * State of the database for this delta.
 *   PRE_0004     0000–0003 as certified: the 15 closed to the clients, fixes absent, counts 147 / 12.
 *   POST_0004    the 15 executable by authenticated only, fixes present, counts 162 / 12.
 *   ROLLED_BACK  the rollback script ran: the 15 closed again, fixes kept, counts 147 / 12.
 *   DRIFT        anything else (with the reasons).
 * The 23 functions 0004 does not grant, the anon count and every non-authenticated grantee are invariant in all states.
 */
export function classifyState(s) {
  const f = [];
  if (!s || !Array.isArray(s.functions)) return { state: 'DRIFT', failures: ['state_unreadable'] };
  if (s.read_only !== 'on') f.push('session_not_read_only');
  const by = (kind) => s.functions.filter((x) => x.kind === kind);
  const want = { granted: GRANTED, kept: KEPT_REVOKED, service_only: SERVICE_ONLY, fixed: FIXED_ONLY };
  for (const [kind, list] of Object.entries(want)) {
    const got = by(kind).map((x) => x.sig).sort();
    if (JSON.stringify(got) !== JSON.stringify([...list].sort())) f.push(`${kind}_set_mismatch`);
  }
  for (const x of s.functions) {
    if (!x.exists) { f.push(`missing ${x.sig}`); continue; }
    if (x.anon) f.push(`anon_executes ${x.sig}`);
    if (x.public) f.push(`public_executes ${x.sig}`);
    if (x.server_roles?.length) f.push(`server_role_executes ${x.sig}`);
    if (x.kind === 'fixed') { if (!x.definer || !x.search_path_pinned || !x.authenticated) f.push(`fixed_function_shape ${x.sig}`); if (x.owner !== INSTALLER) f.push(`owner_not_installer ${x.sig}`); continue; }
    if (x.kind !== 'granted' && x.authenticated) f.push(`closed_function_open ${x.sig}`);
    if (x.kind === 'granted' && (!x.definer || !x.search_path_pinned || !x.service_role)) f.push(`granted_function_shape ${x.sig}`);
    if (x.owner !== INSTALLER) f.push(`owner_not_installer ${x.sig}`);
  }
  if (Number(s.counts?.anon_public) !== COUNTS.anon) f.push(`anon_count_${s.counts?.anon_public}`);
  if (f.length) return { state: 'DRIFT', failures: f };
  const granted = by('granted');
  const open = granted.filter((x) => x.authenticated).length;
  const bodies = FIXES.map((fx) => s.functions.find((x) => x.sig === fx.fn)?.body_md5);
  const fixesBefore = FIXES.every((fx, i) => bodies[i] === fx.before);
  const fixesAfter = FIXES.every((fx, i) => bodies[i] === fx.after);
  const auth = Number(s.counts?.authenticated_public);
  if (open === 0 && fixesBefore && auth === COUNTS.authenticatedBefore) return { state: 'PRE_0004', failures: [] };
  if (open === GRANTED.length && fixesAfter && auth === COUNTS.authenticatedAfter) return { state: 'POST_0004', failures: [] };
  if (open === 0 && fixesAfter && auth === COUNTS.authenticatedBefore) return { state: 'ROLLED_BACK', failures: [] };
  return { state: 'DRIFT', failures: [`partial: open ${open}/15, fixes ${fixesBefore ? 'before' : fixesAfter ? 'after' : 'unknown'} ${bodies.map((b) => String(b).slice(0, 8)).join(',')}, authenticated ${auth}`] };
}

/**
 * Catalog paths (foundation CATALOG_SQL) that W1 moves. Every other strict path of the foundation pin + the gateway /
 * payments delta pins stays exactly as certified; these two are pinned per state in pins/competition-v1-db-delta.json
 * (derived by offline-rehearsal.mjs on the same image family, installer postgres, exactly like the foundation pin).
 */
export const CV1_CATALOG_PATHS = Object.freeze(['execute', 'functions.bodies_md5', 'acl_md5']);

// ─────────────────────────── gateway ───────────────────────────
export const APP_SLUG = 'torneos-gateway';
export const GATEWAY_BASE = 'https://torneos-gateway.nicoavayu.deno.net/functions/v1/torneos-gateway';
export const readCurrentDeployPin = () => JSON.parse(fs.readFileSync(CURRENT_DEPLOY_PIN_FILE, 'utf8'));
export const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
/** The deployed revision and its source, as pinned by the gateway-remote session (public facts only). */
export const CURRENT = Object.freeze({ revision: '3rvq2wx9tyyg', head: 'bea307a3a82fd8e610f99210c2f8b40f9ceb0697', digest: '723c5d3928741af906771923fab8ac9c54dd9eee58d266cec3a7fa4cd3fa5514', files: 14 });
{
  const p = readCurrentDeployPin();
  if (p.revision !== CURRENT.revision || p.source.head !== CURRENT.head || p.source.digest !== CURRENT.digest || p.source.files.length !== CURRENT.files) throw new Error('current_deploy_pin_mismatch');
}
/**
 * The Deno Deploy organization/app as last certified (gateway-remote evidence gr-01-deno-observe-20260926T015931Z,
 * public facts only). G1 compares the live app against it: any configuration change since the certification moves
 * `updated_at`, and any new revision shows up in the revision set.
 */
export const DENO_CERTIFIED = Object.freeze({
  evidence: 'backend/torneos/mp-b/evidence/gateway-remote/gr-01-deno-observe-20260926T015931Z.json',
  // + the payments TEST app certified afterwards (PAYMENTS_REMOTE_TEST_CERTIFIED, pins/payments-test-deploy.json).
  org_apps: Object.freeze([Object.freeze({ slug: 'torneos-gateway', id: '5d4f18e9-1614-4e24-b8e0-fd7cff8e4c3d' }), Object.freeze({ slug: 'torneos-payments-test', id: '46dc4189-bc99-4c89-88d0-ea596e31d0a1' })]),
  org_layers: 0,
  app: Object.freeze({ id: '5d4f18e9-1614-4e24-b8e0-fd7cff8e4c3d', created_at: '2026-09-26T01:08:16.167Z', updated_at: '2026-09-26T01:12:00.894Z',
    config: Object.freeze({ runtime: Object.freeze({ type: 'dynamic', entrypoint: 'torneos-gateway/index.ts' }), crons: false }),
    labels: Object.freeze({ 'custom.component': 'arma2-torneos-gateway' }) }),
  revisions: Object.freeze(['3rvq2wx9tyyg', 'ec6zv20gx8hn']),
  current: Object.freeze({ id: '3rvq2wx9tyyg', created_at: '2026-09-26T01:12:01.540Z', build_finished_at: '2026-09-26T01:12:04.154Z' }),
  production_domain: 'torneos-gateway.nicoavayu.deno.net',
});
/** Env of the app: names + secret flags (13, exactly the gateway-remote pin). W2 sends no env at all. */
export const ENV_SHAPE = Object.freeze(readCurrentDeployPin().env.map((e) => Object.freeze({ key: e.key, secret: e.secret })));

export const PHRASES = Object.freeze({
  w1: (id) => `APPLY TORNEOS MIGRATION 0004 COMPETITION-V1 ${TORNEOS_REF} ${id}`,
  w1Rollback: (id) => `ROLLBACK TORNEOS MIGRATION 0004 COMPETITION-V1 ${TORNEOS_REF} ${id}`,
  w2: (id) => `DEPLOY TORNEOS GATEWAY COMPETITION-V1 ${APP_SLUG} ${id}`,
  w2Rollback: (id) => `ROLLBACK TORNEOS GATEWAY ${APP_SLUG} TO ${CURRENT.head.slice(0, 8)} ${id}`,
});
export const planIdOf = (plan) => sha256(JSON.stringify(plan)).slice(0, 12);

// Probe targets.
export const PROBE = Object.freeze({
  competitionRead: 'get_tournament_fixture_context',
  competitionGranted: 'publish_tournament_fixture',
  serviceOnly: 'archive_tournament_fixture',
  kept: 'lock_tournament_roster',
  commerce: 'get_tournament_purchase',
  staging: 'get_my_tournament_memberships',
  publicRpc: 'get_public_tournament_page',
});
