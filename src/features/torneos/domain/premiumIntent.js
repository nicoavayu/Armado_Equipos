export const PREMIUM_INTENT_QUERY = 'intent';
export const PREMIUM_INTENT_VALUE = 'premium';
export const PREMIUM_INTENT_STORAGE_KEY = 'arma2:torneos:premium-intent:v1';

export function isPremiumIntentSearch(search) {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params?.get(PREMIUM_INTENT_QUERY) === PREMIUM_INTENT_VALUE;
}

export function capturePremiumIntent(search) {
  if (!isPremiumIntentSearch(search) || typeof window === 'undefined') return false;
  try {
    window.sessionStorage.setItem(PREMIUM_INTENT_STORAGE_KEY, PREMIUM_INTENT_VALUE);
    return true;
  } catch {
    return false;
  }
}

export function hasPendingPremiumIntent() {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(PREMIUM_INTENT_STORAGE_KEY) === PREMIUM_INTENT_VALUE;
  } catch {
    return false;
  }
}

export function clearPremiumIntent() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(PREMIUM_INTENT_STORAGE_KEY); } catch { /* private mode */ }
}

export function withPremiumIntent(path) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${PREMIUM_INTENT_QUERY}=${PREMIUM_INTENT_VALUE}`;
}
