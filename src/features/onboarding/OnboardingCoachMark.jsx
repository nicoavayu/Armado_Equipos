import React from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useCoachMarks } from './useCoachMarks';
import { useOnboardingOptional } from './OnboardingContext';

// Thin provider gate: outside the provider (e.g. a screen rendered in
// isolation), render nothing and start no tour.
export default function OnboardingCoachMark({ screenKey }) {
  const onboarding = useOnboardingOptional();
  if (!onboarding) return null;
  return <OnboardingCoachMarkInner screenKey={screenKey} />;
}

// Contextual coach marks for a single screen. Dims the background, spotlights
// the REAL control (a soft "hole" cut with a large box-shadow), and shows a
// bottom card with title/body, progress ("1 de N") and Anterior/Siguiente/Omitir.
// Non-blocking: taps pass through to the app; the tour never loops or repeats.
function OnboardingCoachMarkInner({ screenKey }) {
  const reduce = useReducedMotion();
  const {
    visible, step, index, total, isFirst, isLast, rect, next, prev, skip,
  } = useCoachMarks(screenKey);

  if (typeof document === 'undefined' || !visible || !step) return null;

  const pad = 8;
  const hole = rect && (rect.width > 0 || rect.height > 0)
    ? {
      top: Math.max(rect.top - pad, 0),
      left: Math.max(rect.left - pad, 0),
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    }
    : null;

  const cardMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483200]"
      style={{ pointerEvents: 'none' }}
      role="dialog"
      aria-modal="false"
      aria-label={step.title}
    >
      {/* Spotlight: a transparent rect whose huge box-shadow dims everything
          else. Falls back to a plain dim when the target has no measured box. */}
      {hole ? (
        <div
          className="absolute rounded-xl"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: '0 0 0 9999px rgba(6,4,18,0.72)',
            outline: '2px solid rgba(139,92,255,0.9)',
            outlineOffset: '2px',
            transition: reduce ? 'none' : 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(6,4,18,0.72)]" />
      )}

      {/* Bottom card */}
      <motion.div
        {...cardMotion}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-x-0 bottom-0 px-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)', pointerEvents: 'auto' }}
      >
        <div className="mx-auto max-w-[520px] rounded-2xl border border-[rgba(148,134,255,0.3)] bg-[linear-gradient(165deg,rgba(38,30,80,0.98),rgba(16,12,33,0.99))] p-4 shadow-[0_24px_64px_rgba(5,3,16,0.7)]">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-[#b0a0ff]/75">
              {index + 1} de {total}
            </span>
            <button
              type="button"
              onClick={skip}
              className="rounded-full px-2 py-1 font-oswald text-[13px] font-medium text-white/55 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70"
            >
              Omitir
            </button>
          </div>
          <h3 className="font-oswald text-[17px] font-bold leading-tight text-white">{step.title}</h3>
          <p className="mt-1 font-sans text-[13.5px] leading-snug text-white/72">{step.body}</p>

          <div className="mt-3.5 flex items-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={isFirst}
              className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-white/14 bg-white/[0.05] px-3 font-oswald text-[13.5px] font-medium text-white/85 transition-colors hover:bg-white/[0.1] disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70"
            >
              <ChevronLeft size={16} aria-hidden /> Anterior
            </button>
            <button
              type="button"
              onClick={next}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-[linear-gradient(135deg,#8b5cff,#6a43ff)] px-4 font-oswald text-[14px] font-semibold text-white shadow-[0_6px_16px_rgba(106,67,255,0.36)] transition-transform active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b0a0ff]"
            >
              {isLast ? 'Entendido' : 'Siguiente'}
              {!isLast && <ChevronRight size={16} aria-hidden />}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
