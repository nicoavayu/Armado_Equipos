import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, X, PartyPopper } from 'lucide-react';

import { useOnboardingOptional } from './OnboardingContext';
import { useOnboardingChecklist } from './useOnboardingChecklist';
import { checklistCompletionContent, ONBOARDING_PATHS } from './content';
import { onboardingHaptic } from './haptics';

// Thin provider gate: when there is no onboarding provider (e.g. a host screen
// rendered in isolation), render nothing and run no data queries.
export default function OnboardingChecklist() {
  const onboarding = useOnboardingOptional();
  if (!onboarding) return null;
  return <OnboardingChecklistInner onboarding={onboarding} />;
}

// Compact, dismissable Home checklist. Steps derive from real product data.
// When everything is done it plays one brief, subtle celebration, marks the
// onboarding complete and hides itself.
function OnboardingChecklistInner({ onboarding }) {
  const { enabled, stateLoaded, state, dismissChecklist, markChecklistCelebrated } = onboarding;
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [celebrating, setCelebrating] = useState(false);
  const celebratedRef = useRef(false);

  const pathKey = state?.chosenPath || null;
  const checklist = useOnboardingChecklist(pathKey || ONBOARDING_PATHS.OVERVIEW);

  const dismissed = Boolean(state?.checklist?.dismissed);
  const alreadyCelebrated = Boolean(state?.checklist?.celebrated);

  // Trigger the one-time celebration when the list first becomes complete.
  useEffect(() => {
    if (!checklist.loading && checklist.allDone && !alreadyCelebrated && !celebratedRef.current && pathKey) {
      celebratedRef.current = true;
      setCelebrating(true);
      onboardingHaptic('medium');
    }
  }, [checklist.loading, checklist.allDone, alreadyCelebrated, pathKey]);

  const shouldRender = enabled
    && stateLoaded
    && Boolean(pathKey)
    && !dismissed
    && (!checklist.loading || checklist.total > 0);

  if (!shouldRender) return null;
  if (checklist.allDone && alreadyCelebrated) return null;

  const finishCelebration = () => {
    setCelebrating(false);
    markChecklistCelebrated();
  };

  const cardMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };

  return (
    <AnimatePresence>
      <motion.section
        {...cardMotion}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-4 shrink-0 overflow-hidden rounded-2xl border border-[rgba(148,134,255,0.24)] bg-[linear-gradient(165deg,rgba(48,38,98,0.5),rgba(20,16,41,0.82))] px-4 py-3.5 shadow-[0_10px_28px_rgba(5,3,16,0.36)]"
        aria-label="Primeros pasos en Arma2"
      >
        {celebrating ? (
          <div className="flex flex-col items-center py-2 text-center">
            <span className="mb-2.5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[radial-gradient(circle,rgba(53,208,127,0.28),transparent_70%)] text-[#35d07f]">
              <PartyPopper size={26} strokeWidth={2} aria-hidden />
            </span>
            <h3 className="font-oswald text-[18px] font-bold leading-tight text-white">
              {checklistCompletionContent.title}
            </h3>
            <p className="mt-1 max-w-[300px] font-sans text-[12.5px] leading-snug text-white/65">
              {checklistCompletionContent.description}
            </p>
            <button
              type="button"
              onClick={finishCelebration}
              className="mt-3 inline-flex h-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#8b5cff,#6a43ff)] px-6 font-oswald text-[14px] font-semibold text-white shadow-[0_6px_16px_rgba(106,67,255,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b0a0ff]"
            >
              ¡Listo!
            </button>
          </div>
        ) : (
          <>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-oswald text-[15.5px] font-bold leading-tight tracking-[0.01em] text-white">
                  {checklist.title}
                </h3>
                <p className="mt-0.5 font-sans text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#b0a0ff]/70">
                  {checklist.completedCount}/{checklist.total} completado
                </p>
              </div>
              <button
                type="button"
                onClick={dismissChecklist}
                aria-label="Ocultar checklist"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70"
              >
                <X size={14} aria-hidden />
              </button>
            </div>

            {/* Progress bar */}
            <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#8b5cff,#6a43ff)] transition-[width] duration-500"
                style={{ width: `${checklist.total ? (checklist.completedCount / checklist.total) * 100 : 0}%` }}
              />
            </div>

            <ul className="flex flex-col gap-1">
              {checklist.items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={item.done}
                    onClick={() => { onboardingHaptic('light'); if (item.route) navigate(item.route); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                      item.done ? 'cursor-default' : 'hover:bg-white/[0.06] active:bg-white/[0.09]'
                    }`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        item.done
                          ? 'border-[#35d07f] bg-[#35d07f]/18 text-[#35d07f]'
                          : 'border-white/25 bg-white/[0.03] text-transparent'
                      }`}
                    >
                      <Check size={13} strokeWidth={3} aria-hidden />
                    </span>
                    <span className={`min-w-0 flex-1 font-sans text-[13.5px] leading-snug ${
                      item.done ? 'text-white/45 line-through' : 'text-white/88'
                    }`}
                    >
                      {item.label}
                    </span>
                    {!item.done && item.route && (
                      <ChevronRight size={15} className="shrink-0 text-white/30" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </motion.section>
    </AnimatePresence>
  );
}
