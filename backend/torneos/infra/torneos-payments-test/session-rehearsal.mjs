#!/usr/bin/env node
// PAYMENTS TEST — SESSION REHEARSAL. The REAL operator session (payments-session.mjs makeSession, every command, every
// PLAN / phrase / revalidation / evidence path) driven end to end with nothing leaving this machine:
//   Management API  → a fake transport whose /database/query runs the SQL READ ONLY as supabase_read_only_user on a
//                     throwaway supabase/postgres:17.6.1.147 = GATEWAY_AUTH_CERTIFIED database (0000–0003 + W2/W3)
//   psql legs       → the same scripts inside the container (PB as postgres, probes / ordering as the payments login)
//   Deno Deploy API → an in-memory v2 API; the app it "deploys" IS the real torneos-payments sources (config.ts /
//                     handler.ts / db.ts + postgres.js 3.4.7) booted with EXACTLY the env_vars of the create body
//   Mercado Pago    → the in-process emulator; the sandbox buyer and the provider's webhook deliveries are simulated
//   browser (QA)    → the same four client RPCs qa-fixtures.js calls, as the operator identity (bridge claims)
// Also: a wrong phrase writes nothing; a replayed PB is refused; the certify binds every evidence file.
// Evidence: backend/torneos/mp-b/evidence/payments-test/session-rehearsal-<stamp>/ (secret-scanned by the session).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import * as FC from '../torneos-foundation/foundation-contract.mjs';
import { loadGatewayTree } from '../torneos-gateway-auth/gateway-loader.mjs';
import * as C from './payments-test-contract.mjs';
import { makeSession, validatePaymentsEnvWithRealConfig, repoSecretScan } from './payments-session.mjs';
import { buildPaymentsAssets } from './payments-bundle.mjs';
import { readCaPem } from '../torneos-gateway-remote/gateway-env.mjs';
import { makeMercadoPago, signedNotification } from './mp-emulator.mjs';

const DOCKER = ['/Applications/Docker.app/Contents/Resources/bin/docker', '/usr/local/bin/docker'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
const DB_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.147';
const PG_JS = path.join(os.homedir(), 'Library/Caches/deno/npm/registry.npmjs.org/postgres/3.4.7/src/index.js');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const DB = `pt-sess-${process.pid}`;
const LOCAL_PW = crypto.randomBytes(18).toString('base64url');
const EDGE_PW = Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, crypto.randomBytes(30).toString('base64url')]));
const SELLER = '2718281828';
const MP_TOKEN = `APP_USR-${crypto.randomInt(1e12, 9e12)}${crypto.randomInt(1000, 9999)}-092611-${crypto.randomBytes(16).toString('hex')}-${SELLER}`;
const MP_SECRET = crypto.randomBytes(32).toString('hex');
const PAT = `sbp_${crypto.randomBytes(20).toString('hex')}`;
const DENO = `ddo_${crypto.randomBytes(20).toString('hex')}`;
const POOLER = 'aws-0-sa-east-1.pooler.supabase.com';
const EV_DIR = path.join(C.EVIDENCE_DIR, `session-rehearsal-${stamp}`);
const lines = [];
const log = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function psql(sql, { user = 'postgres', password = LOCAL_PW, extra = [] } = {}) {
  const r = spawnSync(DOCKER, ['exec', '-i', '-e', `PGPASSWORD=${password}`, DB, 'psql', '-U', user, '-h', 'localhost', '-d', 'postgres', '-X', '--no-psqlrc', '-q', '-A', '-t', ...extra, '-f', '-'],
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, code: r.status ?? -1, out: (r.stdout ?? '').trim(), stdout: r.stdout ?? '', err: (r.stderr ?? '').trim() };
}
const readOnlyRow = (query) => {
  const r = psql(`BEGIN READ ONLY;\nSET LOCAL ROLE supabase_read_only_user;\nselect row_to_json(t) from (${query}) t;\nCOMMIT;\n`, { user: 'supabase_admin' });
  if (!r.ok) throw new Error(`read_only_failed ${r.err.slice(0, 300)}`);
  return JSON.parse(r.out);
};
function asUser({ identity, coreUserId }, sql) {
  const now = Math.floor(Date.now() / 1000);
  const claims = JSON.stringify({ role: 'authenticated', iss: G.BRIDGE.issuer, aud: G.BRIDGE.audience, sub: identity, core_user_id: coreUserId, session_id: crypto.randomUUID(), jti: crypto.randomUUID(), iat: now, nbf: now, exp: now + 120 });
  const r = psql(`BEGIN;\nSET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '${claims}', true) \\g /dev/null\n${sql};\nCOMMIT;\n`, { extra: ['-v', 'ON_ERROR_STOP=1'] });
  if (!r.ok) throw new Error(`as_user_failed ${r.err.slice(0, 400)}`);
  return JSON.parse(r.out.split('\n').pop());
}

// ─────────────────────────── fakes ───────────────────────────
function fakeManagement(jwksPin) {
  const project = (ref, name, status) => ({ id: ref, ref, name, organization_id: G.ORG_SLUG, organization_slug: G.ORG_SLUG, region: G.REGION, status });
  const projects = [project(G.CORE_PROD_REF, 'nicoavayu\'s Project', 'ACTIVE_HEALTHY'), project(G.STAGING_REF, 'staging', 'INACTIVE'), project(G.OLD_REF, 'Arma2', 'INACTIVE'), project(G.TORNEOS_REF, G.PROJECT_NAME, 'ACTIVE_HEALTHY')];
  const auth = { ...Object.fromEntries(G.AUTH_MUST_BE_OFF.map((k) => [k, false])), ...G.AUTH_LOCKDOWN_BODY };
  const tpa = [{ id: '94fe4602-23f6-4b5f-b606-36797d804bec', type: 'custom', oidc_issuer_url: null, jwks_url: G.B03_JWKS_URL, custom_jwks: null,
    resolved_jwks: { keys: jwksPin.keys.map((k) => ({ kty: k.kty, n: k.n, e: k.e, kid: k.kid, alg: 'RS256', use: 'sig' })) }, resolved_at: '2026-09-26T01:58:09Z', inserted_at: '2026-09-26T01:58:00Z', updated_at: '2026-09-26T01:58:09Z' }];
  const routes = [
    [/^\/v1\/organizations\/[a-z]+$/, () => ({ id: G.ORG_SLUG, slug: G.ORG_SLUG, plan: 'free' })],
    [/^\/v1\/projects$/, () => projects],
    [/^\/v1\/projects\/([a-z]{20})$/, (m) => projects.find((p) => p.ref === m[1])],
    [/^\/v1\/projects\/[a-z]{20}\/functions\/[a-z-]+$/, () => ({ slug: G.CORE_CONTRACT_SLUG, status: 'ACTIVE', version: 3, verify_jwt: false, ezbr_sha256: G.CORE_CONTRACT_EZBR })],
    [/\/health\?/, () => ['auth', 'db', 'pooler', 'rest', 'db_postgres_user'].map((name) => ({ name, status: 'ACTIVE_HEALTHY' }))],
    [/\/functions$/, () => []],
    [/\/secrets$/, () => [{ name: 'SUPABASE_URL' }, { name: 'SUPABASE_ANON_KEY' }]],
    [/\/config\/auth$/, () => auth],
    [/\/third-party-auth$/, () => tpa],
    [/\/config\/database\/pooler$/, () => [{ db_host: POOLER, pool_mode: 'transaction' }]],
  ];
  return async ({ method, path: p, body }) => {
    if (method === 'POST' && p.endsWith('/database/query')) {
      if (body?.read_only !== true) return { status: 400, body: { message: 'read_only required' } };
      return { status: 201, body: [readOnlyRow(body.query)] };
    }
    for (const [re, fn] of routes) { const m = re.exec(p); if (m && method === 'GET') return { status: 200, body: fn(m) }; }
    return { status: 404, body: { message: 'fake: unknown' } };
  };
}

function fakeDeno({ onDeploy }) {
  const gatewayEnv = ['CORE_ANON_KEY', 'CORE_AUTH_URL', 'CORE_CONTRACT_URL', 'CORE_JWT_ISSUER', 'TORNEOS_ALLOWED_ORIGIN', 'TORNEOS_ANON_KEY', 'TORNEOS_BRIDGE_KEYS', 'TORNEOS_CONTRACT_SERVICE_SECRET',
    'TORNEOS_DB_CORE_ADAPTER_URL', 'TORNEOS_DB_IDENTITY_WRITER_URL', 'TORNEOS_DB_SSL_CA', 'TORNEOS_GATEWAY_PUBLIC_URL', 'TORNEOS_REST_URL'];
  const apps = new Map([['torneos-gateway', { id: 'app-gw', slug: 'torneos-gateway', layers: [], env_vars: gatewayEnv.map((key) => ({ key, secret: /SECRET|KEYS|_URL$/.test(key) && key.startsWith('TORNEOS_DB') || ['TORNEOS_CONTRACT_SERVICE_SECRET', 'TORNEOS_BRIDGE_KEYS'].includes(key), contexts: 'all' })) }]]);
  const revisions = new Map(); let seq = 0;
  const writes = [];
  const transport = async ({ method, path: p, body }) => {
    let m;
    if (method === 'GET' && /^\/v2\/apps(\?limit=100)?$/.test(p)) return { status: 200, body: [...apps.values()].map((a) => ({ id: a.id, slug: a.slug })) };
    if (method === 'GET' && p === '/v2/layers') return { status: 200, body: [] };
    if (method === 'GET' && (m = /^\/v2\/apps\/([a-z-]+)$/.exec(p))) return apps.has(m[1]) ? { status: 200, body: apps.get(m[1]) } : { status: 404, body: { code: 'appNotFound' } };
    if (method === 'GET' && (m = /^\/v2\/apps\/([a-z-]+)\/revisions/.exec(p))) return { status: 200, body: [...revisions.values()].filter((r) => r.app === m[1]).reverse() };
    if (method === 'GET' && (m = /^\/v2\/revisions\/([\w-]+)\/timelines$/.exec(p))) return { status: 200, body: [{ slug: 'production', partition: {}, domains: [{ domain: C.PAYMENTS_HOST }, { domain: `${C.APP_SLUG}-${m[1]}.${C.DENO_ORG}.deno.net` }] }] };
    if (method === 'GET' && (m = /^\/v2\/revisions\/([\w-]+)$/.exec(p))) return { status: 200, body: revisions.get(m[1]) };
    if (method === 'GET' && /\/logs\?/.test(p)) return { status: 200, body: [] };
    if (method === 'POST' && p === '/v2/apps') { writes.push('app-create'); const a = { id: 'app-pt', slug: body.slug, layers: [], labels: body.labels, config: body.config, env_vars: body.env_vars.map((e) => ({ key: e.key, secret: e.secret, contexts: e.contexts, ...(e.secret ? {} : { value: e.value }) })) }; apps.set(body.slug, a); onDeploy.env = Object.fromEntries(body.env_vars.map((e) => [e.key, e.value])); return { status: 200, body: a }; }
    if (method === 'POST' && (m = /^\/v2\/apps\/([a-z-]+)\/deploy$/.exec(p))) { writes.push('deploy'); const id = `rev${++seq}x`; const r = { id, app: m[1], status: 'succeeded', timelines: [{ name: 'production', context: 'production', hostnames: [C.PAYMENTS_HOST] }] }; revisions.set(id, r); await onDeploy.boot(); return { status: 202, body: { ...r, status: 'queued' } }; }
    return { status: 404, body: { code: 'fake_unknown' } };
  };
  return { transport, writes };
}

// ─────────────────────────── main ───────────────────────────
async function main() {
  if (!DOCKER) throw new Error('docker not found');
  const phases = []; const record = (label, pass, detail = null) => { phases.push({ label, pass: !!pass, detail: pass ? null : detail }); log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${pass ? '' : ` ${JSON.stringify(detail).slice(0, 700)}`}`); };
  let tree = null; const dbs = [];
  const transcript = [];
  const pinFile = path.join(os.tmpdir(), `pt-deploy-pin-${process.pid}.json`);
  try {
    execFileSync(DOCKER, ['run', '-d', '--rm', '-p', '127.0.0.1::5432', '--name', DB, '-e', `POSTGRES_PASSWORD=${LOCAL_PW}`, '--pull', 'never', DB_IMAGE], { encoding: 'utf8' });
    for (let i = 0; i < 90; i++) { if (psql('select 1').ok) break; await sleep(1000); }
    await sleep(2000); for (let i = 0; i < 30 && !psql('select 1').ok; i++) await sleep(1000);
    for (const m of FC.loadMigrations(G.REPO_ROOT)) { const r = psql(fs.readFileSync(m.abs, 'utf8'), { extra: ['-v', 'ON_ERROR_STOP=1'] }); if (!r.ok) throw new Error(`migration ${m.seq}: ${r.err.slice(0, 300)}`); }
    const gw = psql(G.renderBootstrapSql(Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, G.scramVerifier(EDGE_PW[l.login])]))), { extra: ['-v', 'ON_ERROR_STOP=1'] });
    record('S00 GATEWAY_AUTH_CERTIFIED database (0000–0003 + certified W2/W3)', gw.ok, gw.err.slice(0, 200));
    const port = Number(execFileSync(DOCKER, ['port', DB, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0].split(':').pop());
    tree = await loadGatewayTree({ postgresModule: `export { default } from ${JSON.stringify(pathToFileURL(PG_JS).href)};` });
    const { createPaymentsService } = await tree.import('torneos-payments/handler.ts');
    const { createPaymentsDb } = await tree.import('torneos-payments/db.ts');

    // Keychain (in memory), Mercado Pago emulator, the "deployed" app
    const kcStore = new Map([['installer', LOCAL_PW]]);
    const keychain = () => {
      const own = (k, gen) => ({ check: () => (kcStore.has(k) ? 'PRESENT' : 'ABSENT'), generate: () => { if (kcStore.has(k)) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_OVERWRITE'); kcStore.set(k, gen()); return 'KEYCHAIN_GENERATED'; }, read: () => kcStore.get(k) ?? (() => { throw new Error('keychain_read_failed'); })() });
      return { dbPassword: own('db', () => crypto.randomBytes(30).toString('base64url')), internalSecret: own('hmac', () => crypto.randomBytes(32).toString('hex')), installer: own('installer') };
    };
    const mp = makeMercadoPago({ sellerId: SELLER, accessToken: MP_TOKEN });
    const deployed = { env: null, service: null, async boot() {
      const env = deployed.env;
      deployed.service = createPaymentsService({ env, log: () => {}, fetcher: (u, i) => mp.fetch(u, i), connectDb: (url, ca) => {
        const u = new URL(url);
        if (u.hostname !== POOLER || u.port !== '6543' || !ca || decodeURIComponent(u.username) !== `${C.PAYMENT_LOGIN}.${C.TORNEOS_REF}`) throw new Error('rehearsal: the app must connect with the pinned pooler URL and a CA');
        const db = createPaymentsDb(`postgres://${C.PAYMENT_LOGIN}:${u.password}@127.0.0.1:${port}/postgres`, undefined); dbs.push(db); return db;
      } });
    } };
    const serve = async (host, { method, path: p, body, headers = {} }) => {
      if (!deployed.service) return { status: 404, body: null };
      const res = await deployed.service(new Request(`https://${host}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body }));
      const raw = await res.text(); let json = null; try { json = JSON.parse(raw); } catch { json = null; }
      return { status: res.status, body: json, json, raw, headers: Object.fromEntries(res.headers) };
    };
    // Mercado Pago's own webhook deliveries (what the TEST app receives after a buyer's attempt or a refund)
    const deliver = (paymentId) => serve(C.PAYMENTS_HOST, (({ url, init }) => ({ method: 'POST', path: new URL(url).pathname + new URL(url).search, body: init.body, headers: init.headers }))(signedNotification({ base: C.PAYMENTS_BASE, secret: MP_SECRET, dataId: paymentId, sellerId: SELLER })));
    const mpTransport = async ({ token, method, path: p, body, headers = {} }) => {
      const res = await mp.fetch(`https://api.mercadopago.com${p}`, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const out = { status: res.status, body: await res.json().catch(() => null) };
      const m = /^\/v1\/payments\/(\d+)\/refunds$/.exec(p);
      if (m && method === 'POST' && res.status === 201) setTimeout(() => { deliver(m[1]); }, 200);
      return out;
    };
    const deno = fakeDeno({ onDeploy: deployed });
    const https = async ({ url, method = 'GET', headers = {}, body }) => {
      const u = new URL(url);
      if (u.hostname === G.GATEWAY_HOST) {
        if (u.pathname.endsWith('/health')) return { status: 200, json: { ready: true }, headers: {} };
        if (u.pathname.endsWith('/config')) return { status: 200, json: { coreUrl: 'x', torneosUrl: 'y', anonKey: 'z' }, headers: {} };
        return { status: 404, json: { error: 'not found' }, headers: {} };
      }
      return serve(u.hostname, { method, path: u.pathname + u.search, body, headers });
    };
    const said = [];
    let phraseOverride = null;
    const readLine = () => { if (phraseOverride !== null) { const p = phraseOverride; phraseOverride = null; return p; } const i = said.map((s, k) => (s.includes('must send exactly:') ? k : -1)).filter((k) => k >= 0).at(-1); return said[i].split('\n').at(-1).trim(); };
    const jwksPin = JSON.parse(fs.readFileSync(G.JWKS_PIN_FILE, 'utf8'));
    const session = makeSession({ pat: PAT, deno: DENO, mpToken: MP_TOKEN, mpSecret: MP_SECRET, deps: {
      say: (s) => { said.push(s); transcript.push(s); }, readLine, transport: fakeManagement(jwksPin), denoTransport: deno.transport, mpTransport, appTransport: (req) => serve(C.PAYMENTS_HOST, req), https,
      keychain, applySql: async ({ sql, env }) => { if (env.PGUSER !== `postgres.${C.TORNEOS_REF}` || env.PGPORT !== '5432' || env.PGSSLMODE !== 'verify-full') return { code: 9, stderr_tail: 'rehearsal: installer env not pinned' }; const r = psql(sql, { password: env.PGPASSWORD, extra: ['-v', 'ON_ERROR_STOP=1'] }); return { code: r.code, elapsed_ms: 1, stderr_tail: r.err.slice(-400) }; },
      runPsql: async ({ script, env }) => { const r = psql(script, { user: env.PGUSER.split('.')[0], password: env.PGPASSWORD }); return { code: r.code, stdout: r.stdout, stderr_tail: r.err.split('\n').filter((l) => /FATAL|could not/.test(l)).join('\n') }; },
      psqlPrerequisites: () => [], tlsProbe: ({ port }) => ({ pass: true, port, verify: 'rehearsal' }), readCaPem: () => readCaPem(), validatePaymentsEnv: validatePaymentsEnvWithRealConfig,
      buildAssets: () => buildPaymentsAssets({ requireClean: false }), secretScan: (k) => repoSecretScan(k), now: () => Date.now(), sleep, pollMs: 100, revisionTimeoutMs: 5000, webhookWaitMs: 8000,
      evidenceDir: EV_DIR, deployPinFile: pinFile, deltaPinFile: C.DELTA_PIN_FILE } });
    const run = async (cmd) => { try { const r = await session.run(cmd); return { ok: true, verdict: r.verdict }; } catch (e) { return { ok: false, code: e.code ?? String(e.message).slice(0, 200), detail: e.detail ?? null }; } };
    const census = () => readOnlyRow(C.CENSUS_SQL).json_build_object;

    let r = await run('preflight');
    record('S01 preflight (read-only): login absent, app absent, MP TEST seller attested', r.ok && r.verdict === 'PAYMENTS_PREFLIGHT_PASS', r);
    phraseOverride = 'CREATE TORNEOS PAYMENTS TEST LOGIN torneos_payments_test 000000000000';
    r = await run('pb');
    record('S02 PB with a wrong phrase → NOT_AUTHORIZED, nothing written (login still absent, Keychain untouched)', !r.ok && r.code === 'NOT_AUTHORIZED' && readOnlyRow(C.PAYMENT_ROLES_SQL).json_build_object.login === null && !kcStore.has('db'), r);
    r = await run('pb');
    record('S03 PB: PLAN → phrase → one transaction as postgres → delta = pin, login probe 5432 + 6543', r.ok && r.verdict === 'PAYMENTS_LOGIN_CREATED', r);
    r = await run('pb');
    record('S04 PB again → refused before any write (PAYMENT_LOGIN_NOT_ABSENT)', !r.ok && r.code === 'PAYMENT_LOGIN_NOT_ABSENT', r);
    r = await run('create');
    record('S05 create: PLAN → phrase → app-level env validated by the real config.ts → POST /v2/apps + deploy r1', r.ok && r.verdict === 'PAYMENTS_TEST_APP_DEPLOYED' && deno.writes.join() === 'app-create,deploy', { r, writes: deno.writes });
    const deployedNames = Object.keys(deployed.env ?? {}).sort();
    record('S06 the deployed env: exactly the 11 pinned names, no Core / Supabase / gateway / commerce variable, remote-test, MP test', deployedNames.join(',') === C.ENV_NAMES.join(',') && C.forbiddenEnvNames(deployedNames).length === 0
      && deployed.env.TORNEOS_PAYMENTS_DEPLOYMENT === 'remote-test' && deployed.env.MERCADO_PAGO_ENVIRONMENT === 'test', deployedNames);
    r = await run('create');
    record('S07 create again → refused (PAYMENTS_APP_ALREADY_EXISTS), no third write', !r.ok && r.code === 'PAYMENTS_APP_ALREADY_EXISTS' && deno.writes.length === 2, r);
    r = await run('app-probe');
    record('S08 app-probe on the deployed runtime: routing, Host, HMAC, signature negatives; nothing written', r.ok, r);

    // the browser step (qa-fixtures.js): the operator's identity, the same four client RPCs
    const coreUser = crypto.randomUUID();
    const operator = { coreUserId: coreUser, identity: psql(`insert into public.torneos_identity(core_user_id) values ('${coreUser}') returning id`, { user: 'supabase_admin' }).out };
    const control = { coreUserId: crypto.randomUUID() }; control.identity = psql(`insert into public.torneos_identity(core_user_id) values ('${control.coreUserId}') returning id`, { user: 'supabase_admin' }).out;
    const corg = asUser(control, `SELECT public.create_tournament_organization('Control Tenant Real', 'control-tenant-${crypto.randomBytes(3).toString('hex')}', '${crypto.randomUUID()}')`);
    asUser(control, `SELECT public.create_tournament_season('${corg.id ?? corg.organization?.id}', 'Control season real', 'control-season', NULL, NULL, '${crypto.randomUUID()}')`);
    const org = asUser(operator, `SELECT public.create_tournament_organization('${C.QA.orgName}', '${C.QA.orgSlugPrefix}${crypto.randomBytes(4).toString('hex')}', '${crypto.randomUUID()}')`);
    const orgId = org.id ?? org.organization?.id;
    for (const s of C.QA.seasons) {
      const season = asUser(operator, `SELECT public.create_tournament_season('${orgId}', '${s.name}', '${s.slugPrefix}${crypto.randomBytes(3).toString('hex')}', NULL, NULL, '${crypto.randomUUID()}')`);
      asUser(operator, `SELECT public.create_tournament_season_checkout_purchase('${orgId}', '${season.id ?? season.season?.id}', '${crypto.randomUUID()}')`);
    }
    r = await run('fixtures');
    record('S09 fixtures: one private QA org, S1 + S2, two MP TEST purchases of ARS 39.900; a real tenant exists and has no commercial row', r.ok && r.verdict === 'QA_FIXTURES_ISOLATED', r);
    r = await run('ordering');
    record('S10 ordering on the functions as the payments login, every transaction ROLLBACK, traceless', r.ok && session.state.results.ordering?.historical?.pass === true, r);
    r = await run('preference');
    record('S11 preference: PLAN → phrase → internal HMAC → provider body exact, reuse, DB preference_created', r.ok && r.verdict === 'MP_TEST_PREFERENCE_PASS', r);
    // the test buyer: a rejected attempt then an approved one; Mercado Pago delivers a signed webhook for each
    const prefId = session.state.preference.id;
    const at = (s) => new Date(Date.now() - 60000 + s * 1000).toISOString().replace('Z', '-00:00');
    const rej = mp.pay(prefId, { status: 'rejected', statusDetail: 'cc_rejected_other_reason', at: at(1) });
    const d1 = await deliver(rej);
    const pay = mp.pay(prefId, { status: 'approved', statusDetail: 'accredited', at: at(5) });
    const d2 = await deliver(pay);
    record('S12 simulated sandbox: rejected + approved deliveries → 200', d1.status === 200 && d2.status === 200, { d1, d2 });
    r = await run('observe');
    record('S13 observe: rejected attempt, approved ARS 39900 TEST, grant effective, watermarks', r.ok && r.verdict === 'SANDBOX_CHECKOUT_APPLIED', r);
    r = await run('replays');
    record('S14 replays with the approved payment: duplicates (10/13-digit, old ts), seller/live negatives, nothing moved', r.ok, r);
    r = await run('refund');
    record('S15 refund: PLAN → phrase → armed refund → signed webhook → refunded, grant revoked, stale notification harmless', r.ok && r.verdict === 'REFUND_LIFECYCLE_PASS', r);
    r = await run('certify');
    record('S16 certify: every step bound by sha256, delta = pin, QA-only census, no secret anywhere', r.ok && r.verdict === 'PAYMENTS_REMOTE_TEST_CERTIFIED', r);
    const c = census();
    record('S17 final census: 2 QA purchases (P1 refunded, P2 untouched), 1 revoked grant, control tenant without commercial rows', C.censusFailures(c).length === 0 && c.purchases === 2 && c.organizations === 2, c);
    const leaks = C.secretFindings(transcript.join('\n'), session.known);
    record('S18 the whole transcript carries no secret', leaks.length === 0, leaks);
    session.wipe();
    record('S19 wipe empties the session memory of secrets', session.known.length === 0);
  } catch (e) {
    record('SESSION REHEARSAL aborted', false, String(e?.stack ?? e).slice(0, 1500));
  } finally {
    for (const db of dbs) await db.end?.().catch(() => {});
    spawnSync(DOCKER, ['rm', '-f', DB], { stdio: 'ignore' });
    if (tree) await tree.cleanup();
    fs.rmSync(pinFile, { force: true });
  }
  const pass = phases.every((p) => p.pass);
  const body = { tool: 'backend/torneos/infra/torneos-payments-test/session-rehearsal.mjs', generated_at: new Date().toISOString(), verdict: pass ? 'PAYMENTS_SESSION_REHEARSAL_PASS' : 'PAYMENTS_SESSION_REHEARSAL_FAIL',
    image: DB_IMAGE, remote_calls: 0, passed: phases.filter((p) => p.pass).length, total: phases.length, phases };
  const text = `${JSON.stringify(body, null, 1)}\n`;
  const leaks = C.secretFindings(text, [LOCAL_PW, MP_TOKEN, MP_SECRET, PAT, DENO, ...Object.values(EDGE_PW)]);
  fs.mkdirSync(EV_DIR, { recursive: true });
  if (leaks.length) { log(`EVIDENCE WITHHELD ${leaks.join(',')}`); process.exit(3); }
  fs.writeFileSync(path.join(EV_DIR, 'SESSION-REHEARSAL-result.json'), text);
  fs.writeFileSync(path.join(EV_DIR, 'SESSION-REHEARSAL-transcript.txt'), `${transcript.join('\n')}\n`);
  log(`\n${body.verdict} ${body.passed}/${body.total} → ${path.relative(G.REPO_ROOT, EV_DIR)} (sha256 ${C.sha256(text).slice(0, 16)})`);
  process.exit(pass ? 0 : 1);
}
main();
