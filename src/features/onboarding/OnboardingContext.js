import { createContext, useContext } from 'react';

// Lightweight context module: no heavy imports (no AuthProvider / capacitor), so
// leaf surfaces (coach marks, manual replay) can consume onboarding without
// pulling the whole provider chain into their bundle or their tests.
export const OnboardingContext = createContext(null);

export const useOnboarding = () => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return ctx;
};

// Non-throwing accessor for components that may render outside the provider
// (e.g. ProfileEditor in isolation). Returns null when there is no provider.
export const useOnboardingOptional = () => useContext(OnboardingContext);
