const RETURN_TO_KEY = 'auth:returnTo';

// A callback can resolve twice for a single login: React.StrictMode double
// invokes effects in development, and any remount does the same in any build.
// Consuming clears the stored value, so the second resolution used to read
// nothing and fall back to the product home, overwriting the deep route the
// user asked for before logging in. `intent` makes that consumption
// idempotent: the same login attempt always resolves to the same target until
// a new returnTo is stored.
let lastConsumption = null;

function normalizePath(path) {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  // `/\evil.example` is normalized to a protocol-relative URL by browsers, so
  // it is an external destination wearing a local path costume.
  if (trimmed.startsWith('/\\')) return null;
  return trimmed;
}

export function setAuthReturnTo(path) {
  const normalized = normalizePath(path);
  if (!normalized) return;
  // A new login intent invalidates whatever the previous one resolved to.
  lastConsumption = null;
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
  lastConsumption = null;
  try {
    window.localStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // no-op
  }
}

export function consumeAuthReturnTo(fallback = '/home', { intent = null } = {}) {
  if (intent !== null && lastConsumption && lastConsumption.intent === intent) {
    return lastConsumption.target;
  }

  const value = readAuthReturnTo();
  clearAuthReturnTo();
  const target = value || fallback;
  if (intent !== null) {
    lastConsumption = { intent, target };
  }
  return target;
}
