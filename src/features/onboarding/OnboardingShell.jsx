import React, { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';

// Fullscreen chrome for the onboarding flow: themed backdrop with soft pitch
// lines + glows, an always-available Skip control, focus trapping, scroll lock,
// Escape-to-skip, and reduced-motion-aware transitions. Real safe areas are
// honored via env(safe-area-inset-*).

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function OnboardingShell({
  onSkip,
  labelledById,
  describedById,
  skipLabel = 'Omitir',
  header = null,
  children,
}) {
  const reduce = useReducedMotion();
  const cardRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    previouslyFocusedRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    const body = typeof document !== 'undefined' ? document.body : null;
    const prevOverflow = body ? body.style.overflow : '';
    if (body) body.style.overflow = 'hidden';

    // Move focus into the dialog on open.
    const focusTimer = window.setTimeout(() => {
      const node = cardRef.current;
      if (!node) return;
      const first = node.querySelector(FOCUSABLE);
      (first || node).focus?.();
    }, 30);

    return () => {
      window.clearTimeout(focusTimer);
      if (body) body.style.overflow = prevOverflow;
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && typeof toRestore.focus === 'function') {
        toRestore.focus();
      }
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onSkip?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const node = cardRef.current;
    if (!node) return;
    const focusables = Array.from(node.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (focusables.length === 0) {
      event.preventDefault();
      node.focus?.();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const backdropMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };

  const cardMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.98 } };

  return (
    <motion.div
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
        className="relative flex w-full max-w-[520px] flex-col overflow-hidden outline-none sm:my-auto sm:h-[min(760px,94vh)] sm:rounded-[28px] sm:border sm:border-white/12 sm:shadow-[0_30px_80px_rgba(4,2,14,0.6)]"
        style={{ background: 'var(--app-bg-gradient)' }}
        {...cardMotion}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Ambience: soft pitch arc + violet/magenta glows. Decorative only. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(139,92,255,0.28),transparent_66%)]" />
          <div className="absolute bottom-[-30%] right-[-10%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(236,0,125,0.18),transparent_68%)]" />
          <svg viewBox="0 0 400 800" className="absolute inset-0 h-full w-full opacity-[0.06]" preserveAspectRatio="xMidYMid slice">
            <rect x="20" y="20" width="360" height="760" rx="24" fill="none" stroke="#fff" strokeWidth="2" />
            <line x1="20" y1="400" x2="380" y2="400" stroke="#fff" strokeWidth="2" />
            <circle cx="200" cy="400" r="70" fill="none" stroke="#fff" strokeWidth="2" />
          </svg>
        </div>

        <div
          className="relative z-[1] flex min-h-0 flex-1 flex-col"
          style={{
            paddingTop: 'max(env(safe-area-inset-top), 14px)',
            paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
          }}
        >
          <div className="flex items-center justify-between px-5 pb-1 pt-1">
            <div className="min-w-0 flex-1 pr-3">{header}</div>
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/14 bg-white/[0.06] px-3 py-1.5 text-[12.5px] font-oswald font-medium tracking-[0.01em] text-white/75 transition-colors hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cff]/70"
            >
              {skipLabel}
              <X size={13} strokeWidth={2.4} aria-hidden />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-5">
            {children}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
