import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CalendarPlus, Radar, Sparkles, ChevronRight, ChevronLeft } from 'lucide-react';

import { goalSelectorContent } from './content';
import { onboardingHaptic } from './haptics';

const ICONS = { CalendarPlus, Radar, Sparkles };

// "¿Qué querés hacer primero?" — the branch selector. Choosing an option drives
// both the flow path and the Home checklist. Includes a Back to welcome.
export default function OnboardingGoalSelector({ onSelect, onBack, labelledById }) {
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
      <div className="pt-6">
        <motion.h2
          id={labelledById}
          {...item(0)}
          className="font-oswald text-[26px] font-bold leading-tight tracking-[0.005em] text-white sm:text-[28px]"
        >
          {goalSelectorContent.title}
        </motion.h2>
      </div>

      <div className="mt-7 flex flex-1 flex-col justify-center gap-3">
        {goalSelectorContent.options.map((option, index) => {
          const Icon = ICONS[option.icon] || Sparkles;
          return (
            <motion.button
              key={option.key}
              type="button"
              {...item(index)}
              onClick={() => { onboardingHaptic('light'); onSelect(option.key); }}
              data-onboarding-goal={option.key}
              className="group flex items-center gap-4 rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-4 text-left transition-colors hover:border-[#8b7cff]/50 hover:bg-white/[0.09] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70 active:scale-[0.99]"
            >
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(140deg,rgba(139,92,255,0.32),rgba(106,67,255,0.12))] text-[#cfc4ff] ring-1 ring-inset ring-[rgba(148,134,255,0.35)]">
                <Icon size={22} strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-oswald text-[17px] font-semibold leading-tight text-white">
                  {option.label}
                </span>
                <span className="mt-0.5 block font-sans text-[12.5px] leading-snug text-white/55">
                  {option.description}
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-white/35 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </motion.button>
          );
        })}
      </div>

      <div className="pt-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 font-oswald text-[14px] font-medium text-white/60 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70"
        >
          <ChevronLeft size={16} aria-hidden /> Volver
        </button>
      </div>
    </div>
  );
}
