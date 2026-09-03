const ENABLED_VALUE = 'true';
const PRODUCTION_ENVIRONMENT = 'production';
const NON_PRODUCTION_ENVIRONMENTS = new Set([
  'development',
  'test',
  'preview',
  'staging',
]);
const LOCAL_SUPABASE_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const AUTHORIZED_STAGING_PROJECT_REF = 'hhyvmhgpapyuzjgxfnqv';

// Única variable que puede abrir Torneos en Production. No habilita nada por sí
// sola: exige además build de Production, deploy environment `production`,
// `REACT_APP_TORNEOS_DATA_ENV=production` y el backend productivo certificado
// (el mismo `REACT_APP_PRODUCTION_PROJECT_REF` que ya se usa para reconocerlo).
// Ausente, vacía o con cualquier valor que no sea el literal `true` => cerrado.
const PRODUCTION_ENABLE_ENV_KEY = 'REACT_APP_TORNEOS_PRODUCTION_ENABLED';

// Superficies que la activación de Production puede encender, cada una todavía
// con su propia variable. Lo que no está acá queda cerrado en Production aunque
// su variable diga `true`: multimedia depende de infraestructura que no está
// desplegada ahí, y el generador social sigue en revisión. Ampliar esta lista
// es una decisión explícita, no un efecto lateral de abrir el shell.
const PRODUCTION_ELIGIBLE_FLAGS = new Set([
  'torneosEnabled',
  'workspacesEnabled',
  'workspaceSwitcher',
  'deepLinks',
  'notifications',
  'officialStats',
  'publicPages',
]);
const FLAG_ENV_KEYS = {
  torneosEnabled: 'REACT_APP_TORNEOS_ENABLED',
  workspacesEnabled: 'REACT_APP_TORNEOS_WORKSPACES_ENABLED',
  workspaceSwitcher: 'REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED',
  deepLinks: 'REACT_APP_TORNEOS_DEEP_LINKS_ENABLED',
  notifications: 'REACT_APP_TORNEOS_NOTIFICATIONS_ENABLED',
  officialStats: 'REACT_APP_TORNEOS_OFFICIAL_STATS_ENABLED',
  publicPages: 'REACT_APP_TORNEOS_PUBLIC_PAGES_ENABLED',
  mediaEnabled: 'REACT_APP_TORNEOS_MEDIA_ENABLED',
  mediaUploadEnabled: 'REACT_APP_TORNEOS_MEDIA_UPLOAD_ENABLED',
  socialContentGenerator: 'REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED',
};

const MEDIA_UPLOAD_READINESS_ENV_KEYS = [
  'REACT_APP_TORNEOS_MEDIA_SIGNER_READY',
  'REACT_APP_TORNEOS_MEDIA_WORKER_READY',
  'REACT_APP_TORNEOS_MEDIA_AV_READY',
  'REACT_APP_TORNEOS_MEDIA_CLEANUP_READY',
  'REACT_APP_TORNEOS_MEDIA_OBSERVABILITY_READY',
];

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
      isCertifiedProductionBackend: false,
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
    && stagingProjectRef === AUTHORIZED_STAGING_PROJECT_REF
    && hostname === `${stagingProjectRef}.supabase.co`
    && parsedUrl.protocol === 'https:'
    && parsedUrl.port === ''
    && !hasUnexpectedUrlParts
    && !isKnownProductionBackend
  );

  // `isKnownProductionBackend` alcanza para RECONOCER el backend productivo y
  // apagarse; para HABILITAR hace falta además que la URL sea exactamente la
  // canónica, con las mismas exigencias que ya se le piden a staging.
  const isCertifiedProductionBackend = (
    isKnownProductionBackend
    && parsedUrl.protocol === 'https:'
    && parsedUrl.port === ''
    && !hasUnexpectedUrlParts
  );

  return {
    dataEnvironment,
    isIsolatedBackend: isLocal || isStaging,
    isKnownProductionBackend,
    isCertifiedProductionBackend,
  };
}

/**
 * Contrato de Production. Todas las condiciones son explícitas y se evalúan
 * juntas: si falta una sola, Torneos queda cerrado en Production.
 */
export function resolveTorneosProductionEnablement(
  env = {},
  backendIsolation = resolveTorneosBackendIsolation(env),
) {
  const productionOptIn = env[PRODUCTION_ENABLE_ENV_KEY] === ENABLED_VALUE;
  const isProductionBuild = String(env.NODE_ENV || '').trim().toLowerCase() === PRODUCTION_ENVIRONMENT;
  const isProductionDeploy = resolveDeployEnvironment(env) === PRODUCTION_ENVIRONMENT;
  const declaresProductionData = backendIsolation.dataEnvironment === PRODUCTION_ENVIRONMENT;

  return {
    productionOptIn,
    productionEnablementAllowed: Boolean(
      productionOptIn
      && isProductionBuild
      && isProductionDeploy
      && declaresProductionData
      && backendIsolation.isCertifiedProductionBackend
      && !backendIsolation.isIsolatedBackend,
    ),
  };
}

export function resolveTorneosFeatureFlags(env = {}) {
  const deployEnvironment = resolveDeployEnvironment(env);
  const isNonProduction = NON_PRODUCTION_ENVIRONMENTS.has(deployEnvironment);
  const backendIsolation = resolveTorneosBackendIsolation(env);
  const productionEnablement = resolveTorneosProductionEnablement(env, backendIsolation);
  const canEnableNonProduction = isNonProduction && backendIsolation.isIsolatedBackend;
  const canEnableTorneos = (
    canEnableNonProduction
    || productionEnablement.productionEnablementAllowed
  );
  // Fuera de los entornos aislados, cada superficie necesita además estar
  // habilitada para Production.
  const isSurfaceAllowed = (flagName) => (
    canEnableNonProduction || PRODUCTION_ELIGIBLE_FLAGS.has(flagName)
  );

  const flags = Object.fromEntries(
    Object.entries(FLAG_ENV_KEYS).map(([flagName, environmentKey]) => [
      flagName,
      canEnableTorneos
        && isSurfaceAllowed(flagName)
        && env[environmentKey] === ENABLED_VALUE,
    ]),
  );
  const mediaOperationalReady = (
    canEnableTorneos
    && isSurfaceAllowed('mediaUploadEnabled')
    && MEDIA_UPLOAD_READINESS_ENV_KEYS.every(
      (environmentKey) => env[environmentKey] === ENABLED_VALUE,
    )
  );
  flags.mediaEnabled = flags.torneosEnabled && flags.mediaEnabled;
  flags.mediaUploadEnabled = (
    flags.mediaEnabled
    && flags.mediaUploadEnabled
    && mediaOperationalReady
  );

  return {
    ...flags,
    mediaOperationalReady,
    deployEnvironment,
    isNonProduction,
    canEnableTorneos,
    ...backendIsolation,
    ...productionEnablement,
  };
}

export const torneosFeatureFlags = resolveTorneosFeatureFlags(process.env);
