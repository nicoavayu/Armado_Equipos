import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { welcomeContent } from './content';
import { onboardingHaptic } from './haptics';
import OnboardingModal from './OnboardingModal';
import OnboardingStepArt from './OnboardingStepArt';
import { GhostButton, PrimaryButton } from './OnboardingUI';

export default function OnboardingIntroModal({ onStart, onDismiss }) {
  const reduce = useReducedMotion();
  const reveal = (delay) => ({
    initial: reduce ? { opacity: 1 } : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0 : 0.36, delay: reduce ? 0 : delay, ease: [0.16, 1, 0.3, 1] },
  });

  return (
    <OnboardingModal
      labelledById="onboarding-intro-title"
      describedById="onboarding-intro-description"
      onClose={onDismiss}
    >
      <div className="flex flex-col items-center pb-0 pt-2 text-center">
        <motion.div {...reveal(0.02)} className="mb-3 w-full max-w-[330px]">
          <OnboardingStepArt name="intro" />
        </motion.div>
        <motion.h1
          id="onboarding-intro-title"
          {...reveal(0.08)}
          data-onboarding-intro-single-line="true"
          className="whitespace-nowrap font-bebas-real text-[clamp(27px,8.4vw,42px)] leading-none tracking-[0.018em] text-white"
        >
          {welcomeContent.title}
        </motion.h1>
        <motion.p
          id="onboarding-intro-description"
          {...reveal(0.14)}
          className="mt-3 max-w-[340px] font-sans text-[14.5px] leading-[1.5] text-white/72"
        >
          {welcomeContent.description}
        </motion.p>
        <motion.div {...reveal(0.2)} className="mt-6 flex w-full flex-col gap-2.5">
          <PrimaryButton onClick={() => { onboardingHaptic('medium'); onStart(); }}>
            {welcomeContent.primaryCta}
          </PrimaryButton>
          <GhostButton onClick={onDismiss} className="w-full border-0 bg-transparent text-white/58">
            {welcomeContent.secondaryCta}
          </GhostButton>
        </motion.div>
      </div>
    </OnboardingModal>
  );
}
