// COMMERCE-PRODUCTION — Keychain custody of the production payments secrets the tooling generates itself (same contract as
// the certified TEST custody). Values never reach argv: generation happens inside keychain-payments-production.py (pty),
// reads use `security … -w` into this process only.
//   dbPassword.check() / generate() / read()      arma2-torneos-payments-production / torneos_payments_prod  (40 chars)
//   internalSecret.check() / generate() / read()  arma2-torneos-payments-production / internal-hmac-key      (64 hex)
//   installer.check() / read()                    arma2-torneos-dataplane-db / postgres (certified INFRA-1 R3 custody, read-only)
import { spawnSync as realSpawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNTS, INTERNAL_SECRET_PATTERN, DB_PASSWORD_PATTERN } from './production-contract.mjs';
import { KEYCHAIN_DATAPLANE_DB } from '../torneos-gateway-auth/gateway-auth-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECURITY = '/usr/bin/security';
export const KEYCHAIN_HELPER = path.join(HERE, 'keychain-payments-production.py');
const PINNED = new Map([
  [`${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNTS.dbPassword}`, DB_PASSWORD_PATTERN],
  [`${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNTS.internalSecret}`, INTERNAL_SECRET_PATTERN],
  [`${KEYCHAIN_DATAPLANE_DB.service}/${KEYCHAIN_DATAPLANE_DB.account}`, DB_PASSWORD_PATTERN],
]);

export function productionKeychain({ spawnSync = realSpawnSync, python = 'python3' } = {}) {
  const pattern = (service, account) => PINNED.get(`${service}/${account}`) ?? (() => { throw new Error('keychain_namespace_not_pinned'); })();
  const check = (service, account) => {
    pattern(service, account);
    const r = spawnSync(SECURITY, ['find-generic-password', '-s', service, '-a', account], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (r.status === 0) return 'PRESENT';
    if (r.status === 44) return 'ABSENT';
    throw new Error(`keychain_check_ambiguous_status_${r.status}`);
  };
  const read = (service, account) => {
    const re = pattern(service, account);
    const r = spawnSync(SECURITY, ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8192 });
    if (r.status !== 0) throw new Error(`keychain_read_failed_status_${r.status}`);
    const v = String(r.stdout ?? '').replace(/\n$/, '');
    if (!re.test(v)) throw new Error('keychain_value_malformed');
    return v;
  };
  const generate = (account) => {
    const r = spawnSync(python, [KEYCHAIN_HELPER, 'generate', KEYCHAIN_SERVICE, account], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    if (r.status === 0 && /^KEYCHAIN_GENERATED length=\d+$/m.test(r.stdout ?? '')) return 'KEYCHAIN_GENERATED';
    if (r.status === 10) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_OVERWRITE');
    throw new Error(`keychain_generate_failed_status_${r.status}`);
  };
  const own = (account) => ({ check: () => check(KEYCHAIN_SERVICE, account), generate: () => generate(account), read: () => read(KEYCHAIN_SERVICE, account) });
  return {
    dbPassword: own(KEYCHAIN_ACCOUNTS.dbPassword),
    internalSecret: own(KEYCHAIN_ACCOUNTS.internalSecret),
    installer: { check: () => check(KEYCHAIN_DATAPLANE_DB.service, KEYCHAIN_DATAPLANE_DB.account), read: () => read(KEYCHAIN_DATAPLANE_DB.service, KEYCHAIN_DATAPLANE_DB.account) },
  };
}
