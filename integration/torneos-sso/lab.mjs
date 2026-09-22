import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportJWK, exportPKCS8, SignJWT } from 'jose';

export const root = fileURLToPath(new URL('.', import.meta.url));
const docker = process.platform === 'darwin'
  ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
// Force the local Unix socket, ignoring DOCKER_HOST/context inherited by shell.
export function dc(args, input, capture = false) {
  const r = spawnSync(docker, ['--host', 'unix:///var/run/docker.sock', 'compose',
    '--project-name', 'arma2-sso-phase15', '--env-file', '.runtime/compose.env',
  '-f', 'compose.yaml', ...args], {
    cwd: root, input, encoding: 'utf8',
    env: { ...process.env, PATH: process.platform === 'darwin'
      ? `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` : process.env.PATH },
    stdio: ['pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  });
  if (r.status !== 0) throw new Error(`local compose ${args[0]} failed (output withheld)`);
  return r.stdout;
}
export function sql(service, query) {
  if (!['core-db', 'torneos-db'].includes(service)) throw new Error('unknown local DB');
  return dc(['exec', '-T', service, 'psql', '-U', 'supabase_admin', '-d', 'postgres',
    '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], query, true);
}
export async function config() {
  return JSON.parse(await readFile(new URL('.runtime/config.json', import.meta.url)));
}
export async function writeServerConfig(c) {
  // The running bridge does not need Core's signing secret or DB admin password.
  await mkdir(`${root}.runtime/server`, { recursive: true, mode: 0o700 });
  const { readerPassword, writerPassword, anonKey, keys, activeKid, trustedKids } = c;
  await writeFile(`${root}.runtime/server/config.json`,
    JSON.stringify({readerPassword,writerPassword,anonKey,keys,activeKid,trustedKids}),{mode:0o600});
}
async function prepare() {
  await mkdir(`${root}.runtime/public`, { recursive: true, mode: 0o700 });
  try { await access(`${root}.runtime/config.json`); }
  catch {
    const secret = () => randomBytes(32).toString('hex');
    const coreSecret = secret();
    const keys = [];
    for (const kid of ['poc-k1', 'poc-k2']) {
      const pair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
      keys.push({ kid, privateKey: await exportPKCS8(pair.privateKey),
        publicKey: { ...await exportJWK(pair.publicKey), kid, alg: 'RS256', use: 'sig' } });
    }
    const anonKey = await new SignJWT({ role: 'anon' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(coreSecret));
    const cfg = { dbPassword: secret(), readerPassword: secret(), writerPassword: secret(),
      coreSecret, anonKey, keys, activeKid: 'poc-k1', trustedKids: ['poc-k1'] };
    await writeFile(`${root}.runtime/config.json`, JSON.stringify(cfg), { mode: 0o600 });
    await writeFile(`${root}.runtime/compose.env`,
      `DB_PASSWORD=${cfg.dbPassword}\nCORE_JWT_SECRET=${coreSecret}\n`, { mode: 0o600 });
    await writeFile(`${root}.runtime/public/jwks.json`, JSON.stringify({ keys: [keys[0].publicKey] }));
  }
  await writeServerConfig(await config());

}
async function waitForReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:58410/health');
      if (r.ok) return;
    } catch { /* only fixed loopback target */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('local gateway readiness failed');
}
async function main() {
  if (process.argv[2] === 'prepare') return prepare();
  if (process.argv[2] === 'up') {
    await prepare();
    const c = await config();
    dc(['up', '-d', '--wait', 'core-db', 'torneos-db']);
    sql('core-db', `ALTER ROLE supabase_auth_admin PASSWORD '${c.dbPassword}'; ALTER ROLE authenticator PASSWORD '${c.dbPassword}';
      ALTER ROLE poc_session_reader PASSWORD '${c.readerPassword}';`);
    sql('torneos-db', `ALTER ROLE authenticator PASSWORD '${c.dbPassword}';
      ALTER ROLE poc_identity_writer PASSWORD '${c.writerPassword}';`);
    dc(['up', '-d']);
    await waitForReady();
    // Tighten Core reader after GoTrue's own migrations have completed.
    sql('core-db', `REVOKE SELECT ON ALL TABLES IN SCHEMA auth FROM poc_session_reader;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth
        REVOKE SELECT ON TABLES FROM poc_session_reader;
      GRANT SELECT (id,user_id,not_after) ON auth.sessions TO poc_session_reader;
      GRANT SELECT (id,banned_until,deleted_at) ON auth.users TO poc_session_reader;
      DROP POLICY IF EXISTS poc_session_lookup ON auth.sessions;
      CREATE POLICY poc_session_lookup ON auth.sessions FOR SELECT TO poc_session_reader USING (true);
      DROP POLICY IF EXISTS poc_user_lookup ON auth.users;
      CREATE POLICY poc_user_lookup ON auth.users FOR SELECT TO poc_session_reader USING (true);`);
    sql('core-db', await readFile(`${root}core-profile-fixture.sql`, 'utf8'));
    dc(['restart', 'core-rest']);
    console.log('Local-only Phase 1.5 ready at http://127.0.0.1:58410');
    return;
  }
  if (process.argv[2] === 'down') return dc(['down']);
  throw new Error('Use prepare | up | down. No remote operations supported.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('POC operation failed; inspect local services, never remote targets.'); process.exitCode = 1; });
}
