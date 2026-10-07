// COMMERCE-PRODUCTION lab: one disposable PostgreSQL (the image of the certified Torneos lab) with the Torneos
// migrations applied in order, exactly like integration/torneos-core-contracts/lab.mjs installs them, but in its own
// container and on its own loopback port. It never touches the shared lab (its ports are taken by the integration
// preview) and needs no GoTrue, PostgREST or edge-runtime: the suites emulate PostgREST the way the certified MP-A
// helpers do (SET LOCAL ROLE + request.jwt.claims) and connect as the real payment logins over TCP.
//
//   node backend/torneos/commerce-production/lab/pg-lab.mjs up        # create (or reuse) and migrate
//   node backend/torneos/commerce-production/lab/pg-lab.mjs down      # remove the container (no volume is kept)
//
// Runtime state (generated passwords) lives outside the repository, in $TMPDIR/arma2-commerce-production-lab.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../../..');
export const MIGRATIONS_DIR = path.join(REPO, 'backend/torneos/supabase/migrations');
export const IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.143';
export const CONTAINER = process.env.COMMERCE_PRODUCTION_LAB_CONTAINER || 'arma2-commerce-production-lab-db';
export const PORT = Number(process.env.COMMERCE_PRODUCTION_LAB_PORT || 58650);
const STATE_DIR = path.join(os.tmpdir(), 'arma2-commerce-production-lab');
const STATE_FILE = path.join(STATE_DIR, `${CONTAINER}.json`);
const DOCKER = process.platform === 'darwin' ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
// Logins of the lab: NOINHERIT members of the NOLOGIN roles the migrations create (the migrations never create logins).
export const LOGINS = Object.freeze({
  test: Object.freeze({ login: 'lab_payment_service', role: 'torneos_payment_service' }),
  production: Object.freeze({ login: 'lab_payment_production_service', role: 'torneos_payment_production_service' }),
});

function docker(args, { input, capture = true } = {}) {
  const r = spawnSync(DOCKER, ['--host', 'unix:///var/run/docker.sock', ...args], {
    input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` },
    stdio: ['pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** psql as supabase_admin (the installer of the certified lab). Throws with the ERROR lines only. */
export function sql(query, { user = 'supabase_admin' } = {}) {
  const r = sqlTry(query, { user });
  if (!r.ok) throw new Error(r.error || 'sql failed');
  return r.out;
}
export function sqlTry(query, { user = 'supabase_admin' } = {}) {
  if (!['supabase_admin', 'postgres'].includes(user)) throw new Error('unknown DB user');
  const r = docker(['exec', '-i', CONTAINER, 'psql', '-U', user, '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], { input: query });
  return { ok: r.ok, out: r.out, error: r.ok ? null : r.err.split('\n').filter((l) => /^(ERROR|FATAL|DETAIL|HINT):/.test(l)).join('\n') };
}

export function state() {
  if (!existsSync(STATE_FILE)) throw new Error(`lab not prepared: run node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} up`);
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}
/** postgres:// URL of a lab login over the published loopback port. */
export function loginUrl(kind) {
  const s = state();
  const { login } = LOGINS[kind];
  return `postgres://${login}:${s.passwords[login]}@127.0.0.1:${PORT}/postgres`;
}

function running() {
  const r = docker(['inspect', '-f', '{{.State.Running}}', CONTAINER]);
  return r.ok && r.out.trim() === 'true';
}

// The image initializes on first boot and restarts the server once: ready = the healthcheck passes and the API roles
// exist on three consecutive probes.
async function waitReady() {
  let streak = 0;
  for (let i = 0; i < 120; i += 1) {
    const health = docker(['inspect', '-f', '{{.State.Health.Status}}', CONTAINER]).out.trim();
    const probe = health === 'healthy' ? sqlTry("select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')") : { ok: false };
    streak = probe.ok && probe.out.trim() === '3' ? streak + 1 : 0;
    if (streak >= 3) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('lab database did not become ready');
}

/** Applies every Torneos migration once, in order (0010 needs Supabase Storage and is skipped, as in the shared lab). */
export function migrate({ upTo = null } = {}) {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort()
    .filter((f) => upTo === null || f.slice(0, 14) <= upTo);
  sql(`CREATE SCHEMA IF NOT EXISTS lab_meta;
    CREATE TABLE IF NOT EXISTS lab_meta.torneos_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
    REVOKE ALL ON SCHEMA lab_meta FROM PUBLIC;`);
  const ledger = new Set(sql('SELECT name FROM lab_meta.torneos_migrations').split('\n').map((x) => x.trim()).filter(Boolean));
  const storageReady = sql("select to_regclass('storage.objects') is not null").trim() === 't';
  const applied = [];
  for (const name of files) {
    if (ledger.has(name)) continue;
    if (name.endsWith('_branding_v1.sql') && !storageReady) { applied.push({ name, skipped: 'no storage' }); continue; }
    const text = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    const digest = createHash('sha256').update(text).digest('hex');
    sql(text);
    sql(`INSERT INTO lab_meta.torneos_migrations (name, sha256) VALUES ('${name}', '${digest}') ON CONFLICT (name) DO NOTHING`);
    applied.push({ name, sha256: digest });
  }
  return applied;
}

export function ensureLogins(passwords) {
  for (const { login, role } of Object.values(LOGINS)) {
    sql(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${login}') THEN CREATE ROLE ${login} LOGIN NOINHERIT; END IF;
        EXECUTE format('ALTER ROLE ${login} PASSWORD %L', '${passwords[login]}');
        GRANT ${role} TO ${login};
      END IF;
    END $$;`);
  }
}

export async function up({ fresh = false, upTo = null } = {}) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  if (fresh) docker(['rm', '-f', CONTAINER]);
  let s = existsSync(STATE_FILE) && running() && !fresh ? state() : null;
  if (!s) {
    docker(['rm', '-f', CONTAINER]);
    const dbPassword = randomBytes(18).toString('hex');
    const r = docker(['run', '-d', '--name', CONTAINER, '--label', 'arma2.lab=commerce-production',
      '-e', `POSTGRES_PASSWORD=${dbPassword}`, '-p', `127.0.0.1:${PORT}:5432`, IMAGE,
      'postgres', '-D', '/etc/postgresql', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic', '-c', 'log_parameter_max_length_on_error=0']);
    if (!r.ok) throw new Error(`docker run failed: ${r.err.split('\n')[0]}`);
    s = { container: CONTAINER, port: PORT, passwords: Object.fromEntries(Object.values(LOGINS).map(({ login }) => [login, randomBytes(18).toString('hex')])) };
    writeFileSync(STATE_FILE, JSON.stringify(s), { mode: 0o600 });
  }
  await waitReady();
  const applied = migrate({ upTo });
  ensureLogins(s.passwords);
  return { container: CONTAINER, port: PORT, applied };
}

export function down() {
  docker(['rm', '-f', CONTAINER]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === 'up' || command === 'fresh') {
    const result = await up({ fresh: command === 'fresh' });
    process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
  } else if (command === 'down') {
    down();
    process.stdout.write('down\n');
  } else {
    process.stderr.write('usage: pg-lab.mjs up | fresh | down\n');
    process.exit(2);
  }
}
