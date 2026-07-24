const ENABLED_VALUE = 'true';
const NON_PRODUCTION_ENVIRONMENTS = new Set([
  'development',
  'test',
  'preview',
  'staging',
]);

const FLAG_ENV_KEYS = {
  torneosEnabled: 'REACT_APP_TORNEOS_ENABLED',
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

export function resolveTorneosFeatureFlags(env = {}) {
  const deployEnvironment = resolveDeployEnvironment(env);
  const isNonProduction = NON_PRODUCTION_ENVIRONMENTS.has(deployEnvironment);

  const flags = Object.fromEntries(
    Object.entries(FLAG_ENV_KEYS).map(([flagName, environmentKey]) => [
      flagName,
      isNonProduction && env[environmentKey] === ENABLED_VALUE,
    ]),
  );

  return {
    ...flags,
    deployEnvironment,
    isNonProduction,
  };
}

export const torneosFeatureFlags = resolveTorneosFeatureFlags(process.env);

