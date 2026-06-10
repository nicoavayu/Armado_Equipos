import React from 'react';
import { CircleOff } from 'lucide-react';
import { toSentenceCase } from '../utils/textCase';

const EmptyStateCard = ({
  title,
  description,
  icon: Icon = CircleOff,
  actionLabel,
  onAction,
  className = '',
  titleClassName = '',
  actionClassName = '',
}) => {
  const defaultTitleClassName = 'font-oswald font-bold text-[18px] leading-tight tracking-[0.01em] text-white sm:text-[17px]';
  const defaultActionClassName = 'mt-5 w-full max-w-[300px] mx-auto min-h-[44px] px-4 py-2 border border-white/15 bg-cta-gradient text-white font-bebas text-[15px] font-semibold tracking-[0.04em] rounded-2xl flex items-center justify-center text-center transition-all hover:brightness-110 active:opacity-95 shadow-cta sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[40px]';
  const normalizedTitle = toSentenceCase(title);

  return (
    <div className={`relative w-full max-w-[460px] text-center my-6 px-6 py-7 rounded-card overflow-hidden bg-[radial-gradient(380px_200px_at_50%_-40%,rgba(139,92,255,0.22),transparent_70%),linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))] border border-[rgba(148,134,255,0.18)] shadow-elev-2 ${className}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-[linear-gradient(90deg,transparent_6%,rgba(176,160,255,0.55)_38%,rgba(236,0,125,0.35)_66%,transparent_94%)]"
      />
      <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-[linear-gradient(140deg,rgba(139,92,255,0.3),rgba(106,67,255,0.08))] border border-[rgba(148,134,255,0.35)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_16px_rgba(5,3,16,0.4)] flex items-center justify-center">
        <Icon size={24} className="text-[#cfc4ff]" />
      </div>
      <h3 className={titleClassName || defaultTitleClassName}>
        {normalizedTitle}
      </h3>
      <p className="mt-2 text-[13px] md:text-sm text-white/55 font-sans leading-relaxed max-w-[320px] mx-auto">
        {description}
      </p>
      {actionLabel && typeof onAction === 'function' && (
        <button
          type="button"
          onClick={onAction}
          className={actionClassName || defaultActionClassName}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyStateCard;
