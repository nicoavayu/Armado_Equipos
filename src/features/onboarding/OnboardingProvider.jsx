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
  isPersistedOnboardingPath,
  isValidOnboardingPath,
} from './content';
import { isOnboardingEnabledForUser, resolveOnboardingDecision } from './eligibility';
import {
  createDefaultOnboardingState,
  loadOnboardingState,
  saveOnboardingState,
} from './storage';
import {
  hasBlockingModalOpen,
  hasPendingIntent as detectPendingIntent,
  isSafeHomeSurface,
} from './pendingIntent';

// Small defer before auto-opening: lets routing, deep links and notification
// redirects settle so a queued navigation can win the race. We re-check safety
// when the timer fires, so a redirect that lands during the delay cancels it.
const AUTO_OPEN_DELAY_MS = 700;
// Hard cap on waiting for the profile so a profile-load error never blocks the
// onboarding forever.
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
  // A single host owns every visible state, so onboarding surfaces can never
  // stack: intro modal, fullscreen tour, first steps modal or completion modal.
  const [activeFlow, setActiveFlow] = useState(null);
  const [pendingManualSurface, setPendingManualSurface] = useState(null);
  // Perfil-tab tutorial: a standalone surface, persisted independently from the
  // general onboarding flow above so neither can hide the other.
  const [profileTourOpen, setProfileTourOpen] = useState(false);

  // Where the Perfil tour was opened from: 'onboarding' (via the profile step of
  // the general flow → resume the goal selector on close) or 'profile' (manual
  // entry → stay in Perfil). Temporary/in-memory only: never persisted, so a new
  // device/session/account can't inherit a stale origin and resume incorrectly.
  const [profileTourOrigin, setProfileTourOrigin] = useState(null);

  const userId = user?.id || null;
  const autoOpenedThisSessionRef = useRef(false);
  // Once the Perfil tour has been offered in this session we don't re-offer it,
  // even if it was closed by navigation without being explicitly finished.
  const profileTourHandledSessionRef = useRef(false);
  const locationRef = useRef(location);
  const pendingAuthFlowRef = useRef(pendingAuthFlow);
  const firstWriteDoneRef = useRef(false);
  const writeQueueRef = useRef(Promise.resolve());
  const blockingModalOpen = useBlockingModalOpen();
  const blockingModalOpenRef = useRef(blockingModalOpen);
  locationRef.current = location;
  pendingAuthFlowRef.current = pendingAuthFlow;
  blockingModalOpenRef.current = blockingModalOpen;

  const enabled = useMemo(() => isOnboardingEnabledForUser(user), [user]);

  // Load persisted state whenever the user changes. Never throws (storage falls
  // back to local/defaults), so the app is usable even if the query fails.
  useEffect(() => {
    let cancelled = false;
    autoOpenedThisSessionRef.current = false;
    firstWriteDoneRef.current = false;
    // Per-user session guards: switching accounts on the same device must never
    // leak the previous user's "already offered" state or tour origin into the
    // new one.
    profileTourHandledSessionRef.current = false;
    setActiveFlow(null);
    setPendingManualSurface(null);
    setProfileTourOpen(false);
    setProfileTourOrigin(null);

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
  const pendingIntent = detectPendingIntent({ pendingAuthFlow }) || blockingModalOpen;

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
      // Preserve write order when real actions happen quickly. Storage still
      // writes locally first and handles offline fallback; serialization keeps
      // a slower earlier upsert from overwriting a newer checklist state.
      writeQueueRef.current = writeQueueRef.current
        .then(() => saveOnboardingState(userId, withSeed, { isFirstWrite }))
        .catch((error) => logger.warn('[ONBOARDING] persist failed', { code: error?.code || null }));
      if (meta.event) {
        try { track(meta.event, meta.props || {}); } catch (_error) { /* analytics is optional */ }
      }
      return withSeed;
    });
  }, [userId]);

  const openOnboarding = useCallback(({ auto = false, replay = false } = {}) => {
    autoOpenedThisSessionRef.current = true;
    const resumePath = isPersistedOnboardingPath(state.chosenPath) ? state.chosenPath : null;
    // Resume mid-path only for a genuine in-progress run (not a replay).
    const screen = !replay && resumePath && state.status === ONBOARDING_STATUS.IN_PROGRESS
      ? 'path'
      : 'intro';
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

  // "Completá tu perfil": the first recommended step, shown after the intro and
  // before the goal selector. It never gates the rest of the app.
  const goToProfileStep = useCallback(() => {
    setActiveFlow((prev) => (prev ? { ...prev, screen: 'profile', path: null } : { screen: 'profile', path: null }));
  }, []);

  const markProfileStepSeen = useCallback(() => {
    persist((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, profileStepSeen: true },
    }), { event: 'onboarding_profile_step_seen' });
  }, [persist]);

  const markProfileTourSeen = useCallback(() => {
    persist((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, profileTourSeen: true },
    }), { event: 'onboarding_profile_tour_seen' });
  }, [persist]);

  // Primary CTA of the profile step: record it as seen and close the flow so the
  // caller can navigate to Perfil (where the Perfil tour then auto-opens). The
  // caller passes the 'onboarding' origin via navigation state, so the tour
  // resumes the general flow (goal selector) on close.
  const startProfileFromOnboarding = useCallback(() => {
    markProfileStepSeen();
    setActiveFlow(null);
    track_safe('onboarding_profile_step_cta', { action: 'complete' });
  }, [markProfileStepSeen]);

  // Discreet secondary CTA: mark seen and continue to the goal selector.
  const continueFromProfileStep = useCallback(() => {
    markProfileStepSeen();
    goToGoalSelector();
    track_safe('onboarding_profile_step_cta', { action: 'continue' });
  }, [markProfileStepSeen, goToGoalSelector]);

  const chooseGoal = useCallback((pathKey) => {
    if (!isValidOnboardingPath(pathKey)) return;
    persist((prev) => ({
      ...prev,
      // Desafíos and Estadísticas are educational-only paths. Keeping the
      // previous checklist choice (or null for a new user) avoids writing an
      // unsupported DB enum and never turns either feature into a task.
      chosenPath: isPersistedOnboardingPath(pathKey) ? pathKey : prev.chosenPath,
      status: ONBOARDING_STATUS.IN_PROGRESS,
    }), {
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

  const completeOnboarding = useCallback((completedPath = null) => {
    persist((prev) => ({
      ...prev,
      status: ONBOARDING_STATUS.COMPLETED,
      completedVersion: CURRENT_ONBOARDING_VERSION,
      completedAt: new Date().toISOString(),
    }), { event: 'onboarding_completed', props: { path: completedPath || state.chosenPath || null } });
    setActiveFlow(null);
  }, [persist, state.chosenPath]);

  const skipOnboarding = useCallback(() => {
    persist((prev) => ({
      ...prev,
      status: ONBOARDING_STATUS.SKIPPED,
      // Skipping is intentionally pending: it suppresses the current session,
      // but does not handle the version forever.
      completedVersion: prev.completedVersion,
      skippedAt: new Date().toISOString(),
    }), { event: 'onboarding_skipped', props: { path: state.chosenPath || null } });
    setActiveFlow(null);
  }, [persist, state.chosenPath]);

  const replayOnboarding = useCallback((pathKey) => {
    autoOpenedThisSessionRef.current = true;
    const validPath = isPersistedOnboardingPath(pathKey) ? pathKey : null;
    if (validPath) {
      persist((prev) => ({ ...prev, chosenPath: pathKey }));
    }
    const request = { type: 'tour', path: validPath };
    if (!isSafeHomeSurface(locationRef.current)
      || detectPendingIntent({ pendingAuthFlow: pendingAuthFlowRef.current })
      || blockingModalOpenRef.current) {
      setPendingManualSurface(request);
    } else {
      setActiveFlow(validPath
        ? { screen: 'path', path: validPath }
        : { screen: 'intro', path: null });
    }
    track_safe('onboarding_replayed', { path: validPath });
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

  // Perfil-tab tutorial. Requested from the Perfil surface (see
  // useProfileTourTrigger). Guards run here so eligibility/idempotence live in a
  // single place: shown at most once per session, and never over the general
  // flow or a blocking modal.
  // `origin` is the navigation-scoped source ('onboarding' | 'profile'), passed
  // by the caller (see useProfileTourTrigger). It is never persisted, so a new
  // device/session/account can't inherit it. Guards keep it idempotent.
  const openProfileTour = useCallback((origin = 'profile') => {
    if (!enabled) return;
    if (profileTourHandledSessionRef.current) return;
    if (activeFlow || profileTourOpen) return;
    if (state.checklist?.profileTourSeen) return;
    if (blockingModalOpenRef.current || detectPendingIntent({ pendingAuthFlow: pendingAuthFlowRef.current })) return;
    profileTourHandledSessionRef.current = true;
    const resolvedOrigin = origin === 'onboarding' ? 'onboarding' : 'profile';
    setProfileTourOrigin(resolvedOrigin);
    setProfileTourOpen(true);
    track_safe('onboarding_profile_tour_shown', { origin: resolvedOrigin });
  }, [enabled, activeFlow, profileTourOpen, state.checklist]);

  // Resume the general flow (goal selector) only when the tour was opened from
  // the onboarding profile step. Manual entries stay in Perfil. State updates are
  // batched so the two overlays never render at once.
  const closeProfileTour = useCallback((event) => {
    setProfileTourOpen(false);
    setProfileTourOrigin(null);
    if (profileTourOrigin === 'onboarding') goToGoalSelector();
    markProfileTourSeen();
    track_safe(event, {});
  }, [profileTourOrigin, markProfileTourSeen, goToGoalSelector]);

  // Explicit finish/close both mark the tutorial as seen (idempotent): the user
  // acknowledged it. Only an unexpected unmount (reload, crash) leaves it unseen.
  const completeProfileTour = useCallback(() => {
    closeProfileTour('onboarding_profile_tour_completed');
  }, [closeProfileTour]);

  const dismissProfileTour = useCallback(() => {
    closeProfileTour('onboarding_profile_tour_dismissed');
  }, [closeProfileTour]);

  // Auto-open effect. Fires only when the decision says so AND a re-check at
  // timer-fire time still finds a safe, idle Home. Once per session.
  useEffect(() => {
    if (!decision.ready || !decision.shouldAutoOpen) return undefined;
    if (pendingManualSurface) return undefined;
    if (activeFlow || autoOpenedThisSessionRef.current) return undefined;

    const timer = setTimeout(() => {
      if (autoOpenedThisSessionRef.current) return;
      if (!isSafeHomeSurface(locationRef.current)) return;
      if (detectPendingIntent({ pendingAuthFlow: pendingAuthFlowRef.current })) return;
      if (blockingModalOpenRef.current) return;
      openOnboarding({ auto: true });
    }, AUTO_OPEN_DELAY_MS);

    return () => clearTimeout(timer);
  }, [decision.ready, decision.shouldAutoOpen, activeFlow, openOnboarding, pendingManualSurface]);

  useEffect(() => {
    if (!pendingManualSurface || activeFlow || !safeHome || pendingIntent) return;
    setPendingManualSurface(null);
    setActiveFlow(pendingManualSurface.path
      ? { screen: 'path', path: pendingManualSurface.path }
      : { screen: 'intro', path: null });
  }, [activeFlow, pendingIntent, pendingManualSurface, safeHome]);

  const value = useMemo(() => ({
    // state / decision
    state,
    stateLoaded,
    decision,
    enabled,
    activeFlow,
    isActive: Boolean(activeFlow),
    isTourActive: Boolean(activeFlow && ['intro', 'goal', 'profile', 'path'].includes(activeFlow.screen)),
    currentVersion: CURRENT_ONBOARDING_VERSION,
    // flow navigation
    openOnboarding,
    goToGoalSelector,
    goToProfileStep,
    chooseGoal,
    closeOnboarding,
    completeOnboarding,
    skipOnboarding,
    replayOnboarding,
    // profile step (general onboarding)
    startProfileFromOnboarding,
    continueFromProfileStep,
    // perfil-tab tutorial
    profileTourOpen,
    profileTourOrigin,
    openProfileTour,
    completeProfileTour,
    dismissProfileTour,
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
    goToProfileStep,
    chooseGoal,
    closeOnboarding,
    completeOnboarding,
    skipOnboarding,
    replayOnboarding,
    startProfileFromOnboarding,
    continueFromProfileStep,
    profileTourOpen,
    profileTourOrigin,
    openProfileTour,
    completeProfileTour,
    dismissProfileTour,
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

// Existing app modals (especially HomeWelcomeCard) have absolute priority.
// Watching the DOM means onboarding also waits for notices/actions that do not
// share React state with this provider.
function useBlockingModalOpen() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined;
    const sync = () => setIsOpen(hasBlockingModalOpen());
    sync();
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return isOpen;
}

export default OnboardingProvider;
