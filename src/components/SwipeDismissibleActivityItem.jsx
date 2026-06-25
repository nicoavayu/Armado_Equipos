import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const DISMISS_THRESHOLD_RATIO = 0.55;
const DISMISS_THRESHOLD_MAX = 220;
const INTENT_THRESHOLD = 12;
const VERTICAL_INTENT_THRESHOLD = 10;
const HORIZONTAL_INTENT_RATIO = 1.35;
const EXIT_FALLBACK_HEIGHT = 104;
const FALLBACK_WIDTH = 320;
const MOTION_CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getDismissThreshold = (width) => Math.min(
  (width > 0 ? width : FALLBACK_WIDTH) * DISMISS_THRESHOLD_RATIO,
  DISMISS_THRESHOLD_MAX,
);

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
  isDismissing = false,
  disabled = false,
}) => {
  const rootRef = useRef(null);
  const blockClickRef = useRef(false);
  const blockClickTimeoutRef = useRef(null);
  const gestureRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    startAt: 0,
    width: FALLBACK_WIDTH,
    mode: 'idle',
    moved: false,
  });
  const [dragX, setDragX] = useState(0);
  const [exitX, setExitX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(EXIT_FALLBACK_HEIGHT);
  const prefersReducedMotion = usePrefersReducedMotion();
  const activeWidth = rootRef.current?.getBoundingClientRect?.().width || FALLBACK_WIDTH;
  const dragProgress = Math.min(Math.abs(dragX) / getDismissThreshold(activeWidth), 1);
  const rotation = isDragging ? clamp(dragX / 90, -1.2, 1.2) : 0;
  const contentTransform = isDismissing
    ? `translate3d(${exitX || 0}px, 0, 0)`
    : `translate3d(${dragX}px, 0, 0) rotate(${rotation}deg)`;
  const contentTransition = prefersReducedMotion || isDragging
    ? 'none'
    : `transform 220ms ${MOTION_CURVE}, opacity 190ms ease`;
  const wrapperTransition = prefersReducedMotion
    ? 'none'
    : `max-height 230ms ${MOTION_CURVE}, opacity 190ms ease`;

  useLayoutEffect(() => {
    if (!rootRef.current || isDismissing) return;
    setMeasuredHeight(Math.max(rootRef.current.scrollHeight, EXIT_FALLBACK_HEIGHT));
  }, [children, isDismissing]);

  useEffect(() => () => {
    if (blockClickTimeoutRef.current) {
      window.clearTimeout(blockClickTimeoutRef.current);
    }
  }, []);

  const releaseBlockedClickSoon = () => {
    if (blockClickTimeoutRef.current) {
      window.clearTimeout(blockClickTimeoutRef.current);
    }
    blockClickTimeoutRef.current = window.setTimeout(() => {
      blockClickRef.current = false;
      blockClickTimeoutRef.current = null;
    }, 260);
  };

  const resetGesture = ({ keepPosition = false } = {}) => {
    gestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      startAt: 0,
      width: FALLBACK_WIDTH,
      mode: 'idle',
      moved: false,
    };
    setIsDragging(false);
    if (!keepPosition) setDragX(0);
  };

  const handlePointerDown = (event) => {
    if (disabled || isDismissing) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const width = rootRef.current?.getBoundingClientRect?.().width || FALLBACK_WIDTH;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAt: event.timeStamp || Date.now(),
      width,
      mode: 'pending',
      moved: false,
    };
    setExitX(0);
    setDragX(0);
  };

  const handlePointerMove = (event) => {
    const gesture = gestureRef.current;
    if (gesture.mode === 'idle' || !isSamePointer(gesture, event)) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (gesture.mode === 'vertical') return;

    if (gesture.mode === 'pending') {
      if (absY > VERTICAL_INTENT_THRESHOLD && absY > absX * 1.15) {
        gesture.mode = 'vertical';
        gesture.moved = true;
        blockClickRef.current = true;
        return;
      }

      if (absX < INTENT_THRESHOLD || absX < absY * HORIZONTAL_INTENT_RATIO) {
        return;
      }

      gesture.mode = 'horizontal';
      gesture.moved = true;
      blockClickRef.current = true;
      setIsDragging(true);
    }

    if (gesture.mode !== 'horizontal') return;

    event.preventDefault();
    setDragX(clamp(dx, -gesture.width * 0.95, gesture.width * 0.95));
  };

  const handlePointerUp = (event) => {
    const gesture = gestureRef.current;
    if (gesture.mode === 'idle' || !isSamePointer(gesture, event)) return;

    const dx = event.clientX - gesture.startX;

    if (gesture.mode === 'horizontal') {
      event.preventDefault();
      const elapsedMs = Math.max((event.timeStamp || Date.now()) - gesture.startAt, 1);
      const velocity = dx / elapsedMs;
      const threshold = getDismissThreshold(gesture.width);
      const shouldDismiss = (
        Math.abs(dx) >= threshold
        || (Math.abs(dx) >= threshold * 0.95 && Math.abs(velocity) > 1)
      );

      blockClickRef.current = true;

      if (shouldDismiss) {
        const direction = dx === 0 ? 1 : Math.sign(dx);
        setExitX(direction * (gesture.width + 48));
        setDragX(dx);
        resetGesture({ keepPosition: true });
        onDismiss?.(itemKey);
        return;
      }
    }

    if (gesture.mode === 'horizontal' || gesture.moved || Math.abs(dx) > 4) {
      blockClickRef.current = true;
      releaseBlockedClickSoon();
    }

    resetGesture();
  };

  const handlePointerCancel = () => {
    const gesture = gestureRef.current;
    if (gesture.mode === 'horizontal' || gesture.moved) {
      blockClickRef.current = true;
      releaseBlockedClickSoon();
    }
    resetGesture();
  };

  const handleClickCapture = (event) => {
    if (!blockClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    blockClickRef.current = false;
  };

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  });

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden"
      data-swipe-dismissible-activity-item={itemKey}
      style={{
        maxHeight: isDismissing ? 0 : measuredHeight,
        opacity: isDismissing ? 0 : 1,
        transition: wrapperTransition,
      }}
    >
      <div
        className="relative"
        onPointerDown={handlePointerDown}
        onClickCapture={handleClickCapture}
        style={{
          touchAction: disabled ? 'auto' : 'pan-y',
          transform: contentTransform,
          opacity: isDismissing ? 0 : 1 - (dragProgress * 0.14),
          transition: contentTransition,
          willChange: isDragging || isDismissing ? 'transform, opacity' : 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeDismissibleActivityItem;
