import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useOnboardingOptional } from './OnboardingContext';

// Opens the Perfil-tab tutorial the first time an eligible user lands on Perfil.
// Mounted from the Perfil page only, so it can never fire on other surfaces or in
// the general-flow tests. All idempotence/eligibility guards live in
// openProfileTour (provider), so calling it repeatedly is safe: it self-gates on
// "already seen", "already offered this session", an active flow, or a blocking
// modal. Returns nothing; the tour renders from OnboardingHost.
//
// The origin is derived from navigation state: the onboarding profile step
// navigates here with `{ state: { onboardingProfileTour: true } }`, which scopes
// the "resume the general flow on close" behavior to that single navigation only.
// A manual visit (navbar, direct route) carries no such state → origin 'profile'.
export default function useProfileTourTrigger() {
  const onboarding = useOnboardingOptional();
  const location = useLocation();
  const enabled = onboarding?.enabled;
  const stateLoaded = onboarding?.stateLoaded;
  const openProfileTour = onboarding?.openProfileTour;
  const isActive = onboarding?.isActive;
  const profileTourOpen = onboarding?.profileTourOpen;
  const profileTourSeen = Boolean(onboarding?.state?.checklist?.profileTourSeen);
  const fromOnboarding = Boolean(location?.state?.onboardingProfileTour);

  useEffect(() => {
    if (!enabled || !stateLoaded) return;
    if (isActive || profileTourOpen) return;
    if (profileTourSeen) return;
    openProfileTour?.(fromOnboarding ? 'onboarding' : 'profile');
  }, [enabled, stateLoaded, isActive, profileTourOpen, profileTourSeen, fromOnboarding, openProfileTour]);
}
