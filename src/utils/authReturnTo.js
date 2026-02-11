const RETURN_TO_KEY = 'auth:returnTo';

function normalizePath(path) {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  return trimmed;
}

export function setAuthReturnTo(path) {
  const normalized = normalizePath(path);
  if (!normalized) return;
  try {
    window.localStorage.setItem(RETURN_TO_KEY, normalized);
  } catch {
    // localStorage may be unavailable in private mode
  }
}

export function readAuthReturnTo() {
  try {
    const value = window.localStorage.getItem(RETURN_TO_KEY);
    return normalizePath(value);
  } catch {
    return null;
  }
}

export function clearAuthReturnTo() {
  try {
    window.localStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // no-op
  }
}

export function consumeAuthReturnTo(fallback = '/home') {
  const value = readAuthReturnTo();
  clearAuthReturnTo();
  return value || fallback;
}
