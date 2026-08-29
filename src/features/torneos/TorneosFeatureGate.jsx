import React, { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import AppLoadingScreen from '../../components/AppLoadingScreen';
import { torneosFeatureFlags } from './config/featureFlags';
import { isArma2NativeRuntime } from '../../utils/runtimePlatform';

const TorneosApp = lazy(() => import('./TorneosApp'));

export default function TorneosFeatureGate({
  enabled = (
    torneosFeatureFlags.torneosEnabled
    && torneosFeatureFlags.workspacesEnabled
  ),
  service,
  native = isArma2NativeRuntime(),
}) {
  if (!enabled) {
    if (native) return <Navigate to="/" replace />;
    return (
      <main
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          color: '#f7f3ff',
          textAlign: 'center',
          background: '#0c0a1d',
        }}
      >
        <div>
          <h1>Arma2 Torneos no está disponible en este entorno</h1>
          <p>Tu sesión no habilita el producto general de Arma2 en navegador.</p>
        </div>
      </main>
    );
  }

  return (
    <Suspense fallback={<AppLoadingScreen />}>
      <TorneosApp service={service} />
    </Suspense>
  );
}
