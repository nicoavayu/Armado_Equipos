import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const resetListeners = new Set();
let latestResetVersion = 0;
let frameOneId = null;
let frameTwoId = null;
let fallbackTimerId = null;

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const resetScrollPosition = (target) => {
  if (!target) return;

  try {
    if (typeof target.scrollTo === 'function') {
      target.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  } catch (_error) {
    // Ignore browsers/webviews that only support the legacy signature.
  }

  if ('scrollTop' in target) {
    target.scrollTop = 0;
  }

  if ('scrollLeft' in target) {
    target.scrollLeft = 0;
  }
};

const resetWindowScroll = () => {
  if (!isBrowser()) return;

  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } catch (_error) {
    window.scrollTo(0, 0);
  }

  resetScrollPosition(document.scrollingElement);
  resetScrollPosition(document.documentElement);
  resetScrollPosition(document.body);
};

const clearScheduledReset = () => {
  if (!isBrowser()) return;

  if (frameOneId !== null) {
    window.cancelAnimationFrame(frameOneId);
    frameOneId = null;
  }

  if (frameTwoId !== null) {
    window.cancelAnimationFrame(frameTwoId);
    frameTwoId = null;
  }

  if (fallbackTimerId !== null) {
    window.clearTimeout(fallbackTimerId);
    fallbackTimerId = null;
  }
};

const notifyResetListeners = (version) => {
  resetListeners.forEach((listener) => {
    try {
      listener(version);
    } catch (error) {
      console.error('[SCROLL_RESET] listener failed', error);
    }
  });
};

const flushScheduledReset = (version) => {
  if (!isBrowser() || version !== latestResetVersion) return;

  clearScheduledReset();
  resetWindowScroll();
  notifyResetListeners(version);
};

const scheduleReset = (version) => {
  if (!isBrowser()) return;

  clearScheduledReset();

  const run = () => flushScheduledReset(version);

  if (typeof window.requestAnimationFrame === 'function') {
    frameOneId = window.requestAnimationFrame(() => {
      frameTwoId = window.requestAnimationFrame(run);
    });
  } else {
    fallbackTimerId = window.setTimeout(run, 0);
    return;
  }

  fallbackTimerId = window.setTimeout(run, 160);
};

export const requestScrollReset = () => {
  latestResetVersion += 1;
  scheduleReset(latestResetVersion);
  return latestResetVersion;
};

export const useRouteScrollReset = () => {
  const location = useLocation();
  const routeKey = `${location.key || ''}:${location.pathname}:${location.search}`;

  useEffect(() => {
    requestScrollReset();
  }, [routeKey]);
};

export const useScrollResetOnChange = (value, options = {}) => {
  const { enabled = true, skipInitial = true } = options;
  const hasMountedRef = useRef(false);
  const previousValueRef = useRef(value);

  useEffect(() => {
    if (!enabled) {
      hasMountedRef.current = true;
      previousValueRef.current = value;
      return;
    }

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      previousValueRef.current = value;

      if (!skipInitial) {
        requestScrollReset();
      }

      return;
    }

    if (Object.is(previousValueRef.current, value)) return;

    previousValueRef.current = value;
    requestScrollReset();
  }, [enabled, skipInitial, value]);
};

export const useScrollResetContainer = () => {
  const containerRef = useRef(null);
  const appliedVersionRef = useRef(0);

  useEffect(() => {
    if (!isBrowser()) return undefined;

    const applyReset = (version = latestResetVersion) => {
      const node = containerRef.current;
      if (!node || appliedVersionRef.current === version) return;

      resetScrollPosition(node);
      appliedVersionRef.current = version;
    };

    applyReset();
    resetListeners.add(applyReset);

    return () => {
      resetListeners.delete(applyReset);
    };
  }, []);

  return containerRef;
};
