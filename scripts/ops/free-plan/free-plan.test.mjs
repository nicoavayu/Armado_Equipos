// Free-plan operations, offline: pins of every file a Core write can run, the static shape of the capacity SQL, the
// refusals that happen before any connection, and the recorded lab rehearsal. The real runs (backup + restore check of
// the lab Core and Torneos, Storage backup/restore, every core_apply step on a disposable Core copy, the capacity
// remediation with Production's volumes) are in docs/ops/free-plan/README.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const read = (p) => fs.readFileSync(p, 'utf8');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const CORE_APPLY = 'scripts/ops/free-plan/core_apply.py';
const OPS = 'scripts/ops/free-plan/ops_free_plan.py';
const py = (args, env = {}) => spawnSync('python3', args, { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: os.tmpdir(), PYTHONDONTWRITEBYTECODE: '1', ...env } });
const code = (sql) => sql.replace(/--[^\n]*/g, '').toLowerCase();

const STEP_FILES = {
  reindex: 'supabase/ops/free-plan-capacity/01-reindex-notification-delivery-log.sql',
  compact: 'supabase/ops/free-plan-capacity/02-compact-operational-logs.sql',
  'migration-20261009120000': 'supabase/migrations/20261009120000_core_ops_log_retention.sql',
  'migration-20261007120000': 'supabase/migrations/20261007120000_torneos_core_contract_v1_2_my_teams.sql',
  'migration-20261008120000': 'supabase/migrations/20261008120000_core_push_preference_v1.sql',
  'rollback-push-preference': 'supabase/rollbacks/20261008120000_core_push_preference_v1.safe.sql',
};

test('core_apply pins the exact bytes of every step it can run', () => {
  const source = read(CORE_APPLY);
  for (const [step, file] of Object.entries(STEP_FILES)) {
    const pin = source.match(new RegExp(`'${step}': '([0-9a-f]{64})'`))?.[1];
    assert.equal(pin, sha256(file), `${step} → ${file}`);
    assert.ok(source.includes(`'file': '${file}'`), `${step} runs ${file}`);
  }
});

test('the reports and the manifest only read', () => {
  for (const file of ['supabase/ops/free-plan-capacity/inspect.sql', 'supabase/ops/free-plan-capacity/inspect-core-logs.sql', 'scripts/ops/free-plan/sql/manifest.sql']) {
    const sql = code(read(file));
    assert.match(sql.trim(), /^(with|select)\b/, file);
    const statements = sql.replace(/'(?:[^']|'')*'/g, "''"); // privilege names such as 'INSERT' are data, not statements
    assert.doesNotMatch(statements, /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|vacuum|reindex|copy|call)\b/, file);
    assert.match(sql, /::jsonb::text as (report|manifest)\s*$/, `${file}: one single-line JSON row`);
  }
});

test('capacity steps: reindex changes no row; compaction keeps 7 days with TRUNCATE (no WAL burst) and short locks', () => {
  const reindex = code(read(STEP_FILES.reindex));
  assert.match(reindex, /reindex table concurrently public\.notification_delivery_log;/);
  assert.match(reindex, /set lock_timeout = '5s';/);
  assert.doesNotMatch(reindex, /\b(delete|truncate|insert|update|drop)\b/);

  const compact = code(read(STEP_FILES.compact));
  assert.doesNotMatch(compact, /\bdelete\b/, 'never a large DELETE: it would write hundreds of MB of WAL on the 1 GB disk');
  assert.match(compact, /set lock_timeout = '3s';/);
  for (const [table, column] of [['cron.job_run_details', 'start_time'], ['public.push_sender_scheduler_runs', 'triggered_at']]) {
    const block = compact.slice(compact.indexOf(`lock table ${table}`));
    assert.match(block, new RegExp(`select \\* from ${table.replace('.', '\\.')} where ${column} >= now\\(\\) - interval '7 days'`));
    assert.ok(block.indexOf(`truncate ${table};`) > block.indexOf('create temp table'), `${table}: recent rows saved before truncate`);
    assert.match(block, new RegExp(`insert into ${table.replace('.', '\\.')} select \\* from`));
  }
  assert.equal((compact.match(/\btruncate\b/g) || []).length, 2, 'only the two log tables');
});

test('retention migration: capped daily run, only the two log tables, no client can execute it', () => {
  const sql = code(read(STEP_FILES['migration-20261009120000']));
  assert.match(sql, /p_max_rows_per_table integer default 20000/);
  assert.match(sql, /p_keep_days integer default 7/);
  const deletes = [...sql.matchAll(/delete from ([a-z_.]+)/g)].map((m) => m[1]);
  assert.deepEqual(deletes, ['cron.job_run_details', 'public.push_sender_scheduler_runs']);
  assert.match(sql, /revoke all on function public\.run_ops_log_retention\(integer, integer, integer\) from public, anon, authenticated, service_role;/);
  assert.match(sql, /cron\.schedule\('ops_log_retention_scheduler', '41 3 \* \* \*', 'select public\.run_ops_log_retention\(\);'\)/);
  assert.match(sql, /core_ops_log_retention_failed: client execute granted/);
  // The monthly index rebuild is ONE statement (pg_cron runs it outside a transaction block, as CONCURRENTLY needs).
  assert.match(sql, /cron\.schedule\('ops_delivery_log_reindex', '11 4 1 \* \*', 'reindex table concurrently public\.notification_delivery_log'\)/);
});

test('every refusal happens before any connection', () => {
  const lab = { LAB_PGPASSWORD: 'x', LAB_BACKUP_PASSPHRASE: 'lab-passphrase-0000' };
  let r = py([CORE_APPLY, 'apply', 'reindex', '--lab-port', '1', '--phrase', 'APPLY CORE reindex lab 000000000000'], lab);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(`PHRASE_REQUIRED: APPLY CORE reindex lab ${sha256(STEP_FILES.reindex).slice(0, 12)}`));
  r = py([CORE_APPLY, 'apply', 'compact', '--lab-port', '1', '--phrase', `APPLY CORE compact lab ${sha256(STEP_FILES.compact).slice(0, 12)}`], lab);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /compact needs --verified-backup/);
  r = py([OPS, 'backup-db', '--lab-port', '1', '--out', path.resolve('backups-here')], lab);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /backups never go inside the repository/);
  r = py([OPS, 'backup-storage', '--lab-storage-url', 'http://example.com/storage/v1', '--out', path.join(os.tmpdir(), 'x')], { ...lab, LAB_SERVICE_KEY: 'k' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /lab storage must be loopback/);
  r = py([CORE_APPLY, 'function-deploy', '--phrase', 'DEPLOY CORE FUNCTION rcyuuoaqfwcembdajcss 000000000000']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PHRASE_REQUIRED: DEPLOY CORE FUNCTION rcyuuoaqfwcembdajcss [0-9a-f]{12}/);
});

test('the function artifact is the INFRA-1 one with only the contract module changed (my_teams)', () => {
  const r = py([CORE_APPLY, 'function-plan']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').filter((l) => l.startsWith('functions/'));
  assert.deepEqual(lines.map((l) => l.split(/\s+/)[0]), [
    'functions/_shared/supabaseApiKeys.ts', 'functions/_shared/torneosCoreContract.ts', 'functions/torneos-core-contract/index.ts']);
  const infra1 = read('backend/torneos/infra/core-prod-contract/prod-contract.mjs');
  for (const unchanged of ['functions/_shared/supabaseApiKeys.ts', 'functions/torneos-core-contract/index.ts']) {
    assert.ok(infra1.includes(sha256(path.join('supabase', unchanged))), `${unchanged} is byte-identical to INFRA-1`);
  }
  assert.ok(!infra1.includes(sha256('supabase/functions/_shared/torneosCoreContract.ts')), 'the contract module carries my_teams');
  assert.match(r.stdout, /my-teams route: yes/);
});

test('the function rollback artifact (main ffaf131c) is byte-for-byte the INFRA-1 certified one', (t) => {
  if (spawnSync('git', ['cat-file', '-e', 'ffaf131c^{commit}']).status !== 0) { t.skip('shallow checkout: ffaf131c not present'); return; }
  const r = py([CORE_APPLY, 'function-plan', '--from-ref', 'ffaf131c']);
  assert.equal(r.status, 0, r.stderr);
  const infra1 = read('backend/torneos/infra/core-prod-contract/prod-contract.mjs');
  const shas = r.stdout.split('\n').filter((l) => l.startsWith('functions/')).map((l) => l.trim().split(/\s+/).pop());
  assert.equal(shas.length, 3);
  for (const sha of shas) assert.ok(infra1.includes(sha), `${sha} pinned by INFRA-1`);
  assert.match(r.stdout, /my-teams route: no/);
});

test('the capacity rehearsal with Production volumes: every step done, short pauses, small WAL, 434 MB → 16.5 MB', () => {
  const e = JSON.parse(read('supabase/ops/free-plan-capacity/evidence/lab-rehearsal-20261007.json'));
  assert.equal(e.network, 'none');
  assert.ok(e.initial.cron_job_run_details.rows >= 1143332);
  assert.deepEqual(e.steps.map((s) => s.step), ['reindex', 'retention_migration', 'retention_first_run_on_full_backlog', 'compact']);
  for (const s of e.steps) {
    assert.ok(s.max_push_tick_gap_ms < 2000 && s.max_cron_record_gap_ms < 2000, `${s.step}: writers every second never waited 2 s`);
    assert.ok(s.wal_bytes < 20 * 1048576, `${s.step}: WAL under 20 MB`);
  }
  const compact = e.steps.find((s) => s.step === 'compact');
  assert.ok(compact.database_bytes_after < 20 * 1048576);
  assert.deepEqual(e.retention_function_acl, { anon: false, authenticated: false, scheduled: '41 3 * * *', reindex_scheduled: '11 4 1 * *', reindex_command_ran: true });
});

test('both tools compile', () => {
  const r = py(['-c', 'import ast, sys; [ast.parse(open(f).read(), f) for f in sys.argv[1:]]', OPS, CORE_APPLY]);
  assert.equal(r.status, 0, r.stderr);
});
