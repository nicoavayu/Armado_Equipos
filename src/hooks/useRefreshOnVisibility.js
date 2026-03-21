import { useEffect, useRef } from 'react';

export const useRefreshOnVisibility = (
  onRefresh,
  {
    enabled = true,
    refreshOnFocus = true,
    refreshOnVisible = true,
  } = {},
) => {
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return undefined;

    const runRefresh = () => {
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
  }, [enabled, refreshOnFocus, refreshOnVisible]);
};

export default useRefreshOnVisibility;
