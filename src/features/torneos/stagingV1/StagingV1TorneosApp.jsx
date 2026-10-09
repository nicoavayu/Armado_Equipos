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
// surfaces. `test` or `production` → the purchase feature overlay, a service with the commerce scope and
// its commerce for the Plan pages. Anything else → the static map, a service without
// commercial aliases and disabled commerce. `planRead` independently preserves
// the certified entitlement reads. `social` (SOCIAL-V1, resolved by the gate: hybrid + PLAN READ + the
// production-eligible flag) adds the Estudio Social feature and its three aliases, together or not at all.
// `connected` (CONNECTED-V1, resolved by the gate: hybrid + REACT_APP_TORNEOS_CONNECTED_MODE=on) adds the connected
// product's features and aliases, together or not at all. `branding` (BRANDING-V1: hybrid +
// REACT_APP_TORNEOS_BRANDING_MODE=on) adds logo/shield upload and the branding context, together or not at all.
// `media` (MEDIA-V1: hybrid + REACT_APP_TORNEOS_MEDIA_MODE=on + the media flag) adds the photo galleries — the
// organizer's Centro Multimedia, gateway uploads and the participant galleries — together or not at all.
export default function StagingV1TorneosApp({
  gatewayUrl,
  service = null,
  features = null,
  billingMode = 'off',
  planRead = false,
  social = false,
  connected = false,
  branding = false,
  media = false,
  checkoutRedirect = null,
}) {
  const connectedEnabled = connected === true;
  const brandingEnabled = branding === true;
  const mediaEnabled = media === true;
  const socialEnabled = social === true && planRead === true;
  // MP-A5 `test` (local lab) or COMMERCE-PRODUCTION `production` (the production web app): the same surfaces, the
  // commerce only labels which one it is. Anything else: no purchase at all.
  const resolvedBilling = typeof billingMode === 'string' ? billingMode : billingMode?.mode;
  const billing = resolvedBilling === 'test' || resolvedBilling === 'production';
  const billingEnvironment = resolvedBilling === 'production' ? 'production' : 'test';
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
    setRuntime({ transport, service: createStagingV1WorkspaceService({
      transport, commerce: billing, planRead, social: socialEnabled, connected: connectedEnabled, branding: brandingEnabled,
      media: mediaEnabled,
    }) });
    return () => {
      transport.dispose();
      setRuntime((current) => (current?.transport === transport ? null : current));
    };
  }, [billing, gatewayUrl, service, planRead, socialEnabled, connectedEnabled, brandingEnabled, mediaEnabled]);

  // Keyed on the service itself so the providers keep one identity per service.
  const runtimeService = runtime?.service || null;
  const composition = useMemo(() => {
    if (!runtimeService) return null;
    const workspaceService = billing ? runtimeService : withoutCommerce(runtimeService, { planRead });
    const commerce = billing
      ? createStagingV1Commerce(runtimeService, { redirect: checkoutRedirect, environment: billingEnvironment }) || disabledCommerce
      : disabledCommerce;
    return { workspaceService, commerce };
  }, [billing, billingEnvironment, checkoutRedirect, runtimeService, planRead]);

  if (!composition) return <AppLoadingScreen />;

  return (
    <TorneosFeaturesProvider features={features || stagingV1FeaturesFor(billing ? billingEnvironment : 'off', {
      planRead, social: socialEnabled, connected: connectedEnabled, branding: brandingEnabled, media: mediaEnabled,
    })}>
      <TorneosCommerceProvider commerce={composition.commerce}>
        <TorneosWorkspaceProvider service={composition.workspaceService}>
          <TorneosShell />
        </TorneosWorkspaceProvider>
      </TorneosCommerceProvider>
    </TorneosFeaturesProvider>
  );
}
