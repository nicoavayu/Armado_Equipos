export const SPACE_NAVIGATION_STORAGE_PREFIX = 'arma2:space-navigation:v1:';

export const APP_SPACE = Object.freeze({
  ARMA2: 'arma2',
  TORNEOS: 'torneos',
});

export const SPACE_FALLBACK_ROUTE = Object.freeze({
  [APP_SPACE.ARMA2]: '/',
  [APP_SPACE.TORNEOS]: '/torneos',
});

const ARMA2_ROUTE_PATTERNS = Object.freeze([
  /^\/$/,
  /^\/(?:nuevo-partido|quiero-jugar|desafios|amigos|profile|notifications|stats|frecuentes)\/?$/,
  /^\/desafios\/equipos\/[a-z0-9-]+(?:\/chat)?\/?$/i,
  /^\/desafios\/equipos\/partidos\/[a-z0-9-]+\/?$/i,
  /^\/frecuentes\/[a-z0-9-]+(?:\/historial)?\/?$/i,
  /^\/(?:admin|partido)\/[a-z0-9-]+\/?$/i,
]);

const TORNEOS_ROUTE_PATTERNS = Object.freeze([
  /^\/torneos\/?$/,
  /^\/torneos\/(?:mis-partidos|mis-torneos|comunicados)\/?$/,
  /^\/torneos\/mis-partidos\/[a-z0-9-]+(?:\/convocatoria)?\/?$/i,
  /^\/torneos\/torneo\/[a-z0-9-]+(?:\/(?:novedades|partidos|tabla|estadisticas|equipos|fotos|disciplina)(?:\/[a-z0-9-]+)?)?\/?$/i,
  /^\/torneos\/organizacion\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\/?$/i,
]);

export function getSpaceFromPath(pathname = '') {
  return pathname === '/torneos' || pathname.startsWith('/torneos/')
    ? APP_SPACE.TORNEOS
    : APP_SPACE.ARMA2;
}

export function isArma2SpaceRoot(pathname = '') {
  return pathname === '/' || pathname === '/home';
}

export function isTorneosSpaceRoot(pathname = '') {
  return pathname === '/torneos' || pathname === '/torneos/';
}

const TORNEOS_PERSONAL_TOP_LEVEL_PATTERNS = Object.freeze([
  /^\/torneos\/?$/,
  /^\/torneos\/(?:mis-torneos|mis-partidos|comunicados|nueva-organizacion)\/?$/,
]);

const TORNEOS_ORGANIZATION_TOP_LEVEL_PATTERN = new RegExp(
  '^/torneos/organizacion/[a-z0-9-]+'
  + '(?:/(?:inicio|torneos|equipos|fixture|partidos|comunicaciones|multimedia|'
  + 'estudio-social|configuracion|competencia(?:/tabla)?))?/?$',
  'i',
);

export function shouldShowTorneosSpaceHeader(pathname = '') {
  return TORNEOS_PERSONAL_TOP_LEVEL_PATTERNS.some((pattern) => pattern.test(pathname))
    || TORNEOS_ORGANIZATION_TOP_LEVEL_PATTERN.test(pathname);
}

function normalizePath(pathname) {
  if (typeof pathname !== 'string') return null;
  const candidate = pathname.trim();
  if (
    !candidate
    || candidate.length > 512
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('?')
    || candidate.includes('#')
    || candidate.includes('\\')
    || /%(?:2f|5c)/i.test(candidate)
  ) return null;

  try {
    const decoded = decodeURIComponent(candidate);
    if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  } catch {
    return null;
  }

  return candidate.length > 1 ? candidate.replace(/\/+$/, '') : candidate;
}

export function getValidRouteForSpace(space, pathname) {
  const normalized = normalizePath(pathname);
  if (!normalized) return null;
  const patterns = space === APP_SPACE.TORNEOS
    ? TORNEOS_ROUTE_PATTERNS
    : ARMA2_ROUTE_PATTERNS;
  return patterns.some((pattern) => pattern.test(normalized)) ? normalized : null;
}

export function getSpaceNavigationStorageKey(userId) {
  const normalizedUserId = String(userId || '').trim();
  return normalizedUserId ? `${SPACE_NAVIGATION_STORAGE_PREFIX}${normalizedUserId}` : null;
}

export function createDefaultSpaceNavigation() {
  return {
    lastSpace: APP_SPACE.ARMA2,
    lastRoute: {
      [APP_SPACE.ARMA2]: SPACE_FALLBACK_ROUTE[APP_SPACE.ARMA2],
      [APP_SPACE.TORNEOS]: SPACE_FALLBACK_ROUTE[APP_SPACE.TORNEOS],
    },
  };
}

function resolveStorage(storage) {
  if (storage) return storage;
  return typeof window !== 'undefined' ? window.localStorage : null;
}

export function readSpaceNavigation(userId, storage) {
  const defaults = createDefaultSpaceNavigation();
  const key = getSpaceNavigationStorageKey(userId);
  const targetStorage = resolveStorage(storage);
  if (!key || !targetStorage) return defaults;

  try {
    const parsed = JSON.parse(targetStorage.getItem(key) || 'null');
    if (!parsed || typeof parsed !== 'object') return defaults;
    const lastSpace = Object.values(APP_SPACE).includes(parsed.lastSpace)
      ? parsed.lastSpace
      : defaults.lastSpace;
    return {
      lastSpace,
      lastRoute: {
        [APP_SPACE.ARMA2]: getValidRouteForSpace(
          APP_SPACE.ARMA2,
          parsed.lastRoute?.[APP_SPACE.ARMA2],
        ) || defaults.lastRoute[APP_SPACE.ARMA2],
        [APP_SPACE.TORNEOS]: getValidRouteForSpace(
          APP_SPACE.TORNEOS,
          parsed.lastRoute?.[APP_SPACE.TORNEOS],
        ) || defaults.lastRoute[APP_SPACE.TORNEOS],
      },
    };
  } catch {
    return defaults;
  }
}

export function writeSpaceNavigation(userId, preference, storage) {
  const key = getSpaceNavigationStorageKey(userId);
  const targetStorage = resolveStorage(storage);
  if (!key || !targetStorage) return false;
  const defaults = createDefaultSpaceNavigation();
  const lastSpace = Object.values(APP_SPACE).includes(preference?.lastSpace)
    ? preference.lastSpace
    : defaults.lastSpace;
  const safePreference = {
    lastSpace,
    lastRoute: {
      [APP_SPACE.ARMA2]: getValidRouteForSpace(
        APP_SPACE.ARMA2,
        preference?.lastRoute?.[APP_SPACE.ARMA2],
      ) || defaults.lastRoute[APP_SPACE.ARMA2],
      [APP_SPACE.TORNEOS]: getValidRouteForSpace(
        APP_SPACE.TORNEOS,
        preference?.lastRoute?.[APP_SPACE.TORNEOS],
      ) || defaults.lastRoute[APP_SPACE.TORNEOS],
    },
  };

  try {
    targetStorage.setItem(key, JSON.stringify(safePreference));
    return true;
  } catch {
    return false;
  }
}

export function rememberSpaceRoute(userId, pathname, storage) {
  const space = getSpaceFromPath(pathname);
  const safeRoute = getValidRouteForSpace(space, pathname);
  if (!safeRoute) return readSpaceNavigation(userId, storage);
  const current = readSpaceNavigation(userId, storage);
  const next = {
    lastSpace: space,
    lastRoute: {
      ...current.lastRoute,
      [space]: safeRoute,
    },
  };
  writeSpaceNavigation(userId, next, storage);
  return next;
}
