// GATEWAY/AUTH — the runner's view of the Production gateway/auth custody (macOS Keychain). Values never reach argv:
// generation and storage happen inside keychain-gateway-auth.py (pty), reads use `security … -w` into this process only.
//
//   dbLogin(login).check() / generate() / read()      arma2-torneos-gateway-db / <login>
//   dataplane.check() / read()                        arma2-torneos-dataplane-db / postgres  (INFRA-1 R3, read-only here)
//   ring.check() → 'ABSENT' | 'PRESENT' | 'PARTIAL'   arma2-torneos-prod-bridge / k1.meta, k1.part0..19, k2.*
//   ring.store(generated)                             parts + meta per slot (refuses when anything is present)
//   ring.read(slot, kid)                              joined, digest- and kid-checked PKCS#8 (base64url)
import { spawnSync as realSpawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYCHAIN_BRIDGE_SERVICE, KEYCHAIN_GATEWAY_DB_SERVICE, KEYCHAIN_DATAPLANE_DB, FORBIDDEN_KEYCHAIN_SERVICES, EDGE_LOGINS, DB_PASSWORD_PATTERN, RING_SLOTS } from './gateway-auth-contract.mjs';
import { splitParts, joinParts, parseMeta, MAX_PARTS, PART_CHARS } from './keyring.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECURITY = '/usr/bin/security';
export const KEYCHAIN_HELPER = path.join(HERE, 'keychain-gateway-auth.py');

export function assertNamespace(service, account) {
  if (FORBIDDEN_KEYCHAIN_SERVICES.includes(service)) throw new Error('keychain_namespace_forbidden');
  const ok = (service === KEYCHAIN_GATEWAY_DB_SERVICE && EDGE_LOGINS.some((l) => l.login === account))
    || (service === KEYCHAIN_BRIDGE_SERVICE && /^k[12]\.(meta|part(1?[0-9]))$/.test(account))
    || (service === KEYCHAIN_DATAPLANE_DB.service && account === KEYCHAIN_DATAPLANE_DB.account);
  if (!ok) throw new Error('keychain_namespace_not_pinned');
}

export function systemKeychain({ spawnSync = realSpawnSync, python = 'python3' } = {}) {
  const check = (service, account) => {
    assertNamespace(service, account);
    const r = spawnSync(SECURITY, ['find-generic-password', '-s', service, '-a', account], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (r.status === 0) return 'PRESENT';
    if (r.status === 44) return 'ABSENT';
    throw new Error(`keychain_check_ambiguous_status_${r.status}`);
  };
  const read = (service, account, pattern) => {
    assertNamespace(service, account);
    const r = spawnSync(SECURITY, ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8192 });
    if (r.status !== 0) throw new Error(`keychain_read_failed_status_${r.status}`);
    const v = String(r.stdout ?? '').replace(/\n$/, '');
    if (!pattern.test(v)) throw new Error('keychain_value_malformed');
    return v;
  };
  const helper = (op, service, account, input) => {
    assertNamespace(service, account);
    const r = spawnSync(python, [KEYCHAIN_HELPER, op, service, account], { encoding: 'utf8', input: input ?? '', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    if (r.status === 0 && /^KEYCHAIN_(GENERATED|STORED) length=\d+$/m.test(r.stdout ?? '')) return true;
    if (r.status === 10) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_OVERWRITE');
    throw new Error(`keychain_${op}_failed_status_${r.status}`);
  };
  const partAccounts = (slot) => Array.from({ length: MAX_PARTS }, (_, i) => `${slot}.part${i}`);
  return {
    namespaces: { gatewayDb: KEYCHAIN_GATEWAY_DB_SERVICE, bridge: KEYCHAIN_BRIDGE_SERVICE, dataplane: KEYCHAIN_DATAPLANE_DB.service },
    dbLogin: (login) => ({
      check: () => check(KEYCHAIN_GATEWAY_DB_SERVICE, login),
      generate: () => helper('generate', KEYCHAIN_GATEWAY_DB_SERVICE, login),
      read: () => read(KEYCHAIN_GATEWAY_DB_SERVICE, login, DB_PASSWORD_PATTERN),
    }),
    dataplane: {
      check: () => check(KEYCHAIN_DATAPLANE_DB.service, KEYCHAIN_DATAPLANE_DB.account),
      read: () => read(KEYCHAIN_DATAPLANE_DB.service, KEYCHAIN_DATAPLANE_DB.account, DB_PASSWORD_PATTERN),
    },
    ring: {
      check() {
        const states = RING_SLOTS.flatMap((s) => [check(KEYCHAIN_BRIDGE_SERVICE, `${s}.meta`), check(KEYCHAIN_BRIDGE_SERVICE, `${s}.part0`)]);
        if (states.every((x) => x === 'ABSENT')) return 'ABSENT';
        if (states.every((x) => x === 'PRESENT')) return 'PRESENT';
        return 'PARTIAL';
      },
      store(generated) {
        if (this.check() !== 'ABSENT') throw new Error('KEYCHAIN_RING_PRESENT_REFUSE_OVERWRITE');
        for (const s of generated.slots) {
          const { parts, meta } = splitParts(s.pkcs8, s.kid);
          parts.forEach((p, i) => helper('store', KEYCHAIN_BRIDGE_SERVICE, `${s.slot}.part${i}`, p));
          helper('store', KEYCHAIN_BRIDGE_SERVICE, `${s.slot}.meta`, meta); // meta last: a slot without meta is PARTIAL
        }
        return 'KEYCHAIN_RING_STORED';
      },
      read(slot, kid) {
        const meta = parseMeta(read(KEYCHAIN_BRIDGE_SERVICE, `${slot}.meta`, /^v1;kid=[A-Za-z0-9_-]{1,64};parts=\d{1,2};sha256=[0-9a-f]{32}$/));
        const parts = partAccounts(slot).slice(0, meta.parts).map((a) => read(KEYCHAIN_BRIDGE_SERVICE, a, new RegExp(`^[A-Za-z0-9_-]{1,${PART_CHARS}}$`)));
        return joinParts(`v1;kid=${meta.kid};parts=${meta.parts};sha256=${meta.sha256}`, parts, kid);
      },
    },
  };
}
