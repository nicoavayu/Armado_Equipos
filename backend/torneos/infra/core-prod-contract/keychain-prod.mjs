#!/usr/bin/env node
// INFRA-0.5 — the runner's view of the Production Keychain entry. The namespace is bound here
// (prod-contract.mjs KEYCHAIN_PROD) and asserted on construction; no caller can choose another.
//
//   check()        /usr/bin/security find-generic-password -s <prod> -a contract-secret  (no -w: no value)
//                  exit 0 → PRESENT, 44 (errSecItemNotFound) → ABSENT, anything else → throws (ambiguous)
//   read()         the same with -w; the value arrives on this process's stdout pipe, is validated
//                  (64 hex) and returned to the caller's memory only. argv never carries it.
//   readNonprod()  the certified non-production entry, read ONLY to prove the Production value differs
//                  (compared in memory by the runner; null when absent)
//   generate()     keychain-prod.py generate (32 random bytes created and stored inside Python via a pty)
import { spawnSync as realSpawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYCHAIN_PROD, NONPROD_CONTRACT_KEYCHAIN, SECRET_PATTERN, assertProdKeychainNamespace } from './prod-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECURITY = '/usr/bin/security';
export const KEYCHAIN_HELPER = path.join(HERE, 'keychain-prod.py');

export function systemKeychain({ spawnSync = realSpawnSync, python = 'python3' } = {}) {
  const ns = assertProdKeychainNamespace(KEYCHAIN_PROD);
  const readValue = ({ service, account }, { allowAbsent }) => {
    const r = spawnSync(SECURITY, ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4096 });
    if (r.status === 44 && allowAbsent) return null;
    if (r.status !== 0) throw new Error(`keychain_read_failed_status_${r.status}`);
    const value = String(r.stdout ?? '').replace(/\n$/, '');
    if (!SECRET_PATTERN.test(value)) throw new Error('keychain_value_malformed');
    return value;
  };
  return {
    namespace: ns,
    check() {
      const r = spawnSync(SECURITY, ['find-generic-password', '-s', ns.service, '-a', ns.account], { stdio: ['ignore', 'ignore', 'ignore'] });
      if (r.status === 0) return 'PRESENT';
      if (r.status === 44) return 'ABSENT';
      throw new Error(`keychain_check_ambiguous_status_${r.status}`);
    },
    read: () => readValue(ns, { allowAbsent: false }),
    readNonprod: () => readValue(NONPROD_CONTRACT_KEYCHAIN, { allowAbsent: true }),
    generate() {
      const r = spawnSync(python, [KEYCHAIN_HELPER, 'generate'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
      if (r.status === 0 && /^KEYCHAIN_GENERATED length=64$/m.test(r.stdout ?? '')) return 'KEYCHAIN_GENERATED';
      if (r.status === 10) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_REGENERATE');
      throw new Error(`keychain_generate_failed_status_${r.status}`);
    },
  };
}
