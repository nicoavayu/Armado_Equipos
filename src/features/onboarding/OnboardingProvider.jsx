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
import {
  hasBlockingModalOpen,
  hasPendingIntent as detectPendingIntent,
  isSafeHomeSurface,
} from './pendingIntent';
import { useOnboardingChecklist } from './useOnboardingChecklist';

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

  const userId = user?.id || null;
  const autoOpenedThisSessionRef = useRef(false);
  const firstStepsShownThisSessionRef = useRef(false);
  const completionShownThisSessionRef = useRef(false);
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
  const checklist = useOnboardingChecklist(state.chosenPath, {
    enabled: enabled && stateLoaded && Boolean(state.chosenPath),
    trackedActions: state.checklist?.actions || {},
  });

  // Load persisted state whenever the user changes. Never throws (storage falls
  // back to local/defaults), so the app is usable even if the query fails.
  useEffect(() => {
    let cancelled = false;
    autoOpenedThisSessionRef.current = false;
    firstStepsShownThisSessionRef.current = false;
    completionShownThisSessionRef.current = false;
    firstWriteDoneRef.current = false;
    setActiveFlow(null);
    setPendingManualSurface(null);

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
    const resumePath = isValidOnboardingPath(state.chosenPath) ? state.chosenPath : null;
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
      // Skipping is intentionally pending: it suppresses the current session,
      // but does not handle the version forever.
      completedVersion: prev.completedVersion,
      skippedAt: new Date().toISOString(),
    }), { event: 'onboarding_skipped', props: { path: state.chosenPath || null } });
    setActiveFlow(null);
  }, [persist, state.chosenPath]);

  const replayOnboarding = useCallback((pathKey) => {
    autoOpenedThisSessionRef.current = true;
    const validPath = isValidOnboardingPath(pathKey) ? pathKey : null;
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

  const dismissChecklist = useCallback(() => {
    firstStepsShownThisSessionRef.current = true;
    setActiveFlow(null);
  }, []);

  const showFirstSteps = useCallback(() => {
    if (!isValidOnboardingPath(state.chosenPath)) return;
    const request = { type: 'first_steps', path: state.chosenPath };
    if (!isSafeHomeSurface(locationRef.current)
      || detectPendingIntent({ pendingAuthFlow: pendingAuthFlowRef.current })
      || blockingModalOpenRef.current) {
      setPendingManualSurface(request);
      return;
    }
    firstStepsShownThisSessionRef.current = true;
    setActiveFlow({ screen: 'first_steps', path: request.path });
  }, [state.chosenPath]);

  // Called when the checklist is fully completed: record the celebration and,
  // if the user never formally finished the flow, mark the onboarding done.
  const markChecklistCelebrated = useCallback(() => {
    persist((prev) => ({
      ...prev,
      checklist: {
        ...prev.checklist,
        celebrated: true,
        completionShown: true,
      },
      status: ONBOARDING_STATUS.COMPLETED,
      completedVersion: Math.max(prev.completedVersion, CURRENT_ONBOARDING_VERSION),
      completedAt: prev.completedAt || new Date().toISOString(),
    }));
  }, [persist]);

  const markChecklistAction = useCallback((actionKey) => {
    const normalizedKey = String(actionKey || '').trim();
    if (!normalizedKey || state.checklist?.actions?.[normalizedKey]) return;
    persist((prev) => ({
      ...prev,
      checklist: {
        ...prev.checklist,
        actions: { ...prev.checklist?.actions, [normalizedKey]: true },
      },
    }), { event: 'onboarding_checklist_action', props: { action: normalizedKey } });
  }, [persist, state.checklist?.actions]);

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
    if (pendingManualSurface.type === 'first_steps') {
      firstStepsShownThisSessionRef.current = true;
      setActiveFlow({ screen: 'first_steps', path: pendingManualSurface.path });
      return;
    }
    setActiveFlow(pendingManualSurface.path
      ? { screen: 'path', path: pendingManualSurface.path }
      : { screen: 'intro', path: null });
  }, [activeFlow, pendingIntent, pendingManualSurface, safeHome]);

  // Offer real first-step progress as a modal, never as Home content. It can
  // appear after a completed/skipped tour or on a later idle Home, once/session.
  useEffect(() => {
    const tourHandled = state.status === ONBOARDING_STATUS.COMPLETED
      || state.status === ONBOARDING_STATUS.SKIPPED;
    if (!enabled || !stateLoaded || !tourHandled || !state.chosenPath) return undefined;
    if (checklist.loading || checklist.allDone || activeFlow) return undefined;
    if (!safeHome || pendingIntent || firstStepsShownThisSessionRef.current) return undefined;

    const timer = setTimeout(() => {
      if (!isSafeHomeSurface(locationRef.current)) return;
      if (detectPendingIntent({ pendingAuthFlow: pendingAuthFlowRef.current })) return;
      if (blockingModalOpenRef.current || firstStepsShownThisSessionRef.current) return;
      firstStepsShownThisSessionRef.current = true;
      setActiveFlow({ screen: 'first_steps', path: state.chosenPath });
    }, AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [activeFlow, checklist.allDone, checklist.loading, enabled, pendingIntent, safeHome, state.chosenPath, state.status, stateLoaded]);

  // The premium completion modal is tied to real checklist data and is marked
  // shown before rendering, preventing render loops and cross-device repeats.
  useEffect(() => {
    const tourHandled = state.status === ONBOARDING_STATUS.COMPLETED
      || state.status === ONBOARDING_STATUS.SKIPPED;
    const alreadyShown = Boolean(state.checklist?.completionShown || state.checklist?.celebrated);
    if (!enabled || !stateLoaded || !tourHandled || !state.chosenPath) return undefined;
    if (checklist.loading || !checklist.allDone || alreadyShown || activeFlow) return undefined;
    if (!safeHome || pendingIntent || completionShownThisSessionRef.current) return undefined;

    const timer = setTimeout(() => {
      if (!isSafeHomeSurface(locationRef.current)) return;
      if (detectPendingIntent({ pendingAuthFlow: pendingAuthFlowRef.current })) return;
      if (blockingModalOpenRef.current || completionShownThisSessionRef.current) return;
      completionShownThisSessionRef.current = true;
      markChecklistCelebrated();
      setActiveFlow({ screen: 'completed', path: state.chosenPath });
    }, AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [activeFlow, checklist.allDone, checklist.loading, enabled, markChecklistCelebrated, pendingIntent, safeHome, state.checklist?.celebrated, state.checklist?.completionShown, state.chosenPath, state.status, stateLoaded]);

  const value = useMemo(() => ({
    // state / decision
    state,
    stateLoaded,
    decision,
    enabled,
    activeFlow,
    isActive: Boolean(activeFlow),
    isTourActive: Boolean(activeFlow && ['intro', 'goal', 'path'].includes(activeFlow.screen)),
    currentVersion: CURRENT_ONBOARDING_VERSION,
    checklist,
    // flow navigation
    openOnboarding,
    goToGoalSelector,
    chooseGoal,
    closeOnboarding,
    completeOnboarding,
    skipOnboarding,
    replayOnboarding,
    // checklist
    dismissChecklist,
    showFirstSteps,
    markChecklistCelebrated,
    markChecklistAction,
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
    checklist,
    openOnboarding,
    goToGoalSelector,
    chooseGoal,
    closeOnboarding,
    completeOnboarding,
    skipOnboarding,
    replayOnboarding,
    dismissChecklist,
    showFirstSteps,
    markChecklistCelebrated,
    markChecklistAction,
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
