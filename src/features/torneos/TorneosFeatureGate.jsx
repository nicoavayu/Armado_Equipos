import React, { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import AppLoadingScreen from '../../components/AppLoadingScreen';
import { torneosFeatureFlags } from './config/featureFlags';
import { resolveTorneosBackendMode, resolveTorneosBillingMode, resolveTorneosPlanRead } from './foundation/config';
import { isArma2NativeRuntime } from '../../utils/runtimePlatform';

const TorneosApp = lazy(() => import('./TorneosApp'));
const StagingV1TorneosApp = lazy(() => import('./stagingV1/StagingV1TorneosApp'));

// Resolved once per build, like the flags: which backend composition /torneos
// mounts. `hybrid` is the dual-backend one (gateway); `legacy-local` is the
// single-project LOCAL QA stack; anything else stays closed — a staging or
// preview build without a gateway never serves Torneos from the Core project.
export const torneosBackendMode = resolveTorneosBackendMode(process.env);
// MP-A5: the Premium purchase (Checkout Pro TEST) only for the hybrid composition in the local
// lab — see resolveTorneosBillingMode; `off` everywhere else, whatever a single variable says.
export const torneosBillingMode = resolveTorneosBillingMode(process.env, {
  backendMode: torneosBackendMode,
  appHostname: typeof window === 'undefined' ? null : window.location.hostname,
});

function Closed({ native, backendMode }) {
  if (native) return <Navigate to="/" replace />;
  return (
    <main
      role="alert"
      data-torneos-backend-mode={backendMode.mode}
      data-torneos-backend-reason={backendMode.reason || undefined}
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

export default function TorneosFeatureGate({
  enabled = (
    torneosFeatureFlags.torneosEnabled
    && torneosFeatureFlags.workspacesEnabled
  ),
  backendMode = torneosBackendMode,
  billingMode = torneosBillingMode,
  planRead = resolveTorneosPlanRead(process.env, { backendMode }),
  service,
  native = isArma2NativeRuntime(),
}) {
  if (!enabled) return <Closed native={native} backendMode={backendMode} />;

  // An injected service replaces the backend entirely (tests, local review):
  // the composition is then the legacy one, as before.
  if (!service && backendMode.mode === 'hybrid') {
    return (
      <Suspense fallback={<AppLoadingScreen />}>
        <StagingV1TorneosApp gatewayUrl={backendMode.gatewayUrl} billingMode={billingMode} planRead={planRead} />
      </Suspense>
    );
  }
  if (!service && backendMode.mode !== 'legacy-local') {
    return <Closed native={native} backendMode={backendMode} />;
  }

  return (
    <Suspense fallback={<AppLoadingScreen />}>
      <TorneosApp service={service} />
    </Suspense>
  );
}
