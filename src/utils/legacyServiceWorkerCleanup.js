const SW_CLEANUP_RELOAD_KEY = '__arma2_sw_cleanup_reload_ts__';
const SW_CLEANUP_WINDOW_MS = 45 * 1000;
const STALE_CACHE_NAME_PATTERN = /(workbox|precache|team-balancer|arma2|react-app)/i;

const shouldReloadNow = () => {
  try {
    const now = Date.now();
    const previousTs = Number(window.sessionStorage.getItem(SW_CLEANUP_RELOAD_KEY) || '0');
    if (Number.isFinite(previousTs) && previousTs > 0 && (now - previousTs) < SW_CLEANUP_WINDOW_MS) {
      return false;
    }
    window.sessionStorage.setItem(SW_CLEANUP_RELOAD_KEY, String(now));
    return true;
  } catch {
    return true;
  }
};

/**
 * Unregisters previously installed service workers and clears stale app caches.
 * This prevents users from being stuck with old HTML that points to missing CSS/JS assets.
 */
export const cleanupLegacyServiceWorkers = async () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) {
      return false;
    }

    const unregisterResults = await Promise.all(
      registrations.map(async (registration) => {
        try {
          return await registration.unregister();
        } catch {
          return false;
        }
      }),
    );

    let cacheDeleted = false;
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      const staleKeys = cacheKeys.filter((key) => STALE_CACHE_NAME_PATTERN.test(key));
      if (staleKeys.length > 0) {
        const deleted = await Promise.all(
          staleKeys.map(async (key) => {
            try {
              return await caches.delete(key);
            } catch {
              return false;
            }
          }),
        );
        cacheDeleted = deleted.some(Boolean);
      }
    }

    const changed = unregisterResults.some(Boolean) || cacheDeleted;
    if (!changed) {
      return false;
    }

    if (!shouldReloadNow()) {
      return false;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('sw-cleanup', String(Date.now()));
    window.location.replace(url.toString());
    return true;
  } catch (error) {
    console.warn('[SW_CLEANUP] Could not cleanup legacy service workers:', error);
    return false;
  }
};

