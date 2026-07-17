import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOnboarding } from './OnboardingContext';
import { coachMarkContent } from './content';
import { hasBlockingModalOpen, hasPendingIntent } from './pendingIntent';

const MEASURE_DELAY_MS = 260; // let the screen paint + any scroll settle
const READY_DELAY_MS = 450; // small delay before first showing marks

function measure(target) {
  if (!target || typeof target.getBoundingClientRect !== 'function') return null;
  const rect = target.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom,
    right: rect.right,
  };
}

/**
 * Drives contextual coach marks for a screen. Only runs on the first relevant
 * visit (per persisted group-done flag), never during an active onboarding flow
 * or a pending deep-link/urgent intent, and never loops. Missing targets are
 * skipped safely; if no target is present, nothing renders.
 */
export function useCoachMarks(screenKey, { enabledOverride = null } = {}) {
  const {
    enabled,
    isActive,
    stateLoaded,
    isCoachMarkGroupDone,
    markCoachMarkGroupDone,
    markCoachMarkSeen,
  } = useOnboarding();

  const group = coachMarkContent[screenKey];
  const groupVersion = group?.version || 1;

  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [presentSteps, setPresentSteps] = useState([]);
  const startedRef = useRef(false);

  const shouldRun = useMemo(() => {
    if (enabledOverride != null) return enabledOverride;
    if (!enabled || !stateLoaded || !group) return false;
    if (isActive) return false; // never over the fullscreen flow
    if (isCoachMarkGroupDone(screenKey, groupVersion)) return false;
    if (hasPendingIntent()) return false; // deep-link / urgent flow takes priority
    if (hasBlockingModalOpen()) return false;
    return true;
  }, [enabledOverride, enabled, stateLoaded, group, isActive, isCoachMarkGroupDone, screenKey, groupVersion]);

  // Resolve which steps have a present target, after the screen has painted.
  useEffect(() => {
    if (!shouldRun) {
      setReady(false);
      startedRef.current = false;
      return undefined;
    }
    if (startedRef.current) return undefined;

    const timer = setTimeout(() => {
      if (typeof document === 'undefined') return;
      const resolved = group.steps.filter((step) => document.querySelector(step.target));
      if (resolved.length === 0) {
        // No target on this screen: mark the group done so we never re-attempt
        // in a loop, and render nothing.
        markCoachMarkGroupDone(screenKey, groupVersion);
        return;
      }
      startedRef.current = true;
      setPresentSteps(resolved);
      setIndex(0);
      setReady(true);
    }, READY_DELAY_MS);

    return () => clearTimeout(timer);
  }, [shouldRun, group, screenKey, groupVersion, markCoachMarkGroupDone]);

  const activeStep = ready ? presentSteps[index] : null;

  // Measure (and re-measure) the current target; scroll it into view first.
  useEffect(() => {
    if (!activeStep) return undefined;
    const target = document.querySelector(activeStep.target);
    if (!target) {
      // Target vanished mid-tour: advance safely.
      setIndex((current) => Math.min(current + 1, presentSteps.length));
      return undefined;
    }

    if (typeof target.scrollIntoView === 'function') {
      try { target.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_error) { /* jsdom */ }
    }
    markCoachMarkSeen(screenKey, activeStep.id);

    const remeasure = () => setRect(measure(target));
    const timer = setTimeout(remeasure, MEASURE_DELAY_MS);
    remeasure();

    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [activeStep, presentSteps.length, screenKey, markCoachMarkSeen]);

  const total = presentSteps.length;
  const isLast = index >= total - 1;

  const finish = useCallback(() => {
    setReady(false);
    markCoachMarkGroupDone(screenKey, groupVersion);
  }, [markCoachMarkGroupDone, screenKey, groupVersion]);

  const next = useCallback(() => {
    if (isLast) { finish(); return; }
    setIndex((current) => Math.min(current + 1, total - 1));
  }, [isLast, finish, total]);

  const prev = useCallback(() => {
    setIndex((current) => Math.max(current - 1, 0));
  }, []);

  const skip = useCallback(() => { finish(); }, [finish]);

  return {
    visible: ready && Boolean(activeStep),
    step: activeStep,
    index,
    total,
    isLast,
    isFirst: index === 0,
    rect,
    next,
    prev,
    skip,
  };
}

export default useCoachMarks;
