#!/usr/bin/env node
// ACCOUNT ERASURE 0021 operator driver for the Torneos Production DB. PREPARED ONLY: it is unit-tested offline and
// rehearsed on the local lab (db-0021.test.mjs); it is never run against a remote without Nico's explicit GO.
// Same transport and discipline as sponsors-v1/remote/db-0020.mjs and media-store-v1/remote/db-0017.mjs:
//   node backend/torneos/account-deletion-v1/remote/db-0021.mjs observe                                     (read only)
//   node backend/torneos/account-deletion-v1/remote/db-0021.mjs apply-0021    APPLY TORNEOS 0021 <ref> <sha12 of 0021>
//   node backend/torneos/account-deletion-v1/remote/db-0021.mjs rollback-0021 ROLLBACK TORNEOS 0021 <ref> <sha12 of its rollback>
//   node backend/torneos/account-deletion-v1/remote/db-0021.mjs rollback-0021 ROLLBACK TORNEOS 0021 <ref> <sha12> DISCARD ERASURE LEDGER
//     (the only way to roll back once an erasure ran: the file itself refuses otherwise; anonymised data is NOT restored)
// Transport = the certified OEC/CV1 one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + Supabase
// CA, the installer password read from the macOS Keychain into memory only and redacted from every output). Every write
// is gated by the exact phrase, the file sha256, the exact observed state before (PRE_0021 → POST_0021 and back) and
// after, and "nothing else moved": every other function (body, ACL, owner, secdef flag, config), every relation, policy
// and user trigger of public / private / storage. The EXECUTE counts of anon and authenticated never move (0021 grants
// only to its own role torneos_erasure_writer, whose every privilege is pinned by name in POST_0021). Every body 0021
// installs is pinned by md5 in POST_0021. Works with or without 0020 and/or 0022.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, from, to) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, from, to, phase: '0021' });
export const FILES = Object.freeze({
  'apply-0021': file('backend/torneos/supabase/migrations/00000000000021_account_erasure.sql',
    '56d0b35454a153743da64baa7457d88270354c0d0fd0332a5c55c092047515b5', 'PRE_0021', 'POST_0021'),
  'rollback-0021': file('backend/torneos/account-deletion-v1/rollback/00000000000021_account_erasure.rollback.sql',
    '4c95d97bd843246f32f631b2f1fcfeb0c291855544fb786baa5b89867efd27f2', 'POST_0021', 'PRE_0021'),
});
/** The session setting the rollback file honours to discard the erasure ledger (see its header). */
export const FORCE_WORDS = 'DISCARD ERASURE LEDGER';
export const FORCE_SQL = `SET torneos.account_erasure_rollback_force = '${FORCE_WORDS}';\n`;
/** md5(prosrc): POST_0021 = the exact text between the dollar quotes of the migration. */
export const BODIES = Object.freeze({
  PRE_0021: Object.freeze({ erase: null, confirm: null, label: null }),
  POST_0021: Object.freeze({ erase: '899dae4c18cffa2de32ad9a66e742a92', confirm: 'a26bcb671dea01fc83e0f6d41b5bc051', label: '588ebb88ffb2e70b96a3aaca06367cf0' }),
});
// Key order = the catalog's json_build_object order (compared as JSON).
const fn = (secdef, erasureWriter) => Object.freeze({ secdef, config: ['search_path=""'], owner_is_installer: true, erasure_writer: erasureWriter,
  core_adapter: false, identity_writer: false, authenticated: false, anon: false, service_role: false });
export const ACL = Object.freeze({
  PRE_0021: Object.freeze({ erase: null, confirm: null, label: null }),
  POST_0021: Object.freeze({ erase: fn(true, true), confirm: fn(true, true), label: fn(false, false) }),
});
/** The erasure role, whole: no login, no inheritance, no attribute, member of nothing; USAGE on private and EXECUTE on the
 *  two erasure functions, and not one other grant in public / private / storage. */
export const ERASURE_ROLE = Object.freeze({
  PRE_0021: null,
  POST_0021: Object.freeze({ login: false, inherit: false, attributes: false, member_of: 0, schemas: Object.freeze(['private']),
    functions: Object.freeze(['private.confirm_tournament_account_erasure(uuid,uuid)', 'private.erase_tournament_account(uuid,uuid)']), relations: 0 }),
});
export const TABLE = Object.freeze({ PRE_0021: null, POST_0021: Object.freeze({ rls: true, force_rls: true, client_grants: false, policies: 0 }) });
/** The guard triggers the erasure toggles inside its transaction: present, enabled ('O'), on tables the installer owns. */
export const GUARDS = Object.freeze([
  ['public.torneos_identity', 'torneos_identity_immutable'],
  ['public.tournament_match_availability_responses', 'tournament_match_availability_scope_guard'],
  ['public.tournament_match_operation_players', 'tournament_match_operation_players_completed_guard'],
  ['public.tournament_match_operation_players', 'tournament_match_operation_players_history_guard'],
  ['public.tournament_match_operation_players', 'tournament_operation_player_suspension_guard'],
  ['public.tournament_match_squad_players', 'tournament_match_squad_players_history_guard'],
  ['public.tournament_match_squad_players', 'tournament_match_squad_players_scope_guard'],
  ['public.tournament_match_squad_players', 'tournament_squad_player_suspension_guard'],
  ['public.tournament_organization_members', 'tournament_organization_members_protect_owner'],
].map(([rel, trigger]) => Object.freeze({ rel, trigger, enabled: 'O', owned_by_installer: true })));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** PRE_0021 | POST_0021 | DRIFT, with every reason. Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  const p = catalog.prerequisites ?? {};
  if (p.connected_v1 !== true) failures.push('connected_v1_0009_missing');
  if (p.core_adapter_role !== true) failures.push('torneos_core_adapter_missing');
  if (p.identity_trigger !== true) failures.push('identity_trigger_missing');
  if (!same(p.guards, GUARDS)) failures.push(`guards ${JSON.stringify(p.guards)}`);
  if (typeof p.sponsors_0020 !== 'boolean') failures.push('sponsors_0020_unknown');
  const state = Object.entries(BODIES).find(([, pin]) => same(pin, catalog.bodies))?.[0];
  if (!state) return { state: 'DRIFT', failures: [...failures, `bodies ${JSON.stringify(catalog.bodies)}`] };
  for (const name of Object.keys(ACL[state])) {
    if (!same(catalog.acl?.[name] ?? null, ACL[state][name])) failures.push(`acl.${name} ${JSON.stringify(catalog.acl?.[name])}`);
  }
  if (!same(catalog.table ?? null, TABLE[state])) failures.push(`table ${JSON.stringify(catalog.table)}`);
  if (!same(catalog.erasure_role ?? null, ERASURE_ROLE[state])) failures.push(`erasure_role ${JSON.stringify(catalog.erasure_role)}`);
  if (state === 'PRE_0021' && catalog.erasure_role_logins?.length) failures.push('erasure_role_logins_without_role');
  if (state === 'PRE_0021' && catalog.rows != null) failures.push('rows_without_table');
  if (state === 'POST_0021' && !(Number.isInteger(catalog.rows) && catalog.rows >= 0)) failures.push(`rows ${catalog.rows}`);
  if (failures.length) return { state: 'DRIFT', failures };
  return { state, failures: [] };
}

/** What 0021 must not touch: the names of the sections that changed (EXECUTE counts of anon / authenticated: equal). */
export function changedOutside(before, after) {
  const moved = ['kept_fn', 'kept_relations', 'kept_policies', 'kept_triggers'].filter((key) => !same(before[key], after[key]));
  if (!same(before.counts, after.counts)) moved.push('counts');
  return moved;
}

export function phraseFor(mode, { force = false } = {}) {
  const f = FILES[mode];
  if (!f) throw new Error('usage: observe | apply-0021 | rollback-0021 <phrase>');
  if (force && mode !== 'rollback-0021') throw new Error('FORCE_ONLY_FOR_ROLLBACK');
  return `${mode.split('-')[0].toUpperCase()} TORNEOS ${f.phase} ${REF} ${f.sha256.slice(0, 12)}${force ? ` ${FORCE_WORDS}` : ''}`;
}

/** The whole operator decision, with injected I/O (tested offline with fakes and on the local lab as the installer). */
export async function run(mode, args, { readFile = fs.readFileSync, catalog, applySql }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  const force = mode === 'rollback-0021' && args.join(' ') === phraseFor(mode, { force: true });
  const phrase = phraseFor(mode);
  if (!force && args.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const f = FILES[mode];
  const bytes = readFile(f.path);
  if (sha256(bytes) !== f.sha256) throw new Error('FILE_HASH_MISMATCH');
  const before = await catalog();
  const pre = classify(before);
  if (pre.state === 'DRIFT' || pre.state !== f.from) throw new Error(`PRE_STATE_${pre.state} ${pre.failures.join('; ')}`);
  // Erasures already ran: without the explicit force phrase a rollback is refused before any write (the ledger is lost).
  if (mode === 'rollback-0021' && before.rows > 0 && !force) throw new Error(`ROLLBACK_REFUSED ${before.rows} ledger rows (force phrase required)`);
  out.forced = force;
  out.psql = await applySql(`${force ? FORCE_SQL : ''}${bytes.toString('utf8')}`);
  const after = await catalog();
  const post = classify(after);
  const moved = changedOutside(before, after);
  out.before = pre.state; out.after = post.state; out.changedOutside = moved;
  out.sponsors0020 = after.prerequisites?.sponsors_0020 ?? null;
  if (post.failures.length) out.failures = post.failures;
  const ok = out.psql.code === 0 && post.state === f.to && !moved.length;
  out.verdict = `${mode.toUpperCase().replace('-', '_')}_${ok ? 'DONE' : 'FAILED'}`;
  return out;
}

async function realDeps() {
  const infra = path.join(REPO, 'backend/torneos/infra');
  const C = await import(path.join(infra, 'torneos-officialization-error-v1/oec-remote-contract.mjs'));
  const CV1 = await import(path.join(infra, 'torneos-competition-v1/competition-remote.mjs'));
  const { runPsqlProbe } = await import(path.join(infra, 'torneos-payments-test/payments-db.mjs'));
  const { applySql } = await import(path.join(infra, 'torneos-gateway-auth/psql-gateway-auth.mjs'));
  const { systemKeychain } = await import(path.join(infra, 'torneos-gateway-auth/keychain-gateway-auth.mjs'));
  if (C.TORNEOS_REF !== REF) throw new Error('REF_MISMATCH');
  let password = null;
  const secret = () => password ?? (password = systemKeychain().dataplane.read());
  const redact = (s) => { let t = String(s ?? ''); if (password) t = t.split(password).join('[REDACTED]'); return t; };
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog-0021.sql'), 'utf8').trim();
  return {
    redact,
    wipe: () => { password = null; },
    catalog: async () => {
      const r = await runPsqlProbe({ script: C.readOnlyScript(sql), env: CV1.readOnlyEnv({ password: secret() }), redact });
      if (r.code !== 0) throw new Error(`CATALOG_READ_FAILED ${r.code} ${r.stderr_tail}`);
      const line = r.stdout.trim().split('\n').filter(Boolean).pop();
      if (!line) throw new Error(`CATALOG_READ_EMPTY ${r.stderr_tail ?? ''}`);
      return JSON.parse(line);
    },
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-account-erasure-0021' }), redact }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  const output = { at: new Date().toISOString(), transport: 'psql aws-0-sa-east-1.pooler.supabase.com:5432 verify-full' };
  let deps = null;
  try {
    deps = await realDeps();
    Object.assign(output, await run(mode, args, deps));
  } catch (error) {
    output.error = (deps?.redact ?? String)(error?.message ?? error).slice(0, 600);
  }
  deps?.wipe();
  process.stdout.write(`${JSON.stringify(output, null, 1)}\n`);
  process.exit(output.error || /FAILED/.test(output.verdict || '') ? 1 : 0);
}
