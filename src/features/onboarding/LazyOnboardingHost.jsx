import React, { Suspense, lazy, useEffect, useState } from 'react';

import { useOnboarding } from './OnboardingContext';

// The onboarding surfaces bring framer-motion and the step art with them. MainLayout is
// part of the initial bundle, so it mounts this light host instead: the real one is
// downloaded the first time a surface is needed and then stays mounted, so the exit
// animations keep playing exactly as before.
const OnboardingHost = lazy(() => import('./OnboardingHost'));

export default function LazyOnboardingHost() {
  const { activeFlow, profileTourOpen } = useOnboarding();
  const needed = Boolean(activeFlow || profileTourOpen);
  const [mounted, setMounted] = useState(needed);

  useEffect(() => {
    if (needed) setMounted(true);
  }, [needed]);

  if (!mounted && !needed) return null;

  return (
    <Suspense fallback={null}>
      <OnboardingHost />
    </Suspense>
  );
}
