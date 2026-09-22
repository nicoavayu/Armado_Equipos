// Configuration only: this module does not initialize a client and does not
// touch the network. Keep the legacy Core env pair until build/auth/route guards
// migrate together.
//
// Everything Torneos goes through ONE gateway URL (`REACT_APP_TORNEOS_GATEWAY_URL`):
// exchange, RPC and the table routes of the certified contract. There is no
// separate Data API target and nothing is ever inherited from Core.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function parseUrl(value, invalidCode) {
  try {
    return new URL(value);
  } catch {
    throw new Error(invalidCode);
  }
}

// Mirrors the gateway's own rule: https everywhere, plain http only on loopback
// (the local labs). No credentials, no query, no fragment.
export function assertTorneosGatewayUrl(value, { coreOrigin = null, productionRef = '' } = {}) {
  const url = parseUrl(value, 'TORNEOS_CONFIG_INVALID');
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const protocolOk = url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
  if (!protocolOk || url.username || url.password || url.search || url.hash) {
    throw new Error('TORNEOS_CONFIG_INVALID');
  }
  if (productionRef && url.hostname.toLowerCase().split('.').includes(productionRef)) {
    throw new Error('TORNEOS_CONFIG_PRODUCTION_TARGET');
  }
  if (coreOrigin && url.origin === coreOrigin) {
    throw new Error('TORNEOS_CORE_TARGET_COLLISION');
  }
  return url.href.replace(/\/$/, '');
}

export function readDualBackendConfig(env = process.env) {
  const coreUrl = env.REACT_APP_CORE_SUPABASE_URL || env.REACT_APP_SUPABASE_URL || '';
  const coreAnonKey = env.REACT_APP_CORE_SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY || '';
  const explicitPair = [env.REACT_APP_CORE_SUPABASE_URL, env.REACT_APP_CORE_SUPABASE_ANON_KEY];
  if (explicitPair.some(Boolean) && !explicitPair.every(Boolean)) {
    throw new Error('CORE_CONFIG_INCOMPLETE');
  }
  if ((env.REACT_APP_SUPABASE_URL && explicitPair[0] && env.REACT_APP_SUPABASE_URL !== explicitPair[0])
    || (env.REACT_APP_SUPABASE_ANON_KEY && explicitPair[1] && env.REACT_APP_SUPABASE_ANON_KEY !== explicitPair[1])) {
    throw new Error('CORE_CONFIG_CONFLICT');
  }
  const productionRef = String(env.REACT_APP_PRODUCTION_PROJECT_REF || '').trim().toLowerCase();
  // No inheritance from Core: absent Torneos configuration stays absent.
  const rawGatewayUrl = String(env.REACT_APP_TORNEOS_GATEWAY_URL || '').trim();
  let gatewayUrl = '';
  if (rawGatewayUrl) {
    const coreOrigin = coreUrl ? parseUrl(coreUrl, 'CORE_CONFIG_INVALID').origin : null;
    gatewayUrl = assertTorneosGatewayUrl(rawGatewayUrl, { coreOrigin, productionRef });
  }
  return Object.freeze({
    core: Object.freeze({ url: coreUrl, anonKey: coreAnonKey }),
    // `enabled` only says a gateway target exists; the feature flags still decide
    // whether Torneos opens at all (see resolveTorneosBackendMode).
    torneos: Object.freeze({ gatewayUrl, enabled: Boolean(gatewayUrl) }),
  });
}

// Which composition `/torneos` mounts.
//
//   hybrid        gateway configured → Core session + exchange + staging-v1 adapter
//   legacy-local  no gateway and the LOCAL single-project QA stack → legacy service
//   disabled      anything else (staging/preview without a gateway never falls back
//                 to the Core project for Torneos data)
export function resolveTorneosBackendMode(env = process.env) {
  let config;
  try {
    config = readDualBackendConfig(env);
  } catch (error) {
    return { mode: 'disabled', reason: error.message, gatewayUrl: '' };
  }
  if (config.torneos.enabled) {
    return { mode: 'hybrid', reason: null, gatewayUrl: config.torneos.gatewayUrl };
  }
  const dataEnvironment = String(env.REACT_APP_TORNEOS_DATA_ENV || '').trim().toLowerCase();
  if (dataEnvironment === 'local') {
    return { mode: 'legacy-local', reason: null, gatewayUrl: '' };
  }
  return { mode: 'disabled', reason: 'TORNEOS_GATEWAY_NOT_CONFIGURED', gatewayUrl: '' };
}
