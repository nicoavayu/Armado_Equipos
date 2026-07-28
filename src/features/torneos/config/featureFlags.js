const ENABLED_VALUE = 'true';
const NON_PRODUCTION_ENVIRONMENTS = new Set([
  'development',
  'test',
  'preview',
  'staging',
]);
const LOCAL_SUPABASE_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const FLAG_ENV_KEYS = {
  torneosEnabled: 'REACT_APP_TORNEOS_ENABLED',
  workspacesEnabled: 'REACT_APP_TORNEOS_WORKSPACES_ENABLED',
  workspaceSwitcher: 'REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED',
  deepLinks: 'REACT_APP_TORNEOS_DEEP_LINKS_ENABLED',
  notifications: 'REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED',
  officialStats: 'REACT_APP_TORNEOS_OFFICIAL_STATS_ENABLED',
  publicPages: 'REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED',
  mediaUpload: 'REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED',
  socialContentGenerator: 'REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED',
};

export function resolveDeployEnvironment(env = {}) {
  const explicitEnvironment = String(env.REACT_APP_DEPLOY_ENV || '')
    .trim()
    .toLowerCase();

  if (explicitEnvironment) return explicitEnvironment;
  return env.NODE_ENV === 'production' ? 'production' : (env.NODE_ENV || 'development');
}

export function resolveTorneosBackendIsolation(env = {}) {
  const dataEnvironment = String(env.REACT_APP_TORNEOS_DATA_ENV || '')
    .trim()
    .toLowerCase();
  const supabaseUrl = String(env.REACT_APP_SUPABASE_URL || '').trim();
  const stagingProjectRef = String(
    env.REACT_APP_TORNEOS_STAGING_PROJECT_REF || '',
  ).trim().toLowerCase();
  const productionProjectRef = String(
    env.REACT_APP_PRODUCTION_PROJECT_REF || '',
  ).trim().toLowerCase();

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    return {
      dataEnvironment,
      isIsolatedBackend: false,
      isKnownProductionBackend: false,
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const hasUnexpectedUrlParts = (
    Boolean(parsedUrl.username)
    || Boolean(parsedUrl.password)
    || !['', '/'].includes(parsedUrl.pathname)
    || Boolean(parsedUrl.search)
    || Boolean(parsedUrl.hash)
  );
  const isKnownProductionBackend = (
    /^[a-z0-9]{8,64}$/.test(productionProjectRef)
    && hostname === `${productionProjectRef}.supabase.co`
  );
  const isLocal = (
    dataEnvironment === 'local'
    && LOCAL_SUPABASE_HOSTS.has(hostname)
    && ['http:', 'https:'].includes(parsedUrl.protocol)
    && !hasUnexpectedUrlParts
  );
  const isStaging = (
    dataEnvironment === 'staging'
    && /^[a-z0-9]{8,64}$/.test(stagingProjectRef)
    && hostname === `${stagingProjectRef}.supabase.co`
    && parsedUrl.protocol === 'https:'
    && parsedUrl.port === ''
    && !hasUnexpectedUrlParts
    && !isKnownProductionBackend
  );

  return {
    dataEnvironment,
    isIsolatedBackend: isLocal || isStaging,
    isKnownProductionBackend,
  };
}

export function resolveTorneosFeatureFlags(env = {}) {
  const deployEnvironment = resolveDeployEnvironment(env);
  const isNonProduction = NON_PRODUCTION_ENVIRONMENTS.has(deployEnvironment);
  const backendIsolation = resolveTorneosBackendIsolation(env);
  const canEnableTorneos = isNonProduction && backendIsolation.isIsolatedBackend;

  const flags = Object.fromEntries(
    Object.entries(FLAG_ENV_KEYS).map(([flagName, environmentKey]) => [
      flagName,
      canEnableTorneos && env[environmentKey] === ENABLED_VALUE,
    ]),
  );

  return {
    ...flags,
    deployEnvironment,
    isNonProduction,
    ...backendIsolation,
  };
}

export const torneosFeatureFlags = resolveTorneosFeatureFlags(process.env);
