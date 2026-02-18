import { useCallback, useEffect, useRef, useState } from 'react';

export default function useInlineNotice() {
  const [notice, setNotice] = useState(null);
  const metaRef = useRef({ key: null, ts: 0 });
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const clearInlineNotice = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (mountedRef.current) setNotice(null);
  }, []);

  const showInlineNotice = useCallback(({ key, type = 'info', message, autoHideMs } = {}) => {
    const stableKey = String(key || message || '').trim();
    if (!stableKey || !message) return;

    const now = Date.now();
    if (metaRef.current.key === stableKey && now - metaRef.current.ts < 2000) return;
    metaRef.current = { key: stableKey, ts: now };

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!mountedRef.current) return;
    setNotice({ type, message, key: stableKey });

    const resolvedAutoHide = Number.isFinite(autoHideMs)
      ? autoHideMs
      : ((type === 'success' || type === 'info') ? 3000 : null);

    if (resolvedAutoHide && resolvedAutoHide > 0) {
      timerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setNotice(null);
        timerRef.current = null;
      }, resolvedAutoHide);
    }
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { notice, showInlineNotice, clearInlineNotice };
}
