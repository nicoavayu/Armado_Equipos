import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { prefetchRoute } from '../utils/routePrefetch';

// Horizontal snap rail for the Home "Accesos rápidos".
// One active/hero card stays prominent while the next cards peek at the side
// (the last one cuts off to hint at scroll). The active card is tracked from the
// scroll position so the violet/glow treatment glides between cards, and the dots
// below mirror that position. Card widths stay fixed; the active "pop" is done with
// transform/opacity so scrolling never reflows the snap points.

// Subtle pitch lines layered behind the hero card for the sporty/gamer feel.
const PitchLines = () => (
  <svg
    className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] w-full opacity-[0.16] mix-blend-screen"
    viewBox="0 0 160 120"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    aria-hidden="true"
  >
    <circle cx="80" cy="120" r="34" />
    <path d="M80 86v34" />
    <path d="M0 120h160" />
    <path d="M30 120v-14h100v14" />
  </svg>
);

const QuickAccessCard = React.forwardRef(({ item, isActive }, ref) => {
  const {
    to,
    onClick,
    prefetch,
    icon,
    title,
    subtitle,
    badge,
    showPlus,
  } = item;

  const handlePrefetch = useCallback(() => {
    if (prefetch) prefetchRoute(prefetch);
  }, [prefetch]);

  const cardClass = [
    'group relative snap-start shrink-0 w-[150px] sm:w-[164px] min-h-[152px]',
    'flex flex-col items-center text-center gap-2 p-4 rounded-card overflow-hidden',
    'no-underline text-white outline-none cursor-pointer',
    'transition-[transform,box-shadow,background-color,border-color,opacity] duration-300 ease-out',
    'origin-center will-change-transform',
    'focus-visible:ring-2 focus-visible:ring-[rgba(190,170,255,0.7)] focus-visible:ring-offset-0',
    isActive
      ? 'z-[2] scale-100 border border-[rgba(196,178,255,0.55)] text-white bg-[linear-gradient(135deg,#8b5cff_0%,#6a43ff_56%,#5430e0_100%)] shadow-[0_16px_36px_rgba(84,48,224,0.45),0_0_0_1px_rgba(196,178,255,0.22),inset_0_1px_0_rgba(255,255,255,0.24)]'
      : 'z-[1] scale-[0.93] opacity-90 border border-[rgba(148,134,255,0.18)] bg-[linear-gradient(165deg,rgba(48,38,98,0.72),rgba(20,16,41,0.94))] shadow-elev-1 hover:opacity-100 hover:border-[rgba(148,134,255,0.42)] active:brightness-95',
  ].join(' ');

  const iconBadgeClass = [
    'relative inline-flex items-center justify-center rounded-full mt-1',
    'transition-[width,height,background-color,border-color] duration-300 ease-out',
    isActive
      ? 'h-[52px] w-[52px] bg-white/[0.16] border border-white/30 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_6px_16px_rgba(20,8,60,0.35)]'
      : 'h-12 w-12 bg-[rgba(139,92,255,0.14)] border border-[rgba(148,134,255,0.3)] text-[#cfc4ff]',
  ].join(' ');

  const titleClass = [
    'font-oswald font-bold leading-tight tracking-[0.01em] text-white',
    isActive ? 'text-[15.5px]' : 'text-[14px]',
  ].join(' ');

  const subtitleClass = [
    'font-sans font-medium leading-tight text-[11px]',
    isActive ? 'text-white/80' : 'text-white/55',
  ].join(' ');

  const inner = (
    <>
      {isActive && <span className="text-white"><PitchLines /></span>}

      {badge > 0 && (
        <span className="absolute top-2.5 right-2.5 z-[2] inline-flex min-w-[20px] h-5 items-center justify-center rounded-full bg-[#ec007d] px-1.5 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(236,0,125,0.5)]">
          {badge}
        </span>
      )}

      <span className={iconBadgeClass}>
        <span className="inline-flex items-center justify-center [&>svg]:h-[26px] [&>svg]:w-[26px]">
          {icon}
        </span>
        {showPlus && (
          <span className="absolute -top-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#6a43ff] shadow-[0_3px_8px_rgba(20,8,60,0.4)]">
            <Plus size={13} strokeWidth={3} />
          </span>
        )}
      </span>

      <span className="relative z-[1] mt-auto flex flex-col items-center gap-0.5 pt-2">
        <span className={titleClass}>{title}</span>
        <span className={subtitleClass}>{subtitle}</span>
      </span>
    </>
  );

  const sharedProps = {
    ref,
    className: cardClass,
    onMouseEnter: handlePrefetch,
    onTouchStart: handlePrefetch,
    onFocus: handlePrefetch,
    'aria-current': isActive ? 'true' : undefined,
  };

  if (to) {
    return (
      <Link to={to} {...sharedProps}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} {...sharedProps}>
      {inner}
    </button>
  );
});

QuickAccessCard.displayName = 'QuickAccessCard';

const QuickAccessRail = ({ items = [] }) => {
  const scrollRef = useRef(null);
  const cardRefs = useRef([]);
  const rafRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const recomputeActive = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Cards snap to the start, inset by the rail's 16px scroll-padding, so the
    // "active" card is the one whose left edge is closest to that snap anchor.
    const anchor = el.scrollLeft + 16;
    let best = 0;
    let bestDistance = Infinity;

    cardRefs.current.forEach((node, index) => {
      if (!node) return;
      const distance = Math.abs(node.offsetLeft - anchor);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });

    setActiveIndex((current) => (current === best ? current : best));
  }, []);

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      recomputeActive();
    });
  }, [recomputeActive]);

  useEffect(() => {
    recomputeActive();
    const handleResize = () => recomputeActive();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [recomputeActive, items.length]);

  const scrollToIndex = useCallback((index) => {
    const el = scrollRef.current;
    const node = cardRefs.current[index];
    if (!el || !node) return;
    // Align to the rail's 16px scroll-padding so the snapped card sits under the title.
    el.scrollTo({ left: Math.max(0, node.offsetLeft - 16), behavior: 'smooth' });
  }, []);

  return (
    <div className="-mx-4 mb-6">
      <style>{`
        .qa-rail { -ms-overflow-style: none; scrollbar-width: none; }
        .qa-rail::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) {
          .qa-rail { scroll-behavior: auto; }
        }
      `}</style>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="qa-rail relative flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 px-4 pt-1 pb-3 scroll-smooth"
      >
        {items.map((item, index) => (
          <QuickAccessCard
            key={item.key}
            ref={(node) => { cardRefs.current[index] = node; }}
            item={item}
            isActive={index === activeIndex}
          />
        ))}
      </div>

      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 px-4">
          {items.map((item, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={item.key}
                type="button"
                aria-label={`Ir a ${item.title}`}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => scrollToIndex(index)}
                className="group/dot inline-flex h-4 items-center justify-center"
              >
                <span
                  className={[
                    'block rounded-full transition-all duration-300 ease-out',
                    isActive
                      ? 'w-5 h-1.5 bg-[linear-gradient(90deg,#8b5cff,#6a43ff)] shadow-[0_0_8px_rgba(122,82,255,0.55)]'
                      : 'w-1.5 h-1.5 bg-white/25 group-hover/dot:bg-white/45',
                  ].join(' ')}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default QuickAccessRail;
