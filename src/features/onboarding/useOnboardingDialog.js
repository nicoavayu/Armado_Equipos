import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Shared lifecycle for every onboarding surface: focus trap/restoration,
// background scroll lock, Escape and the Android hardware back button.
export default function useOnboardingDialog({ containerRef, onDismiss }) {
  const previouslyFocusedRef = useRef(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    previouslyFocusedRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    const body = typeof document !== 'undefined' ? document.body : null;
    const previousOverflow = body?.style.overflow || '';
    if (body) body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      const node = containerRef.current;
      if (!node) return;
      const first = node.querySelector(FOCUSABLE);
      (first || node).focus?.();
    }, 30);

    return () => {
      window.clearTimeout(focusTimer);
      if (body) body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.();
    };
  }, [containerRef]);

  useEffect(() => {
    let disposed = false;
    let handle = null;

    Promise.resolve(CapacitorApp.addListener('backButton', () => dismissRef.current?.()))
      .then((nextHandle) => {
        if (disposed) nextHandle?.remove?.();
        else handle = nextHandle;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      handle?.remove?.();
    };
  }, []);

  return (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current?.();
      return;
    }
    if (event.key !== 'Tab') return;

    const node = containerRef.current;
    if (!node) return;
    const focusables = Array.from(node.querySelectorAll(FOCUSABLE)).filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
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
}
