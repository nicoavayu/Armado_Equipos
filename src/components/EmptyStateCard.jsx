import React from 'react';
import { CircleOff } from 'lucide-react';

const EmptyStateCard = ({
  title,
  description,
  icon: Icon = CircleOff,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div className={`w-full max-w-[500px] text-center my-8 p-8 rounded-2xl bg-white/5 border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.18)] ${className}`}>
      <div className="mx-auto mb-4 w-12 h-12 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
        <Icon size={22} className="text-white/70" />
      </div>
      <h3 className="font-bebas text-[28px] leading-none tracking-[0.03em] text-white">
        {title}
      </h3>
      <p className="mt-3 text-sm md:text-[15px] text-white/65 font-oswald leading-snug">
        {description}
      </p>
      {actionLabel && typeof onAction === 'function' && (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 h-11 min-w-[180px] px-5 rounded-xl bg-primary border border-white/25 text-white font-bebas text-[20px] tracking-wide transition-all hover:brightness-110 active:scale-[0.98]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyStateCard;
