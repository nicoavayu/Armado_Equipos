import React from 'react';
import { Check } from 'lucide-react';

import { onboardingHaptic } from './haptics';
import OnboardingModal from './OnboardingModal';

export default function OnboardingFirstStepsModal({ checklist, onClose, onNavigate }) {
  const completedLabel = `${checklist.completedCount}/${checklist.total} completados`;
  const progress = checklist.total ? (checklist.completedCount / checklist.total) * 100 : 0;
  const nextPendingKey = checklist.items.find((item) => !item.done)?.key || null;

  return (
    <OnboardingModal
      labelledById="onboarding-first-steps-title"
      describedById="onboarding-first-steps-progress"
      onClose={onClose}
      showClose
      closeLabel="Cerrar primeros pasos"
    >
      <div className="pb-0 pt-4">
        <p className="font-sans text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#b9a8ff]/72">
          Tu recorrido
        </p>
        <h2
          id="onboarding-first-steps-title"
          className="mt-1 pr-10 font-bebas-real text-[clamp(36px,10vw,46px)] leading-[0.92] tracking-[0.035em] text-white"
        >
          {checklist.title}
        </h2>
        <p id="onboarding-first-steps-progress" className="mt-2 font-sans text-[13px] font-semibold text-white/66">
          {completedLabel}
        </p>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#8b5cff,#6a43ff,#ec007d)] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ul className="mt-5 flex flex-col gap-2">
          {checklist.items.map((item) => {
            const isNext = item.key === nextPendingKey;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  data-preserve-button-case="true"
                  disabled={item.done || !item.route}
                  onClick={() => {
                    onboardingHaptic('light');
                    onNavigate(item.route);
                  }}
                  className={`flex min-h-[54px] w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a98cff] ${item.done
                    ? 'cursor-default border-white/[0.07] bg-white/[0.025]'
                    : isNext
                      ? 'border-[#8b7cff]/45 bg-[#6a43ff]/[0.13] hover:bg-[#6a43ff]/[0.2]'
                      : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'}`}
                >
                  <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${item.done
                    ? 'border-[#35d07f]/70 bg-[#35d07f]/15 text-[#66e5a4]'
                    : 'border-white/25 bg-white/[0.03] text-transparent'}`}
                  >
                    <Check size={14} strokeWidth={3} aria-hidden />
                  </span>
                  <span className={`min-w-0 flex-1 font-sans text-[13.5px] font-medium leading-snug ${item.done ? 'text-white/42 line-through' : 'text-white/88'}`}>
                    {item.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {nextPendingKey && (
          <p className="mt-4 text-center font-sans text-[11.5px] leading-snug text-white/48">
            Tocá el próximo paso para ir al flujo real. Se completa solamente cuando realizás la acción.
          </p>
        )}
      </div>
    </OnboardingModal>
  );
}
