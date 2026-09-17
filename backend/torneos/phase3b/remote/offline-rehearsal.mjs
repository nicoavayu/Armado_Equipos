#!/usr/bin/env node
// Phase 3B — R3 OFFLINE REHEARSAL (decisions D + E, 2026-09-15): the exact apply documents and
// the exact pinned rollback SQL, executed against a THROWAWAY CLONE of the Phase 3A lab's Core
// database (public.ecr.aws/supabase/postgres 17.6, real Core schema + GoTrue auth schema), as the
// `postgres` role (the role /database/query writes with on the platform). Zero remote requests.
//
//   node backend/torneos/phase3b/remote/offline-rehearsal.mjs
//
// Phases (every one must pass): clone → hosted ledger shape → 9 CLI rows round-trip (null flags per
// row: created_by set on 20260810160355 only) → cli_rows_discrepancy_blocks (a flag flipped on either
// legacy row is one diff and a STOP verdict; restored → ok) → rollback_initial (the lab already has the contract) → apply (v1, v1.1: one transaction each,
// ledger row inside) → ledger (rows == pinned digests) → acl (CONTRACT_OBJECTS) → rerun_idempotent
// (a second apply aborts atomically; a missing ledger row is reconciled by the INSERT alone) →
// rollback (pinned SQL) → residue → catalog_unchanged (everything outside the contract identical
// before/after) → rollback re-run is a no-op. The clone is dropped at the end, always.
// Evidence: phase3b/evidence/r3-offline-rehearsal-<UTC>.json.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as C from './core-contract.mjs';
import { splitAndTrim } from './cli_parser.mjs';
import { ledgerState } from './mgmt-write.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const EVIDENCE = path.join(HERE, '../evidence');
const DOCKER = process.platform === 'darwin' ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
const CONTAINER = 'arma2-core-contracts-phase3a-core-db-1';
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const DB = `r3_offline_${STAMP.toLowerCase()}`;
const DUMP = `/tmp/${DB}.dump`;

function docker(args, input) {
  const r = spawnSync(DOCKER, ['--host', 'unix:///var/run/docker.sock', ...args], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const exec = (cmd, input) => docker(['exec', '-i', CONTAINER, 'bash', '-c', cmd], input);
function psql(sql, { db = DB, user = 'postgres', check = true } = {}) {
  const r = docker(['exec', '-i', CONTAINER, 'psql', '-U', user, '-d', db, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], sql);
  if (check && r.status !== 0) throw new Error(`psql failed: ${r.stderr.slice(0, 500)}`);
  return r;
}
const one = (sql, opts) => JSON.parse(psql(`${sql};`, opts).stdout.trim());
const installed = (m) => rows(m.probe)[0]?.installed === true;
const rows = (sql, opts) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`, opts).stdout.trim());
const phases = {};
const phase = (name, ok, detail) => { phases[name] = { ok: Boolean(ok), ...detail }; console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${name}${detail?.note ? ' — ' + detail.note : ''}`); if (!ok) throw new Error(`phase ${name} failed`); };
const RS = String.fromCharCode(30);
const md5 = (t) => crypto.createHash('md5').update(t, 'utf8').digest('hex');
const CATALOG_SQL = `select json_build_object('h', md5(string_agg(x, '|' order by x)), 'n', count(*)) from (select 'f:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(p.proacl::text, '') || ':' || p.prosecdef::text || ':' || pg_get_userbyid(p.proowner) as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app_private', 'auth') and p.proname not like 'torneos\\_contract\\_%' union all select 'r:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text || ':' || pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app_private', 'auth', 'supabase_migrations') and c.relname not like 'torneos\\_contract\\_%' union all select 's:' || nspname || ':' || coalesce(nspacl::text, '') from pg_namespace) q`;

const evidence = { generated_at: new Date().toISOString(), tool: 'phase3b/remote/offline-rehearsal.mjs', container: CONTAINER, clone_db: DB, remote_requests: 0, migrations: [], rollback_sql_sha256: null, phases, pass: false };
let created = false;
try {
  // 0. pins and lab container
  const rendered = C.renderAll(REPO);
  const rb = C.loadRollbackSql();
  evidence.migrations = rendered.map((m) => ({ version: m.version, sha256: m.migration_sha256, apply_sql_sha256: m.apply_sql_sha256, ledger_digest: m.row.statements_digest }));
  evidence.rollback_sql_sha256 = rb.sha256;
  const inspect = docker(['inspect', CONTAINER, '--format', '{{.State.Running}} {{.Config.Image}}']);
  if (inspect.status !== 0 || !inspect.stdout.startsWith('true ')) throw new Error('lab core-db container not running');
  evidence.image = inspect.stdout.trim().split(' ')[1];
  const src = one("select json_build_object('server_version', current_setting('server_version'), 'contract_installed', to_regprocedure('public.torneos_contract_execute(text,text,jsonb)') is not null, 'public_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'), 'has_ledger_schema', to_regnamespace('supabase_migrations') is not null)", { db: 'postgres' });
  evidence.source = src;
  phase('pins_and_lab', evidence.image.includes('supabase/postgres') && src.server_version.startsWith('17.'), { image: evidence.image, source: src });

  // 1. clone (pg_dump → pg_restore, pg_cron excluded: it can only live in the configured database)
  const cl = exec(`set -e; pg_dump -U supabase_admin -d postgres -Fc -f ${DUMP}; createdb -U supabase_admin -O postgres ${DB}; pg_restore -l ${DUMP} > ${DUMP}.list; grep -vi 'pg_cron\\|SCHEMA - cron\\| cron ' ${DUMP}.list > ${DUMP}.list2; pg_restore -U supabase_admin -d ${DB} -L ${DUMP}.list2 ${DUMP} 2>&1 | grep -c 'error' || true`);
  created = true;
  const restoreErrors = Number(cl.stdout.trim().split('\n').pop());
  const clone = one("select json_build_object('public_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'), 'contract_installed', to_regprocedure('public.torneos_contract_execute(text,text,jsonb)') is not null, 'auth_users', (select count(*) from auth.users), 'core_tables', to_regclass('public.usuarios') is not null and to_regclass('public.teams') is not null and to_regclass('public.team_members') is not null and to_regclass('public.jugadores') is not null)");
  phase('clone', cl.status === 0 && restoreErrors === 0 && clone.public_functions === src.public_functions && clone.contract_installed && clone.core_tables, { restore_errors: restoreErrors, clone });

  // 2. hosted ledger shape (the platform's 6-column table) + the 9 canonical rows as they exist on Core
  //    staging (7 CLI-shaped + 2 legacy single-blob, diagnosis 2026-09-16; null flags PER ROW as observed
  //    2026-09-17T16:19Z: only 20260810160355 carries created_by), round-trip through the verdict
  psql(`create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text, created_by text, idempotency_key text unique, rollback text[]); alter table supabase_migrations.schema_migrations owner to postgres;`, { user: 'supabase_admin' });
  const shape = one(C.LEDGER_SHAPE_SQL);
  const shapeDiff = C.ledgerShapeDiff(shape);
  phase('ledger_shape', shapeDiff.length === 0, { diff: shapeDiff, standard_conforming_strings: shape.standard_conforming_strings });
  const writer = one(C.WRITER_PRIVILEGES_SQL);
  phase('writer_privileges', C.writerPrivilegeFailures(writer).length === 0, { writer, note: 'postgres (the platform writer) owns the database as on hosted Supabase' });
  const localRows = C.CLI_WRITTEN_VERSIONS.map((v) => { const file = fs.readdirSync(path.join(REPO, 'supabase/migrations')).find((f) => f.startsWith(`${v}_`)); const bytes = fs.readFileSync(path.join(REPO, 'supabase/migrations', file)); const legacy = C.LEGACY_LEDGER_ROWS.find((l) => l.version === v); return { version: v, name: /^([0-9]+)_(.*)\.sql$/.exec(file)[2], statements: legacy ? [C.LEGACY_BLOB_TRANSFORMS[legacy.transform](bytes.toString('utf8'))] : splitAndTrim(bytes) }; });
  for (const r of localRows) psql(`begin;\n${C.ledgerInsertSql(r)}\ncommit;\n`);
  // the legacy pins carry the null flags per row: seed created_by where the pin says it is set (the real
  // value is never read by core-ledger, so the seed is a synthetic marker); idempotency/rollback stay null
  const expectedFlags = (version) => { const l = C.LEGACY_LEDGER_ROWS.find((x) => x.version === version); return Object.fromEntries(C.LEDGER_NULL_FLAGS.map((k) => [k, l ? l[k] : true])); };
  const SEEDED_CREATED_BY = 'offline-rehearsal:synthetic-created-by';
  const seededCreatedBy = C.LEGACY_LEDGER_ROWS.filter((l) => l.created_by_is_null === false).map((l) => l.version);
  for (const l of C.LEGACY_LEDGER_ROWS) if (l.idempotency_key_is_null !== true || l.rollback_is_null !== true) throw new Error(`rehearsal seeds only created_by; pin ${l.version} sets another column`);
  for (const v of seededCreatedBy) psql(`update supabase_migrations.schema_migrations set created_by = '${SEEDED_CREATED_BY}' where version = '${v}';`);
  const flagsMatch = (rs) => rs.length === 9 && rs.every((r) => C.LEDGER_NULL_FLAGS.every((k) => r[k] === expectedFlags(r.version)[k]));
  const remoteRows = rows(C.ledgerRowsSql(C.CLI_WRITTEN_VERSIONS));
  const cmp = C.compareLedgerRows(remoteRows, C.localLedgerDigests(REPO, C.CLI_WRITTEN_VERSIONS));
  const verdict = C.cliRowsVerdict(cmp);
  const createdBySet = remoteRows.filter((r) => r.created_by_is_null === false).map((r) => r.version);
  phase('cli_rows_round_trip', verdict.ok && flagsMatch(remoteRows) && JSON.stringify(createdBySet) === JSON.stringify(['20260810160355']), { note: 'dollar-quoted INSERT ⇄ md5(array_to_string(statements, chr(30))): 7 split rows reproduced + 2 legacy blobs equal to their pinned fingerprints; null flags per row (created_by set on 20260810160355 only)', verdict, rows_created_by_set: createdBySet, flags: Object.fromEntries(remoteRows.map((r) => [r.version, Object.fromEntries(C.LEDGER_NULL_FLAGS.map((k) => [k, r[k]]))])) });

  // 2b. a flag discrepancy on EITHER legacy row still blocks: clear created_by where the pin says set
  //     (the pre-2026-09-17 inferred state), set it where the pin says null; each is exactly one diff and
  //     a STOP verdict; restoring the seed brings the verdict back to ok. Nothing outside the clone.
  const verdictNow = () => { const rs = rows(C.ledgerRowsSql(C.CLI_WRITTEN_VERSIONS)); const c = C.compareLedgerRows(rs, C.localLedgerDigests(REPO, C.CLI_WRITTEN_VERSIONS)); return { verdict: C.cliRowsVerdict(c), legacy: Object.fromEntries(c.filter((x) => x.legacy).map((x) => [x.version, { match: x.match, diff: x.diff }])) }; };
  const discrepancies = [];
  for (const [version, mutate, restore] of [
    ['20260810160355', `update supabase_migrations.schema_migrations set created_by = null where version = '20260810160355';`, `update supabase_migrations.schema_migrations set created_by = '${SEEDED_CREATED_BY}' where version = '20260810160355';`],
    ['20260803090000', `update supabase_migrations.schema_migrations set created_by = '${SEEDED_CREATED_BY}' where version = '20260803090000';`, `update supabase_migrations.schema_migrations set created_by = null where version = '20260803090000';`],
  ]) {
    psql(mutate);
    const mutated = verdictNow();
    psql(restore);
    const restored = verdictNow();
    discrepancies.push({ version, mutated: { verdict: mutated.verdict, row: mutated.legacy[version] }, restored: { verdict_ok: restored.verdict.ok, row: restored.legacy[version] } });
  }
  const discrepancyBlocks = discrepancies.every((d) => d.mutated.verdict.ok === false && d.mutated.verdict.mismatched === 1 && d.mutated.verdict.legacy_matched === 1 && d.mutated.verdict.reproduced === 7 && d.mutated.verdict.absent === 0 && d.mutated.row.match === false && JSON.stringify(d.mutated.row.diff) === JSON.stringify(['created_by_is_null']) && d.restored.verdict_ok === true && d.restored.row.match === true && d.restored.row.diff.length === 0);
  phase('cli_rows_discrepancy_blocks', discrepancyBlocks && verdictNow().verdict.ok && flagsMatch(rows(C.ledgerRowsSql(C.CLI_WRITTEN_VERSIONS))), { note: 'created_by cleared on 20260810160355 / set on 20260803090000 → one diff each, verdict ok=false (7/1/1/0); restored → ok', discrepancies });

  // 3. the lab already carries the contract (no ledger rows): the rollback must clear it
  const before = one(CATALOG_SQL);
  psql(rb.text);
  const aclAfterRb0 = one(C.CONTRACT_ACL_SQL);
  phase('rollback_initial', C.rollbackResidue(aclAfterRb0).length === 0 && !installed(rendered[0]), { residue: C.rollbackResidue(aclAfterRb0) });
  const catalog0 = one(CATALOG_SQL);

  // 4. apply: the exact pinned documents, in order
  const applied = [];
  for (const m of rendered) {
    const stateBefore = { installed: installed(m), ledger: ledgerState(rows(C.ledgerRowsSql([m.version])), m) };
    psql(m.apply_sql);
    const stateAfter = { installed: installed(m), ledger: ledgerState(rows(C.ledgerRowsSql([m.version])), m) };
    applied.push({ version: m.version, before: stateBefore, after: stateAfter, apply_sql_sha256: m.apply_sql_sha256 });
  }
  phase('apply', applied.every((a) => !a.before.installed && a.before.ledger === 'absent' && a.after.installed && a.after.ledger === 'ours'), { applied });
  const ledgerRows = rows(C.ledgerRowsSql(C.VERSIONS));
  phase('ledger', ledgerRows.length === 2 && ledgerRows.every((r) => { const m = C.MIGRATIONS.find((x) => x.version === r.version); return r.statements_digest === m.ledger_digest && Number(r.statements_count) === m.statements_count && Number(r.statements_bytes) === m.ledger_bytes && r.name === m.name && r.created_by_is_null && r.idempotency_key_is_null && r.rollback_is_null; }), { rows: ledgerRows });
  const acl = one(C.CONTRACT_ACL_SQL);
  const aclFails = C.aclFailures(acl);
  phase('acl', aclFails.length === 0, { failures: aclFails, acl });

  // 5. idempotency: a second apply of v1 must abort as a whole (table exists) and leave the ledger as it was
  const rowsBefore = one('select count(*) from supabase_migrations.schema_migrations');
  const again = psql(rendered[0].apply_sql, { check: false });
  const rowsAfter = one('select count(*) from supabase_migrations.schema_migrations');
  const stillOurs = ledgerState(rows(C.ledgerRowsSql([rendered[0].version])), rendered[0]) === 'ours';
  // reconcile: drop the v1.1 ledger row only, then the INSERT alone restores it
  psql(`delete from supabase_migrations.schema_migrations where version = '${rendered[1].version}';`);
  const gone = ledgerState(rows(C.ledgerRowsSql([rendered[1].version])), rendered[1]) === 'absent';
  psql(`begin;\n${C.ledgerInsertSql(rendered[1].row)}\ncommit;\n`);
  const back = ledgerState(rows(C.ledgerRowsSql([rendered[1].version])), rendered[1]) === 'ours';
  phase('rerun_idempotent', again.status !== 0 && rowsBefore === rowsAfter && stillOurs && gone && back && installed(rendered[1]), { second_apply_error: (again.stderr.split('\n').find((l) => l.startsWith('ERROR')) ?? again.stderr.trim().split('\n')[0] ?? '').slice(0, 160), ledger_rows_unchanged: rowsBefore === rowsAfter, reconcile_insert_alone: back });

  // 6. rollback: the pinned SQL, then residue, catalog, and a no-op re-run
  psql(rb.text);
  const aclAfter = one(C.CONTRACT_ACL_SQL);
  const residue = C.rollbackResidue(aclAfter);
  phase('rollback', residue.length === 0 && rows(C.ledgerRowsSql(C.VERSIONS)).length === 0, { residue });
  phase('residue', residue.length === 0 && aclAfter.schema.app_private_present === true, { app_private_present: aclAfter.schema.app_private_present });
  const catalog1 = one(CATALOG_SQL);
  phase('catalog_unchanged', catalog0.h === catalog1.h && catalog0.n === catalog1.n && before.n === catalog0.n + 0, { note: `${catalog1.n} catalog entries outside the contract identical before apply and after rollback`, hash: catalog1.h });
  const rerun = psql(rb.text, { check: false });
  const cliRowsStill = rows(C.ledgerRowsSql(C.CLI_WRITTEN_VERSIONS)).length;
  phase('rollback_rerun_noop', rerun.status === 0 && cliRowsStill === 9, { cli_rows_untouched: cliRowsStill });
  evidence.pass = Object.values(phases).every((p) => p.ok);
} catch (error) {
  evidence.error = String(error?.message ?? error);
  console.error('!! ' + evidence.error);
} finally {
  if (created) { const d = exec(`dropdb -U supabase_admin --if-exists ${DB}; rm -f ${DUMP} ${DUMP}.list ${DUMP}.list2; psql -U supabase_admin -d postgres -X -A -t -c "select count(*) from pg_database where datname = '${DB}'"`); evidence.clone_dropped = d.stdout.trim().endsWith('0'); console.log(`clone ${DB} dropped: ${evidence.clone_dropped}`); }
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const out = path.join(EVIDENCE, `r3-offline-rehearsal-${STAMP}.json`);
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`EVIDENCE ${out}\n${crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex')}`);
  console.log(evidence.pass ? 'R3_OFFLINE_REHEARSAL_PASS' : 'R3_OFFLINE_REHEARSAL_FAIL');
  process.exit(evidence.pass ? 0 : 1);
}
