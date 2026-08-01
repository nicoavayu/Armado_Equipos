const PRODUCTION_APP_HOST = 'app.arma2.com.ar';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PROJECT_REF_PATTERN = /^[a-z0-9]{8,64}$/;
const PRODUCTION_REF_ENV_KEYS = Object.freeze([
  'QA_PRODUCTION_PROJECT_REF',
  'ARMA2_PRODUCTION_PROJECT_REF',
  'REACT_APP_PRODUCTION_PROJECT_REF',
]);

class ProductionGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductionGuardError';
  }
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function configuredProjectRefs(env, keys) {
  return keys
    .map((key) => normalized(env[key]))
    .filter((value) => PROJECT_REF_PATTERN.test(value));
}

function productionProjectRefs(env = process.env) {
  return configuredProjectRefs(env, PRODUCTION_REF_ENV_KEYS);
}

function allowedQaProjectRefs(env = process.env) {
  return configuredProjectRefs(env, [
    'QA_ALLOWED_SUPABASE_PROJECT_REF',
    'ARMA2_TARGET_PROJECT_REF',
    'REACT_APP_TORNEOS_STAGING_PROJECT_REF',
  ]);
}

function fail(label, detail) {
  throw new ProductionGuardError(`[production-guard] ${label}: ${detail}`);
}

function assertSafeQaValue(value, label = 'value', env = process.env) {
  const text = normalized(value);
  if (!text) return;

  for (const ref of productionProjectRefs(env)) {
    if (text.includes(ref)) {
      fail(label, 'the protected Production project ref was detected');
    }
  }

  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    return;
  }

  const host = normalized(parsed.hostname);
  if (host === PRODUCTION_APP_HOST || host.endsWith(`.${PRODUCTION_APP_HOST}`)) {
    fail(label, `navigation to ${host} is forbidden`);
  }

  if (!host.endsWith('.supabase.co')) return;

  const projectRef = host.slice(0, -'.supabase.co'.length);
  if (productionProjectRefs(env).includes(projectRef)) {
    fail(label, 'the protected Production Supabase project was detected');
  }

  const allowlisted = allowedQaProjectRefs(env);
  if (!allowlisted.includes(projectRef)) {
    fail(
      label,
      `remote Supabase project ${projectRef} is not explicitly allowlisted for QA`,
    );
  }
}

function assertSafeQaEnvironment(env = process.env) {
  const deploymentValues = [
    env.ARMA2_DEPLOY_ENV,
    env.REACT_APP_DEPLOY_ENV,
    env.VERCEL_ENV,
    env.NODE_ENV,
  ].map(normalized).filter(Boolean);

  if (deploymentValues.includes('production')) {
    fail('environment', 'Production execution is forbidden');
  }

  for (const [key, value] of Object.entries(env)) {
    if (PRODUCTION_REF_ENV_KEYS.includes(key)) continue;
    if (
      key.includes('URL')
      || key.includes('HOST')
      || key.includes('PROJECT_REF')
      || key === 'QA_BASE_URL'
    ) {
      assertSafeQaValue(value, `environment variable ${key}`, env);
    }
  }
}

function assertSafeSeedTarget({
  env = process.env,
  dryRun = true,
} = {}) {
  assertSafeQaEnvironment(env);
  const targetUrl = String(
    env.QA_SEED_SUPABASE_URL
    || env.ARMA2_TARGET_SUPABASE_URL
    || '',
  ).trim();

  if (targetUrl) assertSafeQaValue(targetUrl, 'seed target URL', env);
  if (dryRun) return { dryRun: true, targetUrl: targetUrl || null };
  if (!targetUrl) fail('seed target', 'an explicit local target URL is required');

  const parsed = new URL(targetUrl);
  if (!LOCAL_HOSTS.has(normalized(parsed.hostname))) {
    fail('seed target', 'this QA foundation only permits local seed execution');
  }
  if (normalized(env.QA_ALLOW_LOCAL_SEED) !== 'true') {
    fail('seed target', 'QA_ALLOW_LOCAL_SEED=true is required for local execution');
  }

  return { dryRun: false, targetUrl: parsed.toString().replace(/\/$/, '') };
}

module.exports = {
  PRODUCTION_APP_HOST,
  ProductionGuardError,
  assertSafeQaEnvironment,
  assertSafeQaValue,
  assertSafeSeedTarget,
  productionProjectRefs,
};
