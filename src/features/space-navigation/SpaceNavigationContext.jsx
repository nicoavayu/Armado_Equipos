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
import {
  APP_SPACE,
  SPACE_FALLBACK_ROUTE,
  getSpaceFromPath,
  getValidRouteForSpace,
  readSpaceNavigation,
  rememberSpaceRoute,
  writeSpaceNavigation,
} from './spaceNavigation';

const SpaceNavigationContext = createContext(null);

function isCanonicalOpening(location) {
  return location.pathname === '/' && !location.search && !location.hash;
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

    if (isCanonicalOpening(location)) {
      if (isSpaceAvailable(APP_SPACE.ARMA2)) {
        setOpeningSettled(true);
        return;
      }
      const preference = readSpaceNavigation(user.id);
      const preferredRoute = getValidRouteForSpace(
        APP_SPACE.TORNEOS,
        preference.lastRoute?.[APP_SPACE.TORNEOS],
      ) || SPACE_FALLBACK_ROUTE[APP_SPACE.TORNEOS];

      if (isSpaceAvailable(APP_SPACE.TORNEOS) && preferredRoute !== location.pathname) {
        navigate(preferredRoute, { replace: true });
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

  useEffect(() => {
    if (!authResolved || !user?.id || !openingSettled) return;
    if (location.search || location.hash) return;
    rememberSpaceRoute(user.id, location.pathname);
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

  const value = useMemo(() => ({
    currentSpace,
    switchSpace,
    isSpaceAvailable,
    torneosAvailable,
    native,
  }), [currentSpace, isSpaceAvailable, native, switchSpace, torneosAvailable]);

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
