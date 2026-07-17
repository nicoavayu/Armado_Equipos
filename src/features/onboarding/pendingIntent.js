// Impure helpers that answer "is it safe to auto-open onboarding right now?".
// Kept separate from the pure eligibility rules so they can read window/session
// state without making eligibility.js untestable.

const PENDING_NATIVE_PUSH_REDIRECT_KEY = 'pending_native_push_redirect';

// Params on the Home route that mean the user landed on a specific action (a
// voting/invite deep link, a proposal, an admin/history view). Onboarding must
// never pre-empt these — it waits for a truly idle Home.
const HOME_INTENT_PARAMS = [
  'codigo',
  'partidoId',
  'adminPartidoId',
  'invite',
  'proposal',
  'admin',
  'view',
  'returnTo',
];

export function isSafeHomeSurface(location) {
  const pathname = String(location?.pathname || '');
  if (pathname !== '/' && pathname !== '/home') return false;
  const params = new URLSearchParams(String(location?.search || ''));
  return !HOME_INTENT_PARAMS.some((key) => params.has(key));
}

// Password-recovery / magic-link markers that can appear in the URL while a
// special auth flow is being completed.
export function hasAuthRecoveryMarkers(loc = (typeof window !== 'undefined' ? window.location : null)) {
  if (!loc) return false;
  const hash = String(loc.hash || '');
  const search = String(loc.search || '');
  return (
    /(?:^|[#?&])type=recovery(?:&|$)/i.test(hash)
    || /(?:^|[#?&])type=recovery(?:&|$)/i.test(search)
    || /access_token=/.test(hash)
  );
}

export function hasPendingNativePushRedirect() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.sessionStorage.getItem(PENDING_NATIVE_PUSH_REDIRECT_KEY));
  } catch (_error) {
    return false;
  }
}

// A pending "intent" is anything that should take priority over onboarding:
// an in-flight auth flow, a password-recovery URL, or a queued push redirect.
export function hasPendingIntent({ pendingAuthFlow = null } = {}) {
  return Boolean(pendingAuthFlow) || hasAuthRecoveryMarkers() || hasPendingNativePushRedirect();
}
