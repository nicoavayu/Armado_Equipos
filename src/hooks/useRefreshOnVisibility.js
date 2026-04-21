import { useEffect, useRef } from 'react';

export const useRefreshOnVisibility = (
  onRefresh,
  {
    enabled = true,
    refreshOnFocus = true,
    refreshOnVisible = true,
    minIntervalMs = 1500,
  } = {},
) => {
  const refreshRef = useRef(onRefresh);
  const lastRefreshAtRef = useRef(null);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return undefined;

    const runRefresh = () => {
      const now = Date.now();
      if (
        lastRefreshAtRef.current != null
        &&
        Number.isFinite(minIntervalMs)
        && minIntervalMs > 0
        && now - lastRefreshAtRef.current < minIntervalMs
      ) {
        return;
      }

      lastRefreshAtRef.current = now;
      refreshRef.current?.();
    };

    const handleFocus = () => {
      if (refreshOnFocus) runRefresh();
    };

    const handleVisibilityChange = () => {
      if (refreshOnVisible && document.visibilityState === 'visible') {
        runRefresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, minIntervalMs, refreshOnFocus, refreshOnVisible]);
};

export default useRefreshOnVisibility;
