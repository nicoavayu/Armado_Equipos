import React, { useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';

import useOnboardingDialog from './useOnboardingDialog';

// Shared modal chrome for intro, real first-step progress and completion.
export default function OnboardingModal({
  labelledById,
  describedById,
  onClose,
  closeLabel = 'Cerrar',
  showClose = false,
  children,
}) {
  const reduce = useReducedMotion();
  const dialogRef = useRef(null);
  const handleKeyDown = useOnboardingDialog({ containerRef: dialogRef, onDismiss: onClose });

  return (
    <motion.div
      data-modal-root="true"
      data-onboarding-root="true"
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-[rgba(5,3,16,0.78)] px-4 backdrop-blur-[3px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.2 }}
      onKeyDown={handleKeyDown}
    >
      <motion.section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        aria-describedby={describedById}
        tabIndex={-1}
        className="auth-premium-card relative flex max-h-[min(760px,calc(100dvh-32px))] w-full max-w-[420px] flex-col overflow-hidden rounded-[28px] border border-white/20 pb-[max(calc(env(safe-area-inset-bottom)+18px),28px)] text-white outline-none shadow-[0_28px_72px_rgba(4,2,14,0.68),inset_0_1px_0_rgba(255,255,255,0.08)]"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 22px)',
          paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 18px), 28px)',
        }}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.975 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
        transition={{ duration: reduce ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(139,92,255,0.26),transparent_68%)]" />
          <div className="absolute -bottom-24 -right-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(236,0,125,0.13),transparent_70%)]" />
          <div className="absolute inset-x-5 top-5 h-24 rounded-t-[80px] border-x border-t border-white/[0.055]" />
        </div>

        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="absolute right-3 top-[max(env(safe-area-inset-top),12px)] z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.045] text-white/58 transition-colors hover:bg-white/[0.1] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a98cff]"
          >
            <X size={18} aria-hidden />
          </button>
        )}

        <div className="relative z-10 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6">
          {children}
        </div>
      </motion.section>
    </motion.div>
  );
}
