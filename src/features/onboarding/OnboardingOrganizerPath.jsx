import React from 'react';
import OnboardingPathRunner from './OnboardingPathRunner';
import { ONBOARDING_PATHS } from './content';

// "Organizar un partido" recorrido: create → invite → evaluate → teams →
// record → closing (CTA navigates to /nuevo-partido).
export default function OnboardingOrganizerPath() {
  return <OnboardingPathRunner pathKey={ONBOARDING_PATHS.ORGANIZER} />;
}
