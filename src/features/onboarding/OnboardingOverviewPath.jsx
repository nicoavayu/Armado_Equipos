import React from 'react';
import OnboardingPathRunner from './OnboardingPathRunner';
import { ONBOARDING_PATHS } from './content';

// "Conocer Arma2": a short visual summary of everything, then closing (CTA
// navigates to the Home).
export default function OnboardingOverviewPath() {
  return <OnboardingPathRunner pathKey={ONBOARDING_PATHS.OVERVIEW} />;
}
