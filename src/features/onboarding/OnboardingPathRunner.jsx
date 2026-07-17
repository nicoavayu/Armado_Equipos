import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

import { getPathContent, ONBOARDING_PATHS } from './content';
import { PrimaryButton, GhostButton, ProgressDots } from './OnboardingUI';
import OnboardingStepArt from './OnboardingStepArt';
import { useOnboarding } from './OnboardingProvider';
import { onboardingHaptic } from './haptics';

const CLOSING_ART = {
  organizer: 'organizer_closing',
  auto_match: 'auto_closing',
  overview: 'explore_closing',
};

// Shared stepper used by all three path components. Renders the step art, copy,
// progress and navigation, then a closing card whose CTA navigates to a REAL
// existing route (it never creates data or toggles preferences).
export default function OnboardingPathRunner({ pathKey, onFinalStateChange }) {
  const path = getPathContent(pathKey) || getPathContent(ONBOARDING_PATHS.EXPLORE);
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { completeOnboarding, goToGoalSelector } = useOnboarding();
  const [index, setIndex] = useState(0);

  const steps = path.steps;
  const total = steps.length;
  const isSingleScreen = path.singleScreen === true;
  const isClosing = !isSingleScreen && index >= total;
  const isTerminal = isSingleScreen || isClosing;
  const step = isClosing ? null : steps[Math.min(index, total - 1)];

  useEffect(() => {
    onFinalStateChange?.(isTerminal);
  }, [isTerminal, onFinalStateChange]);

  const goNext = () => {
    onboardingHaptic('light');
    setIndex((current) => Math.min(current + 1, total));
  };
  const goPrev = () => {
    if (index === 0) {
      goToGoalSelector();
      return;
    }
    setIndex((current) => Math.max(current - 1, 0));
  };
  const finish = () => {
    onboardingHaptic('medium');
    completeOnboarding(pathKey);
    // Navigate to the real flow. No data is created here.
    navigate(path.closing.cta.route);
  };

  const bodyMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2 } }
    : {
      initial: { opacity: 0, x: 24 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: -24 },
      transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
    };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-onboarding-path={pathKey}>
      <div className="min-h-[18px] pt-1">
        {!isTerminal && (
          <ProgressDots total={total} index={index} label={`Paso ${index + 1} de ${total}`} />
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col justify-center py-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={isClosing ? 'closing' : `step-${index}`} {...bodyMotion} className="flex flex-col items-center text-center">
            {isClosing ? (
              <>
                <div className="mb-4 w-full max-w-[300px]">
                  <OnboardingStepArt name={CLOSING_ART[pathKey] || 'completion'} />
                </div>
                <h2 id="onboarding-path-title" className="max-w-[390px] font-bebas-real text-[clamp(31px,8.8vw,44px)] leading-[0.94] tracking-[0.035em] text-white">
                  {path.closing.title}
                </h2>
                <p className="mt-3 max-w-[330px] font-sans text-[15px] leading-[1.5] text-white/72">
                  {path.closing.description}
                </p>
              </>
            ) : (
              <>
                <div className="mb-4 w-full max-w-[300px]">
                  <OnboardingStepArt name={step.art} />
                </div>
                <h2
                  id="onboarding-path-title"
                  className="max-w-[390px] font-bebas-real text-[clamp(31px,8.8vw,44px)] leading-[0.94] tracking-[0.035em] text-white"
                >
                  {step.title}
                </h2>
                <p className="mt-3 max-w-[340px] font-sans text-[15px] leading-[1.5] text-white/72">
                  {step.description}
                </p>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex shrink-0 items-center gap-3 pt-4">
        <GhostButton onClick={goPrev} className="px-4" aria-label="Anterior">
          Anterior
        </GhostButton>
        {isTerminal ? (
          <PrimaryButton onClick={finish} className="flex-1" data-onboarding-action="finish">
            {path.closing.cta.label}
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={goNext} className="flex-1" data-onboarding-action="next">
            Siguiente
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}
