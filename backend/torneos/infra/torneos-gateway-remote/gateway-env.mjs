// GATEWAY REMOTE — the gateway's REAL Production environment, assembled in the session's memory only:
//   secrets  TORNEOS_CONTRACT_SERVICE_SECRET  Keychain arma2-torneos-prod-core-contract/contract-secret (the value Core
//                                             Production's torneos-core-contract holds; INFRA-0.5 custody, read-only here)
//            TORNEOS_BRIDGE_KEYS              Keychain arma2-torneos-prod-bridge (k1 private + public, k2 public) ≡ the pin
//            TORNEOS_DB_*_URL                 Keychain arma2-torneos-gateway-db/<login>, Supavisor transaction port 6543
//   config   pinned URLs/origin (gateway-auth-contract GATEWAY_TOPOLOGY), Torneos publishable key (Management API),
//            Core Production anon key (public web bundle), the Supabase root CA (base64), the public URL once known.
// The document is validated by the REAL gateway config.ts + boot() (recording DB stub: nothing connects) before use.
import fs from 'node:fs';
import https from 'node:https';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';
import { gatewayRingDocument } from '../torneos-gateway-auth/keyring.mjs';
import { CA_CERT, POOLER_HOST_PATTERN } from '../torneos-gateway-auth/psql-gateway-auth.mjs';
import { CORE_PUBLIC_KEY_SOURCE, assertCoreAnonKey, ENV_NAMES, SECRET_NAMES, GATEWAY_MOUNT, DEFAULT_HOST_RE, sha256 } from './remote-contract.mjs';

export const PENDING_PUBLIC_URL = 'https://torneos-gateway.pending.invalid/functions/v1/torneos-gateway';

export function publicUrlForHost(host) {
  if (!DEFAULT_HOST_RE.test(host)) throw new Error('gateway_host_not_the_deno_default_alias');
  return `https://${host}${GATEWAY_MOUNT}`;
}

export function buildGatewayEnv({ publicUrl, poolerHost, jwksPin, k1Pkcs8, torneosAnonKey, coreAnonKey, caPem, contractSecret, passwords }) {
  if (!POOLER_HOST_PATTERN.test(poolerHost ?? '')) throw new Error('pooler_host_not_sa_east_1');
  if (!/^[0-9a-f]{64}$/.test(contractSecret ?? '')) throw new Error('contract_secret_shape');
  assertCoreAnonKey(coreAnonKey);
  const url = (login) => {
    const pw = passwords[login];
    if (!G.DB_PASSWORD_PATTERN.test(pw ?? '')) throw new Error('db_password_shape');
    return `postgres://${login}.${G.TORNEOS_REF}:${pw}@${poolerHost}:6543/postgres`;
  };
  const env = {
    TORNEOS_GATEWAY_PUBLIC_URL: publicUrl,
    TORNEOS_ALLOWED_ORIGIN: G.GATEWAY_TOPOLOGY.allowedOrigin,
    CORE_AUTH_URL: G.GATEWAY_TOPOLOGY.coreAuthUrl,
    CORE_JWT_ISSUER: G.GATEWAY_TOPOLOGY.coreJwtIssuer,
    CORE_ANON_KEY: coreAnonKey,
    CORE_CONTRACT_URL: G.GATEWAY_TOPOLOGY.coreContractUrl,
    TORNEOS_CONTRACT_SERVICE_SECRET: contractSecret,
    TORNEOS_REST_URL: G.GATEWAY_TOPOLOGY.torneosRestUrl,
    TORNEOS_ANON_KEY: torneosAnonKey,
    TORNEOS_DB_IDENTITY_WRITER_URL: url(G.GATEWAY_TOPOLOGY.identityWriterLogin),
    TORNEOS_DB_CORE_ADAPTER_URL: url(G.GATEWAY_TOPOLOGY.coreAdapterLogin),
    TORNEOS_DB_SSL_CA: Buffer.from(caPem).toString('base64'),
    TORNEOS_BRIDGE_KEYS: JSON.stringify(gatewayRingDocument({ k1Pkcs8, jwksPin })),
  };
  if (Object.keys(env).sort().join(',') !== [...ENV_NAMES].join(',')) throw new Error('gateway_env_names_not_exact');
  return env;
}

/** Deno env_vars entries: secrets flagged, contexts all (no preview/branch timeline is ever deployed). */
export function denoEnvVars(env, { omit = [] } = {}) {
  return Object.keys(env).filter((k) => !omit.includes(k)).sort().map((key) => ({ key, value: env[key], secret: SECRET_NAMES.includes(key), contexts: 'all' }));
}

/** Evidence-safe description: names, secret flags, and digests of the NON-secret values only. */
export function describeEnv(env) {
  return Object.keys(env).sort().map((k) => (SECRET_NAMES.includes(k) ? { key: k, secret: true } : { key: k, secret: false, sha256_16: sha256(env[k]).slice(0, 16), bytes: Buffer.byteLength(env[k]) }));
}

export function readCaPem(file = CA_CERT) {
  const pem = fs.readFileSync(file, 'utf8');
  if (!/^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----\n?$/.test(pem)) throw new Error('ca_pem_shape');
  return pem;
}

const get = (url) => new Promise((resolve, reject) => {
  const req = https.get(url, { headers: { 'user-agent': 'arma2-torneos-gateway-remote/1' }, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (res) => {
    if (res.statusCode !== 200) { res.resume(); reject(new Error(`core_public_key_http_${res.statusCode}`)); return; }
    const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
  });
  req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  req.on('error', reject);
});

/** The Core Production anon key the shipped web bundle carries (public by design). Exactly one, Core Production, anon. */
export async function fetchCoreAnonKey({ fetchText = get } = {}) {
  const html = await fetchText(CORE_PUBLIC_KEY_SOURCE.page);
  const m = CORE_PUBLIC_KEY_SOURCE.bundleRe.exec(html);
  if (!m) throw new Error('core_public_bundle_not_found');
  const js = await fetchText(new URL(m[1], CORE_PUBLIC_KEY_SOURCE.page).href);
  const found = [...new Set([...(js.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) ?? []), ...(js.match(/sb_publishable_[A-Za-z0-9_-]{10,}/g) ?? [])])]
    .filter((k) => { try { assertCoreAnonKey(k); return true; } catch { return false; } });
  if (found.length !== 1) throw new Error(`core_public_key_count_${found.length}`);
  return { key: found[0], source: { page: CORE_PUBLIC_KEY_SOURCE.page, bundle: m[1], kind: assertCoreAnonKey(found[0]).kind, sha256_12: sha256(found[0]).slice(0, 12) } };
}
