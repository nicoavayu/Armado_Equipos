import React, { useEffect, useState } from 'react';
import AppLoadingScreen from '../../../components/AppLoadingScreen';
import { TorneosWorkspaceProvider } from '../context/TorneosWorkspaceContext';
import { TorneosFeaturesProvider } from '../context/TorneosFeaturesContext';
import TorneosShell from '../components/TorneosShell';
import { createTorneosTransport } from '../foundation/torneosTransport';
import { createCoreSessionBridge } from './coreSessionBridge';
import { createStagingV1WorkspaceService } from './stagingV1WorkspaceService';
import { stagingV1Features } from './stagingV1Features';

// The hybrid composition of /torneos: Core session → exchange → staging-v1
// adapter. It never mounts TorneosApp (whose default service is the Core
// singleton) and never falls back to it: without a gateway URL this component
// is not rendered at all (see TorneosFeatureGate).
//
// The transport is born and disposed inside one effect: its lifetime is the
// mount, so StrictMode's simulated unmount (dispose) is followed by a fresh
// transport instead of a disposed one being reused.
export default function StagingV1TorneosApp({
  gatewayUrl,
  service = null,
  features = stagingV1Features,
}) {
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
    setRuntime({ transport, service: createStagingV1WorkspaceService({ transport }) });
    return () => {
      transport.dispose();
      setRuntime((current) => (current?.transport === transport ? null : current));
    };
  }, [gatewayUrl, service]);

  if (!runtime) return <AppLoadingScreen />;

  return (
    <TorneosFeaturesProvider features={features}>
      <TorneosWorkspaceProvider service={runtime.service}>
        <TorneosShell />
      </TorneosWorkspaceProvider>
    </TorneosFeaturesProvider>
  );
}
