// Phase 3A local-only lab controller. No remote targets, no Supabase CLI, no product .env.
// Core: real GoTrue + PostgREST + edge-runtime over the REAL Core migrations applied as
// `postgres` (supabase/migrations/*.sql, including the Phase 3A contract migration).
// Torneos: the UNCHANGED certified baseline (backend/torneos/supabase/migrations) behind
// PostgREST with the Phase 1.5 JWKS contract. Only the gateway is published (loopback).
import { mkdir, readFile, writeFile, access, readdir, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportJWK, exportPKCS8, SignJWT } from 'jose';

export const root = fileURLToPath(new URL('.', import.meta.url));
export const repo = fileURLToPath(new URL('../../', import.meta.url));
// B04: an alternate project name isolates a frontend QA lab (its own volumes and
// .runtime) from the certification lab; nothing else changes.
export const PROJECT = process.env.PHASE3A_LAB_PROJECT || 'arma2-core-contracts-phase3a';
export const BASE = 'http://127.0.0.1:58420';
// Phase 3B: the Edge Function port of the same gateway (torneos-functions service).
export const EDGE_BASE = 'http://127.0.0.1:58421/torneos-gateway';
// Suites drive one gateway for exchange/RPC/reads: the Node one by default, the Edge one
// with GATEWAY=edge. Auth fixtures always go through the Node gateway's /auth/v1 proxy
// (the Edge gateway does not proxy Core Auth: a real browser talks to Core directly).
export const GATEWAY_BASE = process.env.GATEWAY === 'edge' ? EDGE_BASE : BASE;
export const GATEWAY_NAME = process.env.GATEWAY === 'edge' ? 'edge' : 'node';
const docker = process.platform === 'darwin'
  ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
// MP-A3: TORNEOS_LAB_MODE=commerce adds the local Mercado Pago overlay (compose.mpa.yaml: the
// torneos-payments secrets for torneos-functions and the mp-stub). Any other value is refused.
export const COMMERCE = process.env.TORNEOS_LAB_MODE === 'commerce';
// BRANDING-V1: Supabase Storage on the isolated Torneos database (compose.branding.yaml) + the gateways' branding mode.
export const BRANDING = process.env.TORNEOS_BRANDING_MODE === 'on';
export const STORAGE_PUBLIC_BASE = 'http://127.0.0.1:58425';
if (process.env.TORNEOS_LAB_MODE && !COMMERCE) throw new Error('TORNEOS_LAB_MODE accepts only "commerce"');
export const PAYMENTS_BASE = 'http://127.0.0.1:58421/torneos-payments';
export const MP_STUB_BASE = 'http://127.0.0.1:58426';
const COMPOSE_FILES = ['-f', 'compose.yaml', ...(COMMERCE ? ['-f', 'compose.mpa.yaml'] : []), ...(BRANDING ? ['-f', 'compose.branding.yaml'] : [])];

// Force the local Unix socket, ignoring DOCKER_HOST/context inherited by the shell.
export function dc(args, input, capture = false) {
  const r = spawnSync(docker, ['--host', 'unix:///var/run/docker.sock', 'compose',
    '--project-name', PROJECT, '--env-file', '.runtime/compose.env', ...COMPOSE_FILES, ...args], {
    cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: process.platform === 'darwin'
      ? `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` : process.env.PATH },
    stdio: ['pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  });
  if (r.status !== 0) throw new Error(`local compose ${args[0]} failed (output withheld)`);
  return r.stdout;
}
// Variant for tests: never throws; returns the SQL error text (SQLSTATE message only, no bodies).
export function sqlTry(service, query, user = 'supabase_admin') {
  if (!['core-db', 'torneos-db'].includes(service)) throw new Error('unknown local DB');
  if (!['supabase_admin', 'postgres'].includes(user)) throw new Error('unknown DB user');
  const r = spawnSync(docker, ['--host', 'unix:///var/run/docker.sock', 'compose',
    '--project-name', PROJECT, '--env-file', '.runtime/compose.env', ...COMPOSE_FILES,
    'exec', '-T', service, 'psql', '-U', user, '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], {
    cwd: root, input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: process.platform === 'darwin'
      ? `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` : process.env.PATH },
  });
  return { ok: r.status === 0, out: r.stdout ?? '', error: r.status === 0 ? null : (r.stderr ?? '').split('\n').filter(l => l.startsWith('ERROR:')).join('\n') };
}
export function sql(service, query, user = 'supabase_admin') {
  if (!['core-db', 'torneos-db'].includes(service)) throw new Error('unknown local DB');
  if (!['supabase_admin', 'postgres'].includes(user)) throw new Error('unknown DB user');
  return dc(['exec', '-T', service, 'psql', '-U', user, '-d', 'postgres',
    '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], query, true);
}
export async function config() {
  return JSON.parse(await readFile(new URL('.runtime/config.json', import.meta.url)));
}
export async function writeEdgeEnv(c) {
  // Configuration of the Edge gateway (Phase 3B): exactly what the hosted function would
  // receive as secrets — never Core's JWT secret, service key or DB admin password.
  const bridge = Buffer.from(JSON.stringify({ keys: c.keys, activeKid: c.activeKid, trustedKids: c.trustedKids })).toString('base64');
  const lines = [
    `TORNEOS_GATEWAY_PUBLIC_URL=${EDGE_BASE}`,
    'TORNEOS_ALLOWED_ORIGIN=http://127.0.0.1:58421',
    'CORE_AUTH_URL=http://core-auth:9999',
    `CORE_JWT_ISSUER=${BASE}/auth/v1`,
    `CORE_CONTRACT_URL=${c.coreContractUrl}`,
    `TORNEOS_CONTRACT_SERVICE_SECRET=${c.coreContractSecret}`,
    'TORNEOS_REST_URL=http://torneos-rest:3000',
    `TORNEOS_ANON_KEY=${c.anonKey}`,
    `TORNEOS_DB_IDENTITY_WRITER_URL=postgres://lab_identity_writer:${c.writerPassword}@torneos-db:5432/postgres`,
    `TORNEOS_DB_CORE_ADAPTER_URL=postgres://lab_core_adapter:${c.adapterPassword}@torneos-db:5432/postgres`,
    `TORNEOS_BRIDGE_KEYS=${bridge}`,
  ];
  // PLAN READ / SOCIAL-V1 (Production runs both on): opt-in in the lab, only when set explicitly.
  for (const flag of ['TORNEOS_PLAN_READ_MODE', 'TORNEOS_SOCIAL_MODE']) if (process.env[flag]) lines.push(`${flag}=${process.env[flag]}`);
  // CONNECTED-V1 stays opt-in in the lab: only an explicit TORNEOS_CONNECTED_MODE reaches the Edge gateway.
  if (process.env.TORNEOS_CONNECTED_MODE) lines.push(`TORNEOS_CONNECTED_MODE=${process.env.TORNEOS_CONNECTED_MODE}`);
  // BRANDING-V1: same opt-in; the storage targets are the lab's (hosted: derived from TORNEOS_REST_URL).
  if (BRANDING) lines.push('TORNEOS_BRANDING_MODE=on', 'TORNEOS_STORAGE_URL=http://torneos-storage:5000', `TORNEOS_STORAGE_PUBLIC_URL=${STORAGE_PUBLIC_BASE}`);
  await writeFile(`${root}.runtime/torneos-gateway.env`, lines.join('\n') + '\n', { mode: 0o600 });
}
export async function writeServerConfig(c) {
  // The running gateway needs neither Core's JWT secret nor any DB admin password.
  await mkdir(`${root}.runtime/server`, { recursive: true, mode: 0o700 });
  const { readerPassword, writerPassword, adapterPassword, anonKey, keys, activeKid, trustedKids, coreContractSecret, coreContractUrl } = c;
  await writeFile(`${root}.runtime/server/config.json`,
    JSON.stringify({ readerPassword, writerPassword, adapterPassword, anonKey, keys, activeKid, trustedKids, coreContractSecret, coreContractUrl }), { mode: 0o600 });
}
async function prepare() {
  await mkdir(`${root}.runtime/public`, { recursive: true, mode: 0o700 });
  try { await access(`${root}.runtime/config.json`); }
  catch {
    const secret = () => randomBytes(32).toString('hex');
    const coreSecret = secret();
    const keys = [];
    for (const kid of ['p3a-k1', 'p3a-k2']) {
      const pair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
      keys.push({ kid, privateKey: await exportPKCS8(pair.privateKey),
        publicKey: { ...await exportJWK(pair.publicKey), kid, alg: 'RS256', use: 'sig' } });
    }
    const legacyKey = (role) => new SignJWT({ role, iss: 'supabase' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(coreSecret));
    const cfg = { dbPassword: secret(), readerPassword: secret(), writerPassword: secret(), adapterPassword: secret(),
      coreSecret, anonKey: await legacyKey('anon'), serviceRoleKey: await legacyKey('service_role'),
      coreContractSecret: secret(), coreContractUrl: 'http://core-api:8000/functions/v1/torneos-core-contract',
      keys, activeKid: 'p3a-k1', trustedKids: ['p3a-k1'] };
    await writeFile(`${root}.runtime/config.json`, JSON.stringify(cfg), { mode: 0o600 });
    await writeFile(`${root}.runtime/compose.env`,
      `DB_PASSWORD=${cfg.dbPassword}\nCORE_JWT_SECRET=${coreSecret}\nCORE_SERVICE_ROLE_KEY=${cfg.serviceRoleKey}\n` +
      `CORE_ANON_KEY=${cfg.anonKey}\nTORNEOS_CONTRACT_SERVICE_SECRET=${cfg.coreContractSecret}\n`, { mode: 0o600 });
    await writeFile(`${root}.runtime/public/jwks.json`, JSON.stringify({ keys: [keys[0].publicKey] }));
  }
  // MP-A2: password of the local payment-service login (a kept .runtime gets one on its next prepare).
  // Never handed to the gateways: only the future payments service and the commerce DB suite use it.
  const current = await config();
  if (!current.paymentServicePassword) {
    await writeFile(`${root}.runtime/config.json`, JSON.stringify({ ...current, paymentServicePassword: randomBytes(32).toString('hex') }), { mode: 0o600 });
  }
  await writeServerConfig(await config());
  await writeEdgeEnv(await config());
  if (BRANDING) await writeStorageEnv(await config());
  else await rm(`${root}.runtime/torneos-storage.env`, { force: true });
  if (COMMERCE) await writeCommerceEnv();
  // MP-A4: outside commerce mode no gateway commerce configuration may survive from an earlier run.
  else await Promise.all(GATEWAY_COMMERCE_FILES.map((f) => rm(`${root}.runtime/${f}`, { force: true })));
}
// BRANDING-V1 (branding mode only): the storage-api of the isolated Torneos database. It verifies the bridge's RS256
// tokens through JWT_JWKS (hosted: Third-Party Auth with the same JWKS) and the lab anon key through AUTH_JWT_SECRET
// (in this lab the Torneos anon key is the lab's legacy anon key). Never handed to a gateway.
async function writeStorageEnv(c) {
  const jwks = { keys: c.keys.filter((k) => c.trustedKids.includes(k.kid)).map((k) => k.publicKey) };
  const lines = [
    `ANON_KEY=${c.anonKey}`,
    `SERVICE_KEY=${c.serviceRoleKey}`,
    `AUTH_JWT_SECRET=${c.coreSecret}`,
    `JWT_JWKS=${JSON.stringify(jwks)}`,
    `DATABASE_URL=postgres://supabase_storage_admin:${c.dbPassword}@torneos-db:5432/postgres`,
  ];
  await writeFile(`${root}.runtime/torneos-storage.env`, lines.join('\n') + '\n', { mode: 0o600 });
}
// MP-A4 (commerce mode only): the gateways' commerce configuration — TORNEOS_COMMERCE_MODE=test, the lab payments
// mount and the internal HMAC key shared with torneos-payments. Node gateway: its private .runtime/server dir;
// Edge gateway: an env file only compose.mpa.yaml loads (edge-main hands the URL/key to the gateway worker only
// in commerce mode). Never a Mercado Pago value, the payment-service DB login or a Core/bridge secret.
export const GATEWAY_COMMERCE_FILES = ['server/commerce.env', 'torneos-gateway-commerce.env'];
export const PAYMENTS_INTERNAL_URL = 'http://torneos-functions:9000/torneos-payments';
async function writeGatewayCommerceEnv(c) {
  const lines = ['TORNEOS_COMMERCE_MODE=test', `TORNEOS_PAYMENTS_INTERNAL_URL=${PAYMENTS_INTERNAL_URL}`, `TORNEOS_PAYMENTS_INTERNAL_SECRET=${c.mpa.internalSecret}`];
  for (const f of GATEWAY_COMMERCE_FILES) await writeFile(`${root}.runtime/${f}`, lines.join('\n') + '\n', { mode: 0o600 });
}
// MP-A3 (commerce mode only): ephemeral lab secrets of the payments service and the mp-stub, kept only in
// the ignored .runtime (0600). None of them reaches the gateway env/config (writeEdgeEnv/writeServerConfig
// pick their own fields), and the Core containers never read these files.
export const LAB_APP_PUBLIC_URL = 'https://torneos-mp-a3.lab.invalid';
async function writeCommerceEnv() {
  let c = await config();
  if (!c.mpa) {
    const hex = (n) => randomBytes(n).toString('hex');
    c = { ...c, mpa: {
      internalSecret: hex(32), webhookSecret: hex(32), accessToken: `TEST-${hex(24)}`,
      sellerId: String(1_000_000_000 + (randomBytes(4).readUInt32BE() % 8_999_999_999)), stubControlToken: hex(24),
    } };
    await writeFile(`${root}.runtime/config.json`, JSON.stringify(c), { mode: 0o600 });
  }
  const { mpa } = c;
  const payments = [
    'TORNEOS_PAYMENT_PROVIDER=MERCADO_PAGO',
    'MERCADO_PAGO_ENVIRONMENT=test',
    `MERCADO_PAGO_TEST_ACCESS_TOKEN=${mpa.accessToken}`,
    `MERCADO_PAGO_TEST_WEBHOOK_SECRET=${mpa.webhookSecret}`,
    `MERCADO_PAGO_TEST_SELLER_ID=${mpa.sellerId}`,
    `APP_PUBLIC_URL=${LAB_APP_PUBLIC_URL}`,
    `TORNEOS_PAYMENTS_NOTIFICATION_URL=${LAB_APP_PUBLIC_URL}/functions/v1/torneos-payments/webhooks/mercadopago/v1`,
    `TORNEOS_PAYMENTS_INTERNAL_SECRET=${mpa.internalSecret}`,
    `TORNEOS_PAYMENTS_DB_URL=postgres://lab_payment_service:${c.paymentServicePassword}@torneos-db:5432/postgres`,
    'TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN=http://mp-stub:8080',
  ];
  await writeFile(`${root}.runtime/torneos-payments.env`, payments.join('\n') + '\n', { mode: 0o600 });
  await writeFile(`${root}.runtime/mp-stub.env`, [`MP_STUB_ACCESS_TOKEN=${mpa.accessToken}`, `MP_STUB_SELLER_ID=${mpa.sellerId}`,
    `MP_STUB_CONTROL_TOKEN=${mpa.stubControlToken}`].join('\n') + '\n', { mode: 0o600 });
  await writeGatewayCommerceEnv(c);
}
async function waitFor(label, probe, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try { if (await probe()) return; } catch { /* only fixed local targets */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`local ${label} readiness failed`);
}
export function inGateway(script) {
  // Runs a Node snippet inside the gateway container (private network access for tests).
  return dc(['exec', '-T', 'gateway', 'node', '--input-type=module', '-'], script, true);
}
async function coreMigrations() {
  const dir = `${repo}supabase/migrations/`;
  return (await readdir(dir)).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort().map(f => dir + f);
}
export async function applyCore() {
  // Real Core schema at HEAD, applied as `postgres` like hosted Supabase does. Idempotent per run:
  // a fresh volume gets every migration; a kept volume only the contract migration if missing.
  const files = await coreMigrations();
  const fresh = sql('core-db', "select to_regclass('public.usuarios') is null").trim() === 't';
  const missingContract = sql('core-db', "select to_regprocedure('public.torneos_contract_execute(text,text,jsonb)') is null").trim() === 't';
  // Phase 3B: the v1.1 `session` operation is a `create or replace` of the entry point; a
  // kept volume gets it when its current definition lacks the branch.
  const missingSession = missingContract || sql('core-db', "select position('p_operation = ''session''' in pg_get_functiondef('public.torneos_contract_execute(text,text,jsonb)'::regprocedure)) = 0").trim() === 't';
  // CONNECTED-V1: v1.2 adds `my_teams` the same way (create or replace with the identical body + one branch).
  const missingMyTeams = missingSession || sql('core-db', "select position('p_operation = ''my_teams''' in pg_get_functiondef('public.torneos_contract_execute(text,text,jsonb)'::regprocedure)) = 0").trim() === 't';
  const record = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const isContract = file.endsWith('20260914120000_torneos_core_contract_v1.sql');
    const isSession = file.endsWith('20260915120000_torneos_core_contract_v1_1_session.sql');
    const isMyTeams = file.endsWith('20261007120000_torneos_core_contract_v1_2_my_teams.sql');
    const apply = fresh || (isContract && missingContract) || (isSession && missingSession) || (isMyTeams && missingMyTeams);
    if (apply) sql('core-db', source, 'postgres');
    record.push({ file: file.slice(repo.length), sha256: createHash('sha256').update(source).digest('hex'), applied_this_run: apply });
  }
  if (sql('core-db', "select to_regprocedure('public.torneos_contract_execute(text,text,jsonb)') is null").trim() === 't') {
    throw new Error('Core contract migration is not installed');
  }
  if (sql('core-db', "select position('p_operation = ''session''' in pg_get_functiondef('public.torneos_contract_execute(text,text,jsonb)'::regprocedure)) = 0").trim() === 't') {
    throw new Error('Core contract v1.1 (session) is not installed');
  }
  return record;
}
export async function installTorneos(c) {
  const dir = `${repo}backend/torneos/supabase/migrations/`;
  const files = (await readdir(dir)).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort();
  if (files[0] !== '00000000000000_torneos_baseline_v1.sql') throw new Error('Torneos baseline must be the first migration');
  const file = dir + files[0];
  const source = await readFile(file, 'utf8');
  const sha256 = createHash('sha256').update(source).digest('hex');
  const certified = JSON.parse(await readFile(`${repo}backend/torneos/evidence/install.json`, 'utf8')).sha256;
  if (sha256 !== certified) throw new Error('Torneos baseline differs from the certified Phase 2B candidate');
  let installed = false;
  if (sql('torneos-db', "select to_regclass('public.torneos_identity') is null").trim() === 't') {
    sql('torneos-db', source);  // same owner as the certified Phase 2B lab (supabase_admin)
    installed = true;
  }
  // Phase 2D: later Torneos migrations (the staging v1 RPC exposure gate) apply in order after the
  // baseline, as the same installer. CONNECTED-V1: a kept volume no longer re-applies a migration it already
  // installed (lab_meta.torneos_migrations, outside the public/private schemas every certification inspects):
  // 00000000000008 pins absolute catalog counts in its precondition, so it cannot be re-applied once a later
  // migration adds functions — exactly like a real database, where each migration runs once.
  sql('torneos-db', `CREATE SCHEMA IF NOT EXISTS lab_meta;
    CREATE TABLE IF NOT EXISTS lab_meta.torneos_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
    REVOKE ALL ON SCHEMA lab_meta FROM PUBLIC;`);
  const ledger = new Set(sql('torneos-db', 'SELECT name FROM lab_meta.torneos_migrations').split('\n').map((x) => x.trim()).filter(Boolean));
  const followUps = [];
  const storageReady = sql('torneos-db', "select to_regclass('storage.objects') is not null").trim() === 't';
  for (const name of files.slice(1)) {
    const text = await readFile(dir + name, 'utf8');
    const digest = createHash('sha256').update(text).digest('hex');
    // BRANDING-V1 needs the project's Storage schema (hosted: always there; this lab: only the branding overlay).
    if (name.endsWith('_branding_v1.sql') && !storageReady) {
      followUps.push({ file: (dir + name).slice(repo.length), sha256: digest, applied: false, skipped: 'no storage service in this lab run' });
      continue;
    }
    const apply = !ledger.has(name);
    if (apply) {
      sql('torneos-db', text);
      sql('torneos-db', `INSERT INTO lab_meta.torneos_migrations (name, sha256) VALUES ('${name}', '${digest}') ON CONFLICT (name) DO NOTHING`);
    }
    followUps.push({ file: (dir + name).slice(repo.length), sha256: digest, applied: apply });
  }
  // Server logins: NOINHERIT members of the baseline's NOLOGIN roles; the gateway must SET ROLE.
  sql('torneos-db', `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lab_identity_writer') THEN CREATE ROLE lab_identity_writer LOGIN NOINHERIT; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lab_core_adapter') THEN CREATE ROLE lab_core_adapter LOGIN NOINHERIT; END IF;
    END $$;
    ALTER ROLE lab_identity_writer PASSWORD '${c.writerPassword}';
    ALTER ROLE lab_core_adapter PASSWORD '${c.adapterPassword}';
    GRANT torneos_identity_writer TO lab_identity_writer;
    GRANT torneos_core_adapter TO lab_core_adapter;
    ALTER ROLE authenticator PASSWORD '${c.dbPassword}';`);
  // MP-A2: local login of the payment service, a NOINHERIT member of the NOLOGIN role that
  // 00000000000002 creates (the migration never creates logins). Absent role → no login.
  sql('torneos-db', `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='torneos_payment_service') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lab_payment_service') THEN CREATE ROLE lab_payment_service LOGIN NOINHERIT; END IF;
        EXECUTE format('ALTER ROLE lab_payment_service PASSWORD %L', '${c.paymentServicePassword}');
        GRANT torneos_payment_service TO lab_payment_service;
      END IF;
    END $$;`);
  return { file: file.slice(repo.length), sha256, installed, certified_sha256: certified, migrations_after_baseline: followUps };
}
async function main() {
  if (process.argv[2] === 'prepare') return prepare();
  if (process.argv[2] === 'up') {
    await prepare();
    const c = await config();
    dc(['up', '-d', '--wait', 'core-db', 'torneos-db']);
    sql('core-db', `ALTER ROLE supabase_auth_admin PASSWORD '${c.dbPassword}'; ALTER ROLE authenticator PASSWORD '${c.dbPassword}';
      ALTER ROLE poc_session_reader PASSWORD '${c.readerPassword}';`);
    // GoTrue must own and migrate `auth` before Core migrations touch auth.users triggers.
    dc(['up', '-d', 'core-auth']);
    await waitFor('GoTrue', () => sql('core-db', "select to_regclass('auth.sessions') is not null").trim() === 't');
    const core = await applyCore();
    // Tighten the certified Phase 1.5 session reader after GoTrue's own migrations.
    sql('core-db', `REVOKE SELECT ON ALL TABLES IN SCHEMA auth FROM poc_session_reader;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth
        REVOKE SELECT ON TABLES FROM poc_session_reader;
      GRANT SELECT (id,user_id,not_after) ON auth.sessions TO poc_session_reader;
      GRANT SELECT (id,banned_until,deleted_at) ON auth.users TO poc_session_reader;
      DROP POLICY IF EXISTS poc_session_lookup ON auth.sessions;
      CREATE POLICY poc_session_lookup ON auth.sessions FOR SELECT TO poc_session_reader USING (true);
      DROP POLICY IF EXISTS poc_user_lookup ON auth.users;
      CREATE POLICY poc_user_lookup ON auth.users FOR SELECT TO poc_session_reader USING (true);`);
    if (BRANDING) {
      // storage-api migrates its own schema into the Torneos database before 00000000000010 can install the bucket.
      sql('torneos-db', `ALTER ROLE supabase_storage_admin PASSWORD '${c.dbPassword}';`);
      dc(['up', '-d', 'torneos-storage']);
      await waitFor('torneos-storage', () => sql('torneos-db', "select to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null").trim() === 't');
    }
    const torneos = await installTorneos(c);
    dc(['up', '-d']);
    await waitFor('gateway', async () => (await fetch(`${BASE}/health`)).ok);
    // The Edge gateway boots its worker on first request (module resolution on first boot).
    await waitFor('torneos-functions', async () => {
      const r = await fetch(`${EDGE_BASE}/health`, { signal: AbortSignal.timeout(90000) });
      return r.ok;
    }, 6);
    // Warm the Deno module cache of the real function (first boot downloads its imports).
    await waitFor('core-functions', () => {
      const out = inGateway(`const r = await fetch('http://core-api:8000/functions/v1/torneos-core-contract/v1/verified-email',
        { method: 'POST', body: '{}', signal: AbortSignal.timeout(90000) });
        console.log(r.status);`);
      return out.trim() === '401';
    }, 6);
    if (COMMERCE) {
      // MP-A3: mp-stub readiness, then one unsigned request boots the payments worker (module cache).
      // Its verdict is left to the suites: before torneos-payments exists the router answers 404.
      await waitFor('mp-stub', async () => (await fetch(`${MP_STUB_BASE}/__lab/health`, { headers: { 'x-mp-stub-control': c.mpa.stubControlToken } })).ok);
      await waitFor('torneos-payments', async () => {
        const r = await fetch(`${PAYMENTS_BASE}/internal/v1/season-checkout-preference`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(90000) });
        return r.status !== 503 || (await r.text()).includes('service_unavailable');
      }, 6);
    }
    await writeFile(`${root}.runtime/install.json`, JSON.stringify({ core_migrations_applied: core, torneos }, null, 2) + '\n');
    console.log(`Local-only Phase 3A lab ready at ${BASE}`);
    return;
  }
  // --remove-orphans: an mp-stub left by a commerce-mode run goes down with the lab in either mode.
  if (process.argv[2] === 'down') return dc(['down', '--remove-orphans']);
  if (process.argv[2] === 'destroy') return dc(['down', '-v', '--remove-orphans']);
  throw new Error('Use prepare | up | down | destroy. No remote operations supported.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('Lab operation failed; inspect local services, never remote targets.', e?.message ?? ''); process.exitCode = 1; });
}
