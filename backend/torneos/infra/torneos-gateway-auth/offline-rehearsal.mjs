#!/usr/bin/env node
// GATEWAY/AUTH (G1 + G2) — OFFLINE REHEARSAL. Nothing leaves this machine; no remote project is read or written.
//
//   • DB: a throwaway supabase/postgres:17.6.1.147 on an --internal Docker network (no egress), migrations 0000–0003
//     installed as the non-superuser installer `postgres` (as hosted, as the foundation rehearsal).
//   • PostgREST v14.15 (local image) behind an in-process emulation of the platform gateway (apikey required). It starts
//     like hosted Torneos today (the project's own HS256 secret, no pre-request) and, when the emulated B03 publishes
//     custom_jwks, is restarted with exactly that JWKS. The pre-request comes from the DATABASE (ALTER ROLE authenticator),
//     reloaded by the NOTIFY inside the bootstrap transaction.
//   • Management API: emulated in memory for the pinned refs (Core Production, Staging, old, Torneos); every read-only
//     SQL the runner sends runs in the container with default_transaction_read_only=on. Keychain and tty: fakes.
//   • The REAL runner drives every mode (--preflight → --auth-lockdown → --db-bootstrap → --keyring-generate → --b03 →
//     --deploy-preflight → --certify) plus negative controls. The gateway-auth delta pin is derived here, from a
//     ROLLED-BACK run of the exact bootstrap SQL, before the runner commits it.
//   • Gateway E2E: the REAL gateway sources (gateway-loader.mjs) with Production-topology configuration (Core Production
//     URLs as fixtures served in-process, the Torneos REST URL routed to the local PostgREST, postgres.js 3.4.7 from the
//     local Deno cache behind an emulated Supavisor relay), the real torneos_edge_* logins and the rehearsal ring.
//   • Optional Deno leg (DENO_BIN): the unmodified entrypoint boots on Deno 2.x with Core Production URLs; --allow-net is
//     loopback only, so Core is unreachable by construction (no packet leaves) → /exchange = 503.
// Evidence: backend/torneos/mp-b/evidence/gateway-auth/rehearsal-<stamp>/ (REHEARSAL- prefix, annotated, secret-scanned).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as G from './gateway-auth-contract.mjs';
import * as FC from '../torneos-foundation/foundation-contract.mjs';
import { runGatewayAuth, StopError, EVIDENCE_DIR, validateGatewayEnvWithRealConfig } from './gateway-auth.mjs';
import { splitParts, joinParts, parseMeta } from './keyring.mjs';
import { mintBridgeToken } from './bridge-probe.mjs';
import { loadGatewayTree } from './gateway-loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCKER = ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
if (!DOCKER) { console.error('docker not found'); process.exit(2); }
const DB_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.147';
const PGRST_IMAGE = 'public.ecr.aws/supabase/postgrest:v14.15';
const RELAY_IMAGE = 'node:22.22.0-bookworm-slim';
const PG_JS = path.join(os.homedir(), 'Library/Caches/deno/npm/registry.npmjs.org/postgres/3.4.7/src/index.js');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const NET = `ga-net-${process.pid}`; const EDGE = `${NET}-edge`; const DB = `ga-db-${process.pid}`; const PGRST = `ga-pgrst-${process.pid}`; const RELAY = `ga-relay-${process.pid}`;
// Throwaway values of throwaway containers (they die with the run); not credentials of anything real.
const LOCAL_PW = crypto.randomBytes(18).toString('base64url');
const PROJECT_JWT_SECRET = crypto.randomBytes(32).toString('base64url');
const PAT = `sbp_${crypto.randomBytes(20).toString('hex')}`;
const PUBLISHABLE = `sb_publishable_${crypto.randomBytes(16).toString('base64url')}`;
const INSTALLER_PW = crypto.randomBytes(30).toString('base64url');
const CORE_JWT_SECRET = crypto.randomBytes(32);
const CONTRACT_SECRET = crypto.randomBytes(32).toString('hex');
const GATEWAY_HOST = 'torneos-gateway.rehearsal.invalid';
const docker = (args, opts = {}) => execFileSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
const lines = [];
const log = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function psql(sql, { user = 'postgres', readOnly = false, file = null } = {}) {
  const env = ['-e', `PGPASSWORD=${LOCAL_PW}`]; if (readOnly) env.push('-e', 'PGOPTIONS=-c default_transaction_read_only=on');
  const r = spawnSync(DOCKER, ['exec', '-i', ...env, DB, 'psql', '-U', user, '-h', 'localhost', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: file ? fs.readFileSync(file) : sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), code: r.status };
}
const httpJson = (port, { method = 'GET', path: p, headers = {}, body }) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  const h = { ...headers }; if (payload) { h['Content-Type'] = h['Content-Type'] ?? 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => { const raw = Buffer.concat(c).toString('utf8'); let b = null; try { b = JSON.parse(raw); } catch { b = null; } resolve({ status: res.statusCode, body: b, raw, headers: res.headers }); }); });
  req.on('error', reject); if (payload) req.write(payload); req.end();
});

async function main() {
  const phases = [];
  const record = (label, pass, verdict, detail = null) => { phases.push({ label, pass, verdict, detail: pass ? null : detail }); log(`[${pass ? 'PASS' : 'FAIL'}] ${label}: ${verdict}${pass ? '' : ` ${JSON.stringify(detail).slice(0, 700)}`}`); };
  let pgrstPort = null; let relayPort = null;
  const known = [LOCAL_PW, PROJECT_JWT_SECRET, PAT, PUBLISHABLE, INSTALLER_PW, CONTRACT_SECRET, CORE_JWT_SECRET.toString('base64url')];
  const evDir = path.join(EVIDENCE_DIR, `rehearsal-${stamp}`);
  const jwksPinFile = path.join(os.tmpdir(), `ga-rehearsal-jwks-${process.pid}.json`); // rehearsal ring: never the real pin path
  const caFixture = path.join(os.tmpdir(), `ga-rehearsal-ca-${process.pid}.pem`);
  fs.writeFileSync(caFixture, '-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----\n');
  try {
    docker(['network', 'create', '--internal', NET]);
    docker(['network', 'create', EDGE]);
    docker(['run', '-d', '--rm', '--network', NET, '--network-alias', 'db', '--name', DB, '-e', `POSTGRES_PASSWORD=${LOCAL_PW}`, '--pull', 'never', DB_IMAGE]);
    for (let i = 0; i < 90; i++) { if (psql('select 1').ok) break; await sleep(1000); }
    if (!psql('select 1').ok) throw new Error('db did not come up');
    const version = psql("select current_setting('server_version')").out;
    log(`db up: ${DB_IMAGE} server_version ${version}`);
    for (const m of FC.loadMigrations(G.REPO_ROOT)) { const r = psql(null, { file: m.abs }); if (!r.ok) throw new Error(`migration ${m.seq}: ${r.err.slice(0, 300)}`); }
    log('migrations 0000–0003 installed as postgres (certified bytes)');
    const foundationPin = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8'));
    const cat0 = JSON.parse(psql(`select row_to_json(t) from (${G.CATALOG_SQL}) t`, { readOnly: true }).out).json_build_object;
    const f0 = FC.catalogDiff(cat0, foundationPin.catalog);
    record('R00 rehearsal DB after 0000–0003 = certified foundation pin (strict paths)', f0.length === 0, f0.length ? 'FOUNDATION_DRIFT' : 'FOUNDATION_PIN_MATCH', f0);

    // ── PostgREST as hosted Torneos is today: own HS256 secret, no pre-request (the DB config decides) ──
    psql(`alter role authenticator with password '${LOCAL_PW}'`, { user: 'supabase_admin' });
    // measure(): optional token factory — polls from container start (before readiness) to record when the in-DB
    // pre_request takes effect (PostgREST can serve briefly without it when it boots through connection recovery).
    const startPgrst = async (jwtSecret, aud = null, measure = null) => {
      spawnSync(DOCKER, ['rm', '-f', PGRST], { stdio: 'ignore' });
      const env = ['-e', `PGRST_DB_URI=postgres://authenticator:${LOCAL_PW}@db:5432/postgres`, '-e', 'PGRST_DB_SCHEMAS=public,graphql_public', '-e', 'PGRST_DB_ANON_ROLE=anon',
        '-e', `PGRST_JWT_SECRET=${jwtSecret}`, '-e', 'PGRST_DB_EXTRA_SEARCH_PATH=public,extensions', '-e', 'PGRST_SERVER_PORT=3000', '-e', 'PGRST_JWT_CACHE_MAX_LIFETIME=0', ...(aud ? ['-e', `PGRST_JWT_AUD=${aud}`] : [])];
      docker(['run', '-d', '--rm', '--network', EDGE, '-p', '127.0.0.1::3000', '--name', PGRST, ...env, '--pull', 'never', PGRST_IMAGE]);
      docker(['network', 'connect', NET, PGRST]);
      pgrstPort = Number(docker(['port', PGRST, '3000/tcp']).trim().split('\n')[0].split(':').pop());
      let window = null;
      if (measure) {
        const t0 = Date.now(); const seen = [];
        while (Date.now() - t0 < 4000) {
          const s = await httpJson(pgrstPort, { path: '/torneos_identity?select=id&limit=1', headers: { Authorization: `Bearer ${measure()}` } }).then((r) => `${r.status}${r.body?.code ? `/${r.body.code}` : ''}`).catch(() => 'ERR');
          if (!seen.length || seen[seen.length - 1][1] !== s) seen.push([Date.now() - t0, s]);
          await sleep(25);
        }
        window = { transitions: seen, served_without_pre_request_ms: seen.filter(([, v]) => v === '200').length ? (seen.find(([, v], i) => i > seen.findIndex(([, x]) => x === '200') && v !== '200')?.[0] ?? 4000) - seen.find(([, v]) => v === '200')[0] : 0 };
      }
      for (let i = 0; i < 60; i++) { const ok = await httpJson(pgrstPort, { path: '/tournament_competition_formats?limit=1' }).then((r) => r.status === 200).catch(() => false); if (ok) return window; await sleep(500); }
      throw new Error(`postgrest not ready: ${docker(['logs', PGRST]).slice(-400)}`);
    };
    await startPgrst(PROJECT_JWT_SECRET);
    const platform = (req) => {
      if (req.headers?.apikey !== PUBLISHABLE) return Promise.resolve({ status: 401, body: { message: 'No API key found in request' } });
      const headers = { Accept: 'application/json' };
      for (const k of ['Authorization', 'authorization', 'Accept-Profile', 'Prefer', 'Content-Type', 'Range']) if (req.headers[k]) headers[k] = req.headers[k];
      return httpJson(pgrstPort, { method: req.method, path: req.path.replace(/^\/rest\/v1/, '') || '/', headers, body: req.body });
    };
    const probeTransport = (req) => { if (req.ref !== G.TORNEOS_REF) throw new Error('probe outside Torneos'); return platform(req); };
    // A token the Torneos project's own GoTrue would mint (valid HS256 with the project secret).
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now0 = Math.floor(Date.now() / 1000);
    const gh = b64({ alg: 'HS256', typ: 'JWT' }); const gp = b64({ iss: `https://${G.TORNEOS_REF}.supabase.co/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: crypto.randomUUID(), iat: now0, exp: now0 + 3600 });
    const gotrueToken = `${gh}.${gp}.${crypto.createHmac('sha256', PROJECT_JWT_SECRET).update(`${gh}.${gp}`).digest('base64url')}`;
    const beforeGate = await platform({ method: 'GET', path: '/rest/v1/tournament_competition_formats?select=*&limit=1', headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${gotrueToken}` } });

    // ── emulated control plane ──
    const w = { auth: { site_url: 'http://localhost:3000', uri_allow_list: '', disable_signup: false, jwt_exp: 3600, external_anonymous_users_enabled: false, external_email_enabled: true, external_phone_enabled: false,
      mailer_autoconfirm: false, sms_autoconfirm: false, external_google_enabled: false, external_apple_enabled: false, external_github_enabled: false, external_azure_enabled: false, saml_enabled: false,
      hook_custom_access_token_enabled: false, security_manual_linking_enabled: false, mfa_totp_enroll_enabled: true, ...Object.fromEntries(G.AUTH_MUST_BE_OFF.map((k) => [k, false])) },
      tpa: [], functions: [], writes: [], extraProject: null, pgrstWindow: null };
    // Emulated GoTrue of the Torneos project: answers from the emulated Auth config (the W1 refusal probes).
    const authProbeTransport = async ({ ref, method, path: p }) => {
      if (ref !== G.TORNEOS_REF) throw new Error('auth probe outside Torneos');
      if (method === 'GET' && p === '/auth/v1/settings') return { status: 200, body: { disable_signup: w.auth.disable_signup, external: { email: w.auth.external_email_enabled, phone: w.auth.external_phone_enabled, anonymous_users: w.auth.external_anonymous_users_enabled } } };
      if (w.auth.disable_signup) return { status: 422, body: { error_code: p.endsWith('/otp') ? 'otp_disabled' : 'signup_disabled' } };
      return { status: 200, body: {} };
    };
    const proj = (ref, name, status, region) => ({ ref, id: ref, name, organization_slug: G.ORG_SLUG, region, status });
    const projects = () => [proj(G.CORE_PROD_REF, "nicoavayu's Project", 'ACTIVE_HEALTHY', 'sa-east-1'), proj(G.STAGING_REF, 'arma2-torneos-staging', 'INACTIVE', 'us-east-1'), proj(G.OLD_REF, 'Arma2', 'INACTIVE', 'us-west-2'), proj(G.TORNEOS_REF, G.PROJECT_NAME, 'ACTIVE_HEALTHY', 'sa-east-1'), ...(w.extraProject ? [w.extraProject] : [])];
    let jwksPinForEmu = null;
    const transport = async ({ pat, method, path: p, body }) => {
      if (pat !== PAT) throw new Error('pat mismatch');
      const cls = G.classifyRequest({ method, path: p, body }, { mode: Object.keys(G.MODE_ENDPOINTS).find((m) => G.MODE_ENDPOINTS[m].includes(G.ENDPOINTS.find((e) => e.method === method && e.re.test(p))?.id)), armedFor: method === 'PATCH' ? 'auth-lockdown' : (method === 'POST' && p.endsWith('/third-party-auth') ? 'b03' : null), jwksPin: jwksPinForEmu });
      const r = (status, b) => ({ status, body: b, raw: JSON.stringify(b) });
      switch (cls.id) {
        case 'org': return r(200, { slug: G.ORG_SLUG, name: "nicoavayu's Org", plan: 'free' });
        case 'projects': return r(200, projects());
        case 'prod-project': return r(200, projects()[0]);
        case 'prod-contract-fn': return r(200, { slug: G.CORE_CONTRACT_SLUG, status: 'ACTIVE', version: 3, verify_jwt: false, ezbr_sha256: G.CORE_CONTRACT_EZBR });
        case 'project': return r(200, projects().find((x) => x.ref === cls.ref));
        case 'health': return r(200, ['auth', 'db', 'pooler', 'rest', 'db_postgres_user'].map((name) => ({ name, status: 'ACTIVE_HEALTHY' })));
        case 'functions': return r(200, w.functions);
        case 'secrets': return r(200, ['SUPABASE_ANON_KEY', 'SUPABASE_DB_URL', 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'].map((name) => ({ name, value: 'digest' })));
        case 'auth-config': return r(200, { ...w.auth, jwt_secret: 'never-projected' });
        case 'third-party-auth': return r(200, w.tpa);
        case 'postgrest': return r(200, { db_schema: 'public,graphql_public', max_rows: 1000 });
        case 'api-keys': return r(200, [{ name: 'default', type: 'publishable', api_key: PUBLISHABLE }, { name: 'default', type: 'secret', api_key: 'sb_secret_abcd••••••••' }]);
        case 'db-migrations': return r(200, []);
        case 'pooler': return r(200, [{ db_host: 'aws-0-sa-east-1.pooler.supabase.com', db_port: 5432, pool_mode: 'session', db_user: `postgres.${G.TORNEOS_REF}` }, { db_host: 'aws-0-sa-east-1.pooler.supabase.com', db_port: 6543, pool_mode: 'transaction' }]);
        case 'query': {
          const q = psql(`select row_to_json(t) from (${body.query}) t`, { readOnly: true });
          if (!q.ok) return r(400, { message: q.err.slice(0, 300) });
          return r(201, q.out ? q.out.split('\n').map((l) => JSON.parse(l)) : []);
        }
        case 'auth-lockdown': w.writes.push('auth-lockdown'); Object.assign(w.auth, body); return r(200, { ...w.auth });
        case 'tpa-create': {
          w.writes.push('tpa-create');
          const row = { id: crypto.randomUUID(), type: 'custom_jwks', oidc_issuer_url: null, jwks_url: null, custom_jwks: body.custom_jwks, resolved_at: new Date().toISOString() };
          w.tpa.push(row);
          const k1 = jwksPinForEmu.keys[0].kid;
          w.pgrstWindow = await startPgrst(JSON.stringify(body.custom_jwks), null, () => mintBridgeToken({ pkcs8: keychain.ring.read('k1', k1), kid: k1 })); // hosted: the Data API now trusts exactly this JWKS
          return r(201, row);
        }
        default: throw new Error(`unhandled ${cls.id}`);
      }
    };

    // ── fake custody ──
    const kcStore = new Map();
    const keychain = {
      dbLogin: (login) => ({
        check: () => (kcStore.has(`gwdb/${login}`) ? 'PRESENT' : 'ABSENT'),
        generate: () => { if (kcStore.has(`gwdb/${login}`)) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_OVERWRITE'); const v = crypto.randomBytes(30).toString('base64url'); kcStore.set(`gwdb/${login}`, v); known.push(v); return true; },
        read: () => { const v = kcStore.get(`gwdb/${login}`); if (!v) throw new Error('absent'); return v; },
      }),
      dataplane: { check: () => 'PRESENT', read: () => INSTALLER_PW },
      ring: {
        check() { const s = ['k1.meta', 'k1.part0', 'k2.meta', 'k2.part0'].map((a) => kcStore.has(`ring/${a}`)); return s.every(Boolean) ? 'PRESENT' : s.some(Boolean) ? 'PARTIAL' : 'ABSENT'; },
        store(ring) { if (this.check() !== 'ABSENT') throw new Error('present'); for (const s of ring.slots) { const { parts, meta } = splitParts(s.pkcs8, s.kid); parts.forEach((x, i) => kcStore.set(`ring/${s.slot}.part${i}`, x)); kcStore.set(`ring/${s.slot}.meta`, meta); known.push(s.pkcs8); } return 'KEYCHAIN_RING_STORED'; },
        read(slot, kid) { const m = parseMeta(kcStore.get(`ring/${slot}.meta`)); const parts = Array.from({ length: m.parts }, (_, i) => kcStore.get(`ring/${slot}.part${i}`)); return joinParts(kcStore.get(`ring/${slot}.meta`), parts, kid); },
      },
    };
    // ── the psql leg: the certified SQL bytes the runner rendered, on stdin, as postgres (the hosted installer) ──
    let psqlMode = 'normal'; const psqlRuns = [];
    const applySql = async ({ sql, env }) => {
      if (env.PGPASSWORD !== INSTALLER_PW || env.PGUSER !== `postgres.${G.TORNEOS_REF}` || env.PGSSLMODE !== 'verify-full' || !/^aws-\d+-sa-east-1\.pooler\.supabase\.com$/.test(env.PGHOST)) return { code: 97, elapsed_ms: 0, stderr_tail: 'env contract violated' };
      if (!/^BEGIN;\n/.test(sql) || !/\nCOMMIT;\n$/.test(sql) || /PASSWORD '(?!SCRAM-SHA-256\$)/.test(sql)) return { code: 98, elapsed_ms: 0, stderr_tail: 'sql contract violated' };
      const t0 = Date.now();
      // Negative control: the installer without privilege (the unmeasured hosted risk) → the whole transaction rolls back.
      const r = psql(psqlMode === 'unprivileged' ? sql.replace(/^BEGIN;\n/, 'BEGIN;\nSET LOCAL ROLE anon;\n') : sql);
      psqlRuns.push({ mode: psqlMode, ok: r.ok });
      return { code: r.ok ? 0 : 3, elapsed_ms: Date.now() - t0, stderr_tail: r.ok ? null : r.err.split('\n').slice(-3).join('\n') };
    };

    // ── the delta pin: derived from a ROLLED-BACK run of the exact bootstrap SQL (fixed throwaway verifiers) ──
    const deltaPinFile = G.DELTA_PIN_FILE;
    const fixtureVerifiers = Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, G.scramVerifier(crypto.randomBytes(30).toString('base64url'))]));
    const derive = psql(`${G.renderBootstrapSql(fixtureVerifiers).replace(/NOTIFY[^\n]*\n/g, '').replace(/COMMIT;\n$/, '')}\nselect row_to_json(t) from (${G.CATALOG_SQL}) t;\nselect row_to_json(t) from (${G.GATEWAY_ROLES_SQL}) t;\nROLLBACK;\n`);
    if (!derive.ok) throw new Error(`delta derivation failed: ${derive.err.slice(0, 400)}`);
    const [dc, dr] = derive.out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l).json_build_object);
    const stillPending = psql("select count(*) from pg_roles where rolname like 'torneos_edge%'", { readOnly: true }).out;
    const deltaPin = { derived_by: 'offline-rehearsal.mjs (rolled-back run of the exact bootstrap SQL)', derived_at: new Date().toISOString(), image: DB_IMAGE, server_version: version, installer: 'postgres (non-superuser)',
      foundation_pin_sha256: G.FOUNDATION_FILES['backend/torneos/infra/torneos-foundation/pins/expected-catalog.json'], bootstrap_sql_template_sha256: G.sha256(G.BOOTSTRAP_SQL_TEMPLATE), catalog_sql_sha256: G.sha256(G.CATALOG_SQL),
      gateway_roles_sql_sha256: G.sha256(G.GATEWAY_ROLES_SQL), delta_paths: G.DELTA_PATHS, catalog: Object.fromEntries(G.DELTA_PATHS.map((p) => [p, dc[p]])), roles: { logins: dr.logins, memberships: dr.memberships } };
    const inv = G.gatewayInvariantFailures(dc, { ...dr, auth_users: 0 });
    const nonDelta = FC.STRICT_CATALOG_PATHS.filter((p) => !G.DELTA_PATHS.includes(p)).filter((p) => JSON.stringify(FC.getPath(dc, p)) !== JSON.stringify(FC.getPath(foundationPin.catalog, p)));
    record('R01 delta pin derived (rolled back): only the 4 delta paths move; invariants hold; nothing committed', inv.length === 0 && nonDelta.length === 0 && stillPending === '0', inv.length || nonDelta.length ? 'DELTA_DERIVATION_BROKE_INVARIANTS' : 'DELTA_DERIVED', { inv, nonDelta, stillPending });
    const pinText = `${JSON.stringify(deltaPin, null, 1)}\n`;
    if (fs.existsSync(deltaPinFile)) {
      const old = JSON.parse(fs.readFileSync(deltaPinFile, 'utf8'));
      const same = JSON.stringify(old.catalog) === JSON.stringify(deltaPin.catalog) && JSON.stringify(old.roles) === JSON.stringify(deltaPin.roles) && old.bootstrap_sql_template_sha256 === deltaPin.bootstrap_sql_template_sha256;
      record('R02 existing delta pin reproduced by this rehearsal', same, same ? 'DELTA_PIN_UNCHANGED' : 'DELTA_PIN_DRIFT');
    } else { fs.mkdirSync(path.dirname(deltaPinFile), { recursive: true }); fs.writeFileSync(deltaPinFile, pinText); log(`delta pin written ${path.basename(deltaPinFile)} sha256 ${G.sha256(pinText)}`); }

    // ── the runner ──
    let seq = 0;
    const phase = async (label, mode, expect, { phrase = 'plan', onPhrase = null, decisions } = {}) => {
      const said = [];
      const deps = {
        transport, probeTransport, authProbeTransport, keychain, applySql, psqlPrerequisites: () => [], validateGatewayEnv: validateGatewayEnvWithRealConfig, caCert: caFixture,
        tty: { readLine: () => { if (onPhrase) onPhrase(); if (phrase !== 'plan') return phrase; const m = /To proceed type exactly:\n {2}(.+)\n/.exec(said.join('\n')); return m ? m[1] : ''; } },
        now: () => Date.now(), sleep, b03ProbeIntervalMs: 750, say: (s) => said.push(s), jwksPinFile, deltaPinFile,
        evidenceDir: evDir, evidencePrefix: `REHEARSAL-${String(++seq).padStart(2, '0')}-`, deployDecisions: decisions,
        annotation: `OFFLINE REHEARSAL ${stamp} — local ${DB_IMAGE} (internal network) + ${PGRST_IMAGE}, emulated Management API / Keychain / tty; NOT a remote run`,
      };
      let verdict; let detail = null; let res = null;
      try { res = await runGatewayAuth({ mode, request: { pat: PAT }, deps }); verdict = res.verdict; } catch (e) { verdict = e instanceof StopError ? `STOP:${e.code}` : `ERROR:${e.message}`; detail = e.detail ?? null; }
      jwksPinForEmu = fs.existsSync(jwksPinFile) ? JSON.parse(fs.readFileSync(jwksPinFile, 'utf8')) : null;
      const pass = verdict.startsWith(expect);
      record(`${label} [${mode}]`, pass, verdict, detail);
      for (const s of said) lines.push(`    | ${s}`);
      return { verdict, detail, res };
    };
    const writesNow = () => w.writes.length;

    await phase('P01 preflight: foundation certified, nothing applied yet', '--preflight', 'GATEWAY_AUTH_PREFLIGHT_PASS');
    w.functions = [{ slug: 'torneos-gateway', status: 'ACTIVE', version: 1 }];
    await phase('P02 NEGATIVE: one Supabase Edge Function on Torneos → preflight blocked', '--preflight', 'STOP:GATEWAY_AUTH_PREFLIGHT_BLOCKED');
    w.functions = [];
    await phase('P03 NEGATIVE: db-bootstrap before the Auth lockdown → blocked (order)', '--db-bootstrap', 'STOP:DB_BOOTSTRAP_BLOCKED');
    await phase('P04 NEGATIVE: b03 before the ring → blocked (order)', '--b03', 'STOP:B03_BLOCKED');
    let n = writesNow();
    await phase('P05 NEGATIVE: auth lockdown, wrong phrase → nothing written', '--auth-lockdown', 'STOP:NOT_AUTHORIZED', { phrase: `LOCK TORNEOS AUTH ${G.TORNEOS_REF}` });
    await phase('P06 NEGATIVE: state changes between plan and phrase → re-validation stops, nothing written', '--auth-lockdown', 'STOP:STATE_CHANGED_SINCE_PLAN', { onPhrase: () => { w.auth.uri_allow_list = 'https://changed.invalid'; } });
    w.auth.uri_allow_list = '';
    record('P07 no Management API write after P05/P06', writesNow() === n, `writes=${writesNow() - n}`);
    await phase('P08 W1 auth lockdown', '--auth-lockdown', 'TORNEOS_AUTH_LOCKED');
    n = writesNow();
    await phase('P09 W1 again → already applied, no write', '--auth-lockdown', 'AUTH_LOCKDOWN_ALREADY_APPLIED');
    record('P10 idempotent W1: no second PATCH', writesNow() === n, `writes=${writesNow() - n}`);
    psqlMode = 'unprivileged';
    await phase('P11 NEGATIVE: bootstrap transaction fails (installer without privilege) → rolled back, nothing half-done', '--db-bootstrap', 'STOP:DB_BOOTSTRAP_ROLLED_BACK');
    const halfDone = psql("select (select count(*) from pg_roles where rolname like 'torneos_edge%') || '/' || (select count(*) from pg_roles, unnest(coalesce(rolconfig, array[]::text[])) c where rolname = 'authenticator' and c like 'pgrst.%')", { readOnly: true }).out;
    record('P12 after the failed transaction: 0 edge logins, 0 pgrst settings; custody kept for the retry (no regeneration)', halfDone === '0/0' && keychain.dbLogin('torneos_edge_identity_writer').check() === 'PRESENT', halfDone);
    psqlMode = 'normal';
    await phase('P13 W2+W3 db bootstrap (reuses the custody of the failed attempt)', '--db-bootstrap', 'TORNEOS_GATEWAY_DB_BOOTSTRAPPED');
    await phase('P14 W2+W3 again → already applied, nothing sent', '--db-bootstrap', 'DB_BOOTSTRAP_ALREADY_APPLIED');
    record('P15 exactly one successful psql transaction', psqlRuns.filter((x) => x.ok).length === 1, JSON.stringify(psqlRuns));
    // pre_request reloaded by the NOTIFY in the transaction (no PostgREST restart): the project's own GoTrue token is now refused.
    const afterGate = await platform({ method: 'GET', path: '/rest/v1/tournament_competition_formats?select=*&limit=1', headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${gotrueToken}` } });
    const anonAfter = await platform({ method: 'GET', path: '/rest/v1/tournament_competition_formats?select=*&limit=1', headers: { apikey: PUBLISHABLE } });
    record('P16 pre_request live via NOTIFY: Torneos-GoTrue token 200 before → 401 PT401 after; anon still 200', beforeGate.status === 200 && afterGate.status === 401 && afterGate.body?.code === 'PT401' && anonAfter.status === 200,
      `before=${beforeGate.status} after=${afterGate.status}/${afterGate.body?.code} anon=${anonAfter.status}`, { beforeGate: beforeGate.status, afterGate: afterGate.body, anonAfter: anonAfter.status });
    // The logins really authenticate with the Keychain passwords (SCRAM verifiers were all the server ever got).
    const loginCheck = G.EDGE_LOGINS.map((l) => { const r = spawnSync(DOCKER, ['exec', '-i', '-e', `PGPASSWORD=${keychain.dbLogin(l.login).read()}`, DB, 'psql', '-U', l.login, '-h', 'localhost', '-d', 'postgres', '-X', '-A', '-t', '-c', `set role ${l.memberOf}; select current_user`], { encoding: 'utf8' }); return (r.stdout ?? '').trim().split('\n').pop(); });
    const pwIsVerifier = psql("select count(*) from pg_authid where rolname like 'torneos_edge%' and rolpassword like 'SCRAM-SHA-256$4096:%'", { user: 'supabase_admin', readOnly: true }).out;
    record('P17 edge logins authenticate (SCRAM) with the custody passwords and can SET ROLE only into their baseline role', loginCheck.join(',') === G.EDGE_LOGINS.map((l) => l.memberOf).join(',') && pwIsVerifier === '2', `${loginCheck.join(',')} verifiers=${pwIsVerifier}`);
    await phase('P18 NEGATIVE: b03 before the ring exists → blocked', '--b03', 'STOP:B03_BLOCKED');
    await phase('P19 KR generate the ring (fake Keychain, rehearsal pin path)', '--keyring-generate', 'PRODUCTION_BRIDGE_RING_GENERATED');
    await phase('P20 KR again → refused (never regenerate over a ring)', '--keyring-generate', 'STOP:KEYRING_BLOCKED');
    await phase('P21 W5 B03 custom_jwks (PostgREST restarted with exactly the published JWKS) + measured probes', '--b03', 'B03_APPLIED_BRIDGE_ACCEPTED');
    n = writesNow();
    record(`M01 measured: PostgREST served ${w.pgrstWindow?.served_without_pre_request_ms ?? '?'} ms without the in-DB pre_request after the B03 restart (connection-recovery start); the runner's bounded re-probes absorb it`, !!w.pgrstWindow, w.pgrstWindow?.served_without_pre_request_ms ? 'PRE_REQUEST_STARTUP_WINDOW_OBSERVED' : 'NO_WINDOW_THIS_RUN', w.pgrstWindow);
    await phase('P22 W5 again → already applied, no write', '--b03', 'B03_ALREADY_APPLIED');
    record('P23 idempotent W5: no second POST', writesNow() === n, `writes=${writesNow() - n}`);
    await phase('P24 deploy-preflight with the human decisions still pending → blocked, decisions listed', '--deploy-preflight', 'STOP:GATEWAY_DEPLOY_PREFLIGHT_BLOCKED');
    await phase('P25 deploy-preflight with rehearsal decisions → the Production env boots the REAL config.ts as topology=production', '--deploy-preflight', 'GATEWAY_DEPLOY_PREFLIGHT_PASS',
      { decisions: { publicUrl: `https://${GATEWAY_HOST}/functions/v1/torneos-gateway`, denoDeployOrg: 'rehearsal-org' } });
    await phase('P26 certify the post-gateway/auth state', '--certify', 'GATEWAY_AUTH_CERTIFIED');
    // Negative controls on the certified database.
    psql('grant torneos_payment_service to torneos_edge_core_adapter');
    await phase('P27 NEGATIVE: an edge login gains the payments role → certification fails', '--certify', 'STOP:GATEWAY_AUTH_CERTIFICATION_FAILED');
    psql('revoke torneos_payment_service from torneos_edge_core_adapter');
    psql("create role rehearsal_pay_login login noinherit password 'x'; grant torneos_payment_service to rehearsal_pay_login");
    await phase('P28 NEGATIVE: a payments LOGIN exists → certification fails', '--certify', 'STOP:GATEWAY_AUTH_CERTIFICATION_FAILED');
    psql('drop role rehearsal_pay_login');
    w.auth.external_email_enabled = true;
    await phase('P29 NEGATIVE: Torneos email login re-enabled → certification fails', '--certify', 'STOP:GATEWAY_AUTH_CERTIFICATION_FAILED');
    w.auth.external_email_enabled = false;
    w.extraProject = { ref: 'zzzzzzzzzzzzzzzzzzzz', id: 'zzzzzzzzzzzzzzzzzzzz', name: 'stray', organization_slug: G.ORG_SLUG, region: 'sa-east-1', status: 'ACTIVE_HEALTHY' };
    await phase('P30 NEGATIVE: a stray project in the org → certification fails', '--certify', 'STOP:GATEWAY_AUTH_CERTIFICATION_FAILED');
    w.extraProject = null;
    await phase('P31 controls restored → certified again', '--certify', 'GATEWAY_AUTH_CERTIFIED');

    // ── Gateway E2E: the real gateway, Production topology, Core Production served as fixtures in-process ──
    const relayScript = "const net=require('net');net.createServer(c=>{const u=net.connect(5432,'db');c.pipe(u);u.pipe(c);c.on('error',()=>u.destroy());u.on('error',()=>c.destroy());}).listen(6543,'0.0.0.0')";
    docker(['run', '-d', '--rm', '--network', EDGE, '-p', '127.0.0.1::6543', '--name', RELAY, '--pull', 'never', RELAY_IMAGE, 'node', '-e', relayScript]);
    docker(['network', 'connect', NET, RELAY]);
    relayPort = Number(docker(['port', RELAY, '6543/tcp']).trim().split('\n')[0].split(':').pop());
    await sleep(1000);
    const driver = `import real from ${JSON.stringify(pathToFileURL(PG_JS).href)};
export const connections = [];
export default function postgres(url, options) {
  const u = new URL(url);
  // Emulated Supavisor (transaction mode): only the sa-east-1 pooler, only <login>.${G.TORNEOS_REF}; TLS terminates here.
  if (!/^aws-\\d+-sa-east-1\\.pooler\\.supabase\\.com$/.test(u.hostname) || u.port !== '6543') throw new Error('rehearsal pooler: unexpected host');
  const [login, ref] = decodeURIComponent(u.username).split('.');
  if (ref !== ${JSON.stringify(G.TORNEOS_REF)}) throw new Error('rehearsal pooler: wrong project');
  connections.push({ login, ssl_requested: !!(options.ssl && options.ssl.rejectUnauthorized && options.ssl.ca) });
  return real({ ...options, host: '127.0.0.1', port: ${relayPort}, database: 'postgres', username: login, password: decodeURIComponent(u.password), ssl: false });
}`;
    const tree = await loadGatewayTree({ postgresModule: driver });
    const e2e = [];
    try {
      const pin = JSON.parse(fs.readFileSync(jwksPinFile, 'utf8'));
      const ringDoc = { k1: { pkcs8: keychain.ring.read('k1', pin.keys[0].kid), kid: pin.keys[0].kid }, k2: { pkcs8: keychain.ring.read('k2', pin.keys[1].kid), kid: pin.keys[1].kid } };
      const { productionGatewayEnv } = await import('./gateway-auth.mjs');
      const env = { ...productionGatewayEnv({ publicUrl: `https://${GATEWAY_HOST}/functions/v1/torneos-gateway`, poolerHost: 'aws-0-sa-east-1.pooler.supabase.com', jwksPin: pin, k1Pkcs8: ringDoc.k1.pkcs8, torneosAnonKey: PUBLISHABLE, caPem: '-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----' }),
        TORNEOS_CONTRACT_SERVICE_SECRET: CONTRACT_SECRET, CORE_ANON_KEY: `sb_publishable_${crypto.randomBytes(12).toString('base64url')}` };
      for (const l of G.EDGE_LOGINS) {
        const key = l.login === 'torneos_edge_identity_writer' ? 'TORNEOS_DB_IDENTITY_WRITER_URL' : 'TORNEOS_DB_CORE_ADAPTER_URL';
        env[key] = env[key].replace(/:x{40}@/, `:${keychain.dbLogin(l.login).read()}@`);
      }
      // Core Production, served in-process (fixtures): GoTrue /health + /user (HS256), the signed Core contract /v1/session.
      const core = { healthy: true, contractUp: true, sessionActive: true, calls: [] };
      const coreToken = (sub = crypto.randomUUID(), sessionId = crypto.randomUUID()) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ iss: G.GATEWAY_TOPOLOGY.coreJwtIssuer, aud: 'authenticated', role: 'authenticated', sub, session_id: sessionId, iat: now, exp: now + 3600, is_anonymous: false }); return `${h}.${p}.${crypto.createHmac('sha256', CORE_JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`; };
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        const headers = new Headers(init.headers ?? {});
        core.calls.push(`${init.method ?? 'GET'} ${url.origin}${url.pathname}`);
        if (url.origin === `https://${G.CORE_PROD_REF}.supabase.co`) {
          if (url.pathname === '/auth/v1/health') { if (!core.healthy) throw new TypeError('core down'); return new Response('{}', { status: 200 }); }
          if (url.pathname === '/auth/v1/user') {
            if (!core.healthy) throw new TypeError('core down');
            const tok = (headers.get('authorization') ?? '').slice(7); const [h, p, s] = tok.split('.');
            if (!s || crypto.createHmac('sha256', CORE_JWT_SECRET).update(`${h}.${p}`).digest('base64url') !== s) return new Response('{"msg":"invalid"}', { status: 401 });
            const claims = JSON.parse(Buffer.from(p, 'base64url').toString()); return new Response(JSON.stringify({ id: claims.sub, is_anonymous: false }), { status: 200 });
          }
          if (url.pathname === '/functions/v1/torneos-core-contract/v1/session') {
            if (!core.contractUp) throw new TypeError('contract down');
            const body = new Uint8Array(init.body); const time = headers.get('x-time'); const nonce = headers.get('x-nonce');
            const sig = crypto.createHmac('sha256', Buffer.from(CONTRACT_SECRET, 'hex')).update(`/v1/session\n${time}\n${nonce}\n`).update(body).digest('hex');
            if (sig !== headers.get('x-signature')) return new Response('{"error":"BAD_SIGNATURE"}', { status: 401 });
            // Certified Core contract v1.1: 200 {active:true} for a live session, 403 for any other (sessionResponse admits active=true only).
            if (!core.sessionActive) return new Response('{"error":"SESSION_INACTIVE"}', { status: 403 });
            return new Response(JSON.stringify({ active: true, checked_at: Math.floor(Date.now() / 1000) }), { status: 200 });
          }
          throw new TypeError(`unexpected Core path ${url.pathname}`);
        }
        if (url.origin === `https://${G.TORNEOS_REF}.supabase.co` && url.pathname.startsWith('/rest/v1/')) {
          const hdr = {}; headers.forEach((v, k) => { hdr[k === 'authorization' ? 'Authorization' : k] = v; });
          const r = await platform({ method: init.method ?? 'GET', path: `${url.pathname}${url.search}`, headers: hdr, body: init.body ? Buffer.from(init.body).toString('utf8') : undefined });
          return new Response(r.raw ?? JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
        }
        throw new TypeError(`rehearsal: no network (${url.origin})`);
      };
      globalThis.Deno = { env: { toObject: () => ({ ...env }) } };
      const idx = await tree.import('torneos-gateway/index.ts');
      const stubDriver = await import(pathToFileURL(path.join(tree.dir, 'postgres-driver.mjs')).href);
      const GW = `https://${GATEWAY_HOST}/functions/v1/torneos-gateway`;
      const call = async (p, { method = 'GET', token, origin = G.WEB_ORIGIN, body, host = GATEWAY_HOST } = {}) => {
        const h = { host, ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
        const res = await idx.handle(new Request(`${GW}${p}`, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }));
        const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { json = null; }
        return { status: res.status, body: json, cors: res.headers.get('access-control-allow-origin') };
      };
      const check = (name, pass, detail) => { e2e.push({ name, pass: !!pass, detail }); };
      const cfg = await call('/config');
      check('GET /config: Core = Core Production origin, Torneos = the gateway, publishable key', cfg.status === 200 && cfg.body.coreUrl === `https://${G.CORE_PROD_REF}.supabase.co` && cfg.body.torneosUrl === `${GW}/torneos` && cfg.cors === G.WEB_ORIGIN, { status: cfg.status, coreUrl: cfg.body?.coreUrl });
      const jw = await call('/.well-known/jwks.json');
      check('GET jwks: exactly k1 + k2 public halves', jw.status === 200 && jw.body.keys.map((k) => k.kid).join(',') === pin.keys.map((k) => k.kid).join(',') && jw.body.keys.every((k) => !('d' in k)), jw.body?.keys?.map((k) => k.kid));
      const userId = crypto.randomUUID(); const sessionId = crypto.randomUUID();
      const ct = coreToken(userId, sessionId);
      const ex = await call('/exchange', { method: 'POST', token: ct, body: '{}' });
      const bridge = ex.body?.access_token;
      const hdr = bridge ? JSON.parse(Buffer.from(bridge.split('.')[0], 'base64url').toString()) : {};
      const pl = bridge ? JSON.parse(Buffer.from(bridge.split('.')[1], 'base64url').toString()) : {};
      check('POST /exchange (Core Production session) → RS256 k1, TTL 120, certified iss/aud, core_user_id bound', ex.status === 200 && ex.body.expires_in === 120 && hdr.alg === 'RS256' && hdr.kid === pin.keys[0].kid && pl.exp - pl.iat === 120 && pl.iss === G.BRIDGE.issuer && pl.aud === G.BRIDGE.audience && pl.core_user_id === userId && pl.session_id === sessionId, { status: ex.status, kid: hdr.kid });
      const own = await call('/torneos/rest/v1/torneos_identity?select=id,core_user_id', { token: bridge });
      check('bridge bearer → Torneos REST through the gateway: own identity row (pre_request + custom_jwks + RLS)', own.status === 200 && own.body.length === 1 && own.body[0].core_user_id === userId && own.body[0].id === pl.sub, { status: own.status, rows: own.body?.length });
      const again = await call('/exchange', { method: 'POST', token: ct, body: '{}' });
      const pl2 = again.body?.access_token ? JSON.parse(Buffer.from(again.body.access_token.split('.')[1], 'base64url').toString()) : {};
      check('re-exchange (the one allowed after a 401) → same Torneos identity', again.status === 200 && pl2.sub === pl.sub, { status: again.status });
      const k2tok = mintBridgeToken({ ...ringDoc.k2, overrides: { sub: pl.sub, core_user_id: userId, session_id: sessionId } });
      const viaK2 = await call('/torneos/rest/v1/torneos_identity?select=id', { token: k2tok });
      check('standby k2-signed bridge token → accepted by the gateway AND PostgREST (rotation needs no B03 write)', viaK2.status === 200 && viaK2.body.length === 1, { status: viaK2.status });
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const foreign = mintBridgeToken({ pkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'), kid: pin.keys[0].kid, overrides: { sub: pl.sub, core_user_id: userId, session_id: sessionId } });
      const unk = await call('/torneos/rest/v1/torneos_identity?select=id', { token: foreign });
      check('unknown key (claims the k1 kid) → 401', unk.status === 401, { status: unk.status });
      const expired = mintBridgeToken({ ...ringDoc.k1, now: Math.floor(Date.now() / 1000) - 126, overrides: { sub: pl.sub, core_user_id: userId, session_id: sessionId } });
      const exp = await call('/torneos/rest/v1/torneos_identity?select=id', { token: expired });
      check('expired bridge token (> TTL + 5 s) → 401 (client: one re-exchange)', exp.status === 401, { status: exp.status });
      const gated = await call('/torneos/rest/v1/rpc/create_tournament_season_checkout_purchase', { method: 'POST', token: bridge, body: {} });
      check('RPC outside the allowlist (commerce) → 403 rpc not enabled (never retried)', gated.status === 403 && gated.body.error === 'rpc not enabled', { status: gated.status });
      const withIdentity = await call('/exchange', { method: 'POST', token: ct, body: { core_user_id: crypto.randomUUID() } });
      check('exchange with identity input → 400', withIdentity.status === 400, { status: withIdentity.status });
      const capacitor = await call('/config', { origin: 'capacitor://localhost' });
      const localhost = await call('/config', { origin: 'https://localhost' });
      check('other origins (capacitor://localhost, https://localhost) → 403, no CORS (single certified origin kept)', capacitor.status === 403 && localhost.status === 403 && !capacitor.cors && !localhost.cors, { capacitor: capacitor.status, localhost: localhost.status });
      core.contractUp = false;
      const down = await call('/torneos/rest/v1/torneos_identity?select=id', { token: bridge });
      const exDown = await call('/exchange', { method: 'POST', token: ct, body: '{}' });
      core.contractUp = true;
      check('Core contract unavailable → 503 CORE_UNAVAILABLE (REST and exchange), fail closed', down.status === 503 && down.body.error === 'CORE_UNAVAILABLE' && exDown.status === 503 && exDown.body.error === 'CORE_UNAVAILABLE', { rest: down.body, exchange: exDown.body });
      core.healthy = false;
      const authDown = await call('/exchange', { method: 'POST', token: ct, body: '{}' });
      core.healthy = true;
      check('Core Auth unreachable → 503 (fail closed, certified code)', authDown.status === 503, { status: authDown.status, body: authDown.body });
      core.sessionActive = false;
      const loggedOut = await call('/torneos/rest/v1/torneos_identity?select=id', { token: bridge });
      const exOut = await call('/exchange', { method: 'POST', token: ct, body: '{}' });
      core.sessionActive = true;
      check('Core session revoked → 401 on REST and on exchange', loggedOut.status === 401 && exOut.status === 401, { rest: loggedOut.status, exchange: exOut.status });
      const direct = await platform({ method: 'GET', path: '/rest/v1/torneos_identity?select=id', headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${bridge}` } });
      check('recorded: the bridge bearer is also valid directly on PostgREST until exp (≤ 125 s window, by design)', direct.status === 200, { status: direct.status });
      const activity = psql("select coalesce(string_agg(distinct usename || ':' || application_name, ',' order by usename || ':' || application_name), '') from pg_stat_activity where application_name = 'torneos-gateway'", { user: 'supabase_admin', readOnly: true }).out;
      check('the gateway connects to the DB only as the two torneos_edge_* logins, TLS verification requested', stubDriver.connections.length === 2 && stubDriver.connections.every((c) => c.ssl_requested) && stubDriver.connections.map((c) => c.login).sort().join(',') === 'torneos_edge_core_adapter,torneos_edge_identity_writer' && !/postgres:|service_role|supabase_admin/.test(activity), { connections: stubDriver.connections, activity });
      const outside = core.calls.filter((c) => !c.includes(`https://${G.CORE_PROD_REF}.supabase.co`) && !c.includes(`https://${G.TORNEOS_REF}.supabase.co/rest/v1`));
      check('network: only Core Production HTTPS authority + Torneos REST were called (no Core DB, nothing else)', outside.length === 0, { outside });
      globalThis.fetch = realFetch;
    } finally { await tree.cleanup(); delete globalThis.Deno; }
    const e2ePass = e2e.every((c) => c.pass);
    record(`E2E real gateway, Production topology (Core Prod fixtures) — ${e2e.filter((c) => c.pass).length}/${e2e.length}`, e2ePass, e2ePass ? 'GATEWAY_E2E_PASS' : 'GATEWAY_E2E_FAIL', e2e.filter((c) => !c.pass));
    for (const c of e2e) lines.push(`    ${c.pass ? '✓' : '✗'} ${c.name}`);

    // ── optional Deno leg: the unmodified entrypoint on Deno 2.x with Core Production URLs, loopback-only network ──
    let denoLeg = { ran: false };
    const DENO = process.env.DENO_BIN;
    if (DENO && fs.existsSync(DENO)) denoLeg = await runDenoLeg(DENO, jwksPinFile, keychain);
    if (denoLeg.ran) record('D01 Deno 2.x boots the gateway with the Production topology; Core unreachable by construction → 503', denoLeg.pass, denoLeg.pass ? 'DENO_PRODUCTION_BOOT_PASS' : 'DENO_PRODUCTION_BOOT_FAIL', denoLeg);
    else log('D01 Deno leg skipped (DENO_BIN not set)');

    const result = { rehearsal: stamp, image: DB_IMAGE, postgrest_image: PGRST_IMAGE, relay_image: RELAY_IMAGE, server_version: version, phases, e2e, deno: denoLeg,
      all_pass: phases.every((x) => x.pass), management_api_writes_emulated: w.writes, psql_runs: psqlRuns, remote_calls: 0,
      postgrest_pre_request_startup_window: w.pgrstWindow,
      delta_pin: { file: path.relative(G.REPO_ROOT, deltaPinFile), sha256: G.sha256(fs.readFileSync(deltaPinFile)) } };
    const out = `${JSON.stringify(result, null, 1)}\n`;
    const leaks = G.secretFindings(out, known);
    if (leaks.length) throw new Error(`rehearsal result carries a secret: ${leaks}`);
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'REHEARSAL-result.json'), out);
    const logText = lines.join('\n');
    if (G.secretFindings(logText, known).length) throw new Error('rehearsal log carries a secret');
    fs.writeFileSync(path.join(evDir, 'REHEARSAL-runner-output.log'), `${logText}\n`);
    let scanned = 0;
    for (const f of fs.readdirSync(evDir)) { const t = fs.readFileSync(path.join(evDir, f), 'utf8'); scanned += 1; const s = G.secretFindings(t, known); if (s.length) throw new Error(`secret in ${f}: ${s}`); }
    const pinScan = G.secretFindings(fs.readFileSync(deltaPinFile, 'utf8'), known);
    if (pinScan.length) throw new Error('delta pin carries a secret');
    log(`secret scan: ${scanned} evidence files + delta pin clean against ${known.length} known values and ${G.SECRET_SHAPES.length} shapes`);
    log(`\nREHEARSAL ${result.all_pass ? 'PASS' : 'FAIL'} ${phases.filter((x) => x.pass).length}/${phases.length} → ${path.relative(G.REPO_ROOT, evDir)}`);
    process.exitCode = result.all_pass ? 0 : 1;
  } finally {
    for (const c of [RELAY, PGRST, DB]) spawnSync(DOCKER, ['rm', '-f', c], { stdio: 'ignore' });
    for (const nw of [EDGE, NET]) spawnSync(DOCKER, ['network', 'rm', nw], { stdio: 'ignore' });
    for (const f of [jwksPinFile, caFixture]) { try { fs.rmSync(f, { force: true }); } catch { /* noop */ } }
    const left = spawnSync(DOCKER, ['ps', '-a', '--filter', 'name=ga-', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.trim();
    log(`cleanup: containers left = ${left ? left : 0}; rehearsal ring pin removed`);
  }
}

async function runDenoLeg(DENO, jwksPinFile, keychain) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-deno-app-'));
  const PORT = 58531;
  try {
    fs.cpSync(path.join(G.REPO_ROOT, 'backend/torneos/supabase/functions'), path.join(root, 'functions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'functions', '__ga_loopback.ts'), ['const serve = Deno.serve',
      `;(Deno as unknown as { serve: unknown }).serve = (handler: Deno.ServeHandler) => serve({ hostname: "127.0.0.1", port: ${PORT}, onListen: () => console.log("GA_LISTENING") }, handler)`,
      'await import("./torneos-gateway/index.ts")', ''].join('\n'));
    const pin = JSON.parse(fs.readFileSync(jwksPinFile, 'utf8'));
    const { productionGatewayEnv } = await import('./gateway-auth.mjs');
    const env = { ...productionGatewayEnv({ publicUrl: `https://${GATEWAY_HOST}/functions/v1/torneos-gateway`, poolerHost: 'aws-0-sa-east-1.pooler.supabase.com', jwksPin: pin, k1Pkcs8: keychain.ring.read('k1', pin.keys[0].kid), torneosAnonKey: PUBLISHABLE, caPem: '-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----' }), TORNEOS_CONTRACT_SERVICE_SECRET: CONTRACT_SECRET };
    const child = spawn(DENO, ['run', '--cached-only', '--no-lock', '--no-prompt', '--allow-env', `--allow-net=127.0.0.1:${PORT}`, 'functions/__ga_loopback.ts'],
      { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1', DENO_NO_UPDATE_CHECK: '1', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 120 && !out.includes('GA_LISTENING'); i++) await sleep(250);
    const req = (p, { method = 'GET', origin = G.WEB_ORIGIN, auth } = {}) => httpJson(PORT, { method, path: `/functions/v1/torneos-gateway${p}`, headers: { host: GATEWAY_HOST, ...(origin ? { origin } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: method === 'POST' ? '{}' : undefined });
    const cfg = await req('/config'); const jw = await req('/.well-known/jwks.json'); const ex = await req('/exchange', { method: 'POST', auth: 'eyJx.eyJ4.x' }); const cap = await req('/config', { origin: 'capacitor://localhost' });
    child.kill('SIGTERM');
    const pass = cfg.status === 200 && cfg.body?.coreUrl === `https://${G.CORE_PROD_REF}.supabase.co` && jw.status === 200 && jw.body?.keys?.length === 2 && ex.status === 503 && cap.status === 403 && !/disabled:/.test(out);
    return { ran: true, pass, deno: spawnSync(DENO, ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0], config: cfg.status, jwks: jw.status, exchange_core_unreachable: ex.status, capacitor_origin: cap.status, boot_error: /disabled: (.*)/.exec(out)?.[1] ?? null };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// The gateway's postgres.js pools (module-private) would keep the loop alive after the relay is gone: exit explicitly.
main().catch((e) => { console.error(e.stack ?? e.message); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
