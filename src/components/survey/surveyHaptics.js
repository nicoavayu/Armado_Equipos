// Light tap feedback for survey choices: native haptics in the app, vibration on Android
// web, nothing elsewhere. Shared with onboarding (same guarded wrapper).
export { onboardingHaptic as surveyHaptic } from '../../features/onboarding/haptics';
