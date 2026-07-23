import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

import { profileStepContent } from './content';
import { onboardingHaptic } from './haptics';
import { useOnboarding } from './OnboardingProvider';
import OnboardingStepArt from './OnboardingStepArt';
import { GhostButton, PrimaryButton } from './OnboardingUI';

// First recommended step of the general onboarding: invites the user to complete
// their profile before choosing what to do. The primary CTA navigates to Perfil
// (where the Perfil tour then auto-opens); the discreet secondary continues to
// the goal selector. Neither forces profile completion.
export default function OnboardingProfileStep({ labelledById }) {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const { startProfileFromOnboarding, continueFromProfileStep } = useOnboarding();

  const reveal = (delay) => ({
    initial: reduce ? { opacity: 1 } : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0 : 0.36, delay: reduce ? 0 : delay, ease: [0.16, 1, 0.3, 1] },
  });

  const handleComplete = () => {
    onboardingHaptic('medium');
    // Close the flow first, then land on Perfil so the tour opens over it. The
    // navigation-scoped `onboardingProfileTour` flag tells the tour it was opened
    // from onboarding, so it resumes the goal selector on close. It travels with
    // this single navigation only — a later manual visit to Perfil won't carry it.
    startProfileFromOnboarding();
    navigate('/profile', { state: { onboardingProfileTour: true } });
  };

  const handleContinue = () => {
    onboardingHaptic('light');
    continueFromProfileStep();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center" data-onboarding-profile-step="true">
      <div className="flex flex-col items-center text-center">
        <motion.div {...reveal(0.02)} className="mb-4 w-full max-w-[300px]">
          <OnboardingStepArt name="profile" />
        </motion.div>
        <motion.h2
          id={labelledById}
          {...reveal(0.08)}
          className="max-w-[390px] font-bebas-real text-[clamp(31px,8.8vw,44px)] leading-[0.94] tracking-[0.035em] text-white"
        >
          {profileStepContent.title}
        </motion.h2>
        <motion.p {...reveal(0.14)} className="mt-3 max-w-[340px] font-sans text-[15px] leading-[1.5] text-white/72">
          {profileStepContent.description}
        </motion.p>
        <motion.p {...reveal(0.18)} className="mt-2 max-w-[330px] font-sans text-[12.5px] leading-[1.45] text-white/50">
          {profileStepContent.secondary}
        </motion.p>
      </div>

      <motion.div {...reveal(0.24)} className="mt-7 flex w-full flex-col gap-2.5">
        <PrimaryButton onClick={handleComplete} data-onboarding-action="complete-profile">
          {profileStepContent.primaryCta}
        </PrimaryButton>
        <GhostButton
          onClick={handleContinue}
          className="w-full border-0 bg-transparent text-white/58"
          data-onboarding-action="skip-profile"
        >
          {profileStepContent.secondaryCta}
        </GhostButton>
      </motion.div>
    </div>
  );
}
