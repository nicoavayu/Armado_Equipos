import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

import { useAuth } from '../../components/AuthProvider';
import usePendingAuthFlow from '../../hooks/usePendingAuthFlow';
import { track } from '../../utils/monitoring/analytics';
import logger from '../../utils/logger';

import { OnboardingContext, useOnboarding, useOnboardingOptional } from './OnboardingContext';
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_STATUS,
  isValidOnboardingPath,
} from './content';
import { isOnboardingEnabledForUser, resolveOnboardingDecision } from './eligibility';
import {
  createDefaultOnboardingState,
  loadOnboardingState,
  saveOnboardingState,
} from './storage';
import { hasPendingIntent as detectPendingIntent, isSafeHomeSurface } from './pendingIntent';

// Small defer before auto-opening: lets routing, deep links and notification
// redirects settle so a queued navigation can win the race. We re-check safety
// when the timer fires, so a redirect that lands during the delay cancels it.
const AUTO_OPEN_DELAY_MS = 700;
// Hard cap on waiting for the profile so a profile-load error never blocks the
// onboarding (or the discovery card) forever.
const PROFILE_GRACE_MS = 2000;

export { useOnboarding, useOnboardingOptional };

const coachMarkGroupKey = (screenKey, version) => `${screenKey}:__done@v${version}`;
const coachMarkStepKey = (screenKey, markId) => `${screenKey}:${markId}`;

export function OnboardingProvider({ children }) {
  const { user, profile, authResolved } = useAuth();
  const location = useLocation();
  const pendingAuthFlow = usePendingAuthFlow();

  const [state, setState] = useState(() => createDefaultOnboardingState());
  const [stateLoaded, setStateLoaded] = useState(false);
  const [profileGraceElapsed, setProfileGraceElapsed] = useState(false);
  // activeFlow: null when closed, else { screen: 'welcome'|'goal'|'path', path }
  const [activeFlow, setActiveFlow] = useState(null);

  const userId = user?.id || null;
  const autoOpenedThisSessionRef = useRef(false);
  const locationRef = useRef(location);
  const pendingAuthFlowRef = useRef(pendingAuthFlow);
  const firstWriteDoneRef = useRef(false);
  locationRef.current = location;
  pendingAuthFlowRef.current = pendingAuthFlow;

  const enabled = useMemo(() => isOnboardingEnabledForUser(user), [user]);

  // Load persisted state whenever the user changes. Never throws (storage falls
  // back to local/defaults), so the app is usable even if the query fails.
  useEffect(() => {
    let cancelled = false;
    autoOpenedThisSessionRef.current = false;
    firstWriteDoneRef.current = false;
    setActiveFlow(null);

    if (!userId) {
      setState(createDefaultOnboardingState());
      setStateLoaded(!authResolved ? false : true);
      return () => { cancelled = true; };
    }

    setStateLoaded(false);
    (async () => {
      const { state: loaded } = await loadOnboardingState(userId);
      if (cancelled) return;
      firstWriteDoneRef.current = loaded.completedVersion > 0
        || loaded.status !== ONBOARDING_STATUS.NOT_STARTED
        || Boolean(loaded.firstSeenAt);
      setState(loaded);
      setStateLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId, authResolved]);

  // Profile grace: resolve after profile arrives or a hard timeout.
  useEffect(() => {
    if (!authResolved) return undefined;
    if (profile) {
      setProfileGraceElapsed(true);
      return undefined;
    }
    const timer = setTimeout(() => setProfileGraceElapsed(true), PROFILE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [authResolved, profile]);

  const profileResolved = authResolved && (Boolean(profile) || profileGraceElapsed);
  const safeHome = isSafeHomeSurface(location);
  const pendingIntent = detectPendingIntent({ pendingAuthFlow });

  const decision = useMemo(() => resolveOnboardingDecision({
    enabled,
    user,
    profileResolved,
    stateLoaded,
    state,
    isSafeHomeSurface: safeHome,
    hasPendingIntent: pendingIntent,
    version: CURRENT_ONBOARDING_VERSION,
  }), [enabled, user, profileResolved, stateLoaded, state, safeHome, pendingIntent]);

  // Persist a full next state. Optimistic local + best-effort remote. Never
  // throws to the caller.
  const persist = useCallback((updater, meta = {}) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      const isFirstWrite = !firstWriteDoneRef.current;
      firstWriteDoneRef.current = true;
      const withSeed = isFirstWrite && !next.firstSeenAt
        ? { ...next, firstSeenAt: new Date().toISOString() }
        : next;
      // Fire and forget; storage handles offline fallback.
      Promise.resolve(saveOnboardingState(userId, withSeed, { isFirstWrite }))
        .catch((error) => logger.warn('[ONBOARDING] persist failed', { code: error?.code || null }));
      if (meta.event) {
        try { track(meta.event, meta.props || {}); } catch (_error) { /* analytics is optional */ }
      }
      return withSeed;
    });
  }, [userId]);

  const openOnboarding = useCallback(({ auto = false, replay = false } = {}) => {
    autoOpenedThisSessionRef.current = true;
    const resumePath = isValidOnboardingPath(state.chosenPath) ? state.chosenPath : null;
    // Resume mid-path only for a genuine in-progress run (not a replay).
    const screen = !replay && resumePath && state.status === ONBOARDING_STATUS.IN_PROGRESS
      ? 'path'
      : 'welcome';
    setActiveFlow({ screen, path: screen === 'path' ? resumePath : null });
    if (state.status !== ONBOARDING_STATUS.IN_PROGRESS && state.completedVersion < CURRENT_ONBOARDING_VERSION) {
      persist((prev) => ({ ...prev, status: ONBOARDING_STATUS.IN_PROGRESS }), {
        event: 'onboarding_started',
        props: { auto, replay },
      });
    } else {
      track_safe('onboarding_started', { auto, replay });
    }
  }, [state.chosenPath, state.status, state.completedVersion, persist]);

  const goToGoalSelector = useCallback(() => {
    setActiveFlow((prev) => (prev ? { ...prev, screen: 'goal', path: null } : { screen: 'goal', path: null }));
  }, []);

  const goToWelcome = useCallback(() => {
    setActiveFlow((prev) => (prev ? { ...prev, screen: 'welcome' } : { screen: 'welcome', path: null }));
  }, []);

  const chooseGoal = useCallback((pathKey) => {
    if (!isValidOnboardingPath(pathKey)) return;
    persist((prev) => ({ ...prev, chosenPath: pathKey, status: ONBOARDING_STATUS.IN_PROGRESS }), {
      event: 'onboarding_path_selected',
      props: { path: pathKey },
    });
    setActiveFlow({ screen: 'path', path: pathKey });
  }, [persist]);

  const closeOnboarding = useCallback(() => {
    // Soft close: keep progress so it can resume next session; do not re-open
    // automatically for the rest of this session.
    setActiveFlow(null);
  }, []);

  const completeOnboarding = useCallback(() => {
    persist((prev) => ({
      ...prev,
      status: ONBOARDING_STATUS.COMPLETED,
      completedVersion: CURRENT_ONBOARDING_VERSION,
      completedAt: new Date().toISOString(),
    }), { event: 'onboarding_completed', props: { path: state.chosenPath || null } });
    setActiveFlow(null);
  }, [persist, state.chosenPath]);

  const skipOnboarding = useCallback(() => {
    persist((prev) => ({
      ...prev,
      status: ONBOARDING_STATUS.SKIPPED,
      completedVersion: CURRENT_ONBOARDING_VERSION,
      skippedAt: new Date().toISOString(),
    }), { event: 'onboarding_skipped', props: { path: state.chosenPath || null } });
    setActiveFlow(null);
  }, [persist, state.chosenPath]);

  const replayOnboarding = useCallback((pathKey) => {
    autoOpenedThisSessionRef.current = true;
    if (isValidOnboardingPath(pathKey)) {
      setActiveFlow({ screen: 'path', path: pathKey });
      persist((prev) => ({ ...prev, chosenPath: pathKey }));
    } else {
      setActiveFlow({ screen: 'welcome', path: null });
    }
    track_safe('onboarding_replayed', { path: isValidOnboardingPath(pathKey) ? pathKey : null });
  }, [persist]);

  const dismissDiscoveryCard = useCallback(() => {
    persist((prev) => ({ ...prev, welcomeCardDismissed: true }), { event: 'onboarding_card_dismissed' });
  }, [persist]);

  const dismissChecklist = useCallback(() => {
    persist((prev) => ({ ...prev, checklist: { ...prev.checklist, dismissed: true } }));
  }, [persist]);

  // Called when the checklist is fully completed: record the celebration and,
  // if the user never formally finished the flow, mark the onboarding done.
  const markChecklistCelebrated = useCallback(() => {
    persist((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, celebrated: true, dismissed: true },
      status: ONBOARDING_STATUS.COMPLETED,
      completedVersion: Math.max(prev.completedVersion, CURRENT_ONBOARDING_VERSION),
      completedAt: prev.completedAt || new Date().toISOString(),
    }));
  }, [persist]);

  const markCoachMarkSeen = useCallback((screenKey, markId) => {
    persist((prev) => ({
      ...prev,
      coachMarks: { ...prev.coachMarks, [coachMarkStepKey(screenKey, markId)]: true },
    }));
  }, [persist]);

  const markCoachMarkGroupDone = useCallback((screenKey, version = 1) => {
    persist((prev) => ({
      ...prev,
      coachMarks: { ...prev.coachMarks, [coachMarkGroupKey(screenKey, version)]: true },
    }), { event: 'onboarding_coach_marks_done', props: { screen: screenKey } });
  }, [persist]);

  const isCoachMarkGroupDone = useCallback(
    (screenKey, version = 1) => Boolean(state.coachMarks?.[coachMarkGroupKey(screenKey, version)]),
    [state.coachMarks],
  );

  // Auto-open effect. Fires only when the decision says so AND a re-check at
  // timer-fire time still finds a safe, idle Home. Once per session.
  useEffect(() => {
    if (!decision.ready || !decision.shouldAutoOpen) return undefined;
    if (activeFlow || autoOpenedThisSessionRef.current) return undefined;

    const timer = setTimeout(() => {
      if (autoOpenedThisSessionRef.current) return;
      if (!isSafeHomeSurface(locationRef.current)) return;
      if (detectPendingIntent({ pendingAuthFlow: pendingAuthFlowRef.current })) return;
      openOnboarding({ auto: true });
    }, AUTO_OPEN_DELAY_MS);

    return () => clearTimeout(timer);
  }, [decision.ready, decision.shouldAutoOpen, activeFlow, openOnboarding]);

  const value = useMemo(() => ({
    // state / decision
    state,
    stateLoaded,
    decision,
    enabled,
    activeFlow,
    isActive: Boolean(activeFlow),
    currentVersion: CURRENT_ONBOARDING_VERSION,
    // discovery card
    canShowDiscoveryCard: decision.ready && decision.showDiscoveryCard,
    // flow navigation
    openOnboarding,
    goToGoalSelector,
    goToWelcome,
    chooseGoal,
    closeOnboarding,
    completeOnboarding,
    skipOnboarding,
    replayOnboarding,
    dismissDiscoveryCard,
    // checklist
    dismissChecklist,
    markChecklistCelebrated,
    // coach marks
    markCoachMarkSeen,
    markCoachMarkGroupDone,
    isCoachMarkGroupDone,
  }), [
    state,
    stateLoaded,
    decision,
    enabled,
    activeFlow,
    openOnboarding,
    goToGoalSelector,
    goToWelcome,
    chooseGoal,
    closeOnboarding,
    completeOnboarding,
    skipOnboarding,
    replayOnboarding,
    dismissDiscoveryCard,
    dismissChecklist,
    markChecklistCelebrated,
    markCoachMarkSeen,
    markCoachMarkGroupDone,
    isCoachMarkGroupDone,
  ]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

// track() silently ignores unknown events; wrap so analytics is never fatal.
function track_safe(event, props) {
  try { track(event, props); } catch (_error) { /* analytics is optional */ }
}

export default OnboardingProvider;
