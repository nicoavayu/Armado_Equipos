import React from 'react';

import { useOnboarding } from './OnboardingProvider';
import { ONBOARDING_PATHS } from './content';
import OnboardingShell from './OnboardingShell';
import OnboardingWelcome from './OnboardingWelcome';
import OnboardingGoalSelector from './OnboardingGoalSelector';
import OnboardingOrganizerPath from './OnboardingOrganizerPath';
import OnboardingAutoMatchPath from './OnboardingAutoMatchPath';
import OnboardingOverviewPath from './OnboardingOverviewPath';

const PATH_COMPONENTS = {
  [ONBOARDING_PATHS.ORGANIZER]: OnboardingOrganizerPath,
  [ONBOARDING_PATHS.AUTO_MATCH]: OnboardingAutoMatchPath,
  [ONBOARDING_PATHS.OVERVIEW]: OnboardingOverviewPath,
};

const BrandEyebrow = () => (
  <span className="font-sans text-[11px] font-bold uppercase tracking-[0.22em] text-[#b0a0ff]/70">
    ARMA2
  </span>
);

// Orchestrates the fullscreen onboarding: welcome → goal selector → chosen path.
// Rendered by OnboardingHost only when a flow is active.
export default function OnboardingFlow() {
  const {
    activeFlow,
    goToGoalSelector,
    goToWelcome,
    chooseGoal,
    skipOnboarding,
  } = useOnboarding();

  if (!activeFlow) return null;

  const { screen, path } = activeFlow;

  if (screen === 'welcome') {
    return (
      <OnboardingShell
        onSkip={skipOnboarding}
        labelledById="onboarding-welcome-title"
        describedById="onboarding-welcome-desc"
        header={<BrandEyebrow />}
      >
        <OnboardingWelcome
          labelledById="onboarding-welcome-title"
          describedById="onboarding-welcome-desc"
          onStart={goToGoalSelector}
          onDismiss={skipOnboarding}
        />
      </OnboardingShell>
    );
  }

  if (screen === 'goal') {
    return (
      <OnboardingShell
        onSkip={skipOnboarding}
        labelledById="onboarding-goal-title"
        header={<BrandEyebrow />}
      >
        <OnboardingGoalSelector
          labelledById="onboarding-goal-title"
          onSelect={chooseGoal}
          onBack={goToWelcome}
        />
      </OnboardingShell>
    );
  }

  // screen === 'path'
  const PathComponent = PATH_COMPONENTS[path] || OnboardingOverviewPath;
  return (
    <OnboardingShell
      onSkip={skipOnboarding}
      labelledById="onboarding-path-title"
      header={<BrandEyebrow />}
    >
      <PathComponent />
    </OnboardingShell>
  );
}
