// Rehearsal of 20261010118000 (only the organizer cancels a match) on a fresh disposable copy of
// Core Production's REAL schema (the coordinator's ~/Arma2Backups/d3-prod-schema-lab.sh: container
// with no network, schema-only dump of Production, DB owned by postgres). Applies as postgres:
// check (before) → apply with its ledger row → check (after) → smoke (rolled back) → re-run (no-op)
// → rollback → function identical to the original (body, oid, ACL, settings) → re-apply.
// Usage, from the repository root: node integration/prod-schema/rehearse-118000.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const D = new URL('.', import.meta.url).pathname;
const W = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${D}.out/`;
mkdirSync(OUT, { recursive: true });
const DK = '/Applications/Docker.app/Contents/Resources/bin/docker';
const NAME = 'core-prod-reh-118';
const sh = (cmd, args, input) => spawnSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
sh(DK, ['rm', '-f', NAME]);
const up = sh('bash', [`${process.env.HOME}/Arma2Backups/d3-prod-schema-lab.sh`, NAME]);
const PW = (up.stdout.match(/PGPASSWORD=([0-9a-f]+)/) || [])[1];
if (!PW) { console.error(up.stdout, up.stderr); process.exit(1); }
const psql = (sql, args = []) => {
  const r = sh(DK, ['exec', '-i', '-w', '/tmp/repo', '-e', `PGPASSWORD=${PW}`, NAME, 'psql', '-h', 'localhost', '-U', 'postgres', '-d', 'core_prod', '-X', '-v', 'ON_ERROR_STOP=1', ...args], sql);
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
};
const q = (sql) => { const r = psql(sql, ['-A', '-t', '-q']); if (!r.ok) throw new Error(r.err.slice(-600)); return r.out.trim(); };
sh(DK, ['exec', NAME, 'mkdir', '-p', '/tmp/repo/supabase', '/tmp/repo/docs/database/core-review', '/tmp/repo/integration']);
sh(DK, ['cp', `${W}/supabase/migrations`, `${NAME}:/tmp/repo/supabase/`]);
sh(DK, ['cp', `${W}/docs/database/core-review/runbook`, `${NAME}:/tmp/repo/docs/database/core-review/`]);
sh(DK, ['cp', `${W}/integration/prod-schema`, `${NAME}:/tmp/repo/integration/`]);

const FILE = '20261010118000_core_cancel_match_organizer_only.sql';
const fnState = () => q(`select json_build_object('oid', p.oid::bigint, 'md5', md5(p.prosrc), 'acl', coalesce(p.proacl::text, 'default'),
  'owner', pg_get_userbyid(p.proowner), 'secdef', p.prosecdef, 'volatile', p.provolatile, 'config', p.proconfig, 'args', pg_get_function_arguments(p.oid),
  'result', pg_get_function_result(p.oid), 'lang', p.prolang, 'cost', p.procost,
  'saved_table', to_regclass('app_private.core_function_before') is not null,
  'ledger', exists (select 1 from supabase_migrations.schema_migrations where version = '20261010118000'))::text
  from pg_proc p where p.oid = 'public.cancel_partido_with_notification(bigint,text)'::regprocedure`);
const checks = () => psql('', ['-A', '-t', '-q', '-f', 'docs/database/core-review/runbook/cancel-118000-check.sql'])
  .out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const apply = () => {
  const src = readFileSync(`${W}/supabase/migrations/${FILE}`, 'utf8');
  const r = psql(`set lock_timeout = '5s';\nbegin;\n${src}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261010118000', 'core_cancel_match_organizer_only', array[$m118$${src}$m118$]) on conflict do nothing;\ncommit;\n`);
  return { ok: r.ok, error: r.ok ? null : r.err.slice(-400) };
};

const report = { started_at: new Date().toISOString(), container: NAME };
report.r0 = JSON.parse(fnState());
report.check_before = checks().filter((c) => c.phase === 'before');
report.apply = apply();
report.after = JSON.parse(fnState());
report.check_after = checks().filter((c) => c.phase === 'after');
const smoke = psql('begin;\n\\i integration/prod-schema/cancel-118000-smoke.sql\nrollback;\n', ['-A', '-t', '-q']);
report.smoke = { pass: (smoke.out.match(/^PASS/mg) || []).length, fail: smoke.out.match(/^FAIL.*$/mg) || [], error: smoke.ok ? null : smoke.err.slice(-300) };
report.rerun = apply();
report.rerun_state_unchanged = JSON.stringify(JSON.parse(fnState())) === JSON.stringify(report.after);
const rb = psql('', ['-1', '-q', '-f', 'docs/database/core-review/runbook/rollbacks/20261010118000_core_cancel_match_organizer_only.rollback.sql']);
report.rollback = { ok: rb.ok, error: rb.ok ? null : rb.err.slice(-400) };
report.after_rollback = JSON.parse(fnState());
report.after_rollback_equals_r0 = JSON.stringify(report.after_rollback) === JSON.stringify(report.r0);
report.reapply = apply();
report.check_after_reapply = checks().filter((c) => c.phase === 'after' && !c.pass).map((c) => c.check);
writeFileSync(`${OUT}report-118000.json`, JSON.stringify(report, null, 1));
sh(DK, ['rm', '-f', NAME]);
console.log(JSON.stringify(report, null, 1));
