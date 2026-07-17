import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  BarChart3,
  CalendarPlus,
  LayoutGrid,
  Radar,
  Shield,
} from 'lucide-react';

import { goalSelectorContent } from './content';
import { onboardingHaptic } from './haptics';

const ICONS = {
  BarChart3, CalendarPlus, LayoutGrid, Radar, Shield,
};

// "¿Qué querés hacer primero?" — the branch selector. Choosing an option drives
// both the educational path and its real-data first-steps checklist.
export default function OnboardingGoalSelector({ onSelect, labelledById }) {
  const reduce = useReducedMotion();

  const item = (index) => (reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25 } }
    : {
      initial: { opacity: 0, y: 16 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.42, delay: 0.06 + index * 0.07, ease: [0.16, 1, 0.3, 1] },
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-1 pt-2 text-center">
        <motion.h2
          id={labelledById}
          {...item(0)}
          className="mx-auto max-w-[390px] text-center font-bebas-real text-[clamp(32px,9vw,44px)] leading-[0.94] tracking-[0.035em] text-white"
        >
          {goalSelectorContent.title}
        </motion.h2>
      </div>

      <div
        data-onboarding-goal-list="true"
        className="mt-4 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {goalSelectorContent.options.map((option, index) => {
          const Icon = ICONS[option.icon] || LayoutGrid;
          return (
            <motion.button
              key={option.key}
              type="button"
              data-preserve-button-case="true"
              {...item(index)}
              onClick={() => { onboardingHaptic('light'); onSelect(option.key); }}
              data-onboarding-goal={option.key}
              className="group flex min-h-[64px] shrink-0 items-center gap-3 rounded-2xl border border-white/12 bg-white/[0.05] px-3.5 py-2.5 text-left transition-colors hover:border-[#8b7cff]/50 hover:bg-white/[0.09] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70 active:scale-[0.99]"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(140deg,rgba(139,92,255,0.32),rgba(106,67,255,0.12))] text-[#cfc4ff] ring-1 ring-inset ring-[rgba(148,134,255,0.35)]">
                <Icon size={19} strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bebas-real text-[19px] leading-none tracking-[0.025em] text-white">
                  {option.label}
                </span>
                <span className="mt-0.5 block font-sans text-[12.5px] leading-snug text-white/55">
                  {option.description}
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>

    </div>
  );
}
