const CHUNK_RELOAD_TS_KEY = '__arma2_chunk_reload_ts__';
const CHUNK_RELOAD_WINDOW_MS = 45 * 1000;

const CHUNK_ERROR_PATTERNS = [
  /Loading chunk [0-9]+ failed/i,
  /Loading CSS chunk [0-9]+ failed/i,
  /ChunkLoadError/i,
  /CSS_CHUNK_LOAD_FAILED/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

const extractErrorShape = (raw) => {
  if (!raw) return { name: '', message: '' };
  if (typeof raw === 'string') return { name: '', message: raw };
  if (raw.reason) return extractErrorShape(raw.reason);

  const name = String(raw.name || '');
  const message = String(
    raw.message
    || raw?.error?.message
    || raw?.target?.src
    || raw?.target?.href
    || '',
  );
  return { name, message };
};

export const isChunkLoadError = (error) => {
  const { name, message } = extractErrorShape(error);
  return (
    name === 'ChunkLoadError'
    || CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
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

const isStaticAssetLoadFailure = (event) => {
  const target = event?.target;
  if (!target) return false;

  const tagName = String(target.tagName || '').toUpperCase();
  const rel = String(target.rel || '').toLowerCase();
  const src = String(target.src || target.href || '');
  const isScript = tagName === 'SCRIPT';
  const isStylesheet = tagName === 'LINK' && rel.includes('stylesheet');
  const isStaticChunk = /\/static\/(js|css)\//.test(src) || /chunk/i.test(src);

  return (isScript || isStylesheet) && isStaticChunk;
};

export const registerChunkLoadErrorHandlers = () => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const onError = (event) => {
    if (isChunkLoadError(event?.error || event?.message || event) || isStaticAssetLoadFailure(event)) {
      recoverFromChunkLoadError();
    }
  };

  const onUnhandledRejection = (event) => {
    if (isChunkLoadError(event?.reason || event)) {
      event?.preventDefault?.();
      recoverFromChunkLoadError();
    }
  };

  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
};
