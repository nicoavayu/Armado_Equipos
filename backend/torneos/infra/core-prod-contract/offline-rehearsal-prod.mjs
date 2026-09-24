#!/usr/bin/env node
// INFRA-0.5 — OFFLINE REHEARSAL of the Core PRODUCTION runner against a throwaway local Postgres of
// the SAME engine build as Production (public.ecr.aws/supabase/postgres:17.4.1.048), started with
// `--network none`. Nothing here can reach Supabase: the Management API surface is emulated by a local
// transport that runs each request's SQL through `docker exec … psql -U postgres` (non-superuser, as the
// platform's writer), the platform metadata (identity, secrets, function) is kept in memory, the Keychain
// is an in-memory fake (the real macOS Keychain is never touched) and the signed harness runs the REAL
// certified handler (torneosCoreContract.ts) whose SQL executor calls public.torneos_contract_execute in
// the container as service_role.
//
// The container is seeded from the last READ-ONLY capture of Production (sha256 pinned): the 236-row
// ledger verbatim (so the preflight must reproduce the pinned baseline digests with the REAL md5 of
// Postgres) and stubs of exactly the Core objects the contract compiles against, with Production's types
// and Production's function bodies. The capture's text never leaves the container / a 0600 scratch file.
//
//   node offline-rehearsal-prod.mjs <INVENTORY-EVIDENCE.json> <evidence-out-dir>
//
// Every evidence file the runner writes here is prefixed REHEARSAL- and annotated as a simulation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as P from './prod-contract.mjs';
import { runProd, StopError } from './core-prod-deploy.mjs';
import { PATHS } from './mgmt-prod.mjs';
import { WRITER_CONTEXT_SQL } from '../../phase3b/remote/mgmt-write.mjs';
import { handleContractRequest, parseServiceSecret } from '../../../../supabase/functions/_shared/torneosCoreContract.ts';
import { CAPTURE_SHA256 } from './derive-ledger-baseline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const DOCKER = ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
const IMAGE = 'public.ecr.aws/supabase/postgres:17.4.1.048';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const PAT = `sbp_rehearsal${crypto.randomBytes(16).toString('hex')}`; // synthetic, never valid anywhere

const [capturePath, outDir] = process.argv.slice(2);
if (!capturePath || !outDir) { console.error('usage: offline-rehearsal-prod.mjs <INVENTORY-EVIDENCE.json> <evidence-out-dir>'); process.exit(2); }
if (!DOCKER) { console.error('docker not found'); process.exit(2); }
const captureBytes = fs.readFileSync(capturePath);
if (sha(captureBytes) !== CAPTURE_SHA256) { console.error('capture sha256 mismatch'); process.exit(2); }
const capture = JSON.parse(captureBytes.toString('utf8')).capture;
const FP = capture.fingerprint;

const name = `arma2-infra05-rehearsal-${crypto.randomBytes(4).toString('hex')}`;
// Throwaway password of a throwaway, network-less container (dies with the run); not a credential of anything real.
const LOCAL_PW = crypto.randomBytes(16).toString('hex');
const docker = (args, opts = {}) => execFileSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
function psql(sql, { user = 'postgres', vars = {} } = {}) {
  const args = ['exec', '-i', '-e', `PGPASSWORD=${LOCAL_PW}`, name, 'psql', '-U', user, '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  const r = spawnSync(DOCKER, args, { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const must = (sql, opts) => { const r = psql(sql, opts); if (!r.ok) throw new Error(`psql failed: ${r.err.slice(0, 400)}`); return r.out; };

// ─────────────────────────── container + Production-shaped seed ───────────────────────────
function start() {
  docker(['run', '-d', '--rm', '--network', 'none', '--name', name, '-e', `POSTGRES_PASSWORD=${LOCAL_PW}`, IMAGE]);
  for (let i = 0; i < 90; i += 1) {
    if (spawnSync(DOCKER, ['exec', name, 'pg_isready', '-U', 'postgres', '-h', 'localhost'], { stdio: 'ignore' }).status === 0 && psql('select 1').ok) return;
    execFileSync('sleep', ['1']);
  }
  throw new Error('container not ready');
}
const colType = (rel, col) => FP.columns.find((c) => `${c.nspname}.${c.relname}` === rel && c.attname === col).type;
const fnDef = (proname) => FP.functions.find((f) => f.nspname === 'public' && f.proname === proname).definition;
function seed() {
  const tag = `$seed_${crypto.randomBytes(6).toString('hex')}$`;
  const ledgerJson = JSON.stringify(FP.ledger);
  if (ledgerJson.includes(tag)) throw new Error('dollar tag collision');
  // auth: the columns GoTrue adds after the image baseline, and auth.sessions (Production types).
  const authCols = ['email_confirmed_at', 'banned_until', 'deleted_at', 'is_anonymous'].map((c) => `alter table auth.users add column if not exists ${c} ${colType('auth.users', c)};`).join('\n');
  const sessionCols = ['id', 'user_id', 'created_at', 'updated_at', 'not_after', 'user_agent', 'tag'].map((c) => `${c} ${colType('auth.sessions', c)}`).join(', ');
  must(`${authCols}
set role supabase_auth_admin;
create table auth.sessions (${sessionCols}, primary key (id));
reset role;
grant all on auth.sessions to postgres;
create schema supabase_migrations authorization postgres;
set role postgres;
create table supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text, created_by text, idempotency_key text unique, rollback text[]);
insert into supabase_migrations.schema_migrations (version, statements, name, created_by, idempotency_key, rollback)
select version, statements, name, created_by, idempotency_key, rollback from json_populate_recordset(null::supabase_migrations.schema_migrations, ${tag}${ledgerJson}${tag}::json);
reset role;`, { user: 'supabase_admin' });
  // public: the four Core tables with the columns the contract (and the Core helpers it calls) read, Production types.
  const tables = {
    'public.usuarios': ['id', 'nombre', 'avatar_url', 'posiciones', 'acepta_invitaciones'],
    'public.teams': ['id', 'name', 'crest_url', 'updated_at', 'is_active', 'owner_user_id'],
    'public.jugadores': ['id', 'usuario_id'],
    'public.team_members': ['id', 'team_id', 'user_id', 'jugador_id', 'permissions_role', 'is_captain'],
  };
  const ddl = Object.entries(tables).map(([rel, cols]) => `create table ${rel} (${cols.map((c) => `${c} ${colType(rel, c)}${c === 'id' ? ' primary key' : ''}`).join(', ')});`).join('\n');
  must(`${ddl}
${fnDef('normalize_tournament_person_name')};
${fnDef('team_user_is_owner')};
${fnDef('team_user_is_admin_or_owner')};
revoke all on function public.normalize_tournament_person_name(text) from public, anon, authenticated;
grant execute on function public.normalize_tournament_person_name(text) to service_role;`);
}

// ─────────────────────────── emulated platform (in memory) + local Management API transport ───────────────────────────
const platform = { status: 'ACTIVE_HEALTHY', secrets: { OTHER_FUNCTION_SECRET: 'x' }, fn: null, requests: [] };
function queryRows(query, readOnly) {
  const sql = readOnly ? `begin read only;\nselect coalesce(json_agg(q), '[]'::json) from (${query}) q;\nrollback;\n` : `select coalesce(json_agg(q), '[]'::json) from (${query}) q;\n`;
  const r = psql(sql);
  if (!r.ok) return { status: 400, body: { message: r.err.slice(0, 300) } };
  return { status: 201, body: JSON.parse(r.out) };
}
async function transport(req) {
  platform.requests.push({ method: req.method, path: req.path, read_only: req.body?.read_only ?? null });
  if (req.method === 'GET' && req.path === PATHS.project) return { status: 200, body: { id: P.PROD_REF, ref: P.PROD_REF, name: P.PRODUCTION_PROJECT.name, organization_slug: P.PRODUCTION_PROJECT.organization_slug, region: P.PRODUCTION_PROJECT.region, status: platform.status, created_at: P.PRODUCTION_PROJECT.created_at, database: { version: '17.4.1.048 (local rehearsal image)' } } };
  if (req.method === 'GET' && req.path === PATHS.secrets) return { status: 200, body: Object.keys(platform.secrets).map((n) => ({ name: n, value: sha(n) })) };
  if (req.method === 'GET' && req.path === PATHS.fn) return platform.fn ? { status: 200, body: platform.fn } : { status: 404, body: { message: 'Function not found' } };
  if (req.method === 'POST' && req.path === PATHS.query) {
    if (req.body.read_only === true) return queryRows(req.body.query, true);
    if (req.body.query === WRITER_CONTEXT_SQL) return queryRows(req.body.query, false);
    const r = psql(req.body.query); // one of the two pinned apply documents (the transport guard already proved it)
    return r.ok ? { status: 201, body: [] } : { status: 400, body: { message: r.err.slice(0, 300) }, raw: r.err.slice(0, 300) };
  }
  if (req.method === 'POST' && req.path === PATHS.secrets) { for (const s of req.body) platform.secrets[s.name] = s.value; return { status: 201, body: null }; }
  if (req.method === 'POST' && req.path === PATHS.deploy) {
    platform.fn = { slug: P.FUNCTION_ARTIFACT.slug, name: P.FUNCTION_ARTIFACT.slug, status: 'ACTIVE', version: (platform.fn?.version ?? 0) + 1, verify_jwt: false, ezbr_sha256: sha(req.body), entrypoint_path: `file:///rehearsal/source/${P.FUNCTION_ARTIFACT.entrypoint}`, updated_at: Date.now() };
    return { status: 201, body: platform.fn };
  }
  return { status: 404, body: null };
}
// The platform's Edge runtime: the REAL certified handler; its only side effect is the RPC, run in the container as service_role.
async function fetchImpl(url, init) {
  if (!url.startsWith(`https://${P.PROD_REF}.supabase.co/functions/v1/${P.FUNCTION_ARTIFACT.slug}`)) throw new Error('rehearsal fetch outside the emulated endpoint');
  if (!platform.fn) return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  return handleContractRequest(new Request(url, { method: init.method, headers: init.headers, body: init.body }), {
    functionName: P.FUNCTION_ARTIFACT.slug,
    secret: parseServiceSecret(platform.secrets[P.SECRET_NAME]),
    async execute(operation, nonce, request) {
      const r = psql("set role service_role;\nselect public.torneos_contract_execute(:'op', :'nonce', :'req'::jsonb);\n", { vars: { op: operation, nonce, req: JSON.stringify(request) } });
      if (!r.ok) throw new Error('rpc_failed');
      return JSON.parse(r.out);
    },
  });
}
// In-memory Keychain (the real one is never touched in a rehearsal).
const kcState = { prod: null, nonprod: crypto.randomBytes(32).toString('hex'), generated: 0 };
const keychain = {
  namespace: P.KEYCHAIN_PROD,
  check: () => (kcState.prod ? 'PRESENT' : 'ABSENT'),
  read: () => { if (!kcState.prod) throw new Error('absent'); return kcState.prod; },
  readNonprod: () => kcState.nonprod,
  generate: () => { if (kcState.prod) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_REGENERATE'); kcState.prod = crypto.randomBytes(32).toString('hex'); kcState.generated += 1; return 'KEYCHAIN_GENERATED'; },
};

// ─────────────────────────── phases ───────────────────────────
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const evDir = path.join(outDir, `offline-rehearsal-${stamp}`);
const lines = [];
const phases = [];
let seq = 0;
async function phase(label, mode, expect, { confirm = true, before, after } = {}) {
  if (before) before();
  const reqBefore = platform.requests.length;
  const deps = {
    repo: REPO, transport, keychain, fetchImpl, evidenceDir: evDir, out: (l) => lines.push(`[${label}] ${l}`), probe: { retries: 0, interval_ms: 1 }, env: {},
    evidencePrefix: `REHEARSAL-${String(++seq).padStart(2, '0')}-`, annotation: `OFFLINE REHEARSAL ${stamp} — local ${IMAGE} container, --network none, emulated Management API, in-memory Keychain; NOT a Production run`,
    readConfirmation: (prompt, planId) => (confirm ? P.confirmationPhrase(planId) : 'yes'),
  };
  let verdict; let res = null;
  try { res = await runProd({ mode, request: { pat: PAT }, deps }); verdict = res.verdict; } catch (e) { verdict = e instanceof StopError ? `STOP:${e.code}` : `ERROR:${e.message}`; if (!(e instanceof StopError)) lines.push(`[${label}] ${e.stack}`); }
  if (after) after();
  const reqs = platform.requests.slice(reqBefore);
  const writes = reqs.filter((r) => !(r.method === 'GET' || r.read_only === true));
  const ok = verdict === expect;
  phases.push({ label, mode, expect, verdict, ok, requests: reqs.length, write_requests: writes.length, write_paths: writes.map((w) => `${w.method} ${w.path}${w.read_only === false ? ' (read_only:false)' : ''}`), plan_id: res?.plan_id ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${verdict} (expected ${expect}; ${reqs.length} requests, ${writes.length} writes)`);
  return res;
}

let exit = 1;
const summary = { kind: 'INFRA_0_5_OFFLINE_REHEARSAL', generated_at: new Date().toISOString(), image: IMAGE, network: 'none', container: name, capture: { sha256: CAPTURE_SHA256, captured_utc: capture.capturedUtc, ledger_rows: FP.ledger.length }, production_contact: 'none (no socket to Supabase; emulated transport; in-memory Keychain)' };
try {
  start();
  summary.engine = JSON.parse(must("select json_build_object('server_version', current_setting('server_version'), 'writer', current_user, 'writer_superuser', (select rolsuper from pg_roles where rolname = current_user), 'app_private_present', to_regnamespace('app_private') is not null)"));
  seed();
  const r = (sql, u) => must(sql, { user: u });
  await phase('P01 preflight-only on the Production-shaped seed', '--preflight-only', 'CORE_PROD_PREFLIGHT_ONLY_STOP');
  await phase('P02 dry-run', '--dry-run', 'CORE_PROD_DRYRUN_STOP');
  await phase('N01 ledger drift (extra row) → STOP', '--preflight-only', 'STOP:LEDGER_UNEXPECTED', {
    before: () => r("insert into supabase_migrations.schema_migrations (version, name, statements) values ('20260920000000', 'rehearsal_drift', array['select 1'])"),
    after: () => r("delete from supabase_migrations.schema_migrations where version = '20260920000000'"),
  });
  await phase('N02 changed ledger row → STOP', '--preflight-only', 'STOP:LEDGER_UNEXPECTED', {
    before: () => r("update supabase_migrations.schema_migrations set name = name || '_x' where version = '20260903213456'"),
    after: () => r("update supabase_migrations.schema_migrations set name = left(name, -2) where version = '20260903213456'"),
  });
  await phase('N03 pre-existing app_private → STOP', '--preflight-only', 'STOP:APP_PRIVATE_UNEXPECTED', { before: () => r('create schema app_private'), after: () => r('drop schema app_private') });
  await phase('N04 missing prerequisite column → STOP', '--preflight-only', 'STOP:PREREQUISITES_UNMET', { before: () => r('alter table public.usuarios rename column acepta_invitaciones to acepta_invitaciones_x'), after: () => r('alter table public.usuarios rename column acepta_invitaciones_x to acepta_invitaciones') });
  await phase('N05 project not ACTIVE_HEALTHY → STOP', '--preflight-only', 'STOP:PROJECT_NOT_ACTIVE_HEALTHY', { before: () => { platform.status = 'COMING_UP'; }, after: () => { platform.status = 'ACTIVE_HEALTHY'; } });
  await phase('N06 wrong phrase → STOP, 0 writes', '--apply', 'STOP:CONFIRMATION_REFUSED', { confirm: false });
  const applied = await phase('P03 APPLY: v1 + v1.1 + secret + deploy + 9/9 + ACL + catalog + ledger', '--apply', 'CORE_PROD_CONTRACT_DEPLOYED');
  summary.apply = applied ? { plan_id: applied.plan_id, probe: applied.probe, acl_failures: applied.acl_failures, catalog_changed: applied.catalog_changed } : null;
  summary.after = JSON.parse(must(`select json_build_object('ledger_rows', (select count(*) from supabase_migrations.schema_migrations), 'app_private', (${P.APP_PRIVATE_SQL.replace(/^select /, 'select ').replace(/ as app_private$/, '')}), 'nonces_written_by_harness', (select count(*) from app_private.torneos_contract_nonces))`));
  await phase('P04 acl-only (read-only postflight)', '--acl-only', 'CORE_PROD_ACL_PASS');
  await phase('P05 re-run apply: skip/skip, Keychain reused, deploy + 9/9', '--apply', 'CORE_PROD_CONTRACT_DEPLOYED');
  await phase('N07 API role gets USAGE on app_private → acl-only STOP', '--acl-only', 'STOP:ACL_EXPECTATIONS_UNMET', { before: () => r('grant usage on schema app_private to anon'), after: () => r('revoke usage on schema app_private from anon') });
  await phase('N08 Core secret differs from Keychain → STOP (no reconcile)', '--apply', 'STOP:SIGNED_HARNESS_SECRET_MISMATCH', { before: () => { platform.saved = platform.secrets[P.SECRET_NAME]; platform.secrets[P.SECRET_NAME] = crypto.randomBytes(32).toString('hex'); }, after: () => { platform.secrets[P.SECRET_NAME] = platform.saved; delete platform.saved; } });
  await phase('N09 ledger row of v1.1 removed (objects without row) → STOP, no mark-as-applied', '--preflight-only', 'STOP:MIGRATION_STATE_STOP', {
    before: () => r("create table public.rehearsal_hold as select * from supabase_migrations.schema_migrations where version = '20260915120000'; delete from supabase_migrations.schema_migrations where version = '20260915120000'", 'supabase_admin'),
    after: () => r("insert into supabase_migrations.schema_migrations select * from public.rehearsal_hold; drop table public.rehearsal_hold", 'supabase_admin'),
  });
  await phase('P06 final acl-only after every negative was undone', '--acl-only', 'CORE_PROD_ACL_PASS');
  summary.keychain = { generated: kcState.generated, prod_equals_nonprod: kcState.prod === kcState.nonprod };
  summary.phases = phases;
  summary.all_pass = phases.every((p) => p.ok) && kcState.generated === 1;
  summary.writes_outside_apply = phases.filter((p) => p.mode !== '--apply' || p.verdict.startsWith('STOP:CONFIRMATION')).reduce((a, p) => a + p.write_requests, 0);
  exit = summary.all_pass && summary.writes_outside_apply === 0 ? 0 : 1;
} catch (e) {
  summary.error = e.message; lines.push(e.stack);
} finally {
  spawnSync(DOCKER, ['rm', '-f', name], { stdio: 'ignore' });
  summary.container_removed = spawnSync(DOCKER, ['inspect', name], { stdio: 'ignore' }).status !== 0;
  fs.mkdirSync(evDir, { recursive: true });
  const known = [kcState.prod, kcState.nonprod, platform.saved, PAT].filter(Boolean);
  const text = `${JSON.stringify(summary, null, 1)}\n`;
  const log = `${lines.join('\n')}\n`;
  for (const k of known) if (text.includes(k) || log.includes(k)) { console.error('SECRET LEAK IN REHEARSAL OUTPUT'); exit = 1; }
  fs.writeFileSync(path.join(evDir, 'REHEARSAL-SUMMARY.json'), text);
  fs.writeFileSync(path.join(evDir, 'REHEARSAL-runner-output.log'), log);
  console.log(`${summary.all_pass ? 'OFFLINE_REHEARSAL_PASS' : 'OFFLINE_REHEARSAL_FAIL'} ${path.join(evDir, 'REHEARSAL-SUMMARY.json')} ${sha(text)}`);
  process.exit(exit);
}
