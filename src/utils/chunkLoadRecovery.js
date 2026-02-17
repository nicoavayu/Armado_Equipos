const CHUNK_RELOAD_TS_KEY = '__arma2_chunk_reload_ts__';
const CHUNK_RELOAD_WINDOW_MS = 45 * 1000;

export const isChunkLoadError = (error) => {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  return (
    name === 'ChunkLoadError'
    || /Loading chunk [0-9]+ failed/i.test(message)
    || /Failed to fetch dynamically imported module/i.test(message)
  );
};

export const recoverFromChunkLoadError = () => {
  if (typeof window === 'undefined') return false;

  try {
    const now = Date.now();
    const previousTs = Number(window.sessionStorage.getItem(CHUNK_RELOAD_TS_KEY) || '0');
    if (Number.isFinite(previousTs) && previousTs > 0 && (now - previousTs) < CHUNK_RELOAD_WINDOW_MS) {
      return false;
    }

    window.sessionStorage.setItem(CHUNK_RELOAD_TS_KEY, String(now));
    const url = new URL(window.location.href);
    url.searchParams.set('chunk-reload', String(now));
    window.location.replace(url.toString());
    return true;
  } catch (_error) {
    window.location.reload();
    return true;
  }
};
