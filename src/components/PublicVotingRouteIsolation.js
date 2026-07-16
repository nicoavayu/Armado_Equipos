import React, { useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

const { isExactPublicVotingPath } = require('../config/publicVotingRoutes');
const {
  isAllowedPublicMatchInviteRequest,
  isExactPublicMatchInvitePath,
} = require('../config/publicMatchInviteRoutes');

const resolvePublicEntryKind = (location) => {
  if (isExactPublicVotingPath(location.pathname)) return 'voting';

  const url = {
    pathname: location.pathname,
    searchParams: new URLSearchParams(location.search),
  };
  if (isAllowedPublicMatchInviteRequest(url)) return 'match-invite';

  return null;
};

const isSamePublicEntry = (entry, location) => {
  if (entry.kind === 'voting') return isExactPublicVotingPath(location.pathname);
  if (entry.kind === 'match-invite') {
    if (!isExactPublicMatchInvitePath(location.pathname)) return false;
    return `${location.pathname}${location.search}${location.hash}` === entry.href;
  }
  return false;
};

const PublicVotingRouteIsolation = ({ children }) => {
  const location = useLocation();
  const isNativeAppRef = useRef(Capacitor.isNativePlatform());
  const publicEntryRef = useRef(null);
  const publicEntryKind = resolvePublicEntryKind(location);

  if (
    !isNativeAppRef.current
    && !publicEntryRef.current
    && publicEntryKind
  ) {
    publicEntryRef.current = {
      href: `${location.pathname}${location.search}${location.hash}`,
      kind: publicEntryKind,
    };
  }

  if (
    publicEntryRef.current
    && !isSamePublicEntry(publicEntryRef.current, location)
  ) {
    return <Navigate to={publicEntryRef.current.href} replace />;
  }

  return children;
};

export default PublicVotingRouteIsolation;
