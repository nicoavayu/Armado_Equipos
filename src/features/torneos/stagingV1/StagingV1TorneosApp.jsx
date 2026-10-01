import React, { useEffect, useMemo, useState } from 'react';
import AppLoadingScreen from '../../../components/AppLoadingScreen';
import { TorneosWorkspaceProvider } from '../context/TorneosWorkspaceContext';
import { TorneosFeaturesProvider } from '../context/TorneosFeaturesContext';
import { TorneosCommerceProvider, disabledCommerce } from '../context/TorneosCommerceContext';
import TorneosShell from '../components/TorneosShell';
import { createTorneosTransport } from '../foundation/torneosTransport';
import { createCoreSessionBridge } from './coreSessionBridge';
import {
  createStagingV1Commerce,
  createStagingV1WorkspaceService,
  withoutCommerce,
} from './stagingV1WorkspaceService';
import { stagingV1FeaturesFor } from './stagingV1Features';

// The hybrid composition of /torneos: Core session → exchange → staging-v1
// adapter. It never mounts TorneosApp (whose default service is the Core
// singleton) and never falls back to it: without a gateway URL this component
// is not rendered at all (see TorneosFeatureGate).
//
// The transport is born and disposed inside one effect: its lifetime is the
// mount, so StrictMode's simulated unmount (dispose) is followed by a fresh
// transport instead of a disposed one being reused.
//
// MP-A5: `billingMode` (resolved by the gate, fail-closed) decides the commerce
// surfaces. `test` → the TEST feature overlay, a service with the commerce scope and
// its commerce for the Plan pages. Anything else → the static map, a service without
// any commerce alias and the disabled commerce: never the legacy one.
export default function StagingV1TorneosApp({
  gatewayUrl,
  service = null,
  features = null,
  billingMode = 'off',
  planRead = false,
  checkoutRedirect = null,
}) {
  const billing = (typeof billingMode === 'string' ? billingMode : billingMode?.mode) === 'test';
  const [runtime, setRuntime] = useState(() => (service ? { transport: null, service } : null));

  useEffect(() => {
    if (service) {
      setRuntime({ transport: null, service });
      return undefined;
    }
    const bridge = createCoreSessionBridge();
    const transport = createTorneosTransport({
      gatewayUrl,
      getCoreAccessToken: bridge.getCoreAccessToken,
      onCoreAuthChange: bridge.onCoreAuthChange,
    });
    setRuntime({ transport, service: createStagingV1WorkspaceService({ transport, commerce: billing, planRead }) });
    return () => {
      transport.dispose();
      setRuntime((current) => (current?.transport === transport ? null : current));
    };
  }, [billing, gatewayUrl, service, planRead]);

  // Keyed on the service itself so the providers keep one identity per service.
  const runtimeService = runtime?.service || null;
  const composition = useMemo(() => {
    if (!runtimeService) return null;
    const workspaceService = billing ? runtimeService : withoutCommerce(runtimeService, { planRead });
    const commerce = billing
      ? createStagingV1Commerce(runtimeService, { redirect: checkoutRedirect }) || disabledCommerce
      : disabledCommerce;
    return { workspaceService, commerce };
  }, [billing, checkoutRedirect, runtimeService, planRead]);

  if (!composition) return <AppLoadingScreen />;

  return (
    <TorneosFeaturesProvider features={features || stagingV1FeaturesFor(billing ? 'test' : 'off')}>
      <TorneosCommerceProvider commerce={composition.commerce}>
        <TorneosWorkspaceProvider service={composition.workspaceService}>
          <TorneosShell />
        </TorneosWorkspaceProvider>
      </TorneosCommerceProvider>
    </TorneosFeaturesProvider>
  );
}
