import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Sparkles, X, ChevronRight } from 'lucide-react';

import { useOnboardingOptional } from './OnboardingContext';
import { discoveryCardContent } from './content';
import { onboardingHaptic } from './haptics';

// The single, optional, dismissable Home card for pre-existing users:
// "Conocé todo lo que podés hacer con Arma2". Never auto-opens the flow — it
// only offers it. Hidden once dismissed or once the user starts the tour.
// Provider-optional so it renders nothing (never crashes) outside the provider.
export default function OnboardingDiscoveryCard() {
  const onboarding = useOnboardingOptional();
  const reduce = useReducedMotion();

  if (!onboarding) return null;
  const { canShowDiscoveryCard, isActive, openOnboarding, dismissDiscoveryCard } = onboarding;
  if (!canShowDiscoveryCard || isActive) return null;

  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="relative mb-4 shrink-0 overflow-hidden rounded-2xl border border-[rgba(148,134,255,0.28)] bg-[radial-gradient(220px_120px_at_15%_-10%,rgba(139,92,255,0.24),transparent_70%),linear-gradient(160deg,rgba(48,38,98,0.62),rgba(20,16,41,0.86))] px-4 py-3.5 shadow-[0_12px_30px_rgba(5,3,16,0.4)]"
      aria-label={discoveryCardContent.title}
    >
      <button
        type="button"
        onClick={dismissDiscoveryCard}
        aria-label="Descartar"
        className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] text-white/50 transition-colors hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70"
      >
        <X size={14} aria-hidden />
      </button>

      <div className="flex items-start gap-3 pr-7">
        <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(140deg,rgba(139,92,255,0.4),rgba(106,67,255,0.16))] text-[#cfc4ff] ring-1 ring-inset ring-[rgba(148,134,255,0.4)]">
          <Sparkles size={20} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <span className="inline-block font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-[#b0a0ff]/80">
            {discoveryCardContent.eyebrow}
          </span>
          <h3 className="mt-0.5 font-oswald text-[16.5px] font-bold leading-tight tracking-[0.01em] text-white">
            {discoveryCardContent.title}
          </h3>
          <p className="mt-1 font-sans text-[12.5px] leading-snug text-white/62">
            {discoveryCardContent.description}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { onboardingHaptic('light'); openOnboarding({ replay: false }); }}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-xl bg-[linear-gradient(135deg,#8b5cff,#6a43ff)] px-4 font-oswald text-[13.5px] font-semibold text-white shadow-[0_6px_16px_rgba(106,67,255,0.36)] transition-transform active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b0a0ff]"
            >
              {discoveryCardContent.primaryCta}
              <ChevronRight size={15} aria-hidden />
            </button>
            <button
              type="button"
              onClick={dismissDiscoveryCard}
              className="inline-flex h-9 items-center justify-center rounded-xl px-3 font-oswald text-[13px] font-medium text-white/55 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70"
            >
              {discoveryCardContent.dismissLabel}
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
