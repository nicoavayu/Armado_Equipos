const CHUNK_RELOAD_TS_KEY = '__arma2_chunk_reload_ts__';
const CHUNK_RELOAD_COUNT_KEY = '__arma2_chunk_reload_count__';
const CHUNK_RELOAD_WINDOW_MS = 45 * 1000;
const CHUNK_FORCE_MAX_ATTEMPTS = 3;
const CACHE_NAME_PATTERN = /(workbox|precache|team-balancer|arma2|react-app)/i;
const RECOVERY_CLEANUP_TIMEOUT_MS = 1200;

export const isChunkLoadError = (error) => {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  return (
    name === 'ChunkLoadError'
    || /Loading chunk [0-9]+ failed/i.test(message)
    || /Loading CSS chunk [0-9]+ failed/i.test(message)
    || /Failed to fetch dynamically imported module/i.test(message)
    || /Refused to execute script from/i.test(message)
    || /mime type .*text\/html.*not executable/i.test(message)
  );
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanupRuntimeCaches = async () => {
  if (typeof window === 'undefined') return;

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(async (registration) => {
        try {
          await registration.unregister();
        } catch {
          // ignore
        }
      }));
    } catch {
      // ignore
    }
  }

  if ('caches' in window) {
    try {
      const cacheKeys = await caches.keys();
      const staleCacheKeys = cacheKeys.filter((key) => CACHE_NAME_PATTERN.test(key));
      await Promise.all(staleCacheKeys.map(async (key) => {
        try {
          await caches.delete(key);
        } catch {
          // ignore
        }
      }));
    } catch {
      // ignore
    }
  }
};

export const recoverFromChunkLoadError = (options = {}) => {
  if (typeof window === 'undefined') return false;

  try {
    const force = Boolean(options?.force);
    const now = Date.now();
    const previousTs = Number(window.sessionStorage.getItem(CHUNK_RELOAD_TS_KEY) || '0');
    const previousCount = Number(window.sessionStorage.getItem(CHUNK_RELOAD_COUNT_KEY) || '0');
    const withinWindow = Number.isFinite(previousTs) && previousTs > 0 && (now - previousTs) < CHUNK_RELOAD_WINDOW_MS;

    if (!force && withinWindow) {
      return false;
    }

    if (force && withinWindow && Number.isFinite(previousCount) && previousCount >= CHUNK_FORCE_MAX_ATTEMPTS) {
      return false;
    }

    const nextCount = withinWindow
      ? (Number.isFinite(previousCount) ? previousCount + 1 : 1)
      : 1;

    window.sessionStorage.setItem(CHUNK_RELOAD_TS_KEY, String(now));
    window.sessionStorage.setItem(CHUNK_RELOAD_COUNT_KEY, String(nextCount));

    const url = new URL(window.location.href);
    url.searchParams.set('chunk-reload', String(now));
    url.searchParams.set('chunk-attempt', String(nextCount));

    void Promise.race([
      cleanupRuntimeCaches(),
      delay(RECOVERY_CLEANUP_TIMEOUT_MS),
    ]).finally(() => {
      window.location.replace(url.toString());
    });
    return true;
  } catch (_error) {
    window.location.reload();
    return true;
  }
};
