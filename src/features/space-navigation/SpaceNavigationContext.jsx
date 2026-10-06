import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../components/AuthProvider';
import { torneosFeatureFlags } from '../torneos/config/featureFlags';
import { isPersonalSpaceAvailable } from '../../utils/runtimePlatform';
import { peekPendingNativePushRedirect } from '../../hooks/useNativeFeatures';
import {
  UNREAD_UNKNOWN,
  forgetCoreUnreadSnapshots,
  loadCoreUnread,
  loadTorneosUnread,
} from './crossProductUnread';
import {
  APP_SPACE,
  SPACE_FALLBACK_ROUTE,
  getSpaceFromPath,
  getValidRouteForSpace,
  readSpaceNavigation,
  rememberSpaceRoute,
  writeSpaceNavigation,
} from './spaceNavigation';

const OTHER_PRODUCT_REFRESH_MS = 60000;

const SpaceNavigationContext = createContext(null);

function isCanonicalOpening(location) {
  return location.pathname === '/' && !location.search && !location.hash;
}

// A normal opening never lands on a form that creates something: those routes restore to their product's start.
const NOT_RESTORED_ON_OPENING = Object.freeze(['/nuevo-partido']);

// Where a normal opening (no explicit destination) continues: the product the person was last in, at its last
// restorable screen. The preference is per user, holds routes only (no ids beyond the URL, no tokens) and is never an
// authorization: every restored screen re-checks access itself and falls back to its product's start.
export function resolveOpeningRoute({ preference, isSpaceAvailable }) {
  const coreAvailable = isSpaceAvailable(APP_SPACE.ARMA2);
  const torneosAvailable = isSpaceAvailable(APP_SPACE.TORNEOS);
  const wantsTorneos = preference.lastSpace === APP_SPACE.TORNEOS || !coreAvailable;
  const space = wantsTorneos && torneosAvailable ? APP_SPACE.TORNEOS : (coreAvailable ? APP_SPACE.ARMA2 : null);
  if (!space) return null;
  // The product it was closed in is not available here: open the other one at its start, never at an old screen.
  if (wantsTorneos && space === APP_SPACE.ARMA2 && preference.lastSpace === APP_SPACE.TORNEOS) {
    return SPACE_FALLBACK_ROUTE[APP_SPACE.ARMA2];
  }
  const route = getValidRouteForSpace(space, preference.lastRoute?.[space]) || SPACE_FALLBACK_ROUTE[space];
  const pathname = route.split('?')[0];
  return NOT_RESTORED_ON_OPENING.includes(pathname) ? SPACE_FALLBACK_ROUTE[space] : route;
}

export function SpaceNavigationProvider({
  children,
  native = isPersonalSpaceAvailable(),
  torneosAvailable = (
    torneosFeatureFlags.torneosEnabled
    && torneosFeatureFlags.workspacesEnabled
  ),
}) {
  const { user, authResolved } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentSpace = getSpaceFromPath(location.pathname);
  const openingUserRef = useRef(null);
  const openingHandledRef = useRef(false);
  const [openingSettled, setOpeningSettled] = useState(false);
  // The OTHER product's unread state, keyed by the account it was read for.
  const [otherUnread, setOtherUnread] = useState({ userId: null, space: null, value: UNREAD_UNKNOWN });
  const unreadRequestRef = useRef(0);
  const unreadUserRef = useRef(null);

  const isSpaceAvailable = useCallback((space) => {
    if (space === APP_SPACE.TORNEOS) return torneosAvailable;
    return native;
  }, [native, torneosAvailable]);

  useEffect(() => {
    const userId = user?.id || null;
    if (openingUserRef.current === userId) return;
    openingUserRef.current = userId;
    openingHandledRef.current = false;
    setOpeningSettled(false);
  }, [user?.id]);

  useEffect(() => {
    if (!authResolved || !user?.id || openingHandledRef.current) return;
    openingHandledRef.current = true;

    // An explicit destination (deep link, auth return, invitation, a push tap waiting to open) always wins: only a
    // canonical opening without any of them is restored.
    if (isCanonicalOpening(location) && !peekPendingNativePushRedirect()) {
      const openingRoute = resolveOpeningRoute({ preference: readSpaceNavigation(user.id), isSpaceAvailable });
      if (openingRoute && openingRoute !== location.pathname) {
        navigate(openingRoute, { replace: true });
        return;
      }
    }

    setOpeningSettled(true);
  }, [authResolved, isSpaceAvailable, location, navigate, user?.id]);

  useEffect(() => {
    if (!openingHandledRef.current || openingSettled) return;
    if (!authResolved || !user?.id) return;
    if (!isCanonicalOpening(location)) setOpeningSettled(true);
  }, [authResolved, location, openingSettled, user?.id]);

  // The query is part of what a screen reproduces (a tournament's `?categoria=`): it is remembered with the path, and
  // rememberSpaceRoute keeps only allowlisted keys — any other query (a token, an invitation) is never stored.
  useEffect(() => {
    if (!authResolved || !user?.id || !openingSettled) return;
    if (location.hash) return;
    rememberSpaceRoute(user.id, `${location.pathname}${location.search}`);
  }, [authResolved, location.hash, location.pathname, location.search, openingSettled, user?.id]);

  const switchSpace = useCallback((targetSpace, { route } = {}) => {
    if (!Object.values(APP_SPACE).includes(targetSpace)) return false;
    if (!isSpaceAvailable(targetSpace)) return false;
    const preference = readSpaceNavigation(user?.id);
    const requestedRoute = getValidRouteForSpace(targetSpace, route);
    const targetRoute = requestedRoute
      || getValidRouteForSpace(targetSpace, preference.lastRoute?.[targetSpace])
      || SPACE_FALLBACK_ROUTE[targetSpace];

    writeSpaceNavigation(user?.id, {
      ...preference,
      lastSpace: targetSpace,
      lastRoute: {
        ...preference.lastRoute,
        [targetSpace]: targetRoute,
      },
    });

    if (targetRoute !== `${location.pathname}`) {
      navigate(targetRoute, { replace: true });
    }
    return true;
  }, [isSpaceAvailable, location.pathname, navigate, user?.id]);

  const otherSpace = currentSpace === APP_SPACE.TORNEOS ? APP_SPACE.ARMA2 : APP_SPACE.TORNEOS;

  // Another account never sees the previous one's signal, and a late answer for it is dropped.
  useEffect(() => {
    unreadUserRef.current = user?.id || null;
    unreadRequestRef.current += 1;
    forgetCoreUnreadSnapshots(user?.id || null);
    setOtherUnread({ userId: user?.id || null, space: null, value: UNREAD_UNKNOWN });
  }, [user?.id]);

  const refreshOtherUnread = useCallback(async () => {
    const userId = user?.id || null;
    if (!authResolved || !userId) return;
    const requestId = unreadRequestRef.current + 1;
    unreadRequestRef.current = requestId;
    const settle = (value) => {
      if (unreadRequestRef.current !== requestId || unreadUserRef.current !== userId) return;
      setOtherUnread({ userId, space: otherSpace, value });
    };
    if (!isSpaceAvailable(otherSpace)) {
      settle({ status: 'unavailable', hasUnread: false });
      return;
    }
    // Torneos is only asked once this account used it on this device (no Torneos identity is created for a
    // person who never opened it).
    if (otherSpace === APP_SPACE.TORNEOS && !readSpaceNavigation(userId).torneosVisited) {
      settle({ status: 'unavailable', hasUnread: false });
      return;
    }
    try {
      settle(otherSpace === APP_SPACE.ARMA2 ? await loadCoreUnread(userId) : await loadTorneosUnread());
    } catch {
      settle({ status: 'error', hasUnread: false });
    }
  }, [authResolved, isSpaceAvailable, otherSpace, user?.id]);

  // On entering a product (the other one is re-read), when the app becomes visible again, and every minute.
  useEffect(() => {
    if (!authResolved || !user?.id) return undefined;
    setOtherUnread((current) => (current.space === otherSpace ? current : { ...current, space: otherSpace, value: UNREAD_UNKNOWN }));
    refreshOtherUnread();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshOtherUnread(); };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshOtherUnread();
    }, OTHER_PRODUCT_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authResolved, otherSpace, refreshOtherUnread, user?.id]);

  const otherProductUnread = otherUnread.userId === (user?.id || null) && otherUnread.space === otherSpace
    ? otherUnread.value
    : UNREAD_UNKNOWN;

  const value = useMemo(() => ({
    currentSpace,
    switchSpace,
    isSpaceAvailable,
    torneosAvailable,
    native,
    otherSpace,
    otherProductUnread,
  }), [currentSpace, isSpaceAvailable, native, otherProductUnread, otherSpace, switchSpace, torneosAvailable]);

  return (
    <SpaceNavigationContext.Provider value={value}>
      {children}
    </SpaceNavigationContext.Provider>
  );
}

export function useSpaceNavigation() {
  const context = useContext(SpaceNavigationContext);
  if (!context) throw new Error('useSpaceNavigation must be used inside SpaceNavigationProvider');
  return context;
}
