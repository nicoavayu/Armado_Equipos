import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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
//
// That marker is a ONE-SHOT: `location.state` rides a single history entry, so if
// we left it in place a browser back/forward — or an in-place account switch that
// keeps the user on the same /profile entry — would reopen the tour as an
// onboarding continuation for the wrong user. So once the origin has been captured
// by the provider we consume the marker exactly once, removing ONLY that key with
// a `replace` navigation and preserving the pathname, query string, hash and any
// other legitimate location.state.
export default function useProfileTourTrigger() {
  const onboarding = useOnboardingOptional();
  const location = useLocation();
  const navigate = useNavigate();
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

    // Capture the origin in the provider FIRST. openProfileTour self-gates on
    // "already seen" / "already offered this session" / a blocking modal, so
    // calling it when the tour shouldn't open is a safe no-op — the marker is
    // still consumed below so it can never leak to a later visit.
    if (!profileTourSeen) {
      openProfileTour?.(fromOnboarding ? 'onboarding' : 'profile');
    }

    // Consume the one-shot onboarding marker exactly once, AFTER the origin has
    // been captured (clearing it earlier would turn this very open into a manual
    // 'profile' entry before the provider received 'onboarding'). Strip ONLY the
    // onboardingProfileTour key; keep everything else on the entry so query
    // string, hash and any sibling state survive, and use `replace` so no new
    // history entry is created and the current one no longer carries the marker.
    if (fromOnboarding) {
      const nextState = { ...(location.state || {}) };
      delete nextState.onboardingProfileTour;
      const hasResidualState = Object.keys(nextState).length > 0;
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: hasResidualState ? nextState : null },
      );
    }
  }, [
    enabled,
    stateLoaded,
    isActive,
    profileTourOpen,
    profileTourSeen,
    fromOnboarding,
    openProfileTour,
    navigate,
    location.pathname,
    location.search,
    location.hash,
    location.state,
  ]);
}
