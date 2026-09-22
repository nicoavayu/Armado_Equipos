import React, { createContext, useContext } from 'react';
import { legacyFeatures } from '../stagingV1/stagingV1Features';

// Which product surfaces the mounted composition offers. The legacy composition
// never sets it, so every consumer sees everything on and behaves exactly as
// before; the staging-v1 composition provides its static map and the gated
// screens stop mounting (and requesting) what the gateway does not serve.
const TorneosFeaturesContext = createContext(legacyFeatures);

export function TorneosFeaturesProvider({ features, children }) {
  return (
    <TorneosFeaturesContext.Provider value={features || legacyFeatures}>
      {children}
    </TorneosFeaturesContext.Provider>
  );
}

export function useTorneosFeatures() {
  return useContext(TorneosFeaturesContext);
}

export function useTorneosFeature(name) {
  const features = useContext(TorneosFeaturesContext);
  return features[name] !== false;
}
