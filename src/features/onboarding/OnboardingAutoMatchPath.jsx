import React from 'react';
import OnboardingPathRunner from './OnboardingPathRunner';
import { ONBOARDING_PATHS } from './content';

// "Partido Automático" recorrido: availability → preferences → matching →
// confirm → closing (CTA navigates to /quiero-jugar?auto=1). Explains Partido
// Automático without changing any of its rules or activating anything.
export default function OnboardingAutoMatchPath(props) {
  return <OnboardingPathRunner pathKey={ONBOARDING_PATHS.AUTO_MATCH} {...props} />;
}
