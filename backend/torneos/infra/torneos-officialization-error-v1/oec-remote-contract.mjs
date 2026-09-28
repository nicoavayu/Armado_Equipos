// OFFICIALIZATION-V1 + ERROR-CONTRACT-V1 REMOTE — every pin of the Production rollout of migrations 0005 and 0006 and of
// the gateway revision that serves them.
//
//   G1   read-only   Torneos Production DB state (psql READ ONLY as the installer, Keychain password), Deno Deploy
//                    observation (app, revisions, env names/flags), public + bridge-token gateway probes.
//   W1   one write   psql: 00000000000005_officialization_v1.sql, the certified bytes, ONE transaction.   POST_0004 → POST_0005
//   W2   one write   psql: 00000000000006_domain_error_contract.sql, the certified bytes, ONE transaction. POST_0005 → POST_0006
//   W3   one write   Deno Deploy: one production revision of the candidate gateway source (assets + labels only).
//   rollback        W3 → redeploy of the live COMPETITION-V1 source (ee34b2a7, digest 75e3535a…); W2 → the 0006 rollback
//                   script (18 POST_0005 bodies); W1 → the 0005 rollback script (3 POST_0004 bodies, 9 RPCs dropped;
//                   column / table / capability row / memberships / audit kept). Order: W3 → W2 → W1, never another.
//
// STATE MACHINE (fail closed; anything that is not exactly one of these is DRIFT and every write refuses it):
//
//   POST_0004         162 / 12; column, invitations table, capability row and the 9 RPCs absent; the 3 bodies 0005 replaces
//                     at their POST_0004 md5; the 17 of the 18 error-contract bodies that exist at their POST_0005 md5.
//   POST_0005         171 / 12; every 0005 object present and exactly shaped; the 3 bodies at their 0005 md5; the 18 at POST_0005.
//   POST_0006         POST_0005 + the 18 at their ERROR-CONTRACT-V1 md5 (no function raises 40001).
//   ROLLED_BACK_0005  what the 0005 rollback leaves: 162 / 12, the 9 RPCs absent, the 3 bodies at POST_0004, column + table +
//                     capability row kept. Terminal: 0005's own precondition refuses a re-apply from here (a forward fix is a
//                     new certified phase), and so does this tooling.
//
//   W1 (0005)  only from POST_0004.  From POST_0006 it is refused ALWAYS: 0005's precondition accepts its own post-state
//              (re-apply = no-op) and would therefore silently put set_tournament_match_dual_control back to its POST_0005
//              body (a partial 0006). From POST_0005 it is refused as useless; from ROLLED_BACK_0005 as impossible.
//   W2 (0006)  only from POST_0005.
//   W3         only from POST_0006, with the gateway on the live COMPETITION-V1 source.
//   W1 rollback only from POST_0005 (on POST_0006 the 0005 rollback would DROP a function 0006 replaced → partial 0006).
//
// Nothing here is an argument: refs, hosts, files, hashes, function sets, counts and phrases are pins. No credential lives in
// this directory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CV1 from '../torneos-competition-v1/competition-remote-contract.mjs';
import { assertReadOnlySql } from '../torneos-foundation/foundation-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = CV1.REPO_ROOT;
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const readJson = CV1.readJson;
export const EVIDENCE_DIR = path.join(REPO_ROOT, 'backend/torneos/officialization-v1/evidence/remote');
export const DELTA_PIN_FILE = path.join(HERE, 'pins/oec-db-delta.json');
export const CANDIDATE_PIN_FILE = path.join(HERE, 'pins/oec-gateway-candidate.json');
export const DEPLOYED_PIN_FILE = path.join(HERE, 'pins/oec-gateway-deploy.json');
/** The live gateway revision, as written by the COMPETITION-V1 W2 (public facts only). */
export const LIVE_DEPLOY_PIN_FILE = path.join(REPO_ROOT, 'backend/torneos/infra/torneos-competition-v1/pins/competition-v1-gateway-deploy.json');

// ─────────────────────────── target (inherited, unchanged) ───────────────────────────
export const { TORNEOS_REF, POOLER_HOST, POOLER_PORT, INSTALLER, KEYCHAIN_INSTALLER, SERVER_ROLES, APP_SLUG, GATEWAY_BASE, DENO_CERTIFIED: DENO_CERTIFIED_CV1 } = CV1;
if (TORNEOS_REF !== 'onzpwnqxnvlgsevivngf') throw new Error('torneos_ref_pin');

// ─────────────────────────── migrations ───────────────────────────
const MIG_DIR = 'backend/torneos/supabase/migrations';
/** 0000–0004 exactly as certified and applied in Production (INFRA-1 + COMPETITION-V1 W1). */
export const APPLIED = Object.freeze([
  Object.freeze({ seq: '0000', file: `${MIG_DIR}/00000000000000_torneos_baseline_v1.sql`, sha256: 'f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f' }),
  Object.freeze({ seq: '0001', file: `${MIG_DIR}/00000000000001_staging_v1_rpc_exposure.sql`, sha256: '3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62' }),
  Object.freeze({ seq: '0002', file: `${MIG_DIR}/00000000000002_mercadopago_checkout_pro_test.sql`, sha256: '06378f12b57620e8ae550a0d881ad66464ffdc0a734ad621cba8a6ba3e6d6078' }),
  Object.freeze({ seq: '0003', file: `${MIG_DIR}/00000000000003_mercadopago_provider_ordering.sql`, sha256: 'd54b3293da53aea1202d3daed9a70e45d86e306a56a1fdd58107fc5719e36714' }),
  Object.freeze({ seq: '0004', file: `${MIG_DIR}/00000000000004_competition_v1_rpc_exposure.sql`, sha256: '36e45eddf57690470d80a0284f454a74ebfe4135cf89cbc0f4274ffdf41e3729' }),
]);
export const M0005 = Object.freeze({ seq: '0005', file: `${MIG_DIR}/00000000000005_officialization_v1.sql`, sha256: '51fe200f2124e786345a85e5dbadfc844765db550a7f8cc837adefbddf0aeb78' });
export const M0006 = Object.freeze({ seq: '0006', file: `${MIG_DIR}/00000000000006_domain_error_contract.sql`, sha256: '767d57e8fb96ca69cd9d3b9379c0c3135652c8cb7bc07d83d81d1d815e0f3cc3' });
export const R0005 = Object.freeze({ file: 'backend/torneos/officialization-v1/rollback/00000000000005_officialization_v1.rollback.sql', sha256: '3dc0776b18842a29f92aaa479fefce0806083a5e1750e29e65bae4cb6bb8e33a' });
export const R0006 = Object.freeze({ file: 'backend/torneos/error-contract-v1/rollback/00000000000006_domain_error_contract.rollback.sql', sha256: '30c15af17f952cc4b341c54168f6b01ee0a37066fe1d5a8f81fe4cfe4ac80f1b' });
if (APPLIED[4].sha256 !== CV1.MIGRATION.sha256) throw new Error('oec_0004_pin_differs_from_competition_v1');

export function assertFileHash(rel, expected) {
  const bytes = fs.readFileSync(path.join(REPO_ROOT, rel));
  const got = sha256(bytes);
  if (got !== expected) throw new Error(`file_hash_mismatch ${rel} ${got.slice(0, 12)}`);
  return bytes;
}
/** Every migration and rollback file this tooling can touch, re-hashed (migration drift = refusal). */
export function migrationDrift() {
  const out = [];
  for (const m of [...APPLIED, M0005, M0006, R0005, R0006]) {
    try { assertFileHash(m.file, m.sha256); } catch (e) { out.push(String(e.message)); }
  }
  const dir = path.join(REPO_ROOT, MIG_DIR);
  const listed = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const known = [...APPLIED, M0005, M0006].map((m) => path.basename(m.file)).sort();
  if (JSON.stringify(listed) !== JSON.stringify(known)) out.push(`migrations_dir_set ${listed.join(',')}`);
  return out;
}

// ─────────────────────────── contracts (single sources of truth) ───────────────────────────
const off = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'backend/torneos/officialization-v1/contract.json'), 'utf8'));
const ec = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'backend/torneos/error-contract-v1/contract.json'), 'utf8'));
const q = (s) => (s.includes('.') ? s : `public.${s}`);
/** COMPETITION-V1 sets (POST_0004), schema-qualified. */
export const GRANTED_0004 = Object.freeze(CV1.GRANTED.map(q));
export const CLOSED = Object.freeze([...CV1.KEPT_REVOKED, ...CV1.SERVICE_ONLY].map(q));
export const FIXED_ONLY_0004 = Object.freeze(CV1.FIXED_ONLY.map(q));
export const FIX_AFTER = Object.freeze(Object.fromEntries(CV1.FIXES.map((f) => [q(f.fn), f.after])));
/** OFFICIALIZATION-V1 (0005). */
export const NEW_0005 = Object.freeze(off.acl.new_functions.map(q));
export const REPLACED_0005 = Object.freeze(off.acl.replaced_bodies.map((r) => Object.freeze({ fn: r.function, before: r.md5_before, after: r.md5_after })));
export const COUNTS = Object.freeze({ post0004: off.acl.authenticated_public_before, post0005: off.acl.authenticated_public_after, anon: off.acl.anon_public });
export const INVITATIONS_TABLE = 'public.tournament_organization_invitations';
export const CAPABILITY = Object.freeze({ role: 'owner', capability: 'match_operations.configure_dual_control' });
/** ERROR-CONTRACT-V1 (0006): 18 functions, md5(prosrc) POST_0005 → POST_0006. */
export const EC_PINS = Object.freeze(ec.migration.pins.map((p) => Object.freeze({ fn: p.function, before: p.md5_before, after: p.md5_after })));
export const EC_HTTP = Object.freeze({ ...ec.http });
export const EC_RAISES = Object.freeze(ec.changes.flatMap((c) => c.raises.map((r) => Object.freeze({ fn: c.function, message: r.message, from: r.from, count: r.count }))));
export const DUAL_CONTROL_FN = 'public.set_tournament_match_dual_control(uuid,uuid,boolean)';

// Shape guards (a wrong contract can never certify a wrong database).
if (GRANTED_0004.length !== 15 || CLOSED.length !== 23 || FIXED_ONLY_0004.length !== 1) throw new Error('oec_cv1_shape');
if (JSON.stringify([...CLOSED].sort()) !== JSON.stringify(off.acl.still_closed.map(q).sort())) throw new Error('oec_closed_set_differs_from_officialization_contract');
if (NEW_0005.length !== 9 || REPLACED_0005.length !== 3 || COUNTS.post0005 - COUNTS.post0004 !== 9 || COUNTS.post0004 !== CV1.COUNTS.authenticatedAfter || COUNTS.anon !== 12) throw new Error('oec_0005_shape');
if (EC_PINS.length !== 18 || EC_RAISES.reduce((n, r) => n + r.count, 0) !== 23) throw new Error('oec_0006_shape');
if (ec.migration.sha256 !== M0006.sha256 || ec.migration.rollback_sha256 !== R0006.sha256 || ec.migration.untouched_migrations['00000000000005_officialization_v1.sql'] !== M0005.sha256) throw new Error('oec_0006_contract_pins');
if (!EC_PINS.some((p) => p.fn === DUAL_CONTROL_FN) || !NEW_0005.includes(DUAL_CONTROL_FN)) throw new Error('oec_0006_depends_on_0005');
for (const [f, h] of Object.entries(off.untouched_migrations)) if (APPLIED.find((m) => m.file.endsWith(f))?.sha256 !== h) throw new Error(`oec_untouched_${f}`);
if (EC_RAISES.some((r) => r.message === undefined) || Object.values(EC_HTTP).some((s) => ![409, 422, 429].includes(s))) throw new Error('oec_ec_http');
/** Out-of-scope domains: none of the 18 may belong to commerce, media or the auth bridge. */
export const OUT_OF_SCOPE = /purchase|payment|checkout|entitlement|media|portrait|photo|social_export|identity|token|bridge|subscription/;
if (EC_PINS.some((p) => OUT_OF_SCOPE.test(p.fn)) || NEW_0005.some((s) => /purchase|payment|media|portrait/.test(s))) throw new Error('oec_scope');

/** Every signature the state query reports on (a function can be in several sets). */
export const ALL_SIGS = Object.freeze([...new Set([...GRANTED_0004, ...CLOSED, ...FIXED_ONLY_0004, ...NEW_0005, ...REPLACED_0005.map((r) => r.fn), ...EC_PINS.map((p) => p.fn)])].sort());

// ─────────────────────────── read-only state SQL ───────────────────────────
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const has = (role, oid) => `has_function_privilege(${lit(role)}, ${oid}, 'EXECUTE')`;
/**
 * One SELECT (no side effect, no write verb): per function its existence, grants, owner, definer, search_path, ACL
 * grantees and body md5; the 0005 schema objects (column, invitations table + RLS + privileges, capability row); counts;
 * the error-contract sweep (functions raising 40001 / PTxyz); informational data counts (membership rows are never
 * deleted by any step). Runs inside BEGIN READ ONLY … ROLLBACK with default_transaction_read_only=on.
 */
export const STATE_SQL = `with
 wanted(sig) as (values ${ALL_SIGS.map((s) => `(${lit(s)})`).join(',')}),
 fns as (select w.sig, p.oid, p.prosecdef, p.proconfig, p.proowner, p.proacl, md5(p.prosrc) as body from wanted w left join pg_proc p on p.oid = to_regprocedure(w.sig)),
 pub as (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 src as (select p.oid, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')),
 inv as (select to_regclass(${lit(INVITATIONS_TABLE)}) as oid)
select json_build_object(
 'server_version', current_setting('server_version'),
 'read_only', current_setting('transaction_read_only'),
 'current_user', current_user,
 'functions', (select json_agg(json_build_object('sig', f.sig, 'exists', f.oid is not null,
    'anon', f.oid is not null and ${has('anon', 'f.oid')}, 'authenticated', f.oid is not null and ${has('authenticated', 'f.oid')},
    'service_role', f.oid is not null and ${has('service_role', 'f.oid')},
    'public', f.oid is not null and exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'),
    'server_roles', (select coalesce(json_agg(r.rolname order by r.rolname), '[]'::json) from pg_roles r where f.oid is not null and r.rolname in (${SERVER_ROLES.map(lit).join(',')}) and has_function_privilege(r.oid, f.oid, 'EXECUTE')),
    'grantees', (select coalesce(json_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), '[]'::json) from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where f.oid is not null and a.privilege_type = 'EXECUTE'),
    'definer', f.prosecdef, 'search_path_pinned', coalesce(f.proconfig @> array['search_path=""'], false),
    'owner', case when f.oid is null then null else pg_get_userbyid(f.proowner) end,
    'body_md5', f.body) order by f.sig) from fns f),
 'column', (select json_build_object('exists', count(*) = 1, 'data_type', max(data_type), 'is_nullable', max(is_nullable), 'column_default', max(column_default)) from information_schema.columns where table_schema = 'public' and table_name = 'tournaments' and column_name = 'match_result_dual_control_enabled'),
 'invitations', (select json_build_object('exists', i.oid is not null,
    'owner', (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = i.oid),
    'rls', (select c.relrowsecurity from pg_class c where c.oid = i.oid),
    'policies', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tournament_organization_invitations'),
    'client_privileges', (select coalesce(json_agg(r || ':' || pr order by r, pr), '[]'::json) from unnest(array['anon','authenticated','service_role','PUBLIC']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr where i.oid is not null and r <> 'PUBLIC' and has_table_privilege(r, i.oid, pr)),
    'public_acl', (select coalesce(json_agg(a.privilege_type order by a.privilege_type), '[]'::json) from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = i.oid and a.grantee = 0)) from inv i),
 'capability', (select coalesce(json_agg(role order by role), '[]'::json) from public.tournament_organization_role_capabilities where capability = ${lit(CAPABILITY.capability)}),
 'authorize_core_contract', json_build_object('authenticated', ${has('authenticated', "'private.authorize_core_contract(text,jsonb)'::regprocedure")}, 'anon', ${has('anon', "'private.authorize_core_contract(text,jsonb)'::regprocedure")},
    'core_adapter', exists (select 1 from pg_roles where rolname = 'torneos_core_adapter') and ${has('torneos_core_adapter', "'private.authorize_core_contract(text,jsonb)'::regprocedure")}),
 'counts', json_build_object('authenticated_public', (select count(*) from pub p where ${has('authenticated', 'p.oid')}), 'anon_public', (select count(*) from pub p where ${has('anon', 'p.oid')})),
 'error_sweep', json_build_object('raises_40001', (select count(*) from src where prosrc ~* 'errcode\\s*=\\s*''40001'''), 'raises_ptxyz', (select count(*) from src where prosrc ~* 'errcode\\s*=\\s*''PT[0-9]{3}''')),
 'data', json_build_object('organization_members', (select count(*) from public.tournament_organization_members)),
 'ledger', to_regclass('supabase_migrations.schema_migrations') is not null,
 'role_settings', (select json_object_agg(rolname, coalesce(rolconfig, array[]::text[])) from pg_roles where rolname in ('anon', 'authenticated', 'authenticator'))
)`;
assertReadOnlySql(STATE_SQL);
export const readOnlyScript = CV1.readOnlyScript;

// ─────────────────────────── classifier ───────────────────────────
const md5Of = (s, sig) => s.functions.find((x) => x.sig === sig)?.body_md5 ?? null;
const fnOf = (s, sig) => s.functions.find((x) => x.sig === sig) ?? null;
/** The private Core-contract authorizer: executable by torneos_core_adapter only (checked apart from the RPC invariants). */
export const AUTHORIZER = 'private.authorize_core_contract(text,jsonb)';
/** Shape of the per-function attribute pin (derived by the rehearsal; equal in every state where the function exists). */
export const attrsOf = (x) => ({ grantees: x.grantees, definer: x.definer, search_path_pinned: x.search_path_pinned, owner: x.owner });

/**
 * @param s    STATE_SQL result
 * @param pin  pins/oec-db-delta.json: `new_function_bodies` (md5 of the 9 RPCs as 0005 creates them — set_tournament_match_
 *             dual_control's POST_0006 md5 comes from EC_PINS) and `function_attrs` (grantees / definer / search_path /
 *             owner of all ALL_SIGS, identical in every state: no step changes a grant, an owner or a definer).
 * Returns { state, failures, summary }: state ∈ POST_0004 | POST_0005 | POST_0006 | ROLLED_BACK_0005 | DRIFT.
 */
export function classifyState(s, pin) {
  const f = [];
  if (!s || !Array.isArray(s.functions)) return { state: 'DRIFT', failures: ['state_unreadable'] };
  const bodies = pin?.new_function_bodies; const attrs = pin?.function_attrs;
  if (!bodies || Object.keys(bodies).length !== 9 || NEW_0005.some((sig) => !/^[0-9a-f]{32}$/.test(bodies[sig] ?? ''))) return { state: 'DRIFT', failures: ['new_function_body_pins_missing'] };
  if (bodies[DUAL_CONTROL_FN] !== EC_PINS.find((p) => p.fn === DUAL_CONTROL_FN).before) return { state: 'DRIFT', failures: ['new_function_body_pins_disagree_with_0006'] };
  if (!attrs || JSON.stringify(Object.keys(attrs).sort()) !== JSON.stringify([...ALL_SIGS])) return { state: 'DRIFT', failures: ['function_attr_pins_missing'] };
  if (s.read_only !== 'on') f.push('session_not_read_only');
  if (JSON.stringify(s.functions.map((x) => x.sig).sort()) !== JSON.stringify([...ALL_SIGS])) f.push('function_set_mismatch');
  // Invariants that hold in EVERY state: owner, no anon / PUBLIC, no server role on an RPC, exact per-function attributes
  // (an unexpected grant, owner or definer change is DRIFT), the 23 closed stay closed, 0004 stays in force.
  for (const x of s.functions) {
    if (!x.exists) continue;
    if (x.owner !== INSTALLER) f.push(`owner_not_installer ${x.sig}`);
    if (x.anon) f.push(`anon_executes ${x.sig}`);
    if (x.public) f.push(`public_executes ${x.sig}`);
    if (x.sig !== AUTHORIZER && x.server_roles?.length) f.push(`server_role_executes ${x.sig}`);
    if (JSON.stringify(attrsOf(x)) !== JSON.stringify(attrs[x.sig])) f.push(`function_attrs ${x.sig} ${JSON.stringify(x.grantees)}`);
  }
  for (const sig of [...GRANTED_0004, ...CLOSED, ...FIXED_ONLY_0004, AUTHORIZER]) if (!fnOf(s, sig)?.exists) f.push(`missing ${sig}`);
  for (const sig of CLOSED) if (fnOf(s, sig)?.authenticated) f.push(`closed_function_open ${sig}`);
  for (const sig of [...GRANTED_0004, ...FIXED_ONLY_0004]) {
    const x = fnOf(s, sig);
    if (x?.exists && (!x.authenticated || !x.definer || !x.search_path_pinned)) f.push(`competition_v1_not_in_force ${sig}`);
  }
  for (const [sig, after] of Object.entries(FIX_AFTER)) if (fnOf(s, sig)?.exists && md5Of(s, sig) !== after) f.push(`competition_v1_fix_body ${sig}`);
  const aac = s.authorize_core_contract ?? {};
  if (aac.authenticated || aac.anon || !aac.core_adapter || JSON.stringify(fnOf(s, AUTHORIZER)?.server_roles ?? null) !== '["torneos_core_adapter"]') f.push('authorize_core_contract_acl');
  if (Number(s.counts?.anon_public) !== COUNTS.anon) f.push(`anon_count_${s.counts?.anon_public}`);
  if (s.invitations?.exists) {
    if (s.invitations.owner !== INSTALLER || s.invitations.rls !== true || Number(s.invitations.policies) !== 0 || (s.invitations.client_privileges ?? []).length || (s.invitations.public_acl ?? []).length) f.push('invitations_table_shape');
  }
  if (s.column?.exists && (s.column.data_type !== 'boolean' || s.column.is_nullable !== 'NO' || s.column.column_default !== 'false')) f.push('dual_control_column_shape');
  const cap = JSON.stringify(s.capability ?? null);
  if (cap !== '[]' && cap !== '["owner"]') f.push(`capability_rows ${cap}`);
  if (f.length) return { state: 'DRIFT', failures: f };

  const newPresent = NEW_0005.filter((sig) => fnOf(s, sig)?.exists);
  const auth = Number(s.counts?.authenticated_public);
  const replaced = REPLACED_0005.map((r) => md5Of(s, r.fn));
  const repBefore = REPLACED_0005.every((r, i) => replaced[i] === r.before);
  const repAfter = REPLACED_0005.every((r, i) => replaced[i] === r.after);
  const ecExisting = EC_PINS.filter((p) => fnOf(s, p.fn)?.exists);
  const ecBefore = ecExisting.filter((p) => md5Of(s, p.fn) === p.before).length;
  const ecAfter = ecExisting.filter((p) => md5Of(s, p.fn) === p.after).length;
  const newBodies = (which) => NEW_0005.every((sig) => md5Of(s, sig) === (sig === DUAL_CONTROL_FN && which === 'post0006' ? EC_PINS.find((p) => p.fn === sig).after : bodies[sig]));
  const col = !!s.column?.exists; const tab = !!s.invitations?.exists; const capOn = cap === '["owner"]';
  const sweep40001 = Number(s.error_sweep?.raises_40001);
  const summary = `new ${newPresent.length}/9, replaced ${repBefore ? 'POST_0004' : repAfter ? '0005' : 'other'}, 0006 bodies ${ecAfter}/${ecExisting.length} (POST_0005 ${ecBefore}), column ${col}, table ${tab}, capability ${capOn}, authenticated ${auth}, 40001 raisers ${sweep40001}`;

  const base4 = newPresent.length === 0 && repBefore && ecExisting.length === 17 && ecBefore === 17 && auth === COUNTS.post0004 && sweep40001 === 3;
  if (!col && !tab && !capOn && base4) return { state: 'POST_0004', failures: [], summary };
  if (col && tab && capOn && base4) return { state: 'ROLLED_BACK_0005', failures: [], summary };
  if (col && tab && capOn && newPresent.length === 9 && repAfter && ecExisting.length === 18 && auth === COUNTS.post0005) {
    if (ecBefore === 18 && newBodies('post0005') && sweep40001 === 3) return { state: 'POST_0005', failures: [], summary };
    if (ecAfter === 18 && newBodies('post0006') && sweep40001 === 0) return { state: 'POST_0006', failures: [], summary };
  }
  return { state: 'DRIFT', failures: [`partial_or_unknown: ${summary}`], summary };
}

/**
 * Catalog paths (foundation CATALOG_SQL) that 0005 / 0006 (and 0004 before them) move. Every other strict path of the
 * foundation pin + the gateway / payments delta pins stays exactly as certified; these are pinned per state in
 * pins/oec-db-delta.json (derived by offline-rehearsal.mjs on the same image family, installer postgres). The rehearsal
 * refuses to write a pin if any other strict path moved.
 */
export const OEC_CATALOG_PATHS = Object.freeze(['execute', 'functions.bodies_md5', 'acl_md5', 'functions.public', 'functions.definer', 'functions.signatures_md5', 'tables.public_tables', 'tables.names_md5']);
if (!CV1.CV1_CATALOG_PATHS.every((p) => OEC_CATALOG_PATHS.includes(p))) throw new Error('oec_paths_must_include_cv1');
export const STATE_KEYS = Object.freeze({ POST_0004: 'post_0004', POST_0005: 'post_0005', POST_0006: 'post_0006', ROLLED_BACK_0005: 'rolled_back_0005' });

// ─────────────────────────── gateway ───────────────────────────
/** The live revision (COMPETITION-V1 W2, 2026-09-27) and its source, as pinned by that tooling (public facts only). */
export const LIVE = Object.freeze({ revision: '66we8r12079d', head: 'ee34b2a79008692178b6dbb42530aca5947d7027', digest: '75e3535acc3fba99c871ee820d1927e1c695eba4c10044ec4e6ffda38b59afc7', files: 16,
  created_at: '2026-09-27T16:44:56.254Z', previous_revision: '3rvq2wx9tyyg' });
export const readLiveDeployPin = () => JSON.parse(fs.readFileSync(LIVE_DEPLOY_PIN_FILE, 'utf8'));
{
  const p = readLiveDeployPin();
  if (p.revision !== LIVE.revision || p.previous_revision !== LIVE.previous_revision || p.source.head !== LIVE.head || p.source.digest !== LIVE.digest || p.source.files.length !== LIVE.files) throw new Error('live_deploy_pin_mismatch');
}
/** Env of the app: names + secret flags + non-secret value digests (13), exactly the live pin. No step sends env. */
export const ENV_SHAPE = Object.freeze(readLiveDeployPin().env.map((e) => Object.freeze({ key: e.key, secret: e.secret })));
/** The Deno organization/app as certified by COMPETITION-V1 W2 (evidence cv1-01-w2-20260927T164533Z). */
export const DENO_CERTIFIED = Object.freeze({
  evidence: 'backend/torneos/competition-v1/evidence/remote/cv1-01-w2-20260927T164533Z.json',
  org_apps: DENO_CERTIFIED_CV1.org_apps, org_layers: 0,
  app: Object.freeze({ id: DENO_CERTIFIED_CV1.app.id, created_at: DENO_CERTIFIED_CV1.app.created_at, config: DENO_CERTIFIED_CV1.app.config, labels: DENO_CERTIFIED_CV1.app.labels,
    // No configuration / env change after the live revision was created (the deploy itself may move updated_at).
    updated_at_not_after: '2026-09-27T16:46:00.000Z' }),
  revisions: Object.freeze([LIVE.revision, ...DENO_CERTIFIED_CV1.revisions]),
  current: Object.freeze({ id: LIVE.revision, created_at: LIVE.created_at }),
  production_domain: DENO_CERTIFIED_CV1.production_domain,
});

/** The 9 officialization RPCs on the generic authenticated route; none on the public route. */
export const OFFICIALIZATION_RPCS = Object.freeze(NEW_0005.map((s) => s.replace(/^public\./, '').replace(/\(.*$/, '')));
export const PROBE = CV1.PROBE;

// ─────────────────────────── phrases / plan ids ───────────────────────────
export const PHRASES = Object.freeze({
  w1: (id) => `APPLY TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 ${TORNEOS_REF} ${id}`,
  w2: (id) => `APPLY TORNEOS MIGRATION 0006 ERROR-CONTRACT-V1 ${TORNEOS_REF} ${id}`,
  w3: (id) => `DEPLOY TORNEOS GATEWAY OFFICIALIZATION-ERROR-CONTRACT ${APP_SLUG} ${id}`,
  w3Rollback: (id) => `ROLLBACK TORNEOS GATEWAY ${APP_SLUG} TO ${LIVE.head.slice(0, 8)} ${id}`,
  w2Rollback: (id) => `ROLLBACK TORNEOS MIGRATION 0006 ERROR-CONTRACT-V1 ${TORNEOS_REF} ${id}`,
  w1Rollback: (id) => `ROLLBACK TORNEOS MIGRATION 0005 OFFICIALIZATION-V1 ${TORNEOS_REF} ${id}`,
});
export const planIdOf = (plan) => sha256(JSON.stringify(plan)).slice(0, 12);
const transport = `psql ${POOLER_HOST}:${POOLER_PORT} ${INSTALLER}.${TORNEOS_REF} verify-full`;
/** Plans are pure functions of pins + the observed state (no clock, no git HEAD): their ids are known before the run. */
export const PLANS = Object.freeze({
  w1: ({ counts }) => ({ step: 'W1', target: TORNEOS_REF, file: M0005.file, sha256: M0005.sha256, transport, state_before: 'POST_0004', state_after: 'POST_0005', counts_before: counts,
    counts_after: { authenticated_public: COUNTS.post0005, anon_public: COUNTS.anon }, effect: 'column + invitations table (RLS, no client privilege) + owner capability row + 3 CREATE OR REPLACE (pinned bodies) + 9 RPCs (authenticated + service_role), one transaction' }),
  w2: ({ counts }) => ({ step: 'W2', target: TORNEOS_REF, file: M0006.file, sha256: M0006.sha256, transport, state_before: 'POST_0005', state_after: 'POST_0006', counts_before: counts,
    counts_after: { authenticated_public: COUNTS.post0005, anon_public: COUNTS.anon }, effect: '18 CREATE OR REPLACE FUNCTION changing only 23 errcode literals → PT409/PT422/PT429; no grant/owner/RLS change; one transaction' }),
  w2Rollback: ({ counts, gateway }) => ({ step: 'W2-rollback', target: TORNEOS_REF, file: R0006.file, sha256: R0006.sha256, transport, state_before: 'POST_0006', state_after: 'POST_0005', counts_before: counts, gateway_source: gateway,
    effect: '18 bodies back to their POST_0005 md5 (the domain 40001 storm returns); nothing else' }),
  w1Rollback: ({ counts, gateway }) => ({ step: 'W1-rollback', target: TORNEOS_REF, file: R0005.file, sha256: R0005.sha256, transport, state_before: 'POST_0005', state_after: 'ROLLED_BACK_0005', counts_before: counts, gateway_source: gateway,
    effect: '3 bodies back to POST_0004, 9 RPCs dropped (171 → 162); column, invitations table, capability row, memberships and audit kept; no data deleted' }),
  deploy: ({ which, previousRevision, source, env }) => ({ step: which === 'candidate' ? 'W3' : 'W3-rollback', app: APP_SLUG, previous_revision: previousRevision,
    source: { digest: source.digest, files: source.manifest.map((m) => m.path) }, env: 'unchanged (not in the request)', env_now: env, timelines: { production: true, preview: false } }),
});
