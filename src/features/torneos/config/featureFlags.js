const ENABLED_VALUE = 'true';
const NON_PRODUCTION_ENVIRONMENTS = new Set([
  'development',
  'test',
  'preview',
  'staging',
]);
const LOCAL_SUPABASE_HOSTS = new Set(['127.0.0.1', 'localhost']);

const FLAG_ENV_KEYS = {
  torneosEnabled: 'REACT_APP_TORNEOS_ENABLED',
  workspacesEnabled: 'REACT_APP_TORNEOS_WORKSPACES_ENABLED',
  workspaceSwitcher: 'REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED',
  deepLinks: 'REACT_APP_TORNEOS_DEEP_LINKS_ENABLED',
  notifications: 'REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED',
  officialStats: 'REACT_APP_TORNEOS_OFFICIAL_STATS_ENABLED',
  publicPages: 'REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED',
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

  let hostname = '';
  try {
    hostname = new URL(supabaseUrl).hostname.toLowerCase();
  } catch {
    return {
      dataEnvironment,
      isIsolatedBackend: false,
    };
  }

  const isLocal = (
    dataEnvironment === 'local'
    && LOCAL_SUPABASE_HOSTS.has(hostname)
  );
  const isStaging = (
    dataEnvironment === 'staging'
    && /^[a-z0-9]{8,64}$/.test(stagingProjectRef)
    && hostname === `${stagingProjectRef}.supabase.co`
  );

  return {
    dataEnvironment,
    isIsolatedBackend: isLocal || isStaging,
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
