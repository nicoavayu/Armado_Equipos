// Core lab controller. Local only: no remote targets, no Supabase CLI, no product .env.
//   node integration/core-lab/lab.mjs up        build the lab (fresh volume = every Core migration)
//   node integration/core-lab/lab.mjs seed      QA fixture (see seed.mjs)
//   node integration/core-lab/lab.mjs app       start the web app against the lab (fail-closed launcher)
//   node integration/core-lab/lab.mjs down      stop, keep volumes
//   node integration/core-lab/lab.mjs destroy   stop and drop volumes
// Secrets are generated into .runtime/ (ignored, 0600) and never printed.
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('.', import.meta.url));
export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const PROJECT = 'arma2-core-lab';
export const API = 'http://127.0.0.1:58530';
export const MAILPIT = 'http://127.0.0.1:58531';
export const APP_PORT = Number(process.env.CORE_LAB_APP_PORT || 3110);
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const docker = process.platform === 'darwin'
  ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
const dockerEnv = () => ({ ...process.env, PATH: process.platform === 'darwin'
  ? `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` : process.env.PATH });

export function dc(args, input, capture = false) {
  const r = spawnSync(docker, ['--host', 'unix:///var/run/docker.sock', 'compose',
    '--project-name', PROJECT, '--env-file', '.runtime/compose.env', '-f', 'compose.yaml', ...args], {
    cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: dockerEnv(),
    stdio: ['pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  });
  if (r.status !== 0) {
    const detail = capture ? (r.stderr || '').split('\n').filter((l) => /ERROR|error:/.test(l)).slice(0, 5).join('\n') : '';
    throw new Error(`local compose ${args[0]} failed${detail ? `:\n${detail}` : ''}`);
  }
  return r.stdout;
}

/** psql inside core-db. `user` is a local superuser; output is unaligned tuples only. */
export function sql(query, user = 'supabase_admin') {
  if (!['supabase_admin', 'postgres'].includes(user)) throw new Error('unknown DB user');
  return dc(['exec', '-T', 'core-db', 'psql', '-U', user, '-d', 'postgres',
    '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], query, true);
}

/** Like sql() but never throws: returns { ok, out, error } with the SQLSTATE message only. */
export function sqlTry(query, user = 'supabase_admin') {
  const r = spawnSync(docker, ['--host', 'unix:///var/run/docker.sock', 'compose',
    '--project-name', PROJECT, '--env-file', '.runtime/compose.env', '-f', 'compose.yaml',
    'exec', '-T', 'core-db', 'psql', '-U', user, '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], {
    cwd: root, input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: dockerEnv(),
  });
  return { ok: r.status === 0, out: r.stdout ?? '', error: r.status === 0 ? null : (r.stderr ?? '').split('\n').filter((l) => l.startsWith('ERROR:')).join('\n') };
}

const b64url = (value) => Buffer.from(value).toString('base64url');
export function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export async function config() {
  return JSON.parse(await readFile(new URL('.runtime/config.json', import.meta.url)));
}

async function prepare() {
  await mkdir(`${root}.runtime`, { recursive: true, mode: 0o700 });
  try { await access(`${root}.runtime/config.json`); } catch {
    const secret = () => randomBytes(32).toString('hex');
    const jwtSecret = secret();
    const now = Math.floor(Date.now() / 1000);
    const legacyKey = (role) => signJwt({ role, iss: 'supabase', iat: now, exp: now + 3650 * 86400 }, jwtSecret);
    const cfg = { dbPassword: secret(), jwtSecret, anonKey: legacyKey('anon'), serviceRoleKey: legacyKey('service_role'),
      realtimeSecretKeyBase: randomBytes(48).toString('base64') };
    await writeFile(`${root}.runtime/config.json`, JSON.stringify(cfg), { mode: 0o600 });
  }
  const c = await config();
  await writeFile(`${root}.runtime/compose.env`,
    `DB_PASSWORD=${c.dbPassword}\nCORE_JWT_SECRET=${c.jwtSecret}\nCORE_SERVICE_ROLE_KEY=${c.serviceRoleKey}\n` +
    `CORE_ANON_KEY=${c.anonKey}\nREALTIME_SECRET_KEY_BASE=${c.realtimeSecretKeyBase}\nAPP_ORIGIN=${APP_ORIGIN}\n`, { mode: 0o600 });
}

async function waitFor(label, probe, attempts = 60, delayMs = 1000) {
  for (let i = 0; i < attempts; i += 1) {
    try { if (await probe()) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`${label} did not become ready`);
}

async function applyCore() {
  const dir = `${repo}supabase/migrations/`;
  const files = (await readdir(dir)).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
  const fresh = sql("select to_regclass('public.usuarios') is null").trim() === 't';
  const record = [];
  for (const file of files) {
    const source = await readFile(dir + file, 'utf8');
    if (fresh) sql(source, 'postgres');
    record.push({ file: `supabase/migrations/${file}`, sha256: createHash('sha256').update(source).digest('hex'), applied_this_run: fresh });
  }
  return record;
}

// Tables the web app subscribes to through Realtime `postgres_changes`.
const REALTIME_TABLES = ['partidos', 'jugadores', 'votos', 'votos_publicos', 'usuarios', 'teams', 'team_members',
  'public_voters', 'notifications', 'notifications_ext', 'match_join_requests', 'jugadores_sin_partido',
  'cleared_matches', 'team_invitations', 'team_chat_messages', 'mensajes_partido', 'amigos', 'survey_results',
  'post_match_surveys', 'partidos_frecuentes'];

async function up() {
  await prepare();
  const c = await config();
  dc(['up', '-d', '--wait', 'core-db', 'mailpit']);
  sql(`ALTER ROLE supabase_auth_admin PASSWORD '${c.dbPassword}';
       ALTER ROLE authenticator PASSWORD '${c.dbPassword}';
       ALTER ROLE supabase_storage_admin PASSWORD '${c.dbPassword}';
       ALTER ROLE supabase_admin PASSWORD '${c.dbPassword}';`);
  // GoTrue and storage-api own and migrate their schemas before Core touches them.
  dc(['up', '-d', 'core-auth', 'core-storage']);
  await waitFor('GoTrue', () => sql("select to_regclass('auth.sessions') is not null").trim() === 't', 90);
  let last = -1; let stable = 0;
  await waitFor('storage-api', () => {
    const count = Number(sql("select case when to_regclass('storage.migrations') is null then -1 else (select count(*) from storage.migrations) end").trim());
    stable = count > 0 && count === last ? stable + 1 : 0;
    last = count;
    return stable >= 3;
  }, 120);
  const core = await applyCore();
  const pub = REALTIME_TABLES.map((t) => `IF EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.${t}') AND relkind IN ('r','p')) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='${t}')
    THEN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.${t}'; END IF;`).join('\n');
  sql(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
    ${pub}
  END $$;`);
  sql('NOTIFY pgrst, \'reload schema\';');
  dc(['up', '-d']);
  await waitFor('core-api', async () => (await fetch(`${API}/_lab/health`)).ok);
  await waitFor('PostgREST', async () => (await fetch(`${API}/rest/v1/`, { headers: { apikey: c.anonKey } })).status < 500, 60);
  await waitFor('GoTrue health', async () => (await fetch(`${API}/auth/v1/health`, { headers: { apikey: c.anonKey } })).ok, 60);
  // First call boots the Deno worker (module download on a cold cache).
  await waitFor('edge functions', async () => {
    const r = await fetch(`${API}/functions/v1/join-match-guest`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(90000) });
    return r.status === 400;
  }, 10, 3000);
  await writeFile(`${root}.runtime/install.json`, JSON.stringify({ core_migrations: core }, null, 2) + '\n');
  console.log(`Core lab ready: API ${API} · Mailpit ${MAILPIT} · ${core.length} Core migrations`);
}

async function app() {
  const c = await config();
  const child = spawn('npm', ['run', 'qa:start:local', '--', '--start'], {
    cwd: repo, stdio: 'inherit',
    env: { ...process.env, QA_SUPABASE_URL: API, QA_SUPABASE_ANON_KEY: c.anonKey, PORT: String(APP_PORT),
      HOST: '127.0.0.1', BROWSER: 'none', REACT_APP_PUBLIC_APP_URL: APP_ORIGIN,
      // Real sessions only: no "Local Dev" stand-in user, no analytics/telemetry keys.
      REACT_APP_LOCAL_EDIT_MODE: 'false', REACT_APP_SENTRY_DSN: '', REACT_APP_POSTHOG_KEY: '',
      // Core is native-only in Production; on web it opens only for a non-production,
      // isolated (loopback) backend — exactly this lab (src/utils/runtimePlatform.js).
      REACT_APP_DEPLOY_ENV: 'development', REACT_APP_TORNEOS_DATA_ENV: 'local',
      REACT_APP_TORNEOS_ENABLED: 'true', REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
      REACT_APP_AUTH_REDIRECT_URL: `${APP_ORIGIN}/auth/callback` },
  });
  child.on('exit', (code) => { process.exitCode = code ?? 0; });
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'prepare') return prepare();
  if (cmd === 'up') return up();
  if (cmd === 'seed') return (await import('./seed.mjs')).seed();
  if (cmd === 'app') return app();
  if (cmd === 'down') return dc(['down', '--remove-orphans']);
  if (cmd === 'destroy') return dc(['down', '-v', '--remove-orphans']);
  throw new Error('Use prepare | up | seed | app | down | destroy. No remote operations exist.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('Core lab operation failed (local services only):', e?.message ?? ''); process.exitCode = 1; });
}
