import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { welcomeContent } from './content';
import { PrimaryButton, GhostButton } from './OnboardingUI';
import { onboardingHaptic } from './haptics';

// First screen of the flow. Fullscreen hero with the pitch/ball mark, the
// headline and the primary/secondary actions.
export default function OnboardingWelcome({ onStart, onDismiss, labelledById, describedById }) {
  const reduce = useReducedMotion();

  const rise = (delay) => (reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3, delay: 0 } }
    : {
      initial: { opacity: 0, y: 18 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] },
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
        <motion.div {...rise(0.02)} className="mb-8">
          <div className="relative mx-auto flex h-[128px] w-[128px] items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(139,92,255,0.35),transparent_65%)]" />
            <svg viewBox="0 0 120 120" className="relative h-[120px] w-[120px]" aria-hidden>
              <circle cx="60" cy="60" r="46" fill="#120e28" stroke="url(#welcome-ring)" strokeWidth="3" />
              <defs>
                <linearGradient id="welcome-ring" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#8b5cff" />
                  <stop offset="1" stopColor="#ec007d" />
                </linearGradient>
              </defs>
              <path d="M60 30l7 5-2.7 8.3h-8.6L53 35z" fill="#8b7cff" />
              <path
                d="M60 34l4.7 3.4-1.8 5.5h-5.8l-1.8-5.5z M42 52l6-1.6 3.4 4.7-3 5.2-6.2-.2z M78 52l-6-1.6-3.4 4.7 3 5.2 6.2-.2z M51 74l3.4-5h11.2l3.4 5-4.6 4.3H55.6z"
                fill="none"
                stroke="#cfc4ff"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="60" cy="60" r="5" fill="#ec007d" />
            </svg>
          </div>
        </motion.div>

        <motion.h1
          id={labelledById}
          {...rise(0.1)}
          className="font-oswald text-[30px] font-bold leading-[1.06] tracking-[0.005em] text-white sm:text-[34px]"
        >
          {welcomeContent.title}
        </motion.h1>

        <motion.p
          id={describedById}
          {...rise(0.18)}
          className="mt-4 max-w-[340px] font-sans text-[15.5px] leading-[1.5] text-white/72"
        >
          {welcomeContent.description}
        </motion.p>
      </div>

      <motion.div {...rise(0.26)} className="flex flex-col gap-3 pt-4">
        <PrimaryButton
          onClick={() => { onboardingHaptic('medium'); onStart(); }}
          data-onboarding-action="start"
        >
          {welcomeContent.primaryCta}
        </PrimaryButton>
        <GhostButton onClick={onDismiss} className="w-full" data-onboarding-action="dismiss">
          {welcomeContent.secondaryCta}
        </GhostButton>
      </motion.div>
    </div>
  );
}
