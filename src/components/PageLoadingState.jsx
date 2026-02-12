import React from 'react';
import LoadingSpinner from './LoadingSpinner';

const PageLoadingState = ({
  title = 'CARGANDO',
  description = 'Esperá un instante...',
  skeletonCards = 0,
  className = '',
}) => {
  return (
    <div className={`w-full max-w-[520px] mx-auto ${className}`}>
      <div className="w-full rounded-2xl bg-white/5 border border-white/10 shadow-[0_14px_40px_rgba(0,0,0,0.22)] px-6 py-7 text-center">
        <div className="flex justify-center mb-4">
          <LoadingSpinner size="large" />
        </div>
        <h3 className="font-bebas text-[34px] md:text-[42px] leading-none tracking-[0.04em] text-white">
          {title}
        </h3>
        {description && (
          <p className="mt-2 font-oswald text-sm md:text-[15px] text-white/70 leading-snug">
            {description}
          </p>
        )}
      </div>

      {skeletonCards > 0 && (
        <div className="mt-4 space-y-3">
          {Array.from({ length: skeletonCards }).map((_, idx) => (
            <div
              key={`skeleton-${idx}`}
              className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 animate-pulse"
            >
              <div className="h-3.5 w-1/3 bg-white/15 rounded mb-3" />
              <div className="h-3 w-2/3 bg-white/10 rounded mb-2" />
              <div className="h-3 w-1/2 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PageLoadingState;
