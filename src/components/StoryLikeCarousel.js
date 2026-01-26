import React, { useEffect, useMemo, useRef, useState } from 'react';

const StoryLikeCarousel = ({
  slides = [],
  onClose,
  onIndexChange,
  autoAdvance = true,
  duration = 5000,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(0);

  const safeSlides = useMemo(() => (Array.isArray(slides) ? slides : []), [slides]);
  const currentSlide = safeSlides[currentIndex];

  const slideDuration = useMemo(() => {
    const d = currentSlide?.duration ?? duration;
    return typeof d === 'number' && d > 0 ? d : duration;
  }, [currentSlide, duration]);

  const emitIndex = (idx) => {
    const key = safeSlides?.[idx]?.key;
    onIndexChange?.(idx, key);
  };

  // Trigger index on mount
  useEffect(() => {
    if (!safeSlides.length) return;
    setCurrentIndex(0);
    setProgress(0);
    emitIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSlides.length]);

  // Trigger index on change
  useEffect(() => {
    if (!safeSlides.length) return;
    emitIndex(currentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, safeSlides]);

  const handleNext = () => {
    if (currentIndex < safeSlides.length - 1) setCurrentIndex((p) => p + 1);
    else onClose?.();
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex((p) => p - 1);
  };

  // Auto-advance (stable)
  useEffect(() => {
    if (!autoAdvance || !safeSlides.length) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current = performance.now();
    setProgress(0);

    const tick = (t) => {
      const elapsed = t - startRef.current;
      const pct = Math.min((elapsed / slideDuration) * 100, 100);
      setProgress(pct);

      if (elapsed >= slideDuration) {
        handleNext();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // IMPORTANT: depend only on index + duration, not the full slides object
  }, [currentIndex, autoAdvance, slideDuration, safeSlides.length]);

  if (!currentSlide) return null;

  const node =
    typeof currentSlide.content === 'function'
      ? currentSlide.content()
      : currentSlide.content;

  return (
    <div className="fixed inset-0 z-[9999] bg-black">
      {/* Vignette / film */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/75" />
        <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 120px rgba(0,0,0,0.9)' }} />
        <div className="absolute inset-0 opacity-[0.06] mix-blend-overlay animate-grain" />
      </div>

      {/* Progress Bars */}
      <div className="absolute top-3 left-0 w-full px-3 flex gap-1 z-50">
        {safeSlides.map((s, idx) => {
          const isPast = idx < currentIndex;
          const isNow = idx === currentIndex;
          return (
            <div key={s?.key || idx} className="h-1.5 flex-1 bg-white/25 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full"
                style={{
                  width: isPast ? '100%' : isNow ? `${progress}%` : '0%',
                  transition: isNow ? 'none' : 'width 200ms ease',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-6 right-4 z-50 text-white/80 hover:text-white px-3 py-2 rounded-full bg-white/10 hover:bg-white/15 backdrop-blur"
        aria-label="Cerrar"
      >
        ✕
      </button>

      {/* Tap areas */}
      <div className="absolute inset-0 z-40 flex">
        <div className="w-1/3 h-full" onClick={handlePrev} />
        <div className="w-2/3 h-full" onClick={handleNext} />
      </div>

      {/* Slide */}
      <div className="relative z-10 w-full h-full flex items-center justify-center px-4 md:px-10 pt-14 pb-10">
        <div className="w-full max-w-[1100px] h-full flex items-center justify-center">
          {node}
        </div>
      </div>

      <style>{`
        @keyframes grain {
          0%,100% { transform: translate(0,0); }
          10% { transform: translate(-2%, -1%); }
          20% { transform: translate(-3%, 2%); }
          30% { transform: translate(2%, -3%); }
          40% { transform: translate(-2%, 3%); }
          50% { transform: translate(-3%, 1%); }
          60% { transform: translate(3%, 0%); }
          70% { transform: translate(0%, 2%); }
          80% { transform: translate(2%, 3%); }
          90% { transform: translate(-1%, 2%); }
        }
        .animate-grain{
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)' opacity='.45'/%3E%3C/svg%3E");
          animation: grain 6s steps(10) infinite;
        }
      `}</style>
    </div>
  );
};

export default StoryLikeCarousel;
