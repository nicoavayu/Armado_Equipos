// Network Logger - Intercepta fetch para logging básico
let originalFetch = null;
let initialized = false;

export function initNetworkLogger() {
  if (initialized) return;
  
  originalFetch = window.fetch;
  initialized = true;
  
  window.fetch = async function(...args) {
    const start = performance.now();
    try {
      const res = await originalFetch(...args);
      const ms = Math.round(performance.now() - start);
      if (!res.ok) {
        console.error('[NET]', res.status, args[0], `${ms}ms`);
      } else {
        console.debug('[NET]', res.status, args[0], `${ms}ms`);
      }
      return res;
    } catch (e) {
      const ms = Math.round(performance.now() - start);
      console.error('[NET][FAIL]', args[0], `${ms}ms`, e);
      throw e;
    }
  };
  
  console.log('[NetworkLogger] Initialized');
}

export function disableNetworkLogger() {
  if (originalFetch) {
    window.fetch = originalFetch;
    initialized = false;
  }
}
