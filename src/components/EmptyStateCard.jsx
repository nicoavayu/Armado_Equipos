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
  const defaultTitleClassName = 'font-oswald font-semibold text-[24px] leading-none tracking-[0.01em] text-white sm:text-[22px]';
  const defaultActionClassName = 'mt-6 w-full max-w-[340px] mx-auto min-h-[44px] px-4 py-2.5 border border-white/15 bg-cta-gradient text-white font-bebas text-base tracking-[0.01em] rounded-none flex items-center justify-center text-center transition-all hover:brightness-110 active:opacity-95 shadow-[0_0_16px_rgba(236,0,125,0.35)] sm:text-[13px] sm:px-3 sm:py-2 sm:min-h-[36px]';
  const normalizedTitle = toSentenceCase(title);

  return (
    <div className={`w-full max-w-[500px] text-center my-8 p-8 rounded-none bg-[linear-gradient(165deg,rgba(58,27,78,0.72),rgba(30,14,44,0.94))] border border-[rgba(236,0,125,0.18)] shadow-[0_18px_40px_rgba(8,3,16,0.5),inset_0_1px_0_rgba(255,255,255,0.05)] ${className}`}>
      <div className="mx-auto mb-4 w-12 h-12 rounded-none bg-[rgba(236,0,125,0.12)] border border-[rgba(236,0,125,0.35)] flex items-center justify-center">
        <Icon size={22} className="text-[#ff7ec0]" />
      </div>
      <h3 className={titleClassName || defaultTitleClassName}>
        {normalizedTitle}
      </h3>
      <p className="mt-3 text-sm md:text-[15px] text-white/68 font-oswald leading-snug">
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
