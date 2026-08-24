//
// Contrato de cliente del selector de rol QA LOCAL.
//
// El gate del navegador es independiente del gate del puente: uno decide si la
// ruta existe, el otro si el puente contesta. Los dos tienen que cerrar, y los
// dos son fail-closed. Ocultar el link no es una condición: en Production,
// Staging o cualquier build normal, `/qa/rol` directamente no se monta.
//
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const QA_ROLE_SWITCHER_PATH = '/qa/rol';
export const QA_TOURNAMENT_REVIEW_PATH = '/qa/torneos';
export const QA_SOCIAL_STUDIO_BASE_PATH = '/qa/torneos/estudio-social-base';
export const QA_ROLE_BRIDGE_PATH = '/__qa/role-switcher';
export const QA_ROLE_BRIDGE_HEADER = 'x-qa-role-switcher';

// Superficies a las que el selector acepta devolver. Todo lo demás —incluido
// cualquier destino externo— se descarta sin discusión.
export const QA_RETURN_TO_ALLOWLIST = Object.freeze([
  '/torneos',
  '/profile',
  '/notifications',
  '/stats',
  '/quiero-jugar',
  '/desafios',
  '/amigos',
  '/frecuentes',
]);

export const QA_SAFE_FALLBACK_PATH = '/torneos';

// Claves que dejan de ser válidas cuando cambia el usuario. Las de prefijo
// cubren el contexto de workspace y el onboarding, que están cacheados por
// identidad y arrastrarían el espacio del rol anterior.
export const QA_SESSION_SCOPED_KEYS = Object.freeze([
  'local:dev:profile',
  'auth:returnTo',
  'hasSeenTutorial',
  'activity_insight_weekly_matches_v1',
]);

export const QA_SESSION_SCOPED_PREFIXES = Object.freeze([
  'arma2:torneos:',
  'arma2:onboarding:',
  'chat_read_',
  'team_chat_read_',
  'invited_groups_',
]);

const normalized = (value) => String(value ?? '').trim();

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(normalized(hostname).toLowerCase());
}

/**
 * Las cinco condiciones duras, evaluadas juntas. Cualquiera que falle deja la
 * ruta sin montar.
 */
export function resolveQaRoleSwitcherGate(env = {}, location = {}) {
  const failures = [];

  if (normalized(env.REACT_APP_TORNEOS_QA_ROLE_SWITCHER) !== 'true') {
    failures.push('flag');
  }
  if (normalized(env.REACT_APP_TORNEOS_DATA_ENV).toLowerCase() !== 'local') {
    failures.push('data-env');
  }
  if (normalized(env.NODE_ENV).toLowerCase() === 'production') {
    failures.push('node-env');
  }
  const deployEnvironment = normalized(env.REACT_APP_DEPLOY_ENV).toLowerCase();
  if (deployEnvironment && deployEnvironment !== 'development' && deployEnvironment !== 'test') {
    failures.push('deploy-env');
  }
  if (!isLoopbackHost(location?.hostname)) {
    failures.push('host');
  }
  try {
    const supabase = new URL(normalized(env.REACT_APP_SUPABASE_URL));
    if (supabase.protocol !== 'http:' || !isLoopbackHost(supabase.hostname)) {
      failures.push('backend');
    }
  } catch {
    failures.push('backend');
  }

  return { enabled: failures.length === 0, failures };
}

export function isQaRoleSwitcherEnabled(env = {}, location = {}) {
  return resolveQaRoleSwitcherGate(env, location).enabled;
}

/**
 * `returnTo` sólo puede ser una ruta interna de la allowlist. Un destino
 * externo, un `//host`, un esquema o una ruta fuera de la lista devuelven null
 * y el selector cae en la superficie segura.
 */
export function sanitizeReturnTo(rawValue, { origin } = {}) {
  const candidate = normalized(rawValue);
  if (!candidate || candidate.length > 512) return null;
  if (!candidate.startsWith('/')) return null;
  if (candidate.startsWith('//') || candidate.includes('\\')) return null;

  let parsed;
  try {
    parsed = new URL(candidate, origin || 'http://127.0.0.1');
  } catch {
    return null;
  }
  if (origin && parsed.origin !== origin) return null;
  if (parsed.pathname === QA_ROLE_SWITCHER_PATH
    || parsed.pathname.startsWith(`${QA_ROLE_SWITCHER_PATH}/`)) {
    return null;
  }
  const allowed = QA_RETURN_TO_ALLOWLIST.some((prefix) => (
    parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
  ));
  if (!allowed) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function isOrganizationScopedPath(pathname = '') {
  const clean = normalized(pathname);
  if (!clean.startsWith('/torneos')) return false;
  if (clean === '/torneos' || clean === '/torneos/') return false;
  if (clean.startsWith('/torneos/publico/')) return false;
  return true;
}

/**
 * Borra únicamente lo que deja de ser cierto al cambiar de usuario. El token de
 * sesión no está en la lista: se escribe después de limpiar, no antes.
 */
export function clearSessionScopedState(storage, { preserveKeys = [] } = {}) {
  if (!storage) return [];
  const preserved = new Set(preserveKeys);
  const removed = [];
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key === 'string') keys.push(key);
  }
  for (const key of keys) {
    if (preserved.has(key)) continue;
    const matches = QA_SESSION_SCOPED_KEYS.includes(key)
      || QA_SESSION_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (!matches) continue;
    storage.removeItem(key);
    removed.push(key);
  }
  return removed;
}
