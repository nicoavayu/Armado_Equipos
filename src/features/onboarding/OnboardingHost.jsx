import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';

import { useOnboarding } from './OnboardingProvider';
import OnboardingFlow from './OnboardingFlow';
import OnboardingIntroModal from './OnboardingIntroModal';

// Mounts the fullscreen onboarding overlay via a portal to <body> so it sits
// above the app shell and TabBar. Renders nothing when no flow is active, and a
// render error here is contained so it can never break the app underneath.
class OnboardingErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // Swallow: onboarding is non-critical. The app keeps working without it.
    if (typeof window !== 'undefined' && window.console) {
      // eslint-disable-next-line no-console
      window.console.warn('[ONBOARDING] flow render error (contained):', error?.message || error);
    }
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default function OnboardingHost() {
  const {
    activeFlow,
    goToGoalSelector,
    skipOnboarding,
  } = useOnboarding();

  if (typeof document === 'undefined') return null;

  let surface = null;
  if (activeFlow?.screen === 'intro') {
    surface = <OnboardingIntroModal key="intro" onStart={goToGoalSelector} onDismiss={skipOnboarding} />;
  } else if (activeFlow) {
    surface = <OnboardingFlow key="onboarding-flow" />;
  }

  return createPortal(
    <OnboardingErrorBoundary>
      <AnimatePresence mode="wait">
        {surface}
      </AnimatePresence>
    </OnboardingErrorBoundary>,
    document.body,
  );
}
