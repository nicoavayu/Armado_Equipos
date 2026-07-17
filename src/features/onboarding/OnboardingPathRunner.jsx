import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Check, Users, Share2, Scale, History,
} from 'lucide-react';

import { getPathContent } from './content';
import { PrimaryButton, GhostButton, ProgressDots } from './OnboardingUI';
import OnboardingStepArt from './OnboardingStepArt';
import { useOnboarding } from './OnboardingProvider';
import { onboardingHaptic } from './haptics';

const BULLET_ICONS = { Users, Share2, Scale, History };

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

      <div className="relative flex min-h-0 flex-1 flex-col justify-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={isClosing ? 'closing' : `step-${index}`} {...bodyMotion} className="flex flex-col items-center text-center">
            {isClosing ? (
              <>
                <div className="mb-6 flex h-[150px] w-[150px] items-center justify-center">
                  <div className="relative flex h-[132px] w-[132px] items-center justify-center rounded-full bg-[radial-gradient(circle,rgba(53,208,127,0.22),transparent_66%)]">
                    <span className="inline-flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-[#35d07f] bg-[#101a14]">
                      <Check size={40} strokeWidth={3} className="text-[#35d07f]" aria-hidden />
                    </span>
                  </div>
                </div>
                <h2 className="font-oswald text-[26px] font-bold leading-tight text-white sm:text-[28px]">
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
                <h2 className="font-oswald text-[24px] font-bold leading-tight text-white sm:text-[26px]">
                  {step.title}
                </h2>
                <p className="mt-3 max-w-[340px] font-sans text-[15px] leading-[1.5] text-white/72">
                  {step.description}
                </p>

                {Array.isArray(step.bullets) && (
                  <ul className="mt-6 w-full max-w-[360px] space-y-2.5 text-left">
                    {step.bullets.map((bullet) => {
                      const BulletIcon = BULLET_ICONS[bullet.icon] || Check;
                      return (
                        <li key={bullet.text} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(140deg,rgba(139,92,255,0.32),rgba(106,67,255,0.12))] text-[#cfc4ff]">
                            <BulletIcon size={16} strokeWidth={2} aria-hidden />
                          </span>
                          <span className="font-sans text-[13.5px] leading-snug text-white/85">{bullet.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3 pt-4">
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
