// GATEWAY/AUTH — the psql leg of --db-bootstrap: sends the ONE rendered bootstrap transaction (W2 + W3) to Arma2 Torneos
// over the Session Pooler (5432) as postgres.<torneos ref>, sslmode=verify-full with the Supabase CA. The SQL goes on
// psql's STDIN (never a file, never argv); it carries SCRAM verifiers, never a plaintext login password. The child gets
// a MINIMAL environment built here (never the operator's PG* variables): the installer password only as PGPASSWORD.
import { spawn as realSpawn } from 'node:child_process';
import fs from 'node:fs';
import { TORNEOS_REF } from './gateway-auth-contract.mjs';

export const PSQL_BIN = '/opt/homebrew/opt/libpq/bin/psql';
export const CA_CERT = '/Users/nicoavayu/Downloads/prod-ca-2021.crt';
export const POOLER_HOST_PATTERN = /^aws-\d+-sa-east-1\.pooler\.supabase\.com$/;
const TIMEOUT_MS = 2 * 60 * 1000;

export function assertPsqlPrerequisites({ fsImpl = fs } = {}) {
  const failures = [];
  try { fsImpl.accessSync(PSQL_BIN, fsImpl.constants.X_OK); } catch { failures.push('psql_missing'); }
  try { const st = fsImpl.lstatSync(CA_CERT); if (!st.isFile() || st.isSymbolicLink()) failures.push('ca_not_regular_file'); } catch { failures.push('ca_missing'); }
  return failures;
}

export function psqlEnv({ host, password }) {
  if (!POOLER_HOST_PATTERN.test(host)) throw new Error('pooler_host_not_sa_east_1');
  return {
    PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C', PGHOST: host, PGPORT: '5432', PGUSER: `postgres.${TORNEOS_REF}`, PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: CA_CERT, PGCONNECT_TIMEOUT: '20', PGAPPNAME: 'arma2-torneos-gateway-auth-db-bootstrap', PGPASSWORD: password,
  };
}

/** `psql -X -v ON_ERROR_STOP=1 -q -f -` with the SQL on stdin; resolves {code, elapsed_ms, stderr_tail} (never rejects). */
export function applySql({ sql, env, redact, spawn = realSpawn }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(PSQL_BIN, ['-X', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], { env, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => { err = (err + c.toString('utf8')).slice(-8000); });
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, elapsed_ms: Date.now() - started, stderr_tail: redact(`spawn_error ${e.message}`) }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code: code ?? -1, signal: signal ?? null, elapsed_ms: Date.now() - started, stderr_tail: redact(err.split('\n').filter((l) => l && !/NOTICE:/.test(l)).slice(-8).join('\n')) }); });
    child.stdin.end(sql);
  });
}
