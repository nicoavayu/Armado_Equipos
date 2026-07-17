import React, { useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import BareCloseButton from '../../components/BareCloseButton';
import useOnboardingDialog from './useOnboardingDialog';

// Fullscreen chrome for the onboarding flow: themed backdrop with soft pitch
// lines + glows, an always-available Skip control, focus trapping, scroll lock,
// Escape-to-skip, and reduced-motion-aware transitions. Real safe areas are
// honored via env(safe-area-inset-*).

export default function OnboardingShell({
  onDismiss,
  labelledById,
  describedById,
  dismissLabel = 'Omitir tutorial',
  children,
}) {
  const reduce = useReducedMotion();
  const cardRef = useRef(null);
  const handleKeyDown = useOnboardingDialog({ containerRef: cardRef, onDismiss });

  const backdropMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

  const cardMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.98 } };

  return (
    <motion.div
      data-modal-root="true"
      data-onboarding-root="true"
      className="fixed inset-0 z-[2147483000] flex items-stretch justify-center bg-[rgba(6,4,18,0.72)] backdrop-blur-[2px]"
      {...backdropMotion}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      onKeyDown={handleKeyDown}
    >
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        aria-describedby={describedById}
        tabIndex={-1}
        data-onboarding-fullscreen-frame="true"
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden rounded-none border-0 outline-none"
        style={{ background: 'var(--app-bg-gradient)' }}
        {...cardMotion}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Full-viewport pitch: the device edges are the field boundary. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(139,92,255,0.28),transparent_66%)]" />
          <div className="absolute bottom-[-30%] right-[-10%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(236,0,125,0.18),transparent_68%)]" />
          <svg data-onboarding-pitch="fullscreen" viewBox="0 0 400 800" className="absolute inset-0 h-full w-full opacity-[0.065]" preserveAspectRatio="xMidYMid slice">
            <line x1="-40" y1="400" x2="440" y2="400" stroke="#fff" strokeWidth="2" />
            <circle cx="200" cy="400" r="70" fill="none" stroke="#fff" strokeWidth="2" />
            <circle cx="200" cy="400" r="3" fill="#fff" />
            <path d="M100 0v150M300 0v150M100 800V650M300 800V650" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.42" />
          </svg>
        </div>

        <div
          className="relative z-[1] flex min-h-0 flex-1 flex-col"
          style={{
            paddingTop: 'max(env(safe-area-inset-top), 14px)',
            paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 22px), 34px)',
          }}
        >
          <div className="mx-auto flex w-full max-w-[520px] items-center justify-end px-4 pb-1 pt-1">
            <BareCloseButton
              onClick={onDismiss}
              aria-label={dismissLabel}
              className="shrink-0"
            />
          </div>

          <div className="mx-auto flex min-h-0 w-full max-w-[520px] flex-1 flex-col px-5">
            {children}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
