import React, { useCallback, useEffect, useState } from 'react';

import { useOnboarding } from './OnboardingProvider';
import { ONBOARDING_PATHS } from './content';
import OnboardingShell from './OnboardingShell';
import OnboardingGoalSelector from './OnboardingGoalSelector';
import OnboardingOrganizerPath from './OnboardingOrganizerPath';
import OnboardingAutoMatchPath from './OnboardingAutoMatchPath';
import OnboardingExplorePath from './OnboardingExplorePath';
import OnboardingPathRunner from './OnboardingPathRunner';

const PATH_COMPONENTS = {
  [ONBOARDING_PATHS.ORGANIZER]: OnboardingOrganizerPath,
  [ONBOARDING_PATHS.AUTO_MATCH]: OnboardingAutoMatchPath,
  [ONBOARDING_PATHS.EXPLORE]: OnboardingExplorePath,
};

// Orchestrates only the fullscreen portion: goal selector → chosen path. The
// intro is a real modal rendered by OnboardingHost over the untouched Home.
// Rendered by OnboardingHost only when a flow is active.
export default function OnboardingFlow() {
  const {
    activeFlow,
    chooseGoal,
    completeOnboarding,
    skipOnboarding,
  } = useOnboarding();
  const [isFinalScreen, setIsFinalScreen] = useState(false);

  const activePath = activeFlow?.path || null;
  useEffect(() => setIsFinalScreen(false), [activePath]);
  const handleFinalStateChange = useCallback((value) => setIsFinalScreen(Boolean(value)), []);

  if (!activeFlow) return null;

  const { screen, path } = activeFlow;

  if (screen === 'goal') {
    return (
      <OnboardingShell
        onDismiss={skipOnboarding}
        dismissLabel="Omitir tutorial"
        labelledById="onboarding-goal-title"
      >
        <OnboardingGoalSelector
          labelledById="onboarding-goal-title"
          onSelect={chooseGoal}
        />
      </OnboardingShell>
    );
  }

  // screen === 'path'
  const PathComponent = PATH_COMPONENTS[path] || null;
  return (
    <OnboardingShell
      onDismiss={isFinalScreen ? () => completeOnboarding(path) : skipOnboarding}
      dismissLabel={isFinalScreen ? 'Cerrar' : 'Omitir tutorial'}
      labelledById="onboarding-path-title"
    >
      {PathComponent ? (
        <PathComponent onFinalStateChange={handleFinalStateChange} />
      ) : (
        <OnboardingPathRunner pathKey={path} onFinalStateChange={handleFinalStateChange} />
      )}
    </OnboardingShell>
  );
}
