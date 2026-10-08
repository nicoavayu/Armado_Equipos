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

// MP-A5: whether the hybrid composition may offer the Premium purchase. ONE variable never decides it.
//   `REACT_APP_TORNEOS_BILLING_MODE=test` (Mercado Pago Checkout Pro TEST, local lab only) counts only together
//   with the hybrid composition, a gateway AND a Core on loopback, the app itself served from loopback, a
//   development build and no Production reference anywhere.
//   `REACT_APP_TORNEOS_BILLING_MODE=production` (COMMERCE-PRODUCTION, real charges) counts only together with the
//   hybrid composition, an https public gateway, a production build of the production deployment with Torneos
//   Production enabled, PLAN READ (the price and the plan come from that read) and the app served from the
//   production web host itself (never a preview, never the native shells, whose origin is localhost).
// Every other value, and every missing condition, is `off`.
const BILLING_DEPLOY_ENVIRONMENTS = new Set(['development', 'local']);
export const PRODUCTION_BILLING_APP_HOSTS = Object.freeze(['app.arma2.com.ar']);

function isLoopbackTarget(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function resolveTorneosBillingMode(env = process.env, {
  backendMode = resolveTorneosBackendMode(env),
  appHostname = null,
} = {}) {
  const off = (reason) => Object.freeze({ mode: 'off', reason });
  const requested = String(env.REACT_APP_TORNEOS_BILLING_MODE ?? '').trim();
  if (!requested) return off('TORNEOS_BILLING_NOT_CONFIGURED');
  if (requested === 'production') return resolveProductionBilling(env, { backendMode, appHostname, off });
  if (requested !== 'test') return off('TORNEOS_BILLING_MODE_INVALID');
  if (backendMode?.mode !== 'hybrid' || !backendMode.gatewayUrl) return off('TORNEOS_BILLING_REQUIRES_HYBRID');
  const coreUrl = env.REACT_APP_CORE_SUPABASE_URL || env.REACT_APP_SUPABASE_URL || '';
  if (!isLoopbackTarget(backendMode.gatewayUrl)) return off('TORNEOS_BILLING_REQUIRES_LOCAL_GATEWAY');
  if (!isLoopbackTarget(coreUrl)) return off('TORNEOS_BILLING_REQUIRES_LOCAL_CORE');
  const productionRef = String(env.REACT_APP_PRODUCTION_PROJECT_REF || '').trim().toLowerCase();
  if (productionRef && [backendMode.gatewayUrl, coreUrl].some((target) => target.toLowerCase().includes(productionRef))) {
    return off('TORNEOS_BILLING_PRODUCTION_TARGET');
  }
  if (env.NODE_ENV === 'production'
    || !BILLING_DEPLOY_ENVIRONMENTS.has(String(env.REACT_APP_DEPLOY_ENV || '').trim().toLowerCase())
    || String(env.REACT_APP_TORNEOS_PRODUCTION_ENABLED || '').trim().toLowerCase() === 'true') {
    return off('TORNEOS_BILLING_ENVIRONMENT_NOT_ALLOWED');
  }
  if (!LOOPBACK_HOSTS.has(String(appHostname || ''))) return off('TORNEOS_BILLING_REQUIRES_LOCAL_APP');
  return Object.freeze({ mode: 'test', reason: null });
}

function resolveProductionBilling(env, { backendMode, appHostname, off }) {
  if (backendMode?.mode !== 'hybrid' || !backendMode.gatewayUrl) return off('TORNEOS_BILLING_REQUIRES_HYBRID');
  let gateway;
  try {
    gateway = new URL(backendMode.gatewayUrl);
  } catch {
    return off('TORNEOS_BILLING_REQUIRES_PUBLIC_GATEWAY');
  }
  if (gateway.protocol !== 'https:' || LOOPBACK_HOSTS.has(gateway.hostname) || gateway.username || gateway.password) {
    return off('TORNEOS_BILLING_REQUIRES_PUBLIC_GATEWAY');
  }
  if (env.NODE_ENV !== 'production'
    || String(env.REACT_APP_DEPLOY_ENV || '').trim().toLowerCase() !== 'production'
    || String(env.REACT_APP_TORNEOS_PRODUCTION_ENABLED || '').trim().toLowerCase() !== 'true') {
    return off('TORNEOS_BILLING_ENVIRONMENT_NOT_ALLOWED');
  }
  if (env.REACT_APP_TORNEOS_PLAN_READ_MODE !== 'on') return off('TORNEOS_BILLING_REQUIRES_PLAN_READ');
  if (!PRODUCTION_BILLING_APP_HOSTS.includes(String(appHostname || ''))) return off('TORNEOS_BILLING_REQUIRES_PRODUCTION_APP');
  return Object.freeze({ mode: 'production', reason: null });
}

// Independent of billing. Only an explicit read opt-in in the gateway composition.
export function resolveTorneosPlanRead(env = process.env, { backendMode = resolveTorneosBackendMode(env) } = {}) {
  return backendMode.mode === 'hybrid'
    && env.REACT_APP_TORNEOS_PLAN_READ_MODE === 'on';
}

// SOCIAL-V1: the Estudio Social in the gateway composition. ONE variable never decides it: the
// production-eligible flag `socialContentGenerator` (REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED=true, with every
// condition the flags already demand) counts only together with the hybrid composition AND the plan read, because
// FREE vs PREMIUM is decided per season from that read. Without any of the three the Studio does not exist: no
// navigation, no route, no Social alias, no request. The resolved flags are passed in (the foundation never imports
// the shell configuration); without them the Studio stays closed.
export function resolveTorneosSocialStudio(env = process.env, {
  backendMode = resolveTorneosBackendMode(env),
  planRead = resolveTorneosPlanRead(env, { backendMode }),
  flags = null,
} = {}) {
  return backendMode.mode === 'hybrid'
    && planRead === true
    && flags?.socialContentGenerator === true;
}

// CONNECTED-V1: the connected product (Torneos profile, Torneos inbox, catalog management, registration requests and
// the public catalog). In the gateway composition it exists only with the explicit opt-in that matches the gateway's
// TORNEOS_CONNECTED_MODE=on; the single-project LOCAL stack serves it from its own migration. Anything else: no
// alias, no route, no request.
// BRANDING-V1: logos and shields of the hybrid composition (upload and the organization's branding context). Hybrid
// + the explicit opt-in that matches the gateway's TORNEOS_BRANDING_MODE=on. Displaying what the gateway signed
// needs no flag: without the gateway mode nothing is signed and every mark shows its initials.
export function resolveTorneosBranding(env = process.env, {
  backendMode = resolveTorneosBackendMode(env),
} = {}) {
  return backendMode.mode === 'hybrid' && env.REACT_APP_TORNEOS_BRANDING_MODE === 'on';
}

// MEDIA-V1: the photo galleries of the hybrid composition (organizer's Centro Multimedia, uploads through the gateway,
// participant galleries). Hybrid + the explicit opt-in that matches the gateway's TORNEOS_MEDIA_MODE=on + the
// production-eligible `mediaEnabled` flag (REACT_APP_TORNEOS_MEDIA_ENABLED=true, which also opens the route). All three
// or nothing: no alias, no route, no request.
export function resolveTorneosMedia(env = process.env, {
  backendMode = resolveTorneosBackendMode(env),
  flags = null,
} = {}) {
  return backendMode.mode === 'hybrid'
    && env.REACT_APP_TORNEOS_MEDIA_MODE === 'on'
    && flags?.mediaEnabled === true;
}

export function resolveTorneosConnectedProduct(env = process.env, {
  backendMode = resolveTorneosBackendMode(env),
} = {}) {
  if (backendMode.mode === 'legacy-local') return true;
  return backendMode.mode === 'hybrid' && env.REACT_APP_TORNEOS_CONNECTED_MODE === 'on';
}
