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
  const defaultActionClassName = 'mt-6 h-[52px] w-full max-w-[340px] mx-auto border border-[rgba(136,120,255,0.75)] bg-[linear-gradient(90deg,#4f8ef7_0%,#6f4dff_100%)] text-white font-oswald text-[18px] font-semibold tracking-[0.01em] rounded-none transition-all hover:brightness-110 active:opacity-95';
  const normalizedTitle = toSentenceCase(title);

  return (
    <div className={`w-full max-w-[500px] text-center my-8 p-8 rounded-none bg-[linear-gradient(160deg,rgba(31,38,86,0.86),rgba(16,24,60,0.94))] border border-[rgba(108,126,196,0.46)] shadow-[0_18px_38px_rgba(4,10,28,0.42)] ${className}`}>
      <div className="mx-auto mb-4 w-12 h-12 rounded-none bg-[rgba(35,46,95,0.86)] border border-[rgba(118,137,204,0.5)] flex items-center justify-center">
        <Icon size={22} className="text-white/72" />
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
