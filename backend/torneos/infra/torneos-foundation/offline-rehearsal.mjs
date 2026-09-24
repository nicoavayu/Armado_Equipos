#!/usr/bin/env node
// INFRA-1 R3 — OFFLINE REHEARSAL of the foundation runner. Nothing leaves this machine.
//
//   • DB: a throwaway supabase/postgres:17.6.1.147 container on an --internal Docker network (no egress).
//     The runner's REAL psql leg is replaced by `docker exec … psql -f -` with the SAME certified bytes, as
//     postgres (non-superuser — the hosted installer).
//   • PostgREST: the local public.ecr.aws/supabase/postgrest:v14.15 image against that DB (anon role anon,
//     schemas public,graphql_public, a throwaway JWT secret, NO pre-request — exactly the hosted state after
//     0000–0003), published on 127.0.0.1 only, behind an in-process emulation of the platform gateway (no
//     apikey → 401; the apikey is stripped before PostgREST).
//   • Management API: emulated in memory (project states, pause, create, regions); every read-only SQL the
//     runner sends is executed in the container with default_transaction_read_only=on.
//   • Keychain / tty: in-memory fakes; the phrase is taken from the plan the runner printed.
// Every evidence file is prefixed REHEARSAL- and annotated. The catalog pin (pins/expected-catalog.json) is
// derived here from the container after 0003, and then certified by the runner's --certify.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as F from './foundation-contract.mjs';
import { runFoundation, StopError, EVIDENCE_DIR } from './foundation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCKER = ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
if (!DOCKER) { console.error('docker not found'); process.exit(2); }
const DB_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.147';
const PGRST_IMAGE = 'public.ecr.aws/supabase/postgrest:v14.15';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const NET = `infra1-r3-net-${process.pid}`; const DB = `infra1-r3-db-${process.pid}`; const PGRST = `infra1-r3-pgrst-${process.pid}`;
// Throwaway values of throwaway containers (they die with the run); not credentials of anything real.
const LOCAL_PW = crypto.randomBytes(18).toString('base64url');
const JWT_SECRET = crypto.randomBytes(32).toString('base64url');
const PAT = `sbp_${crypto.randomBytes(20).toString('hex')}`;
const PUBLISHABLE = `sb_publishable_${crypto.randomBytes(16).toString('base64url')}`;
const FAKE_DB_PASS = crypto.randomBytes(30).toString('base64url');
const NEW_REF = 'rehearsaltorneosabcd'.slice(0, 20);
const docker = (args, opts = {}) => execFileSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
const lines = [];
const log = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };

function psql(sql, { user = 'postgres', readOnly = false, file = null } = {}) {
  const env = ['-e', `PGPASSWORD=${LOCAL_PW}`]; if (readOnly) env.push('-e', 'PGOPTIONS=-c default_transaction_read_only=on');
  const r = spawnSync(DOCKER, ['exec', '-i', ...env, DB, 'psql', '-U', user, '-h', 'localhost', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: file ? fs.readFileSync(file) : sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), code: r.status };
}

async function main() {
  const phases = [];
  let pgrstPort = null; let gateway = null;
  try {
    docker(['network', 'create', '--internal', NET]);
    docker(['run', '-d', '--rm', '--network', NET, '--network-alias', 'db', '--name', DB, '-e', `POSTGRES_PASSWORD=${LOCAL_PW}`, '--pull', 'never', DB_IMAGE]);
    for (let i = 0; i < 90; i++) { if (psql('select 1').ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    if (!psql('select 1').ok) throw new Error('db did not come up');
    const version = psql("select current_setting('server_version')").out;
    log(`db up: ${DB_IMAGE} server_version ${version}`);

    // ── the emulated control plane ──
    const w = { staging: 'ACTIVE_HEALTHY', pausing: 0, torneos: null, torneosPolls: 0, writes: [] };
    const proj = (ref, name, status, region) => ({ ref, id: ref, name, organization_slug: F.ORG_SLUG, region, status, created_at: '2026-09-25T00:00:00Z', database: { version: '17.6.1.147' } });
    const projects = () => [proj(F.PROD_REF, "nicoavayu's Project", 'ACTIVE_HEALTHY', 'sa-east-1'), proj(F.STAGING_REF, 'arma2-torneos-staging', w.staging, 'us-east-1'), proj(F.OLD_REF, 'Arma2', 'INACTIVE', 'us-west-2'), ...(w.torneos ? [proj(NEW_REF, F.PROJECT_NAME, w.torneos, 'sa-east-1')] : [])];
    const transport = async ({ pat, method, path: p, body }) => {
      if (pat !== PAT) throw new Error('pat mismatch');
      const cls = F.classifyRequest({ method, path: p, body }, { armedFor: method === 'POST' && p.endsWith('/pause') ? 'pause' : method === 'POST' && p === '/v1/projects' ? 'create' : null, createdRef: NEW_REF });
      const r = (status, b) => ({ status, body: b, raw: JSON.stringify(b) });
      switch (cls.id) {
        case 'org': return r(200, { slug: F.ORG_SLUG, name: "nicoavayu's Org", plan: 'free' });
        case 'projects': return r(200, projects());
        case 'regions': return r(200, { recommendations: { smartGroup: { code: 'americas', name: 'Americas', type: 'smartGroup' }, specific: [{ code: 'sa-east-1', name: 'São Paulo', type: 'specific', provider: 'AWS' }] }, all: { smartGroup: [], specific: [{ code: 'sa-east-1', name: 'São Paulo', type: 'specific', provider: 'AWS' }, { code: 'us-east-1', name: 'N. Virginia', type: 'specific', provider: 'AWS' }] } });
        case 'prod-project': return r(200, projects()[0]);
        case 'prod-contract-fn': return r(200, { slug: F.CORE_CONTRACT_SLUG, status: 'ACTIVE', version: 3, verify_jwt: false, ezbr_sha256: F.CORE_CONTRACT_EZBR });
        case 'project':
          if (cls.ref === F.STAGING_REF && w.pausing) { w.pausing--; w.staging = w.pausing ? 'PAUSING' : 'INACTIVE'; }
          if (cls.ref === NEW_REF && w.torneos && w.torneos !== 'ACTIVE_HEALTHY' && ++w.torneosPolls >= 3) w.torneos = 'ACTIVE_HEALTHY';
          return r(200, projects().find((x) => x.ref === cls.ref));
        case 'functions': return r(200, cls.ref === F.STAGING_REF ? [{ slug: 'push-sender', status: 'ACTIVE', version: 4 }, { slug: 'torneos-core-contract', status: 'ACTIVE', version: 1 }] : []);
        case 'branches': return r(404, { message: 'Preview branching is not enabled' });
        case 'health': return r(200, ['auth', 'db', 'pooler', 'rest', 'db_postgres_user'].map((name) => ({ name, status: 'ACTIVE_HEALTHY', healthy: true })));
        case 'pooler': return r(200, [{ db_host: 'aws-0-sa-east-1.pooler.supabase.com', db_port: 5432, pool_mode: 'session', db_user: `postgres.${NEW_REF}` }]);
        case 'third-party-auth': return r(200, []);
        case 'auth-config': return r(200, { site_url: 'http://localhost:3000', disable_signup: false, external_email_enabled: true, external_anonymous_users_enabled: false });
        case 'postgrest': return r(200, { db_schema: 'public,graphql_public', max_rows: 1000 });
        case 'api-keys': return r(200, [{ name: 'default', type: 'publishable', api_key: PUBLISHABLE }, { name: 'default', type: 'secret', api_key: 'sb_secret_abcd••••••••' }]);
        case 'secrets': return r(200, ['SUPABASE_ANON_KEY', 'SUPABASE_DB_URL', 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'].map((name) => ({ name, value: 'digest' })));
        case 'db-migrations': return r(200, []);
        case 'query': {
          if (cls.ref === F.STAGING_REF) {
            if (body.query === F.STAGING_PREPAUSE_SQL) return r(201, [{ json_build_object: { now: new Date().toISOString(), cron_available: true, auth_activity: { last_sign_in_at: '2026-09-21T14:44:26Z', sessions_total: 9, sessions_touched_60m: 0, sessions_touched_24h: 0, sign_ins_60m: 0, sign_ins_24h: 0 }, client_connections: [] } }]);
            if (body.query === F.STAGING_CRON_SQL) return r(201, [{ jobs: [{ jobid: 1, jobname: 'rehearsal-internal', schedule: '*/5 * * * *', active: true, hosts: [`${F.STAGING_REF}.supabase.co`], command_md5: 'x', runs_24h: 288, failed_24h: 0 }] }]);
            throw new Error('unexpected staging sql');
          }
          const q = psql(`select row_to_json(t) from (${body.query}) t`, { readOnly: true });
          if (!q.ok) return r(400, { message: q.err.slice(0, 300) });
          return r(201, q.out ? q.out.split('\n').map((l) => JSON.parse(l)) : []);
        }
        case 'pause': w.writes.push('pause'); w.pausing = 3; return r(200, {});
        case 'create': w.writes.push('create'); if (!F.DB_PASSWORD_PATTERN.test(body.db_pass)) throw new Error('bad pass'); w.torneos = 'COMING_UP'; return r(201, proj(NEW_REF, F.PROJECT_NAME, 'COMING_UP', 'sa-east-1'));
        default: throw new Error(`unhandled ${cls.id}`);
      }
    };
    const kc = { state: 'ABSENT', namespace: { ...F.KEYCHAIN_DB }, check() { return this.state; }, generate() { if (this.state === 'PRESENT') throw new Error('present'); this.state = 'PRESENT'; return 'KEYCHAIN_GENERATED'; }, read() { if (this.state !== 'PRESENT') throw new Error('absent'); return FAKE_DB_PASS; } };
    const applyFile = async ({ file, env }) => {
      if (env.PGPASSWORD !== FAKE_DB_PASS || env.PGUSER !== `postgres.${NEW_REF}` || env.PGSSLMODE !== 'verify-full') return { code: 97, elapsed_ms: 0, stderr_tail: 'env contract violated' };
      const t0 = Date.now(); const r = psql(null, { file });
      return { code: r.code ?? -1, elapsed_ms: Date.now() - t0, stderr_tail: r.ok ? null : r.err.split('\n').slice(-6).join('\n') };
    };
    let probeTransport = async () => ({ status: 0, body: null });
    const evDir = path.join(EVIDENCE_DIR, `rehearsal-${stamp}`);
    const pinFile = path.join(HERE, 'pins/expected-catalog.json');
    let seq = 0;
    const phase = async (label, mode, expect, { phrase = 'plan', pinOverride } = {}) => {
      const said = [];
      const deps = {
        transport, probeTransport: (req) => probeTransport(req), keychain: kc, applyFile, psqlPrerequisites: () => [],
        tty: { readLine: () => { if (phrase !== 'plan') return phrase; const m = /To proceed type exactly:\n {2}(.+)\n/.exec(said.join('\n')); return m ? m[1] : ''; } },
        now: () => Date.now(), sleep: async () => {}, pollIntervalMs: 1, say: (s) => said.push(s),
        evidenceDir: evDir, evidencePrefix: `REHEARSAL-${String(++seq).padStart(2, '0')}-`, annotation: `OFFLINE REHEARSAL ${stamp} — local ${DB_IMAGE} (internal network), local PostgREST ${PGRST_IMAGE}, emulated Management API and Keychain; NOT a remote run`,
        expectedCatalogFile: pinOverride ?? pinFile,
      };
      let verdict; let detail = null;
      try { const res = await runFoundation({ mode, request: { pat: PAT }, deps }); verdict = res.verdict + (res.b03 ? ` ${res.b03}` : ''); } catch (e) { verdict = e instanceof StopError ? `STOP:${e.code}` : `ERROR:${e.message}`; detail = e.detail ?? null; }
      const pass = verdict.startsWith(expect);
      phases.push({ label, mode, expect, verdict, pass, detail: pass ? null : detail });
      log(`[${pass ? 'PASS' : 'FAIL'}] ${label}: ${verdict}${pass ? '' : ` (expected ${expect}) ${JSON.stringify(detail).slice(0, 600)}`}`);
      for (const s of said) lines.push(`    | ${s}`);
    };

    await phase('P01 staging pre-pause (read-only)', '--staging-prepause', 'STAGING_PREPAUSE_PASS');
    await phase('P02 create preflight while Staging active → blocked', '--create-preflight', 'STOP:CREATE_BLOCKED');
    await phase('P03 pause with a wrong phrase → nothing written', '--pause-staging', 'STOP:NOT_AUTHORIZED', { phrase: `PAUSE CORE STAGING ${F.STAGING_REF}` });
    if (w.writes.length) throw new Error('write after a wrong phrase');
    await phase('P04 pause Core Staging', '--pause-staging', 'STAGING_PAUSED_SLOT_FREE');
    await phase('P05 pause again → no-op', '--pause-staging', 'STAGING_ALREADY_INACTIVE');
    await phase('P06 create preflight', '--create-preflight', 'CREATE_PREFLIGHT_PASS');
    await phase('P07 create Arma2 Torneos', '--create-project', 'ARMA2_TORNEOS_ACTIVE_HEALTHY');
    await phase('P08 create again → resume, no second project', '--create-project', 'ARMA2_TORNEOS_ACTIVE_HEALTHY');
    if (w.writes.filter((x) => x === 'create').length !== 1) throw new Error('more than one create');
    await phase('P09 migrate 0000–0003 (real psql, certified bytes)', '--migrate', 'MIGRATIONS_0000_0003_APPLIED');
    await phase('P10 migrate again → already installed, nothing sent', '--migrate', 'MIGRATIONS_ALREADY_INSTALLED');

    // ── derive the catalog pin from the container (installer postgres, after 0003) ──
    const cat = psql(`select row_to_json(t) from (${F.CATALOG_SQL}) t`, { readOnly: true });
    if (!cat.ok) throw new Error(`catalog failed: ${cat.err}`);
    const catalog = JSON.parse(cat.out).json_build_object;
    const inv = F.catalogInvariantFailures(catalog);
    if (inv.length) throw new Error(`rehearsal catalog breaks invariants: ${inv.join(',')}`);
    const pin = { derived_by: 'offline-rehearsal.mjs', derived_at: new Date().toISOString(), image: DB_IMAGE, server_version: version, installer: 'postgres (non-superuser)', migrations: F.MIGRATIONS.map((m) => ({ seq: m.seq, file: m.file, sha256: m.sha256 })), catalog_sql_sha256: F.sha256(F.CATALOG_SQL), strict_paths: F.STRICT_CATALOG_PATHS, catalog };
    fs.mkdirSync(path.dirname(pinFile), { recursive: true });
    const pinText = `${JSON.stringify(pin, null, 1)}\n`;
    if (fs.existsSync(pinFile)) {
      const old = JSON.parse(fs.readFileSync(pinFile, 'utf8'));
      const drift = F.catalogDiff(catalog, old.catalog);
      if (drift.length) throw new Error(`existing pin differs from this rehearsal: ${JSON.stringify(drift).slice(0, 600)}`);
      log(`pin unchanged vs existing ${path.basename(pinFile)} (strict paths identical)`);
    } else { fs.writeFileSync(pinFile, pinText); log(`pin written ${path.basename(pinFile)} sha256 ${F.sha256(pinText)}`); }

    // ── PostgREST (hosted-equivalent state: no pre-request) behind an emulated platform gateway ──
    // PostgREST publishes on 127.0.0.1 from its own bridge and joins the internal DB network; the DB container
    // itself never gets a route out. No image is pulled: both images are already local.
    // Rehearsal-only: give the container's authenticator the throwaway password so PostgREST can log in over TCP.
    const auth = psql(`alter role authenticator with password '${LOCAL_PW}'`, { user: 'supabase_admin' });
    if (!auth.ok) throw new Error(`authenticator password: ${auth.err.slice(0, 200)}`);
    const BR = `${NET}-edge`; docker(['network', 'create', BR]);
    docker(['run', '-d', '--rm', '--network', BR, '-p', '127.0.0.1::3000', '--name', PGRST, '-e', `PGRST_DB_URI=postgres://authenticator:${LOCAL_PW}@db:5432/postgres`, '-e', 'PGRST_DB_SCHEMAS=public,graphql_public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${JWT_SECRET}`, '-e', 'PGRST_DB_EXTRA_SEARCH_PATH=public,extensions', '-e', 'PGRST_SERVER_PORT=3000', '--pull', 'never', PGRST_IMAGE]);
    docker(['network', 'connect', NET, PGRST]);
    pgrstPort = Number(docker(['port', PGRST, '3000/tcp']).trim().split('\n')[0].split(':').pop());
    for (let i = 0; i < 60; i++) { const ok = await new Promise((res) => http.get({ host: '127.0.0.1', port: pgrstPort, path: '/', headers: { Accept: 'application/openapi+json' } }, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false))); if (ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    const alive = docker(['ps', '--filter', `name=${PGRST}`, '--format', '{{.Status}}']).trim();
    if (!alive.startsWith('Up')) throw new Error(`postgrest not running: ${docker(['logs', PGRST]).slice(-400)}`);
        for (let i = 0; i < 60; i++) { const ok = await new Promise((res) => http.get({ host: '127.0.0.1', port: pgrstPort, path: '/' }, (r) => { r.resume(); res(r.statusCode < 500); }).on('error', () => res(false))); if (ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    gateway = (req) => new Promise((resolve, reject) => {
      if (req.headers.apikey !== PUBLISHABLE) { resolve({ status: 401, body: { message: 'No API key found in request' } }); return; }
      const headers = { Accept: 'application/json' };
      if (req.headers.Authorization) headers.Authorization = req.headers.Authorization;
      if (req.headers['Accept-Profile']) headers['Accept-Profile'] = req.headers['Accept-Profile'];
      const payload = req.body === undefined ? null : JSON.stringify(req.body);
      if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
      const hr = http.request({ host: '127.0.0.1', port: pgrstPort, method: req.method, path: req.path.replace(/^\/rest\/v1/, '') || '/', headers }, (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => { const raw = Buffer.concat(c).toString('utf8'); let b = null; try { b = JSON.parse(raw); } catch { b = null; } resolve({ status: res.statusCode, body: b, raw }); }); });
      hr.on('error', reject); if (payload) hr.write(payload); hr.end();
    });
    probeTransport = (req) => gateway(req);

    await phase('P11 certify (catalog pin, invariants, real PostgREST probes)', '--certify', 'TORNEOS_DB_CERTIFIED B03_REMOTE_ACTION_REQUIRED');

    // ── negative controls: the certification must fail on a tampered database ──
    const tamper = psql("grant select on public.tournament_payment_provider_watermarks to anon");
    if (!tamper.ok) throw new Error(`tamper failed ${tamper.err}`);
    await phase('P12 negative control: anon SELECT on the watermark → certification fails', '--certify', 'STOP:TORNEOS_DB_CERTIFICATION_FAILED');
    psql('revoke select on public.tournament_payment_provider_watermarks from anon');
    await phase('P13 control restored → certified again', '--certify', 'TORNEOS_DB_CERTIFIED');

    // ── foreign-token proof: a JWT a Torneos-project GoTrue would mint (valid signature, iss = project auth) ──
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ iss: `https://${NEW_REF}.supabase.co/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: crypto.randomUUID(), iat: now, exp: now + 600, session_id: crypto.randomUUID(), is_anonymous: false });
    const gotrue = `${h}.${p}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;
    const foreign = [];
    for (const [name, req] of [
      ['GoTrue token: own torneos_identity row', { method: 'GET', path: '/rest/v1/torneos_identity?select=*' }],
      ['GoTrue token: get_my_tournament_memberships', { method: 'POST', path: '/rest/v1/rpc/get_my_tournament_memberships', body: {} }],
      ['GoTrue token: create_tournament_season_checkout_purchase', { method: 'POST', path: '/rest/v1/rpc/create_tournament_season_checkout_purchase', body: { p_organization_id: crypto.randomUUID(), p_season_id: crypto.randomUUID(), p_idempotency_key: crypto.randomUUID() } }],
      ['GoTrue token: watermark table', { method: 'GET', path: '/rest/v1/tournament_payment_provider_watermarks?select=*' }],
    ]) {
      const res = await gateway({ ...req, headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${gotrue}` } });
      const rows = Array.isArray(res.body) ? res.body.length : null;
      const pass = res.status >= 400 || rows === 0 || (res.body && typeof res.body === 'object' && !Array.isArray(res.body) && Object.keys(res.body).length === 0);
      foreign.push({ name, status: res.status, code: res.body?.code ?? null, message: typeof res.body?.message === 'string' ? res.body.message.slice(0, 100) : null, rows, pass });
    }
    // DB-level sweep: every function `authenticated` may execute, called with NULL arguments under a GoTrue-shaped
    // claim set, each in its own rolled-back transaction; a call that returns AND assigned a transaction id wrote.
    const fns = psql("select p.oid::regprocedure::text || '|' || p.pronargs || '|' || quote_ident(n.nspname) || '.' || quote_ident(p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.prokind = 'f' order by 1", { readOnly: true }).out.split('\n').filter(Boolean);
    const claims = JSON.stringify({ iss: `https://${NEW_REF}.supabase.co/auth/v1`, role: 'authenticated', sub: crypto.randomUUID(), aud: 'authenticated' });
    let sweepSql = '';
    for (const row of fns) {
      const [sig, n, name] = row.split('|');
      const args = Array(Number(n)).fill('NULL').join(',');
      sweepSql += `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '${claims}', true);\n\\set QUIET on\nselect 'CALL|${sig}|' || (select count(*) from (select ${name}(${args})) x)::text || '|' || coalesce(txid_current_if_assigned()::text, 'none');\nrollback;\n`;
    }
    const sweep = spawnSync(DOCKER, ['exec', '-i', '-e', `PGPASSWORD=${LOCAL_PW}`, DB, 'psql', '-U', 'postgres', '-h', 'localhost', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=0'], { input: sweepSql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const returned = (sweep.stdout ?? '').split('\n').filter((l) => l.startsWith('CALL|')).map((l) => { const [, sig, count, xid] = l.split('|'); return { sig, count: Number(count), wrote: xid !== 'none' }; });
    const writers = returned.filter((r) => r.wrote);
    const foreignResult = { postgrest: foreign, postgrest_pass: foreign.every((f) => f.pass), db_sweep: { authenticated_functions: fns.length, returned_without_error: returned.length, wrote: writers.map((x) => x.sig), returned_rows: returned.filter((x) => x.count > 0).map((x) => x.sig) } };
    const foreignPass = foreignResult.postgrest_pass && writers.length === 0;
    phases.push({ label: 'P14 foreign GoTrue-shaped token cannot read Torneos identity data nor write (PostgREST + NULL-arg sweep)', pass: foreignPass, verdict: foreignPass ? 'FOREIGN_TOKEN_FAIL_CLOSED' : 'FOREIGN_TOKEN_EXPOSURE', detail: foreignResult });
    log(`[${foreignPass ? 'PASS' : 'FAIL'}] P14 foreign GoTrue-shaped token: ${JSON.stringify({ postgrest: foreign.map((f) => `${f.status}${f.code ? '/' + f.code : ''}`), fns: fns.length, returned: returned.length, wrote: writers.length })}`);

    const result = { rehearsal: stamp, image: DB_IMAGE, postgrest_image: PGRST_IMAGE, server_version: version, phases, all_pass: phases.every((x) => x.pass), management_api_writes_emulated: w.writes, remote_calls: 0 };
    const out = `${JSON.stringify(result, null, 1)}\n`;
    const leaks = F.secretFindings(out, [LOCAL_PW, JWT_SECRET, PAT, PUBLISHABLE, FAKE_DB_PASS]);
    if (leaks.length) throw new Error(`rehearsal result carries a secret: ${leaks}`);
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'REHEARSAL-result.json'), out);
    const logText = lines.join('\n');
    if (F.secretFindings(logText, [LOCAL_PW, JWT_SECRET, PAT, PUBLISHABLE, FAKE_DB_PASS]).length) throw new Error('rehearsal log carries a secret');
    fs.writeFileSync(path.join(evDir, 'REHEARSAL-runner-output.log'), `${logText}\n`);
    for (const f of fs.readdirSync(evDir)) { const t = fs.readFileSync(path.join(evDir, f), 'utf8'); if (F.secretFindings(t, [LOCAL_PW, JWT_SECRET, PAT, PUBLISHABLE, FAKE_DB_PASS]).length) throw new Error(`secret in ${f}`); }
    log(`\nREHEARSAL ${result.all_pass ? 'PASS' : 'FAIL'} ${phases.filter((x) => x.pass).length}/${phases.length} → ${path.relative(F.REPO_ROOT, evDir)}`);
    process.exitCode = result.all_pass ? 0 : 1;
  } finally {
    for (const c of [PGRST, DB]) spawnSync(DOCKER, ['rm', '-f', c], { stdio: 'ignore' });
    for (const n of [`${NET}-edge`, NET]) spawnSync(DOCKER, ['network', 'rm', n], { stdio: 'ignore' });
    const left = spawnSync(DOCKER, ['ps', '-a', '--filter', `name=infra1-r3-`, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.trim();
    log(`cleanup: containers left = ${left ? left : 0}`);
  }
}
main().catch((e) => { console.error(e.stack ?? e.message); process.exitCode = 1; });
