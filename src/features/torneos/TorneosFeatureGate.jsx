import React, { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import AppLoadingScreen from '../../components/AppLoadingScreen';
import { torneosFeatureFlags } from './config/featureFlags';

const TorneosApp = lazy(() => import('./TorneosApp'));

export default function TorneosFeatureGate({
  enabled = torneosFeatureFlags.torneosEnabled,
}) {
  if (!enabled) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<AppLoadingScreen />}>
      <TorneosApp />
    </Suspense>
  );
}
