// GATEWAY/AUTH — credential-free TLS check of the Arma2 Torneos Supavisor pooler: PostgreSQL STARTTLS, the Supabase
// root CA only, hostname verified, every verification error fatal (openssl s_client -verify_return_error). No user, no
// password, no query: it proves what `sslmode=verify-full` will see before (and independently of) any login.
import { spawnSync as realSpawnSync } from 'node:child_process';
import { CA_CERT, POOLER_HOST_PATTERN } from './psql-gateway-auth.mjs';

export const OPENSSL_BIN = ['/opt/homebrew/bin/openssl', '/usr/bin/openssl'];

export function probeTls({ host, port, spawnSync = realSpawnSync, openssl = OPENSSL_BIN.find((p) => spawnSync(p, ['version'], { stdio: 'ignore' }).status === 0) }) {
  if (!POOLER_HOST_PATTERN.test(host)) throw new Error('pooler_host_not_sa_east_1');
  if (![5432, 6543].includes(port)) throw new Error('pooler_port_not_pinned');
  if (!openssl) return { host, port, pass: false, error: 'openssl_missing' };
  const r = spawnSync(openssl, ['s_client', '-starttls', 'postgres', '-connect', `${host}:${port}`, '-servername', host, '-verify_hostname', host,
    '-CAfile', CA_CERT, '-verify_return_error', '-brief'], { input: '', encoding: 'utf8', timeout: 20000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const pick = (re) => (re.exec(text)?.[1] ?? null);
  const verified = /Verification: OK/.test(text) || /Verify return code: 0 \(ok\)/.test(text);
  return {
    host, port, pass: r.status === 0 && verified, exit: r.status, verification: verified ? 'OK' : (pick(/verify error:([^\n]+)/) ?? 'FAILED'),
    protocol: pick(/Protocol version: ([^\n]+)/), peer_cn: pick(/Peer certificate: [^\n]*CN\s?=\s?([^,\n]+)/), hostname_verified: host,
  };
}
