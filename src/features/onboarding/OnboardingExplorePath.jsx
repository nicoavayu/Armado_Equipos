import React from 'react';
import OnboardingPathRunner from './OnboardingPathRunner';
import { ONBOARDING_PATHS } from './content';

// "Explorar para jugar": partidos disponibles → jugadores disponibles →
// Jugar. It intentionally stays distinct from Partido Automático.
export default function OnboardingExplorePath(props) {
  return <OnboardingPathRunner pathKey={ONBOARDING_PATHS.EXPLORE} {...props} />;
}
