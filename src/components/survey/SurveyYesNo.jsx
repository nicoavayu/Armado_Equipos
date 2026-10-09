import React, { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { surveyHaptic } from './surveyHaptics';

// Long enough to see the choice light up, short enough to feel instant.
export const SURVEY_CHOICE_ADVANCE_MS = 220;

const prefersReducedMotion = () => {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch (_error) {
    return false;
  }
};

/**
 * SÍ / NO as two big cards in the thumb zone. The tap lights the card up (and a light
 * haptic), then the step's own handler runs. A second tap while it advances is ignored.
 */
const SurveyYesNo = ({
  value = null,
  onYes,
  onNo,
  labelledBy = 'survey-step-title',
  disabled = false,
}) => {
  const [pending, setPending] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const choose = (choice) => {
    if (pending || disabled) return;
    setPending(choice);
    surveyHaptic('light');
    const handler = choice === 'yes' ? onYes : onNo;
    timerRef.current = setTimeout(() => {
      handler?.();
      setPending(null);
    }, prefersReducedMotion() ? 0 : SURVEY_CHOICE_ADVANCE_MS);
  };

  const selected = pending || value;
  const options = [
    { key: 'yes', label: 'SÍ', Icon: Check },
    { key: 'no', label: 'NO', Icon: X },
  ];

  return (
    <div className="grid w-full grid-cols-2 gap-3" role="group" aria-labelledby={labelledBy}>
      {options.map(({ key, label, Icon }) => {
        const isSelected = selected === key;
        const isOther = Boolean(selected) && !isSelected;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => choose(key)}
            className={`relative flex min-h-[116px] flex-col items-center justify-center gap-2.5 rounded-[22px] border text-white transition-[transform,background-color,border-color,box-shadow,opacity] duration-200 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1442] disabled:opacity-55 ${
              isSelected
                ? 'a2-survey-pop border-[#b9a6ff] bg-[linear-gradient(160deg,rgba(139,92,255,0.62),rgba(84,48,224,0.5))] shadow-[0_0_0_1px_rgba(185,166,255,0.75),0_16px_34px_rgba(54,32,140,0.55),0_0_28px_rgba(139,92,255,0.5)]'
                : 'border-[rgba(148,134,255,0.3)] bg-surface-gradient shadow-elev-2 hover:border-[rgba(167,139,250,0.55)]'
            } ${isOther ? 'opacity-55' : ''}`}
          >
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-200 ${
                isSelected ? 'border-white/45 bg-white/20' : 'border-white/15 bg-white/[0.07]'
              }`}
              aria-hidden="true"
            >
              <Icon size={22} strokeWidth={2.75} />
            </span>
            <span className="font-bebas text-[26px] leading-none tracking-[0.1em]">{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default SurveyYesNo;
