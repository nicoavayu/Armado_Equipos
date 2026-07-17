import {
  resolveOnboardingDecision,
  isOnboardingEnabledForUser,
  isNewAccount,
  hasHandledCurrentVersion,
  getOnboardingRollout,
  getOnboardingAllowlist,
} from '../features/onboarding/eligibility';
import { CURRENT_ONBOARDING_VERSION, ONBOARDING_LAUNCH_CUTOFF, ONBOARDING_STATUS } from '../features/onboarding/content';

const newUser = { id: 'u-new', email: 'new@arma2.com', created_at: '2026-08-01T10:00:00.000Z' };
const oldUser = { id: 'u-old', email: 'old@arma2.com', created_at: '2025-01-01T10:00:00.000Z' };

const baseCtx = (over = {}) => ({
  enabled: true,
  user: newUser,
  profileResolved: true,
  stateLoaded: true,
  state: { completedVersion: 0, status: ONBOARDING_STATUS.NOT_STARTED, welcomeCardDismissed: false, chosenPath: null },
  isSafeHomeSurface: true,
  hasPendingIntent: false,
  version: CURRENT_ONBOARDING_VERSION,
  ...over,
});

describe('onboarding feature flag / allowlist', () => {
  test('rollout defaults to "all" and enables everyone', () => {
    expect(getOnboardingRollout({})).toBe('all');
    expect(isOnboardingEnabledForUser(newUser, { rollout: 'all' })).toBe(true);
    expect(isOnboardingEnabledForUser(oldUser, { rollout: 'all' })).toBe(true);
  });

  test('rollout "off" disables everyone', () => {
    expect(isOnboardingEnabledForUser(newUser, { rollout: 'off' })).toBe(false);
  });

  test('rollout "allowlist" enables only listed id or email', () => {
    const opts = { rollout: 'allowlist', allowlist: ['u-new', 'someone@else.com'] };
    expect(isOnboardingEnabledForUser(newUser, opts)).toBe(true);
    expect(isOnboardingEnabledForUser(oldUser, opts)).toBe(false);
    expect(isOnboardingEnabledForUser({ id: 'x', email: 'someone@else.com' }, opts)).toBe(true);
  });

  test('no user is never enabled', () => {
    expect(isOnboardingEnabledForUser(null, { rollout: 'all' })).toBe(false);
  });

  test('allowlist parses comma env, lowercased', () => {
    expect(getOnboardingAllowlist({ REACT_APP_ONBOARDING_ALLOWLIST: 'A@B.com, U-1 ,' }))
      .toEqual(['a@b.com', 'u-1']);
  });
});

describe('new vs existing account', () => {
  test('account created after the launch cutoff is new', () => {
    expect(isNewAccount(newUser)).toBe(true);
    expect(isNewAccount(newUser, { launchCutoff: ONBOARDING_LAUNCH_CUTOFF })).toBe(true);
  });

  test('account created before the launch cutoff is existing', () => {
    expect(isNewAccount(oldUser)).toBe(false);
  });

  test('missing created_at is treated as existing (safe default)', () => {
    expect(isNewAccount({ id: 'x' })).toBe(false);
  });
});

describe('version handling', () => {
  test('completed current version is handled', () => {
    expect(hasHandledCurrentVersion({ completedVersion: 1 }, 1)).toBe(true);
    expect(hasHandledCurrentVersion({ completedVersion: 0 }, 1)).toBe(false);
    expect(hasHandledCurrentVersion({ completedVersion: 1, status: ONBOARDING_STATUS.SKIPPED }, 1)).toBe(false);
  });

  test('a future version is not yet handled by a v1 completer', () => {
    expect(hasHandledCurrentVersion({ completedVersion: 1 }, 2)).toBe(false);
  });
});

describe('resolveOnboardingDecision', () => {
  test('new authenticated user on a safe Home surface auto-opens', () => {
    const d = resolveOnboardingDecision(baseCtx());
    expect(d).toMatchObject({ ready: true, shouldAutoOpen: true, showDiscoveryCard: false });
  });

  test('existing user never auto-opens and gets no inline Home offer', () => {
    const d = resolveOnboardingDecision(baseCtx({ user: oldUser }));
    expect(d.shouldAutoOpen).toBe(false);
    expect(d.showDiscoveryCard).toBe(false);
    expect(d.reason).toBe('existing_manual_only');
  });

  test('existing user who dismissed the card sees nothing', () => {
    const d = resolveOnboardingDecision(baseCtx({
      user: oldUser,
      state: { completedVersion: 0, status: ONBOARDING_STATUS.NOT_STARTED, welcomeCardDismissed: true },
    }));
    expect(d.shouldAutoOpen).toBe(false);
    expect(d.showDiscoveryCard).toBe(false);
  });

  test('user who already completed the current version sees nothing', () => {
    const d = resolveOnboardingDecision(baseCtx({
      state: { completedVersion: 1, status: ONBOARDING_STATUS.COMPLETED },
    }));
    expect(d.ready).toBe(true);
    expect(d.shouldAutoOpen).toBe(false);
    expect(d.showDiscoveryCard).toBe(false);
    expect(d.reason).toBe('already_handled');
  });

  test('user who skipped remains pending and can be re-offered next session', () => {
    // v1 clients wrote completedVersion on skip; status repairs the semantics.
    const d = resolveOnboardingDecision(baseCtx({
      state: { completedVersion: 1, status: ONBOARDING_STATUS.SKIPPED },
    }));
    expect(d.shouldAutoOpen).toBe(true);
    expect(d.showDiscoveryCard).toBe(false);
  });

  test('a future version re-offers to a v1 completer', () => {
    const d = resolveOnboardingDecision(baseCtx({
      version: 2,
      state: { completedVersion: 1, status: ONBOARDING_STATUS.COMPLETED },
    }));
    // New account on safe surface -> auto opens for the new version.
    expect(d.shouldAutoOpen).toBe(true);
  });

  test('disabled flag yields ready:true and no surfaces', () => {
    const d = resolveOnboardingDecision(baseCtx({ enabled: false }));
    expect(d).toMatchObject({ ready: true, shouldAutoOpen: false, showDiscoveryCard: false, reason: 'disabled' });
  });

  test('still loading (state/profile) stays not ready', () => {
    expect(resolveOnboardingDecision(baseCtx({ stateLoaded: false })).ready).toBe(false);
    expect(resolveOnboardingDecision(baseCtx({ profileResolved: false })).ready).toBe(false);
  });

  test('resumes an in-progress run even for an old account', () => {
    const d = resolveOnboardingDecision(baseCtx({
      user: oldUser,
      state: { completedVersion: 0, status: ONBOARDING_STATUS.IN_PROGRESS, chosenPath: 'organizer' },
    }));
    expect(d.shouldAutoOpen).toBe(true);
    expect(d.reason).toBe('resume');
  });

  describe('priority: never pre-empt a pending intent / unsafe surface', () => {
    test('a pending intent (deep link / notification / recovery) defers auto-open', () => {
      const d = resolveOnboardingDecision(baseCtx({ hasPendingIntent: true }));
      expect(d.ready).toBe(true);
      expect(d.shouldAutoOpen).toBe(false);
      expect(d.reason).toBe('defer_until_safe');
    });

    test('an unsafe surface (not idle Home) defers auto-open', () => {
      const d = resolveOnboardingDecision(baseCtx({ isSafeHomeSurface: false }));
      expect(d.shouldAutoOpen).toBe(false);
      expect(d.reason).toBe('defer_until_safe');
    });
  });
});
