const ROUTE_LOADERS = new Map([
  ['/', () => import('../pages/HomePage')],
  ['/nuevo-partido', () => import('../pages/NuevoPartidoPage')],
  ['/quiero-jugar', () => import('../pages/QuieroJugarPage')],
  ['/desafios', () => import('../pages/DesafiosPage')],
  ['/desafios/equipos', () => import('../pages/EquipoDetallePage')],
  ['/desafios/equipos/partidos', () => import('../pages/TeamMatchDetailPage')],
  ['/amigos', () => import('../pages/AmigosPage')],
  ['/profile', () => import('../pages/ProfilePage')],
  ['/notifications', () => import('../pages/NotificationsPage')],
  ['/stats', () => import('../pages/StatsPage')],
  ['/frecuentes', () => import('../pages/FrecuentesPage')],
  ['/admin', () => import('../pages/AdminPanelPage')],
  ['/partido', () => import('../pages/AdminPanelPage')],
  ['/partido-publico', () => import('../pages/PartidoInvitacion')],
  ['/encuesta', () => import('../pages/EncuestaPartido')],
  ['/resultados-encuesta', () => import('../pages/ResultadosEncuestaView')],
]);

const warmedRoutes = new Set();

const normalizeRouteKey = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (raw === '/') return '/';

  const [withoutQuery] = raw.split(/[?#]/);
  const normalized = withoutQuery.replace(/\/+$/, '');
  return normalized || '/';
};

const resolveLoaderKey = (path) => {
  const normalizedPath = normalizeRouteKey(path);
  if (!normalizedPath) return null;
  if (ROUTE_LOADERS.has(normalizedPath)) return normalizedPath;

  const prefixMatch = Array.from(ROUTE_LOADERS.keys())
    .filter((key) => key !== '/' && normalizedPath.startsWith(`${key}/`))
    .sort((left, right) => right.length - left.length)[0];

  return prefixMatch || normalizedPath;
};

const canPrefetchRoutes = () => {
  if (typeof window === 'undefined') return false;
  if (typeof navigator === 'undefined') return true;

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return true;
  if (connection.saveData) return false;

  const effectiveType = String(connection.effectiveType || '').toLowerCase();
  return effectiveType !== 'slow-2g' && effectiveType !== '2g';
};

export const prefetchRoute = (path) => {
  const loaderKey = resolveLoaderKey(path);
  if (!loaderKey || !canPrefetchRoutes()) return;
  if (warmedRoutes.has(loaderKey)) return;

  const loader = ROUTE_LOADERS.get(loaderKey);
  if (!loader) return;

  warmedRoutes.add(loaderKey);
  loader().catch(() => {
    warmedRoutes.delete(loaderKey);
  });
};

export const warmLikelyRoutes = (paths = []) => {
  if (!canPrefetchRoutes()) return () => {};

  const run = () => {
    paths.forEach((path) => {
      prefetchRoute(path);
    });
  };

  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback?.(handle);
  }

  const timeoutId = window.setTimeout(run, 1200);
  return () => window.clearTimeout(timeoutId);
};
