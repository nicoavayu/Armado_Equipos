import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const isSafeInternalPath = (value) => typeof value === 'string' && value.startsWith('/');

const getHistoryIndex = () => {
  if (typeof window === 'undefined') return 0;
  const idx = Number(window.history?.state?.idx);
  return Number.isFinite(idx) ? idx : 0;
};

const getCurrentRoute = (location) => `${location.pathname}${location.search}${location.hash || ''}`;

export const useSmartBackNavigation = (defaultOptions = {}) => {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback((overrideOptions = {}) => {
    const options = { ...defaultOptions, ...overrideOptions };

    if (typeof options.onBeforeBack === 'function') {
      const handledLocally = options.onBeforeBack();
      if (handledLocally) return true;
    }

    const currentRoute = getCurrentRoute(location);
    const explicitBackToRaw = options.backTo ?? location.state?.backTo ?? null;
    const explicitBackTo = isSafeInternalPath(explicitBackToRaw) && explicitBackToRaw !== currentRoute
      ? explicitBackToRaw
      : null;
    const explicitBackState = options.backToState ?? location.state?.backToState;
    const hasUsableHistory = !options.forceFallback && getHistoryIndex() > 0;

    if (hasUsableHistory && (options.preferHistoryBack || !explicitBackTo)) {
      navigate(-1);
      return true;
    }

    if (explicitBackTo) {
      navigate(explicitBackTo, {
        replace: options.replaceBackTo !== false,
        state: explicitBackState,
      });
      return true;
    }

    const fallbackRoute = isSafeInternalPath(options.fallback) ? options.fallback : '/';
    navigate(fallbackRoute, {
      replace: options.replaceFallback !== false,
      state: options.fallbackState,
    });
    return true;
  }, [defaultOptions, location, navigate]);
};

export default useSmartBackNavigation;
