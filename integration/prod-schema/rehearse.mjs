// Rehearsal of RUNBOOK-193 on Core Production's REAL schema (~/Arma2Backups/d3 dump), each pass on
// a fresh disposable container (d3-prod-schema-lab.sh: no network, DB owned by postgres), with
// synthetic data. Applies as postgres. Passes:
//   A  per migration (timed), snapshot before 133000, rollbacks 142→133, compare, re-apply
//   B  exact runbook files: precheck → apply-193.psql → postcheck → smoke → re-run (idempotent)
//      → rollbacks 142→133 (psql -1) → resumed re-apply → postcheck
//   C  alignment alone: catalog digest R0 → 119000 → its rollback → digest == R0
//   D  recovery that keeps 120000…132000: apply all → rollbacks 143→133 + cleanup → 119000's
//      rollback; the functions of 120000…132000 must still run (functions-still-run.sql)
// Needs the coordinator's ~/Arma2Backups/d3-prod-schema-lab.sh (it loads the schema-only dump of
// Production into a container with no network). Usage, from the repository root:
//   node integration/prod-schema/rehearse.mjs <A|B|C>
// Reports land in integration/prod-schema/.out/ (ignored).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [pass] = process.argv.slice(2);
const D = new URL('.', import.meta.url).pathname;
const W = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${D}.out/`;
mkdirSync(OUT, { recursive: true });
const DK = '/Applications/Docker.app/Contents/Resources/bin/docker';
const NAME = `core-prod-reh-${pass.toLowerCase()}`;
const HOME = process.env.HOME;
const log = (...a) => console.log(...a);
const now = () => performance.now();
const md5 = (s) => createHash('md5').update(s).digest('hex');

const sh = (cmd, args, input) => spawnSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
sh(DK, ['rm', '-f', NAME]);
const up = sh('bash', [`${HOME}/Arma2Backups/d3-prod-schema-lab.sh`, NAME]);
const PW = (up.stdout.match(/PGPASSWORD=([0-9a-f]+)/) || [])[1];
if (!PW) { console.error(up.stdout, up.stderr); process.exit(1); }
const psql = (sql, { user = 'postgres', args = [] } = {}) => {
  const r = sh(DK, ['exec', '-i', '-w', '/tmp/repo', '-e', `PGPASSWORD=${PW}`, NAME, 'psql', '-h', 'localhost', '-U', user, '-d', 'core_prod', '-X', '-v', 'ON_ERROR_STOP=1', ...args], sql);
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
};
const q = (sql, user) => { const r = psql(sql, { user, args: ['-A', '-t', '-q'] }); if (!r.ok) throw new Error(r.err.slice(-600)); return r.out.trim(); };
const file = (path, args = []) => psql('', { args: ['-f', path, ...args] });
const fileQ = (path) => { const r = psql('', { args: ['-A', '-t', '-q', '-f', path] }); if (!r.ok) throw new Error(`${path}: ${r.err.slice(-600)}`); return r.out; };

// repo copy inside the container
sh(DK, ['exec', NAME, 'mkdir', '-p', '/tmp/repo/supabase', '/tmp/repo/docs/database/core-review', '/tmp/repo/integration']);
sh(DK, ['cp', `${W}/supabase/migrations`, `${NAME}:/tmp/repo/supabase/`]);
sh(DK, ['cp', `${W}/docs/database/core-review/runbook`, `${NAME}:/tmp/repo/docs/database/core-review/`]);
sh(DK, ['cp', `${W}/integration/prod-schema`, `${NAME}:/tmp/repo/integration/`]);


const STACK = readdirSync(`${W}/supabase/migrations`).filter((f) => /^20261010(1[1234][0-9])000_.*[.]sql$/.test(f)).sort();
const ROLLBACKS = readdirSync(`${W}/docs/database/core-review/runbook/rollbacks`).filter((f) => /^2026101014|^2026101013[3-9]/.test(f)).sort().reverse();
const checks = (name) => fileQ(`docs/database/core-review/runbook/${name}.sql`).split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const failures = (list) => list.filter((c) => !c.pass).map((c) => c.check);
const snapshot = () => JSON.parse(fileQ('integration/prod-schema/snapshot.sql').trim());
let catalogN = 0;
const catalogDigest = () => {
  const text = fileQ('docs/database/core-review/runbook/catalog.sql').split('\n').find((l) => l.startsWith('{'));
  const cat = JSON.parse(text);
  delete cat.ledger;
  catalogN += 1;
  writeFileSync(`${OUT}catalog-${pass}-${catalogN}.json`, JSON.stringify({ ...cat, ledger: [] }) + '\n');
  return md5(JSON.stringify(cat));
};
const compare = (a, b) => {
  const diff = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diff[k] = { before: a[k], after: b[k] };
  return Object.keys(diff).length ? diff : 'identical';
};
const ledger = () => Number(q("select count(*) from supabase_migrations.schema_migrations where version between '20261010119000' and '20261010149999'"));
const restarted = (() => { const t = q('select pg_postmaster_start_time()'); return () => q('select pg_postmaster_start_time()') !== t; })();
const applyOne = (f) => {
  const src = readFileSync(`${W}/supabase/migrations/${f}`, 'utf8');
  const [, version, name] = f.match(/^(\d{14})_(.*)\.sql$/);
  const tag = `l${md5(f).slice(0, 8)}`;
  const t = now();
  const r = psql(`set lock_timeout = '5s';\nbegin;\n${src}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${name}', array[$${tag}$${src}$${tag}$]);\ncommit;\n`);
  return { f, ok: r.ok, ms: Math.round(now() - t), error: r.ok ? null : r.err.split('\n').filter((l) => /ERROR/.test(l)).join(' | ') };
};
const rollback = (f) => { const t = now(); const r = file(`docs/database/core-review/runbook/rollbacks/${f}`, ['-1', '-q']); return { f, ok: r.ok, ms: Math.round(now() - t), error: r.ok ? null : r.err.slice(-400) }; };

const report = { pass, container: NAME, started_at: new Date().toISOString() };
const seed = file('integration/prod-schema/seed.sql');
if (!seed.ok) throw new Error(`seed: ${seed.err.slice(-400)}`);
report.seed = JSON.parse(q(`select json_build_object('usuarios', (select count(*) from public.usuarios), 'with_phone', (select count(*) from public.usuarios where telefono is not null),
  'partidos', (select count(*) from public.partidos), 'jugadores', (select count(*) from public.jugadores), 'with_template', (select count(*) from public.partidos where template_id is not null))::text`));
log('seed', JSON.stringify(report.seed));

if (pass === 'A') {
  report.precheck_failures = failures(checks('precheck'));
  report.apply = [];
  let pre133;
  for (const f of STACK) {
    if (f.startsWith('20261010133000')) { pre133 = snapshot(); report.catalog_pre133 = catalogDigest(); }
    const s = applyOne(f); report.apply.push(s); log(s.ok ? 'OK ' : 'ERR', f, s.ms, s.error || '');
    if (!s.ok) break;
  }
  report.postcheck_failures = failures(checks('postcheck'));
  const smoke = psql('begin;\n\\i integration/prod-schema/smoke.sql\nrollback;\n', { args: ['-A', '-t', '-q'] });
  report.smoke = { pass: (smoke.out.match(/^PASS/mg) || []).length, fail: (smoke.out.match(/^FAIL.*$/mg) || []), error: smoke.ok ? null : smoke.err.slice(-300) };
  report.rollbacks = ROLLBACKS.filter((f) => f !== '20261010119000_core_production_alignment.rollback.sql').map(rollback);
  report.rollback_vs_pre133 = compare(pre133, snapshot());
  report.catalog_after_rollbacks_equals_pre133 = catalogDigest() === report.catalog_pre133;
  report.cleanup = file('docs/database/core-review/runbook/rollbacks/cleanup-after-verified-rollback.sql', ['-1', '-q']).ok;
  report.catalog_after_cleanup_equals_pre133 = catalogDigest() === report.catalog_pre133;
  report.reapply = STACK.filter((f) => f >= '20261010133000').map(applyOne);
  report.postcheck_after_reapply_failures = failures(checks('postcheck'));
}
if (pass === 'B') {
  report.precheck = checks('precheck');
  let t = now();
  let r = file('docs/database/core-review/runbook/apply-193.psql');
  report.apply = { ok: r.ok, ms: Math.round(now() - t), applied: (r.out.match(/^>>> 2026/mg) || []).length, ledger: ledger(), error: r.ok ? null : r.err.slice(-500) };
  report.postcheck = checks('postcheck');
  const smoke = psql('begin;\n\\i integration/prod-schema/smoke.sql\nrollback;\n', { args: ['-A', '-t', '-q'] });
  report.smoke = { pass: (smoke.out.match(/^PASS/mg) || []).length, fail: (smoke.out.match(/^FAIL.*$/mg) || []), error: smoke.ok ? null : smoke.err.slice(-300) };
  r = file('docs/database/core-review/runbook/apply-193.psql');
  report.rerun = { ok: r.ok, skipped: (r.out.match(/already in the ledger/g) || []).length };
  report.rollbacks = ROLLBACKS.filter((f) => f !== '20261010119000_core_production_alignment.rollback.sql').map(rollback);
  report.ledger_after_rollbacks = ledger();
  r = file('docs/database/core-review/runbook/apply-193.psql');
  report.reapply = { ok: r.ok, applied: (r.out.match(/^>>> 2026/mg) || []).length, skipped: (r.out.match(/already in the ledger/g) || []).length, ledger: ledger() };
  report.postcheck_after_reapply_failures = failures(checks('postcheck'));
}
if (pass === 'C') {
  const r0 = catalogDigest();
  const snap0 = snapshot();
  report.apply_119 = applyOne('20261010119000_core_production_alignment.sql');
  report.catalog_changed_by_119 = catalogDigest() !== r0;
  report.rollback_119 = rollback('20261010119000_core_production_alignment.rollback.sql');
  report.catalog_back_to_R0 = catalogDigest() === r0;
  report.snapshot_vs_R0 = compare(snap0, snapshot());
}
if (pass === 'D') {
  const fnNames = [...new Set(STACK.filter((f) => f >= '20261010120000' && f < '20261010133000')
    .flatMap((f) => [...readFileSync(`${W}/supabase/migrations/${f}`, 'utf8').matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|app_private)\.[a-z0-9_]+)\s*\(/gi)])
    .map((m) => m[1].toLowerCase()))].sort();
  const stillRun = () => {
    const r = psql('begin;\n\\i integration/prod-schema/functions-still-run.sql\nrollback;\n', { args: ['-A', '-t', '-q', '-v', `fn_names=${fnNames.join(',')}`] });
    if (!r.ok) throw new Error(`functions-still-run: ${r.err.slice(-600)}`);
    return JSON.parse(r.out.split('\n').find((l) => l.startsWith('{')));
  };
  report.functions_of_120_132 = fnNames.length;
  report.apply = STACK.map(applyOne).filter((s) => !s.ok);
  report.applied_all = !report.apply.length;
  report.still_run_applied = stillRun();
  report.rollbacks = [...ROLLBACKS.filter((f) => f !== '20261010119000_core_production_alignment.rollback.sql'), 'cleanup-after-verified-rollback.sql',
    '20261010119000_core_production_alignment.rollback.sql'].map(rollback).filter((s) => !s.ok);
  report.kept_by_119_rollback = q("select to_regclass('app_private.production_alignment_log') is null") === 't' ? 'log dropped: nothing kept'
    : q("select coalesce(string_agg(coalesce(table_name || '.', '') || object_name, ', '), '') from app_private.production_alignment_log where kind in ('kept_function', 'kept_column')");
  report.policies_back_to_original = q("select count(*) from pg_policies where schemaname = 'public' and tablename in ('partidos', 'jugadores') and policyname in ('Lectura publica partidos', 'Universal read players')") === '2';
  report.still_run_after_recovery = stillRun();
  // Running 119000's rollback again in that state changes nothing and keeps the same objects.
  report.second_119_rollback = rollback('20261010119000_core_production_alignment.rollback.sql');
  report.still_run_after_second_rollback = stillRun().broken;
}
report.server_restarted = restarted();
writeFileSync(`${OUT}report-${pass}.json`, JSON.stringify(report, null, 1));
sh(DK, ['rm', '-f', NAME]);
log(JSON.stringify({ ...report, precheck: report.precheck && failures(report.precheck), postcheck: report.postcheck && failures(report.postcheck) }, null, 1).slice(0, 6000));
