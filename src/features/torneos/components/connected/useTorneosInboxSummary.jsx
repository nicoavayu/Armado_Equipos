import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTorneosWorkspace } from '../../context/TorneosWorkspaceContext';
import { TORNEOS_INBOX_CHANGED } from './torneosInboxEvents';

const REFRESH_MS = 60_000;
const EMPTY = Object.freeze({
  status: 'unsupported', total: 0, notificationsUnread: 0, communicationsUnread: 0, supported: false, refresh: () => {},
});
const TorneosInboxSummaryContext = createContext(EMPTY);

// The bell counts ONLY the Torneos inbox: official communications delivered to this user (same audience and access
// checks as the communications inbox) plus Torneos registration activity. Nothing from Core is read or counted.
// One provider per shell, so the bell, both navigation bars and the inbox share a single request. Without the
// connected product (a composition that does not serve the summary) there is no counter and no request at all: the
// bell still opens the Torneos inbox.
export function TorneosInboxSummaryProvider({ children }) {
  const { service, status } = useTorneosWorkspace();
  const supported = typeof service?.loadTorneosInboxSummary === 'function';
  const requestRef = useRef(0);
  const [summary, setSummary] = useState({
    status: supported ? 'loading' : 'unsupported', total: 0, notificationsUnread: 0, communicationsUnread: 0,
  });

  const refresh = useCallback(async () => {
    if (!supported || status !== 'ready') return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    try {
      const payload = await service.loadTorneosInboxSummary();
      if (requestRef.current !== requestId) return;
      setSummary({
        status: 'ready',
        total: Number(payload?.total) || 0,
        notificationsUnread: Number(payload?.notificationsUnread) || 0,
        communicationsUnread: Number(payload?.communicationsUnread) || 0,
      });
    } catch {
      if (requestRef.current === requestId) setSummary((current) => ({ ...current, status: 'error' }));
    }
  }, [service, status, supported]);

  useEffect(() => {
    if (!supported) return undefined;
    refresh();
    const onChange = () => { refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
    window.addEventListener(TORNEOS_INBOX_CHANGED, onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(TORNEOS_INBOX_CHANGED, onChange);
      document.removeEventListener('visibilitychange', onVisible);
      requestRef.current += 1;
    };
  }, [refresh, supported]);

  const value = useMemo(() => ({ ...summary, supported, refresh }), [refresh, summary, supported]);
  return <TorneosInboxSummaryContext.Provider value={value}>{children}</TorneosInboxSummaryContext.Provider>;
}

export function useTorneosInboxSummary() {
  return useContext(TorneosInboxSummaryContext);
}
