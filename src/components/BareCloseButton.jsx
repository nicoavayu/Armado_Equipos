import React from 'react';
import { X } from 'lucide-react';

// Canonical borderless X used by voting and onboarding. The visible control
// stays intentionally container-free while retaining a 40px touch target.
export const BARE_CLOSE_BUTTON_CLASS = 'inline-flex h-10 w-10 items-center justify-center text-white/92 transition-all duration-200 hover:scale-105 hover:text-white active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a98cff]';

export default function BareCloseButton({ className = '', iconProps = {}, ...props }) {
  return (
    <button
      type="button"
      className={`${BARE_CLOSE_BUTTON_CLASS} ${className}`}
      {...props}
    >
      <X size={20} strokeWidth={2.35} aria-hidden {...iconProps} />
    </button>
  );
}
