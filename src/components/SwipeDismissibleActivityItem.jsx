import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

const ACTION_WIDTH = 88;
const OPEN_THRESHOLD = 46;
const INTENT_THRESHOLD = 8;
const HORIZONTAL_INTENT_RATIO = 1.2;
const EXIT_FALLBACK_HEIGHT = 104;
const MOTION_CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isSamePointer = (gesture, event) => (
  gesture.pointerId === null
  || gesture.pointerId === undefined
  || event.pointerId === null
  || event.pointerId === undefined
  || gesture.pointerId === event.pointerId
);

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return prefersReducedMotion;
};

const SwipeDismissibleActivityItem = ({
  itemKey,
  children,
  onDismiss,
  onRequestOpen,
  onRequestClose,
  isOpen = false,
  isDismissing = false,
  disabled = false,
}) => {
  const rootRef = useRef(null);
  const dragXRef = useRef(null);
  const blockClickRef = useRef(false);
  const gestureRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    mode: 'idle',
    lastTranslateX: 0,
  });
  const [dragX, setDragXState] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(EXIT_FALLBACK_HEIGHT);
  const prefersReducedMotion = usePrefersReducedMotion();
  const isActionVisible = isOpen || isDragging || (dragX !== null && dragX < -1);
  const translateX = dragX !== null ? dragX : (isOpen ? -ACTION_WIDTH : 0);
  const transition = prefersReducedMotion || isDragging
    ? 'none'
    : `transform 220ms ${MOTION_CURVE}, opacity 160ms ease`;
  const wrapperTransition = prefersReducedMotion
    ? 'none'
    : `max-height 220ms ${MOTION_CURVE}, opacity 160ms ease, transform 200ms ${MOTION_CURVE}`;

  const setDragX = (value) => {
    dragXRef.current = value;
    setDragXState(value);
  };

  useLayoutEffect(() => {
    if (!rootRef.current || isDismissing) return;
    setMeasuredHeight(Math.max(rootRef.current.scrollHeight, EXIT_FALLBACK_HEIGHT));
  }, [children, isDismissing]);

  useEffect(() => {
    if (!isOpen || disabled) return undefined;

    const handlePointerDownOutside = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      onRequestClose?.(itemKey);
    };

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
    };
  }, [disabled, isOpen, itemKey, onRequestClose]);

  const resetGesture = () => {
    gestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      mode: 'idle',
      lastTranslateX: 0,
    };
    setIsDragging(false);
    setDragX(null);
  };

  const handlePointerDown = (event) => {
    if (disabled || isDismissing) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      mode: 'pending',
      lastTranslateX: isOpen ? -ACTION_WIDTH : 0,
    };
  };

  const handlePointerMove = (event) => {
    const gesture = gestureRef.current;
    if (gesture.mode === 'idle' || !isSamePointer(gesture, event)) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (gesture.mode === 'pending') {
      if (absY > INTENT_THRESHOLD && absY > absX * 1.1) {
        gesture.mode = 'vertical';
        return;
      }

      if (absX <= INTENT_THRESHOLD || absX <= absY * HORIZONTAL_INTENT_RATIO) {
        return;
      }

      gesture.mode = 'horizontal';
      blockClickRef.current = true;
      setIsDragging(true);
      onRequestOpen?.(itemKey);

      if (typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Some WebViews can throw if capture was already released.
        }
      }
    }

    if (gesture.mode !== 'horizontal') return;

    event.preventDefault();
    const baseX = isOpen ? -ACTION_WIDTH : 0;
    const nextTranslateX = clamp(baseX + dx, -ACTION_WIDTH, 0);
    gesture.lastTranslateX = nextTranslateX;
    setDragX(nextTranslateX);
  };

  const handlePointerUp = (event) => {
    const gesture = gestureRef.current;
    if (gesture.mode === 'idle' || !isSamePointer(gesture, event)) return;

    if (gesture.mode === 'horizontal') {
      event.preventDefault();
      const finalTranslateX = dragXRef.current ?? gesture.lastTranslateX;
      const shouldOpen = finalTranslateX <= -OPEN_THRESHOLD;

      if (shouldOpen) {
        onRequestOpen?.(itemKey);
      } else {
        onRequestClose?.(itemKey);
      }

      blockClickRef.current = true;
      window.setTimeout(() => {
        blockClickRef.current = false;
      }, 260);
    }

    resetGesture();
  };

  const handlePointerCancel = () => {
    resetGesture();
  };

  const handleClickCapture = (event) => {
    if (blockClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      blockClickRef.current = false;
      return;
    }

    if (isOpen) {
      event.preventDefault();
      event.stopPropagation();
      onRequestClose?.(itemKey);
    }
  };

  const handleDismissClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onDismiss?.(itemKey);
  };

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden"
      data-swipe-dismissible-activity-item={itemKey}
      style={{
        maxHeight: isDismissing ? 0 : measuredHeight,
        opacity: isDismissing ? 0 : 1,
        transform: isDismissing ? 'translateY(-4px) scale(0.985)' : 'translateY(0) scale(1)',
        transition: wrapperTransition,
      }}
    >
      <div
        aria-hidden={!isActionVisible}
        className="absolute inset-y-0 right-0 z-0 flex w-[88px] items-stretch justify-end"
      >
        <button
          type="button"
          tabIndex={isActionVisible ? 0 : -1}
          onClick={handleDismissClick}
          className="m-1.5 flex w-[76px] flex-col items-center justify-center gap-1 rounded-[7px] border border-[rgba(255,88,120,0.35)] bg-[linear-gradient(145deg,rgba(255,88,120,0.24),rgba(255,88,120,0.14))] text-white shadow-[0_12px_32px_rgba(255,88,120,0.18),inset_0_1px_0_rgba(255,255,255,0.16)] outline-none transition-[transform,background,border-color] duration-200 ease-out hover:bg-[linear-gradient(145deg,rgba(255,88,120,0.32),rgba(255,88,120,0.18))] focus-visible:ring-2 focus-visible:ring-[rgba(255,135,160,0.55)] active:scale-[0.97]"
          aria-label="Eliminar de Actividad reciente"
          title="Eliminar de Actividad reciente"
        >
          <Trash2 size={18} strokeWidth={2.25} />
          <span className="text-[10.5px] font-semibold leading-none text-white/90">Eliminar</span>
        </button>
      </div>

      <div
        className="relative z-[1]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClickCapture={handleClickCapture}
        style={{
          touchAction: disabled ? 'auto' : 'pan-y',
          transform: `translate3d(${translateX}px, 0, 0)`,
          transition,
          willChange: isDragging ? 'transform' : 'auto',
          boxShadow: translateX < -2 ? '10px 0 24px rgba(0,0,0,0.18)' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeDismissibleActivityItem;
