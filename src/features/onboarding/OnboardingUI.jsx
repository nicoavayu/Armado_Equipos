import React from 'react';

// Shared presentational atoms for the onboarding, styled to the Arma2 system
// (violet CTA gradient, flat surfaces, Inter/oswald type). Kept dependency-free
// and reduced-motion-safe (transitions are opacity/transform only, and the
// global prefers-reduced-motion rules already neutralize them).

export function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex h-[52px] w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#8b5cff_0%,#6a43ff_52%,#5430e0_100%)] px-6 font-bebas-real text-[19px] tracking-[0.035em] text-white shadow-[0_10px_26px_rgba(106,67,255,0.4),inset_0_1px_0_rgba(255,255,255,0.22)] transition-transform duration-150 active:scale-[0.985] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b0a0ff] disabled:opacity-60 motion-reduce:transition-none ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex h-[48px] items-center justify-center rounded-2xl border border-white/14 bg-white/[0.05] px-5 font-sans text-[14px] font-semibold text-white/85 transition-colors hover:bg-white/[0.1] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70 disabled:opacity-40 motion-reduce:transition-none ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function ProgressDots({ total, index, label }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label || `Paso ${index + 1} de ${total}`}>
      <div className="flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: total }).map((_, dotIndex) => (
          <span
            key={dotIndex}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              dotIndex === index
                ? 'w-6 bg-[#8b7cff]'
                : dotIndex < index
                  ? 'w-1.5 bg-[#8b7cff]/70'
                  : 'w-1.5 bg-white/20'
            }`}
          />
        ))}
      </div>
      <span className="ml-1 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {index + 1}/{total}
      </span>
    </div>
  );
}
