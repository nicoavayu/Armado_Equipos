import React from 'react';
import { useNavigate } from 'react-router-dom';

import { useOnboardingOptional } from './OnboardingContext';
import { onboardingHaptic } from './haptics';

// "Conocer Arma2" — the manual replay entry from Perfil → Ayuda. Renders
// nothing when there is no onboarding provider (e.g. ProfileEditor in a test)
// or when the feature is disabled for the user. Navigates to the Home so the
// flow opens over a safe surface.
export default function OnboardingReplayButton({ className = '', onActivate }) {
  const onboarding = useOnboardingOptional();
  const navigate = useNavigate();

  if (!onboarding || !onboarding.enabled) return null;
  const canShowFirstSteps = Boolean(
    onboarding.state?.chosenPath
    && !onboarding.state?.checklist?.completionShown
    && !onboarding.state?.checklist?.celebrated,
  );

  const handleClick = () => {
    onboardingHaptic('light');
    if (typeof onActivate === 'function') onActivate();
    navigate('/');
    // Defer so the Home mounts before the overlay opens.
    setTimeout(() => onboarding.replayOnboarding(), 0);
  };

  const handleFirstSteps = () => {
    onboardingHaptic('light');
    if (typeof onActivate === 'function') onActivate();
    navigate('/');
    setTimeout(() => onboarding.showFirstSteps(), 0);
  };

  const buttonClass = `w-full h-[50px] rounded-none border border-[rgba(148,134,255,0.28)] bg-white/[0.05] text-white/90 text-[15px] font-sans font-semibold tracking-[0.01em] normal-case cursor-pointer transition-all hover:bg-white/[0.1] hover:text-white active:opacity-95 flex items-center justify-center ${className}`;

  return (
    <div className="flex w-full flex-col gap-3">
      <button type="button" onClick={handleClick} className={buttonClass} data-onboarding-cta="true" data-preserve-button-case="true">
        Conocer Arma2
      </button>
      {canShowFirstSteps && (
        <button type="button" onClick={handleFirstSteps} className={buttonClass} data-onboarding-cta="true" data-preserve-button-case="true">
          Ver primeros pasos
        </button>
      )}
    </div>
  );
}
