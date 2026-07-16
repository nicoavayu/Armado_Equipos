import React, { useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

const { isExactPublicVotingPath } = require('../config/publicVotingRoutes.cjs');

const PublicVotingRouteIsolation = ({ children }) => {
  const location = useLocation();
  const isNativeAppRef = useRef(Capacitor.isNativePlatform());
  const votingEntryRef = useRef(null);

  if (
    !isNativeAppRef.current
    && !votingEntryRef.current
    && isExactPublicVotingPath(location.pathname)
  ) {
    votingEntryRef.current = `${location.pathname}${location.search}${location.hash}`;
  }

  if (votingEntryRef.current && !isExactPublicVotingPath(location.pathname)) {
    return <Navigate to={votingEntryRef.current} replace />;
  }

  return children;
};

export default PublicVotingRouteIsolation;
