// Public surface of the onboarding feature. Import from here.
export { default as OnboardingProvider, useOnboarding } from './OnboardingProvider';
export { default as OnboardingHost } from './OnboardingHost';
export { default as OnboardingFlow } from './OnboardingFlow';
export { default as OnboardingIntroModal } from './OnboardingIntroModal';
export { default as OnboardingGoalSelector } from './OnboardingGoalSelector';
export { default as OnboardingOrganizerPath } from './OnboardingOrganizerPath';
export { default as OnboardingAutoMatchPath } from './OnboardingAutoMatchPath';
export { default as OnboardingExplorePath } from './OnboardingExplorePath';
export { default as OnboardingCoachMark } from './OnboardingCoachMark';
export { default as OnboardingReplayButton } from './OnboardingReplayButton';
export { useOnboardingOptional } from './OnboardingProvider';

export { useCoachMarks } from './useCoachMarks';

export {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_LAUNCH_CUTOFF,
  ONBOARDING_PATHS,
  ONBOARDING_STATUS,
} from './content';
export {
  resolveOnboardingDecision,
  isOnboardingEnabledForUser,
  isNewAccount,
  getOnboardingRollout,
  getOnboardingAllowlist,
} from './eligibility';
