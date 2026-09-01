const PRODUCTION_APP_HOST = 'app.arma2.com.ar';
const ALLOWED_QA_PROJECT_REF = 'hhyvmhgpapyuzjgxfnqv';
const PRODUCTION_PROJECT_REF = 'rcyuuoaqfwcembdajcss';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

class ProductionGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductionGuardError';
  }
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function fail(label, detail) {
  throw new ProductionGuardError(`[production-guard] ${label}: ${detail}`);
}

function productionProjectRefs(env = process.env) {
  const configured = [
    env.QA_PRODUCTION_PROJECT_REF,
    env.ARMA2_PRODUCTION_PROJECT_REF,
    env.REACT_APP_PRODUCTION_PROJECT_REF,
  ].map(normalized).filter((value) => PROJECT_REF_PATTERN.test(value));
  return [...new Set([PRODUCTION_PROJECT_REF, ...configured])];
}

function allowedQaProjectRefs() {
  return [ALLOWED_QA_PROJECT_REF];
}

function assertNoProductionEnvironment(env = process.env) {
  const deploymentValues = [
    env.ARMA2_DEPLOY_ENV,
    env.REACT_APP_DEPLOY_ENV,
    env.VERCEL_ENV,
    env.NODE_ENV,
    env.QA_SEED_ENV,
  ].map(normalized).filter(Boolean);
  if (deploymentValues.includes('production') || deploymentValues.includes('prod')) {
    fail('environment', 'Production execution is forbidden');
  }
}

function assertSafeQaValue(value, label = 'value', env = process.env) {
  const text = normalized(value);
  if (!text) return;

  if (text.includes(PRODUCTION_PROJECT_REF)) {
    fail(label, 'the protected Production project ref was detected');
  }
  for (const ref of productionProjectRefs(env)) {
    if (text.includes(ref)) {
      fail(label, 'a protected Production project ref was detected');
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
  if (projectRef !== ALLOWED_QA_PROJECT_REF) {
    fail(label, `remote Supabase project ${projectRef} is not the authorized QA ref`);
  }
}

function assertSafeQaEnvironment(env = process.env) {
  assertNoProductionEnvironment(env);
  for (const [key, value] of Object.entries(env)) {
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

function parseRequiredUrl(value, label) {
  if (!String(value || '').trim()) fail(label, 'the variable is required and has no fallback');
  try {
    return new URL(String(value));
  } catch {
    fail(label, 'the value is not a valid URL');
  }
}

function assertLocalDatabaseTarget(env = process.env) {
  assertSafeQaEnvironment(env);
  if (normalized(env.QA_SEED_ENV) !== 'local') {
    fail('QA_SEED_ENV', 'must be exactly "local" for database writes');
  }
  if (normalized(env.QA_SEED_PROJECT_REF) !== 'local') {
    fail('QA_SEED_PROJECT_REF', 'must be exactly "local" for local execution');
  }
  const databaseUrl = parseRequiredUrl(env.QA_SEED_DATABASE_URL, 'QA_SEED_DATABASE_URL');
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    fail('QA_SEED_DATABASE_URL', 'must use postgres:// or postgresql://');
  }
  if (!LOCAL_HOSTS.has(normalized(databaseUrl.hostname))) {
    fail('QA_SEED_DATABASE_URL', 'local execution only accepts a loopback host');
  }
  const competingUrls = [
    env.DATABASE_URL,
    env.SUPABASE_DB_URL,
    env.ARMA2_TARGET_DATABASE_URL,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  if (competingUrls.some((value) => value !== String(env.QA_SEED_DATABASE_URL).trim())) {
    fail('database target', 'ambiguous database URL variables were detected');
  }
  return { mode: 'local', databaseUrl: databaseUrl.toString() };
}

function assertRemotePlanTarget(env = process.env) {
  assertSafeQaEnvironment(env);
  const projectRef = normalized(env.QA_SEED_PROJECT_REF);
  if (!projectRef) fail('QA_SEED_PROJECT_REF', 'the variable is required and has no fallback');
  if (projectRef !== ALLOWED_QA_PROJECT_REF) {
    fail('QA_SEED_PROJECT_REF', `must equal the authorized QA ref ${ALLOWED_QA_PROJECT_REF}`);
  }
  const apiUrl = parseRequiredUrl(env.QA_SEED_SUPABASE_URL, 'QA_SEED_SUPABASE_URL');
  assertSafeQaValue(apiUrl.toString(), 'QA_SEED_SUPABASE_URL', env);
  if (normalized(apiUrl.hostname) !== `${ALLOWED_QA_PROJECT_REF}.supabase.co`) {
    fail('QA_SEED_SUPABASE_URL', 'the URL and project ref do not identify the same project');
  }
  if (env.QA_SEED_DATABASE_URL || env.DATABASE_URL || env.SUPABASE_DB_URL) {
    fail('remote plan', 'database credentials are forbidden in the non-connecting plan');
  }
  return { mode: 'remote-plan-only', projectRef, apiUrl: apiUrl.toString().replace(/\/$/, '') };
}

/**
 * El destino de la app para una sesión de QA LOCAL.
 *
 * `.env.local` puede apuntar a un Supabase remoto, y CRA lo lee solo si nadie
 * pisa la variable en el proceso. Es decir: una sesión de QA LOCAL depende hoy
 * de que quien la arranca se acuerde del override. Este guard invierte eso —
 * sin un destino loopback explícito no hay arranque— y no acepta caer al
 * archivo: el valor tiene que llegar por variables de proceso.
 */
function assertLocalAppTarget(env = process.env) {
  assertSafeQaEnvironment(env);
  const supabaseUrl = parseRequiredUrl(env.QA_SUPABASE_URL, 'QA_SUPABASE_URL');
  if (supabaseUrl.protocol !== 'http:') {
    fail('QA_SUPABASE_URL', 'a local QA session only accepts http:// on loopback');
  }
  if (!LOCAL_HOSTS.has(normalized(supabaseUrl.hostname))) {
    fail('QA_SUPABASE_URL', 'local execution only accepts a loopback host');
  }
  const anonKey = String(env.QA_SUPABASE_ANON_KEY || '').trim();
  if (!anonKey) fail('QA_SUPABASE_ANON_KEY', 'the variable is required and has no fallback');
  // Una anon key de un proyecto hospedado lleva su ref adentro. Si aparece una,
  // el destino real no es el que dice la URL.
  const claims = readJwtClaims(anonKey);
  const boundRef = normalized(claims?.ref);
  if (boundRef && PROJECT_REF_PATTERN.test(boundRef)) {
    fail('QA_SUPABASE_ANON_KEY', `the key belongs to the hosted project ${boundRef}, not to LOCAL`);
  }
  return {
    mode: 'local-app',
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ''),
    anonKey,
  };
}

function readJwtClaims(token) {
  const segments = String(token).split('.');
  if (segments.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function assertRemoteApplyDisabled() {
  fail(
    'remote apply',
    'remote materialization is intentionally disabled pending specific authorization',
  );
}

function assertSafeSeedTarget({ env = process.env, dryRun = true } = {}) {
  if (dryRun) {
    assertSafeQaEnvironment(env);
    return { dryRun: true, targetUrl: null };
  }
  const target = assertLocalDatabaseTarget(env);
  if (normalized(env.QA_ALLOW_LOCAL_SEED) !== 'true') {
    fail('QA_ALLOW_LOCAL_SEED', 'must be exactly "true" for local execution');
  }
  return { dryRun: false, targetUrl: target.databaseUrl };
}

module.exports = {
  ALLOWED_QA_PROJECT_REF,
  PRODUCTION_APP_HOST,
  PRODUCTION_PROJECT_REF,
  ProductionGuardError,
  allowedQaProjectRefs,
  assertLocalAppTarget,
  assertLocalDatabaseTarget,
  assertRemoteApplyDisabled,
  assertRemotePlanTarget,
  assertSafeQaEnvironment,
  assertSafeQaValue,
  assertSafeSeedTarget,
  productionProjectRefs,
};
