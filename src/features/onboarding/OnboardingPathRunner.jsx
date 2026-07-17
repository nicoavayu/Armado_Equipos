import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Check,
} from 'lucide-react';

import { getPathContent } from './content';
import { PrimaryButton, GhostButton, ProgressDots } from './OnboardingUI';
import OnboardingStepArt from './OnboardingStepArt';
import { useOnboarding } from './OnboardingProvider';
import { onboardingHaptic } from './haptics';

const CLOSING_ART = {
  organizer: 'record',
  auto_match: 'confirm',
  overview: 'explore_matches',
};

// Shared stepper used by all three path components. Renders the step art, copy,
// progress and navigation, then a closing card whose CTA navigates to a REAL
// existing route (it never creates data or toggles preferences).
export default function OnboardingPathRunner({ pathKey }) {
  const path = getPathContent(pathKey);
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { completeOnboarding, goToGoalSelector } = useOnboarding();
  const [index, setIndex] = useState(0);

  if (!path) return null;

  const steps = path.steps;
  const total = steps.length;
  const isClosing = index >= total;
  const step = isClosing ? null : steps[index];

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
    completeOnboarding();
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
      <div className="pt-1">
        {isClosing ? (
          <div className="flex items-center gap-2 text-[#35d07f]">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#35d07f]/15">
              <Check size={15} strokeWidth={3} aria-hidden />
            </span>
            <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.14em]">Completado</span>
          </div>
        ) : (
          <ProgressDots total={total} index={index} label={`Paso ${index + 1} de ${total}`} />
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col justify-center py-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={isClosing ? 'closing' : `step-${index}`} {...bodyMotion} className="flex flex-col items-center text-center">
            {isClosing ? (
              <>
                <div className="mb-5 w-full max-w-[280px]">
                  <OnboardingStepArt name={CLOSING_ART[pathKey] || 'completion'} />
                </div>
                <h2 id="onboarding-path-title" className="max-w-[350px] font-bebas-real text-[clamp(34px,9.5vw,44px)] leading-[0.94] tracking-[0.035em] text-white">
                  {path.closing.title}
                </h2>
                <p className="mt-3 max-w-[330px] font-sans text-[15px] leading-[1.5] text-white/72">
                  {path.closing.description}
                </p>
              </>
            ) : (
              <>
                <div className="mb-6 w-full max-w-[280px]">
                  <OnboardingStepArt name={step.art} />
                </div>
                <h2
                  id="onboarding-path-title"
                  className="max-w-[350px] font-bebas-real text-[clamp(34px,9.5vw,44px)] leading-[0.94] tracking-[0.035em] text-white"
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
          <ChevronLeft size={18} aria-hidden />
          <span className="ml-1">Anterior</span>
        </GhostButton>
        {isClosing ? (
          <PrimaryButton onClick={finish} className="flex-1" data-onboarding-action="finish">
            {path.closing.cta.label}
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={goNext} className="flex-1" data-onboarding-action="next">
            Siguiente
            <ChevronRight size={18} className="ml-1" aria-hidden />
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}
