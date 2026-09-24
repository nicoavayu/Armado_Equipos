// INFRA-1 R3 — the runner's view of the Arma2 Torneos database password in the macOS Keychain.
//
//   check()     /usr/bin/security find-generic-password -s arma2-torneos-dataplane-db -a postgres (no -w)
//               exit 0 → PRESENT, 44 (errSecItemNotFound) → ABSENT, anything else → throws (ambiguous)
//   generate()  keychain-foundation.py generate (the value is created and stored inside Python via a pty)
//   read()      the same find with -w: the value arrives on this process's stdout pipe, is validated
//               (40 URL-safe chars) and returned to the caller's memory only. argv never carries it.
import { spawnSync as realSpawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYCHAIN_DB, FORBIDDEN_KEYCHAIN_SERVICES, DB_PASSWORD_PATTERN } from './foundation-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECURITY = '/usr/bin/security';
export const KEYCHAIN_HELPER = path.join(HERE, 'keychain-foundation.py');

export function assertNamespace(ns) {
  if (ns.service !== 'arma2-torneos-dataplane-db' || ns.account !== 'postgres') throw new Error('keychain_namespace_not_pinned');
  if (FORBIDDEN_KEYCHAIN_SERVICES.includes(ns.service)) throw new Error('keychain_namespace_collides');
  return ns;
}

export function systemKeychain({ spawnSync = realSpawnSync, python = 'python3' } = {}) {
  const ns = assertNamespace(KEYCHAIN_DB);
  return {
    namespace: ns,
    check() {
      const r = spawnSync(SECURITY, ['find-generic-password', '-s', ns.service, '-a', ns.account], { stdio: ['ignore', 'ignore', 'ignore'] });
      if (r.status === 0) return 'PRESENT';
      if (r.status === 44) return 'ABSENT';
      throw new Error(`keychain_check_ambiguous_status_${r.status}`);
    },
    generate() {
      const r = spawnSync(python, [KEYCHAIN_HELPER, 'generate'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
      if (r.status === 0 && /^KEYCHAIN_GENERATED length=40$/m.test(r.stdout ?? '')) return 'KEYCHAIN_GENERATED';
      if (r.status === 10) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_REGENERATE');
      throw new Error(`keychain_generate_failed_status_${r.status}`);
    },
    read() {
      const r = spawnSync(SECURITY, ['find-generic-password', '-s', ns.service, '-a', ns.account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4096 });
      if (r.status !== 0) throw new Error(`keychain_read_failed_status_${r.status}`);
      const v = String(r.stdout ?? '').replace(/\n$/, '');
      if (!DB_PASSWORD_PATTERN.test(v)) throw new Error('keychain_value_malformed');
      return v;
    },
  };
}
