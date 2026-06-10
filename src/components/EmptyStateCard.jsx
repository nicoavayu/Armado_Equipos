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
  const defaultTitleClassName = 'font-oswald font-semibold text-[19px] leading-tight tracking-[0.01em] text-white sm:text-[18px]';
  const defaultActionClassName = 'mt-5 w-full max-w-[300px] mx-auto min-h-[42px] px-4 py-2 border border-white/15 bg-cta-gradient text-white font-bebas text-[15px] tracking-[0.04em] rounded-none flex items-center justify-center text-center transition-all hover:brightness-110 active:opacity-95 shadow-[0_4px_16px_rgba(106,67,255,0.3)] sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';
  const normalizedTitle = toSentenceCase(title);

  return (
    <div className={`w-full max-w-[460px] text-center my-6 p-6 rounded-none bg-[linear-gradient(168deg,rgba(42,34,86,0.66),rgba(24,19,52,0.92))] border border-white/[0.09] shadow-[0_10px_28px_rgba(6,4,18,0.45),inset_0_1px_0_rgba(255,255,255,0.05)] ${className}`}>
      <div className="mx-auto mb-3.5 w-11 h-11 rounded-xl bg-[rgba(106,67,255,0.14)] border border-[rgba(139,124,255,0.35)] flex items-center justify-center">
        <Icon size={20} className="text-[#b3a6ff]" />
      </div>
      <h3 className={titleClassName || defaultTitleClassName}>
        {normalizedTitle}
      </h3>
      <p className="mt-2.5 text-[13px] md:text-sm text-white/60 font-oswald leading-snug max-w-[320px] mx-auto">
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
