// Pure eligibility logic for the interactive onboarding. No React, no I/O — so
// every branch is unit-testable in isolation.

import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_LAUNCH_CUTOFF,
  ONBOARDING_STATUS,
} from './content';

// Feature-flag rollout, controlled at build time (CRA bakes env). Kept minimal:
// 'off' hides everything, 'allowlist' limits to specific ids/emails, 'all'
// (default) enables the automatic onboarding for new users and manual replay
// for everyone eligible.
export function getOnboardingRollout(env = process.env) {
  const raw = String(env.REACT_APP_ONBOARDING_ROLLOUT || '').trim().toLowerCase();
  if (raw === 'off' || raw === 'allowlist' || raw === 'all') return raw;
  return 'all';
}

export function getOnboardingAllowlist(env = process.env) {
  return String(env.REACT_APP_ONBOARDING_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isOnboardingEnabledForUser(user, options = {}) {
  const rollout = options.rollout || getOnboardingRollout();
  if (rollout === 'off') return false;
  if (!user) return false;
  if (rollout === 'all') return true;

  const allowlist = options.allowlist || getOnboardingAllowlist();
  const id = String(user.id || '').trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();
  return Boolean((id && allowlist.includes(id)) || (email && allowlist.includes(email)));
}

// A user is "new" when their authenticated account was created at/after the
// launch cutoff. This is a real, secure product signal (auth account creation),
// so a deploy never mass-classifies pre-existing accounts as new.
export function isNewAccount(user, options = {}) {
  const cutoffIso = options.launchCutoff || ONBOARDING_LAUNCH_CUTOFF;
  const createdRaw = user?.created_at || user?.createdAt || null;
  if (!createdRaw) return false;

  const createdMs = new Date(createdRaw).getTime();
  const cutoffMs = new Date(cutoffIso).getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(cutoffMs)) return false;
  return createdMs >= cutoffMs;
}

// Whether the account already answered the onboarding: completed it or dismissed
// it ("Ahora no", close). Either one is final: it never opens by itself again
// (Perfil → Ayuda replays it). A future version bump re-offers only to people who
// completed an older one.
export function hasHandledCurrentVersion(state, version = CURRENT_ONBOARDING_VERSION) {
  if (state?.status === ONBOARDING_STATUS.SKIPPED) return true;
  const handled = Number(state?.completedVersion ?? 0);
  return Number.isFinite(handled) && handled >= version;
}

// The account has already been shown the onboarding once (even if it left it
// half-way: switching to Torneos, reloading or closing the app must not reopen it).
// Opening it moves the status to in_progress; answering it to skipped/completed.
// (firstSeenAt is not a signal: any first write — e.g. the welcome card — seeds it.)
export function hasSeenOnboarding(state) {
  return Boolean(state?.status) && state.status !== ONBOARDING_STATUS.NOT_STARTED;
}

const WAITING = Object.freeze({
  ready: false,
  shouldAutoOpen: false,
  showDiscoveryCard: false,
  reason: 'loading',
});

/**
 * The single source of truth for "who sees the onboarding, and how".
 *
 * @returns {{ready:boolean, shouldAutoOpen:boolean, showDiscoveryCard:boolean, reason:string}}
 *  - shouldAutoOpen: open the full-screen flow now (new/resuming user on a safe surface).
 *  - showDiscoveryCard: retained for compatibility and always false; Home no
 *    longer renders inline onboarding surfaces.
 *  - ready: eligibility has been fully resolved (safe to stop waiting).
 */
export function resolveOnboardingDecision(ctx = {}) {
  const {
    enabled = false,
    user = null,
    profileResolved = false,
    stateLoaded = false,
    state = null,
    isSafeHomeSurface = false,
    hasPendingIntent = false,
    version = CURRENT_ONBOARDING_VERSION,
  } = ctx;

  if (!enabled) return { ...WAITING, ready: true, reason: 'disabled' };
  if (!user) return { ...WAITING, ready: true, reason: 'no_user' };

  // The app must never wait forever on our data: callers pass profileResolved /
  // stateLoaded, and on error they pass a null/empty state that still resolves.
  if (!profileResolved || !stateLoaded) return { ...WAITING, reason: 'loading' };

  if (hasHandledCurrentVersion(state, version)) {
    return { ...WAITING, ready: true, reason: 'already_handled' };
  }

  const newAccount = isNewAccount(user, ctx);
  const safeNow = Boolean(isSafeHomeSurface && !hasPendingIntent);
  // Automatic only once per account: the first time (never seen), or a new version
  // for someone who completed an older one. Half-way runs are not reopened.
  const firstTime = !hasSeenOnboarding(state);
  const completedOlderVersion = state?.status === ONBOARDING_STATUS.COMPLETED;

  // New users get the full-screen flow, but only from a safe Home surface with
  // nothing pending. When it isn't safe yet we stay "ready" and simply defer —
  // the gate re-checks on navigation.
  if (newAccount && (firstTime || completedOlderVersion)) {
    return {
      ready: true,
      shouldAutoOpen: safeNow,
      showDiscoveryCard: false,
      reason: safeNow ? 'new_user' : 'defer_until_safe',
    };
  }

  if (hasSeenOnboarding(state)) {
    return {
      ready: true,
      shouldAutoOpen: false,
      showDiscoveryCard: false,
      reason: 'already_offered',
    };
  }

  // Existing users never receive an automatic or inline Home offer. Manual
  // replay remains available from Perfil → Ayuda.
  return {
    ready: true,
    shouldAutoOpen: false,
    showDiscoveryCard: false,
    reason: 'existing_manual_only',
  };
}
